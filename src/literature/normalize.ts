import { createHash } from 'node:crypto';
import type { Paper } from '../models/Paper.js';
import type { WosReference } from '../services/WebOfScienceParser.js';
import type {
  LiteratureRecord,
  LiteratureSource,
  RecordSourceRef,
  ResultLayer
} from './types.js';

const TITLE_STOPWORDS = new Set([
  'about', 'after', 'among', 'based', 'between', 'from', 'into', 'study',
  'that', 'their', 'through', 'using', 'with', 'from', 'this', 'these',
  'those', 'under', 'over', 'toward', 'towards', 'into', 'within'
]);

const SOURCE_PRIORITY: Record<LiteratureSource, number> = {
  webofscience: 4,
  scopus: 3,
  ieee: 3,
  openalex: 2,
  crossref: 1
};

export function normalizeDoi(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/[.,;)\s]+$/, '')
    .toLowerCase();
}

export function recordFromPaper(
  paper: Paper,
  source: LiteratureSource,
  rank: number
): LiteratureRecord {
  const doi = normalizeDoi(paper.doi);
  const extra = paper.extra || {};
  const wosUid = normalizeWosUid(extra.uid ?? (source === 'webofscience' ? paper.paperId : undefined));
  const scopusEid = normalizeScopusEid(extra.eid ?? extra.scopusId ?? (source === 'scopus' ? paper.paperId : undefined));
  const openalexId = normalizeOpenAlexId(extra.openalexId ?? (source === 'openalex' ? paper.paperId : undefined));
  const pmid = normalizePmid(extra.pmid ?? extra.pubmedId);
  const arxiv = normalizeArxivId(paper.paperId, extra);
  const sourceId = sourceIdentifier(source, paper, doi, wosUid, scopusEid, openalexId);
  const citationCount = toNumber(paper.citationCount);
  const oaStatus = typeof extra.oaStatus === 'string' ? extra.oaStatus.toLowerCase() : '';
  const sourceRef: RecordSourceRef = {
    source,
    sourceId,
    rank,
    ...(paper.url ? { url: paper.url } : {}),
    ...(citationCount !== undefined ? { citedBy: citationCount } : {}),
    ...(extra.recordView ? { recordView: String(extra.recordView) } : {})
  };

  const record: LiteratureRecord = {
    recordId: makeRecordId({ doi, wosUid, scopusEid, openalexId, title: paper.title, year: paper.year }),
    title: cleanText(paper.title) || 'No title available',
    authors: uniqueStrings(paper.authors || []),
    year: paper.year,
    venue: cleanText(paper.journal || '') || undefined,
    volume: cleanText(paper.volume || '') || undefined,
    issue: cleanText(paper.issue || '') || undefined,
    pages: cleanText(paper.pages || '') || undefined,
    abstract: cleanText(paper.abstract || ''),
    keywords: uniqueStrings([...(paper.keywords || []), ...(paper.categories || [])]),
    categories: uniqueStrings(paper.categories || []),
    doi,
    url: cleanText(paper.url || '') || (doi ? `https://doi.org/${doi}` : ''),
    pdfUrl: cleanText(paper.pdfUrl || ''),
    openAccess: extra.isOa === true
      || extra.openAccess === true
      || (Boolean(oaStatus) && oaStatus !== 'closed' && oaStatus !== 'none'),
    identifiers: {
      ...(doi ? { doi } : {}),
      ...(wosUid ? { wosUid } : {}),
      ...(scopusEid ? { scopusEid } : {}),
      ...(openalexId ? { openalexId } : {}),
      ...(pmid ? { pmid } : {}),
      ...(arxiv ? { arxiv } : {})
    },
    sources: [sourceRef],
    citedBy: citationCount !== undefined ? { [source]: citationCount } : {},
    references: uniqueStrings(paper.references || []),
    extra: {
      ...(extra.openalexId ? { openalexId: String(extra.openalexId) } : {}),
      ...(extra.oaStatus ? { oaStatus: String(extra.oaStatus) } : {}),
      ...(extra.documentType ? { documentType: String(extra.documentType) } : {})
    }
  };
  return record;
}

export function recordFromWosReference(reference: WosReference): LiteratureRecord {
  const doi = normalizeDoi(reference.doi);
  const wosUid = normalizeWosUid(reference.uid);
  const title = cleanText(reference.citedTitle || reference.citedWork || '') || 'Untitled reference';
  const year = toNumber(reference.year);
  const citedBy = toNumber(reference.timesCited);
  return {
    recordId: makeRecordId({ doi, wosUid, title, year }),
    title,
    authors: splitAuthors(reference.citedAuthor),
    year,
    venue: cleanText(reference.citedWork || '') || undefined,
    volume: cleanText(reference.volume || '') || undefined,
    issue: undefined,
    pages: reference.page !== undefined ? String(reference.page) : undefined,
    abstract: '',
    keywords: [],
    categories: [],
    doi,
    url: doi ? `https://doi.org/${doi}` : '',
    pdfUrl: '',
    openAccess: false,
    identifiers: {
      ...(doi ? { doi } : {}),
      ...(wosUid ? { wosUid } : {})
    },
    sources: [{
      source: 'webofscience',
      sourceId: wosUid || doi || title,
      rank: 0,
      ...(citedBy !== undefined ? { citedBy } : {})
    }],
    citedBy: citedBy !== undefined ? { webofscience: citedBy } : {},
    references: [],
    extra: { referenceStub: true }
  };
}

