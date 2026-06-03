import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ensureResearchWorkspace } from "../src/workspace.ts";

export default function workspaceExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_prepare_workspace",
		label: "Research Workspace",
		description: "创建或确认 linlic-agent 的 research_workspace 目录结构。",
		promptSnippet:
			"Create the research_workspace directory tree for research notes, reports, reviews, drafts, papers, and logs",
		promptGuidelines: [
			"Use research_prepare_workspace before saving any linlic-agent research artifact.",
			"Do not use research_prepare_workspace to modify paper drafts; it only prepares directories.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const result = await ensureResearchWorkspace(ctx.cwd);
			const lines = [
				`已准备科研工作区：${result.workspaceRoot}`,
				...Object.entries(result.directories).map(([name, path]) => `- ${name}: ${path}`),
			];

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: result,
			};
		},
	});
}
