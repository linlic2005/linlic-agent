# Zotero 集成使用说明

`linlic-agent` 的 Zotero 集成基于 Zotero Web API v3。它只在用户配置环境变量后启用；未配置时，`/search`、`/idea`、`/review`、`/paper` 和 `/revise` 仍会照常运行。

## 环境变量

```bash
export ZOTERO_API_KEY=your_zotero_api_key
export ZOTERO_USER_ID=your_zotero_user_id
export ZOTERO_GROUP_ID=optional_group_id
```

- `ZOTERO_API_KEY`：必填。用于访问 Zotero Web API。
- `ZOTERO_USER_ID`：访问个人文献库时必填。
- `ZOTERO_GROUP_ID`：可选。配置后优先检索 group library。

## 支持能力

- `research_zotero_search`：根据关键词检索 Zotero 文献库。
- `research_export_bibtex`：把论文列表导出为 BibTeX，保存到 `research_workspace/notes/`。
- `/idea`：先检索用户已有 Zotero 文献，再检索 Semantic Scholar、OpenAlex 和 arXiv。
- `/review`：提取草稿中的 citation key，并结合 Zotero 命中文献提示可能缺失的相关工作。

## 示例命令

```text
/idea idea="your research idea" limit=10 year_from=2020
/review research_workspace/drafts/paper.tex target="target venue"
/search topic="your research topic" limit=20 year_from=2020
```

如果用户要求导出 `/search` 结果：

```text
/search topic="your research topic" limit=20 year_from=2020，并导出 BibTeX
```

Pi 应先调用 `research_search_papers`，再把 Top 论文列表传给 `research_export_bibtex`。

## 限制

- 当前只读取 Zotero Web API，不直接读取本地 Zotero SQLite 数据库。
- `/review` 的引用检查是启发式提示，不能保证识别所有缺失引用。
- BibTeX 导出使用 linlic-agent 本地生成格式，适合作为 Zotero 可导入草稿；正式投稿前仍需人工检查条目类型和字段完整性。
