import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { searchPapers } from "../src/paper-search.ts";

export default function semanticScholarExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_search_papers",
		label: "Research Paper Search",
		description:
			"根据研究方向检索论文。优先 Semantic Scholar，失败时继续 OpenAlex 和 arXiv，返回去重排序后的 Markdown 文献检索报告。",
		promptSnippet:
			"Search papers with Semantic Scholar, OpenAlex, and arXiv, then return a Markdown literature report",
		promptGuidelines: [
			"Use research_search_papers when the user invokes /search or asks linlic-agent to search literature.",
			"After research_search_papers returns Markdown, use research_write_report with category=reports to save it.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "研究方向、关键词或自然语言检索需求" }),
			limit: Type.Optional(Type.Number({ description: "返回论文数量，默认 10，最大 50" })),
			yearFrom: Type.Optional(Type.Number({ description: "最早发表年份，例如 2020" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await searchPapers({
				input: params.query,
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
