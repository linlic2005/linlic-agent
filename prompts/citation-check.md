---
description: 检查论文草稿引用完整性和引用支持关系
argument-hint: "<论文草稿路径>"
---
你正在执行 linlic-agent 的 `/citation-check` 引用检查 MVP。

用户输入：

```text
$ARGUMENTS
```

请完成：

1. 调用 `research_prepare_workspace`，确认 `research_workspace` 已创建。
2. 调用 `research_check_citations`：
   - `filePath`: 用户输入中的 Markdown 或 LaTeX 草稿路径。
   - 如果用户明确给出 `limit`，传入建议补充论文数量。
3. `research_check_citations` 会读取草稿，识别 citation key，检查强论断缺少引用、可疑引用支持关系、过旧引用、格式问题，并复用 `/search` 能力寻找可补充的新论文。
4. 不要虚构引用。工具无法确认引用是否支持原句时，必须保留“需要人工确认”标记。
5. 检查工具返回的 Markdown 是否包含：
   - `# 引用检查报告`
   - 总体评价
   - 缺少引用的位置
   - 引用可能不支持的位置
   - 相关工作覆盖不足的位置
   - 过旧引用
   - 建议补充的新论文
   - BibTeX 建议
   - 修改建议
6. 调用 `research_write_report` 保存 `research_check_citations` 返回的完整 Markdown：
   - `category`: `reviews`
   - `title`: `citation-check`
   - `content`: 完整 Markdown 报告
7. 保存后的文件名应由 `research_write_report` 生成，格式为 `citation-check-YYYYMMDD-HHmmss.md`。
8. 不要直接覆盖、重写或修改原论文草稿。
