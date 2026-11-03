import type {
  LiteratureRecord,
  ScreeningDecision,
  ResearchBrief,
  SearchSession
} from './types.js';

export interface ExportContext {
  query?: string;
  brief?: ResearchBrief;
  search?: SearchSession;
  screening?: Record<string, ScreeningDecision>;
}

export interface ExportOptions {
  includeAbstract?: boolean;
  context?: ExportContext;
}

export function exportRecords(
  records: LiteratureRecord[],
  format: 'bibtex' | 'ris' | 'json' | 'markdown',
  optionsOrIncludeAbstract: boolean | ExportOptions = true
): string {
  const options: ExportOptions = typeof optionsOrIncludeAbstract === 'boolean'
    ? { includeAbstract: optionsOrIncludeAbstract }
    : optionsOrIncludeAbstract;
  const includeAbstract = options.includeAbstract !== false;

  if (format === 'bibtex') return toBibtex(records, includeAbstract);
  if (format === 'ris') return toRis(records, includeAbstract);
  if (format === 'markdown') return toMarkdown(records, includeAbstract, options.context);
  return toExportJsonString(records, includeAbstract, options.context?.screening);
}

function toBibtex(records: LiteratureRecord[], includeAbstract: boolean): string {
  const keys = new Set<string>();
  return records.map(record => {
    const key = uniqueKey(bibtexKey(record), keys);
    const type = record.venue ? 'article' : 'misc';
    const fields: Array<[string, string]> = [
      ['title', record.title],
      ['author', record.authors.join(' and ')],
      ['year', record.year ? String(record.year) : ''],
      ['journal', record.venue || ''],
      ['volume', record.volume || ''],
      ['number', record.issue || ''],
      ['pages', record.pages || ''],
      ['doi', record.doi],
      ['url', record.url],
      ['keywords', record.keywords.join(', ')]
    ];
    if (includeAbstract && record.abstract) fields.push(['abstract', record.abstract]);
    const presentFields = fields.filter(([, value]) => Boolean(value));

    return `@${type}{${key},\n${presentFields.map(([name, value]) => `  ${name} = {${escapeBibtex(value)}}`).join(',\n')}\n}`;
  }).join('\n\n');
}

function toRis(records: LiteratureRecord[], includeAbstract: boolean): string {
  return records.map(record => {
    const lines = [
      `TY  - ${record.venue ? 'JOUR' : 'GEN'}`,
      `TI  - ${record.title}`,
      ...record.authors.map(author => `AU  - ${author}`),
      ...(record.year ? [`PY  - ${record.year}`] : []),
      ...(record.venue ? [`JO  - ${record.venue}`] : []),
      ...(record.volume ? [`VL  - ${record.volume}`] : []),
      ...(record.issue ? [`IS  - ${record.issue}`] : []),
      ...(record.pages ? [`SP  - ${record.pages}`] : []),
      ...(record.doi ? [`DO  - ${record.doi}`] : []),
      ...(record.url ? [`UR  - ${record.url}`] : []),
      ...record.keywords.map(keyword => `KW  - ${keyword}`),
      ...(includeAbstract && record.abstract ? [`AB  - ${record.abstract}`] : []),
      'ER  - '
    ];
    return lines.join('\n');
  }).join('\n\n');
}

function toExportJsonString(
  records: LiteratureRecord[],
  includeAbstract: boolean,
  screeningMap?: Record<string, ScreeningDecision>
): string {
  const items = records.map(record => toExportJson(record, includeAbstract, screeningMap?.[record.recordId]));
  return JSON.stringify(items, null, 2);
}

function toExportJson(
  record: LiteratureRecord,
  includeAbstract: boolean,
  decision?: ScreeningDecision
): Record<string, unknown> {
  return {
    record_id: record.recordId,
    title: record.title,
    authors: record.authors,
    year: record.year,
    venue: record.venue,
    volume: record.volume,
    issue: record.issue,
    pages: record.pages,
    doi: record.doi,
    url: record.url,
    open_access: record.openAccess,
    pdf_url: record.pdfUrl || undefined,
    keywords: record.keywords,
    cited_by: record.citedBy,
    identifiers: record.identifiers,
    sources: record.sources,
    ...(decision
      ? {
          screening: {
            verdict: decision.verdict,
            reason: decision.reason,
            tags: decision.tags || [],
            confidence: decision.confidence,
            decided_at: decision.decidedAt
          }
        }
      : {}),
    ...(includeAbstract ? { abstract: record.abstract } : {})
  };
}

