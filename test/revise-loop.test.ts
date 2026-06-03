import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGoalInput, runGoalReviewLoop } from "../src/revise-loop.ts";

const incompleteDraft = `
# Draft

## Abstract
We propose a method.

## Introduction
The problem is important.
`;

const completeDraft = `
# Robust Medical Image Anomaly Detection

## Abstract
We study medical image anomaly detection and propose a synthetic data augmentation method.

## Introduction
Medical image analysis has limited labeled anomaly samples.

## Related Work
PatchCore and PaDiM are related methods.

## Method
The method includes modules, algorithm steps, and a loss function.

## Experiments
We compare with baseline methods using AUROC and add ablation studies.

## Conclusion
The method improves robustness.

## References
[1] PatchCore.
`;

describe("revise review-revise loop", () => {
	it("parses revise command arguments and clamps max_rounds", () => {
		expect(
			parseGoalInput(
				'/revise target="投稿到目标会议，尽量达到 Weak Accept 以上" draft="research_workspace/drafts/paper.md" max_rounds=8',
			),
		).toEqual({
			target: "投稿到目标会议，尽量达到 Weak Accept 以上",
			draft: "research_workspace/drafts/paper.md",
			maxRounds: 6,
		});

		expect(parseGoalInput('/revise draft="paper.md"')).toEqual({
			target: "未指定目标",
			draft: "paper.md",
			maxRounds: 3,
		});

		expect(parseGoalInput("/revise paper.md")).toEqual({
			target: "未指定目标",
			draft: "paper.md",
			maxRounds: 3,
		});
	});

	it("creates a revise run directory, backs up the original draft, and saves every round artifact", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-revise-loop-"));
		const draftPath = join(dir, "paper.md");
		const timestamp = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
		await writeFile(draftPath, incompleteDraft, "utf8");

		try {
			const result = await runGoalReviewLoop({
				cwd: dir,
				input: `/revise target="投稿到目标会议，尽量达到 Weak Accept 以上" draft="${draftPath}" max_rounds=2`,
				timestamp,
			});

			expect(result.rounds).toHaveLength(2);
			expect(result.runDir).toBe(join(dir, "research_workspace", "reviews", "revise-20260102-030405"));
			expect(readFileSync(draftPath, "utf8")).toBe(incompleteDraft);
			expect(existsSync(join(result.runDir, "original-draft.md"))).toBe(true);
			expect(existsSync(join(result.runDir, "config.json"))).toBe(true);

			for (const roundNumber of [1, 2]) {
				const roundDir = join(result.runDir, `round-${roundNumber}`);
				expect(existsSync(join(roundDir, "review.md"))).toBe(true);
				expect(existsSync(join(roundDir, "revision-plan.md"))).toBe(true);
				expect(existsSync(join(roundDir, "revised-draft.md"))).toBe(true);
				expect(existsSync(join(roundDir, "remaining-risks.md"))).toBe(true);
			}

			const summary = readFileSync(join(result.runDir, "final-summary.md"), "utf8");
			expect(summary).toContain("# Review-Revise Loop Final Summary");
			expect(summary).toContain("总共进行了 2 轮");
			expect(summary).toContain("当前模拟接收概率");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("enforces the execution max_rounds cap and never writes over the original draft", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-revise-loop-cap-"));
		const draftPath = join(dir, "paper.md");
		await writeFile(draftPath, incompleteDraft, "utf8");

		try {
			const result = await runGoalReviewLoop({
				cwd: dir,
				input: `/revise target="投稿到目标会议" draft="${draftPath}" max_rounds=999`,
				majorIssueStopThreshold: 0,
				timestamp: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
			});

			expect(result.config.maxRounds).toBe(6);
			expect(result.rounds).toHaveLength(6);
			expect(result.stopReason).toBe("达到 max_rounds=6。");
			expect(existsSync(join(result.runDir, "round-6", "revised-draft.md"))).toBe(true);
			expect(existsSync(join(result.runDir, "round-7"))).toBe(false);
			expect(readFileSync(draftPath, "utf8")).toBe(incompleteDraft);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("stops early when major weaknesses are below the threshold", async () => {
		const dir = await mkdtemp(join(tmpdir(), "linlic-revise-loop-stop-"));
		const draftPath = join(dir, "paper.md");
		await writeFile(draftPath, completeDraft, "utf8");

		try {
			const result = await runGoalReviewLoop({
				cwd: dir,
				input: `/revise target="投稿到目标会议" draft="${draftPath}" max_rounds=5`,
				majorIssueStopThreshold: 2,
				timestamp: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
			});

			expect(result.config.maxRounds).toBe(5);
			expect(result.rounds.length).toBeLessThan(5);
			expect(result.stopReason).toContain("重大问题数量低于阈值");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
