# TwoSCI

TwoSCI 是一个面向 Codex 和 Claude Code 的文献研究 MCP 服务与插件。它按科研人员的真实工作顺序组织检索：种子文献 -> 研究意图 -> 宽搜 -> 摘要筛选 -> 重点阅读 -> 引文追踪 -> 证据导出。

目标不是堆更多搜索框，而是速度稳定、来源清楚、证据可追溯。Web of Science 和 Scopus 作为主要授权来源，OpenAlex 与 Crossref 负责快速发现、元数据、摘要、OA 链接和后备覆盖。IEEE Xplore 作为可选来源，覆盖 IEEE 期刊、会议、标准和图书。

## 核心流程

1. **研究简报**：用 DOI、WoS UID、Scopus EID、OpenAlex ID 或精确标题解析种子文献，记录研究意图、指标、范围和排除项。
2. **多源发现**：在 `quick`、`balanced`、`deep` 三种模式下检索并去重。
3. **摘要筛选**：把摘要按批交给子 agent 做语义判断，保存 include/exclude/maybe 和理由。
4. **全文路由与精读**：调用 `resolve_fulltext_access` 分析最优获取路径，调用 `generate_reading_cards` 配合 MinerU 完成算法、指标、局限性的结构化深读。
5. **证据扩展与导出**：引文网络一跳拓扑追踪，生成综述报告 Markdown、审计 JSON、BibTeX。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `search_academic` | 基础文献检索，支持 metadata / abstract / fulltext 三级分层与标准卡片输出 |
| `search_intent_literature` | 意图深度文献检索，基于 brief 意图展开多源检索与初筛 |
| `download_and_parse_mineru` | 全文下载并使用 MinerU 解析为 Markdown 与图表切图，严格落盘 `./twosci/` |
| `trace_citation_topology` | 引文网络与演化拓扑追踪，输出 Mermaid 关系图与演化脉络综述 |
| `build_academic_library` | 构建并导出规范的 Markdown 学术文献数据库 (ACADEMIC_LIBRARY.md) |
| `create_research_brief` | 解析种子文献，建立可复用的研究上下文 |
| `search_literature` | WoS/Scopus/OpenAlex/Crossref/IEEE 统一检索与去重 |
| `search_ieee` | 直接检索 IEEE Xplore 元数据和摘要 |
| `get_literature_records` | 从会话中补全记录，不重复请求发现接口；`fetchReferences=true` 可补参考文献 |
| `expand_citation_graph` | 一跳 references、citing、related 扩展 |
| `save_screening` | 保存子 agent 的筛选决定与理由 |
| `resolve_fulltext_access` | 解析筛选后文献的最优全文获取路由（OA直链、出版商API、机构通道） |
| `generate_reading_cards` | 生成专供 MinerU 全文解析的结构化精读证据卡与提取 Prompt |
| `export_literature` | 导出 Markdown、JSON、BibTeX、RIS；支持 `verdict` 筛选过滤 |
| `get_source_status` | 查看来源配置、产品等级、配额和会话状态 |


## 5 大专精 Skills

1. **`academic-search`**：基础学术检索，针对确定目标和关键词，输出元数据/摘要/全文三种深度的标准学术卡片。
2. **`intent-deep-research`**：意图深入调研，先通过多轮对话澄清用户研究意图与指标，再深度检索并交付标准卡片。
3. **`fulltext-acquisition`**：全网全文获取与 MinerU 解析，规范保存在 `./twosci/{作者}-{年份}-{题目}-{DOI}/`。
4. **`citation-network`**：学术引文网络与演化拓扑追踪，梳理理论基石与最新突破。
5. **`academic-library`**：学术文献数据库生成，汇总为标准 `ACADEMIC_LIBRARY.md` 与 BibTeX 引文库。

`search_ieee` 用于直接检索 IEEE Xplore 的元数据和摘要；IEEE 也可以作为
`search_literature` 的显式来源。它默认不加入 `quick`、`balanced`、`deep`
的检索源集合。

## 结果三层

- `metadata`：标题、作者、年份、期刊、DOI、来源 ID。
- `abstract`：增加摘要、关键词、分来源引用数。
- `evidence`：增加参考文献、OA 链接和全部标识符。

WoS Expanded 检索会一次取回 Full Record 并保存在会话中。`layer` 只控制返回给模型的内容量，不会触发第二次 WoS 请求。

## 检索模式

| 模式 | 每源结果数 | 典型用途 |
| --- | --- | --- |
| `quick` | 10 | 确认主题边界和关键词 |
| `balanced` | 25 | 默认正式筛选 |
| `deep` | 50 | 检索式收敛后的深挖 |

## Web of Science 规则

