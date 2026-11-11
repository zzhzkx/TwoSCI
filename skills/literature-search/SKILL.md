---
name: literature-search
description: >
  Use this skill when the user wants to search literature, start from a seed paper,
  understand a research field, screen abstracts, follow references or citing papers,
  or export evidence-ready records. It orchestrates the TwoSCI MCP tools and
  delegates abstract screening to subagents instead of dumping every abstract into
  the main context.
---

# TwoSCI 科研检索流程

这个 skill 复现人类做文献研究的顺序，而不是把检索压缩成一个搜索框：

1. 用种子文献和用户说明建立研究背景。
2. 把研究问题拆成检索式，先宽搜。
3. 读标题和摘要筛选。
4. 对入选文献读全文。
5. 从种子文献和关键文献追踪引文网络。
6. 综合证据、记录筛选理由、导出可引用记录。

服务端负责检索、去重、保存完整记录和引文扩展；你和子 agent 负责科学判断。

## 核心原则

- 学术证据必须可溯源。没有 DOI、标题、年份、期刊或来源记录的结论不要写。
- 不要编造参考文献、指标、样本量、方法或页码。
- 摘要只能支持摘要层面的结论。方法细节、样本、公式和局限必须来自全文。
- WoS Expanded 配置后默认使用 Expanded。不要先用 Starter 搜一遍再换 Expanded 取摘要。
- 三层结果是响应粒度，不是三次上游请求：
  - `metadata`：标题、作者、年份、期刊、DOI、来源。
  - `abstract`：增加摘要、关键词、分来源引用数。
  - `evidence`：增加参考文献、开放获取链接、全部标识符。仍然不是 PDF 全文。
- WoS、Scopus 和 IEEE 的完整记录只保存在当前进程的会话中，不落盘。用户主动导出 BibTeX/RIS/JSON 是预期留档方式。
- 不同来源的引用数分开保留，不要跨库相加。

## 工具地图

- `create_research_brief`：种子文献 + 用户意图 -> 研究简报、种子画像、`brief_id`。
- `search_literature`：多源检索、去重、排序 -> `search_id`；需要 IEEE 覆盖时显式加入 `ieee`。
- `search_ieee`：定向检索 IEEE Xplore 元数据和摘要。
- `get_literature_records`：按 `record_id` 或 DOI 批量取完整记录；默认不重新请求 WoS/Scopus。
- `expand_citation_graph`：从一个或多个种子扩展 `references`、`citing`、`related`。
- `save_screening`：保存子 agent 的 include/exclude/maybe 决定和理由。
- `export_literature`：导出 Markdown（综述报告与证据卡片）、JSON（含筛选决策与元数据）、BibTeX 或 RIS。支持 `verdict="include"` 快速过滤。
- `get_source_status`：查看 WoS 产品、Scopus、OpenAlex/Crossref、IEEE 状态、配额和会话数。

## 流程 A：用户给了一篇种子文献

触发例子：

> 这是我研究的基准文献 DOI 10.xxxx/xxxx。根据它帮我找绿色建筑碳排放领域的背景、指标体系和后续政策评估。

### 1. 先建 brief，不要直接搜索

调用 `create_research_brief`：

- `seed` 优先用 DOI、WoS UID、Scopus EID、OpenAlex ID；只有标题时要求用户补 DOI。
- `intent` 原样保留用户的研究目的。
- `focus` 写清用户关心的维度，例如 `["background", "metrics", "methods", "policy"]`。
- `scope` 写年份、学科、地区、排除项。
- `includeCitationContext` 默认 `true`，用种子文献的参考文献和施引文献帮助理解领域。

返回后，先向用户展示一个紧凑的“研究简报”，至少包括：

- 种子文献的标题、年份、期刊、DOI。
- 种子文献的摘要要点和作者关键词。
- 参考文献数、施引文献数、高频主题词。
- 2 到 4 条候选检索式，并说明每条检索式想覆盖什么。

如果种子文献标题匹配到多个不同 DOI，停止并让用户确认，不要猜。

### 2. 由你写检索式，不要让服务端自动改写

服务端只执行检索，不替用户决定研究边界。检索式应明确写出：

- 核心概念及其同义词。
- 目标指标或方法。
- 时间、地区、文献类型限制。
- 需要排除的概念。

示例：

```text
("embodied carbon" OR "carbon emission" OR "carbon footprint")
AND ("green building" OR "sustainable building" OR "low-carbon building")
AND (indicator OR metric OR assessment OR benchmarking)
```

第二条检索式可以把 `indicator/metric` 换成 `policy OR regulation OR certification`，用来覆盖政策评估。

### 3. 选择检索模式

- `quick`：10 条/源，适合确认关键词和领域轮廓。
- `balanced`：25 条/源，默认模式，适合第一轮正式筛选。
- `deep`：50 条/源，只在检索式已经收敛后使用。

第一轮优先 `balanced` + `layer="abstract"`。不要一上来 `deep`，否则会增加无关摘要和配额消耗。

调用 `search_literature` 时带上 `brief_id`。返回的 `search_id` 必须保留，后续筛选、补记录、导出都依赖它。

如果研究主题集中在 IEEE 期刊、会议、标准或图书，可在 `sources` 中显式加入 `ieee`，或直接调用 `search_ieee`。IEEE 默认不进入 `quick`/`balanced`/`deep` 的来源集合；它提供元数据、摘要和引用数，但不提供参考文献或施引文献图。

## 流程 B：没有种子文献，只有主题

