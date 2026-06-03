---
name: literature-search
description: 用于围绕研究方向规划文献检索、关键词拆解、检索式生成和综述报告。适合 /search 工作流。
---

# Literature Search

## 适用场景

用户希望围绕一个研究方向、关键词或技术路线做初步文献检索、综述框架设计和研究空白判断。

## 输入格式

- 自然语言研究方向。
- 可选条件：年份范围、领域、会议期刊、Top N 数量、排除关键词。

## 输出格式

- 检索主题。
- 中文关键词和英文关键词。
- Semantic Scholar、OpenAlex、arXiv 可用检索式。
- 方法分类框架。
- 研究趋势和研究空白。
- 下一步阅读建议。

## 注意事项

- 当前 MVP 已接入 Semantic Scholar、OpenAlex 和 arXiv。Semantic Scholar API key 可选，环境变量为 `SEMANTIC_SCHOLAR_API_KEY`。
- 如果用户要求导出 BibTeX，调用 `research_export_bibtex`，将 `/search` 返回的论文列表保存到 `research_workspace/notes/`。
- Zotero 集成用于检索用户已有文献库；常规 `/search` 仍以外部数据库为主，避免把个人库命中误认为公开检索覆盖率。
- 明确说明检索覆盖率限制，不能声称已经穷尽全部论文。
- 生成最终 Markdown 后使用 `research_write_report` 保存到 `reports`。

## 质量检查清单

- 是否调用 `research_prepare_workspace`。
- 是否给出可执行英文检索式。
- 是否区分事实、推断和建议。
- 如果用户要求 BibTeX，是否保存 `.bib` 文件并报告路径。
- 是否保存最终报告。
