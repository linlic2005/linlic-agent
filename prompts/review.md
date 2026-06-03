---
description: 模拟同行评审论文草稿
argument-hint: '<草稿路径> target="<目标会议或评审标准>"'
---
你正在执行 linlic-agent 的 `/review` 论文草稿模拟同行评审 MVP。

用户输入：

```text
$ARGUMENTS
```

请完成：

1. 调用 `research_prepare_workspace`，确认 `research_workspace` 已创建。
2. 调用 `research_review_draft`：
   - `filePath`: 用户输入中的 Markdown、LaTeX 或 TXT 草稿路径；支持位置参数、`file=`、`path=` 或 `draft=`。
   - `target`: 如果用户明确给出 `target`，传入目标会议、期刊或评审标准；未给出时使用工具默认目标。
3. `research_review_draft` 会读取草稿、识别 Markdown/LaTeX 章节，并在文本较长时按章节分块审查。LaTeX 草稿会额外返回子文件、宏、公式、图表、表格、附录、引用和解析 warning。若 Zotero 已配置，工具会额外检索用户文献库，给出引用和相关工作完整性提示。不要把原始草稿全文一次性塞进上下文。
4. 检查工具返回的 Markdown 是否包含：
   - `# 论文草稿模拟评审报告`
   - 总体评价
   - 摘要评价
   - 引言评价
   - 相关工作评价
   - 方法部分评价
   - 实验部分评价
   - 结论部分评价
   - 创新性评价
   - 技术正确性评价
   - 实验充分性评价
   - 写作质量评价
   - 引用和相关工作完整性评价
   - Zotero 引用完整性检查，如果 Zotero 已配置或工具返回了相关提示
   - 可复现性评价
   - LaTeX 结构审查摘要，如果工具返回了 LaTeX 结构信息
   - Major Weaknesses
   - Minor Weaknesses
   - 审稿人可能提问
   - 修改优先级
   - 模拟审稿结论
   - 修改建议清单
5. 模拟审稿结论必须从以下选项中选择：
   - Strong Accept
   - Accept
   - Weak Accept
   - Borderline
   - Weak Reject
   - Reject
   - Strong Reject
6. 调用 `research_write_report` 保存 `research_review_draft` 返回的完整 Markdown：
   - `category`: `reviews`
   - `title`: `paper-review`
   - `content`: 完整 Markdown 报告
7. 保存后的文件名应由 `research_write_report` 生成，格式为 `paper-review-YYYYMMDD-HHmmss.md`。
8. 不要直接覆盖、重写或修改原论文草稿。
