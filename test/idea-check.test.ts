import { describe, expect, it } from "vitest";
import { checkResearchIdea, decomposeResearchIdea } from "../src/idea-check.ts";

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

describe("idea check service", () => {
	it("decomposes a generic medical imaging anomaly detection idea", () => {
		const decomposition = decomposeResearchIdea("我想做一个医学影像异常检测方法，通过合成数据增强提升少样本鲁棒性。");

		expect(decomposition.researchObject).toContain("医学影像");
		expect(decomposition.applicationScene).toContain("医学");
		expect(decomposition.coreMethod).toContain("合成数据");
		expect(decomposition.requiredExperiments).toContain("baseline");
	});

	it("reuses paper search results to build novelty and feasibility report", async () => {
		const urls: string[] = [];
		const fetcher = async (url: string) => {
			urls.push(url);
			if (url.includes("semanticscholar")) {
				return new TestResponse({
					data: [
						{
							paperId: "s2-1",
							title: "Synthetic Data Augmentation for Medical Image Anomaly Detection",
							authors: [{ name: "Alice" }],
							year: 2024,
							venue: "CVPR",
							citationCount: 18,
							url: "https://example.com/synthetic",
							abstract:
								"We synthesize training samples to improve anomaly detection robustness in medical imaging.",
							externalIds: { DOI: "10.1234/synthetic" },
						},
						{
							paperId: "s2-2",
							title: "General Texture Anomaly Detection",
							authors: [{ name: "Bob" }],
							year: 2021,
							venue: "ICCV",
							citationCount: 120,
							url: "https://example.com/texture",
							abstract: "A general anomaly detection method for texture defects.",
							externalIds: {},
						},
					],
				});
			}
			if (url.includes("openalex")) return new TestResponse({ results: [] });
			return new TestResponse(`<?xml version="1.0" encoding="UTF-8"?><feed></feed>`);
		};

		const result = await checkResearchIdea({
			input: "/idea 我想做一个医学影像异常检测方法，通过合成数据增强提升少样本鲁棒性。",
			limit: 5,
			fetcher,
		});

		expect(urls.some((url) => url.includes("semanticscholar"))).toBe(true);
		expect(result.searchResult.papers).toHaveLength(2);
		expect(result.similarWorks[0]?.title).toBe("Synthetic Data Augmentation for Medical Image Anomaly Detection");
		expect(result.similarWorks[0]?.noveltyThreat).toBe("高");
		expect(result.markdown).toContain("# 研究想法查重与可行性评估报告");
		expect(result.markdown).toContain("不能替代 iThenticate、Turnitin 或学校查重系统");
		expect(result.markdown).toContain("## 12. 下一步行动清单");
	});

	it("parses structured idea arguments before calling paper search", async () => {
		const urls: string[] = [];
		const fetcher = async (url: string) => {
			urls.push(url);
			if (url.includes("semanticscholar")) return new TestResponse({ data: [] });
			if (url.includes("openalex")) return new TestResponse({ results: [] });
			return new TestResponse(`<?xml version="1.0" encoding="UTF-8"?><feed></feed>`);
		};

		const result = await checkResearchIdea({
			input: 'idea="synthetic data augmentation for medical image anomaly detection" limit=3 year_from=2020',
			fetcher,
		});

		expect(result.idea).toBe("synthetic data augmentation for medical image anomaly detection");
		expect(urls[0]).toContain("limit=6");
		expect(urls[0]).toContain("year=2020-");
	});

	it("checks configured Zotero library before external paper search", async () => {
		const urls: string[] = [];
		const fetcher = async (url: string) => {
			urls.push(url);
			if (url.includes("api.zotero.org")) {
				return new TestResponse([
					{
						key: "ZOTERO1",
						data: {
							title: "Medical Image Anomaly Detection with Data Augmentation",
							creators: [{ creatorType: "author", firstName: "Chen", lastName: "Li" }],
							date: "2023",
							publicationTitle: "TII",
							DOI: "10.1000/zotero",
							url: "https://example.com/zotero",
							abstractNote: "Existing library paper about medical image anomaly detection.",
						},
					},
				]);
			}
			if (url.includes("semanticscholar")) return new TestResponse({ data: [] });
			if (url.includes("openalex")) return new TestResponse({ results: [] });
			return new TestResponse(`<?xml version="1.0" encoding="UTF-8"?><feed></feed>`);
		};

		const result = await checkResearchIdea({
			input: "/idea 医学影像异常检测",
			fetcher,
			zoteroConfig: { apiKey: "api-key", userId: "12345" },
		});

		expect(urls[0]).toContain("api.zotero.org/users/12345/items");
		expect(urls.some((url) => url.includes("semanticscholar"))).toBe(true);
		expect(result.zotero?.configured).toBe(true);
		expect(result.zotero?.items[0]?.title).toBe("Medical Image Anomaly Detection with Data Augmentation");
		expect(result.markdown).toContain("## 4. 用户 Zotero 文献库命中");
		expect(result.markdown).toContain("Medical Image Anomaly Detection with Data Augmentation");
	});
});
