# linlic-agent

`linlic-agent` 是一个基于 Pi Coding Agent 二次开发的本地科研 Agent package。它面向科研写作和论文阅读工作流，支持文献检索、单篇论文分析、研究想法查重与可行性评估、实验方案评估、论文草稿模拟评审、引用检查和多轮修改循环。

它是科研辅助工具，不替代正式查重系统、真实同行评审、投稿前人工核查或作者自己的实验验证。所有检索结果、引用建议、PDF 解析结果和模拟审稿意见都需要人工确认。

## 1. 项目简介

`linlic-agent` 复用 Pi Coding Agent 的 package、extensions、skills 和 prompt templates 机制，不大规模修改 Pi 核心逻辑。当前 MVP 的目标是把科研常用流程封装为可调用命令和工具：

- 用 `/search` 做多数据源文献检索和去重排序。
- 用 `/paper` 分析本地 PDF，生成结构化论文阅读报告。
- 用 `/idea` 检查研究想法的新颖性风险和可行性。
- 用 `/experiment` 以审稿人视角评估实验方案。
- 用 `/review` 模拟同行评审论文草稿。
- 用 `/revise` 生成有上限的多轮 review-revise 修改计划。
- 用 `/citation-check` 检查引用完整性和可疑引用支持关系。

默认所有研究产物保存为 Markdown，便于版本管理、人工复核和继续迭代。

## 2. 功能列表

| 命令 | 功能 | 主要输出 |
| --- | --- | --- |
| `/search` | 检索论文，合并 Semantic Scholar、OpenAlex 和 arXiv 结果，去重排序 | 文献检索报告 |
| `/paper` | 读取本地 PDF，抽取文本、元数据、章节和分块摘要 | 论文分析报告 |
| `/idea` | 对研究想法做 novelty check、相似工作检索和可行性评估 | 研究想法查重与可行性评估报告 |
| `/experiment` | 从审稿人角度评估实验目标、baseline、指标、消融和风险 | 实验方案评估报告 |
| `/review` | 读取 Markdown、LaTeX 或 TXT 草稿并模拟同行评审 | 论文草稿模拟评审报告 |
| `/revise` | 按目标执行有上限的多轮审稿、计划、候选修改和风险检查 | 多轮修改运行目录 |
| `/citation-check` | 检查缺少引用、可疑引用支持关系、过旧引用和可补充论文 | 引用检查报告 |

已实现的工具包括：

- `research_prepare_workspace`
- `research_search_papers`
- `research_analyze_paper_pdf`
- `research_check_idea`
- `research_review_draft`
- `research_check_citations`
- `research_goal_loop`
- `research_zotero_search`
- `research_export_bibtex`
- `research_write_report`

## 3. 安装方法

从 `linlic-agent` 仓库根目录执行：

```bash
pi install -l .
pi
```

开发和本地试运行时，也可以临时加载 package：

```bash
./pi-test.sh -e .
```

进入 Pi 后即可使用 slash command：

```text
/search topic="your research topic" limit=20 year_from=2020
/paper research_workspace/papers/sample.pdf
/idea idea="your research idea" limit=10 year_from=2020
/experiment research_workspace/drafts/experiment-plan.md
/review research_workspace/drafts/paper.md target="target venue"
/citation-check research_workspace/drafts/paper.md
/revise target="revise related work and experiments" draft="research_workspace/drafts/sample-draft.md" max_rounds=3
```

## 4. 环境变量

所有环境变量都是可选的。没有 API key 时，`linlic-agent` 会尽量使用公开接口或 graceful fallback。

| 环境变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `SEMANTIC_SCHOLAR_API_KEY` | 可选 | Semantic Scholar API key。未配置时使用公开接口；若失败，会继续尝试 OpenAlex 和 arXiv。 |
| `ZOTERO_API_KEY` | 可选 | Zotero Web API key。配置后可检索用户 Zotero 文献库。 |
| `ZOTERO_USER_ID` | 可选 | Zotero user library ID。检索指定 Zotero library 时使用。 |
| `ZOTERO_GROUP_ID` | 可选 | Zotero group library ID。配置后优先检索 group library。 |

示例：

