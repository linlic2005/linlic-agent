export type PaperSource = "Semantic Scholar" | "OpenAlex" | "arXiv";

export type SourceStatus = "success" | "error";

export type ReadingPriority = "高" | "中" | "低";

export interface HttpResponseLike {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

export type FetchLike = (
	url: string,
	init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<HttpResponseLike>;

export interface PaperSearchPaper {
	id: string;
	title: string;
	authors: string[];
	year?: number;
	venue?: string;
	citationCount?: number;
	url?: string;
	doi?: string;
	abstract?: string;
	source: PaperSource;
	sources: PaperSource[];
	relevanceScore: number;
	relevanceReason: string;
	readingPriority: ReadingPriority;
}

export interface SourceSearchStatus {
	source: PaperSource;
	status: SourceStatus;
	count: number;
	message?: string;
}

export interface ParsedSearchInput {
	topic: string;
	limit: number;
	yearFrom?: number;
}

export interface PaperSearchResult {
	topic: string;
	englishQuery: string;
	keywords: string[];
	sourceStatuses: SourceSearchStatus[];
	warnings: string[];
	papers: PaperSearchPaper[];
	markdown: string;
}

export interface PaperSearchOptions {
	input: string;
	topic?: string;
	limit?: number;
	yearFrom?: number;
	apiKey?: string;
	fetcher?: FetchLike;
	signal?: AbortSignal;
	logger?: { warn(message: string): void };
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const sourcePriority: PaperSource[] = ["Semantic Scholar", "OpenAlex", "arXiv"];

const englishStopWords = new Set([
	"about",
	"after",
	"and",
	"best",
	"find",
	"for",
	"from",
	"paper",
	"papers",
	"search",
	"since",
	"that",
	"the",
	"with",
	"year",
	"years",
]);

const chineseTermMappings: Array<{ pattern: RegExp; terms: string[] }> = [
	{ pattern: /(?:医学影像|医学|影像)/u, terms: ["medical imaging"] },
	{ pattern: /异常检测/u, terms: ["anomaly detection"] },
	{ pattern: /缺陷检测/u, terms: ["defect detection"] },
	{ pattern: /表面/u, terms: ["surface"] },
	{ pattern: /(?:视觉检测|机器视觉)/u, terms: ["machine vision"] },
	{ pattern: /(?:合成|生成)/u, terms: ["synthetic"] },
	{ pattern: /(?:增强|数据增强)/u, terms: ["augmentation"] },
	{ pattern: /无监督/u, terms: ["unsupervised"] },
	{ pattern: /少样本/u, terms: ["few-shot"] },
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampLimit(limit: number | undefined): number {
	if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
}

function parseNumber(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function stripSearchCommand(input: string): string {
	return input
		.trim()
		.replace(/^\/search\b/i, "")
		.trim();
}

function parseKeyValue(input: string, key: string): string | undefined {
	const pattern = new RegExp(`${key}=("([^"]+)"|'([^']+)'|([^\\s]+))`, "i");
	const match = input.match(pattern);
	return match?.[2] ?? match?.[3] ?? match?.[4];
}

function removeKnownArguments(input: string): string {
	return input
		.replace(/\b(?:limit|year_from|yearFrom)=("[^"]+"|'[^']+'|[^\s]+)/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

function inferLimit(input: string): number | undefined {
	const patterns = [/\blimit\s*=?\s*(\d{1,3})\b/i, /\btop\s*(\d{1,3})\b/i, /前\s*(\d{1,3})\s*(?:篇|个)?/u];
	for (const pattern of patterns) {
		const match = input.match(pattern);
		const value = parseNumber(match?.[1]);
		if (value) return value;
	}
	return undefined;
}

function inferYearFrom(input: string): number | undefined {
	const patterns = [
		/\b(?:year_from|yearFrom|since|after|from|>=)\s*[:=]?\s*((?:19|20)\d{2})\b/i,
		/((?:19|20)\d{2})\s*(?:年)?\s*(?:以后|之后|以来|起|至今|后)/u,
		/\b(?:after|since|from)\s+((?:19|20)\d{2})\b/i,
	];
	for (const pattern of patterns) {
		const match = input.match(pattern);
		const value = parseNumber(match?.[1]);
		if (value) return value;
	}
	return undefined;
}

export function parseSearchInput(input: string): ParsedSearchInput {
	const normalized = stripSearchCommand(input);
	const topic = parseKeyValue(normalized, "topic") ?? removeKnownArguments(normalized);
	const explicitLimit = parseNumber(parseKeyValue(normalized, "limit"));
	const explicitYearFrom = parseNumber(
		parseKeyValue(normalized, "year_from") ?? parseKeyValue(normalized, "yearFrom"),
	);
	const limit = clampLimit(explicitLimit ?? inferLimit(normalized));
	const yearFrom = explicitYearFrom ?? inferYearFrom(normalized);
	return { topic, limit, ...(yearFrom ? { yearFrom } : {}) };
}

export function normalizePaperTitle(title: string): string {
	return title
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeDoi(doi: string | undefined): string | undefined {
	if (!doi) return undefined;
	const normalized = doi
		.trim()
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
		.toLowerCase();
	return normalized || undefined;
}

function extractKeywords(topic: string): string[] {
	const keywords: string[] = [];
	const addKeyword = (keyword: string) => {
		const normalized = keyword.trim().toLowerCase();
		if (normalized && !keywords.includes(normalized)) keywords.push(normalized);
	};

	for (const mapping of chineseTermMappings) {
		if (mapping.pattern.test(topic)) {
			for (const term of mapping.terms) addKeyword(term);
		}
	}

	const asciiWords = topic
		.normalize("NFKC")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.map((word) => word.trim())
		.filter(
			(word) =>
				word.length >= 3 && !englishStopWords.has(word) && !/^(?:19|20)\d{2}$/.test(word) && !/^\d+$/.test(word),
		);
	for (const word of asciiWords) addKeyword(word);

	return keywords.slice(0, 12);
}

function hasChineseText(input: string): boolean {
	return /[\u4e00-\u9fff]/u.test(input);
}

function buildEnglishQuery(topic: string, keywords: string[]): string {
	if (!hasChineseText(topic)) return topic;
	return keywords.length > 0 ? keywords.join(" ") : topic;
}

function defaultRelevanceReason(paper: PaperSearchPaper): string {
	const fields = [paper.title, paper.abstract ?? "", paper.venue ?? ""].join(" ").toLowerCase();
	if (fields.includes("survey") || fields.includes("review")) {
		return "标题或摘要显示该论文可能适合建立综述背景。";
	}
	return "标题或摘要与检索主题存在关键词或语义相关性。";
}

function defaultReadingPriority(paper: PaperSearchPaper): ReadingPriority {
	if (paper.relevanceScore >= 15 || (paper.year && paper.year >= 2023 && (paper.citationCount ?? 0) >= 10)) {
		return "高";
	}
	if (paper.relevanceScore >= 5 || (paper.citationCount ?? 0) >= 30) {
		return "中";
	}
	return "低";
}

function enrichPaper(paper: PaperSearchPaper): PaperSearchPaper {
	const enriched = {
		...paper,
		relevanceReason: paper.relevanceReason || defaultRelevanceReason(paper),
		readingPriority: paper.readingPriority || defaultReadingPriority(paper),
	};
	return { ...enriched, readingPriority: defaultReadingPriority(enriched) };
}

function mergePaper(existing: PaperSearchPaper, incoming: PaperSearchPaper): PaperSearchPaper {
	const sources = sourcePriority.filter(
		(source) => existing.sources.includes(source) || incoming.sources.includes(source),
	);
	return enrichPaper({
		...existing,
		authors: existing.authors.length > 0 ? existing.authors : incoming.authors,
		year: existing.year ?? incoming.year,
		venue: existing.venue ?? incoming.venue,
		citationCount: Math.max(existing.citationCount ?? 0, incoming.citationCount ?? 0),
		url: existing.url ?? incoming.url,
		doi: existing.doi ?? incoming.doi,
		abstract: existing.abstract ?? incoming.abstract,
		sources,
		relevanceScore: Math.max(existing.relevanceScore, incoming.relevanceScore),
	});
}

export function mergeAndRankPapers(papers: PaperSearchPaper[], limit: number, yearFrom?: number): PaperSearchPaper[] {
	const byKey = new Map<string, PaperSearchPaper>();

	for (const rawPaper of papers) {
		const paper = enrichPaper(rawPaper);
		if (yearFrom && paper.year && paper.year < yearFrom) continue;
		const keys = getPaperKeys(paper);
		const existing = keys.map((key) => byKey.get(key)).find((value): value is PaperSearchPaper => Boolean(value));
		const merged = existing ? mergePaper(existing, paper) : paper;
		for (const key of new Set([...keys, ...(existing ? getPaperKeys(existing) : [])])) {
			byKey.set(key, merged);
		}
	}

	return Array.from(new Set(byKey.values()))
		.sort((a, b) => {
			const relevance = b.relevanceScore - a.relevanceScore;
			if (relevance !== 0) return relevance;
			const year = (b.year ?? 0) - (a.year ?? 0);
			if (year !== 0) return year;
			return (b.citationCount ?? 0) - (a.citationCount ?? 0);
		})
		.slice(0, limit);
}

function getPaperKeys(paper: PaperSearchPaper): string[] {
	const keys = [`title:${normalizePaperTitle(paper.title)}`];
	if (paper.doi) keys.unshift(`doi:${paper.doi}`);
	return keys;
}

async function defaultFetch(url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) {
	return fetch(url, { headers: init?.headers, signal: init?.signal });
}

async function readJson(response: HttpResponseLike): Promise<unknown> {
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
	}
	return response.json();
}

async function readText(response: HttpResponseLike): Promise<string> {
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
	}
	return response.text();
}

function getAuthors(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			const record = asRecord(entry);
			const author = asRecord(record?.author);
			return asString(record?.name) ?? asString(author?.display_name);
		})
		.filter((name): name is string => Boolean(name))
		.slice(0, 6);
}

async function searchSemanticScholar(
	query: string,
	limit: number,
	yearFrom: number | undefined,
	fetcher: FetchLike,
	apiKey: string | undefined,
	signal: AbortSignal | undefined,
): Promise<PaperSearchPaper[]> {
	const params = new URLSearchParams({
		query,
		limit: String(limit),
		fields: "title,authors,year,venue,citationCount,url,abstract,externalIds,publicationDate",
	});
	if (yearFrom) params.set("year", `${yearFrom}-`);

	const headers = apiKey ? { "x-api-key": apiKey } : undefined;
	const response = await fetcher(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {
		...(headers ? { headers } : {}),
		signal,
	});
	const payload = asRecord(await readJson(response));
	const data = Array.isArray(payload?.data) ? payload.data : [];

	return data
		.map((entry, index): PaperSearchPaper | undefined => {
			const record = asRecord(entry);
			const title = asString(record?.title);
			if (!title) return undefined;
			const externalIds = asRecord(record?.externalIds);
			return {
				id: asString(record?.paperId) ?? title,
				title,
				authors: getAuthors(record?.authors),
				year: asNumber(record?.year),
				venue: asString(record?.venue),
				citationCount: asNumber(record?.citationCount),
				url: asString(record?.url),
				doi: normalizeDoi(asString(externalIds?.DOI)),
				abstract: asString(record?.abstract),
				source: "Semantic Scholar",
				sources: ["Semantic Scholar"],
				relevanceScore: 100 - index,
				relevanceReason: "",
				readingPriority: "低",
			};
		})
		.filter((paper): paper is PaperSearchPaper => Boolean(paper));
}

function restoreOpenAlexAbstract(value: unknown): string | undefined {
	const index = asRecord(value);
	if (!index) return undefined;
	const words: string[] = [];
	for (const [word, positions] of Object.entries(index)) {
		if (!Array.isArray(positions)) continue;
		for (const position of positions) {
			if (typeof position === "number") words[position] = word;
		}
	}
	return words.filter(Boolean).join(" ") || undefined;
}

async function searchOpenAlex(
	query: string,
	limit: number,
	yearFrom: number | undefined,
	fetcher: FetchLike,
	signal: AbortSignal | undefined,
): Promise<PaperSearchPaper[]> {
	const params = new URLSearchParams({
		search: query,
		"per-page": String(limit),
		select:
			"id,display_name,authorships,publication_year,primary_location,cited_by_count,doi,abstract_inverted_index,relevance_score",
	});
	if (yearFrom) params.set("filter", `from_publication_date:${yearFrom}-01-01`);

	const response = await fetcher(`https://api.openalex.org/works?${params}`, { signal });
	const payload = asRecord(await readJson(response));
	const results = Array.isArray(payload?.results) ? payload.results : [];

	return results
		.map((entry): PaperSearchPaper | undefined => {
			const record = asRecord(entry);
			const title = asString(record?.display_name);
			if (!title) return undefined;
			const location = asRecord(record?.primary_location);
			const source = asRecord(location?.source);
			return {
				id: asString(record?.id) ?? title,
				title,
				authors: getAuthors(record?.authorships),
				year: asNumber(record?.publication_year),
				venue: asString(source?.display_name),
				citationCount: asNumber(record?.cited_by_count),
				url: asString(location?.landing_page_url) ?? asString(record?.id),
				doi: normalizeDoi(asString(record?.doi)),
				abstract: restoreOpenAlexAbstract(record?.abstract_inverted_index),
				source: "OpenAlex",
				sources: ["OpenAlex"],
				relevanceScore: asNumber(record?.relevance_score) ?? 0,
				relevanceReason: "",
				readingPriority: "低",
			};
		})
		.filter((paper): paper is PaperSearchPaper => Boolean(paper));
}

function decodeXml(value: string): string {
	return value
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function extractTag(xml: string, tag: string): string | undefined {
	const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
	return match?.[1] ? decodeXml(match[1]) : undefined;
}

function extractArxivAuthors(entry: string): string[] {
	return Array.from(entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi))
		.map((match) => decodeXml(match[1] ?? ""))
		.filter(Boolean)
		.slice(0, 6);
}

async function searchArxiv(
	query: string,
	limit: number,
	fetcher: FetchLike,
	signal: AbortSignal | undefined,
): Promise<PaperSearchPaper[]> {
	const params = new URLSearchParams({
		search_query: `all:${query}`,
		start: "0",
		max_results: String(limit),
		sortBy: "relevance",
		sortOrder: "descending",
	});
	const response = await fetcher(`https://export.arxiv.org/api/query?${params}`, { signal });
	const xml = await readText(response);
	const entries = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)).map((match) => match[1] ?? "");

	return entries
		.map((entry, index): PaperSearchPaper | undefined => {
			const title = extractTag(entry, "title");
			if (!title) return undefined;
			const published = extractTag(entry, "published");
			const alternate = entry.match(/<link[^>]+href="([^"]+)"[^>]*(?:rel="alternate"|type="text\/html")[^>]*\/?>/i);
			const doi = extractTag(entry, "arxiv:doi") ?? extractTag(entry, "doi");
			return {
				id: extractTag(entry, "id") ?? title,
				title,
				authors: extractArxivAuthors(entry),
				year: published ? Number.parseInt(published.slice(0, 4), 10) : undefined,
				venue: "arXiv",
				url: alternate?.[1] ?? extractTag(entry, "id"),
				doi: normalizeDoi(doi),
				abstract: extractTag(entry, "summary"),
				source: "arXiv",
				sources: ["arXiv"],
				relevanceScore: 80 - index,
				relevanceReason: "",
				readingPriority: "低",
			};
		})
		.filter((paper): paper is PaperSearchPaper => Boolean(paper));
}

export async function searchPapers(options: PaperSearchOptions): Promise<PaperSearchResult> {
	const parsed = parseSearchInput(options.input);
	const topic = options.topic?.trim() || parsed.topic;
	const limit = clampLimit(options.limit ?? parsed.limit);
	const yearFrom = options.yearFrom ?? parsed.yearFrom;
	const fetcher = options.fetcher ?? defaultFetch;
	const apiKey = options.apiKey ?? process.env.SEMANTIC_SCHOLAR_API_KEY;
	const keywords = extractKeywords(topic);
	const englishQuery = buildEnglishQuery(topic, keywords);
	const sourceLimit = Math.min(MAX_LIMIT, Math.max(limit * 2, limit));
	const warnings: string[] = [];
	const sourceStatuses: SourceSearchStatus[] = [];
	const allPapers: PaperSearchPaper[] = [];

	const runners: Array<{
		source: PaperSource;
		run(): Promise<PaperSearchPaper[]>;
	}> = [
		{
			source: "Semantic Scholar",
			run: () => searchSemanticScholar(englishQuery, sourceLimit, yearFrom, fetcher, apiKey, options.signal),
		},
		{ source: "OpenAlex", run: () => searchOpenAlex(englishQuery, sourceLimit, yearFrom, fetcher, options.signal) },
		{ source: "arXiv", run: () => searchArxiv(englishQuery, sourceLimit, fetcher, options.signal) },
	];

	for (const runner of runners) {
		try {
			const papers = await runner.run();
			allPapers.push(...papers);
			sourceStatuses.push({ source: runner.source, status: "success", count: papers.length });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const warning = `${runner.source} 检索失败，已继续尝试后续数据源：${message}`;
			warnings.push(warning);
			options.logger?.warn(warning);
			sourceStatuses.push({ source: runner.source, status: "error", count: 0, message });
		}
	}

	const papers = mergeAndRankPapers(allPapers, limit, yearFrom);
	const resultWithoutMarkdown = { topic, englishQuery, keywords, sourceStatuses, warnings, papers };
	const markdown = buildLiteratureSearchMarkdown(resultWithoutMarkdown);
	return { ...resultWithoutMarkdown, markdown };
}

function formatPaperValue(value: string | number | undefined): string {
	return value === undefined || value === "" ? "未知" : String(value);
}

function truncate(text: string | undefined, maxLength: number): string {
	if (!text) return "暂无摘要。";
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 1)}…`;
}

export function buildLiteratureSearchMarkdown(result: Omit<PaperSearchResult, "markdown">): string {
	const lines: string[] = [
		"# 文献检索报告",
		"",
		"## 1. 检索主题",
		"",
		result.topic,
		"",
		"## 2. 自动生成的关键词",
		"",
		result.keywords.length > 0 ? result.keywords.map((keyword) => `- ${keyword}`).join("\n") : "- 暂无关键词",
		"",
		"英文检索式：",
		"",
		`> ${result.englishQuery}`,
		"",
		"## 3. 检索数据源",
		"",
		...result.sourceStatuses.map((status) => {
			const suffix = status.message ? `：${status.message}` : `，返回 ${status.count} 篇`;
			return `- ${status.source}：${status.status}${suffix}`;
		}),
	];

	if (result.warnings.length > 0) {
		lines.push("", "检索警告：", "", ...result.warnings.map((warning) => `- ${warning}`));
	}

	lines.push("", "## 4. Top 论文列表", "");

	if (result.papers.length === 0) {
		lines.push("未检索到可用论文。请尝试更具体的英文关键词、放宽年份限制，或稍后重试 API。");
	} else {
		for (const [index, paper] of result.papers.entries()) {
			lines.push(
				`### ${index + 1}. ${paper.title}`,
				"",
				`- 作者：${paper.authors.length > 0 ? paper.authors.join(", ") : "未知"}`,
				`- 年份：${formatPaperValue(paper.year)}`,
				`- venue：${formatPaperValue(paper.venue)}`,
				`- citation count：${formatPaperValue(paper.citationCount)}`,
				`- URL / DOI：${paper.url ?? "未知"}${paper.doi ? ` / ${paper.doi}` : ""}`,
				`- 数据源：${paper.sources.join(", ")}`,
				`- 摘要：${truncate(paper.abstract, 700)}`,
				`- 与主题的相关性说明：${paper.relevanceReason}`,
				`- 推荐阅读优先级：${paper.readingPriority}`,
				"",
			);
		}
	}

	lines.push(
		"## 5. 方法分类",
		"",
		"- 按任务：检测、分割、定位、开放集异常识别。",
		"- 按方法：重建式、特征建模式、合成异常、视觉语言或基础模型迁移。",
		"- 按数据：真实数据、合成数据、无监督或少样本设置。",
		"",
		"## 6. 当前研究趋势",
		"",
		"- 更重视真实应用场景中的泛化能力和可复现评测。",
		"- 从单一模型精度转向数据构造、异常合成和跨域迁移。",
		"- 越来越多工作关注 foundation model、prompting 和弱监督。",
		"",
		"## 7. 可能的研究空白",
		"",
		"- 特定数据来源或观测条件下的数据覆盖可能不足。",
		"- 关键失败模式常被混入一般问题设定，缺少独立分析。",
		"- 很多方法缺少跨数据集、跨场景和真实部署成本评估。",
		"",
		"## 8. 下一步建议",
		"",
		"- 优先精读高优先级论文，整理数据集、baseline、指标和失败案例。",
		"- 用检索式继续人工核查 Google Scholar、Semantic Scholar、OpenAlex、arXiv 和目标会议论文集。",
		"- 下一步可以运行 `/idea` 做 novelty check，或运行 `/paper` 分析单篇论文。",
	);

	return lines.join("\n");
}
