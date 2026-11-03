/**
 * OpenAlex discovery and one-hop citation relations.
 *
 * OpenAlex is used as a fast, free enrichment source. It is not a substitute
 * for entitlement-backed WoS/Scopus records; its identifiers are retained so
 * callers can hydrate the same work from an authoritative source.
 */

import axios, { AxiosInstance } from 'axios';
import { Paper, PaperFactory } from '../models/Paper.js';
import { PaperSource, SearchOptions, DownloadOptions, PlatformCapabilities } from './PaperSource.js';
import { API_ENDPOINTS, TIMEOUTS, USER_AGENT } from '../config/constants.js';
import { ErrorHandler } from '../utils/ErrorHandler.js';
import { RateLimiter } from '../utils/RateLimiter.js';
import { RequestCache } from '../utils/RequestCache.js';
import { logDebug } from '../utils/Logger.js';

const OPENALEX_MAX_PER_PAGE = 100;
const OPENALEX_MAX_RESULTS = 300;

export class OpenAlexSearcher extends PaperSource {
  private readonly client: AxiosInstance;
  private readonly rateLimiter: RateLimiter;
  private readonly cache: RequestCache<Paper[]>;
  private readonly openAlexApiKey?: string;

  constructor(apiKey?: string, email?: string) {
    super('openalex', API_ENDPOINTS.OPENALEX, apiKey || process.env.OPENALEX_API_KEY);
    this.openAlexApiKey = firstConfigured(apiKey, process.env.OPENALEX_API_KEY);
    const contactEmail = firstConfigured(email, process.env.OPENALEX_EMAIL);

    this.client = axios.create({
      baseURL: API_ENDPOINTS.OPENALEX,
      timeout: TIMEOUTS.DEFAULT,
      headers: {
        Accept: 'application/json',
        'User-Agent': contactEmail
          ? `${USER_AGENT} (mailto:${contactEmail})`
          : USER_AGENT,
        ...(this.openAlexApiKey ? { Authorization: `Bearer ${this.openAlexApiKey}` } : {})
      }
    });

    this.rateLimiter = new RateLimiter({
      requestsPerSecond: this.openAlexApiKey ? 10 : 3,
      burstCapacity: this.openAlexApiKey ? 20 : 5
    });
    this.cache = new RequestCache<Paper[]>({ maxSize: 200, ttlMs: 6 * 60 * 60 * 1000 });
  }

  getCapabilities(): PlatformCapabilities {
    return {
      search: true,
      download: false,
      fullText: false,
      citations: true,
      requiresApiKey: false,
      supportedOptions: ['maxResults', 'year', 'author', 'openAccess', 'sortBy', 'sortOrder']
    };
  }

