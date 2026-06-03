import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { type LatexDraftAnalysis, latexToPlainText, parseLatexDraftProject } from "./latex-draft.ts";
import { searchZoteroLibrary, type ZoteroConfig, type ZoteroFetchLike, type ZoteroItem } from "./zotero.ts";

export type DraftFormat = "markdown" | "latex" | "text";

export type DraftSectionKind =
	| "title"
	| "abstract"
	| "introduction"
	| "related_work"
	| "method"
	| "experiments"
	| "conclusion"
	| "references"
	| "other";

export type ReviewDecision =
	| "Strong Accept"
	| "Accept"
	| "Weak Accept"
	| "Borderline"
	| "Weak Reject"
	| "Reject"
	| "Strong Reject";

export interface ParsedReviewInput {
	filePath: string;
	target?: string;
}

export interface DraftSection {
	heading: string;
	kind: DraftSectionKind;
	text: string;
	startChar: number;
	endChar: number;
}

export interface DraftChunkReview {
	index: number;
	sectionHeading: string;
	sectionKind: DraftSectionKind;
	textPreview: string;
	strengths: string[];
	weaknesses: string[];
	priority: "高" | "中" | "低";
}

export interface CitationCoverageCheck {
	configured: boolean;
	query: string;
	citationKeys: string[];
	matchedItems: ZoteroItem[];
	warnings: string[];
	possibleMissingReferences: string[];
}

export interface ReviewDraftResult {
	filePath: string;
	target: string;
	format: DraftFormat;
	sections: DraftSection[];
	latex?: LatexDraftAnalysis;
	citationCheck: CitationCoverageCheck;
	chunkReviews: DraftChunkReview[];
	sectionCoverage: Record<DraftSectionKind, boolean>;
	majorWeaknesses: string[];
	minorWeaknesses: string[];
	reviewerQuestions: string[];
	revisionPriorities: string[];
	decision: ReviewDecision;
	markdown: string;
}

export interface ReviewDraftOptions {
	cwd: string;
	input: string;
	maxChunkChars?: number;
	zoteroConfig?: ZoteroConfig;
	fetcher?: ZoteroFetchLike;
	signal?: AbortSignal;
}

const DEFAULT_TARGET = "未指定投稿目标";
const DEFAULT_MAX_CHUNK_CHARS = 5_000;

const decisionOptions: ReviewDecision[] = [
	"Strong Accept",
	"Accept",
	"Weak Accept",
	"Borderline",
	"Weak Reject",
	"Reject",
	"Strong Reject",
];

