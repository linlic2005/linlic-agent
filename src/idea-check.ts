import {
	type FetchLike,
	type PaperSearchOptions,
	type PaperSearchPaper,
	type PaperSearchResult,
	searchPapers,
} from "./paper-search.ts";
import { searchZoteroLibrary, type ZoteroConfig, type ZoteroSearchResult } from "./zotero.ts";

export type NoveltyThreat = "高" | "中" | "低";

export interface IdeaDecomposition {
	researchObject: string;
	applicationScene: string;
	coreMethod: string;
	expectedContribution: string;
	requiredData: string;
	requiredExperiments: string;
}

export interface SimilarWork {
	title: string;
	year?: number;
	url?: string;
	similarity: string;
	difference: string;
	noveltyThreat: NoveltyThreat;
	paper: PaperSearchPaper;
}

export interface IdeaRiskAssessment {
	high: string[];
	medium: string[];
	low: string[];
}

export interface IdeaCheckResult {
	idea: string;
	decomposition: IdeaDecomposition;
	keywords: string[];
	englishQuery: string;
	zotero: ZoteroSearchResult;
	searchResult: PaperSearchResult;
	similarWorks: SimilarWork[];
	risks: IdeaRiskAssessment;
	technicalFeasibility: string[];
	dataFeasibility: string[];
	experimentCost: string[];
	reviewerQuestions: string[];
	repositioningSuggestions: string[];
	nextActions: string[];
	markdown: string;
}

export interface IdeaCheckOptions {
	input: string;
	limit?: number;
	yearFrom?: number;
	fetcher?: FetchLike;
	apiKey?: string;
	zoteroConfig?: ZoteroConfig;
	signal?: AbortSignal;
	logger?: PaperSearchOptions["logger"];
}

const DEFAULT_IDEA_LIMIT = 10;

const termMappings: Array<{ pattern: RegExp; label: string; english: string[] }> = [
	{ pattern: /(?:医学影像|医学|影像)/u, label: "医学影像", english: ["medical imaging"] },
	{ pattern: /异常检测/u, label: "异常检测", english: ["anomaly detection"] },
	{ pattern: /缺陷/u, label: "缺陷检测", english: ["defect detection"] },
	{ pattern: /(?:合成|生成)/u, label: "合成数据", english: ["synthetic", "generation"] },
	{ pattern: /(?:增强|数据增强)/u, label: "数据增强", english: ["augmentation"] },
	{ pattern: /鲁棒/u, label: "鲁棒性", english: ["robustness"] },
	{ pattern: /(?:无监督|自监督)/u, label: "无监督或自监督", english: ["unsupervised", "self-supervised"] },
	{ pattern: /(?:少样本|小样本)/u, label: "少样本", english: ["few-shot"] },
];

const stopWords = new Set(["about", "an", "and", "for", "idea", "method", "paper", "research", "the", "to", "with"]);

function stripIdeaCommand(input: string): string {
	return input
		.trim()
		.replace(/^\/idea\b/i, "")
		.trim();
}

