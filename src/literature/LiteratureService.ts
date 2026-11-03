import type { Paper } from '../models/Paper.js';
import type { Searchers } from '../mcp/searchers.js';
import type { WosReference } from '../services/WebOfScienceParser.js';
import { sanitizeSensitiveText, withTimeout } from '../utils/SecurityUtils.js';
import { exportRecords } from './export.js';
import {
  applyReciprocalRankFusion,
  dedupeRecords,
  normalizeDoi,
  recordFromPaper,
  recordFromWosReference,
  recordsMatch,
  titleSimilarity,
  titleTokens,
  toPublicRecord
} from './normalize.js';
import { ResearchStore } from './ResearchStore.js';
import type {
  BriefInput,
  CitationDirection,
  ExpandInput,
  ExportInput,
  HydrateInput,
  LiteratureRecord,
  LiteratureSource,
  ResearchBrief,
  SearchInput,
  SearchMode,
  SearchSession,
  SourceRun
} from './types.js';

const MODE_CONFIG: Record<SearchMode, {
  sources: LiteratureSource[];
  perSource: number;
  maxResults: number;
  timeoutMs: number;
}> = {
  quick: {
    sources: ['webofscience', 'scopus', 'openalex'],
    perSource: 10,
    maxResults: 50,
    timeoutMs: 12000
  },
  balanced: {
    sources: ['webofscience', 'scopus', 'openalex', 'crossref'],
    perSource: 25,
    maxResults: 150,
    timeoutMs: 20000
  },
  deep: {
    sources: ['webofscience', 'scopus', 'openalex', 'crossref'],
    perSource: 50,
    maxResults: 300,
    timeoutMs: 35000
  }
};

const SOURCE_LABELS: Record<LiteratureSource, string> = {
  webofscience: 'Web of Science',
  scopus: 'Scopus',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  ieee: 'IEEE Xplore'
};

export class LiteratureService {
  readonly store: ResearchStore;

  constructor(
    private readonly getSearchers: () => Searchers,
    store?: ResearchStore
  ) {
    this.store = store || new ResearchStore();
  }

  async createBrief(input: BriefInput): Promise<ResearchBrief> {
    const warnings = this.configurationWarnings();
    const records = await this.resolveSeed(input.seed, warnings);
    if (records.length === 0) {
      throw new Error('Seed paper could not be resolved. Provide a DOI, WoS UID, Scopus EID, OpenAlex ID, or an exact title.');
    }

    const seed = records[0];
    const citationContext = input.includeCitationContext === false
      ? { references: [] as LiteratureRecord[], citing: [] as LiteratureRecord[] }
      : await this.getCitationContext(seed, warnings);

    const keywords = uniqueStrings([
      ...seed.keywords,
      ...seed.categories,
      ...citationContext.references.flatMap(record => record.keywords).slice(0, 10),
      ...citationContext.citing.flatMap(record => record.keywords).slice(0, 10)
    ]).slice(0, 30);
    const concepts = uniqueStrings([
      ...seed.categories,
      ...citationContext.references.flatMap(record => record.categories).slice(0, 10),
      ...citationContext.citing.flatMap(record => record.categories).slice(0, 10)
    ]).slice(0, 20);
    const frequentTerms = frequentTitleTerms([
      ...citationContext.references.map(record => record.title),
      ...citationContext.citing.map(record => record.title)
    ]);

    const brief = this.store.createBrief({
      intent: input.intent.trim(),
      focus: uniqueStrings(input.focus || []),
      scope: input.scope || {},
      seed,
      seedProfile: {
        keywords,
        concepts,
        frequentTerms,
        referenceCount: citationContext.references.length || seed.references.length,
        citingCount: citationContext.citing.length,
        topReferences: topRecords(citationContext.references, 10),
        topCiting: topRecords(citationContext.citing, 10)
      },
      warnings
    });

    return brief;
  }

