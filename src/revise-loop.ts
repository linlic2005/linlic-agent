import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { type ReviewDraftResult, reviewDraft } from "./review-draft.ts";
import { ensureResearchWorkspace, researchWorkspaceName } from "./workspace.ts";

export interface ParsedGoalInput {
	target: string;
	draft: string;
	maxRounds: number;
}

export interface GoalLoopConfig {
	target: string;
	draftPath: string;
	backupPath: string;
	maxRounds: number;
	majorIssueStopThreshold: number;
	startedAt: string;
	runDir: string;
	safety: string[];
}

export interface GoalLoopRound {
	round: number;
	roundDir: string;
	reviewPath: string;
	revisionPlanPath: string;
	revisedDraftPath: string;
	remainingRisksPath: string;
	review: ReviewDraftResult;
	resolvedIssues: string[];
	remainingRisks: string[];
	simulatedAcceptanceProbability: number;
}

export interface GoalLoopResult {
	runDir: string;
	config: GoalLoopConfig;
	rounds: GoalLoopRound[];
	stopReason: string;
	finalSummaryPath: string;
	markdown: string;
}

export interface GoalLoopOptions {
	cwd: string;
	input: string;
	timestamp?: Date;
	majorIssueStopThreshold?: number;
}

const DEFAULT_TARGET = "未指定目标";
const DEFAULT_MAX_ROUNDS = 3;
const MAX_ALLOWED_ROUNDS = 6;
const DEFAULT_MAJOR_ISSUE_STOP_THRESHOLD = 1;

function parseKeyValue(input: string, key: string): string | undefined {
	const pattern = new RegExp(`${key}=("([^"]+)"|'([^']+)'|([^\\s]+))`, "i");
	const match = input.match(pattern);
	return match?.[2] ?? match?.[3] ?? match?.[4];
}

