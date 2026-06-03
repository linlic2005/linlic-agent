import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyzePaperPdf } from "../src/paper-analysis.ts";

export default function pdfExtractExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_analyze_paper_pdf",
		label: "Research Paper PDF Analysis",
		description: "读取本地 PDF，抽取文本，识别论文结构，分块并生成结构化 Markdown 论文分析草稿。",
		promptSnippet: "Extract and analyze a local research paper PDF into a bounded Markdown paper-analysis draft",
		promptGuidelines: [
			"Use research_analyze_paper_pdf when the user invokes /paper with a PDF path.",
			"Do not paste raw full PDF text into the model context; use the Markdown draft and chunk summaries returned by this tool.",
			"After generating the final paper analysis Markdown, save it with research_write_report category=notes and title=paper-analysis.",
		],
		parameters: Type.Object({
			filePath: Type.String({ description: "本地 PDF 路径，可以是绝对路径或相对于当前工作目录的路径" }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await analyzePaperPdf({
				cwd: ctx.cwd,
				input: params.filePath,
				signal,
			});

			const details = {
				filePath: result.filePath,
				metadata: result.metadata,
				abstract: result.abstract,
				sections: result.sections.map((section) => ({
					heading: section.heading,
					startChar: section.startChar,
					endChar: section.endChar,
					preview: section.text.slice(0, 800),
				})),
				chunkSummaries: result.chunkSummaries,
				textCharCount: result.textCharCount,
			};

			return {
				content: [{ type: "text", text: result.markdown }],
				details,
			};
		},
	});
}
