# TwoSCI

TwoSCI is a literature research MCP server and plugin for Codex and Claude
Code. It follows a researcher's actual workflow: start from a seed paper,
define the research intent, search broadly, screen abstracts, read selected
papers, trace citations, and export evidence-ready records.

It is designed for speed and stability rather than maximizing the number of
search boxes. Web of Science and Scopus are the primary entitlement-backed
sources; OpenAlex and Crossref provide fast discovery, metadata, abstracts,
open-access links, and fallback coverage. IEEE Xplore is available as an
opt-in source for IEEE journals, conferences, standards, and books.

## Core Workflow

1. **Research brief**: resolve a seed paper by DOI, WoS UID, Scopus EID,
   OpenAlex ID, or exact title. Capture the user's research intent, metrics,
   scope, and exclusions.
2. **Discovery**: run a deduplicated multi-source search in `quick`,
   `balanced`, or `deep` mode.
3. **Screening**: split abstracts into batches and delegate semantic screening
   to subagents. Record include/exclude/maybe decisions with reasons.
4. **Evidence**: hydrate selected records, follow references and citing papers,
   and keep per-source provenance.
5. **Export**: write Markdown (synthesis report & evidence cards), JSON (with screening ledger), BibTeX, or RIS. Supports filtering by screening verdict (e.g., `verdict="include"`). Full-text acquisition and parsing
   remain a separate companion workflow.

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `create_research_brief` | Resolve a seed paper and build a reusable research context |
| `search_literature` | Unified WoS/Scopus/OpenAlex/Crossref/IEEE search with deduplication |
| `search_ieee` | Direct IEEE Xplore metadata and abstract search |
| `get_literature_records` | Hydrate stored records without repeating discovery; `fetchReferences=true` optionally fills references |
| `expand_citation_graph` | One-hop references, citing papers, or related works |
| `save_screening` | Persist subagent screening decisions and reasons |
| `resolve_fulltext_access` | Resolve optimal full-text PDF acquisition routes (direct OA, Elsevier API, IEEE, WebVPN) |
| `generate_reading_cards` | Generate structured deep-reading evidence cards and MinerU companion prompts |
| `export_literature` | Export Markdown, JSON, BibTeX, or RIS; supports `verdict` filtering |
| `get_source_status` | Inspect source configuration, product tier, quotas, and sessions |

The original per-platform tools remain available for targeted lookups, PDF
access, and legacy workflows.

`search_ieee` performs a direct IEEE Xplore metadata/abstract search. IEEE is
also accepted as an explicit source in `search_literature`; it is not part of
the default `quick`, `balanced`, or `deep` source sets.

## Native Full-Text Acquisition

PDF acquisition is ported from scansci-pdf into TypeScript and requires no
external `scansci-pdf` or `mineru` CLI. Resolution order:

1. Record-provided PDF URL or input URL
2. arXiv
3. Unpaywall
4. OpenAlex
5. Semantic Scholar
6. Europe PMC / PMC
7. Crossref PDF links
8. Elsevier API (`ELSEVIER_API_KEY`)
9. Deterministic routes for 22 publishers (Elsevier, Springer Nature, Wiley,
   IEEE, MDPI, PLOS, Frontiers, Copernicus, ACS, RSC, IOP, AIP, APS, Oxford,
   SAGE, Taylor & Francis, Science, PNAS, Optica, ACM, and others)
10. Optional WebVPN / CARSI
11. PDF links discovered on the landing page

`MINERU_TOKEN` enables MinerU Cloud parsing; without it, the bundled
`pdf-parse` extractor is used. `OA_EMAIL` is used for polite-pool requests.
Institutional access is configured with `TWOSCI_WEBVPN_*` and
`TWOSCI_CARSI_*`; an existing scansci config can be imported read-only via
`TWOSCI_SCANSCI_CONFIG`.

The plugin does not bundle a browser and does not integrate Sci-Hub.
Cloudflare/Akamai challenges and interactive SSO cannot be replicated over
plain HTTP; those cases fail with an explicit reason.

## Result Layers

`search_literature` separates response detail from upstream quota:

- `metadata`: title, authors, year, venue, DOI, source IDs.
- `abstract`: adds abstract, keywords, and per-source citation counts.
- `evidence`: adds references, open-access links, and all identifiers.

For an Expanded WoS search, TwoSCI fetches the full record once and keeps it in
the session. `layer` only controls how much is returned to the model; it does
not trigger a second WoS lookup.

## Search Modes

