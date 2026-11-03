import { randomUUID } from 'node:crypto';
import type {
  LiteratureRecord,
  ResearchBrief,
  ScreeningDecision,
  ScreeningInput,
  SearchSession
} from './types.js';

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_MAX_BRIEFS = 30;
const DEFAULT_MAX_SEARCHES = 50;

export class ResearchStore {
  private readonly briefs = new Map<string, { value: ResearchBrief; expiresAt: number }>();
  private readonly searches = new Map<string, { value: SearchSession; expiresAt: number }>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxBriefs = DEFAULT_MAX_BRIEFS,
    private readonly maxSearches = DEFAULT_MAX_SEARCHES
  ) {}

  createBrief(value: Omit<ResearchBrief, 'briefId' | 'createdAt'>): ResearchBrief {
    this.prune();
    const brief: ResearchBrief = {
      ...value,
      briefId: `brf_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      createdAt: new Date().toISOString()
    };
    this.briefs.set(brief.briefId, { value: brief, expiresAt: Date.now() + this.ttlMs });
    this.enforceLimit(this.briefs, this.maxBriefs);
    return brief;
  }

  getBrief(briefId: string): ResearchBrief | undefined {
    this.prune();
    return this.briefs.get(briefId)?.value;
  }

  createSearch(value: Omit<SearchSession, 'searchId' | 'createdAt' | 'screening'>): SearchSession {
    this.prune();
    const search: SearchSession = {
      ...value,
      searchId: `srch_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      screening: {}
    };
    this.searches.set(search.searchId, { value: search, expiresAt: Date.now() + this.ttlMs });
    this.enforceLimit(this.searches, this.maxSearches);
    return search;
  }

  getSearch(searchId: string): SearchSession | undefined {
    this.prune();
    return this.searches.get(searchId)?.value;
  }

  findRecord(recordId: string): LiteratureRecord | undefined {
    this.prune();
    for (const entry of this.searches.values()) {
      const record = entry.value.records.find(item => item.recordId === recordId);
      if (record) return record;
    }
    for (const entry of this.briefs.values()) {
      if (entry.value.seed.recordId === recordId) return entry.value.seed;
    }
    return undefined;
  }

  saveScreening(input: ScreeningInput): {
    search: SearchSession;
    counts: Record<string, number>;
  } {
    const search = this.getSearch(input.searchId);
    if (!search) throw new Error(`Unknown or expired search_id: ${input.searchId}`);

    const knownIds = new Set(search.records.map(record => record.recordId));
    for (const decision of input.decisions) {
      if (!knownIds.has(decision.recordId)) {
        throw new Error(`record_id ${decision.recordId} is not in search ${input.searchId}`);
      }
      const stored: ScreeningDecision = {
        recordId: decision.recordId,
        verdict: decision.verdict,
        reason: decision.reason.trim(),
        tags: decision.tags,
        confidence: decision.confidence,
        decidedAt: new Date().toISOString()
      };
      search.screening[decision.recordId] = stored;
    }
    if (input.notes) search.notes = input.notes;

    const counts = { include: 0, exclude: 0, maybe: 0 };
    for (const decision of Object.values(search.screening)) {
      counts[decision.verdict]++;
    }
    return { search, counts };
  }

  stats() {
    this.prune();
    return {
      briefs: this.briefs.size,
      searches: this.searches.size,
      maxBriefs: this.maxBriefs,
      maxSearches: this.maxSearches,
      ttlMinutes: Math.round(this.ttlMs / 60000),
      storage: 'memory-only'
    };
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.briefs) {
      if (entry.expiresAt <= now) this.briefs.delete(key);
    }
    for (const [key, entry] of this.searches) {
      if (entry.expiresAt <= now) this.searches.delete(key);
    }
  }

  private enforceLimit<T>(store: Map<string, { value: T; expiresAt: number }>, limit: number): void {
    while (store.size > limit) {
      const oldest = store.keys().next().value;
      if (!oldest) break;
      store.delete(oldest);
    }
  }
}

export default ResearchStore;
