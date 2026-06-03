# linlic-agent 全局注意事项

1. 整体使用中文作为主体语言，专有名词可以保留英文。
2. 项目名统一为 `linlic-agent`，不要再使用 `pi-research-agent` 作为新增项目、包、README 或代码中的正式名称。
3. 本项目基于 Pi Coding Agent 进行二次开发，优先复用 Pi 原生能力。
4. 新增能力优先通过 Pi package、extensions、skills、prompt templates 实现。
5. 不大规模重构 Pi 核心；除非确有必要，不修改 `packages/coding-agent` 核心逻辑。
6. `/search` MVP 先接 Semantic Scholar，`SEMANTIC_SCHOLAR_API_KEY` 可选，并支持无 key 公开接口或 graceful fallback。
7. `/paper` MVP 优先使用 TypeScript 侧 PDF 文本抽取方案。
8. `/review` 和 `/experiment` MVP 先用 prompt templates 实现。
9. `/goal` MVP 只生成多轮修改计划，不自动覆盖草稿。
10. 所有研究输出保存到 `research_workspace` 下的 `reports`、`reviews`、`notes` 等目录。
11. 未经用户明确确认，不开始项目开发、脚手架创建、扩展实现或大规模代码改动。