function stripOuterQuotes(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseNumber(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function clampRounds(value: number | undefined): number {
	if (!value || !Number.isFinite(value)) return DEFAULT_MAX_ROUNDS;
	return Math.max(1, Math.min(Math.trunc(value), MAX_ALLOWED_ROUNDS));
}

function removeKnownArguments(input: string): string {
	return input
		.replace(/\b(?:target|draft|file|path|max_rounds|maxRounds)=("[^"]+"|'[^']+'|[^\s]+)/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function parseGoalInput(input: string): ParsedGoalInput {
	const normalized = input
		.trim()
		.replace(/^\/(?:revise|goal)\b/i, "")
		.trim();
	const target = parseKeyValue(normalized, "target");
	const draft =
		parseKeyValue(normalized, "draft") ?? parseKeyValue(normalized, "file") ?? parseKeyValue(normalized, "path");
	const maxRounds = parseNumber(parseKeyValue(normalized, "max_rounds") ?? parseKeyValue(normalized, "maxRounds"));
	return {
		target: target ? stripOuterQuotes(target) : DEFAULT_TARGET,
		draft: stripOuterQuotes(draft ?? removeKnownArguments(normalized)),
		maxRounds: clampRounds(maxRounds),
	};
}

function resolveDraftPath(cwd: string, draft: string): string {
	return isAbsolute(draft) ? draft : resolve(cwd, draft);
}

function formatTimestamp(date: Date): string {
	const year = String(date.getUTCFullYear()).padStart(4, "0");
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	const second = String(date.getUTCSeconds()).padStart(2, "0");
	return `${year}${month}${day}-${hour}${minute}${second}`;
}

function acceptanceProbability(review: ReviewDraftResult): number {
	const decisionBase: Record<string, number> = {
		"Strong Accept": 0.92,
		Accept: 0.82,
		"Weak Accept": 0.64,
		Borderline: 0.48,
		"Weak Reject": 0.28,
		Reject: 0.12,
		"Strong Reject": 0.04,
	};
	const base = decisionBase[review.decision] ?? 0.35;
	const penalty = Math.min(review.majorWeaknesses.length * 0.04, 0.24);
	return Math.max(0.02, Math.min(0.95, base - penalty));
}

function formatPercent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function topRisks(review: ReviewDraftResult): string[] {
	return [...review.majorWeaknesses, ...review.minorWeaknesses].slice(0, 8);
}

function buildAreaChairSummary(review: ReviewDraftResult, target: string): string[] {
	return [
		`目标：${target}`,
		`当前模拟审稿结论：${review.decision}`,
		`重大问题数量：${review.majorWeaknesses.length}`,
		`主要风险：${review.majorWeaknesses[0] ?? "未识别到明确 major weakness，但仍需人工复核。"}`,
		`Area Chair 判断：当前稿件需要优先证明贡献边界、实验充分性和可复现性是否达到目标要求。`,
	];
}

function buildRevisionPlan(
	round: number,
	review: ReviewDraftResult,
	target: string,
	previousResolved: string[],
): string {
	const majorItems = review.majorWeaknesses.slice(0, 6);
	const minorItems = review.minorWeaknesses.slice(0, 5);
	const priorityItems = review.revisionPriorities.slice(0, 8);

	return [
		`# Round ${round} Revision Plan`,
		"",
		"## Reviewer Agent 发现的问题",
		"",
		...formatList(majorItems, "本轮未识别到新的 major weakness。"),
		"",
		"## Area Chair Agent 综合判断",
		"",
		...buildAreaChairSummary(review, target).map((item) => `- ${item}`),
		"",
		"## Revision Planner 修改计划",
		"",
		...formatList(priorityItems, "保持当前结构，继续做人工精修。"),
		"",
		"## 本轮计划解决的问题",
		"",
		...formatList(majorItems.slice(0, 3), "没有明确 P0 问题，本轮转入表达、引用和可复现性精修。"),
		"",
		"## 次要问题处理",
		"",
		...formatList(minorItems, "暂无明确 minor weakness。"),
		"",
		"## 上一轮遗留问题回看",
		"",
		...formatList(previousResolved, "第一轮暂无上一轮记录。"),
		"",
		"## Writer Agent 执行原则",
		"",
		"- 不覆盖原始草稿。",
		"- 保留原文主体，并在本轮 revised draft 中追加修改记录和建议替换内容。",
		"- 对需要实验、数据或人工判断的问题，只写入待办和证据要求，不伪造结果。",
	].join("\n");
}

function buildRevisedDraft(
	round: number,
	currentDraft: string,
	review: ReviewDraftResult,
	revisionPlan: string,
): string {
	const majorFixes = review.majorWeaknesses.slice(0, 3);
	const minorFixes = review.minorWeaknesses.slice(0, 3);
	return [
		currentDraft.trimEnd(),
		"",
		"---",
		"",
		`# Review-Revise Loop Round ${round} Revised Draft Notes`,
		"",
		"说明：这是 linlic-agent 生成的安全版 revised draft，不会覆盖原始草稿。请人工审阅后再决定是否合并到论文正文。",
		"",
		"## 本轮建议优先修改的正文方向",
		"",
		...formatList(majorFixes, "本轮没有明确 major weakness，建议做表达和证据链精修。"),
		"",
		"## 建议补充到论文中的内容",
		"",
		"- 在引言末尾补充清晰贡献列表，明确问题、方法、实验和适用边界。",
		"- 在方法部分补充算法流程、关键假设、复杂度和失败条件。",
		"- 在实验部分补充强 baseline、公平比较、消融实验、失败案例和可复现性设置。",
		"",
		"## 本轮次要修订",
		"",
		...formatList(minorFixes, "暂无次要修订。"),
		"",
		"## Revision Plan Trace",
		"",
		revisionPlan,
	].join("\n");
}

function buildRemainingRisks(round: number, review: ReviewDraftResult): string {
	const risks = topRisks(review);
	return [
		`# Round ${round} Remaining Risks`,
		"",
		`当前模拟接收概率：${formatPercent(acceptanceProbability(review))}`,
		"",
		"## Remaining Risks",
		"",
		...formatList(risks, "当前未识别到明确遗留风险，但需要人工复核。"),
		"",
		"## Consistency Checker",
		"",
		"- 检查摘要、引言、方法、实验和结论中的贡献表述是否一致。",
		"- 检查新增修改建议是否引入没有实验支撑的 claim。",
		"- 检查术语、符号、图表引用和指标命名是否一致。",
	].join("\n");
}

function formatList(items: string[], fallback: string): string[] {
	return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function buildFinalSummary(rounds: GoalLoopRound[], config: GoalLoopConfig, stopReason: string): string {
	const lastRound = rounds.at(-1);
	const probability = lastRound ? formatPercent(lastRound.simulatedAcceptanceProbability) : "未知";
	const stillRisks = lastRound?.remainingRisks ?? [];
	return [
		"# Review-Revise Loop Final Summary",
		"",
		`目标：${config.target}`,
		`总共进行了 ${rounds.length} 轮`,
		`停止原因：${stopReason}`,
		`当前模拟接收概率：${probability}`,
		"",
		"## 1. 每轮解决了什么问题",
		"",
		...rounds.flatMap((round) => [
			`### Round ${round.round}`,
			"",
			...formatList(round.resolvedIssues, "本轮主要做风险确认和表达精修。"),
			"",
		]),
		"## 2. 仍然存在的问题",
		"",
		...formatList(stillRisks, "当前未识别到明确遗留问题，但需要人工复核。"),
		"",
		"## 3. 当前模拟接收概率",
		"",
		`当前估计为 ${probability}。这是基于模拟审稿结论和重大问题数量的启发式估计，不能代表真实录用概率。`,
		"",
		"## 4. 是否建议继续人工修改",
		"",
		stillRisks.length > 0
			? "建议继续人工修改，优先处理上方遗留风险。"
			: "可以进入人工精修、格式检查和投稿材料准备阶段。",
		"",
		"## 5. 下一步建议",
		"",
		"- 人工审阅每轮 revised-draft.md，不要直接整体替换原稿。",
		"- 将 confirmed 的修改逐项合并回正式论文。",
		"- 对实验、引用和数学推导类修改补充真实证据。",
		"- 合并后重新运行 `/review` 或 `/revise` 做下一轮独立检查。",
	].join("\n");
}

async function writeText(path: string, content: string): Promise<void> {
	await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function backupFilename(draftPath: string): string {
	const extension = extname(draftPath) || ".md";
	return `original-draft${extension}`;
}

export async function runGoalReviewLoop(options: GoalLoopOptions): Promise<GoalLoopResult> {
	const parsed = parseGoalInput(options.input);
	const draftPath = resolveDraftPath(options.cwd, parsed.draft);
	const timestamp = options.timestamp ?? new Date();
	const timestampText = formatTimestamp(timestamp);
	const workspace = await ensureResearchWorkspace(options.cwd);
	const runDir = join(workspace.directories.reviews, `revise-${timestampText}`);
	await mkdir(runDir, { recursive: true });

	const backupPath = join(runDir, backupFilename(draftPath));
	await copyFile(draftPath, backupPath);

	const maxRounds = parsed.maxRounds;
	const majorIssueStopThreshold = options.majorIssueStopThreshold ?? DEFAULT_MAJOR_ISSUE_STOP_THRESHOLD;
	const startedAt = timestamp.toISOString();
	const config: GoalLoopConfig = {
		target: parsed.target,
		draftPath,
		backupPath,
		maxRounds,
		majorIssueStopThreshold,
		startedAt,
		runDir,
		safety: [
			"不直接覆盖原始 draft。",
			"每一轮输出独立目录和中间结果。",
			"revised-draft.md 是候选修改稿，需人工确认后再合并。",
		],
	};
	await writeText(join(runDir, "config.json"), JSON.stringify(config, null, 2));

	let currentDraftPath = draftPath;
	let currentDraft = await readFile(draftPath, "utf8");
	const rounds: GoalLoopRound[] = [];
	let stopReason = `达到 max_rounds=${maxRounds}。`;
	let previousResolved: string[] = [];

	for (let round = 1; round <= maxRounds; round++) {
		const roundDir = join(runDir, `round-${round}`);
		await mkdir(roundDir, { recursive: true });

		try {
			const review = await reviewDraft({
				cwd: options.cwd,
				input: `file="${currentDraftPath}" target="${parsed.target}"`,
			});
			const revisionPlan = buildRevisionPlan(round, review, parsed.target, previousResolved);
			const revisedDraft = buildRevisedDraft(round, currentDraft, review, revisionPlan);
			const remainingRisks = buildRemainingRisks(round, review);
			const resolvedIssues = review.majorWeaknesses.slice(0, 3);

			const reviewPath = join(roundDir, "review.md");
			const revisionPlanPath = join(roundDir, "revision-plan.md");
			const revisedDraftPath = join(roundDir, "revised-draft.md");
			const remainingRisksPath = join(roundDir, "remaining-risks.md");

			await writeText(reviewPath, review.markdown);
			await writeText(revisionPlanPath, revisionPlan);
			await writeText(revisedDraftPath, revisedDraft);
			await writeText(remainingRisksPath, remainingRisks);

			const roundResult: GoalLoopRound = {
				round,
				roundDir,
				reviewPath,
				revisionPlanPath,
				revisedDraftPath,
				remainingRisksPath,
				review,
				resolvedIssues,
				remainingRisks: topRisks(review),
				simulatedAcceptanceProbability: acceptanceProbability(review),
			};
			rounds.push(roundResult);

			if (review.majorWeaknesses.length < majorIssueStopThreshold) {
				stopReason = `重大问题数量低于阈值 ${majorIssueStopThreshold}，提前停止。`;
				break;
			}

			currentDraftPath = revisedDraftPath;
			currentDraft = revisedDraft;
			previousResolved = resolvedIssues;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			stopReason = `Round ${round} 执行失败，已保存当前进度：${message}`;
			await writeText(join(roundDir, "error-progress.md"), `# Round ${round} Error Progress\n\n${message}\n`);
			break;
		}
	}

	const finalSummary = buildFinalSummary(rounds, config, stopReason);
	const finalSummaryPath = join(runDir, "final-summary.md");
	await writeText(finalSummaryPath, finalSummary);

	const relativeRunDir = join(researchWorkspaceName, "reviews", basename(runDir));
	const markdown = [
		"# 多轮 Review-Revise Loop 已完成",
		"",
		`运行目录：${relativeRunDir}`,
		`总轮数：${rounds.length}`,
		`停止原因：${stopReason}`,
		"",
		`最终总结：${join(relativeRunDir, "final-summary.md")}`,
	].join("\n");

	return { runDir, config, rounds, stopReason, finalSummaryPath, markdown };
}