1. 先用 `quick` 或 `balanced` 做一次 scoping search。
2. 看标题、年份、期刊和关键词分布，再和用户确认领域边界。
3. 根据确认后的概念写 2 到 4 条互补检索式。
4. 正式检索使用 `balanced`，必要时再 `deep`。
5. 如果用户要求综述或系统综述，先明确纳入/排除标准，再开始筛选。

## 子 agent 摘要筛选协议

不要在主 agent 里逐条阅读 50 到 100 篇摘要。主 agent 只负责分批、合并和决策留痕。

### 分批

- 每批 20 到 30 条记录。
- 100 条摘要通常拆成 4 批。
- 每批只传：`record_id`、标题、年份、期刊、DOI、摘要、关键词。
- 不把整个搜索结果、无关来源状态或历史对话传给子 agent。

### 子 agent 任务模板

```text
你是文献筛选子 agent。只根据下面这批标题和摘要判断，不使用外部知识。

研究背景：
{brief.intent}

纳入标准：
{inclusion criteria}

排除标准：
{exclusion criteria}

对每条记录返回严格 JSON：
{
  "record_id": "...",
  "verdict": "include | exclude | maybe",
  "reason": "不超过 30 个词，必须引用标题或摘要中的证据",
  "tags": ["background | metric | method | policy | review | ..."],
  "confidence": 0.0
}

规则：
- 摘要缺失时返回 maybe，理由写 "abstract unavailable"。
- 不要因为标题看起来相关就 include。
- 不要补充摘要中没有的指标、样本或结论。
```

### 合并

1. 收集所有子 agent 的 JSON。
2. 调用 `save_screening` 写入 `search_id`。
3. 统计 include/exclude/maybe 数量。
4. 如果 maybe 比例超过 30%，或 include 涉及关键研究问题，先向用户展示 maybe 列表再决定。
5. 不要把子 agent 的 `reason` 改写成更确定的结论。

## 取完整记录与读全文

筛选后：

1. 用 `get_literature_records` + `search_id` + `record_ids` 取入选记录的完整摘要和参考文献。若 `references_count=0` 且确实需要参考文献，再设置 `fetchReferences=true`；它会为每篇选中记录增加一次来源请求。
2. 默认 `refresh=false`。会话里已有 WoS/Scopus 完整记录时，不要重复请求。
3. `get_literature_records` 返回的是 evidence packet，不是 PDF 全文。
4. 需要读全文时，使用插件内置的全文获取链路（Unpaywall/OpenAlex/Europe PMC/出版商 PDF 路由）并配合 MinerU 解析；不要把 PDF 下载和解析混进检索服务。
5. 全文阅读至少提取：研究问题、数据、方法、指标定义、主要结果、局限、可复用的图表或公式。
6. 每条全文结论保留页码或章节定位。

## 引文网络

引文扩展的两种典型用途：

- 从种子文献向后看：`references`，找理论基础、经典指标和源头方法。
- 从种子文献向前看：`citing`，找后续验证、改进、政策应用和最新进展。
- `related` 用于找同主题但不在直接引文链上的工作。

调用 `expand_citation_graph`：

- 种子优先用 `record_id` 或 DOI。
- 第一轮 `limitPerSeed` 用 30 到 50。
- 先用 `recordView="short"` 看标题和年份，再对入选节点取完整记录。
- WoS Expanded 可用时优先 WoS；否则 OpenAlex，再否则 Crossref。IEEE 不参与引文扩展。
- 引文图节点也要经过筛选，不要把所有施引文献都写进综述。

## 导出与留痕

- 推荐首选导出格式为 `markdown`（生成标准文献综述报告与证据卡片）或 `json`（保留筛选证据链与多源元数据）。也支持传统 `bibtex` 与 `ris`。
- 筛选完成后，使用 `verdict="include"` 可一键导出所有通过筛选的文献；使用 `verdict="maybe"` 可导出待讨论文献。
- 筛选理由保存在 `search_id` 的 screening ledger 中；后续写综述时应沿用这些理由，不要重新编造。
- 导出的 Markdown 包含研究背景意图、检索式、种子文献信息、筛选统计表、一览总表和逐篇文献证据卡片，极其适合学术汇报和笔记整理。
- 导出的 JSON 内嵌完整 screening 记录（verdict, reason, tags, confidence, decidedAt），可作为 PRISMA 审计与下游分析底稿。

## 失败与边界

- WoS/Scopus 未配置：先调用 `get_source_status`，说明缺失的覆盖范围。不要假装检索过。
- IEEE 返回 `ERR_403_DEVELOPER_INACTIVE`：说明申请仍在审核或密钥未激活，不要把它当成检索无结果。
- 只有 WoS Starter：提醒用户 Starter 没有摘要和完整引文关系；建议申请机构版或配置 Expanded。不要静默降级。
- 某个来源超时或报错：保留部分成功结果，明确报告哪个来源失败。
- 摘要缺失：标记 `maybe`，不要根据标题下结论。
- 配额不足：停止该来源，报告 `used/limit/resetAt`，不要循环重试。
- 同一论文在不同来源有冲突 DOI：保留为不同记录，交用户确认。

## 最终回答的最小结构

1. 研究背景和本次检索问题。
2. 检索式、来源、时间范围和检索模式。
3. 各来源返回数、去重后数量、失败/跳过来源。
4. 筛选计数和主要排除理由。
5. 入选文献表：标题、年份、期刊、DOI、与研究问题的关系。
6. 引文网络发现：理论源头、后续验证、政策应用。
7. 证据缺口和下一步建议。

所有引用必须能在 `search_id` 或导出记录中找到对应条目。
