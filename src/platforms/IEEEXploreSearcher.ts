/**
 * IEEE Xplore Metadata API searcher.
 *
 * Official documentation:
 * https://developer.ieee.org/docs/read/Searching_the_IEEE_Xplore_Metadata_API
 *
 * The API key is passed as the `apikey` query parameter on every request.
 * A single request returns at most 200 records.
 */

import axios, { AxiosInstance } from 'axios';
import { Paper, PaperFactory } from '../models/Paper.js';
import { PaperSource, SearchOptions, DownloadOptions, PlatformCapabilities } from './PaperSource.js';
import { API_ENDPOINTS, TIMEOUTS, USER_AGENT } from '../config/constants.js';
import { ErrorHandler } from '../utils/ErrorHandler.js';
import { RateLimiter } from '../utils/RateLimiter.js';
import { logDebug } from '../utils/Logger.js';

const IEEE_MAX_RECORDS = 200;

export type IeeeContentType =
  | 'Books'
  | 'Conferences'
  | 'Courses'
  | 'Early Access'
  | 'Journals'
  | 'Magazines'
  | 'Standards';

export interface IeeeSearchOptions extends SearchOptions {
  contentType?: IeeeContentType;
}

interface IeeeAuthor {
  full_name?: string;
  author_order?: number | string;
  affiliation?: string;
  author_url?: string;
}

interface IeeeArticle {
  abstract?: string;
  abstract_url?: string;
  access_type?: string;
  accessType?: string;
  article_number?: string | number;
  author_terms?: string[];
  authors?: { authors?: IeeeAuthor[] } | IeeeAuthor[];
  citing_paper_count?: number | string;
  citing_patent_count?: number | string;
  content_type?: string;
  doi?: string;
  end_page?: string;
  html_url?: string;
  ieee_terms?: string[];
  isbn?: string;
  issn?: string;
  is_open_access?: boolean;
  isOpenAccess?: boolean;
  issue?: string;
  pdf_url?: string;
  publication_date?: string;
  publication_number?: string;
  publication_title?: string;
  publication_year?: number | string;
  publisher?: string;
  standard_number?: string;
  start_page?: string;
  title?: string;
  volume?: string;
}

interface IeeeSearchResponse {
  total_records?: number | string;
  total_searched?: number | string;
  totalfound?: number | string;
  totalsearched?: number | string;
  articles?: IeeeArticle[];
}

export class IEEEXploreSearcher extends PaperSource {
  private readonly client: AxiosInstance;
  private readonly rateLimiter: RateLimiter;

  constructor(apiKey?: string) {
    const configuredKey = firstConfiguredKey(
      apiKey,
      process.env.IEEE_XPLORE_API_KEY,
      process.env.IEEE_API_KEY
    );
    super('ieee', API_ENDPOINTS.IEEE_XPLORE, configuredKey);

    this.client = axios.create({
      baseURL: API_ENDPOINTS.IEEE_XPLORE,
      timeout: TIMEOUTS.DEFAULT,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT
      }
    });

