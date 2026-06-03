import { open, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { PDFParse } from "pdf-parse";

export interface PdfParseResult {
	text: string;
	totalPages: number;
	info?: Record<string, unknown>;
}

export type PdfParseAdapter = (filePath: string, signal?: AbortSignal) => Promise<PdfParseResult>;

export interface PaperMetadata {
	title?: string;
	authors: string[];
	year?: number;
	venue?: string;
	url?: string;
	doi?: string;
	totalPages: number;
}

export interface PaperSection {
	heading: string;
	text: string;
	startChar: number;
	endChar: number;
}

export interface TextChunk {
	index: number;
	text: string;
	startChar: number;
	endChar: number;
}

export interface ChunkSummary {
	index: number;
	summary: string;
	charCount: number;
}

export interface PaperAnalysisResult {
	filePath: string;
	metadata: PaperMetadata;
	abstract?: string;
	sections: PaperSection[];
	chunks: TextChunk[];
	chunkSummaries: ChunkSummary[];
	textCharCount: number;
	markdown: string;
}

export interface AnalyzePaperPdfOptions {
	cwd: string;
	input: string;
	parsePdf?: PdfParseAdapter;
	signal?: AbortSignal;
	maxChunkChars?: number;
	maxChunkSummaries?: number;
}

const DEFAULT_MAX_CHUNK_CHARS = 6_000;
const DEFAULT_MAX_CHUNK_SUMMARIES = 14;

const sectionHeadingPattern =
	/^(?:\d+(?:\.\d+)*\s+)?(abstract|introduction|related work|background|method|methodology|approach|model|experiments?|evaluation|results?|discussion|conclusion|references|appendix|ablation(?: study)?)(?:\s.*)?$/i;

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

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

export function parsePaperPathInput(input: string): string {
	const normalized = input
		.trim()
		.replace(/^\/paper\b/i, "")
		.trim();
	const keyed =
		parseKeyValue(normalized, "path") ?? parseKeyValue(normalized, "pdf") ?? parseKeyValue(normalized, "file");
	return stripOuterQuotes(keyed ?? normalized);
}

function resolvePdfPath(cwd: string, input: string): string {
	const parsed = parsePaperPathInput(input);
	return isAbsolute(parsed) ? parsed : resolve(cwd, parsed);
}

async function assertReadablePdf(filePath: string): Promise<void> {
	const fileStat = await stat(filePath).catch(() => {
		throw new Error(`PDF 文件不存在：${filePath}`);
	});

	if (!fileStat.isFile()) {
		throw new Error(`输入路径不是文件：${filePath}`);
	}

	if (extname(filePath).toLowerCase() !== ".pdf") {
		throw new Error(`输入文件不是 PDF：${filePath}`);
	}

	const handle = await open(filePath, "r");
	try {
		const headerBuffer = Buffer.alloc(5);
		await handle.read(headerBuffer, 0, 5, 0);
		if (!headerBuffer.toString("utf8").startsWith("%PDF-")) {
			throw new Error(`PDF 文件头无效，无法确认这是标准 PDF：${filePath}`);
		}
	} finally {
		await handle.close();
	}
}

export async function parsePdfWithPdfParse(filePath: string): Promise<PdfParseResult> {
	const fileBuffer = await readFile(filePath);
	const data = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
	const parser = new PDFParse({ data });

	try {
		const infoResult = await parser.getInfo().catch(() => undefined);
		const textResult = await parser.getText();
		return {
			text: textResult.text,
			totalPages: textResult.total || infoResult?.total || 0,
			info: infoResult?.info as Record<string, unknown> | undefined,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`PDF 无法解析：${message}`);
	} finally {
		await parser.destroy().catch(() => undefined);
	}
}

function normalizeExtractedText(text: string): string {
	return text
		.replace(/\r/g, "")
		.replace(/-\n(?=[a-z])/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

export function chunkText(text: string, maxChunkChars = DEFAULT_MAX_CHUNK_CHARS): TextChunk[] {
	const normalized = normalizeExtractedText(text);
	const chunks: TextChunk[] = [];
	const paragraphs = normalized
		.split(/\n{2,}/u)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
	let current = "";
	let startChar = 0;
	let cursor = 0;

	const pushCurrent = () => {
		if (!current.trim()) return;
		chunks.push({
			index: chunks.length + 1,
			text: current.trim(),
			startChar,
			endChar: startChar + current.trim().length,
		});
		current = "";
	};

	for (const paragraph of paragraphs) {
		if (paragraph.length > maxChunkChars) {
			pushCurrent();
			for (let offset = 0; offset < paragraph.length; offset += maxChunkChars) {
				const textPart = paragraph.slice(offset, offset + maxChunkChars).trim();
				if (!textPart) continue;
				chunks.push({
					index: chunks.length + 1,
					text: textPart,
					startChar: cursor + offset,
					endChar: cursor + offset + textPart.length,
				});
			}
			cursor += paragraph.length + 2;
			startChar = cursor;
			continue;
		}

		const next = current ? `${current}\n\n${paragraph}` : paragraph;
		if (next.length > maxChunkChars) {
			pushCurrent();
			startChar = cursor;
			current = paragraph;
		} else {
			current = next;
		}
		cursor += paragraph.length + 2;
	}

	pushCurrent();
	return chunks;
}

function normalizeHeading(line: string): string {
	const withoutNumber = line.replace(/^\d+(?:\.\d+)*\s+/, "").trim();
	return withoutNumber.replace(/\s+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function identifySections(text: string): PaperSection[] {
	const normalized = normalizeExtractedText(text);
	const lines = normalized.split("\n");
	const headings: Array<{ heading: string; startChar: number }> = [];
	let offset = 0;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length <= 90 && sectionHeadingPattern.test(trimmed)) {
			headings.push({ heading: normalizeHeading(trimmed), startChar: offset });
		}
		offset += line.length + 1;
	}

	return headings.map((heading, index) => {
		const endChar = headings[index + 1]?.startChar ?? normalized.length;
		return {
			heading: heading.heading,
			text: normalized.slice(heading.startChar, endChar).trim(),
			startChar: heading.startChar,
			endChar,
		};
	});
}

function extractFirstLines(text: string, count: number): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length >= 4 && !/^\d+$/.test(line))
		.slice(0, count);
}

function extractDoi(text: string): string | undefined {
	const match = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
	return match?.[0]?.replace(/[),.;\]]+$/u, "");
}