  async search(input: SearchInput): Promise<{
    search: SearchSession;
    brief?: ResearchBrief;
    records: Record<string, unknown>[];
  }> {
    const mode = input.mode || 'balanced';
    const config = MODE_CONFIG[mode];
    const layer = input.layer || 'abstract';
    const brief = input.briefId ? this.store.getBrief(input.briefId) : undefined;
    if (input.briefId && !brief) {
      throw new Error(`Unknown or expired brief_id: ${input.briefId}`);
    }

    const requestedSources = input.sources?.length ? input.sources : config.sources;
    const sources = requestedSources.filter(source => this.isSourceConfigured(source));
    const warnings = this.configurationWarnings();
    for (const source of requestedSources) {
      if (!sources.includes(source)) {
        warnings.push(`${SOURCE_LABELS[source]} is not configured and was skipped.`);
      }
    }
    if (sources.length === 0) {
      throw new Error('No configured source is available for this search.');
    }

    const maxResults = Math.min(input.maxResults || config.maxResults, 300);
    const perSource = Math.max(1, Math.min(input.perSource || config.perSource, maxResults));
    const tasks = sources.map(source => this.searchSource(source, input, perSource, config.timeoutMs));
    const settled = await Promise.all(tasks);

    const normalized: LiteratureRecord[] = [];
    const sourceRuns: SourceRun[] = [];
    for (const result of settled) {
      sourceRuns.push(result.run);
      normalized.push(...result.records);
      if (result.run.error) warnings.push(`${SOURCE_LABELS[result.run.source]}: ${result.run.error}`);
    }

    const candidates = applyReciprocalRankFusion(dedupeRecords(normalized));
    const deduped = candidates.slice(0, maxResults);
    const search = this.store.createSearch({
      briefId: input.briefId,
      query: input.query,
      mode,
      layer,
      candidateCount: candidates.length,
      records: deduped,
      sourceRuns,
      warnings
    });

    return {
      search,
      brief,
      records: deduped.map(record => toPublicRecord(record, layer, input.abstractChars || 3000))
    };
  }

  async hydrate(input: HydrateInput): Promise<LiteratureRecord[]> {
    const records = await this.resolveStoredRecords(input);
    let selected = records.slice(0, 50);

    if (input.refresh) {
      const refreshed: LiteratureRecord[] = [];
      for (const record of selected) {
        refreshed.push(await this.refreshRecord(record));
      }
      selected = dedupeRecords(refreshed);
    }

    if (input.fetchReferences && input.includeReferences !== false) {
      const withReferences: LiteratureRecord[] = [];
      for (const record of selected) {
        withReferences.push(await this.refreshReferences(record));
      }
      selected = withReferences;
    }

    return selected.map(record => ({
      ...record,
      abstract: input.includeAbstract === false ? '' : record.abstract,
      references: input.includeReferences === false ? [] : record.references
    }));
  }