    const requestsPerSecond = positiveNumber(process.env.IEEE_XPLORE_RPS, 1);
    this.rateLimiter = new RateLimiter({
      requestsPerSecond,
      burstCapacity: Math.max(1, Math.ceil(requestsPerSecond))
    });
  }

  async search(query: string, options: IeeeSearchOptions = {}): Promise<Paper[]> {
    if (!this.apiKey) {
      throw new Error('IEEE Xplore API key is required. Set IEEE_XPLORE_API_KEY.');
    }
    const maxResults = Math.max(1, Math.min(options.maxResults || 25, IEEE_MAX_RECORDS));
    const params: Record<string, string | number | boolean> = {
      querytext: query,
      max_records: maxResults,
      start_record: 1,
      format: 'json'
    };

    if (options.author) params.author = options.author;
    if (options.journal) params.publication_title = options.journal;
    if (options.openAccess !== undefined) params.open_access = options.openAccess;
    if (options.contentType) params.content_type = options.contentType;
    applyYearFilter(params, options.year);

    try {
      const response = await this.request(params);
      return this.parseArticles(response.data).slice(0, maxResults);
    } catch (error: any) {
      throwIeeeError(error, 'search');
    }
  }

  async getPaperByDoi(doi: string): Promise<Paper | null> {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;
    if (!this.apiKey) {
      throw new Error('IEEE Xplore API key is required. Set IEEE_XPLORE_API_KEY.');
    }

    try {
      const response = await this.request({
        doi: normalized,
        max_records: 1,
        start_record: 1,
        format: 'json'
      });
      return this.parseArticles(response.data)[0] || null;
    } catch (error: any) {
      throwIeeeError(error, 'DOI lookup');
    }
  }

  getCapabilities(): PlatformCapabilities {
    return {
      search: true,
      download: false,
      fullText: false,
      citations: true,
      requiresApiKey: true,
      supportedOptions: ['maxResults', 'year', 'author', 'journal', 'openAccess', 'contentType']
    };
  }

  getStatus() {
    return {
      configured: Boolean(this.apiKey),
      baseUrl: this.getBaseUrl(),
      rateLimiter: this.rateLimiter.getStatus()
    };
  }

  async downloadPdf(_paperId: string, _options: DownloadOptions = {}): Promise<string> {
    throw new Error('IEEE Xplore metadata access does not include PDF download.');
  }

  async readPaper(_paperId: string, _options: DownloadOptions = {}): Promise<string> {
    throw new Error('IEEE Xplore metadata access does not include full text.');
  }

  private async request(params: Record<string, string | number | boolean>) {
    return ErrorHandler.retryWithBackoff(
      async () => {
        await this.rateLimiter.waitForPermission();
        return this.client.get<IeeeSearchResponse>('/search/articles', {
          params: {
            ...params,
            apikey: this.apiKey
          }
        });
      },
      { context: 'IEEE Xplore request' }
    );
  }

  private parseArticles(data: IeeeSearchResponse | undefined): Paper[] {
    const articles = Array.isArray(data?.articles) ? data.articles : [];
    const papers: Paper[] = [];
    for (const article of articles) {
      const paper = this.parseArticle(article);
      if (paper) papers.push(paper);
    }
    return papers;
  }

  private parseArticle(article: IeeeArticle): Paper | null {
    try {
      const articleNumber = String(article.article_number || '').trim();
      const title = this.cleanText(article.title || '');
      if (!title) return null;

      const authors = normalizeAuthors(article.authors);
      const year = toInteger(article.publication_year);
      const pages = buildPages(article.start_page, article.end_page);
      const url = article.html_url
        || article.abstract_url
        || (articleNumber ? `https://ieeexplore.ieee.org/document/${articleNumber}` : '');
      const accessType = article.access_type || article.accessType;
      const isOpenAccess = article.is_open_access ?? article.isOpenAccess ?? false;

      return PaperFactory.create({
        paperId: articleNumber || normalizeDoi(article.doi) || title,
        title,
        authors,
        abstract: this.cleanText(article.abstract || ''),
        doi: normalizeDoi(article.doi),
        publishedDate: parseIeeeDate(article.publication_date, year),
        pdfUrl: article.pdf_url || '',
        url,
        source: 'ieee',
        journal: this.cleanText(article.publication_title || ''),
        volume: this.cleanText(article.volume || ''),
        issue: this.cleanText(article.issue || ''),
        pages,
        year,
        citationCount: toInteger(article.citing_paper_count),
        keywords: uniqueStrings([
          ...(article.author_terms || []),
          ...(article.ieee_terms || [])
        ]),
        categories: article.content_type ? [article.content_type] : [],
        extra: {
          ieeeArticleNumber: articleNumber,
          ieeeContentType: article.content_type,
          accessType,
          isOa: isOpenAccess === true || accessType === 'Open Access',
          citingPatentCount: toInteger(article.citing_patent_count),
          publicationNumber: article.publication_number,
          publisher: article.publisher,
          issn: article.issn,
          isbn: article.isbn,
          standardNumber: article.standard_number
        }
      });
    } catch (error) {
      logDebug('Error parsing IEEE Xplore article:', error);
      return null;
    }
  }
}

function firstConfiguredKey(...values: Array<string | undefined>): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDoi(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/[.,;)\s]+$/, '');
}

function normalizeAuthors(value: IeeeArticle['authors']): string[] {
  const authors = Array.isArray(value) ? value : value?.authors;
  if (!Array.isArray(authors)) return [];
  return ([...authors] as IeeeAuthor[])
    .sort((left, right) => (toInteger(left?.author_order) ?? 0) - (toInteger(right?.author_order) ?? 0))
    .map(author => String(author.full_name || '').trim())
    .filter(Boolean);
}

function buildPages(start?: string, end?: string): string | undefined {
  const first = String(start || '').trim();
  const last = String(end || '').trim();
  if (first && last && first !== last) return `${first}-${last}`;
  return first || last || undefined;
}

function parseIeeeDate(value: string | undefined, year: number | undefined): Date | null {
  const text = String(value || '').trim();
  if (text) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    const yearOnly = text.match(/^(\d{4})$/);
    if (yearOnly) return new Date(Number(yearOnly[1]), 0, 1);
  }
  return year ? new Date(year, 0, 1) : null;
}

function applyYearFilter(params: Record<string, string | number | boolean>, year?: string): void {
  if (!year) return;
  const normalized = year.trim();
  const single = normalized.match(/^(\d{4})$/);
  if (single) {
    params.publication_year = Number(single[1]);
    return;
  }
  const range = normalized.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (range) {
    params.start_year = Number(range[1]);
    params.end_year = Number(range[2]);
  }
}

function toInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function throwIeeeError(error: any, operation: string): never {
  const status = error?.response?.status;
  const header = String(error?.response?.headers?.['x-mashery-error-code'] || '');
  const detail = String(error?.response?.headers?.['x-error-detail-header'] || '');
  const body = JSON.stringify(error?.response?.data || '');

  if (
    header === 'ERR_403_DEVELOPER_INACTIVE'
    || /developer inactive|account inactive/i.test(`${detail} ${body}`)
  ) {
    throw new Error(
      'IEEE Xplore API key is inactive. Your application may still be under review; '
      + 'IEEE issues keys during 8am-5pm US Eastern time on weekdays.'
    );
  }
  if (status === 401) {
    throw new Error('IEEE Xplore API key is invalid or missing.');
  }
  if (status === 403) {
    throw new Error('IEEE Xplore rejected the request. Check API entitlements and rate limits.');
  }
  if (status === 429) {
    throw new Error('IEEE Xplore rate limit exceeded. Wait before retrying.');
  }
  if (status) {
    throw new Error(`IEEE Xplore ${operation} failed with HTTP ${status}.`);
  }
  throw error instanceof Error ? error : new Error(`IEEE Xplore ${operation} failed.`);
}

export default IEEEXploreSearcher;