```bash
export SEMANTIC_SCHOLAR_API_KEY=your_semantic_scholar_key
export ZOTERO_API_KEY=your_zotero_api_key
export ZOTERO_USER_ID=your_zotero_user_id
export ZOTERO_GROUP_ID=your_zotero_group_id
```

## 5. 快速开始

以下是常用命令示例：

```text
/search topic="your research topic" limit=20 year_from=2020
```

```text
/paper research_workspace/papers/example.pdf
```

```text
/idea idea="your research idea" limit=10 year_from=2020
```

```text
/review research_workspace/drafts/paper.md target="target venue"
```

```text
/citation-check research_workspace/drafts/paper.md
```

```text
/revise target="revise related work and experiments" draft="research_workspace/drafts/sample-draft.md" max_rounds=3
```

## 6. 目录结构

```text
README.md
AGENTS.md
SYSTEM.md
package.json
tsconfig.json
docs/
  zotero.md
extensions/
  workspace.ts
  report-writer.ts
  semantic-scholar.ts
  pdf-extract.ts
  idea-check.ts
  review-draft.ts
  citation-check.ts
  revise-loop.ts
  zotero.ts
prompts/
  search.md
  paper.md
  idea.md
  experiment.md
  review.md
  citation-check.md
  revise.md
skills/
  literature-search/
  paper-analysis/
  novelty-check/
  experiment-critic/
  peer-review/
  citation-check/
  review-revise-loop/
src/
  workspace.ts
  report-writer.ts
  paper-search.ts
  paper-analysis.ts
  idea-check.ts
  review-draft.ts
  citation-check.ts
  revise-loop.ts
  zotero.ts
test/
research_workspace/
vendor/pi/
  README.md
  package.json
  packages/
    ai/
    agent/
    coding-agent/
    tui/
  scripts/
```

根目录是 `linlic-agent` 的正式项目边界。Pi Coding Agent 上游源码保留在 `vendor/pi`，用于复用 Pi package、extensions、skills、prompt templates 和本地开发工具链；除非确有必要，不直接修改 `vendor/pi/packages/coding-agent` 核心逻辑。

## 7. 工作区说明

`linlic-agent` 会在当前工作目录下创建 `research_workspace`。使用工具前应先调用 `research_prepare_workspace`；各 prompt 已内置这个步骤。

```text
research_workspace/
  papers/
  notes/
  reports/
  reviews/
  drafts/
  logs/
```

各目录用途：

- `papers/`：存放待分析的本地 PDF。
- `notes/`：存放单篇论文分析、BibTeX 导出和阅读笔记。
- `reports/`：存放文献检索报告、研究想法查重和可行性评估报告。
- `reviews/`：存放实验方案评估、论文模拟评审、引用检查和 `/revise` 多轮修改目录。
- `drafts/`：存放用户论文草稿、实验方案草稿和待审查文本。
- `logs/`：存放运行日志或后续扩展产生的诊断记录。

## 8. 每个命令的详细使用方式

参数通常支持两种写法：

- 位置参数：把主题或文件路径直接写在命令后，例如 `/paper research_workspace/papers/example.pdf`。
- 键值参数：用 `key="value"` 指明含义，例如 `/review file="research_workspace/drafts/paper.md" target="target venue"`。

路径可以是绝对路径，也可以是相对于当前 Pi 会话工作目录的路径。包含空格的参数建议使用英文双引号包裹。

### /search 文献检索

`/search` 会调用 `research_search_papers`，优先请求 Semantic Scholar，再请求 OpenAlex 和 arXiv。某个数据源失败时，会记录 warning 并继续后续数据源。

```text
/search topic="your research topic" limit=20 year_from=2020
/search "medical image anomaly detection after 2020" top 20
/search topic="your research topic" limit=20 year_from=2020，并导出 BibTeX
```

| 参数 | 必填 | 默认值 | 用法 |
| --- | --- | --- | --- |
| `topic` | 是 | 无 | 检索主题。可写 `topic="..."`，也可作为位置参数直接写在 `/search` 后。 |
| `limit` | 否 | `10`，最大 `50` | 返回论文数量。支持 `limit=20`，也能从 `top 20`、`前 20 篇` 中推断。 |
| `year_from` / `yearFrom` | 否 | 不限制 | 最早发表年份。支持 `year_from=2020`、`yearFrom=2020`，也能从 `since 2020`、`2020 年以来` 等表达中推断。 |
| “导出 BibTeX” | 否 | 不导出 | 在自然语言里要求导出 BibTeX 时，prompt 会在检索后调用 `research_export_bibtex`。 |

