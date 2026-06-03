import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzePaperPdf, chunkText, type PdfParseAdapter, parsePaperPathInput } from "../src/paper-analysis.ts";

const samplePaperText = `
Synthetic Data Anomaly Detection for Medical Imaging

Alice Zhang, Bob Chen

Abstract
Limited labeled anomalies make medical image anomaly detection difficult. We propose a robust analysis pipeline that uses synthetic samples while preserving true structural anomalies.

1 Introduction
Medical image analysis often suffers from scarce anomaly labels and distribution shift. This paper studies the problem of anomaly detection under limited supervision.

2 Method
Our method uses synthetic sample generation, feature reconstruction, and a confidence calibration module. The key formula is L = L_rec + lambda L_anomaly.

3 Experiments
We evaluate on public benchmark datasets. Baselines include representative anomaly detection methods. Metrics include AUROC, AP, and F1. Ablation studies remove synthetic augmentation and calibration.

4 Conclusion
The method improves anomaly detection for medical images, but it still depends on representative normal samples.

DOI: 10.1234/synthetic.2024
`;

describe("paper analysis service", () => {
	it("parses /paper path arguments", () => {
		expect(parsePaperPathInput("/paper research_workspace/papers/example.pdf")).toBe(
			"research_workspace/papers/example.pdf",
		);
		expect(parsePaperPathInput('path="research_workspace/papers/example.pdf"')).toBe(
			"research_workspace/papers/example.pdf",
		);
	});

	it("splits long paper text into bounded chunks", () => {
		const chunks = chunkText("A paragraph.\n\n".repeat(80), 120);

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.text.length).toBeLessThanOrEqual(120);
			expect(chunk.text.trim()).not.toBe("");
		}
	});

	it("extracts metadata, sections, chunks, and a Markdown analysis draft from a PDF", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-paper-analysis-"));
		const pdfPath = join(dir, "example.pdf");
		await writeFile(pdfPath, "%PDF-1.7\n% test fixture\n", "utf8");

		const parser: PdfParseAdapter = async () => ({
			text: samplePaperText,
			totalPages: 9,
			info: {
				Title: "Synthetic Data Anomaly Detection for Medical Imaging",
				Author: "Alice Zhang; Bob Chen",
				CreationDate: "D:20240201000000Z",
			},
		});

		try {
			const result = await analyzePaperPdf({
				cwd: dir,
				input: pdfPath,
				parsePdf: parser,
				maxChunkChars: 700,
			});

			expect(result.metadata.title).toBe("Synthetic Data Anomaly Detection for Medical Imaging");
			expect(result.metadata.authors).toEqual(["Alice Zhang", "Bob Chen"]);
			expect(result.metadata.year).toBe(2024);
			expect(result.metadata.doi).toBe("10.1234/synthetic.2024");
			expect(result.abstract).toContain("Limited labeled anomalies");
			expect(result.sections.map((section) => section.heading)).toContain("Method");
			expect(result.chunks.length).toBeGreaterThan(1);
			expect(result.markdown).toContain("# 论文分析报告");
			expect(result.markdown).toContain("## 12. 建议深入阅读的相关论文");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("bounds chunk summaries for very long extracted PDF text", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-paper-analysis-long-"));
		const pdfPath = join(dir, "long.pdf");
		await writeFile(pdfPath, "%PDF-1.7\n% long fixture\n", "utf8");

		const longMethodText = [
			"Long Context Robust Medical Image Analysis",
			"",
			"Abstract",
			"We propose a method for robust medical image anomaly detection with synthetic samples.",
			"",
			"1 Introduction",
			"Medical image analysis requires stable detection under limited labels.",
			"",
			"2 Method",
			`${"The method separates synthetic training signals from structural anomalies with calibrated features. ".repeat(260)}`,
			"",
			"3 Experiments",
			"We evaluate AUROC, AP, and PRO against PatchCore and PaDiM.",
		].join("\n");

		try {
			const result = await analyzePaperPdf({
				cwd: dir,
				input: pdfPath,
				parsePdf: async () => ({ text: longMethodText, totalPages: 42 }),
				maxChunkChars: 1_000,
				maxChunkSummaries: 3,
			});

			expect(result.textCharCount).toBeGreaterThan(10_000);
			expect(result.chunks.length).toBeGreaterThan(3);
			expect(result.chunkSummaries).toHaveLength(3);
			expect(result.markdown).toContain("Chunk 3");
			expect(result.markdown).not.toContain("Chunk 4");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("reports clear errors for missing files, non-PDF paths, invalid PDFs, and empty extracted text", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-paper-analysis-errors-"));
		const txtPath = join(dir, "example.txt");
		const invalidPdfPath = join(dir, "invalid.pdf");
		const emptyFilePath = join(dir, "empty-file.pdf");
		const emptyPdfPath = join(dir, "empty.pdf");
		await writeFile(txtPath, "not a pdf", "utf8");
		await writeFile(invalidPdfPath, "not a pdf", "utf8");
		await writeFile(emptyFilePath, "", "utf8");
		await writeFile(emptyPdfPath, "%PDF-1.7\n", "utf8");

		try {
			await expect(analyzePaperPdf({ cwd: dir, input: "missing.pdf" })).rejects.toThrow("PDF 文件不存在");
			await expect(analyzePaperPdf({ cwd: dir, input: txtPath })).rejects.toThrow("输入文件不是 PDF");
			await expect(analyzePaperPdf({ cwd: dir, input: invalidPdfPath })).rejects.toThrow("PDF 文件头无效");
			await expect(analyzePaperPdf({ cwd: dir, input: emptyFilePath })).rejects.toThrow("PDF 文件头无效");
			await expect(
				analyzePaperPdf({
					cwd: dir,
					input: emptyPdfPath,
					parsePdf: async () => ({ text: "", totalPages: 1 }),
				}),
			).rejects.toThrow("PDF 文本为空");
			await expect(
				analyzePaperPdf({
					cwd: dir,
					input: emptyPdfPath,
					parsePdf: async () => {
						throw new Error("xref table is broken");
					},
				}),
			).rejects.toThrow("PDF 无法解析：xref table is broken");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
