---
name: academic-search
description: >
  用于基础学术文献检索（对标原 paper-search）。当用户具有明确的搜索目标、关键词或检索式时使用。
  支持文献库/元数据级 (metadata)、摘要级 (abstract) 与全文级 (fulltext) 三种不同深度的标准学术卡片输出。
---

# 基础学术文献检索流程 (Academic Search)

本技能专为目标明确的文献检索设计（如同直接在 Web of Science, Scopus 或 IEEE Xplore 进行专业检索）。

## 1. 检索深度分级选择 (Search Scopes)

根据用户的需求粒度，指定 `search_scope` 参数：

- **`metadata` (元数据级)**：
  - 检索范围：题名 (Title)、作者 (Author)、关键词 (Keywords)、出版物 (Venue)。
  - 适用场景：快速查篇、验证文献是否存在、特定作者/期刊排查。
  - 交付卡片：包含标题、作者、出版期刊(年份)、DOI链接、各库被引频次、作者关键词（无OA状态与匹配行）。

- **`abstract` (摘要级，默认标准深度)**：
  - 检索范围：题名 + 摘要正文 + 扩展主题词。
  - 适用场景：主题方案对比、概念关联挖掘、候选池初筛。
  - 交付卡片：包含基本信息、作者、引用统计、核心关键词、结构化摘要、**文献获取**（可点击跳转链接）。

- **`fulltext` (全文级)**：
  - 检索范围：正文全文（引言、方法、公式、实验结果与讨论）。
  - 适用场景：寻找正文中隐藏的特定算法名称、小众基准(Benchmark)、硬件芯片型号、特定实验参数。
  - 交付卡片：包含基本信息、作者、引用统计、全文命中关键词、关键证据摘录、**全文可获取**（简练的 Yes / No）。

## 2. 工具调用规范

调用 MCP 工具 `search_academic`：

```json
{
  "query": "用户关键词或布尔检索式",
  "search_scope": "metadata | abstract | fulltext",
  "platform": "all | wos | scopus | ieee | pubmed | arxiv | crossref | openalex",
  "maxResults": 10,
  "year": "2020-2026"
}
```

## 3. 交付原则

- 学术真实性第一：严禁编造任何作者、年份、DOI 或指标数据。
- 结果以规范的卡片格式呈现给用户。