export function dedupeRecords(records: LiteratureRecord[]): LiteratureRecord[] {
  const deduped: LiteratureRecord[] = [];

  for (const record of records) {
    const matchIndex = deduped.findIndex(existing => recordsMatch(existing, record));
    if (matchIndex >= 0) {
      deduped[matchIndex] = mergeRecords(deduped[matchIndex], record);
    } else {
      deduped.push(record);
    }
  }

  return deduped.sort((left, right) => (right.score || 0) - (left.score || 0));
}

export function mergeRecords(existing: LiteratureRecord, incoming: LiteratureRecord): LiteratureRecord {
  const sources = dedupeSources([...existing.sources, ...incoming.sources]);
  const abstract = chooseAbstract(existing, incoming);
  const title = chooseTitle(existing, incoming);
  const authors = incoming.authors.length > existing.authors.length ? incoming.authors : existing.authors;
  const doi = existing.doi || incoming.doi;
  const identifiers = {
    ...incoming.identifiers,
    ...existing.identifiers,
    ...(doi ? { doi } : {})
  };
  const year = existing.year ?? incoming.year;
  const merged: LiteratureRecord = {
    ...existing,
    recordId: makeRecordId({
      doi,
      wosUid: identifiers.wosUid,
      scopusEid: identifiers.scopusEid,
      openalexId: identifiers.openalexId,
      title,
      year
    }),
    title,
    authors,
    year,
    venue: existing.venue || incoming.venue,
    volume: existing.volume || incoming.volume,
    issue: existing.issue || incoming.issue,
    pages: existing.pages || incoming.pages,
    abstract,
    keywords: uniqueStrings([...existing.keywords, ...incoming.keywords]),
    categories: uniqueStrings([...existing.categories, ...incoming.categories]),
    doi,
    url: existing.url || incoming.url,
    pdfUrl: existing.pdfUrl || incoming.pdfUrl,
    openAccess: existing.openAccess || incoming.openAccess,
    identifiers,
    sources,
    citedBy: mergeCitationCounts(existing.citedBy, incoming.citedBy),
    references: uniqueStrings([...existing.references, ...incoming.references]),
    score: Math.max(existing.score || 0, incoming.score || 0),
    extra: { ...(incoming.extra || {}), ...(existing.extra || {}) }
  };
  return merged;
}

export function applyReciprocalRankFusion(records: LiteratureRecord[]): LiteratureRecord[] {
  const scores = new Map<string, number>();
  for (const record of records) {
    for (const source of record.sources) {
      const score = 1 / (60 + Math.max(1, source.rank));
      scores.set(record.recordId, (scores.get(record.recordId) || 0) + score);
    }
  }
  return records.map(record => ({
    ...record,
    score: Number((scores.get(record.recordId) || 0).toFixed(6))
  }));
}

export function toPublicRecord(
  record: LiteratureRecord,
  layer: ResultLayer,
  abstractChars = 3000
): Record<string, unknown> {
  const shouldIncludeAbstract = layer !== 'metadata';
  const abstract = shouldIncludeAbstract
    ? truncateText(record.abstract, Math.max(0, abstractChars))
    : '';
  return {
    record_id: record.recordId,
    title: record.title,
    authors: record.authors,
    year: record.year ?? null,
    venue: record.venue || '',
    volume: record.volume || '',
    issue: record.issue || '',
    pages: record.pages || '',
    doi: record.doi,
    abstract,
    abstract_truncated: shouldIncludeAbstract && abstract.length < record.abstract.length,
    keywords: layer === 'metadata' ? [] : record.keywords,
    categories: layer === 'metadata' ? [] : record.categories,
    cited_by: record.citedBy,
    sources: record.sources.map(source => ({
      source: source.source,
      source_id: source.sourceId,
      rank: source.rank,
      ...(source.url ? { url: source.url } : {}),
      ...(source.recordView ? { record_view: source.recordView } : {})
    })),
    identifiers: record.identifiers,
    url: record.url,
    pdf_url: record.pdfUrl || undefined,
    open_access: record.openAccess,
    references_count: record.references.length,
    ...(layer === 'evidence' ? { references: record.references } : {}),
    score: record.score
  };
}

