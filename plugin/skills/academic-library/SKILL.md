---
name: academic-library
description: >
  用于构建并归档完整的 Markdown 格式学术文献数据库。将本次调研入选的文献与精读成果汇总为一个标准的
  ACADEMIC_LIBRARY.md 文件，并同步输出 BibTeX 索引与审计 JSON。
---

# 学术库构建与归档流程 (Academic Library)

本技能是文献调研全流程的收尾与成果沉淀环节，负责生成**完整、可复现、带结构化索引的本地学术文献数据库**。

## 1. 交付产物规范

在当前工作目录的 `./twosci/` 下生成以下三件套：

1. **`ACADEMIC_LIBRARY.md`**：Markdown 格式文献数据库主文件。
   - **库概况统计**：调研课题意图、构建时间、收录核心文献数量、基准种子信息。
   - **文献分类总览表**：序号、标题、年份、出版源、初筛结论、本地全文/MinerU目录相对链接、核心方案概要。
   - **结构化文献档案**：每篇文献的完整元数据、DOI 直达链接、本地归档文件夹路径、简要学术贡献介绍。
   - **复现索引说明**。

2. **`references.bib`**：用于 LaTeX 或学术论文写作的标准 BibTeX 引文库。

3. **`screening_audit.json`**：保留每篇文献筛选决定、标签与理由的审计包。

## 2. 工具调用规范

调用 MCP 工具 `build_academic_library`：

```json
{
  "searchId": "当前检索会话 ID",
  "verdict": "include"
}
```
