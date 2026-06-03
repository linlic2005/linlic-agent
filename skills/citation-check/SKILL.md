---
name: citation-check
description: 用于检查论文草稿中的缺失引用、引用支持关系、过旧引用、引用格式和需要补充的新论文。适合 /citation-check 工作流。
---

# Citation Check

## 适用场景

用户提供 Markdown 或 LaTeX 论文草稿，希望检查引用是否足够、是否支持原句、是否过旧，以及相关工作是否需要补充最新论文。

## 输入格式

- Markdown 或 LaTeX 文件路径。
- 可选：建议补充论文数量 `limit`。

示例：

```text
/citation-check research_workspace/drafts/paper.md
/citation-check file="research_workspace/drafts/paper.tex" limit=8
```

## 输出格式

- 引用检查报告。
- 缺少引用的位置。
- 引用可能不支持的位置。
- 相关工作覆盖不足的位置。
- 过旧引用。
- 建议补充的新论文。
- BibTeX 建议。
- 修改建议。

## 注意事项

- 优先调用 `research_check_citations`，不要直接把长草稿全文塞进上下文。
- 可以复用 `/search` 的文献检索能力寻找补充论文。
- 不要虚构引用。建议补充的新论文必须来自检索结果或用户明确提供的参考文献。
- 对无法确认是否支持原句的引用，必须标记为“需要人工确认”。
- 工具只能做启发式检查，不能替代人工精读被引论文。
- 生成最终 Markdown 后使用 `research_write_report` 保存到 `reviews`，标题使用 `citation-check`。

## 质量检查清单

- 是否支持 Markdown 和 LaTeX。
- 是否列出缺少引用的强论断。
- 是否将无法确认的引用支持关系标记为“需要人工确认”。
- 是否识别过旧引用并建议补充近三到五年的工作。
- 是否只基于真实检索结果给出新论文和 BibTeX 建议。
- 是否保存最终报告。
- 是否没有覆盖原论文草稿。