| Mode | Results per source | Typical use |
| --- | --- | --- |
| `quick` | 10 | Scope a topic and test query terms |
| `balanced` | 25 | Default formal screening pass |
| `deep` | 50 | After the query has converged |

## Web of Science Behavior

If `WOS_EXPANDED_API_KEY` is configured:

- Discovery, detail, and citation lookups default to Expanded.
- Expanded records default to Full Record, so abstracts are available without
  a second quota-consuming request.
- Citation expansion uses `/references`, `/citing`, and `/related`.

If only `WOS_API_KEY` is configured, TwoSCI falls back to Starter v2 and warns
that abstracts and citation relations are limited. Starter trials are not
sufficient for a practical abstract-screening workflow; institutional WoS
access or Expanded is recommended.

## IEEE Xplore Behavior

Configure `IEEE_XPLORE_API_KEY` to enable IEEE Xplore. The integration uses the
official Metadata API with the key passed as the `apikey` query parameter.

- One request returns up to 200 records.
- Search results include abstracts, author keywords, IEEE terms, citation
  counts, open-access status, and IEEE article numbers.
- IEEE metadata may include records outside your institution's subscription;
  this does not grant full-text access.
- IEEE has no references or citing-paper graph in this integration. Use WoS
  Expanded or OpenAlex for citation expansion.
- `IEEE_XPLORE_RPS` controls the local request rate. Keep it at or below the
  rate limit shown during IEEE registration; the default is 1 request/second.

After applying, IEEE reviews the application and issues keys during US Eastern
business hours on weekdays. An unapproved key returns
`ERR_403_DEVELOPER_INACTIVE`.

## Installation

### Codex

From a local checkout:

```text
codex plugin marketplace add F:\path\to\TwoSCI
codex plugin add twosci@twosci-marketplace
```

From GitHub:

```text
codex plugin marketplace add zzhzkx/TwoSCI
codex plugin add twosci@twosci-marketplace
```

### Claude Code

```text
/plugin marketplace add zzhzkx/TwoSCI
/plugin install twosci@twosci-marketplace
```

### Build from Source

```bash
npm ci
npm run build:plugin
```

`npm run build:plugin` creates `plugin/`, a clean bundle containing the MCP
server, the skill, and Codex/Claude manifests. The development repository and
its `node_modules` are not copied into the plugin.

## Configuration

Create `.env` from `.env.example`, or configure the same variables in the host
application. Never commit real credentials.

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

- `WOS_EXPANDED_API_KEY`: preferred WoS product.
- `WOS_API_KEY`: Starter fallback.
- `ELSEVIER_API_KEY`: Scopus detail/abstract entitlement.
- `SCOPUS_SEARCH_API_KEY`: optional dedicated Scopus Search key.
- `IEEE_XPLORE_API_KEY`: IEEE Xplore Metadata API key.
- `IEEE_XPLORE_RPS`: local IEEE request rate; default `1`.
- `OPENALEX_EMAIL`: polite-pool contact email.
- `CROSSREF_MAILTO`: Crossref polite-pool contact email.

## Example: Seed Paper

User input:

> This is my baseline paper: DOI `10.xxxx/xxxx`. Use it to find background,
> indicators, and policy evaluation studies in this field.

Agent flow:

1. Call `create_research_brief` with the DOI and the user's intent.
2. Review the returned seed abstract, keywords, references, citing sample, and
   frequent terms.
3. Compose two to four explicit queries; do not silently rewrite the research
   scope.
4. Call `search_literature` with the returned `brief_id`.
5. Screen abstracts in subagent batches and call `save_screening`.
6. Call `get_literature_records` for selected `record_id`s.
7. Call `expand_citation_graph` for the seed and key included papers.
8. Export the final set with `export_literature` (`format="markdown"` or `format="json"`, optionally `verdict="include"`).

The bundled `skills/literature-search` skill defines the subagent batching
protocol and the full evidence workflow.

## Data and Compliance

- WoS/Scopus/IEEE full records are held in memory for the current research session.
- No background disk cache is written for WoS/Scopus/IEEE content.
- User-initiated BibTeX/RIS/JSON export is the intended retention path.
- Citation counts are kept per source and are not summed across databases.
- OpenAlex/Crossref may use short-lived in-process caches.
- Google Scholar scraping and Sci-Hub are not part of the default workflow.

## Development

```bash
npm ci
npm run build
npm run lint
npm test -- --runInBand
npm run build:plugin
```

## License

MIT. See `LICENSE`.
