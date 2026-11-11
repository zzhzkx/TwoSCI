# TwoSCI

This directory is the installable plugin bundle. It contains the compiled MCP
server, the literature-search skill, and manifests for Codex and Claude Code.

## Install

Claude Code:

```text
/plugin install twosci --marketplace zzhzkx/TwoSCI
```

Codex:

```text
codex plugin marketplace add zzhzkx/TwoSCI
codex plugin add twosci@twosci-marketplace
```

## Configuration

Copy `.env.example` to `.env` next to the plugin, or configure the same
variables in the host application:

- `WOS_EXPANDED_API_KEY`: preferred Web of Science product.
- `WOS_API_KEY`: Starter fallback.
- `ELSEVIER_API_KEY`: Scopus details.
- `SCOPUS_SEARCH_API_KEY`: optional dedicated Scopus Search key.
- `IEEE_XPLORE_API_KEY`: IEEE Xplore Metadata API key.
- `IEEE_XPLORE_RPS`: local IEEE request rate; default `1`.
- `OPENALEX_EMAIL`: polite-pool contact email.

If `WOS_EXPANDED_API_KEY` is present, all WoS calls use Expanded by default.

PDF acquisition is native (Unpaywall/OpenAlex/Europe PMC/publisher routes).
The optional browser fallback uses Patchright with the locally installed
Chrome or Edge; Chromium is not bundled. Set `TWOSCI_BROWSER_HEADLESS=auto`
to try headless first and relaunch headed only when a challenge persists.

## Local test

```bash
node dist/server.cjs
```

The server speaks MCP over stdio.
