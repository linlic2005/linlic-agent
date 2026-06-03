import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { type LatexDraftAnalysis, latexToPlainText, parseLatexDraftProject } from "./latex-draft.ts";
import { type FetchLike, type PaperSearchPaper, searchPapers } from "./paper-search.ts";
import { type DraftSection, parseLatexSections, parseMarkdownSections } from "./review-draft.ts";
import { buildBibtexForPapers, paperSearchToBibtexPaper } from "./zotero.ts";

export type CitationDraftFormat = "markdown" | "latex";
export type CitationCheckStatus = "需要人工确认";

export interface ParsedCitationCheckInput {
	filePath: string;
	limit?: number;
}

export interface CitationIssue {
	sectionHeading: string;
	text: string;
	reason: string;
	suggestion: string;
}

export interface UnsupportedCitationIssue {
	citationKey: string;
	sectionHeading: string;
	text: string;
	status: CitationCheckStatus;
	reason: string;
}

export interface OutdatedCitationIssue {
	citationKey: string;
	inferredYear: number;
	reason: string;
}

export interface CitationFormatIssue {
	citationKey: string;
	reason: string;
	suggestion: string;
}

export interface CitationCheckResult {
	filePath: string;
	format: CitationDraftFormat;
	citationKeys: string[];
	missingCitations: CitationIssue[];
	unsupportedCitations: UnsupportedCitationIssue[];
	coverageGaps: CitationIssue[];
	outdatedCitations: OutdatedCitationIssue[];
	formatIssues: CitationFormatIssue[];
	suggestedPapers: PaperSearchPaper[];
	bibtexSuggestions: string;
	searchQuery: string;
	searchWarnings: string[];
	latex?: LatexDraftAnalysis;
	markdown: string;
}

export interface CitationCheckOptions {
	cwd: string;
	input: string;
	limit?: number;
	fetcher?: FetchLike;
	apiKey?: string;
	signal?: AbortSignal;
	logger?: { warn(message: string): void };
}

const DEFAULT_LIMIT = 8;
const CURRENT_YEAR = new Date().getFullYear();
const OUTDATED_YEAR_THRESHOLD = CURRENT_YEAR - 5;

function parseKeyValue(input: string, key: string): string | undefined {
	const pattern = new RegExp(`${key}=("([^"]+)"|'([^']+)'|([^\\s]+))`, "i");
	const match = input.match(pattern);
	return match?.[2] ?? match?.[3] ?? match?.[4];
}

function parseNumber(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function stripOuterQuotes(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function removeKnownArguments(input: string): string {
	return input
		.replace(/\b(?:file|path|draft|limit)=("[^"]+"|'[^']+'|[^\s]+)/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function parseCitationCheckInput(input: string): ParsedCitationCheckInput {
	const normalized = input
		.trim()
		.replace(/^\/citation-check\b/i, "")
		.trim();
	const filePath =
		parseKeyValue(normalized, "file") ?? parseKeyValue(normalized, "path") ?? parseKeyValue(normalized, "draft");
	const limit = parseNumber(parseKeyValue(normalized, "limit"));
	return {
		filePath: stripOuterQuotes(filePath ?? removeKnownArguments(normalized)),
		...(limit ? { limit } : {}),
	};
}

function resolveDraftPath(cwd: string, input: string): string {
	const parsed = parseCitationCheckInput(input);
	return isAbsolute(parsed.filePath) ? parsed.filePath : resolve(cwd, parsed.filePath);
}

function detectFormat(filePath: string): CitationDraftFormat {
	const extension = extname(filePath).toLowerCase();
	if (extension === ".md" || extension === ".markdown") return "markdown";
	if (extension === ".tex" || extension === ".latex") return "latex";
	throw new Error(`仅支持 Markdown 或 LaTeX 草稿：${filePath}`);
}

async function readDraftFile(filePath: string): Promise<string> {
	const fileStat = await stat(filePath).catch(() => {
		throw new Error(`草稿文件不存在：${filePath}`);
	});
	if (!fileStat.isFile()) throw new Error(`草稿路径不是文件：${filePath}`);
	const content = await readFile(filePath, "utf8");
	if (!content.trim()) throw new Error(`草稿文本为空：${filePath}`);
	return content;
}

function extractMarkdownCitationKeys(content: string): string[] {
	const keys = new Set<string>();
	for (const match of content.matchAll(/\\cite\w*\s*\{([^}]+)\}/gi)) {
		for (const key of (match[1] ?? "").split(",")) {
			const trimmed = key.trim();
			if (trimmed) keys.add(trimmed);
		}
	}
	for (const match of content.matchAll(/@([A-Za-z0-9_:.+-]+)/g)) {
		const key = match[1]?.trim();
		if (key) keys.add(key);
	}
	return Array.from(keys);
}

function extractCitationKeys(content: string, latex: LatexDraftAnalysis | undefined): string[] {
	return Array.from(new Set([...(latex?.citations ?? []), ...extractMarkdownCitationKeys(content)])).slice(0, 200);
}

function sentenceHasCitation(sentence: string): boolean {
	return /\\cite\w*\s*\{[^}]+}|\[@?[A-Za-z0-9_:.+-]+(?:[;\s,]+@?[A-Za-z0-9_:.+-]+)*]|\[[0-9,\s-]+]|@[A-Za-z0-9_:.+-]+/.test(
		sentence,
	);
}

function sentenceCitationKeys(sentence: string): string[] {
	const keys = new Set<string>();
	for (const match of sentence.matchAll(/\\cite\w*\s*\{([^}]+)\}/gi)) {
		for (const key of (match[1] ?? "").split(",")) {
			const trimmed = key.trim();
			if (trimmed) keys.add(trimmed);
		}
	}
	for (const match of sentence.matchAll(/@([A-Za-z0-9_:.+-]+)/g)) {
		const key = match[1]?.trim();
		if (key) keys.add(key);
	}
	return Array.from(keys);
}

