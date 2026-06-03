import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { saveMarkdownReport } from "../src/report-writer.ts";

const reportCategories = ["reports", "reviews", "notes", "logs"] as const;

export default function reportWriterExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_write_report",
		label: "Research Report Writer",
		description: "把 linlic-agent 生成的科研 Markdown 内容保存到 research_workspace。",
		promptSnippet: "Save Markdown research output into research_workspace reports, reviews, notes, or logs",
		promptGuidelines: [
			"Use research_write_report after generating a linlic-agent research report, review, note, or log.",
			"Use research_write_report with category=reports for literature search, paper analysis, and idea reports.",
			"Use research_write_report with category=reviews for experiment reviews, paper reviews, and goal plans.",
		],
		parameters: Type.Object({
			category: StringEnum(reportCategories, { description: "保存目录分类" }),
			title: Type.String({ description: "用于生成文件名的简短标题" }),
			content: Type.String({ description: "完整 Markdown 内容" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await saveMarkdownReport({
				cwd: ctx.cwd,
				category: params.category,
				title: params.title,
				content: params.content,
			});

			return {
				content: [{ type: "text", text: `已保存 Markdown：${result.relativePath}` }],
				details: result,
			};
		},
	});
}
