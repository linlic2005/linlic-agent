---
description: 模拟审稿人评估实验方案
argument-hint: "<实验方案文本或文件路径>"
---
你正在执行 linlic-agent 的 `/experiment` 实验方案评估 MVP。

用户输入：

```text
$ARGUMENTS
```

请完成：

1. 调用 `research_prepare_workspace`，确认 `research_workspace` 已创建。
2. 如果用户输入像文件路径，请先使用 Pi 内置 `read` 工具读取文件；如果读取失败，基于用户直接输入继续并说明限制。
3. 以严厉但建设性的审稿人视角输出 Markdown：
   - `# 实验方案评估报告`
   - 实验目标是否清晰
   - 假设是否可检验
   - 数据集是否合适
   - Baseline 是否充分
   - 指标是否合理
   - 消融实验是否对应贡献点
   - 数据泄漏风险
   - 不公平比较风险
   - 统计显著性检验
   - 可复现性风险
   - 审稿人可能攻击点
   - 必须补充的实验
   - 可选增强实验
   - 修改后的推荐实验方案
   - 最终评分
4. 调用 `research_write_report` 保存报告：
   - `category`: `reviews`
   - `title`: `experiment-review`
   - `content`: 完整 Markdown 报告