function extractUrl(text: string): string | undefined {
	const match = text.match(/https?:\/\/[^\s)>\]]+/i);
	return match?.[0]?.replace(/[),.;\]]+$/u, "");
}

function extractYear(text: string, info?: Record<string, unknown>): number | undefined {
	const infoValues = [info?.CreationDate, info?.ModDate, info?.creationDate, info?.modDate]
		.map((value) => asString(value))
		.filter(Boolean)
		.join(" ");
	const source = `${infoValues}\n${text.slice(0, 8_000)}`;
	const matches = Array.from(source.matchAll(/\b(19[8-9]\d|20[0-3]\d)\b/g))
		.map((match) => Number.parseInt(match[1] ?? "", 10))
		.filter(Number.isFinite);
	return matches[0];
}

function splitAuthors(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(/\s*(?:;|,|\band\b|、|，)\s*/iu)
		.map((author) => author.trim())
		.filter((author) => author.length >= 2)
		.slice(0, 12);
}

function inferTitle(text: string, info?: Record<string, unknown>): string | undefined {
	const metadataTitle = asString(info?.Title) ?? asString(info?.title);
	if (metadataTitle && !/^untitled$/i.test(metadataTitle)) return metadataTitle;
	return extractFirstLines(text, 8).find((line) => line.length >= 12 && line.length <= 180);
}

function inferAuthors(text: string, info?: Record<string, unknown>, title?: string): string[] {
	const metadataAuthors = splitAuthors(asString(info?.Author) ?? asString(info?.author));
	if (metadataAuthors.length > 0) return metadataAuthors;

	const lines = extractFirstLines(text, 12);
	const titleIndex = title ? lines.findIndex((line) => line.includes(title.slice(0, 30))) : -1;
	const candidate = lines.slice(Math.max(titleIndex + 1, 1), Math.max(titleIndex + 4, 4)).find((line) => {
		return /[,;]|\band\b|、|，/iu.test(line) && !/@/.test(line) && line.length <= 240;
	});
	return splitAuthors(candidate);
}

function inferVenue(text: string): string | undefined {
	const head = text.slice(0, 12_000);
	const knownVenue = head.match(/\b(CVPR|ICCV|ECCV|NeurIPS|ICLR|AAAI|IJCAI|ACL|EMNLP|KDD|SIGIR|WWW|ICML)\b/i);
	if (knownVenue?.[0]) return knownVenue[0].toUpperCase();

	const line = head
		.split("\n")
		.map((item) => item.trim())
		.find((item) => /proceedings|conference|journal|transactions|workshop/i.test(item) && item.length <= 180);
	return line;
}

function extractAbstract(text: string, sections: PaperSection[]): string | undefined {
	const abstractSection = sections.find((section) => /^abstract$/i.test(section.heading));
	if (abstractSection) {
		return abstractSection.text
			.replace(/^abstract\s*/i, "")
			.trim()
			.slice(0, 2_500);
	}

	const match = text.match(/abstract\s+([\s\S]{80,2500}?)(?:\n\s*(?:1\s+)?introduction\b)/i);
	return match?.[1]?.trim();
}