function parseNumber(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseKeyValue(input: string, key: string): string | undefined {
	const pattern = new RegExp(`${key}=("([^"]+)"|'([^']+)'|([^\\s]+))`, "i");
	const match = input.match(pattern);
	return match?.[2] ?? match?.[3] ?? match?.[4];
}

function removeKnownArguments(input: string): string {
	return input
		.replace(/\b(?:idea|limit|year_from|yearFrom)=("[^"]+"|'[^']+'|[^\s]+)/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

function parseIdeaInput(input: string): { idea: string; limit?: number; yearFrom?: number } {
	const normalized = stripIdeaCommand(input);
	const idea = parseKeyValue(normalized, "idea") ?? removeKnownArguments(normalized);
	const limit = parseNumber(parseKeyValue(normalized, "limit"));
	const yearFrom = parseNumber(parseKeyValue(normalized, "year_from") ?? parseKeyValue(normalized, "yearFrom"));
	return { idea, ...(limit ? { limit } : {}), ...(yearFrom ? { yearFrom } : {}) };
}

function normalizeText(text: string): string {
	return text.normalize("NFKC").toLowerCase();
}

function collectIdeaKeywords(idea: string): string[] {
	const keywords: string[] = [];
	const add = (keyword: string) => {
		const normalized = keyword.trim().toLowerCase();
		if (normalized && !keywords.includes(normalized)) keywords.push(normalized);
	};

	for (const mapping of termMappings) {
		if (mapping.pattern.test(idea)) {
			for (const keyword of mapping.english) add(keyword);
		}
	}

	for (const word of normalizeText(idea).split(/[^\p{L}\p{N}]+/u)) {
		if (word.length >= 3 && !stopWords.has(word) && !/^\d+$/.test(word)) add(word);
	}

	return keywords.slice(0, 14);
}

function firstMatchedLabel(
	idea: string,
	patterns: Array<{ pattern: RegExp; value: string }>,
	fallback: string,
): string {
	return patterns.find((item) => item.pattern.test(idea))?.value ?? fallback;
}

export function decomposeResearchIdea(input: string): IdeaDecomposition {
	const { idea } = parseIdeaInput(input);
	const object = firstMatchedLabel(
		idea,
		[
			{ pattern: /(?:医学影像|医学|影像)/u, value: "医学影像中的目标结构、病灶或异常区域" },
			{ pattern: /异常检测/u, value: "异常检测对象" },
			{ pattern: /缺陷/u, value: "缺陷或异常目标" },
		],
		"用户描述中的目标对象，需要进一步明确对象类型、数据来源和观测条件",
	);
	const scene = firstMatchedLabel(
		idea,
		[
			{ pattern: /医学/u, value: "医学影像分析" },
			{ pattern: /遥感/u, value: "遥感图像分析" },
		],
		"应用场景未完全明确，需要补充目标领域和真实部署约束",
	);
	const method = firstMatchedLabel(
		idea,
		[
			{
				pattern: /(?:合成|生成).*?(?:数据|样本)|(?:数据|样本).*?(?:合成|生成)/u,
				value: "合成数据或样本增强来提升模型鲁棒性",
			},
			{ pattern: /增强/u, value: "数据增强或训练策略改进" },
			{ pattern: /(?:扩散|diffusion)/iu, value: "生成式模型或扩散模型辅助构造数据" },
			{ pattern: /(?:视觉语言|CLIP|SAM)/iu, value: "视觉语言或基础模型迁移" },
		],
		"核心方法需要进一步明确模型结构、训练目标和推理流程",
	);

	return {
		researchObject: object,
		applicationScene: scene,
		coreMethod: method,
		expectedContribution: "预期贡献应落在问题定义、数据构造、鲁棒训练、真实场景评测或部署可靠性中的至少一项。",
		requiredData: "需要正常样本、异常样本或可控合成样本，并覆盖关键数据来源、标注粒度和采集条件。",
		requiredExperiments:
			"需要与强 baseline 比较，至少包含跨数据集测试、分层评估、消融实验、失败案例和统计显著性或稳定性分析。",
	};
}

function scorePaperSimilarity(paper: PaperSearchPaper, keywords: string[]): number {
	const haystack = normalizeText(`${paper.title}\n${paper.abstract ?? ""}\n${paper.venue ?? ""}`);
	return keywords.reduce((score, keyword) => {
		if (haystack.includes(keyword.toLowerCase())) return score + (keyword.includes(" ") ? 2 : 1);
		return score;
	}, 0);
}

function noveltyThreatFromScore(score: number): NoveltyThreat {
	if (score >= 7) return "高";
	if (score >= 3) return "中";
	return "低";
}

function explainSimilarity(paper: PaperSearchPaper, keywords: string[]): string {
	const haystack = normalizeText(`${paper.title}\n${paper.abstract ?? ""}`);
	const matched = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).slice(0, 6);
	if (matched.length === 0) return "标题或摘要只与想法存在弱相关，需要人工精读确认。";
	return `标题或摘要覆盖这些关键词：${matched.join(", ")}。`;
}

function explainDifference(threat: NoveltyThreat): string {
	if (threat === "高") {
		return "需要重点确认该工作是否已经覆盖同一对象、同一增强策略和同一实验设置；若完全重合，当前想法需要重新定位。";
	}
	if (threat === "中") {
		return "可能共享问题背景或方法组件，但仍可能在数据、物理建模、鲁棒性评测或部署约束上形成差异。";
	}
	return "相关性较弱，可作为背景或 baseline 参考，不一定直接威胁创新性。";
}

function buildSimilarWorks(searchResult: PaperSearchResult, ideaKeywords: string[]): SimilarWork[] {
	const keywords = Array.from(new Set([...searchResult.keywords, ...ideaKeywords])).slice(0, 18);
	return searchResult.papers
		.map((paper) => {
			const score = scorePaperSimilarity(paper, keywords);
			const noveltyThreat = noveltyThreatFromScore(score);
			return {
				title: paper.title,
				year: paper.year,
				url: paper.url ?? (paper.doi ? `https://doi.org/${paper.doi}` : undefined),
				similarity: explainSimilarity(paper, keywords),
				difference: explainDifference(noveltyThreat),
				noveltyThreat,
				paper,
			};
		})
		.sort((a, b) => {
			const threatOrder = { 高: 3, 中: 2, 低: 1 };
			const threat = threatOrder[b.noveltyThreat] - threatOrder[a.noveltyThreat];
			if (threat !== 0) return threat;
			return (b.year ?? 0) - (a.year ?? 0);
		})
		.slice(0, 8);
}

function buildRisks(similarWorks: SimilarWork[], decomposition: IdeaDecomposition): IdeaRiskAssessment {
	const hasHigh = similarWorks.some((work) => work.noveltyThreat === "高");
	const hasMedium = similarWorks.some((work) => work.noveltyThreat === "中");
	return {
		high: hasHigh
			? [
					"已有工作可能同时覆盖相同应用场景、核心方法和实验设置，需要逐篇精读确认差异。",
					"如果贡献只停留在常规方法组合，容易被认为是已有技术路线的直接应用。",
				]
			: ["当前 Top 结果未显示完全重合工作，但这只代表公开 API 检索范围内的初步结果。"],
		medium: [
			hasMedium
				? "存在部分相似工作，可能共享问题背景、数据设置或模型组件。"
				: "相似工作较少，但仍需要扩展关键词检索相关会议和期刊。",
			`当前方法定位为“${decomposition.coreMethod}”，需要避免只做工程式增强。`,
		],
		low: [
			"如果能提供真实数据、可解释的问题建模或跨数据源验证，创新性风险会下降。",
			"若将贡献限定在特定数据条件、失败模式分析或部署约束，也更容易形成清晰定位。",
		],
	};
}

function buildTechnicalFeasibility(decomposition: IdeaDecomposition): string[] {
	return [
		`核心方法：${decomposition.coreMethod}。MVP 技术路径可从现有异常检测 baseline 加数据增强模块开始。`,
		"主要技术难点在于合成样本是否足够真实，以及增强是否会引入标签噪声或掩盖关键失败模式。",
		"建议先做可控 synthetic augmentation，再补真实样本验证 domain gap。",
	];
}

function buildDataFeasibility(): string[] {
	return [
		"公开数据集可作为初始 baseline，但需要确认其任务定义、标注粒度和数据分布是否匹配研究问题。",
		"如果目标场景较窄，最好补充自采数据或构造可控合成数据，并明确采集条件和标注标准。",
		"需要单独标注或筛选关键失败案例，否则很难证明方法针对的是目标问题本身。",
	];
}

function buildExperimentCost(): string[] {
	return [
		"低成本版本：复现实验使用 2-3 个强 baseline，加合成数据增强的消融。",
		"中等成本版本：加入跨数据集、不同数据条件和少样本设置。",
		"高成本版本：自采数据并做细粒度标注，会显著增加采集、标注和复现实验成本。",
	];
}

function buildReviewerQuestions(similarWorks: SimilarWork[]): string[] {
	const highRiskTitle = similarWorks.find((work) => work.noveltyThreat === "高")?.title;
	return [
		highRiskTitle
			? `与最相似工作《${highRiskTitle}》相比，核心新意到底在哪里？`
			: "已有 anomaly detection 和 data augmentation 工作很多，为什么这个问题不是已有方法的直接应用？",
		"合成样本是否真实，是否覆盖真实应用中的关键数据分布？",
		"增强后的模型是否只是提升了特定数据集分数，而没有改善真实场景鲁棒性？",
		"是否与代表性强 baseline 公平比较？",
		"是否有失败案例和负结果来说明方法边界？",
	];
}

function buildRepositioningSuggestions(): string[] {
	return [
		"把研究定位从“提出一种通用方法”收窄为“特定数据条件下的鲁棒性问题”。",
		"将贡献拆成三个可验证点：问题建模、训练策略、评测协议。",
		"优先强调真实失败案例和跨数据源泛化，而不是只强调平均指标提升。",
		"如果相似工作很多，可转向 benchmark、诊断分析、物理一致增强或 deployment-oriented evaluation。",
	];
}

function buildNextActions(): string[] {
	return [
		"精读高威胁和中威胁论文，逐篇整理 problem、method、data、experiment、claim。",
		"把检索式扩展到 Google Scholar、Semantic Scholar、OpenAlex、arXiv 和目标会议论文集。",
		"选定 2-3 个 baseline，先在公开数据集上做最小复现实验。",
		"构造一组数据条件可控的 ablation，验证增强是否真的改善目标场景鲁棒性。",
		"写一页 novelty table，明确你的方法与最相似工作的同点、不同点和新增证据。",
	];
}

function formatList(items: string[], fallback: string): string[] {
	return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function buildIdeaCheckMarkdown(result: Omit<IdeaCheckResult, "markdown">): string {
	const { decomposition, risks } = result;
	const zoteroLines =
		result.zotero.items.length > 0
			? result.zotero.items.flatMap((item, index) => [
					`### ${index + 1}. ${item.title}`,
					"",
					`- 作者：${item.authors.length > 0 ? item.authors.join(", ") : "未知"}`,
					`- 年份：${item.year ?? "未知"}`,
					`- 链接：${item.url ?? (item.doi ? `https://doi.org/${item.doi}` : "未知")}`,
					`- 备注：这是用户 Zotero 文献库中的已有条目，应优先精读并确认是否已经覆盖当前想法。`,
					"",
				])
			: [
					result.zotero.configured
						? "已优先检索用户 Zotero 文献库，但未命中可用条目。"
						: "Zotero 未配置，已跳过用户文献库检索，不影响外部数据库检索。",
					"",
				];
	const similarWorkLines =
		result.similarWorks.length > 0
			? result.similarWorks.flatMap((work, index) => [
					`### ${index + 1}. ${work.title}`,
					"",
					`- 年份：${work.year ?? "未知"}`,
					`- 链接：${work.url ?? "未知"}`,
					`- 相似点：${work.similarity}`,
					`- 不同点：${work.difference}`,
					`- 对创新性的威胁程度：${work.noveltyThreat}`,
					"",
				])
			: ["未检索到可用相似论文。请扩大关键词、放宽年份限制或稍后重试 API。", ""];

	return [
		"# 研究想法查重与可行性评估报告",
		"",
		"> 说明：本报告是 novelty check / related work check，只能辅助识别相似工作和创新性风险，不能替代 iThenticate、Turnitin 或学校查重系统。",
		"",
		"## 1. 用户想法复述",
		"",
		result.idea,
		"",
		"## 2. 想法拆解",
		"",
		`- 研究对象：${decomposition.researchObject}`,
		`- 应用场景：${decomposition.applicationScene}`,
		`- 核心方法：${decomposition.coreMethod}`,
		`- 预期贡献：${decomposition.expectedContribution}`,
		`- 需要的数据：${decomposition.requiredData}`,
		`- 需要的实验：${decomposition.requiredExperiments}`,
		"",
		"## 3. 自动生成的关键词",
		"",
		...formatList(result.keywords, "未能稳定抽取关键词。"),
		"",
		"英文检索式：",
		"",
		`> ${result.englishQuery}`,
		"",
		"## 4. 用户 Zotero 文献库命中",
		"",
		...zoteroLines,
		...(result.zotero.warnings.length > 0
			? ["Zotero 检索提示：", "", ...result.zotero.warnings.map((warning) => `- ${warning}`), ""]
			: []),
		"## 5. 最相似相关工作",
		"",
		...similarWorkLines,
		"## 6. 创新性风险评估",
		"",
		"### 高风险点",
		"",
		...formatList(risks.high, "暂无高风险点。"),
		"",
		"### 中风险点",
		"",
		...formatList(risks.medium, "暂无中风险点。"),
		"",
		"### 低风险点",
		"",
		...formatList(risks.low, "暂无低风险点。"),
		"",
		"## 7. 技术可行性评估",
		"",
		...formatList(result.technicalFeasibility, "需要进一步明确技术路线。"),
		"",
		"## 8. 数据可得性评估",
		"",
		...formatList(result.dataFeasibility, "需要进一步明确数据来源。"),
		"",
		"## 9. 实验成本评估",
		"",
		...formatList(result.experimentCost, "需要进一步明确算力、数据和标注成本。"),
		"",
		"## 10. 可能的审稿人质疑",
		"",
		...formatList(result.reviewerQuestions, "需要结合目标会议和具体方法补充。"),
		"",
		"## 11. 建议修改后的研究定位",
		"",
		...formatList(result.repositioningSuggestions, "建议先精读相似工作后再定位。"),
		"",
		"## 12. 下一步行动清单",
		"",
		...formatList(result.nextActions, "下一步先补充关键词和目标数据集。"),
	].join("\n");
}

export async function checkResearchIdea(options: IdeaCheckOptions): Promise<IdeaCheckResult> {
	const parsed = parseIdeaInput(options.input);
	const idea = parsed.idea;
	const decomposition = decomposeResearchIdea(idea);
	const ideaKeywords = collectIdeaKeywords(idea);
	const limit = options.limit ?? parsed.limit ?? DEFAULT_IDEA_LIMIT;
	const yearFrom = options.yearFrom ?? parsed.yearFrom;
	const zotero = await searchZoteroLibrary({
		query: ideaKeywords.length > 0 ? ideaKeywords.join(" ") : idea,
		limit: Math.min(limit, 10),
		config: options.zoteroConfig,
		fetcher: options.fetcher,
		signal: options.signal,
		logger: options.logger,
	});
	const searchResult = await searchPapers({
		input: idea,
		topic: idea,
		limit,
		yearFrom,
		fetcher: options.fetcher,
		apiKey: options.apiKey,
		signal: options.signal,
		logger: options.logger,
	});
	const keywords = Array.from(new Set([...ideaKeywords, ...searchResult.keywords])).slice(0, 16);
	const similarWorks = buildSimilarWorks(searchResult, ideaKeywords);
	const risks = buildRisks(similarWorks, decomposition);
	const resultWithoutMarkdown = {
		idea,
		decomposition,
		keywords,
		englishQuery: searchResult.englishQuery,
		zotero,
		searchResult,
		similarWorks,
		risks,
		technicalFeasibility: buildTechnicalFeasibility(decomposition),
		dataFeasibility: buildDataFeasibility(),
		experimentCost: buildExperimentCost(),
		reviewerQuestions: buildReviewerQuestions(similarWorks),
		repositioningSuggestions: buildRepositioningSuggestions(),
		nextActions: buildNextActions(),
	};

	return { ...resultWithoutMarkdown, markdown: buildIdeaCheckMarkdown(resultWithoutMarkdown) };
}