输出内容包括检索主题、关键词、英文检索式、数据源状态、Top 论文列表、方法分类、研究趋势、研究空白和下一步建议。如果用户要求导出 BibTeX，会调用 `research_export_bibtex`，保存到 `research_workspace/notes/`。

### /paper 单篇论文分析

`/paper` 会调用 `research_analyze_paper_pdf`。当前使用 `pdf-parse` 2.x 在 TypeScript 侧完成普通论文 PDF 文本抽取。

```text
/paper research_workspace/papers/example.pdf
/paper path="research_workspace/papers/sample.pdf"
```

| 参数 | 必填 | 默认值 | 用法 |
| --- | --- | --- | --- |
| 文件路径 | 是 | 无 | 位置参数形式，例如 `/paper research_workspace/papers/example.pdf`。 |
| `path` / `pdf` / `file` | 是，三选一或使用位置参数 | 无 | 键值形式的 PDF 路径，例如 `path="..."`、`pdf="..."` 或 `file="..."`。 |

处理流程：

- 校验文件是否存在、是否为 `.pdf`、PDF 文件头是否有效。
- 抽取文本、页数和基础元数据。
- 启发式识别标题、作者、年份、venue、URL/DOI、摘要和章节。
- 将长文本分块，避免把 PDF 原文全文塞入模型上下文。
- 生成 `# 论文分析报告` Markdown 草稿。

常见错误提示：

- `PDF 文件不存在`
- `输入文件不是 PDF`
- `PDF 文件头无效`
- `PDF 无法解析`
- `PDF 文本为空，可能是扫描版 PDF 或受保护文件`

### /idea 研究想法查重与可行性评估

`/idea` 会调用 `research_check_idea`，先拆解研究想法，再结合 Zotero 和外部论文检索结果评估 novelty risk。

```text
/idea idea="your research idea" limit=10 year_from=2020
/idea idea="a concise description of the method, task, and expected contribution" limit=10 year_from=2020
```

| 参数 | 必填 | 默认值 | 用法 |
| --- | --- | --- | --- |
| `idea` | 是 | 无 | 研究想法描述。可写 `idea="..."`，也可直接把想法写在 `/idea` 后。 |
| `limit` | 否 | `10` | 用于检索相似工作的论文数量。 |
| `year_from` / `yearFrom` | 否 | 不限制 | 最早发表年份，例如 `year_from=2020`。 |

输出内容包括想法复述、关键词、用户 Zotero 文献库命中或未配置提示、相似工作、创新性威胁、技术可行性、数据可得性、实验成本、审稿人可能质疑和下一步行动清单。

注意：`/idea` 是 novelty check / related work check，不能替代 iThenticate、Turnitin 或学校查重系统。

### /experiment 实验方案评估

`/experiment` 会读取用户输入的实验方案文本或文件路径，并以严格审稿人视角评估实验设计。

```text
/experiment research_workspace/drafts/experiment-plan.md
/experiment "Evaluate the proposed method on public benchmark datasets, compare against strong baselines, and report primary and secondary metrics."
```

| 参数 | 必填 | 默认值 | 用法 |
| --- | --- | --- | --- |
| 实验方案路径或文本 | 是 | 无 | 可以是 Markdown/TXT 文件路径，也可以是直接输入的实验方案文本。 |

输出内容包括实验目标、假设、数据集、baseline、指标、消融、数据泄漏风险、不公平比较风险、统计显著性、可复现性、审稿人攻击点、必须补充实验和推荐实验方案。

### /review 论文草稿模拟同行评审

`/review` 会调用 `research_review_draft`，读取 Markdown、LaTeX 或 TXT 草稿，按章节分块审查。

```text
/review research_workspace/drafts/paper.md target="target venue"
/review research_workspace/drafts/sample-draft.tex target="journal or conference name"
```

| 参数 | 必填 | 默认值 | 用法 |
| --- | --- | --- | --- |
| 文件路径 | 是 | 无 | 位置参数形式，例如 `/review research_workspace/drafts/paper.md`。 |
| `file` / `path` / `draft` | 是，三选一或使用位置参数 | 无 | 键值形式的草稿路径，支持 Markdown、LaTeX 或 TXT。 |
| `target` | 否 | `未指定投稿目标` | 目标会议、期刊、评分标准或修改目标，例如 `target="target venue"`。 |

