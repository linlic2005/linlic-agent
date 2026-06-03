import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportPapersToBibtex, searchZoteroLibrary, type ZoteroHttpResponseLike } from "../src/zotero.ts";

class TestResponse implements ZoteroHttpResponseLike {
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

describe("zotero service", () => {
	it("returns a graceful fallback when Zotero is not configured", async () => {
		const result = await searchZoteroLibrary({
			query: "medical image anomaly detection",
			config: {},
			fetcher: async () => new TestResponse([]),
		});

		expect(result.configured).toBe(false);
		expect(result.items).toEqual([]);
		expect(result.warnings[0]).toContain("Zotero 未配置");
	});

	it("searches the configured user library with Zotero Web API headers", async () => {
		const urls: string[] = [];
		const headers: Array<Record<string, string> | undefined> = [];
		const result = await searchZoteroLibrary({
			query: "medical anomaly",
			config: { apiKey: "api-key", userId: "12345" },
			fetcher: async (url, init) => {
				urls.push(url);
				headers.push(init?.headers);
				return new TestResponse([
					{
						key: "ABCD1234",
						version: 7,
						data: {
							itemType: "journalArticle",
							title: "Medical Image Anomaly Detection",
							creators: [{ creatorType: "author", firstName: "Alice", lastName: "Zhang" }],
							date: "2024",
							publicationTitle: "CVPR",
							DOI: "10.1234/medical",
							url: "https://example.com/medical",
							abstractNote: "A paper about medical image anomaly detection.",
						},
					},
				]);
			},
		});

		expect(urls[0]).toContain("https://api.zotero.org/users/12345/items");
		expect(urls[0]).toContain("q=medical+anomaly");
		expect(urls[0]).toContain("qmode=titleCreatorYear");
		expect(headers[0]?.["Zotero-API-Key"]).toBe("api-key");
		expect(headers[0]?.["Zotero-API-Version"]).toBe("3");
		expect(result.items[0]?.title).toBe("Medical Image Anomaly Detection");
		expect(result.items[0]?.authors).toEqual(["Alice Zhang"]);
	});

	it("uses group library when group id is configured", async () => {
		const urls: string[] = [];
		await searchZoteroLibrary({
			query: "inspection",
			config: { apiKey: "api-key", userId: "12345", groupId: "999" },
			fetcher: async (url) => {
				urls.push(url);
				return new TestResponse([]);
			},
		});

		expect(urls[0]).toContain("https://api.zotero.org/groups/999/items");
	});

	it("exports paper search results to BibTeX file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-zotero-bibtex-"));
		try {
			const result = await exportPapersToBibtex({
				cwd: dir,
				title: "search-export",
				timestamp: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
				papers: [
					{
						title: "Medical Image Anomaly Detection",
						authors: ["Alice Zhang", "Bob Chen"],
						year: 2024,
						venue: "CVPR",
						doi: "10.1234/medical",
						url: "https://example.com/medical",
					},
				],
			});

			const bibtex = await readFile(result.absolutePath, "utf8");
			expect(result.relativePath).toBe("research_workspace/notes/search-export-20260102-030405.bib");
			expect(bibtex).toContain("@article{zhang2024medical");
			expect(bibtex).toContain("doi = {10.1234/medical}");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
