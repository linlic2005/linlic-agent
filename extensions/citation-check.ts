import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { checkCitations } from "../src/citation-check.ts";

export default function citationCheckExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_check_citations",
		label: "Research Citation Check",
		description:
			"读取 Markdown 或 LaTeX 论文草稿，检查缺少引用、可疑引用支持关系、过旧引用、格式问题和需要补充的新论文。",
		promptSnippet: "Check citations in a research draft and produce a structured Markdown citation report",
		promptGuidelines: [
			"Use research_check_citations when the user invokes /citation-check with a draft path.",
			"Do not invent citations. Suggested papers must come from the tool result or explicit user-provided references.",
			"Mark uncertain citation support as 需要人工确认.",
			"After research_check_citations returns Markdown, use research_write_report with category=reviews and title=citation-check to save it.",
		],
		parameters: Type.Object({
			filePath: Type.String({ description: "Markdown 或 LaTeX 草稿路径" }),
			limit: Type.Optional(Type.Number({ description: "建议补充论文数量，默认 8" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const input = params.limit ? `file="${params.filePath}" limit=${params.limit}` : params.filePath;
			const result = await checkCitations({
				cwd: ctx.cwd,
				input,
				signal,
				limit: params.limit,
				logger: {
					warn(message) {
						ctx.ui.notify(message, "warning");
					},
				},
			});

			return {
				content: [{ type: "text", text: result.markdown }],
				details: result,
			};
		},
	});
}
