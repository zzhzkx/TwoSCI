# TwoSCI

TwoSCI 是一个面向 Codex 和 Claude Code 的文献研究 MCP 服务与插件。它按科研人员的真实工作顺序组织检索：种子文献 -> 研究意图 -> 宽搜 -> 摘要筛选 -> 重点阅读 -> 引文追踪 -> 证据导出。

目标不是堆更多搜索框，而是速度稳定、来源清楚、证据可追溯。Web of Science 和 Scopus 作为主要授权来源，OpenAlex 与 Crossref 负责快速发现、元数据、摘要、OA 链接和后备覆盖。IEEE Xplore 作为可选来源，覆盖 IEEE 期刊、会议、标准和图书。

## 核心流程

1. **研究简报**：用 DOI、WoS UID、Scopus EID、OpenAlex ID 或精确标题解析种子文献，记录研究意图、指标、范围和排除项。
2. **多源发现**：在 `quick`、`balanced`、`deep` 三种模式下检索并去重。
3. **摘要筛选**：把摘要按批交给子 agent 做语义判断，保存 include/exclude/maybe 和理由。
4. **证据整理**：批量取完整记录，追踪参考文献、施引文献和相关文献。
5. **导出**：生成 Markdown（综述报告与证据卡片）、JSON（含筛选决策与元数据）、BibTeX 或 RIS。支持按筛选结果（如仅 `include`）快速导出。全文获取与解析属于独立 companion 流程。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `create_research_brief` | 解析种子文献，建立可复用的研究上下文 |
| `search_literature` | WoS/Scopus/OpenAlex/Crossref/IEEE 统一检索与去重 |
| `search_ieee` | 直接检索 IEEE Xplore 元数据和摘要 |
| `get_literature_records` | 从会话中补全记录，不重复请求发现接口；`fetchReferences=true` 可补参考文献 |
| `expand_citation_graph` | 一跳 references、citing、related 扩展 |
| `save_screening` | 保存子 agent 的筛选决定与理由 |
| `export_literature` | 导出 Markdown、JSON、BibTeX、RIS；支持 `verdict` 筛选过滤 |
| `get_source_status` | 查看来源配置、产品等级、配额和会话状态 |

原有的单平台工具仍然保留，用于定向查询、PDF 访问和兼容旧工作流。

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