  async expand(input: ExpandInput): Promise<{
    search: SearchSession;
    nodes: Record<string, unknown>[];
    edges: Array<{ from: string; to: string; relation: CitationDirection; source: LiteratureSource }>;
  }> {
    const directions = input.directions?.length ? input.directions : ['references', 'citing'] as CitationDirection[];
    const limit = Math.max(1, Math.min(input.limitPerSeed || 50, 100));
    const seeds = await this.resolveSeeds(input.seeds, input.searchId);
    if (seeds.length === 0) throw new Error('No seed paper could be resolved.');

    const nodes: LiteratureRecord[] = [];
    const edges: Array<{ from: string; to: string; relation: CitationDirection; source: LiteratureSource }> = [];
    const sourceRuns: SourceRun[] = [];
    const warnings: string[] = [];

    for (const seed of seeds) {
      for (const direction of directions) {
        const startedAt = Date.now();
        try {
          const related = await this.getRelatedRecords(seed, direction, limit, input.recordView || 'full');
          sourceRuns.push({
            source: related.source,
            status: 'ok',
            returned: related.records.length,
            elapsedMs: Date.now() - startedAt,
            product: related.product
          });
          for (const record of related.records) {
            nodes.push(record);
            edges.push({
              from: seed.recordId,
              to: record.recordId,
              relation: direction,
              source: related.source
            });
          }
        } catch (error: any) {
          sourceRuns.push({
            source: this.primarySourceFor(seed),
            status: 'error',
            returned: 0,
            elapsedMs: Date.now() - startedAt,
            error: sanitizeSensitiveText(error?.message || 'Citation lookup failed')
          });
          warnings.push(`Citation lookup failed for ${seed.title}: ${sanitizeSensitiveText(error?.message || 'unknown error')}`);
        }
      }
    }

    const dedupedNodes = dedupeRecords(nodes);
    const nodeById = new Map(nodes.map(record => [record.recordId, record]));
    const canonicalId = (recordId: string): string => {
      const original = nodeById.get(recordId);
      if (!original) return recordId;
      const merged = dedupedNodes.find(candidate => recordsMatch(candidate, original));
      return merged?.recordId || recordId;
    };
    const edgeKeys = new Set<string>();
    const canonicalEdges = edges
      .map(edge => ({
        ...edge,
        to: canonicalId(edge.to)
      }))
      .filter(edge => {
        const key = `${edge.from}:${edge.to}:${edge.relation}:${edge.source}`;
        if (edgeKeys.has(key)) return false;
        edgeKeys.add(key);
        return true;
      });
    const search = this.store.createSearch({
      briefId: undefined,
      query: `citation-graph:${seeds.map(seed => seed.recordId).join(',')}`,
      mode: 'deep',
      layer: 'evidence',
      candidateCount: dedupedNodes.length,
      records: dedupedNodes,
      sourceRuns,
      warnings
    });

    return {
      search,
      nodes: dedupedNodes.map(record => toPublicRecord(record, 'evidence', 4000)),
      edges: canonicalEdges
    };
  }

  saveScreening(input: Parameters<ResearchStore['saveScreening']>[0]) {
    return this.store.saveScreening(input);
  }

  export(input: ExportInput): { format: string; count: number; content: string } {
    let records: LiteratureRecord[] = [];
    if (input.searchId) {
      const search = this.store.getSearch(input.searchId);
      if (!search) throw new Error(`Unknown or expired search_id: ${input.searchId}`);
      records = input.recordIds?.length
        ? search.records.filter(record => input.recordIds!.includes(record.recordId))
        : search.records;
    } else if (input.briefId) {
      const brief = this.store.getBrief(input.briefId);
      if (!brief) throw new Error(`Unknown or expired brief_id: ${input.briefId}`);
      records = [brief.seed];
    } else {
      throw new Error('Provide search_id, brief_id, or a search-scoped record_ids list.');
    }

    if (records.length === 0) throw new Error('No records matched the export selection.');
    const content = exportRecords(records, input.format, input.includeAbstract !== false);
    return { format: input.format, count: records.length, content };
  }

  async status(validate = false) {
    const searchers = this.getSearchers();
    const wos = await searchers.webofscience.getStatus(validate);
    const scopus = searchers.scopus.getStatus();
    return {
      sources: {
        webofscience: {
          configured: searchers.webofscience.hasApiKey(),
          default_product: searchers.webofscience.getDefaultProduct(),
          ...wos,
          starter: {
            ...wos.starter,
            rateLimiter: publicRateStatus(wos.starter.rateLimiter)
          },
          expanded: {
            ...wos.expanded,
            rateLimiter: publicRateStatus(wos.expanded.rateLimiter)
          }
        },
        scopus: {
          ...scopus,
          rateLimiter: publicRateStatus(scopus.rateLimiter)
        },
        openalex: {
          ...searchers.openalex.getStatus(),
          rateLimiter: publicRateStatus(searchers.openalex.getStatus().rateLimiter)
        },
        crossref: {
          ...searchers.crossref.getStatus(),
          rateLimiter: publicRateStatus(searchers.crossref.getStatus().rateLimiter)
        },
        ...(searchers.ieee
          ? {
              ieee: {
                ...searchers.ieee.getStatus(),
                rateLimiter: publicRateStatus(searchers.ieee.getStatus().rateLimiter)
              }
            }
          : {})
      },
      mode_defaults: MODE_CONFIG,
      session_store: this.store.stats()
    };
  }