function splitSentences(text: string): string[] {
	return text
		.replace(/\s+/g, " ")
		.split(/(?<=[.!?。！？])\s+/u)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length >= 24);
}

function pickSentences(text: string | undefined, patterns: RegExp[], limit: number): string[] {
	if (!text) return [];
	const sentences = splitSentences(text);
	const matched = sentences.filter((sentence) => patterns.some((pattern) => pattern.test(sentence)));
	return (matched.length > 0 ? matched : sentences).slice(0, limit);
}

function findSection(sections: PaperSection[], pattern: RegExp): PaperSection | undefined {
	return sections.find((section) => pattern.test(section.heading));
}

function summarizeChunk(chunk: TextChunk): ChunkSummary {
	const sentences = splitSentences(chunk.text).slice(0, 3);
	return {
		index: chunk.index,
		summary: sentences.length > 0 ? sentences.join(" ") : chunk.text.slice(0, 500),
		charCount: chunk.text.length,
	};
}

function formatUnknown(value: string | number | undefined): string {
	return value === undefined || value === "" ? "未识别" : String(value);
}

function formatList(items: string[], fallback: string): string[] {
	return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function buildMetadata(text: string, totalPages: number, info?: Record<string, unknown>): PaperMetadata {
	const title = inferTitle(text, info);
	return {
		title,
		authors: inferAuthors(text, info, title),
		year: extractYear(text, info),
		venue: inferVenue(text),
		url: extractUrl(text),
		doi: extractDoi(text),
		totalPages,
	};
}

export function buildPaperAnalysisMarkdown(result: Omit<PaperAnalysisResult, "markdown">): string {
	const { metadata, abstract, sections, chunkSummaries } = result;
	const introduction = findSection(sections, /introduction/i);
	const method = findSection(sections, /method|methodology|approach|model/i);
	const experiment = findSection(sections, /experiment|evaluation|result|ablation/i);
	const conclusion = findSection(sections, /conclusion|discussion/i);
	const references = findSection(sections, /references/i);

	const problem = pickSentences(
		introduction?.text ?? abstract,
		[/problem|challenge|difficult|fail|address|研究|挑战/i],
		3,
	);
	const contributions = pickSentences(
		`${abstract ?? ""}\n${introduction?.text ?? ""}\n${conclusion?.text ?? ""}`,
		[/contribution|propose|present|introduce|improve|novel|贡献|提出/i],
		4,
	);
	const methodSentences = pickSentences(
		method?.text,
		[/method|module|pipeline|framework|model|formula|loss|算法|模块|流程/i],
		5,
	);
	const experimentSentences = pickSentences(
		experiment?.text,
		[/dataset|baseline|metric|auroc|accuracy|result|ablation|数据集|指标|消融/i],
		6,
	);
	const reproducibility = pickSentences(
		`${result.filePath}\n${result.chunks[0]?.text}`,
		[/github|code|dataset|supplement/i],
		2,
	);
	const related = references
		? references.text
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 20)
				.slice(0, 5)
		: [];

	return [
		"# 论文分析报告",
		"",
		"## 1. 基本信息",
		"",
		`- 标题：${formatUnknown(metadata.title)}`,
		`- 作者：${metadata.authors.length > 0 ? metadata.authors.join(", ") : "未识别"}`,
		`- 年份：${formatUnknown(metadata.year)}`,
		`- 会议/期刊：${formatUnknown(metadata.venue)}`,
		`- 链接/DOI：${[metadata.url, metadata.doi].filter(Boolean).join(" / ") || "未识别"}`,
		`- PDF 页数：${metadata.totalPages || "未识别"}`,
		`- 文本字符数：${result.textCharCount}`,
		"",
		"## 2. 一句话总结",
		"",
		pickSentences(
			abstract ?? conclusion?.text ?? result.chunks[0]?.text,
			[/propose|present|study|address|提出|研究/i],
			1,
		)[0] ?? "未能从 PDF 中稳定抽取一句话总结，需要结合正文进一步判断。",
		"",
		"## 3. 研究问题",
		"",
		...formatList(problem, "未能稳定识别研究问题，请人工核对摘要和引言。"),
		"",
		"## 4. 核心贡献",
		"",
		...formatList(contributions, "未能稳定识别显式贡献，请人工核对摘要、引言和结论。"),
		"",
		"## 5. 方法详解",
		"",
		"- 总体流程：",
		...formatList(methodSentences.slice(0, 2), "未能稳定识别方法流程。"),
		"- 关键模块：",
		...formatList(methodSentences.slice(2, 4), "未能稳定识别关键模块。"),
		"- 关键公式，如果能识别：",
		...formatList(pickSentences(method?.text, [/\bL\s*=|loss|objective|公式|损失/i], 2), "未能稳定识别关键公式。"),
		"- 方法优点：",
		...formatList(contributions.slice(0, 2), "需要结合实验结果进一步判断。"),
		"- 方法局限：",
		...formatList(
			pickSentences(conclusion?.text, [/depend|limitation|future|仍|限制/i], 2),
			"未能稳定识别方法局限。",
		),
		"",
		"## 6. 实验分析",
		"",
		"- 数据集：",
		...formatList(pickSentences(experiment?.text, [/dataset|benchmark|MVTec|数据集/i], 2), "未能稳定识别数据集。"),
		"- baseline：",
		...formatList(
			pickSentences(experiment?.text, [/baseline|compare|PatchCore|PaDiM|FastFlow|比较/i], 2),
			"未能稳定识别 baseline。",
		),
		"- 指标：",
		...formatList(pickSentences(experiment?.text, [/metric|AUROC|AUC|AP|F1|PRO|指标/i], 2), "未能稳定识别指标。"),
		"- 主要结果：",
		...formatList(experimentSentences.slice(0, 3), "未能稳定识别主要实验结果。"),
		"- 消融实验：",
		...formatList(pickSentences(experiment?.text, [/ablation|remove|without|消融/i], 2), "未能稳定识别消融实验。"),
		"- 是否公平比较：",
		"- 需要人工核查训练设置、数据划分、baseline 调参和指标定义是否一致。",
		"",
		"## 7. 可复现性评估",
		"",
		...formatList(reproducibility, "未从 PDF 文本中稳定识别代码、数据或补充材料链接。"),
		"",
		"## 8. 论文优点",
		"",
		...formatList(contributions.slice(0, 3), "需要结合全文进一步判断。"),
		"",
		"## 9. 论文缺点",
		"",
		...formatList(
			pickSentences(conclusion?.text ?? abstract, [/limitation|future|depend|only|仍|限制/i], 3),
			"未能稳定识别缺点，建议从实验设置和适用边界补充。",
		),
		"",
		"## 10. 对我研究的启发",
		"",
		"- 可重点关注该论文的问题定义、数据构造、baseline 选择和失败案例。",
		"- 如果你的方向与特定应用场景相关，可优先比较其数据假设、评测协议和部署条件。",
		"",
		"## 11. 审稿人可能质疑点",
		"",
		"- 数据集是否覆盖真实部署中的关键数据来源和观测条件。",
		"- 与强 baseline 的比较是否公平，是否存在调参或数据泄漏风险。",
		"- 方法对新数据源、新设备或新目标类型的泛化能力是否充分验证。",
		"",
		"## 12. 建议深入阅读的相关论文",
		"",
		...formatList(related, "未稳定抽取参考文献条目，可结合 `/search` 按论文主题继续检索。"),
		"",
		"## 附录：分块摘要",
		"",
		...chunkSummaries.map((chunk) => `- Chunk ${chunk.index}（${chunk.charCount} 字符）：${chunk.summary}`),
	].join("\n");
}