function isStrongClaim(sentence: string): boolean {
	return /state-of-the-art|solved|all\b|without|robustly|recent methods|widely|significant|outperform|achieved|首次|最新|所有|显著|广泛|已有研究|无需|鲁棒/u.test(
		sentence.toLowerCase(),
	);
}

function splitSentences(text: string): string[] {
	return text
		.replace(/\s+/g, " ")
		.split(/(?<=[.!?。！？])\s+/u)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length >= 35);
}

function findMissingCitations(sections: DraftSection[]): CitationIssue[] {
	const issues: CitationIssue[] = [];
	for (const section of sections) {
		for (const sentence of splitSentences(section.text)) {
			if (isStrongClaim(sentence) && !sentenceHasCitation(sentence)) {
				issues.push({
					sectionHeading: section.heading,
					text: sentence,
					reason: "该句包含强论断、趋势判断或泛化表述，但附近未识别到引用。",
					suggestion: "补充直接支持该论断的论文；如果只是作者观察，应降低语气并标注为本文假设。",
				});
			}
		}
	}
	return issues.slice(0, 12);
}

function findUnsupportedCitations(sections: DraftSection[]): UnsupportedCitationIssue[] {
	const issues: UnsupportedCitationIssue[] = [];
	for (const section of sections) {
		for (const sentence of splitSentences(section.text)) {
			if (!sentenceHasCitation(sentence)) continue;
			const keys = sentenceCitationKeys(sentence);
			for (const key of keys.length > 0 ? keys : ["数字引用"]) {
				issues.push({
					citationKey: key,
					sectionHeading: section.heading,
					text: sentence,
					status: "需要人工确认",
					reason: "MVP 无法读取被引论文全文来验证原句是否被直接支持，只能标记为需要人工确认。",
				});
			}
		}
	}
	return issues.slice(0, 12);
}