function toMarkdown(
  records: LiteratureRecord[],
  includeAbstract: boolean,
  context?: ExportContext
): string {
  const lines: string[] = [];

  lines.push('# TwoSCI 文献研究与筛选报告 (Literature Review & Screening Report)\n');

  const metaLines: string[] = [];
  metaLines.push(`- **导出时间 (Exported At)**: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`);
  metaLines.push(`- **文献条目数 (Total Records)**: ${records.length}`);

  if (context?.brief) {
    if (context.brief.intent) {
      metaLines.push(`- **研究意图 (Research Intent)**: ${cleanInline(context.brief.intent)}`);
    }
    if (context.brief.seed) {
      const seedTitle = cleanInline(context.brief.seed.title);
      const seedDoi = context.brief.seed.doi;
      const seedUrl = context.brief.seed.url || (seedDoi ? `https://doi.org/${seedDoi}` : '');
      const seedLink = seedUrl ? `[${seedTitle}](${seedUrl})` : seedTitle;
      metaLines.push(`- **基准种子文献 (Seed Paper)**: ${seedLink}${seedDoi ? ` (DOI: ${seedDoi})` : ''}`);
    }
    if (context.brief.focus && context.brief.focus.length > 0) {
      metaLines.push(`- **关注重点 (Focus Areas)**: ${context.brief.focus.join(', ')}`);
    }
  }

  if (context?.query) {
    metaLines.push(`- **检索式 (Search Query)**: \`${cleanInline(context.query)}\``);
  }

  const screeningMap = context?.screening;
  if (screeningMap && Object.keys(screeningMap).length > 0) {
    let inc = 0;
    let maybe = 0;
    let exc = 0;
    let unscreened = 0;
    for (const r of records) {
      const v = screeningMap[r.recordId]?.verdict;
      if (v === 'include') inc++;
      else if (v === 'maybe') maybe++;
      else if (v === 'exclude') exc++;
      else unscreened++;
    }
    metaLines.push(
      `- **筛选统计 (Screening Stats)**: ✅ 纳入 (Include): ${inc} | ❓ 待定 (Maybe): ${maybe} | ❌ 排除 (Exclude): ${exc}${
        unscreened > 0 ? ` | ⏳ 未评估 (Unscreened): ${unscreened}` : ''
      }`
    );
  }

  lines.push(metaLines.join('\n'));
  lines.push('\n---\n');

  lines.push('## 一、文献一览表 (Overview Table)\n');
  lines.push('| # | 标题 (Title) | 年份 | 出版物 (Venue) | 引用 (Citations) | 筛选结论 (Verdict) | DOI / 链接 |');
  lines.push('|---|-------------|------|----------------|------------------|-------------------|------------|');

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const idx = i + 1;
    const title = escapeTable(r.title);
    const year = r.year ? String(r.year) : '-';
    const venue = escapeTable(r.venue || formatSourcesShort(r));
    const citations = formatCitations(r.citedBy);
    const decision = screeningMap?.[r.recordId];
    const verdict = decision ? formatVerdictBadge(decision.verdict) : '-';
    const link = r.doi
      ? `[${escapeTable(r.doi)}](https://doi.org/${r.doi})`
      : r.url
        ? `[链接](${r.url})`
        : '-';
    lines.push(`| ${idx} | ${title} | ${year} | ${venue} | ${citations} | ${verdict} | ${link} |`);
  }

  lines.push('\n---\n');
  lines.push('## 二、文献详细证据卡片 (Detailed Records)\n');

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const idx = i + 1;
    const decision = screeningMap?.[r.recordId];

    lines.push(`### [${idx}] ${r.title}\n`);

    const details: string[] = [];
    if (r.authors && r.authors.length > 0) {
      details.push(`- **作者 (Authors)**: ${r.authors.join(', ')}`);
    } else {
      details.push('- **作者 (Authors)**: 未知');
    }

    const venueParts: string[] = [];
    if (r.venue) venueParts.push(r.venue);
    if (r.year) venueParts.push(String(r.year));
    if (r.volume) venueParts.push(`Vol. ${r.volume}`);
    if (r.issue) venueParts.push(`No. ${r.issue}`);
    if (r.pages) venueParts.push(`pp. ${r.pages}`);
    if (venueParts.length > 0) {
      details.push(`- **出版物 (Publication)**: ${venueParts.join(' · ')}`);
    }

    if (r.doi) {
      details.push(`- **DOI**: [${r.doi}](https://doi.org/${r.doi})`);
    } else if (r.url) {
      details.push(`- **URL**: [${r.url}](${r.url})`);
    }

    const sourcesDesc = formatSourcesDetail(r);
    if (sourcesDesc) {
      details.push(`- **数据库来源 (Sources)**: ${sourcesDesc}`);
    }

    const oaDesc = r.openAccess ? '是 (Open Access)' : '否';
    const pdfDesc = r.pdfUrl ? ` · [PDF 直达链接](${r.pdfUrl})` : '';
    details.push(`- **开放获取 (OA)**: ${oaDesc}${pdfDesc}`);

    if (decision) {
      details.push('- **筛选评估 (Screening Decision)**:');
      details.push(`  - **结论 (Verdict)**: ${formatVerdictBadge(decision.verdict)}`);
      details.push(`  - **理由 (Reason)**: ${decision.reason}`);
      if (decision.tags && decision.tags.length > 0) {
        details.push(`  - **标签 (Tags)**: ${decision.tags.join(', ')}`);
      }
      if (decision.confidence !== undefined) {
        details.push(`  - **置信度 (Confidence)**: ${(decision.confidence * 100).toFixed(0)}%`);
      }
      if (decision.decidedAt) {
        details.push(`  - **评估时间**: ${decision.decidedAt.replace('T', ' ').slice(0, 19)} UTC`);
      }
    }

    if (r.keywords && r.keywords.length > 0) {
      details.push(`- **关键词 (Keywords)**: ${r.keywords.join('; ')}`);
    }

    if (r.references && r.references.length > 0) {
      details.push(`- **引文网络 (References Count)**: 包含 ${r.references.length} 条参考文献记录`);
    }

    if (includeAbstract) {
      if (r.abstract && r.abstract.trim()) {
        const cleanAbs = r.abstract.replace(/\s+/g, ' ').trim();
        details.push(`- **摘要 (Abstract)**:\n  > ${cleanAbs}`);
      } else {
        details.push('- **摘要 (Abstract)**: *(该条目暂无摘要内容)*');
      }
    }

    lines.push(details.join('\n'));
    lines.push('');
  }

  return lines.join('\n');
}

