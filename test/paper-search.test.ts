import { describe, expect, it } from "vitest";
import {
	buildLiteratureSearchMarkdown,
	normalizePaperTitle,
	parseSearchInput,
	searchPapers,
} from "../src/paper-search.ts";

class TestResponse {
	ok: boolean;
	status: number;
	private body: string;

	constructor(body: unknown, status = 200) {
		this.ok = status >= 200 && status < 300;
		this.status = status;
		this.body = typeof body === "string" ? body : JSON.stringify(body);
	}

	async json(): Promise<unknown> {
		return JSON.parse(this.body);
	}

	async text(): Promise<string> {
		return this.body;
	}
}

describe("paper search service", () => {
	it("parses structured search arguments", () => {
		const input = 'topic="medical image anomaly detection with synthetic data" limit=20 year_from=2020';

		expect(parseSearchInput(input)).toEqual({
			topic: "medical image anomaly detection with synthetic data",
			limit: 20,
			yearFrom: 2020,
		});
	});

	it("infers natural language search arguments", async () => {
		const urls: string[] = [];
		const fetcher = async (url: string) => {
			urls.push(url);
			if (url.includes("semanticscholar")) return new TestResponse({ data: [] });
			if (url.includes("openalex")) return new TestResponse({ results: [] });
			return new TestResponse(`<?xml version="1.0" encoding="UTF-8"?><feed></feed>`);
		};

		const result = await searchPapers({
			input: "/search 我想找医学影像异常检测中使用合成数据增强的论文，最好是 2020 年以后的。",
			fetcher,
		});

		expect(parseSearchInput(result.topic)).toEqual({
			topic: "我想找医学影像异常检测中使用合成数据增强的论文，最好是 2020 年以后的。",
			limit: 10,
			yearFrom: 2020,
		});
		expect(result.englishQuery).toContain("medical imaging");
		expect(result.englishQuery).toContain("anomaly detection");
		expect(result.keywords).toContain("synthetic");
		expect(urls[0]).toContain("year=2020-");
	});

	it("normalizes titles for fallback deduplication", () => {
		expect(normalizePaperTitle("  Medical-Image: Anomaly Detection! ")).toBe("medical image anomaly detection");
	});

	it("continues across API failures, deduplicates papers, and sorts by relevance, year, then citations", async () => {
		const urls: string[] = [];
		const fetcher = async (url: string, init?: { headers?: Record<string, string> }) => {
			urls.push(url);
			if (url.includes("semanticscholar")) {
				expect(init?.headers?.["x-api-key"]).toBe("test-key");
				return new TestResponse({ message: "rate limited" }, 429);
			}
			if (url.includes("openalex")) {
				return new TestResponse({
					results: [
						{
							id: "https://openalex.org/W1",
							display_name: "Synthetic Data for Medical Image Anomaly Detection",
							doi: "https://doi.org/10.123/example",
							publication_year: 2024,
							cited_by_count: 12,
							relevance_score: 19,
							authorships: [{ author: { display_name: "Alice" } }],
							primary_location: { source: { display_name: "CVPR" }, landing_page_url: "https://paper.example" },
							abstract_inverted_index: { Detecting: [0], synthetic: [1], anomalies: [2] },
						},
						{
							id: "https://openalex.org/W2",
							display_name: "Older Medical Imaging Survey",
							publication_year: 2021,
							cited_by_count: 90,
							relevance_score: 3,
							authorships: [{ author: { display_name: "Bob" } }],
							primary_location: { source: { display_name: "Survey Journal" } },
						},
					],
				});
			}
			return new TestResponse(`<?xml version="1.0" encoding="UTF-8"?>
				<feed xmlns="http://www.w3.org/2005/Atom">
					<entry>
						<id>https://arxiv.org/abs/2401.00001</id>
						<title>Synthetic Data for Medical Image Anomaly Detection</title>
						<summary>Duplicate title from arXiv.</summary>
						<published>2024-01-01T00:00:00Z</published>
						<author><name>Carol</name></author>
						<link href="https://arxiv.org/abs/2401.00001" rel="alternate" />
					</entry>
				</feed>`);
		};

		const result = await searchPapers({
			input: 'topic="medical image anomaly detection with synthetic data" limit=10 year_from=2020',
			apiKey: "test-key",
			fetcher,
		});

		expect(urls).toHaveLength(3);
		expect(result.sourceStatuses.map((status) => `${status.source}:${status.status}`)).toEqual([
			"Semantic Scholar:error",
			"OpenAlex:success",
			"arXiv:success",
		]);
		expect(result.papers).toHaveLength(2);
		expect(result.papers[0]?.title).toBe("Synthetic Data for Medical Image Anomaly Detection");
		expect(result.papers[0]?.sources).toEqual(["OpenAlex", "arXiv"]);
		expect(result.papers[1]?.title).toBe("Older Medical Imaging Survey");
		expect(result.warnings[0]).toContain("Semantic Scholar");
	});

	it("uses the public Semantic Scholar endpoint without an API key and falls back gracefully", async () => {
		const semanticScholarHeaders: Array<Record<string, string> | undefined> = [];
		const fetcher = async (url: string, init?: { headers?: Record<string, string> }) => {
			if (url.includes("semanticscholar")) {
				semanticScholarHeaders.push(init?.headers);
				return new TestResponse({ message: "public endpoint unavailable" }, 503);
			}
			if (url.includes("openalex")) {
				return new TestResponse({
					results: [
						{
							id: "https://openalex.org/W-public",
							display_name: "Public Fallback Medical Image Anomaly Detection",
							publication_year: 2025,
							cited_by_count: 3,
							relevance_score: 12,
							authorships: [{ author: { display_name: "Fallback Author" } }],
							primary_location: { source: { display_name: "OpenAlex Venue" } },
						},
					],
				});
			}
			return new TestResponse(`<?xml version="1.0" encoding="UTF-8"?><feed></feed>`);
		};

		const result = await searchPapers({
			input: 'topic="medical image anomaly detection" limit=5',
			apiKey: "",
			fetcher,
		});

		expect(semanticScholarHeaders).toEqual([undefined]);
		expect(result.sourceStatuses.map((status) => `${status.source}:${status.status}`)).toEqual([
			"Semantic Scholar:error",
			"OpenAlex:success",
			"arXiv:success",
		]);
		expect(result.papers).toHaveLength(1);
		expect(result.papers[0]?.title).toBe("Public Fallback Medical Image Anomaly Detection");
		expect(result.markdown).toContain("Semantic Scholar 检索失败，已继续尝试后续数据源");
	});

	it("deduplicates DOI matches even when source titles differ", async () => {
		const fetcher = async (url: string) => {
			if (url.includes("semanticscholar")) {
				return new TestResponse({
					data: [
						{
							paperId: "S1",
							title: "Synthetic Data Robust Anomaly Detection",
							authors: [{ name: "Alice" }],
							year: 2024,
							citationCount: 5,
							externalIds: { DOI: "10.555/synthetic-anomaly" },
						},
					],
				});
			}
			if (url.includes("openalex")) {
				return new TestResponse({
					results: [
						{
							id: "https://openalex.org/W-doi",
							display_name: "Robust Anomaly Detection with Synthetic Data",
							doi: "https://doi.org/10.555/synthetic-anomaly",
							publication_year: 2025,
							cited_by_count: 40,
							relevance_score: 88,
							authorships: [{ author: { display_name: "Bob" } }],
							primary_location: { source: { display_name: "CVPR" } },
						},
					],
				});
			}
			return new TestResponse(`<?xml version="1.0" encoding="UTF-8"?><feed></feed>`);
		};

		const result = await searchPapers({
			input: 'topic="synthetic anomaly detection" limit=10',
			fetcher,
		});

		expect(result.papers).toHaveLength(1);
		expect(result.papers[0]?.sources).toEqual(["Semantic Scholar", "OpenAlex"]);
		expect(result.papers[0]?.citationCount).toBe(40);
	});

	it("builds the required Markdown report sections", async () => {
		const markdown = buildLiteratureSearchMarkdown({
			topic: "medical image anomaly detection",
			englishQuery: "medical image anomaly detection",
			keywords: ["medical", "image", "anomaly", "detection"],
			sourceStatuses: [{ source: "OpenAlex", status: "success", count: 1 }],
			warnings: [],
			papers: [
				{
					id: "1",
					title: "Medical Image Anomaly Detection",
					authors: ["Alice"],
					year: 2024,
					venue: "CVPR",
					citationCount: 10,
					url: "https://example.com",
					doi: "10.123/example",
					abstract: "A paper about medical image anomaly detection.",
					source: "OpenAlex",
					sources: ["OpenAlex"],
					relevanceScore: 10,
					relevanceReason: "标题或摘要与检索主题高度匹配。",
					readingPriority: "高",
				},
			],
		});

		expect(markdown).toContain("# 文献检索报告");
		expect(markdown).toContain("## 4. Top 论文列表");
		expect(markdown).toContain("## 8. 下一步建议");
	});
});