export function recordsMatch(left: LiteratureRecord, right: LiteratureRecord): boolean {
  if (left.doi && right.doi) {
    if (normalizeDoi(left.doi) !== normalizeDoi(right.doi)) return false;
    return true;
  }
  if (sharedIdentifier(left.identifiers, right.identifiers)) return true;

  const yearCompatible = left.year === undefined || right.year === undefined || Math.abs(left.year - right.year) <= 1;
  if (!yearCompatible) return false;

  const similarity = titleSimilarity(left.title, right.title);
  if (similarity >= 0.94) return true;
  if (left.doi || right.doi) return similarity >= 0.9;
  return similarity >= 0.88 && titleTokens(left.title).size >= 4 && titleTokens(right.title).size >= 4;
}

export function titleSimilarity(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return cleanText(left).toLowerCase() === cleanText(right).toLowerCase() ? 1 : 0;
  }
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared++;
  }
  return (2 * shared) / (leftTokens.size + rightTokens.size);
}

export function titleTokens(value: string): Set<string> {
  return new Set(
    cleanText(value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 3 && !TITLE_STOPWORDS.has(token))
  );
}

function sharedIdentifier(
  left: LiteratureRecord['identifiers'],
  right: LiteratureRecord['identifiers']
): boolean {
  const keys: Array<keyof LiteratureRecord['identifiers']> = [
    'wosUid', 'scopusEid', 'openalexId', 'pmid', 'arxiv'
  ];
  return keys.some(key => Boolean(left[key] && right[key] && left[key] === right[key]));
}

function chooseAbstract(existing: LiteratureRecord, incoming: LiteratureRecord): string {
  if (!existing.abstract) return incoming.abstract;
  if (!incoming.abstract) return existing.abstract;
  const existingPriority = bestSourcePriority(existing);
  const incomingPriority = bestSourcePriority(incoming);
  if (incomingPriority > existingPriority) return incoming.abstract;
  if (incomingPriority === existingPriority && incoming.abstract.length > existing.abstract.length * 1.1) {
    return incoming.abstract;
  }
  return existing.abstract;
}

function chooseTitle(existing: LiteratureRecord, incoming: LiteratureRecord): string {
  if (!existing.title || existing.title === 'No title available') return incoming.title;
  if (!incoming.title || incoming.title === 'No title available') return existing.title;
  return bestSourcePriority(incoming) > bestSourcePriority(existing) && incoming.title.length > 12
    ? incoming.title
    : existing.title;
}

function bestSourcePriority(record: LiteratureRecord): number {
  return Math.max(0, ...record.sources.map(source => SOURCE_PRIORITY[source.source] || 0));
}

function dedupeSources(sources: RecordSourceRef[]): RecordSourceRef[] {
  const seen = new Set<string>();
  return sources
    .filter(source => {
      const key = `${source.source}:${source.sourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const priority = (SOURCE_PRIORITY[right.source] || 0) - (SOURCE_PRIORITY[left.source] || 0);
      return priority || left.rank - right.rank;
    });
}

function mergeCitationCounts(
  left: Record<string, number>,
  right: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...left };
  for (const [source, count] of Object.entries(right)) {
    merged[source] = Math.max(merged[source] || 0, count);
  }
  return merged;
}

function sourceIdentifier(
  source: LiteratureSource,
  paper: Paper,
  doi: string,
  wosUid: string,
  scopusEid: string,
  openalexId: string
): string {
  if (source === 'webofscience') return wosUid || doi || paper.paperId;
  if (source === 'scopus') return scopusEid || doi || paper.paperId;
  if (source === 'openalex') return openalexId || doi || paper.paperId;
  return doi || paper.paperId;
}

function makeRecordId(input: {
  doi?: string;
  wosUid?: string;
  scopusEid?: string;
  openalexId?: string;
  title: string;
  year?: number;
}): string {
  const key = input.doi
    ? `doi:${normalizeDoi(input.doi)}`
    : input.wosUid
      ? `wos:${input.wosUid}`
      : input.scopusEid
        ? `scopus:${input.scopusEid}`
        : input.openalexId
          ? `openalex:${input.openalexId}`
          : `title:${[...titleTokens(input.title)].sort().join(' ')}:${input.year || ''}`;
  return `lit_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function normalizeWosUid(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/WOS:\S+/i);
  return match ? match[0].toUpperCase() : '';
}

function normalizeScopusEid(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/2-s2\.0-\d+/i);
  return match ? match[0] : '';
}

function normalizeOpenAlexId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(?:https?:\/\/openalex\.org\/)?(W\d+)$/i);
  return match ? match[1].toUpperCase() : '';
}

function normalizePmid(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).trim();
  return /^\d+$/.test(text) ? text : '';
}

function normalizeArxivId(paperId: string, extra: Record<string, unknown>): string {
  const candidate = String(extra.arxivId || paperId || '').trim();
  return /^\d{4}\.\d{4,5}(?:v\d+)?$/.test(candidate) ? candidate : '';
}

function splitAuthors(value?: string): string[] {
  if (!value) return [];
  return uniqueStrings(value.split(/\s*;\s*|\s*,\s*/).map(cleanText).filter(Boolean));
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function truncateText(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) return maxChars <= 0 ? '' : value;
  return `${value.slice(0, maxChars)}...`;
}

function cleanText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