function inferCitationYear(key: string): number | undefined {
	const match = key.match(/((?:19|20)\d{2})/u);
	return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function findOutdatedCitations(citationKeys: string[]): OutdatedCitationIssue[] {
	return citationKeys
		.map((citationKey) => ({ citationKey, inferredYear: inferCitationYear(citationKey) }))
		.filter(
			(item): item is { citationKey: string; inferredYear: number } =>
				item.inferredYear !== undefined && item.inferredYear < OUTDATED_YEAR_THRESHOLD,
		)
		.map((item) => ({
			...item,
			reason: `引用年份早于 ${OUTDATED_YEAR_THRESHOLD}，如果用于说明当前研究现状，需要补充近三到五年的工作。`,
		}))
		.slice(0, 12);
}

function findFormatIssues(content: string, citationKeys: string[]): CitationFormatIssue[] {
	const issues: CitationFormatIssue[] = [];
	for (const key of citationKeys) {
		if (/\s/u.test(key)) {
			issues.push({
				citationKey: key,
				reason: "citation key 中包含空白字符，可能导致 Markdown/Pandoc 或 LaTeX 编译失败。",
				suggestion: "将 citation key 改为不含空格的 BibTeX key。",
			});
		}
		if (/[^A-Za-z0-9_:.+-]/u.test(key)) {
			issues.push({
				citationKey: key,
				reason: "citation key 包含非常规字符。",
				suggestion: "确认该 key 与 BibTeX 条目完全一致，并符合目标工具链格式。",
			});
		}
	}
	if (/\[[0-9,\s-]+\]/u.test(content)) {
		issues.push({
			citationKey: "数字引用",
			reason: "检测到数字引用格式，MVP 无法确认其是否与参考文献列表一一对应。",
			suggestion: "人工核对数字编号、参考文献顺序和目标期刊格式。",
		});
	}
	return issues.slice(0, 12);
}

function findCoverageGaps(
	sections: DraftSection[],
	citationKeys: string[],
	suggestedPapers: PaperSearchPaper[],
): CitationIssue[] {
	const related = sections.find((section) => section.kind === "related_work");
	const issues: CitationIssue[] = [];
	if (!related) {
		issues.push({
			sectionHeading: "相关工作",
			text: "未识别到相关工作章节。",
			reason: "缺少相关工作会导致引用覆盖不足，创新性对比也难以成立。",
			suggestion: "补充相关工作章节，并按任务、方法、数据集和最新进展组织引用。",
		});
	} else if (citationKeys.length < 5 || related.text.length < 600) {
		issues.push({
			sectionHeading: related.heading,
			text: related.text.slice(0, 280),
			reason: "相关工作引用数量或篇幅偏少，可能不足以覆盖直接竞争方法。",
			suggestion: "补充近三到五年的直接相关论文，优先纳入强 baseline、survey 和目标会议论文。",
		});
	}
	if (suggestedPapers.length > 0) {
		issues.push({
			sectionHeading: related?.heading ?? "相关工作",
			text: suggestedPapers
				.slice(0, 3)
				.map((paper) => paper.title)
				.join("；"),
			reason: "外部检索发现可作为补充引用的近期论文。",
			suggestion: "逐篇精读后再决定是否引用；不要仅因检索命中就加入参考文献。",
		});
	}
	return issues.slice(0, 8);
}

function buildSearchQuery(sections: DraftSection[]): string {
	const title = sections[0]?.heading ?? "";
	const abstract = sections.find((section) => section.kind === "abstract")?.text ?? "";
	const related = sections.find((section) => section.kind === "related_work")?.text ?? "";
	const stopWords = new Set([
		"about",
		"achieved",
		"detection",
		"method",
		"paper",
		"study",
		"surfaces",
		"this",
		"with",
	]);
	const words = `${title} ${abstract} ${related}`
		.normalize("NFKC")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word.length >= 4 && !stopWords.has(word) && !/^\d+$/.test(word));
	const unique = Array.from(new Set(words)).slice(0, 10);
	return unique.length > 0 ? unique.join(" ") : "recent related work";
}

