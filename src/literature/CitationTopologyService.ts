import type { LiteratureRecord } from './types.js';

export interface CitationTopologyNode {
  id: string;
  title: string;
  authors: string[];
  year?: number | string;
  doi?: string;
  venue?: string;
  citedCount?: number;
  role: 'seed' | 'foundation_ref' | 'evolution_cite' | 'related';
  relationshipNote: string;
}

export interface CitationTopologyResult {
  seedRecord: LiteratureRecord;
  foundations: CitationTopologyNode[];
  evolutions: CitationTopologyNode[];
  mermaidGraph: string;
  markdownReport: string;
}

export class CitationTopologyService {
  /**
   * Build topology and evolutionary narrative for a given seed paper.
   */
  static buildTopology(
    seed: LiteratureRecord,
    references: LiteratureRecord[] = [],
    citingPapers: LiteratureRecord[] = []
  ): CitationTopologyResult {
    const foundations: CitationTopologyNode[] = references.slice(0, 5).map((ref, i) => {
      const cited = ref.citedBy?.webofscience || ref.citedBy?.scopus || 0;
      return {
        id: `Ref_${i + 1}`,
        title: ref.title,
        authors: ref.authors,
        year: ref.year || '历史工作',
        doi: ref.doi,
        venue: ref.venue,
        citedCount: cited,
        role: 'foundation_ref',
        relationshipNote: `前驱参考文献 (Cited Reference · ${ref.year || '历史工作'} · 被引: ${cited} 次)`
      };
    });

    const evolutions: CitationTopologyNode[] = citingPapers.slice(0, 5).map((cite, i) => {
      const cited = cite.citedBy?.webofscience || cite.citedBy?.scopus || 0;
      return {
        id: `Cite_${i + 1}`,
        title: cite.title,
        authors: cite.authors,
        year: cite.year || '最新进展',
        doi: cite.doi,
        venue: cite.venue,
        citedCount: cited,
        role: 'evolution_cite',
        relationshipNote: `后继施引文献 (Citing Paper · ${cite.year || '最新进展'} · 被引: ${cited} 次)`
      };
    });

    const mermaidGraph = this.generateMermaid(seed, foundations, evolutions);
    const markdownReport = this.generateMarkdown(seed, foundations, evolutions, mermaidGraph);

    return {
      seedRecord: seed,
      foundations,
      evolutions,
      mermaidGraph,
      markdownReport
    };
  }

  private static generateMermaid(
    seed: LiteratureRecord,
    foundations: CitationTopologyNode[],
    evolutions: CitationTopologyNode[]
  ): string {
    const lines: string[] = [
      '```mermaid',
      'graph TD',
      '    classDef seed fill:#0F766E,stroke:#0d5c56,stroke-width:3px,color:#fff;',
      '    classDef ref fill:#0284C7,stroke:#0369a1,stroke-width:1px,color:#fff;',
      '    classDef cite fill:#8B5CF6,stroke:#7c3aed,stroke-width:1px,color:#fff;',
      ''
    ];

    const seedLabel = `S("【目标文献】${this.escapeMermaid(seed.title)}<br/>(${seed.year || 'Seed'})"):::seed`;
    lines.push(`    ${seedLabel}`);

    foundations.forEach((f, idx) => {
      const nodeName = `R${idx + 1}`;
      const label = `"${this.escapeMermaid(f.title)}<br/>(${f.year})"`;
      lines.push(`    ${nodeName}[${label}]:::ref --> S`);
    });

    evolutions.forEach((c, idx) => {
      const nodeName = `C${idx + 1}`;
      const label = `"${this.escapeMermaid(c.title)}<br/>(${c.year})"`;
      lines.push(`    S --> ${nodeName}[${label}]:::cite`);
    });

    lines.push('```');
    return lines.join('\n');
  }

  private static generateMarkdown(
    seed: LiteratureRecord,
    foundations: CitationTopologyNode[],
    evolutions: CitationTopologyNode[],
    mermaid: string
  ): string {
    const firstAuthor = seed.authors[0] || 'Unknown';
    const lines: string[] = [
      `# 🕸️ 学术引文网络与演化拓扑追踪报告`,
      ``,
      `- **目标核心文献**: *${seed.title}* (${firstAuthor} et al., ${seed.year || 'ND'})`,
      `- **DOI**: \`${seed.doi || '无 DOI'}\``,
      `- **出版物**: ${seed.venue || '未知期刊/会议'}`,
      ``,
      mermaid,
      ``,
      `---`,
      ``,
      `## 一、向前溯源：参考文献拓扑脉络 (Foundational References)`,
      ``
    ];

    if (foundations.length === 0) {
      lines.push(`*暂无前驱参考文献记录。*`);
    } else {
      foundations.forEach((f, i) => {
        const doiStr = f.doi ? ` · DOI: [${f.doi}](https://doi.org/${encodeURI(f.doi)})` : '';
        lines.push(`### [Ref-${i + 1}] ${f.title}`);
        lines.push(`- **基本信息**: ${f.authors.slice(0, 3).join('; ')} · ${f.year}${doiStr}`);
        lines.push(`- **引文关系**: 前驱参考文献 (Cited Reference)`);
        lines.push(`- **出版刊物**: ${f.venue || '未知出版物'}`);
        lines.push(`- **引用频次**: 记录被引 ${f.citedCount} 次`);
        lines.push(``);
      });
    }

    lines.push(`## 二、向后追踪：施引文献演进脉络 (Evolutionary Citing Works)`);
    lines.push(``);

    if (evolutions.length === 0) {
      lines.push(`*暂无施引文献演进记录。*`);
    } else {
      evolutions.forEach((c, i) => {
        const doiStr = c.doi ? ` · DOI: [${c.doi}](https://doi.org/${encodeURI(c.doi)})` : '';
        lines.push(`### [Cite-${i + 1}] ${c.title}`);
        lines.push(`- **基本信息**: ${c.authors.slice(0, 3).join('; ')} · ${c.year}${doiStr}`);
        lines.push(`- **引文关系**: 后继施引工作 (Citing Paper)`);
        lines.push(`- **出版刊物**: ${c.venue || '未知出版物'}`);
        lines.push(`- **引用频次**: 记录被引 ${c.citedCount} 次`);
        lines.push(``);
      });
    }

    return lines.join('\n');
  }

  private static escapeMermaid(text: string): string {
    if (!text) return '';
    return text
      .replace(/["#\n\r]/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 40)
      .trim();
  }
}