function parseKeyValue(input: string, key: string): string | undefined {
	const pattern = new RegExp(`${key}=("([^"]+)"|'([^']+)'|([^\\s]+))`, "i");
	const match = input.match(pattern);
	return match?.[2] ?? match?.[3] ?? match?.[4];
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
		.replace(/\b(?:file|path|draft|target)=("[^"]+"|'[^']+'|[^\s]+)/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function parseReviewInput(input: string): ParsedReviewInput {
	const normalized = input
		.trim()
		.replace(/^\/review\b/i, "")
		.trim();
	const filePath =
		parseKeyValue(normalized, "file") ?? parseKeyValue(normalized, "path") ?? parseKeyValue(normalized, "draft");
	const target = parseKeyValue(normalized, "target");
	return {
		filePath: stripOuterQuotes(filePath ?? removeKnownArguments(normalized)),
		...(target ? { target: stripOuterQuotes(target) } : {}),
	};
}

function resolveDraftPath(cwd: string, input: string): string {
	const parsed = parseReviewInput(input);
	return isAbsolute(parsed.filePath) ? parsed.filePath : resolve(cwd, parsed.filePath);
}

function detectFormat(filePath: string): DraftFormat {
	const extension = extname(filePath).toLowerCase();
	if (extension === ".md" || extension === ".markdown") return "markdown";
	if (extension === ".tex" || extension === ".latex") return "latex";
	if (extension === ".txt") return "text";
	throw new Error(`仅支持 Markdown、LaTeX 或 TXT 草稿：${filePath}`);
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

function normalizeWhitespace(text: string): string {
	return text
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{4,}/g, "\n\n\n")
		.trim();
}

function sectionKindFromHeading(heading: string): DraftSectionKind {
	const lower = heading.toLowerCase();
	if (/title|题目/.test(lower)) return "title";
	if (/abstract|摘要/.test(lower)) return "abstract";
	if (/introduction|引言|绪论/.test(lower)) return "introduction";
	if (/related|background|相关工作|文献综述/.test(lower)) return "related_work";
	if (/method|approach|model|方法|模型|算法/.test(lower)) return "method";
	if (/experiment|evaluation|result|实验|评估|结果|消融/.test(lower)) return "experiments";
	if (/conclusion|discussion|结论|讨论/.test(lower)) return "conclusion";
	if (/reference|bibliography|引用|参考文献/.test(lower)) return "references";
	return "other";
}

function pushSection(
	sections: DraftSection[],
	heading: string,
	text: string,
	startChar: number,
	endChar: number,
): void {
	const cleanText = normalizeWhitespace(text);
	if (!cleanText) return;
	sections.push({
		heading,
		kind: sectionKindFromHeading(heading),
		text: cleanText,
		startChar,
		endChar,
	});
}

export function parseMarkdownSections(content: string): DraftSection[] {
	const normalized = normalizeWhitespace(content);
	const matches = Array.from(normalized.matchAll(/^#{1,6}\s+(.+)$/gm));
	if (matches.length === 0) {
		return [
			{
				heading: "全文",
				kind: "other",
				text: normalized,
				startChar: 0,
				endChar: normalized.length,
			},
		];
	}

	const sections: DraftSection[] = [];
	for (const [index, match] of matches.entries()) {
		const heading = (match[1] ?? "未命名章节").trim();
		const start = match.index ?? 0;
		const end = matches[index + 1]?.index ?? normalized.length;
		const text = normalized
			.slice(start, end)
			.replace(/^#{1,6}\s+.+$/m, "")
			.trim();
		pushSection(sections, heading, text, start, end);
	}
	return sections;
}

export function parseLatexSections(content: string): DraftSection[] {
	const normalized = normalizeWhitespace(content);
	const markers: Array<{ heading: string; index: number; markerLength: number }> = [];
	const abstractMatch = normalized.match(/\\begin\{abstract\}/i);
	if (abstractMatch?.index !== undefined) {
		markers.push({ heading: "Abstract", index: abstractMatch.index, markerLength: abstractMatch[0].length });
	}

	for (const match of normalized.matchAll(/\\(?:section|subsection)\*?\{([^}]*)\}/gi)) {
		markers.push({
			heading: match[1]?.trim() || "未命名章节",
			index: match.index ?? 0,
			markerLength: match[0].length,
		});
	}

	markers.sort((a, b) => a.index - b.index);
	if (markers.length === 0) {
		return [
			{
				heading: "全文",
				kind: "other",
				text: latexToPlainText(normalized),
				startChar: 0,
				endChar: normalized.length,
			},
		];
	}

	const sections: DraftSection[] = [];
	for (const [index, marker] of markers.entries()) {
		const end = markers[index + 1]?.index ?? normalized.length;
		const rawText = normalized.slice(marker.index + marker.markerLength, end);
		const text =
			sectionKindFromHeading(marker.heading) === "abstract" ? rawText.replace(/\\end\{abstract\}/i, "") : rawText;
		pushSection(sections, marker.heading, latexToPlainText(text), marker.index, end);
	}
	return sections;
}

function parseDraftSections(content: string, format: DraftFormat): DraftSection[] {
	if (format === "markdown") return parseMarkdownSections(content);
	if (format === "latex") return parseLatexSections(content);
	return [
		{
			heading: "全文",
			kind: "other",
			text: normalizeWhitespace(content),
			startChar: 0,
			endChar: content.length,
		},
	];
}

function splitSectionIntoChunks(section: DraftSection, maxChunkChars: number): string[] {
	if (section.text.length <= maxChunkChars) return [section.text];
	const paragraphs = section.text
		.split(/\n{2,}/u)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
	const chunks: string[] = [];
	let current = "";
	for (const paragraph of paragraphs) {
		if (paragraph.length > maxChunkChars) {
			if (current) {
				chunks.push(current);
				current = "";
			}
			for (let offset = 0; offset < paragraph.length; offset += maxChunkChars) {
				chunks.push(paragraph.slice(offset, offset + maxChunkChars));
			}
			continue;
		}
		const next = current ? `${current}\n\n${paragraph}` : paragraph;
		if (next.length > maxChunkChars) {
			chunks.push(current);
			current = paragraph;
		} else {
			current = next;
		}
	}
	if (current) chunks.push(current);
	return chunks.length > 0 ? chunks : [section.text.slice(0, maxChunkChars)];
}

function containsAny(text: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(text));
}

function reviewChunk(section: DraftSection, text: string, index: number): DraftChunkReview {
	const lower = text.toLowerCase();
	const strengths: string[] = [];
	const weaknesses: string[] = [];

	if (section.kind === "abstract") {
		if (containsAny(lower, [/problem|challenge|研究|问题/u]) && containsAny(lower, [/propose|method|提出|方法/u])) {
			strengths.push("摘要覆盖了问题背景和方法方向。");
		} else {
			weaknesses.push("摘要需要更明确地交代问题、方法、结果和贡献。");
		}
	}
	if (section.kind === "method") {
		if (containsAny(lower, [/algorithm|module|loss|framework|公式|模块|流程/u])) {
			strengths.push("方法部分包含可审查的模块或流程线索。");
		} else {
			weaknesses.push("方法描述偏概念化，需要补充算法流程、关键模块和训练目标。");
		}
	}
	if (section.kind === "experiments") {
		if (containsAny(lower, [/baseline|compare|指标|metric|auroc|accuracy|ablation|消融/u])) {
			strengths.push("实验部分包含 baseline、指标或消融实验线索。");
		} else {
			weaknesses.push("实验部分需要明确数据集、baseline、评价指标和消融实验。");
		}
	}
	if (section.kind === "related_work") {
		if (containsAny(lower, [/patchcore|padim|related|已有|相关/u])) {
			strengths.push("相关工作部分已经覆盖部分已有方法。");
		} else {
			weaknesses.push("相关工作需要更系统地覆盖直接竞争方法和最新工作。");
		}
	}

	if (text.length < 300 && section.kind !== "title") {
		weaknesses.push("该章节篇幅较短，论证密度可能不足。");
	}
	if (strengths.length === 0) strengths.push("该片段提供了评审所需的基础信息。");

	return {
		index,
		sectionHeading: section.heading,
		sectionKind: section.kind,
		textPreview: text.slice(0, 500),
		strengths,
		weaknesses,
		priority: weaknesses.length >= 2 ? "高" : weaknesses.length === 1 ? "中" : "低",
	};
}

function buildChunkReviews(sections: DraftSection[], maxChunkChars: number): DraftChunkReview[] {
	const reviews: DraftChunkReview[] = [];
	for (const section of sections) {
		for (const chunk of splitSectionIntoChunks(section, maxChunkChars)) {
			reviews.push(reviewChunk(section, chunk, reviews.length + 1));
		}
	}
	return reviews;
}

function buildCoverage(sections: DraftSection[]): Record<DraftSectionKind, boolean> {
	const coverage = {
		title: false,
		abstract: false,
		introduction: false,
		related_work: false,
		method: false,
		experiments: false,
		conclusion: false,
		references: false,
		other: false,
	};
	for (const section of sections) coverage[section.kind] = true;
	return coverage;
}

function buildMajorWeaknesses(coverage: Record<DraftSectionKind, boolean>, chunkReviews: DraftChunkReview[]): string[] {
	const weaknesses: string[] = [];
	if (!coverage.abstract) weaknesses.push("缺少摘要或摘要无法识别，影响评审人快速判断贡献。");
	if (!coverage.introduction) weaknesses.push("缺少引言或问题定义不清，研究动机和贡献边界不足。");
	if (!coverage.related_work) weaknesses.push("缺少相关工作或相关工作覆盖不足，创新性论证风险较高。");
	if (!coverage.method) weaknesses.push("缺少方法部分或方法细节不足，技术正确性难以判断。");
	if (!coverage.experiments) weaknesses.push("缺少实验部分或实验设计不足，结论支撑不充分。");

	const highPriority = chunkReviews.filter((review) => review.priority === "高").slice(0, 3);
	for (const review of highPriority) {
		weaknesses.push(`${review.sectionHeading}：${review.weaknesses[0]}`);
	}

	return Array.from(new Set(weaknesses)).slice(0, 8);
}

function buildMinorWeaknesses(coverage: Record<DraftSectionKind, boolean>, target: string): string[] {
	const weaknesses = [
		"需要统一术语、缩写、图表引用和指标命名。",
		"需要补充更明确的贡献列表，并避免摘要、引言和结论重复表达。",
		"需要检查引用格式是否符合目标 venue 或期刊要求。",
	];
	if (!coverage.references) weaknesses.push("未识别到参考文献部分，需要补充引用完整性检查。");
	if (/中文/u.test(target)) weaknesses.push("中文投稿需特别检查术语译名、中文摘要和参考文献格式。");
	return weaknesses;
}

function chooseDecision(coverage: Record<DraftSectionKind, boolean>, majorWeaknesses: string[]): ReviewDecision {
	const missingCore = ["abstract", "introduction", "related_work", "method", "experiments"].filter(
		(kind) => !coverage[kind as DraftSectionKind],
	).length;
	if (missingCore >= 4) return "Reject";
	if (missingCore >= 2) return "Weak Reject";
	if (majorWeaknesses.length >= 5) return "Weak Reject";
	if (majorWeaknesses.length >= 3) return "Borderline";
	if (majorWeaknesses.length >= 1) return "Weak Accept";
	return "Accept";
}

function getSectionText(sections: DraftSection[], kind: DraftSectionKind): string | undefined {
	return sections.find((section) => section.kind === kind)?.text;
}

function shortEvaluation(text: string | undefined, fallback: string, positive: string): string {
	if (!text) return fallback;
	if (text.length < 300) return `${fallback} 当前内容偏短，需要展开论证。`;
	return positive;
}

function formatList(items: string[], fallback: string): string[] {
	return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function buildLatexStructureReview(latex: LatexDraftAnalysis | undefined): string[] {
	if (!latex) return [];
	const unlabeledFormulaCount = latex.formulas.filter((formula) => !formula.label).length;
	const figuresWithoutCaption = latex.figures.filter((figure) => !figure.caption).length;
	const tablesWithoutCaption = latex.tables.filter((table) => !table.caption).length;
	const unresolvedRefs = latex.refs.filter((ref) => !latex.labels.includes(ref));
	const appendixHeadings = latex.appendixSections.map((section) => section.heading);

	return [
		"### LaTeX 结构审查",
		"",
		`- 已展开文件：${latex.files.length}`,
		`- 自定义宏：${latex.macros.length > 0 ? latex.macros.map((macro) => `\\${macro.name}`).join(", ") : "未识别"}`,
		`- 公式块：${latex.formulas.length}${unlabeledFormulaCount > 0 ? `（${unlabeledFormulaCount} 个缺少 label）` : ""}`,
		`- 图环境：${latex.figures.length}${figuresWithoutCaption > 0 ? `（${figuresWithoutCaption} 个缺少 caption）` : ""}`,
		`- 表环境：${latex.tables.length}${tablesWithoutCaption > 0 ? `（${tablesWithoutCaption} 个缺少 caption）` : ""}`,
		`- 附录章节：${appendixHeadings.length > 0 ? appendixHeadings.join(", ") : "未识别"}`,
		`- 引用键数量：${latex.citations.length}`,
		`- label/ref 状态：${unresolvedRefs.length > 0 ? `存在未匹配引用 ${unresolvedRefs.join(", ")}` : "未发现明显未匹配引用"}`,
		...(latex.warnings.length > 0 ? ["- 解析警告：", ...latex.warnings.map((warning) => `  - ${warning}`)] : []),
		"",
	];
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
	return Array.from(keys).slice(0, 100);
}

function extractReviewQuery(sections: DraftSection[]): string {
	const source = [
		sections.find((section) => section.kind === "title")?.heading,
		sections.find((section) => section.kind === "abstract")?.text,
		sections.find((section) => section.kind === "related_work")?.text,
	]
		.filter(Boolean)
		.join(" ");
	const stopWords = new Set(["about", "and", "for", "from", "method", "paper", "study", "the", "this", "with"]);
	const keywords = source
		.normalize("NFKC")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word.length >= 4 && !stopWords.has(word) && !/^\d+$/.test(word));
	return Array.from(new Set(keywords)).slice(0, 10).join(" ") || "paper draft related work";
}

async function checkCitationCoverage(options: {
	content: string;
	sections: DraftSection[];
	latex?: LatexDraftAnalysis;
	zoteroConfig?: ZoteroConfig;
	fetcher?: ZoteroFetchLike;
	signal?: AbortSignal;
}): Promise<CitationCoverageCheck> {
	const citationKeys =
		options.latex?.citations && options.latex.citations.length > 0
			? options.latex.citations
			: extractMarkdownCitationKeys(options.content);
	const query = extractReviewQuery(options.sections);
	const zotero = await searchZoteroLibrary({
		query,
		limit: 8,
		config: options.zoteroConfig,
		fetcher: options.fetcher,
		signal: options.signal,
	});
	const normalizedContent = options.content.normalize("NFKC").toLowerCase();
	const possiblyMissing = zotero.items
		.filter((item) => !normalizedContent.includes(item.title.normalize("NFKC").toLowerCase().slice(0, 80)))
		.slice(0, 5)
		.map((item) => `Zotero 中存在相关文献《${item.title}》，草稿中未明显引用或讨论。`);
	const possibleMissingReferences = [
		...(citationKeys.length < 3 ? ["草稿中显式 citation key 较少，相关工作覆盖可能不足。"] : []),
		...(zotero.configured && zotero.items.length === 0
			? ["已检索 Zotero 文献库但未命中相关条目，需要人工确认关键词或文献库完整性。"]
			: []),
		...possiblyMissing,
	];

	return {
		configured: zotero.configured,
		query,
		citationKeys,
		matchedItems: zotero.items,
		warnings: zotero.warnings,
		possibleMissingReferences,
	};
}

function buildCitationCoverageReview(citationCheck: CitationCoverageCheck): string[] {
	return [
		"### Zotero 引用完整性检查",
		"",
		`- Zotero 状态：${citationCheck.configured ? "已配置并尝试检索" : "未配置或配置不完整，已跳过"}`,
		`- Zotero 检索式：${citationCheck.query}`,
		`- 草稿显式 citation key 数量：${citationCheck.citationKeys.length}`,
		`- Zotero 相关命中文献：${citationCheck.matchedItems.length}`,
		...(citationCheck.matchedItems.length > 0
			? citationCheck.matchedItems
					.slice(0, 5)
					.map((item) => `  - ${item.title}${item.year ? `（${item.year}）` : ""}`)
			: []),
		...(citationCheck.possibleMissingReferences.length > 0
			? ["- 可能缺失或需要人工确认的引用：", ...citationCheck.possibleMissingReferences.map((item) => `  - ${item}`)]
			: ["- 未发现明显 Zotero 引用缺口，但仍需人工核对目标领域最新工作。"]),
		...(citationCheck.warnings.length > 0
			? ["- Zotero 检索提示：", ...citationCheck.warnings.map((warning) => `  - ${warning}`)]
			: []),
		"",
	];
}

function buildMarkdownReport(result: Omit<ReviewDraftResult, "markdown">): string {
	const abstract = getSectionText(result.sections, "abstract");
	const introduction = getSectionText(result.sections, "introduction");
	const relatedWork = getSectionText(result.sections, "related_work");
	const method = getSectionText(result.sections, "method");
	const experiments = getSectionText(result.sections, "experiments");
	const conclusion = getSectionText(result.sections, "conclusion");

	const hasAblation = containsAny(experiments ?? "", [/ablation|消融/i]);
	const hasBaseline = containsAny(experiments ?? "", [/baseline|compare|对比|比较/i]);
	const hasMetric = containsAny(experiments ?? "", [/metric|AUROC|AUC|F1|PRO|指标/i]);

	return [
		"# 论文草稿模拟评审报告",
		"",
		`投稿目标：${result.target}`,
		`草稿文件：${result.filePath}`,
		`草稿格式：${result.format}`,
		`自动按章节分块数：${result.chunkReviews.length}`,
		"",
		"## 1. 总体评价",
		"",
		`该草稿具备初步论文结构，当前模拟结论为 **${result.decision}**。主要风险集中在创新性论证、实验充分性和相关工作覆盖是否能满足 ${result.target} 的审稿标准。`,
		"",
		"## 2. 摘要评价",
		"",
		shortEvaluation(
			abstract,
			"未识别到摘要。摘要需要明确问题、方法、结果和贡献。",
			"摘要提供了论文主题线索，但仍需确认是否包含定量结果和清晰贡献。",
		),
		"",
		"## 3. 引言评价",
		"",
		shortEvaluation(
			introduction,
			"未识别到引言。需要补充研究背景、问题定义、挑战和贡献列表。",
			"引言已覆盖研究背景，但需要进一步强化问题边界、失败案例和贡献声明。",
		),
		"",
		"## 4. 相关工作评价",
		"",
		shortEvaluation(
			relatedWork,
			"未识别到相关工作。创新性论证会受到直接影响。",
			"相关工作已有基础，但需要覆盖最新直接竞争方法，并清楚说明差异。",
		),
		"",
		"## 5. 方法部分评价",
		"",
		shortEvaluation(
			method,
			"未识别到方法部分。技术正确性和可复现性无法评估。",
			"方法部分提供了基本技术路线，但需要补充算法步骤、关键公式、训练细节和复杂度分析。",
		),
		"",
		"## 6. 实验部分评价",
		"",
		shortEvaluation(
			experiments,
			"未识别到实验部分。当前结论缺少实证支撑。",
			`实验部分已有基础。baseline：${hasBaseline ? "已出现" : "不足"}；指标：${hasMetric ? "已出现" : "不足"}；消融：${hasAblation ? "已出现" : "不足"}。`,
		),
		"",
		"## 7. 结论部分评价",
		"",
		shortEvaluation(
			conclusion,
			"未识别到结论。需要总结贡献、局限和未来工作。",
			"结论能概括方向，但建议补充方法边界、失败场景和下一步工作。",
		),
		"",
		"## 8. 创新性评价",
		"",
		result.sectionCoverage.related_work
			? "创新性目前取决于与最相似工作的差异是否足够明确。建议增加 novelty table。"
			: "相关工作不足导致创新性风险较高，审稿人可能认为贡献边界不清。",
		"",
		"## 9. 技术正确性评价",
		"",
		result.sectionCoverage.method
			? "技术路线可以初步审查，但仍需补充假设、公式、算法流程和失败条件。"
			: "缺少方法细节，技术正确性无法充分判断。",
		"",
		"## 10. 实验充分性评价",
		"",
		result.sectionCoverage.experiments
			? "实验已有初步结构，但需要确认数据集、baseline、指标、消融和统计稳定性是否完整。"
			: "缺少实验，当前不具备支撑论文主张的证据。",
		"",
		"## 11. 写作质量评价",
		"",
		"写作需要重点检查术语一致性、贡献表达、章节衔接、图表引用和目标投稿格式。",
		"",
		"## 12. 引用和相关工作完整性评价",
		"",
		result.sectionCoverage.references
			? "已识别参考文献部分，但仍需检查是否覆盖最近三年和直接竞争方法。"
			: "未识别参考文献部分，引用完整性风险较高。",
		"",
		...buildCitationCoverageReview(result.citationCheck),
		"## 13. 可复现性评价",
		"",
		"建议补充数据划分、训练超参数、代码链接、环境配置、随机种子、模型选择策略和硬件信息。",
		"",
		...buildLatexStructureReview(result.latex),
		"",
		"## 14. 主要问题 Major Weaknesses",
		"",
		...formatList(result.majorWeaknesses, "未发现明显 major weakness，但仍需人工复核。"),
		"",
		"## 15. 次要问题 Minor Weaknesses",
		"",
		...formatList(result.minorWeaknesses, "未发现明显 minor weakness。"),
		"",
		"## 16. 审稿人可能提问",
		"",
		...formatList(result.reviewerQuestions, "暂无。"),
		"",
		"## 17. 修改优先级",
		"",
		...formatList(result.revisionPriorities, "暂无。"),
		"",
		"## 18. 模拟审稿结论",
		"",
		"从以下选项中选择：",
		"",
		...decisionOptions.map((option) => `- ${option}${option === result.decision ? " ← 当前模拟结论" : ""}`),
		"",
		"## 19. 修改建议清单",
		"",
		"- 先补齐缺失章节，再优化局部表达。",
		"- 增加一张与最相似工作的差异对比表。",
		"- 补充强 baseline、公平比较设置、消融实验和失败案例。",
		"- 补充可复现性细节，包括数据、代码、参数和随机种子。",
		"- 按目标投稿格式检查摘要、图表、引用和附录。",
	].join("\n");
}

function buildReviewerQuestions(
	coverage: Record<DraftSectionKind, boolean>,
	target: string,
	latex: LatexDraftAnalysis | undefined,
): string[] {
	const questions = [
		"本文相对最接近工作的核心新增贡献是什么？",
		coverage.method ? "方法中的关键假设在什么情况下会失败？" : "缺少方法细节，如何判断技术正确性？",
		coverage.experiments ? "实验设置是否与 baseline 公平，是否存在调参偏差？" : "没有实验时，结论如何成立？",
		"数据集是否覆盖真实部署场景，是否有跨域或跨数据集验证？",
		`为什么该工作适合投向 ${target}？`,
	];
	if (latex && latex.formulas.length > 0) questions.push("公式中的符号、假设和损失项是否在正文中逐一定义？");
	if (latex && latex.figures.length > 0) questions.push("图是否都在正文中被引用，caption 是否足以支撑读者理解？");
	return questions;
}

function buildRevisionPriorities(
	majorWeaknesses: string[],
	coverage: Record<DraftSectionKind, boolean>,
	latex: LatexDraftAnalysis | undefined,
): string[] {
	const priorities: string[] = [];
	if (majorWeaknesses.length > 0) priorities.push(`P0：先解决 ${majorWeaknesses[0]}`);
	if (!coverage.related_work) priorities.push("P0：补齐相关工作和创新性对比。");
	if (!coverage.experiments) priorities.push("P0：补齐实验设计、baseline、指标和消融。");
	if (!coverage.method) priorities.push("P1：补齐方法流程、公式和训练细节。");
	if (latex && latex.warnings.length > 0) priorities.push("P1：处理 LaTeX 解析警告，确认宏、子文件和引用关系完整。");
	if (latex?.formulas.some((formula) => !formula.label)) priorities.push("P2：为关键公式补充 label 和正文引用。");
	priorities.push("P1：重写摘要和引言贡献列表，使问题、方法、结果闭环。");
	priorities.push("P2：统一格式、术语、引用和图表说明。");
	return Array.from(new Set(priorities)).slice(0, 8);
}

export async function reviewDraft(options: ReviewDraftOptions): Promise<ReviewDraftResult> {
	const parsed = parseReviewInput(options.input);
	const filePath = resolveDraftPath(options.cwd, options.input);
	const format = detectFormat(filePath);
	const rawContent = await readDraftFile(filePath);
	const latex = format === "latex" ? await parseLatexDraftProject(filePath) : undefined;
	const content = latex?.expandedContent ?? rawContent;
	const sections = parseDraftSections(content, format);
	const citationCheck = await checkCitationCoverage({
		content,
		sections,
		latex,
		zoteroConfig: options.zoteroConfig,
		fetcher: options.fetcher,
		signal: options.signal,
	});
	const chunkReviews = buildChunkReviews(sections, options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS);
	const sectionCoverage = buildCoverage(sections);
	const target = parsed.target ?? DEFAULT_TARGET;
	const majorWeaknesses = buildMajorWeaknesses(sectionCoverage, chunkReviews);
	const minorWeaknesses = buildMinorWeaknesses(sectionCoverage, target);
	const reviewerQuestions = buildReviewerQuestions(sectionCoverage, target, latex);
	const revisionPriorities = buildRevisionPriorities(majorWeaknesses, sectionCoverage, latex);
	const decision = chooseDecision(sectionCoverage, majorWeaknesses);
	const resultWithoutMarkdown = {
		filePath,
		target,
		format,
		sections,
		...(latex ? { latex } : {}),
		citationCheck,
		chunkReviews,
		sectionCoverage,
		majorWeaknesses,
		minorWeaknesses,
		reviewerQuestions,
		revisionPriorities,
		decision,
	};

	return { ...resultWithoutMarkdown, markdown: buildMarkdownReport(resultWithoutMarkdown) };
}