function formatList(items: string[], fallback: string): string[] {
	return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function buildCitationCheckMarkdown(result: Omit<CitationCheckResult, "markdown">): string {
	const suggestedPaperLines =
		result.suggestedPapers.length > 0
			? result.suggestedPapers.flatMap((paper, index) => [
					`### ${index + 1}. ${paper.title}`,
					"",
					`- 作者：${paper.authors.length > 0 ? paper.authors.join(", ") : "未知"}`,
					`- 年份：${paper.year ?? "未知"}`,
					`- venue：${paper.venue ?? "未知"}`,
					`- URL / DOI：${paper.url ?? "未知"}${paper.doi ? ` / ${paper.doi}` : ""}`,
					`- 说明：来自外部检索结果，需要人工确认是否真正适合补充引用。`,
					"",
				])
			: ["未检索到可建议补充的新论文。不要虚构引用，可扩大关键词后重试。", ""];

	return [
		"# 引用检查报告",
		"",
		"## 1. 总体评价",
		"",
		`草稿格式：${result.format}。共识别 citation key ${result.citationKeys.length} 个，缺少引用位置 ${result.missingCitations.length} 处，过旧引用 ${result.outdatedCitations.length} 个。不能确认的引用支持关系均标记为“需要人工确认”。`,
		"",
		"## 2. 缺少引用的位置",
		"",
		...formatList(
			result.missingCitations.map(
				(issue) =>
					`【${issue.sectionHeading}】${issue.text}\n  - 原因：${issue.reason}\n  - 建议：${issue.suggestion}`,
			),
			"未发现明显缺少引用的强论断。",
		),
		"",
		"## 3. 引用可能不支持的位置",
		"",
		...formatList(
			result.unsupportedCitations.map(
				(issue) =>
					`【${issue.sectionHeading}】${issue.text}\n  - 引用：${issue.citationKey}\n  - 状态：${issue.status}\n  - 原因：${issue.reason}`,
			),
			"未发现可疑引用支持关系；仍需人工核对关键论断。",
		),
		"",
		"## 4. 相关工作覆盖不足的位置",
		"",
		...formatList(
			result.coverageGaps.map(
				(issue) =>
					`【${issue.sectionHeading}】${issue.text}\n  - 原因：${issue.reason}\n  - 建议：${issue.suggestion}`,
			),
			"未发现明显相关工作覆盖不足。",
		),
		"",
		"## 5. 过旧引用",
		"",
		...formatList(
			result.outdatedCitations.map(
				(issue) => `- ${issue.citationKey}（推断年份：${issue.inferredYear}）：${issue.reason}`,
			),
			"未发现明显过旧引用。",
		),
		"",
		"## 6. 建议补充的新论文",
		"",
		...suggestedPaperLines,
		"## 7. BibTeX 建议",
		"",
		result.bibtexSuggestions.trim()
			? ["```bibtex", result.bibtexSuggestions.trim(), "```"].join("\n")
			: "暂无 BibTeX 建议。不要虚构引用。",
		"",
		"## 8. 修改建议",
		"",
		...formatList(
			[
				"优先为摘要、引言和相关工作中的强论断补充直接支持引用。",
				"对标记为“需要人工确认”的句子逐条核对原论文是否真的支持该表述。",
				"用近三到五年的直接相关工作更新过旧背景引用。",
				"检查 Markdown/Pandoc、LaTeX 或目标期刊要求的引用格式一致性。",
				"只引用已经精读并能支持原句的论文，不要为了凑数量加入无关引用。",
			],
			"暂无修改建议。",
		),
		...(result.searchWarnings.length > 0
			? ["", "检索提示：", "", ...result.searchWarnings.map((warning) => `- ${warning}`)]
			: []),
	].join("\n");
}

export async function checkCitations(options: CitationCheckOptions): Promise<CitationCheckResult> {
	const parsed = parseCitationCheckInput(options.input);
	const filePath = resolveDraftPath(options.cwd, options.input);
	const format = detectFormat(filePath);
	const rawContent = await readDraftFile(filePath);
	const latex = format === "latex" ? await parseLatexDraftProject(filePath) : undefined;
	const content = latex?.expandedContent ?? rawContent;
	const plainContent = format === "latex" ? latexToPlainText(content) : content;
	const sections = format === "latex" ? parseLatexSections(content) : parseMarkdownSections(content);
	const citationKeys = extractCitationKeys(content, latex);
	const limit = options.limit ?? parsed.limit ?? DEFAULT_LIMIT;
	const searchQuery = buildSearchQuery(sections);
	const searchResult = await searchPapers({
		input: searchQuery,
		topic: searchQuery,
		limit,
		yearFrom: CURRENT_YEAR - 4,
		fetcher: options.fetcher,
		apiKey: options.apiKey,
		signal: options.signal,
		logger: options.logger,
	});
	const suggestedPapers = searchResult.papers.slice(0, limit);
	const resultWithoutMarkdown = {
		filePath,
		format,
		citationKeys,
		missingCitations: findMissingCitations(sections),
		unsupportedCitations: findUnsupportedCitations(sections),
		coverageGaps: findCoverageGaps(sections, citationKeys, suggestedPapers),
		outdatedCitations: findOutdatedCitations(citationKeys),
		formatIssues: findFormatIssues(plainContent, citationKeys),
		suggestedPapers,
		bibtexSuggestions: buildBibtexForPapers(suggestedPapers.map(paperSearchToBibtexPaper)),
		searchQuery,
		searchWarnings: searchResult.warnings,
		...(latex ? { latex } : {}),
	};

	return { ...resultWithoutMarkdown, markdown: buildCitationCheckMarkdown(resultWithoutMarkdown) };
}
