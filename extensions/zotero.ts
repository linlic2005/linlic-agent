import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type BibtexPaperLike, exportPapersToBibtex, searchZoteroLibrary } from "../src/zotero.ts";

export default function zoteroExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_zotero_search",
		label: "Research Zotero Search",
		description: "读取用户配置的 Zotero Web API 文献库，根据关键词查找已有文献；未配置时返回可读提示。",
		promptSnippet: "Search the configured Zotero library before external literature search",
		promptGuidelines: [
			"Use research_zotero_search when the user asks to search their Zotero library or asks /idea to check existing personal references first.",
			"If Zotero is not configured, explain the missing environment variables and continue with other available research tools.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "用于检索 Zotero 文献库的关键词或英文检索式" }),
			limit: Type.Optional(Type.Number({ description: "返回条目数量，默认 10，最大 100" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await searchZoteroLibrary({
				query: params.query,
				limit: params.limit,
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

	pi.registerTool({
		name: "research_export_bibtex",
		label: "Research Export BibTeX",
		description: "把论文列表导出为 BibTeX 文件，保存到 research_workspace/notes/。",
		promptSnippet: "Export selected paper search results to a BibTeX file",
		promptGuidelines: [
			"Use research_export_bibtex when the user asks to export /search results or selected papers as BibTeX.",
			"Save generated BibTeX files under research_workspace/notes and report the relative path.",
		],
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "导出文件名前缀，默认 search-export" })),
			papers: Type.Array(
				Type.Object({
					title: Type.String({ description: "论文标题" }),
					authors: Type.Optional(Type.Array(Type.String({ description: "作者姓名" }))),
					year: Type.Optional(Type.Number({ description: "发表年份" })),
					venue: Type.Optional(Type.String({ description: "会议或期刊" })),
					doi: Type.Optional(Type.String({ description: "DOI" })),
					url: Type.Optional(Type.String({ description: "论文链接" })),
					abstract: Type.Optional(Type.String({ description: "摘要" })),
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await exportPapersToBibtex({
				cwd: ctx.cwd,
				title: params.title ?? "search-export",
				papers: params.papers as BibtexPaperLike[],
			});

			return {
				content: [{ type: "text", text: `BibTeX 已保存：${result.relativePath}` }],
				details: result,
			};
		},
	});
}
