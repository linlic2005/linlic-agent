---
description: 根据目标对草稿执行多轮 review-revise 修改循环
argument-hint: 'target="<修改或投稿目标>" draft="<草稿路径>" max_rounds=3'
---
你正在执行 linlic-agent 的 `/revise` 多轮 review-revise loop MVP。

用户输入：

```text
$ARGUMENTS
```

请完成：

1. 调用 `research_prepare_workspace`，确认 `research_workspace` 已创建。
2. 调用 `research_goal_loop`：
   - `target`: 用户输入中的目标。
   - `draft`: 用户输入中的草稿路径；支持位置参数、`draft=`、`file=` 或 `path=`。
   - `maxRounds`: 如果用户明确给出 `max_rounds` 或 `maxRounds`，传入对应数值；默认 3，最大 6。
3. `research_goal_loop` 会执行有上限的多轮 review-revise loop：
   - 默认 3 轮，最大 6 轮。
   - 不直接覆盖原始 draft。
   - 自动备份原始草稿。
   - 每一轮保存 review report、revision plan、revised draft、remaining risks。
   - 生成 `final-summary.md`。
4. 检查工具返回的运行目录，确认包含：
   - `config.json`
   - `round-1/review.md`
   - `round-1/revision-plan.md`
   - `round-1/revised-draft.md`
   - `round-1/remaining-risks.md`
   - 后续 round 目录
   - `final-summary.md`
5. 向用户简要说明：
   - 运行目录路径。
   - 总共进行了几轮。
   - 停止原因。
   - 原始草稿没有被覆盖。
   - revised draft 需要人工确认后再合并。