  private async searchSource(
    source: LiteratureSource,
    input: SearchInput,
    perSource: number,
    timeoutMs: number
  ): Promise<{ records: LiteratureRecord[]; run: SourceRun }> {
    const searchers = this.getSearchers();
    const startedAt = Date.now();
    try {
      if (source === 'webofscience') {
        const product = searchers.webofscience.getDefaultProduct();
        const papers = await withTimeout(
          searchers.webofscience.search(input.query, {
            maxResults: perSource,
            apiProduct: 'auto',
            ...(product === 'expanded' ? { recordView: 'full' as const } : {}),
            year: input.year,
            author: input.author,
            journal: input.journal,
            sortBy: input.sortBy,
            sortOrder: input.sortOrder
          }),
          timeoutMs,
          'Web of Science search timed out'
        );
        return {
          records: papers.map((paper, index) => recordFromPaper(paper, source, index + 1)),
          run: {
            source,
            status: 'ok',
            returned: papers.length,
            elapsedMs: Date.now() - startedAt,
            product
          }
        };
      }

      if (source === 'scopus') {
        const papers = await withTimeout(
          searchers.scopus.search(input.query, {
            maxResults: perSource,
            year: input.year,
            author: input.author,
            journal: input.journal,
            openAccess: input.openAccess,
            sortBy: input.sortBy,
            sortOrder: input.sortOrder
          } as any),
          timeoutMs,
          'Scopus search timed out'
        );
        return {
          records: papers.map((paper, index) => recordFromPaper(paper, source, index + 1)),
          run: {
            source,
            status: 'ok',
            returned: papers.length,
            elapsedMs: Date.now() - startedAt,
            view: 'COMPLETE'
          }
        };
      }

      if (source === 'openalex') {
        const papers = await withTimeout(
          searchers.openalex.search(input.query, {
            maxResults: perSource,
            year: input.year,
            openAccess: input.openAccess,
            sortBy: input.sortBy,
            sortOrder: input.sortOrder
          }),
          timeoutMs,
          'OpenAlex search timed out'
        );
        return {
          records: papers.map((paper, index) => recordFromPaper(paper, source, index + 1)),
          run: {
            source,
            status: 'ok',
            returned: papers.length,
            elapsedMs: Date.now() - startedAt
          }
        };
      }

      if (source === 'ieee') {
        const papers = await withTimeout(
          searchers.ieee.search(input.query, {
            maxResults: perSource,
            year: input.year,
            author: input.author,
            journal: input.journal,
            openAccess: input.openAccess
          }),
          timeoutMs,
          'IEEE Xplore search timed out'
        );
        return {
          records: papers.map((paper, index) => recordFromPaper(paper, source, index + 1)),
          run: {
            source,
            status: 'ok',
            returned: papers.length,
            elapsedMs: Date.now() - startedAt
          }
        };
      }

      const papers = await withTimeout(
        searchers.crossref.search(input.query, {
          maxResults: perSource,
          year: input.year,
          author: input.author,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder
        }),
        timeoutMs,
        'Crossref search timed out'
      );
      return {
        records: papers.map((paper, index) => recordFromPaper(paper, source, index + 1)),
        run: {
          source,
          status: 'ok',
          returned: papers.length,
          elapsedMs: Date.now() - startedAt
        }
      };
    } catch (error: any) {
      return {
        records: [],
        run: {
          source,
          status: 'error',
          returned: 0,
          elapsedMs: Date.now() - startedAt,
          error: sanitizeSensitiveText(error?.message || 'Search failed')
        }
      };
    }
  }

