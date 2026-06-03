import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReviewInput, reviewDraft } from "../src/review-draft.ts";

const markdownDraft = `
# Robust Medical Image Anomaly Detection

## Abstract
We study medical image anomaly detection and propose synthetic data augmentation.

## Introduction
Medical image analysis can suffer from limited anomaly labels. The paper aims to improve robustness.

## Related Work
Existing anomaly detection methods include PatchCore, PaDiM, FastFlow, and reconstruction-based approaches.

## Method
The method synthesizes training samples and trains an anomaly detection model.

## Experiments
We evaluate on public benchmark datasets. Baselines include representative anomaly detection methods. Metrics include AUROC and F1. Ablation removes synthetic augmentation.

## Conclusion
The method improves anomaly detection but needs broader validation.

## References
[1] PatchCore. [2] PaDiM.
`;

const latexDraft = String.raw`
\title{Robust Medical Image Anomaly Detection}
\begin{abstract}
We study medical image anomaly detection with synthetic data augmentation.
\end{abstract}
\section{Introduction}
Medical image analysis has limited labeled anomalies.
\section{Related Work}
PatchCore and PaDiM are related methods.
\section{Method}
We synthesize training samples.
\section{Experiments}
We compare with baselines using AUROC.
\section{Conclusion}
The method is promising.
`;

describe("draft review service", () => {
	it("parses review command arguments", () => {
		expect(parseReviewInput('/review research_workspace/drafts/paper.md target="target venue"')).toEqual({
			filePath: "research_workspace/drafts/paper.md",
			target: "target venue",
		});
		expect(parseReviewInput('file="research_workspace/drafts/paper.tex" target="中文核心期刊"')).toEqual({
			filePath: "research_workspace/drafts/paper.tex",
			target: "中文核心期刊",
		});
	});

	it("reviews a Markdown draft without modifying the source file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-review-md-"));
		const draftPath = join(dir, "paper.md");
		await writeFile(draftPath, markdownDraft, "utf8");

		try {
			const result = await reviewDraft({
				cwd: dir,
				input: `/review ${draftPath} target="target venue"`,
				maxChunkChars: 450,
			});

			expect(result.target).toBe("target venue");
			expect(result.format).toBe("markdown");
			expect(result.sections.map((section) => section.kind)).toContain("abstract");
			expect(result.sections.map((section) => section.kind)).toContain("experiments");
			expect(result.chunkReviews.length).toBeGreaterThan(1);
			expect(result.markdown).toContain("# 论文草稿模拟评审报告");
			expect(result.markdown).toContain("## 18. 模拟审稿结论");
			expect(result.markdown).toContain("- Weak Accept");
			expect(result.markdown).toContain("## 19. 修改建议清单");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("adds optional Zotero citation coverage notes when Zotero is configured", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-review-zotero-"));
		const draftPath = join(dir, "paper.md");
		await writeFile(
			draftPath,
			`${markdownDraft}\n\nWe compare with recent medical imaging work [@li2023medical].`,
			"utf8",
		);
		const urls: string[] = [];
		const fetcher = async (url: string) => {
			urls.push(url);
			return {
				ok: true,
				status: 200,
				async json() {
					return [
						{
							key: "LI2023",
							data: {
								title: "Medical Image Anomaly Detection",
								creators: [{ creatorType: "author", firstName: "Chen", lastName: "Li" }],
								date: "2023",
								publicationTitle: "TII",
							},
						},
					];
				},
				async text() {
					return "[]";
				},
			};
		};

		try {
			const result = await reviewDraft({
				cwd: dir,
				input: `/review ${draftPath} target="target venue"`,
				maxChunkChars: 450,
				zoteroConfig: { apiKey: "api-key", userId: "12345" },
				fetcher,
			});

			expect(urls[0]).toContain("api.zotero.org/users/12345/items");
			expect(result.citationCheck.configured).toBe(true);
			expect(result.citationCheck.citationKeys).toContain("li2023medical");
			expect(result.markdown).toContain("Zotero 引用完整性检查");
			expect(result.markdown).toContain("Medical Image Anomaly Detection");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("reviews a LaTeX draft and detects major sections", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-review-tex-"));
		const draftPath = join(dir, "paper.tex");
		await writeFile(draftPath, latexDraft, "utf8");

		try {
			const result = await reviewDraft({
				cwd: dir,
				input: `file="${draftPath}" target="中文核心期刊"`,
				maxChunkChars: 500,
			});

			expect(result.format).toBe("latex");
			expect(result.sections.map((section) => section.kind)).toEqual(
				expect.arrayContaining(["abstract", "introduction", "related_work", "method", "experiments", "conclusion"]),
			);
			expect(result.markdown).toContain("中文核心期刊");
			expect(result.markdown).toContain("## 14. 主要问题 Major Weaknesses");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("reviews a multi-file LaTeX project with formulas, figures, tables, and appendix", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-review-complex-tex-"));
		await mkdir(join(dir, "sections"), { recursive: true });
		const draftPath = join(dir, "main.tex");
		await writeFile(
			draftPath,
			String.raw`
\newcommand{\method}{SynthMix}
\begin{abstract}
We propose \method{} for medical image anomaly detection.
\end{abstract}
\input{sections/body}
\appendix
\input{sections/appendix}
`,
			"utf8",
		);
		await writeFile(
			join(dir, "sections", "body.tex"),
			String.raw`
\section{Introduction}
The task is medical image anomaly detection.
\section{Method}
\begin{align}
s(x) &= f_\theta(x) + \lambda h(x)
\label{eq:score}
\end{align}
\begin{figure}
\includegraphics{pipeline.png}
\caption{Overall pipeline.}
\label{fig:pipeline}
\end{figure}
\section{Experiments}
\begin{table}
\caption{AUROC comparison.}
\label{tab:auroc}
\end{table}
`,
			"utf8",
		);
		await writeFile(
			join(dir, "sections", "appendix.tex"),
			String.raw`
\section{Extra Ablations}
Additional ablation results are reported here.
`,
			"utf8",
		);

		try {
			const result = await reviewDraft({
				cwd: dir,
				input: `file="${draftPath}" target="target venue"`,
				maxChunkChars: 500,
			});

			expect(result.latex?.formulas[0]?.label).toBe("eq:score");
			expect(result.latex?.figures[0]?.label).toBe("fig:pipeline");
			expect(result.latex?.tables[0]?.label).toBe("tab:auroc");
			expect(result.latex?.appendixSections[0]?.heading).toBe("Extra Ablations");
			expect(result.markdown).toContain("LaTeX 结构审查");
			expect(result.markdown).toContain("公式块：1");
			expect(result.markdown).toContain("图环境：1");
			expect(result.markdown).toContain("附录章节：Extra Ablations");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("reports clear errors for missing and unsupported draft files", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-review-errors-"));
		const pdfPath = join(dir, "paper.pdf");
		await writeFile(pdfPath, "%PDF-1.7\n", "utf8");

		try {
			await expect(reviewDraft({ cwd: dir, input: "missing.md" })).rejects.toThrow("草稿文件不存在");
			await expect(reviewDraft({ cwd: dir, input: pdfPath })).rejects.toThrow("仅支持 Markdown、LaTeX 或 TXT");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
