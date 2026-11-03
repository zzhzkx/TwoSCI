export type LiteratureSource = 'webofscience' | 'scopus' | 'openalex' | 'crossref';
export type SearchMode = 'quick' | 'balanced' | 'deep';
export type ResultLayer = 'metadata' | 'abstract' | 'evidence';
export type ScreeningVerdict = 'include' | 'exclude' | 'maybe';
export type CitationDirection = 'references' | 'citing' | 'related';

export interface RecordSourceRef {
  source: LiteratureSource;
  sourceId: string;
  rank: number;
  url?: string;
  citedBy?: number;
  recordView?: string;
}

export interface LiteratureIdentifiers {
  doi?: string;
  pmid?: string;
  arxiv?: string;
  wosUid?: string;
  scopusEid?: string;
  openalexId?: string;
}

export interface LiteratureRecord {
  recordId: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  abstract: string;
  keywords: string[];
  categories: string[];
  doi: string;
  url: string;
  pdfUrl: string;
  openAccess: boolean;
  identifiers: LiteratureIdentifiers;
  sources: RecordSourceRef[];
  citedBy: Record<string, number>;
  references: string[];
  score?: number;
  extra?: Record<string, unknown>;
}

export interface SeedInput {
  doi?: string;
  wosUid?: string;
  scopusEid?: string;
  openalexId?: string;
  title?: string;
}

export interface ResearchScope {
  years?: string;
  discipline?: string;
  regions?: string[];
  exclusions?: string[];
}

export interface ResearchBrief {
  briefId: string;
  createdAt: string;
  intent: string;
  focus: string[];
  scope: ResearchScope;
  seed: LiteratureRecord;
  seedProfile: {
    keywords: string[];
    concepts: string[];
    frequentTerms: Array<{ term: string; count: number }>;
    referenceCount: number;
    citingCount: number;
    topReferences: LiteratureRecord[];
    topCiting: LiteratureRecord[];
  };
  warnings: string[];
}

export interface SourceRun {
  source: LiteratureSource;
  status: 'ok' | 'error' | 'skipped';
  returned: number;
  elapsedMs: number;
  product?: string;
  view?: string;
  error?: string;
}

export interface ScreeningDecision {
  recordId: string;
  verdict: ScreeningVerdict;
  reason: string;
  tags?: string[];
  confidence?: number;
  decidedAt: string;
}

export interface SearchSession {
  searchId: string;
  briefId?: string;
  query: string;
  mode: SearchMode;
  layer: ResultLayer;
  createdAt: string;
  candidateCount?: number;
  records: LiteratureRecord[];
  sourceRuns: SourceRun[];
  warnings: string[];
  screening: Record<string, ScreeningDecision>;
  notes?: string;
}

export interface SearchInput {
  query: string;
  briefId?: string;
  mode?: SearchMode;
  layer?: ResultLayer;
  sources?: LiteratureSource[];
  maxResults?: number;
  perSource?: number;
  year?: string;
  author?: string;
  journal?: string;
  openAccess?: boolean;
  sortBy?: 'relevance' | 'date' | 'citations';
  sortOrder?: 'asc' | 'desc';
  abstractChars?: number;
}

export interface BriefInput {
  seed: SeedInput;
  intent: string;
  focus?: string[];
  scope?: ResearchScope;
  includeCitationContext?: boolean;
}

export interface HydrateInput {
  searchId?: string;
  recordIds?: string[];
  dois?: string[];
  refresh?: boolean;
  includeAbstract?: boolean;
  includeReferences?: boolean;
}

export interface ExpandInput {
  searchId?: string;
  seeds: string[];
  directions?: CitationDirection[];
  limitPerSeed?: number;
  recordView?: 'short' | 'full';
}

export interface ExportInput {
  searchId?: string;
  briefId?: string;
  recordIds?: string[];
  format: 'bibtex' | 'ris' | 'json';
  includeAbstract?: boolean;
}

export interface ScreeningInput {
  searchId: string;
  decisions: Array<{
    recordId: string;
    verdict: ScreeningVerdict;
    reason: string;
    tags?: string[];
    confidence?: number;
  }>;
  notes?: string;
}