  private async resolveSeed(seed: BriefInput['seed'], warnings: string[]): Promise<LiteratureRecord[]> {
    const records: LiteratureRecord[] = [];
    const searchers = this.getSearchers();

    if (seed.wosUid) {
      try {
        const paper = await searchers.webofscience.getRecordByUid(seed.wosUid, 'full');
        if (paper) records.push(recordFromPaper(paper, 'webofscience', 1));
      } catch (error: any) {
        warnings.push(`WoS UID lookup failed: ${sanitizeSensitiveText(error?.message || 'unknown error')}`);
      }
    }

    if (seed.scopusEid) {
      try {
        const paper = await searchers.scopus.getAbstract(seed.scopusEid);
        if (paper) records.push(recordFromPaper(paper, 'scopus', 1));
      } catch (error: any) {
        warnings.push(`Scopus EID lookup failed: ${sanitizeSensitiveText(error?.message || 'unknown error')}`);
      }
    }

    if (seed.openalexId) {
      try {
        const paper = await searchers.openalex.getPaperById(seed.openalexId);
        if (paper) records.push(recordFromPaper(paper, 'openalex', 1));
      } catch (error: any) {
        warnings.push(`OpenAlex ID lookup failed: ${sanitizeSensitiveText(error?.message || 'unknown error')}`);
      }
    }

    const doi = normalizeDoi(seed.doi || records.find(record => record.doi)?.doi);
    if (doi) {
      const existingSources = new Set(records.flatMap(record => record.sources.map(source => source.source)));
      records.push(...await this.resolveByDoi(doi, warnings, existingSources));
    }

    if (seed.title && records.length === 0) {
      records.push(...await this.resolveByTitle(seed.title, warnings));
    }

    const deduped = dedupeRecords(records);
    if (deduped.length === 0 && seed.title) {
      throw new Error(`No paper matched seed title: ${seed.title}`);
    }
    return deduped;
  }

