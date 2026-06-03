import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLatexDraftProject } from "../src/latex-draft.ts";

describe("latex draft project parser", () => {
	it("expands common project includes and extracts macros, equations, figures, tables, appendix, and references", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-latex-project-"));
		await mkdir(join(dir, "sections"), { recursive: true });
		await mkdir(join(dir, "figures"), { recursive: true });

		const mainPath = join(dir, "main.tex");
		await writeFile(
			mainPath,
			String.raw`
\documentclass{article}
\newcommand{\method}{SynthMix}
\begin{document}
\title{Synthetic Data Anomaly Detection}
\begin{abstract}
We use \method{} for medical image anomaly detection.
\end{abstract}
\input{sections/intro}
\include{sections/method}
\input{sections/missing}
\appendix
\input{sections/appendix}
\end{document}
`,
			"utf8",
		);
		await writeFile(
			join(dir, "sections", "intro.tex"),
			String.raw`
\section{Introduction}
Medical image analysis uses anomaly detection \cite{baseline}.
Figure~\ref{fig:pipeline} shows the pipeline.
`,
			"utf8",
		);
		await writeFile(
			join(dir, "sections", "method.tex"),
			String.raw`
\section{Method}
The \method{} objective is:
\begin{equation}
\mathcal{L} = \mathcal{L}_{rec} + \lambda \mathcal{L}_{highlight}
\label{eq:loss}
\end{equation}
\begin{figure}
\includegraphics[width=.8\linewidth]{figures/pipeline.pdf}
\caption{Pipeline of \method{}.}
\label{fig:pipeline}
\end{figure}
\begin{table}
\caption{Main benchmark results.}
\label{tab:main}
\end{table}
`,
			"utf8",
		);
		await writeFile(
			join(dir, "sections", "appendix.tex"),
			String.raw`
\section{Additional Experiments}
We report more ablations in Appendix.
`,
			"utf8",
		);

		try {
			const result = await parseLatexDraftProject(mainPath);

			expect(result.files.map((file) => file.path)).toEqual(
				expect.arrayContaining([
					mainPath,
					join(dir, "sections", "intro.tex"),
					join(dir, "sections", "method.tex"),
					join(dir, "sections", "appendix.tex"),
				]),
			);
			expect(result.expandedContent).toContain("SynthMix");
			expect(result.macros.map((macro) => macro.name)).toContain("method");
			expect(result.formulas[0]?.label).toBe("eq:loss");
			expect(result.figures[0]?.label).toBe("fig:pipeline");
			expect(result.figures[0]?.graphics).toContain("figures/pipeline.pdf");
			expect(result.tables[0]?.label).toBe("tab:main");
			expect(result.appendixSections.map((section) => section.heading)).toContain("Additional Experiments");
			expect(result.citations).toContain("baseline");
			expect(result.refs).toContain("fig:pipeline");
			expect(result.warnings[0]).toContain("无法解析 LaTeX 子文件");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
