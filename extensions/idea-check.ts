import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { checkResearchIdea } from "../src/idea-check.ts";

export default function ideaCheckExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_check_idea",
		label: "Research Idea Novelty Check",
		description:
			"拆解研究想法，复用 research paper search 检索相似工作，并生成 novelty check 与可行性评估 Markdown 报告。",
		promptSnippet: "Check a research idea against related work and produce a novelty and feasibility Markdown report",
		promptGuidelines: [
			"Use research_check_idea when the user invokes /idea or asks for novelty check of a research idea.",
			"Always state that this is a novelty check / related work check, not a replacement for iThenticate, Turnitin, or institutional plagiarism systems.",
			"After research_check_idea returns Markdown, use research_write_report with category=reports and title=idea-check to save it.",
		],
		parameters: Type.Object({
			idea: Type.String({ description: "用户的研究想法或自然语言描述" }),
			limit: Type.Optional(Type.Number({ description: "用于检索相似工作的论文数量，默认 10" })),
			yearFrom: Type.Optional(Type.Number({ description: "最早发表年份，例如 2020" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await checkResearchIdea({
				input: params.idea,
				limit: params.limit,
				yearFrom: params.yearFrom,
				signal,
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