  private async resolveByDoi(
    doi: string,
    warnings: string[],
    skipSources: Set<LiteratureSource> = new Set()
  ): Promise<LiteratureRecord[]> {
    const searchers = this.getSearchers();
    const tasks: Array<{ source: LiteratureSource; promise: Promise<LiteratureRecord | null> }> = [];
    if (searchers.webofscience.hasApiKey() && !skipSources.has('webofscience')) {
      tasks.push({
        source: 'webofscience',
        promise: searchers.webofscience.getPaperByDoi(doi)
          .then(paper => paper ? recordFromPaper(paper, 'webofscience', 1) : null)
      });
    }
    if (searchers.scopus.hasApiKey() && !skipSources.has('scopus')) {
      tasks.push({
        source: 'scopus',
        promise: searchers.scopus.getPaperByDoi(doi)
          .then(paper => paper ? recordFromPaper(paper, 'scopus', 1) : null)
      });
    }
    if (/^10\.1109\//i.test(doi) && searchers.ieee?.hasApiKey() && !skipSources.has('ieee')) {
      tasks.push({
        source: 'ieee',
        promise: searchers.ieee.getPaperByDoi(doi)
          .then(paper => paper ? recordFromPaper(paper, 'ieee', 1) : null)
      });
    }
    if (!skipSources.has('openalex')) {
      tasks.push({
        source: 'openalex',
        promise: searchers.openalex.getPaperByDoi(doi)
          .then(paper => paper ? recordFromPaper(paper, 'openalex', 1) : null)
      });
    }
    tasks.push({
      source: 'crossref',
      promise: searchers.crossref.getPaperByDoi(doi)
        .then(paper => paper ? recordFromPaper(paper, 'crossref', 1) : null)
    });
    const settled = await Promise.allSettled(tasks.map(task => task.promise));
    const records: LiteratureRecord[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        records.push(result.value);
      } else if (result.status === 'rejected') {
        const source = tasks[index].source;
        warnings.push(`${source} DOI lookup failed: ${sanitizeSensitiveText(result.reason?.message || 'unknown error')}`);
      }
    });
    return records;
  }

  private async resolveByTitle(title: string, warnings: string[]): Promise<LiteratureRecord[]> {
    const searchers = this.getSearchers();
    const sources: Array<[LiteratureSource, () => Promise<Paper[]>]> = [];
    if (searchers.webofscience.hasApiKey()) {
      sources.push(['webofscience', () => searchers.webofscience.search(title, {
        maxResults: 5,
        apiProduct: 'auto',
        ...(searchers.webofscience.getDefaultProduct() === 'expanded' ? { recordView: 'full' as const } : {})
      })]);
    }
    if (searchers.scopus.hasApiKey()) {
      sources.push(['scopus', () => searchers.scopus.search(title, { maxResults: 5 })]);
    }
    if (searchers.ieee?.hasApiKey()) {
      sources.push(['ieee', () => searchers.ieee.search(title, { maxResults: 5 })]);
    }
    sources.push(
      ['openalex', () => searchers.openalex.search(title, { maxResults: 5 })],
      ['crossref', () => searchers.crossref.search(title, { maxResults: 5 })]
    );
    const settled = await Promise.allSettled(sources.map(async ([source, run]) => ({
      source,
      papers: await run()
    })));
    const matches: LiteratureRecord[] = [];
    for (const result of settled) {
      if (result.status === 'rejected') {
        warnings.push(`Seed title search failed: ${sanitizeSensitiveText(result.reason?.message || 'unknown error')}`);
        continue;
      }
      const { source, papers } = result.value;
      for (const [index, paper] of papers.entries()) {
        if (titleSimilarity(title, paper.title) >= 0.92) {
          matches.push(recordFromPaper(paper, source, index + 1));
        }
      }
    }
    const deduped = dedupeRecords(matches);
    if (deduped.length > 1) {
      const distinctDois = new Set(deduped.map(record => record.doi).filter(Boolean));
      if (distinctDois.size > 1) {
        const candidates = deduped.slice(0, 5).map(record =>
          `${record.title} (${record.year || 'n.d.'}, DOI: ${record.doi || 'none'})`
        );
        throw new Error(`Seed title is ambiguous; provide a DOI. Candidates: ${candidates.join(' | ')}`);
      }
    }
    return deduped;
  }

  private async getCitationContext(
    seed: LiteratureRecord,
    warnings: string[]
  ): Promise<{ references: LiteratureRecord[]; citing: LiteratureRecord[] }> {
    const searchers = this.getSearchers();
    if (seed.identifiers.wosUid && searchers.webofscience.getDefaultProduct() === 'expanded') {
      const [references, citing] = await Promise.allSettled([
        searchers.webofscience.getRelatedRecords(seed.identifiers.wosUid, 'references', { maxResults: 50 }),
        searchers.webofscience.getRelatedRecords(seed.identifiers.wosUid, 'citing', { maxResults: 50, recordView: 'short' })
      ]);
      return {
        references: references.status === 'fulfilled'
          ? (references.value.items as WosReference[]).map(recordFromWosReference)
          : [],
        citing: citing.status === 'fulfilled'
          ? (citing.value.items as Paper[]).map((paper, index) => recordFromPaper(paper, 'webofscience', index + 1))
          : []
      };
    }

    if (seed.doi) {
      const [references, citing] = await Promise.allSettled([
        searchers.openalex.getReferences(seed.doi, { maxResults: 50 }),
        searchers.openalex.getCiting(seed.doi, { maxResults: 50 })
      ]);
      if (references.status === 'rejected' && citing.status === 'rejected') {
        warnings.push('Citation context was unavailable from both WoS and OpenAlex.');
      }
      return {
        references: references.status === 'fulfilled'
          ? references.value.map((paper, index) => recordFromPaper(paper, 'openalex', index + 1))
          : [],
        citing: citing.status === 'fulfilled'
          ? citing.value.map((paper, index) => recordFromPaper(paper, 'openalex', index + 1))
          : []
      };
    }
    return { references: [], citing: [] };
  }

  private async resolveStoredRecords(input: HydrateInput): Promise<LiteratureRecord[]> {
    const search = input.searchId ? this.store.getSearch(input.searchId) : undefined;
    if (input.searchId && !search) throw new Error(`Unknown or expired search_id: ${input.searchId}`);
    if (!search && !input.recordIds?.length && !input.dois?.length) {
      throw new Error('Provide search_id, record_ids, or dois.');
    }
    const byId = new Map<string, LiteratureRecord>();
    for (const record of search?.records || []) byId.set(record.recordId, record);
    const selected: LiteratureRecord[] = [];
    if (input.recordIds?.length) {
      for (const recordId of input.recordIds) {
        const record = byId.get(recordId) || this.store.findRecord(recordId);
        if (!record) throw new Error(`Unknown record_id: ${recordId}`);
        selected.push(record);
      }
    } else if (search) {
      selected.push(...search.records);
    }
    const resolved: LiteratureRecord[] = [...selected];
    for (const doi of input.dois || []) {
      resolved.push(...await this.resolveByDoi(normalizeDoi(doi), []));
    }
    return dedupeRecords(resolved);
  }

  private async refreshRecord(record: LiteratureRecord): Promise<LiteratureRecord> {
    const searchers = this.getSearchers();
    const refreshed: LiteratureRecord[] = [record];
    if (record.identifiers.wosUid) {
      const paper = await searchers.webofscience.getRecordByUid(record.identifiers.wosUid, 'full').catch(() => null);
      if (paper) refreshed.push(recordFromPaper(paper, 'webofscience', 1));
    } else if (record.doi) {
      const paper = await searchers.webofscience.getPaperByDoi(record.doi).catch(() => null);
      if (paper) refreshed.push(recordFromPaper(paper, 'webofscience', 1));
    }
    if (record.identifiers.scopusEid) {
      const paper = await searchers.scopus.getAbstract(record.identifiers.scopusEid).catch(() => null);
      if (paper) refreshed.push(recordFromPaper(paper, 'scopus', 1));
    }
    if (record.doi) {
      const paper = await searchers.openalex.getPaperByDoi(record.doi).catch(() => null);
      if (paper) refreshed.push(recordFromPaper(paper, 'openalex', 1));
    }
    return dedupeRecords(refreshed)[0];
  }

  private async refreshReferences(record: LiteratureRecord): Promise<LiteratureRecord> {
    if (record.references.length > 0) return record;
    try {
      const related = await this.getRelatedRecords(record, 'references', 50, 'short');
      const references = related.records
        .map(reference => reference.doi || reference.identifiers.wosUid || reference.identifiers.openalexId || reference.recordId)
        .filter((reference): reference is string => Boolean(reference));
      return { ...record, references: uniqueStrings(references) };
    } catch {
      return record;
    }
  }

  private async resolveSeeds(seeds: string[], searchId?: string): Promise<LiteratureRecord[]> {
    const search = searchId ? this.store.getSearch(searchId) : undefined;
    const fromSearch = new Map(search?.records.map(record => [record.recordId, record]) || []);
    const resolved: LiteratureRecord[] = [];
    for (const seed of seeds) {
      const stored = fromSearch.get(seed) || this.store.findRecord(seed);
      if (stored) {
        resolved.push(stored);
        continue;
      }
      if (/^WOS:/i.test(seed)) {
        const paper = await this.getSearchers().webofscience.getRecordByUid(seed, 'short');
        if (paper) resolved.push(recordFromPaper(paper, 'webofscience', 1));
        continue;
      }
      if (/^W\d+$/i.test(seed)) {
        const paper = await this.getSearchers().openalex.getPaperById(seed);
        if (paper) resolved.push(recordFromPaper(paper, 'openalex', 1));
        continue;
      }
      if (/^10\.\d{4,}\//.test(seed)) {
        resolved.push(...await this.resolveByDoi(normalizeDoi(seed), []));
        continue;
      }
      throw new Error(`Unsupported seed identifier: ${seed}`);
    }
    return dedupeRecords(resolved);
  }

  private async getRelatedRecords(
    seed: LiteratureRecord,
    direction: CitationDirection,
    limit: number,
    recordView: 'short' | 'full'
  ): Promise<{ records: LiteratureRecord[]; source: LiteratureSource; product?: string }> {
    const searchers = this.getSearchers();
    const attempts: Array<() => Promise<{ records: LiteratureRecord[]; source: LiteratureSource; product?: string }>> = [];

    if (seed.identifiers.wosUid && searchers.webofscience.getDefaultProduct() === 'expanded') {
      attempts.push(async () => {
        const result = await searchers.webofscience.getRelatedRecords(
          seed.identifiers.wosUid!,
          direction,
          direction === 'references'
            ? { maxResults: limit }
            : { maxResults: limit, recordView }
        );
        return {
          source: 'webofscience',
          product: 'expanded',
          records: direction === 'references'
            ? (result.items as WosReference[]).map(recordFromWosReference)
            : (result.items as Paper[]).map((paper, index) => recordFromPaper(paper, 'webofscience', index + 1))
        };
      });
    }

    if (seed.doi || seed.identifiers.openalexId) {
      attempts.push(async () => {
        const identifier = seed.doi || seed.identifiers.openalexId!;
        const papers = direction === 'references'
          ? await searchers.openalex.getReferences(identifier, { maxResults: limit })
          : direction === 'citing'
            ? await searchers.openalex.getCiting(identifier, { maxResults: limit })
            : await searchers.openalex.getRelated(identifier, { maxResults: limit });
        return {
          source: 'openalex',
          records: papers.map((paper, index) => recordFromPaper(paper, 'openalex', index + 1))
        };
      });
    }

    if (seed.doi && direction !== 'related') {
      attempts.push(async () => {
        const papers = direction === 'references'
          ? await searchers.crossref.getReferences(seed.doi)
          : await searchers.crossref.getCitations(seed.doi);
        return {
          source: 'crossref',
          records: papers.slice(0, limit).map((paper, index) => recordFromPaper(paper, 'crossref', index + 1))
        };
      });
    }

    if (attempts.length === 0) {
      throw new Error(`No citation provider is available for seed ${seed.recordId}`);
    }

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        const result = await attempt();
        if (result.records.length > 0) return result;
        lastError = new Error(`No ${direction} records returned`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`No citation provider returned ${direction} records`);
  }

  private isSourceConfigured(source: LiteratureSource): boolean {
    const searchers = this.getSearchers();
    if (source === 'webofscience') return searchers.webofscience.hasApiKey();
    if (source === 'scopus') return searchers.scopus.hasApiKey();
    if (source === 'ieee') return Boolean(searchers.ieee?.hasApiKey());
    return true;
  }

  private configurationWarnings(): string[] {
    const searchers = this.getSearchers();
    const warnings: string[] = [];
    if (!searchers.webofscience.hasApiKey()) {
      warnings.push('Web of Science is not configured; WoS coverage and citation graph are unavailable.');
    } else if (searchers.webofscience.getDefaultProduct() === 'starter') {
      warnings.push('Web of Science is using Starter: search metadata is available, but abstracts and citation relations require the Expanded product. Consider applying for institutional WoS access.');
    }
    if (!searchers.scopus.hasApiKey()) {
      warnings.push('Scopus is not configured; its abstract and citation coverage is unavailable.');
    }
    return warnings;
  }

  private primarySourceFor(seed: LiteratureRecord): LiteratureSource {
    if (seed.identifiers.wosUid) return 'webofscience';
    if (seed.doi) return 'openalex';
    return 'crossref';
  }
}

function topRecords(records: LiteratureRecord[], limit: number): LiteratureRecord[] {
  return [...records]
    .sort((left, right) => maxCitation(right) - maxCitation(left))
    .slice(0, limit);
}

function maxCitation(record: LiteratureRecord): number {
  return Math.max(0, ...Object.values(record.citedBy));
}

function frequentTitleTerms(titles: string[]): Array<{ term: string; count: number }> {
  const counts = new Map<string, number>();
  for (const title of titles) {
    for (const token of titleTokens(title)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([term, count]) => ({ term, count }));
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

function publicRateStatus(status: {
  availableTokens: number;
  maxTokens: number;
  requestsPerSecond: number;
  pendingRequests: number;
}) {
  return {
    available: status.availableTokens,
    capacity: status.maxTokens,
    requestsPerSecond: status.requestsPerSecond,
    pendingRequests: status.pendingRequests
  };
}

export default LiteratureService;
