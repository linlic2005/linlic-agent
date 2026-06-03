---
description: 检索研究方向并生成文献综述报告
argument-hint: 'topic="<研究方向或检索需求>" limit=10 year_from=2020'
---
你正在执行 linlic-agent 的 `/search` 文献检索 MVP。

用户输入：

```text
$ARGUMENTS
```

请完成：

1. 调用 `research_prepare_workspace`，确认 `research_workspace` 已创建。
2. 调用 `research_search_papers`：
   - `query`: 原始用户输入 `$ARGUMENTS`；支持 `topic="..."` 或直接位置参数。
   - `limit`: 如果用户明确给出 `limit`、`top N` 或 `前 N 篇`，传入对应数量；默认 10，最大 50。
   - `yearFrom`: 如果用户明确给出 `year_from`、`yearFrom`、`since`、`after` 或类似年份约束，传入对应年份。
3. `research_search_papers` 会优先请求 Semantic Scholar，失败时继续 OpenAlex 和 arXiv，并返回已合并、去重、排序的 Markdown 报告。
4. 检查工具返回的 Markdown 是否包含：
   - `# 文献检索报告`
   - 检索主题
   - 关键词和英文检索式
   - 检索数据源
   - Top 论文列表
   - 方法分类框架
   - 研究趋势
   - 可能研究空白
   - 下一步建议
5. 调用 `research_write_report` 保存 `research_search_papers` 返回的完整 Markdown：
   - `category`: `reports`
   - `title`: `literature-search`
   - `content`: 完整 Markdown 报告
6. 如果用户明确要求导出 BibTeX 或 Zotero 可导入文件，调用 `research_export_bibtex`：
   - `title`: `search-export`
   - `papers`: 使用 `research_search_papers` 返回的 Top 论文列表
   - 导出文件会保存到 `research_workspace/notes/`
