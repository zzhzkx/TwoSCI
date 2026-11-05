import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const root = process.cwd();
const outDir = resolve(root, 'plugin');
if (outDir !== root && !outDir.startsWith(`${root}${sep}`)) {
  throw new Error(`Refusing to write outside the project: ${outDir}`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'dist'), { recursive: true });
mkdirSync(join(outDir, '.codex-plugin'), { recursive: true });
mkdirSync(join(outDir, '.claude-plugin'), { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: join(outDir, 'dist', 'server.cjs'),
  sourcemap: false,
  minify: false,
  legalComments: 'none'
});

cpSync(join(root, 'skills'), join(outDir, 'skills'), { recursive: true });
cpSync(join(root, 'LICENSE'), join(outDir, 'LICENSE'));
cpSync(join(root, '.env.example'), join(outDir, '.env.example'));

const packageJson = {
  name: 'twosci',
  version: '0.2.0',
  private: true,
  type: 'commonjs'
};

const interfaceMetadata = {
  displayName: 'TwoSCI',
  shortDescription: 'Run a human-like literature research workflow with WoS, Scopus, and IEEE.',
  longDescription:
    'TwoSCI starts from a seed paper and the user research intent, discovers deduplicated literature across Web of Science, Scopus, OpenAlex, Crossref, and IEEE Xplore, delegates abstract screening to subagents, expands one-hop citation networks, keeps screening decisions, and exports evidence-ready records.',
  developerName: 'zzhzkx',
  category: 'Science',
  capabilities: ['Interactive', 'Read', 'Write'],
  defaultPrompt: [
    'Use my seed paper to map the field, indicators, and follow-up studies.',
    'Search WoS, Scopus, and IEEE, then screen the abstracts with subagents.',
    'Expand the references and citing papers of these key papers.'
  ],
  brandColor: '#0F766E'
};

const baseManifest = {
  name: 'twosci',
  version: '0.2.0',
  description:
    'Seed-paper-driven literature discovery, abstract screening, citation expansion, and evidence export across Web of Science, Scopus, OpenAlex, Crossref, and IEEE Xplore.',
  author: { name: 'zzhzkx' },
  license: 'MIT',
  keywords: [
    'literature search',
    'web of science',
    'scopus',
    'openalex',
    'ieee xplore',
    'citation graph',
    'systematic review',
    'MCP'
  ],
  homepage: 'https://github.com/zzhzkx/TwoSCI',
  repository: 'https://github.com/zzhzkx/TwoSCI',
  skills: './skills/',
  mcpServers: './.mcp.json'
};

const portableManifest = {
  ...baseManifest,
  extensions: {
    'com.openai': interfaceMetadata
  }
};
const codexManifest = {
  ...baseManifest,
  interface: interfaceMetadata
};
const claudeManifest = {
  ...baseManifest,
  skills: ['./skills/literature-search']
};

writeJson(join(outDir, 'package.json'), packageJson);
writeJson(join(outDir, 'plugin.json'), portableManifest);
writeJson(join(outDir, '.codex-plugin', 'plugin.json'), codexManifest);
writeJson(join(outDir, '.claude-plugin', 'plugin.json'), claudeManifest);
writeJson(join(outDir, 'mcp.json'), {
  mcpServers: {
    twosci: {
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/dist/server.cjs']
    }
  }
});
writeJson(join(outDir, '.mcp.json'), {
  mcpServers: {
    twosci: {
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/dist/server.cjs']
    }
  }
});

writeFileSync(join(outDir, 'README.md'), pluginReadme(), 'utf8');
console.log(`Plugin bundle written to ${outDir}`);

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function pluginReadme() {
  return `# TwoSCI

This directory is the installable plugin bundle. It contains the compiled MCP
server, the literature-search skill, and manifests for Codex and Claude Code.

## Install

Claude Code:

\`\`\`text
/plugin install twosci --marketplace zzhzkx/TwoSCI
\`\`\`

Codex:

\`\`\`text
codex plugin marketplace add zzhzkx/TwoSCI
codex plugin add twosci@twosci-marketplace
\`\`\`

## Configuration

Copy \`.env.example\` to \`.env\` next to the plugin, or configure the same
variables in the host application:

- \`WOS_EXPANDED_API_KEY\`: preferred Web of Science product.
- \`WOS_API_KEY\`: Starter fallback.
- \`ELSEVIER_API_KEY\`: Scopus details.
- \`SCOPUS_SEARCH_API_KEY\`: optional dedicated Scopus Search key.
- \`IEEE_XPLORE_API_KEY\`: IEEE Xplore Metadata API key.
- \`IEEE_XPLORE_RPS\`: local IEEE request rate; default \`1\`.
- \`OPENALEX_EMAIL\`: polite-pool contact email.

If \`WOS_EXPANDED_API_KEY\` is present, all WoS calls use Expanded by default.

## Local test

\`\`\`bash
node dist/server.cjs
\`\`\`

The server speaks MCP over stdio.
`;
}
