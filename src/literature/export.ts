import type { LiteratureRecord } from './types.js';

export function exportRecords(
  records: LiteratureRecord[],
  format: 'bibtex' | 'ris' | 'json',
  includeAbstract: boolean
): string {
  if (format === 'bibtex') return toBibtex(records, includeAbstract);
  if (format === 'ris') return toRis(records, includeAbstract);
  return JSON.stringify(records.map(record => toExportJson(record, includeAbstract)), null, 2);
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

function toExportJson(record: LiteratureRecord, includeAbstract: boolean): Record<string, unknown> {
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
    ...(includeAbstract ? { abstract: record.abstract } : {})
  };
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