配置 `WOS_EXPANDED_API_KEY` 后：

- 发现、详情、引文查询默认走 Expanded。
- Expanded 默认 Full Record，摘要不需要二次消耗额度。
- 引文扩展使用 `/references`、`/citing`、`/related`。

只有 `WOS_API_KEY` 时回退 Starter v2，并提示摘要和引文关系受限。Starter 试用额度不适合正式摘要筛选，建议申请机构版或配置 Expanded。

## IEEE Xplore 规则

配置 `IEEE_XPLORE_API_KEY` 后启用 IEEE Xplore。接入使用官方 Metadata API，密钥通过 `apikey` 查询参数传递。

- 单次请求最多返回 200 条记录。
- 返回摘要、作者关键词、IEEE Terms、引用数、OA 状态和 IEEE article number。
- IEEE 元数据可能包含机构订阅范围外的记录；这不等于拥有全文权限。
- 本接入不提供参考文献或施引文献图；引文扩展仍使用 WoS Expanded 或 OpenAlex。
- `IEEE_XPLORE_RPS` 控制本地请求速率，默认 1 次/秒，不应超过注册时显示的额度。

IEEE 会审核申请，并在美国东部时间工作日 8:00-17:00 发放密钥。未通过的密钥会返回 `ERR_403_DEVELOPER_INACTIVE`。

## 安装

### Codex

本地：

```text
codex plugin marketplace add F:\path\to\TwoSCI
codex plugin add twosci@twosci-marketplace
```

GitHub：

```text
codex plugin marketplace add zzhzkx/TwoSCI
codex plugin add twosci@twosci-marketplace
```

### Claude Code

```text
/plugin marketplace add zzhzkx/TwoSCI
/plugin install twosci@twosci-marketplace
```

### 从源码构建

```bash
npm ci
npm run build:plugin
```

`npm run build:plugin` 会生成干净的 `plugin/` 目录，只包含 bundle、skill 和 Codex/Claude manifest，不会把整个开发仓库和 `node_modules` 复制进去。

## 环境变量

从 `.env.example` 创建 `.env`，或在宿主应用中配置同样的变量。不要提交真实密钥。

```bash
WOS_EXPANDED_API_KEY=
WOS_API_KEY=
ELSEVIER_API_KEY=
SCOPUS_SEARCH_API_KEY=
IEEE_XPLORE_API_KEY=
IEEE_XPLORE_RPS=1
OPENALEX_EMAIL=
CROSSREF_MAILTO=
```

- `WOS_EXPANDED_API_KEY`：首选 WoS 产品。
- `WOS_API_KEY`：Starter 后备。
- `ELSEVIER_API_KEY`：Scopus 详情/摘要权限。
- `SCOPUS_SEARCH_API_KEY`：可选的 Scopus Search 专用密钥。
- `IEEE_XPLORE_API_KEY`：IEEE Xplore Metadata API 密钥。
- `IEEE_XPLORE_RPS`：IEEE 本地请求速率，默认 `1`。
- `OPENALEX_EMAIL`：OpenAlex polite pool 联系邮箱。
- `CROSSREF_MAILTO`：Crossref polite pool 联系邮箱。

## 种子文献示例

用户输入：

> 这是我研究的基准文献 DOI `10.xxxx/xxxx`。根据它找该领域的背景、指标和后续政策评估。

Agent 流程：

1. 用 DOI 和研究意图调用 `create_research_brief`。
2. 阅读返回的种子摘要、关键词、参考文献、施引样本和高频主题词。
3. 写 2 到 4 条明确检索式，不静默改写研究边界。
4. 带 `brief_id` 调用 `search_literature`。
5. 子 agent 分批筛选摘要，调用 `save_screening` 留痕。
6. 对入选 `record_id` 调用 `get_literature_records`。
7. 从种子文献和关键入选文献调用 `expand_citation_graph`。
8. 用 `export_literature` 导出最终集合（推荐 `format="markdown"` 或 `format="json"`，可指定 `verdict="include"`）。

`skills/literature-search` 定义了完整的子 agent 分批筛选协议和证据工作流。

## 数据与合规

- WoS/Scopus/IEEE 完整记录只保存在当前研究会话的内存中。
- 不为 WoS/Scopus/IEEE 内容写后台磁盘缓存。
- 用户主动导出 BibTeX/RIS/JSON 是预期留档方式。
- 引用数按来源分开保存，不跨库相加。
- OpenAlex/Crossref 使用短时进程内缓存。
- Google Scholar 抓取和 Sci-Hub 不在默认链路中。

## 开发

```bash
npm ci
npm run build
npm run lint
npm test -- --runInBand
npm run build:plugin
```

## 许可证

MIT，见 `LICENSE`。