function cleanInline(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

function escapeTable(text: string): string {
  return cleanInline(text).replace(/\|/g, '\\|');
}

function formatVerdictBadge(verdict: string): string {
  if (verdict === 'include') return '✅ 纳入 (Include)';
  if (verdict === 'maybe') return '❓ 待定 (Maybe)';
  if (verdict === 'exclude') return '❌ 排除 (Exclude)';
  return verdict;
}

function formatCitations(citedBy: Record<string, number>): string {
  const entries = Object.entries(citedBy);
  if (entries.length === 0) return '-';
  return entries.map(([src, count]) => `${formatSourceName(src)}: ${count}`).join(', ');
}

function formatSourceName(source: string): string {
  const names: Record<string, string> = {
    webofscience: 'WoS',
    scopus: 'Scopus',
    openalex: 'OpenAlex',
    crossref: 'Crossref',
    ieee: 'IEEE Xplore'
  };
  return names[source.toLowerCase()] || source;
}

function formatSourcesShort(r: LiteratureRecord): string {
  if (!r.sources || r.sources.length === 0) return '未知';
  return r.sources.map(s => formatSourceName(s.source)).join('/');
}

function formatSourcesDetail(r: LiteratureRecord): string {
  if (!r.sources || r.sources.length === 0) return '';
  return r.sources
    .map(s => {
      const name = formatSourceName(s.source);
      const cite =
        s.citedBy !== undefined
          ? ` (被引: ${s.citedBy})`
          : r.citedBy?.[s.source] !== undefined
            ? ` (被引: ${r.citedBy[s.source]})`
            : '';
      const view = s.recordView ? ` [${s.recordView}]` : '';
      return `${name}${cite}${view}`;
    })
    .join(', ');
}

function bibtexKey(record: LiteratureRecord): string {
  const surname = (record.authors[0] || 'anon').trim().split(/\s+/).pop() || 'anon';
  const year = record.year || 'nd';
  const word = record.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .find(token => token.length >= 4 && !['with', 'from', 'using', 'based', 'study'].includes(token)) || 'paper';
  return `${surname}${year}${word}`.replace(/[^\p{L}\p{N}_-]/gu, '');
}

function uniqueKey(base: string, used: Set<string>): string {
  let key = base || 'paper';
  let suffix = 1;
  while (used.has(key.toLowerCase())) {
    key = `${base}${suffix++}`;
  }
  used.add(key.toLowerCase());
  return key;
}

function escapeBibtex(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}
