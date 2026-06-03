---
description: 对研究想法做 novelty check 和可行性评估
argument-hint: "<研究想法>"
---
你正在执行 linlic-agent 的 `/idea` 研究想法查重与可行性评估 MVP。

用户输入：

```text
$ARGUMENTS
```

请完成：

1. 调用 `research_prepare_workspace`，确认 `research_workspace` 已创建。
2. 调用 `research_check_idea`：
   - `idea`: 原始用户输入 `$ARGUMENTS`
   - 如果用户明确给出 `limit` 或 `year_from`，传入对应参数。
3. `research_check_idea` 会先尝试检索用户已配置的 Zotero 文献库；如果 Zotero 未配置或不可用，不要中断流程，继续复用 `/search` 的 Semantic Scholar / OpenAlex / arXiv 检索能力，并输出完整 Markdown 报告。
4. 检查工具返回的 Markdown 是否包含：
   - `# 研究想法查重与可行性评估报告`
   - 用户想法复述
   - 想法拆解
   - 自动生成的关键词
   - 用户 Zotero 文献库命中或未配置提示
   - 最相似相关工作
   - 创新性风险评估
   - 技术可行性、数据可得性和实验成本评估
   - 审稿人可能质疑
   - 建议修改后的研究定位
   - 下一步行动清单
   - 明确说明 novelty check / related work check 不能替代 iThenticate、Turnitin 或学校查重系统
5. 调用 `research_write_report` 保存 `research_check_idea` 返回的完整 Markdown：
   - `category`: `reports`
   - `title`: `idea-check`
   - `content`: 完整 Markdown 报告
6. 保存后的文件名应由 `research_write_report` 生成，格式为 `idea-check-YYYYMMDD-HHmmss.md`。
