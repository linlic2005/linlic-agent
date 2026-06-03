---
description: 分析单篇论文 PDF 或论文文本
argument-hint: "<PDF 路径或论文文本>"
---
你正在执行 linlic-agent 的 `/paper` 单篇论文分析 MVP。

用户输入：

```text
$ARGUMENTS
```

请完成：

1. 调用 `research_prepare_workspace`，确认 `research_workspace` 已创建。
2. 如果用户提供的是 PDF 路径，调用 `research_analyze_paper_pdf`：
   - `filePath`: 原始用户输入中的 PDF 路径。
   - 工具会读取 PDF、抽取文本、识别标题/摘要/章节、分块，并返回受控长度的 Markdown 分析草稿。
   - 不要把 PDF 原文全文复制进上下文；只基于工具返回的 Markdown 草稿、分块摘要和可见证据生成最终报告。
3. 如果用户提供的是论文文本或摘要而不是 PDF 路径，基于现有内容分析；如果信息不足，明确列出缺失项。
4. 输出最终 Markdown 报告，包含：
   - `# 论文分析报告`
   - 基本信息
   - 一句话总结
   - 研究问题
   - 核心贡献
   - 方法详解
   - 实验分析
   - 可复现性评估
   - 优点和缺点
   - 对用户研究的启发
   - 审稿人可能质疑点
   - 建议深入阅读的相关论文
5. 调用 `research_write_report` 保存报告：
   - `category`: `notes`
   - `title`: `paper-analysis`
   - `content`: 完整 Markdown 报告
6. 保存后的文件名应由 `research_write_report` 生成，格式为 `paper-analysis-YYYYMMDD-HHmmss.md`。
