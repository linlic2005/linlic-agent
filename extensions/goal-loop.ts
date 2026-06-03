import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runGoalReviewLoop } from "../src/goal-loop.ts";

export default function goalLoopExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_goal_loop",
		label: "Research Goal Review-Revise Loop",
		description: "根据论文草稿和投稿目标执行多轮 review-revise loop，并保存每轮中间结果和最终总结。",
		promptSnippet: "Run a bounded multi-round review-revise loop for a local paper draft and save all artifacts",
		promptGuidelines: [
			"Use research_goal_loop when the user invokes /goal with a target and draft path.",
			"Never overwrite the original draft. The tool backs it up and writes revised drafts into a goal run directory.",
			"Do not start an unbounded loop. maxRounds defaults to 3 and is clamped to 6.",
		],
		parameters: Type.Object({
			target: Type.String({ description: "投稿目标、验收目标或修改目标" }),
			draft: Type.String({ description: "Markdown、LaTeX 或 TXT 草稿路径" }),
			maxRounds: Type.Optional(Type.Number({ description: "最大轮数，默认 3，最大 6" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await runGoalReviewLoop({
				cwd: ctx.cwd,
				input: `target="${params.target}" draft="${params.draft}"${
					params.maxRounds ? ` max_rounds=${params.maxRounds}` : ""
				}`,
			});

			return {
				content: [{ type: "text", text: result.markdown }],
				details: result,
			};
		},
	});
}
