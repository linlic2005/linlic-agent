import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { reviewDraft } from "../src/review-draft.ts";

export default function reviewDraftExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_review_draft",
		label: "Research Draft Peer Review",
		description: "读取 Markdown 或 LaTeX 论文草稿，按章节分块，生成模拟同行评审 Markdown 报告。",
		promptSnippet: "Review a local Markdown or LaTeX paper draft and produce a structured peer-review report",
		promptGuidelines: [
			"Use research_review_draft when the user invokes /review with a paper draft path.",
			"Never overwrite the source draft. Save only the generated review report.",
			"After research_review_draft returns Markdown, use research_write_report with category=reviews and title=paper-review to save it.",
		],
		parameters: Type.Object({
			filePath: Type.String({ description: "Markdown、LaTeX 或 TXT 草稿路径" }),
			target: Type.Optional(Type.String({ description: "目标会议、期刊或评审标准" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const input = params.target ? `file="${params.filePath}" target="${params.target}"` : params.filePath;
			const result = await reviewDraft({
				cwd: ctx.cwd,
				input,
				signal,
			});

			return {
				content: [{ type: "text", text: result.markdown }],
				details: result,
			};
		},
	});
}
