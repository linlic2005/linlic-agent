---
name: review-revise-loop
description: 用于根据投稿目标执行多轮 review-revise loop，保存每轮中间结果，不自动覆盖草稿。适合 /revise 工作流。
---

# Review Revise Loop

## 适用场景

用户给出论文目标、草稿路径或修改约束，希望执行多轮评审-修改循环，并追踪每轮审稿、计划、修订稿和剩余风险。

## 输入格式

- 投稿目标。
- 草稿路径。
- 最大轮数。
- 可选：目标会议、时间预算、不可改动部分。

## 输出格式

- `config.json`。
- 每轮 `review.md`、`revision-plan.md`、`revised-draft.md`、`remaining-risks.md`。
- `final-summary.md`。
- 运行目录、停止原因和当前模拟接收概率。

## 注意事项

- `/revise` 应调用 `research_goal_loop`。
- 不要无限循环；`max_rounds` 默认 3，最大 6。
- 原始草稿必须备份，不能直接覆盖原文。
- `revised-draft.md` 是候选修改稿，需要人工确认后再合并。
- 如果某轮失败，需要保留已生成的目录和当前进度。

## 质量检查清单

- 是否明确不覆盖原文。
- 是否保存原始草稿备份。
- 是否每轮都有 review、revision plan、revised draft 和 remaining risks。
- 是否生成 final-summary。
- 是否限制最大轮数。