LaTeX 路径会启用静态项目解析增强：

- 递归读取常见 `\input{}` 和 `\include{}` 子文件。
- 展开简单 `\newcommand`、`\renewcommand`、`\providecommand` 和 `\def` 宏。
- 识别公式、图表、表格、附录和引用关系。
- 对无法解析的子文件或未完全语义解析的宏给出 warning。

输出内容包括总体评价、章节评价、创新性、技术正确性、实验充分性、写作质量、引用完整性、可复现性、Major Weaknesses、Minor Weaknesses、审稿人可能提问、修改优先级、模拟审稿结论和修改建议清单。工具不会直接覆盖、重写或修改原论文。

### /citation-check 引用检查

`/citation-check` 会调用 `research_check_citations`，检查 Markdown 或 LaTeX 草稿中的引用风险。

```text
/citation-check research_workspace/drafts/paper.md
/citation-check file="research_workspace/drafts/sample-draft.tex" limit=8
```

| 参数 | 必填 | 默认值 | 用法 |
| --- | --- | --- | --- |
| 文件路径 | 是 | 无 | 位置参数形式，例如 `/citation-check research_workspace/drafts/paper.md`。 |
| `file` / `path` / `draft` | 是，三选一或使用位置参数 | 无 | 键值形式的 Markdown 或 LaTeX 草稿路径。 |
| `limit` | 否 | `8` | 建议补充论文数量。 |

输出内容包括缺少引用的位置、引用可能不支持的位置、相关工作覆盖不足的位置、过旧引用、格式问题、建议补充的新论文、BibTeX 建议和修改建议。

安全边界：

- 不要虚构引用。
- 建议补充的新论文只来自检索结果。
- 工具无法确认引用是否支持原句时，会标记为“需要人工确认”。
- 该检查不能替代人工精读被引论文。

### /revise 多轮审稿和修改循环

`/revise` 会调用 `research_goal_loop`，根据目标和草稿路径执行有上限的 review-revise loop。默认 3 轮，`max_rounds` 最大允许 6。

```text
/revise target="revise related work and experiments" draft="research_workspace/drafts/sample-draft.md" max_rounds=3
/revise target="strengthen experiments and related work" draft="research_workspace/drafts/sample-draft.tex" max_rounds=2
```

| 参数 | 必填 | 默认值 | 用法 |
| --- | --- | --- | --- |
| `target` | 建议填写 | `未指定目标` | 修改目标、投稿目标或验收目标，例如 `target="strengthen experiments and related work"`。 |
| 文件路径 | 是 | 无 | 位置参数形式，例如 `/revise research_workspace/drafts/sample-draft.md`。 |
| `draft` / `file` / `path` | 是，三选一或使用位置参数 | 无 | 键值形式的草稿路径，支持 Markdown、LaTeX 或 TXT。 |
| `max_rounds` / `maxRounds` | 否 | `3`，最大 `6` | 最大 review-revise 轮数。超过 6 会自动截断为 6。 |

每一轮会生成：

- `review.md`
- `revision-plan.md`
- `revised-draft.md`
- `remaining-risks.md`

`/revise` 不直接覆盖原始 draft。原始草稿会备份到运行目录，`revised-draft.md` 是候选修改稿，需要人工确认后再合并。

### Zotero 集成

Zotero 集成基于 Zotero Web API v3。配置后可用于：

- `research_zotero_search` 检索用户已有文献库。
- `/idea` 优先检查已配置 Zotero library 中的相似工作。
- `/review` 提示可能缺失的已有相关工作。
- `/search` 结果通过 `research_export_bibtex` 导出为 BibTeX。

```bash
export ZOTERO_API_KEY=your_zotero_api_key
export ZOTERO_USER_ID=your_zotero_user_id
export ZOTERO_GROUP_ID=optional_group_id
```

详细说明见 `docs/zotero.md`。

## 9. 输出文件说明