export async function analyzePaperPdf(options: AnalyzePaperPdfOptions): Promise<PaperAnalysisResult> {
	const filePath = resolvePdfPath(options.cwd, options.input);
	await assertReadablePdf(filePath);

	const parsePdf = options.parsePdf ?? parsePdfWithPdfParse;
	let parsed: PdfParseResult;
	try {
		parsed = await parsePdf(filePath, options.signal);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(message.startsWith("PDF 无法解析") ? message : `PDF 无法解析：${message}`);
	}

	const text = normalizeExtractedText(parsed.text);
	if (!text) {
		throw new Error(`PDF 文本为空，可能是扫描版 PDF 或受保护文件：${filePath}`);
	}

	const sections = identifySections(text);
	const metadata = buildMetadata(text, parsed.totalPages, parsed.info);
	const chunks = chunkText(text, options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS);
	const chunkSummaries = chunks.slice(0, options.maxChunkSummaries ?? DEFAULT_MAX_CHUNK_SUMMARIES).map(summarizeChunk);
	const resultWithoutMarkdown = {
		filePath,
		metadata,
		abstract: extractAbstract(text, sections),
		sections,
		chunks,
		chunkSummaries,
		textCharCount: text.length,
	};

	return { ...resultWithoutMarkdown, markdown: buildPaperAnalysisMarkdown(resultWithoutMarkdown) };
}