  async search(query: string, options: SearchOptions = {}): Promise<Paper[]> {
    const maxResults = Math.min(options.maxResults || 10, OPENALEX_MAX_RESULTS);
    const cacheKey = this.cache.generateKey('openalex', query, options);
    if (!(options as any).forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    const papers: Paper[] = [];
    let cursor: string | undefined = '*';
    const filters = buildFilters(options);
    const sort = buildSort(options);

    while (papers.length < maxResults) {
      const perPage = Math.min(OPENALEX_MAX_PER_PAGE, maxResults - papers.length);
      const response = await ErrorHandler.retryWithBackoff(
        async () => {
          await this.rateLimiter.waitForPermission();
          return this.client.get('/works', {
            params: {
              search: query,
              per_page: perPage,
              ...(filters ? { filter: filters } : {}),
              ...(sort ? { sort } : {}),
              ...(cursor ? { cursor } : {})
            }
          });
        },
        { context: 'OpenAlex search' }
      );

      const results = Array.isArray(response.data?.results) ? response.data.results : [];
      for (const item of results) {
        const paper = parseWork(item);
        if (paper) papers.push(paper);
        if (papers.length >= maxResults) break;
      }

      const nextCursor = response.data?.meta?.next_cursor;
      if (
        results.length === 0 ||
        papers.length >= maxResults ||
        typeof nextCursor !== 'string' ||
        !nextCursor ||
        nextCursor === cursor
      ) {
        break;
      }
      cursor = nextCursor;
    }

    const bounded = papers.slice(0, maxResults);
    this.cache.set(cacheKey, bounded);
    return bounded;
  }

  async getPaperByDoi(doi: string): Promise<Paper | null> {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;
    const response = await ErrorHandler.retryWithBackoff(
      async () => {
        await this.rateLimiter.waitForPermission();
        return this.client.get('/works', {
          params: { filter: `doi:${normalized}`, per_page: 1 }
        });
      },
      { context: 'OpenAlex DOI lookup' }
    );
    return parseWork(response.data?.results?.[0]);
  }

  async getPaperById(id: string): Promise<Paper | null> {
    const workId = normalizeWorkId(id);
    if (!workId) return null;
    const response = await ErrorHandler.retryWithBackoff(
      async () => {
        await this.rateLimiter.waitForPermission();
        return this.client.get(`/works/${encodeURIComponent(workId)}`);
      },
      { context: 'OpenAlex work lookup' }
    );
    return parseWork(response.data);
  }

  async getReferences(identifier: string, options: SearchOptions = {}): Promise<Paper[]> {
    const seed = await this.getWork(identifier);
    if (!seed) return [];
    const ids = asArray<string>(seed.referenced_works).slice(0, Math.min(options.maxResults || 50, 100));
    return this.getWorksByIds(ids);
  }

  async getCiting(identifier: string, options: SearchOptions = {}): Promise<Paper[]> {
    const seed = await this.getWork(identifier);
    if (!seed) return [];
    const seedId = normalizeWorkId(seed.id);
    if (!seedId) return [];
    const maxResults = Math.min(options.maxResults || 50, OPENALEX_MAX_PER_PAGE);
    const response = await ErrorHandler.retryWithBackoff(
      async () => {
        await this.rateLimiter.waitForPermission();
        return this.client.get('/works', {
          params: {
            filter: `cites:${seedId}`,
            per_page: maxResults,
            sort: 'publication_date:desc'
          }
        });
      },
      { context: 'OpenAlex citing lookup' }
    );
    return asArray<any>(response.data?.results)
      .map(parseWork)
      .filter((paper): paper is Paper => Boolean(paper))
      .slice(0, maxResults);
  }

  async getRelated(identifier: string, options: SearchOptions = {}): Promise<Paper[]> {
    const seed = await this.getWork(identifier);
    if (!seed) return [];
    const ids = asArray<string>(seed.related_works).slice(0, Math.min(options.maxResults || 50, 100));
    return this.getWorksByIds(ids);
  }

  async downloadPdf(_paperId: string, _options?: DownloadOptions): Promise<string> {
    throw new Error('OpenAlex does not host PDFs; use the returned open-access URL or a publisher route.');
  }

  async readPaper(_paperId: string, _options?: DownloadOptions): Promise<string> {
    throw new Error('OpenAlex does not provide full text through this searcher.');
  }

  getStatus() {
    return {
      configured: true,
      apiKeyConfigured: Boolean(this.openAlexApiKey),
      baseUrl: this.getBaseUrl(),
      rateLimiter: this.rateLimiter.getStatus(),
      cache: this.cache.getStats()
    };
  }

  private async getWork(identifier: string): Promise<any | null> {
    const workId = normalizeWorkId(identifier);
    if (workId) {
      return this.getRawWork(`/works/${encodeURIComponent(workId)}`);
    }
    const doi = normalizeDoi(identifier);
    if (!doi) return null;
    const response = await this.getRawWork('/works', { filter: `doi:${doi}`, per_page: 1 });
    return response?.results?.[0] || null;
  }

  private async getWorksByIds(ids: string[]): Promise<Paper[]> {
    const normalized = ids.map(normalizeWorkId).filter((id): id is string => Boolean(id));
    if (normalized.length === 0) return [];
    const response = await this.getRawWork('/works', {
      filter: `openalex_id:${normalized.join('|')}`,
      per_page: Math.min(normalized.length, OPENALEX_MAX_PER_PAGE)
    });
    return asArray<any>(response?.results)
      .map(parseWork)
      .filter((paper): paper is Paper => Boolean(paper));
  }

  private async getRawWork(path: string, params?: Record<string, string | number>): Promise<any | null> {
    try {
      const response = await ErrorHandler.retryWithBackoff(
        async () => {
          await this.rateLimiter.waitForPermission();
          return this.client.get(path, { params });
        },
        { context: 'OpenAlex relation lookup' }
      );
      return response.data;
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      logDebug('OpenAlex relation lookup failed:', error?.message || error);
      return null;
    }
  }
}

function parseWork(item: any): Paper | null {
  if (!item || typeof item !== 'object') return null;
  const title = cleanText(item.title || item.display_name || '');
  if (!title) return null;

  const openAlexId = normalizeWorkId(item.id);
  const doi = normalizeDoi(item.doi || '');
  const authors = asArray<any>(item.authorships)
    .map(authorship => cleanText(authorship?.author?.display_name || ''))
    .filter(Boolean);
  const concepts = asArray<any>(item.concepts || item.topics)
    .map(concept => cleanText(concept?.display_name || ''))
    .filter(Boolean)
    .slice(0, 8);
  const abstract = reconstructAbstract(item.abstract_inverted_index);
  const primary = item.primary_location || {};
  const bestOa = item.best_oa_location || {};
  const openAccess = item.open_access || {};
  const pdfUrl = cleanText(primary.pdf_url || bestOa.pdf_url || '');
  const url = cleanText(primary.landing_page_url || bestOa.landing_page_url || item.id || '');
  const publishedDate = parseDate(item.publication_date);

  return PaperFactory.create({
    paperId: openAlexId || doi || title,
    title,
    authors,
    abstract,
    doi,
    publishedDate,
    pdfUrl,
    url,
    source: 'openalex',
    categories: concepts,
    keywords: concepts,
    citationCount: numberValue(item.cited_by_count),
    references: asArray<string>(item.referenced_works)
      .map(normalizeWorkId)
      .filter((id): id is string => Boolean(id)),
    journal: cleanText(primary.source?.display_name || ''),
    year: publishedDate?.getUTCFullYear(),
    extra: {
      openalexId: openAlexId,
      isOa: Boolean(openAccess.is_oa),
      oaStatus: openAccess.oa_status || undefined,
      citedByCount: numberValue(item.cited_by_count),
      publicationType: item.type || undefined,
      relatedWorks: asArray<string>(item.related_works)
        .map(normalizeWorkId)
        .filter((id): id is string => Boolean(id))
    }
  });
}

function buildFilters(options: SearchOptions): string {
  const filters: string[] = [];
  if (options.year) {
    const match = options.year.match(/^(\d{4})(?:-(\d{4})?)?$/);
    if (match) {
      const start = match[1];
      const end = match[2] || (options.year.trim().endsWith('-') ? String(new Date().getUTCFullYear()) : start);
      filters.push(`from_publication_date:${start}-01-01`);
      filters.push(`to_publication_date:${end}-12-31`);
    }
  }
  if (options.openAccess) filters.push('is_oa:true');
  return filters.join(',');
}

function buildSort(options: SearchOptions): string {
  const direction = options.sortOrder === 'asc' ? 'asc' : 'desc';
  if (options.sortBy === 'date') return `publication_date:${direction}`;
  if (options.sortBy === 'citations') return `cited_by_count:${direction}`;
  return 'relevance_score:desc';
}

function reconstructAbstract(invertedIndex: unknown): string {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const positions: Array<{ position: number; word: string }> = [];
  for (const [word, values] of Object.entries(invertedIndex as Record<string, unknown>)) {
    for (const value of asArray<number>(values)) {
      if (Number.isFinite(value)) positions.push({ position: value, word });
    }
  }
  positions.sort((left, right) => left.position - right.position);
  return positions.map(entry => entry.word).join(' ');
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDoi(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/[.,;)\s]+$/, '');
}

function normalizeWorkId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:https?:\/\/openalex\.org\/)?(W\d+)$/i);
  return match ? match[1].toUpperCase() : '';
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value === undefined || value === null ? [] : [value as T];
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim() !== '')?.trim();
}

export default OpenAlexSearcher;