| 命令或工具 | 保存目录 | 文件名示例 |
| --- | --- | --- |
| `/search` | `research_workspace/reports/` | `literature-search-YYYYMMDD-HHmmss.md` |
| `/search` BibTeX 导出 | `research_workspace/notes/` | `search-export-YYYYMMDD-HHmmss.bib` |
| `/paper` | `research_workspace/notes/` | `paper-analysis-YYYYMMDD-HHmmss.md` |
| `/idea` | `research_workspace/reports/` | `idea-check-YYYYMMDD-HHmmss.md` |
| `/experiment` | `research_workspace/reviews/` | `experiment-review-YYYYMMDD-HHmmss.md` |
| `/review` | `research_workspace/reviews/` | `paper-review-YYYYMMDD-HHmmss.md` |
| `/citation-check` | `research_workspace/reviews/` | `citation-check-YYYYMMDD-HHmmss.md` |
| `/revise` | `research_workspace/reviews/revise-YYYYMMDD-HHmmss/` | `final-summary.md` 和每轮中间文件 |

`research_write_report` 会自动生成安全文件名，并确保 Markdown 末尾有换行。输出 Markdown 的章节标题在 prompt 和测试中固定，便于后续自动检查。

`/revise` 的运行目录结构：

```text
research_workspace/reviews/revise-YYYYMMDD-HHmmss/
  config.json
  original-draft.md
  round-1/
    review.md
    revision-plan.md
    revised-draft.md
    remaining-risks.md
  round-2/
    review.md
    revision-plan.md
    revised-draft.md
    remaining-risks.md
  final-summary.md
```

## 10. 常见问题

### 没有 API key 能不能用？

可以。`SEMANTIC_SCHOLAR_API_KEY` 是可选的。未配置时，`/search` 会尝试 Semantic Scholar 公开接口；如果失败，会 graceful fallback 到 OpenAlex 和 arXiv。Zotero 相关环境变量也都是可选的，未配置时只会跳过用户文献库检索。

### PDF 解析失败怎么办？

先确认文件存在、扩展名是 `.pdf`、文件不是空文件，并且 PDF 文件头有效。如果仍提示 `PDF 无法解析` 或 `PDF 文本为空`，通常原因是扫描版 PDF、受保护 PDF、复杂版式或图片型论文。可以先用 OCR 或外部 PDF 工具转为文本，再把文本或摘要交给 `/paper` 分析。

### /revise 会不会覆盖原文？

不会。`/revise` 会把原始草稿备份到 `research_workspace/reviews/revise-YYYYMMDD-HHmmss/original-draft.md`，每轮只在运行目录中生成候选 `revised-draft.md`。是否合并回正式论文，需要作者人工确认。

### 查重能否替代 iThenticate？

不能。`/idea` 和 `/citation-check` 只能做 novelty check、related work check 和引用风险提示，不能替代 iThenticate、Turnitin 或学校查重系统。正式查重必须使用机构认可的正式系统。

### 如何接 Zotero？

配置 `ZOTERO_API_KEY`，再按需要配置 `ZOTERO_USER_ID` 或 `ZOTERO_GROUP_ID`。配置后，`/idea` 和 `/review` 会尝试检索用户 Zotero 文献库；`/search` 的 Top 论文也可以导出为 BibTeX。详细配置见 `docs/zotero.md`。

### 如何换模型？

`linlic-agent` 不单独锁定模型，使用 Pi Coding Agent 当前的 provider 和 model 配置。切换模型应在 Pi Coding Agent 的模型配置、账号配置或启动参数中完成；`linlic-agent` 的 extensions、skills 和 prompts 会跟随当前 Pi 会话使用的模型。

## 11. 后续计划

- 更强 PDF 图表解析：识别表格、图注、实验结果表和公式上下文。
- GROBID：接入结构化 PDF 解析，抽取标题、作者、章节、参考文献和 citation spans。
- PaperQA2：增强论文问答、跨论文综合和证据引用链。
- Qdrant / Chroma：建立本地向量索引，支持研究工作区级别的长期检索。
- Zotero 深度集成：同步 collections、tags、notes、attachments 和引用 key。
- scite 引用可信度：区分 supporting、contrasting 和 mentioning citations。
- Web UI：提供可视化论文库、报告列表、检索结果筛选和多轮修改面板。
- 多 Agent 可视化流程：展示 Reviewer、Area Chair、Revision Planner、Writer 和 Consistency Checker 的中间状态。
