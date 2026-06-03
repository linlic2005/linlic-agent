import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCitations, parseCitationCheckInput } from "../src/citation-check.ts";

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

const markdownDraft = `
# Medical Image Anomaly Detection

## Abstract
Medical image anomaly detection has achieved strong performance on several public benchmarks.

## Introduction
Recent methods can handle limited labeled anomalies without additional annotation.
This claim has no citation.

## Related Work
Classical defect detection methods were widely studied [@smith2016defect].
PatchCore is a strong nearest-neighbor baseline [@roth2022patchcore].

## Method
Our method improves medical image anomaly detection.
`;

const latexDraft = String.raw`
\title{Medical Image Anomaly Detection}
\begin{abstract}
Medical image anomaly detection is solved for all public benchmarks.
\end{abstract}
\section{Introduction}
Recent methods can handle limited labeled anomalies without extra data.
\section{Related Work}
Classical anomaly detection was studied in \cite{smith2015anomaly}.
`;

describe("citation check service", () => {
	it("parses citation-check command arguments", () => {
		expect(parseCitationCheckInput("/citation-check research_workspace/drafts/paper.md")).toEqual({
			filePath: "research_workspace/drafts/paper.md",
		});
		expect(parseCitationCheckInput('file="research_workspace/drafts/paper.tex" limit=6')).toEqual({
			filePath: "research_workspace/drafts/paper.tex",
			limit: 6,
		});
	});

	it("checks Markdown drafts and reuses paper search for suggested new references", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-citation-md-"));
		const draftPath = join(dir, "paper.md");
		await writeFile(draftPath, markdownDraft, "utf8");
		const urls: string[] = [];
		const fetcher = async (url: string) => {
			urls.push(url);
			if (url.includes("semanticscholar")) {
				return new TestResponse({
					data: [
						{
							paperId: "s2-1",
							title: "Synthetic Data Robust Medical Image Anomaly Detection",
							authors: [{ name: "Alice Zhang" }],
							year: 2024,
							venue: "CVPR",
							citationCount: 18,
							url: "https://example.com/synthetic",
							abstract: "A recent paper about synthetic data robustness for medical image anomaly detection.",
							externalIds: { DOI: "10.1234/synthetic" },
						},
					],
				});
			}
			if (url.includes("openalex")) return new TestResponse({ results: [] });
			return new TestResponse(`<?xml version="1.0" encoding="UTF-8"?><feed></feed>`);
		};

		try {
			const result = await checkCitations({
				cwd: dir,
				input: `/citation-check ${draftPath}`,
				fetcher,
				limit: 5,
			});

			expect(result.format).toBe("markdown");
			expect(result.missingCitations.length).toBeGreaterThan(0);
			expect(result.unsupportedCitations[0]?.status).toBe("需要人工确认");
			expect(result.outdatedCitations[0]?.citationKey).toBe("smith2016defect");
			expect(result.suggestedPapers[0]?.title).toBe("Synthetic Data Robust Medical Image Anomaly Detection");
			expect(result.bibtexSuggestions).toContain("@article{zhang2024synthetic");
			expect(result.markdown).toContain("# 引用检查报告");
			expect(result.markdown).toContain("## 7. BibTeX 建议");
			expect(result.markdown).toContain("需要人工确认");
			expect(urls.some((url) => url.includes("semanticscholar"))).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("checks LaTeX drafts and extracts cite keys", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-citation-tex-"));
		const draftPath = join(dir, "paper.tex");
		await writeFile(draftPath, latexDraft, "utf8");
		const fetcher = async (url: string) => {
			if (url.includes("semanticscholar")) return new TestResponse({ data: [] });
			if (url.includes("openalex")) return new TestResponse({ results: [] });
			return new TestResponse(`<?xml version="1.0" encoding="UTF-8"?><feed></feed>`);
		};

		try {
			const result = await checkCitations({
				cwd: dir,
				input: `file="${draftPath}" limit=3`,
				fetcher,
			});

			expect(result.format).toBe("latex");
			expect(result.citationKeys).toContain("smith2015anomaly");
			expect(result.outdatedCitations[0]?.citationKey).toBe("smith2015anomaly");
			expect(result.markdown).toContain("smith2015anomaly");
			expect(result.markdown).toContain("## 8. 修改建议");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
