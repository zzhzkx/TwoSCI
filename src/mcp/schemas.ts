import { z } from 'zod';
import { sanitizeDoi } from '../utils/SecurityUtils.js';
import { PUBLIC_PAPER_PLATFORMS, type PublicPaperPlatform } from './publicPaperContracts.js';

const SortBySchema = z.enum(['relevance', 'date', 'citations']);
const SortOrderSchema = z.enum(['asc', 'desc']);

export const SearchPapersSchema = z
  .object({
    query: z.string().min(1),
    platform: z
      .enum([
        'arxiv',
        'webofscience',
        'pubmed',
        'wos',
        'biorxiv',
        'medrxiv',
        'semantic',
        'iacr',
        'googlescholar',
        'scholar',
        'scihub',
        'sciencedirect',
        'springer',
        'scopus',
        'crossref',
        'openalex',
        'ieee',
        'all'
      ])
      .optional()
      .default('crossref'),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    year: z.string().optional(),
    author: z.string().optional(),
    journal: z.string().optional(),
    category: z.string().optional(),
    days: z.number().int().min(1).max(3650).optional(),
    fetchDetails: z.boolean().optional(),
    fieldsOfStudy: z.array(z.string()).optional(),
    sortBy: SortBySchema.optional().default('relevance'),
    sortOrder: SortOrderSchema.optional().default('desc')
  })
  .strip();

export const SearchArxivSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(50).optional().default(10),
    category: z.string().optional(),
    author: z.string().optional(),
    year: z.string().optional(),
    sortBy: SortBySchema.optional(),
    sortOrder: SortOrderSchema.optional()
  })
  .strip();

export const SearchWebOfScienceSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    year: z.string().optional(),
    author: z.string().optional(),
    journal: z.string().optional(),
    sortBy: SortBySchema.optional(),
    sortOrder: SortOrderSchema.optional(),
    apiProduct: z.enum(['auto', 'starter', 'expanded']).optional().default('auto'),
    recordView: z.enum(['short', 'full']).optional(),
    discoverAccess: z.boolean().optional().default(false),
    discoverAccessMaxItems: z.number().int().min(1).max(100).optional()
  })
  .strip()
  .superRefine((value, context) => {
    if (value.apiProduct === 'starter' && value.recordView !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['recordView'], message: 'recordView is only valid for the expanded API' });
    }
  });

export const GetWebOfScienceRelatedRecordsSchema = z
  .object({
    uid: z.string().min(1),
    relation: z.enum(['references', 'citing', 'related']),
    maxResults: z.number().int().min(1).max(100).optional().default(50),
    firstRecord: z.number().int().min(1).max(100000).optional().default(1),
    recordView: z.enum(['short', 'full']).optional()
  })
  .strip()
  .superRefine((value, context) => {
    if (value.relation === 'references' && value.recordView !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['recordView'], message: 'references does not accept recordView' });
    }
  });

export const SearchPubMedSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    year: z.string().optional(),
    author: z.string().optional(),
    journal: z.string().optional(),
    publicationType: z.array(z.string()).optional(),
    sortBy: z.enum(['relevance', 'date']).optional()
  })
  .strip();

export const SearchBioRxivSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    days: z.number().int().min(1).max(3650).optional(),
    category: z.string().optional()
  })
  .strip();

export const SearchMedRxivSchema = SearchBioRxivSchema;

export const SearchSemanticScholarSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    year: z.string().optional(),
    fieldsOfStudy: z.array(z.string()).optional()
  })
  .strip();

export const SearchIACRSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(50).optional().default(10),
    fetchDetails: z.boolean().optional()
  })
  .strip();

export const DownloadPaperSchema = z
  .object({
    paperId: z.string().min(1),
    platform: z.enum(['arxiv', 'biorxiv', 'medrxiv', 'semantic', 'iacr', 'scihub', 'springer', 'wiley']),
    savePath: z.string().optional()
  })
  .strip();

const PublicPaperPlatformSchema = z.enum(PUBLIC_PAPER_PLATFORMS);
const PublicPaperIdSchema = z.string().trim().min(1).max(256);

export const DownloadPublicPaperSchema = z
  .object({
    platform: PublicPaperPlatformSchema,
    paperId: PublicPaperIdSchema,
    savePath: z.string().optional().default('./downloads')
  })
  .strict()
  .superRefine(validatePublicPaperReference);

export const GetPaperMarkdownSchema = z
  .object({
    platform: PublicPaperPlatformSchema,
    paperId: PublicPaperIdSchema
  })
  .strict()
  .superRefine(validatePublicPaperReference);

export const SearchGoogleScholarSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(20).optional().default(10),
    yearLow: z.number().int().optional(),
    yearHigh: z.number().int().optional(),
    author: z.string().optional()
  })
  .strip();

export const DiscoverPaperAccessSchema = z
  .object({
    doi: z.string().min(1),
    verifyPdf: z.boolean().optional().default(false)
  })
  .strict()
  .superRefine((value, context) => {
    if (!isDoiOnlyInput(value.doi)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['doi'], message: 'Only a DOI, doi: prefix, or doi.org URL is accepted' });
    }
  });

export const GetPaperByDoiSchema = z
  .object({
    doi: z.string().min(1),
    platform: z.enum(['arxiv', 'webofscience', 'scihub', 'ieee', 'all']).optional().default('all')
  })
  .strip();

export const SearchSciHubSchema = z
  .object({
    doiOrUrl: z.string().min(1),
    downloadPdf: z.boolean().optional().default(false),
    savePath: z.string().optional()
  })
  .strip();

export const CheckSciHubMirrorsSchema = z
  .object({
    forceCheck: z.boolean().optional().default(false)
  })
  .strip();

export const SearchScienceDirectSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    year: z.string().optional(),
    author: z.string().optional(),
    journal: z.string().optional(),
    openAccess: z.boolean().optional()
  })
  .strip();

export const SearchSpringerSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    year: z.string().optional(),
    author: z.string().optional(),
    journal: z.string().optional(),
    subject: z.string().optional(),
    openAccess: z.boolean().optional(),
    type: z.enum(['Journal', 'Book', 'Chapter']).optional()
  })
  .strip();

export const SearchScopusSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(200).optional().default(10),
    year: z.string().optional(),
    author: z.string().optional(),
    journal: z.string().optional(),
    affiliation: z.string().optional(),
    subject: z.string().optional(),
    openAccess: z.boolean().optional(),
    documentType: z.enum(['ar', 'cp', 're', 'bk', 'ch']).optional()
  })
  .strip();

export const SearchOpenAlexSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(300).optional().default(10),
    year: z.string().optional(),
    openAccess: z.boolean().optional(),
    sortBy: z.enum(['relevance', 'date', 'citations']).optional(),
    sortOrder: SortOrderSchema.optional()
  })
  .strip();

export const SearchIEEESchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(200).optional().default(25),
    year: z.string().optional(),
    author: z.string().optional(),
    journal: z.string().optional(),
    openAccess: z.boolean().optional(),
    contentType: z
      .enum(['Books', 'Conferences', 'Courses', 'Early Access', 'Journals', 'Magazines', 'Standards'])
      .optional()
  })
  .strip();

export const SearchCrossrefSchema = z
  .object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    year: z.string().optional(),
    author: z.string().optional(),
    sortBy: SortBySchema.optional().default('relevance'),
    sortOrder: SortOrderSchema.optional().default('desc')
  })
  .strip();

export const GetPlatformStatusSchema = z
  .object({
    validate: z.boolean().optional().default(false)
  })
  .strip();

export const GetCitationsSchema = z
  .object({
    doi: z.string().min(1),
    forceRefresh: z.boolean().optional().default(false)
  })
  .strip();

const LiteratureSourceSchema = z.enum(['webofscience', 'scopus', 'openalex', 'crossref', 'ieee']);
const ResultLayerSchema = z.enum(['metadata', 'abstract', 'evidence']);
const SearchModeSchema = z.enum(['quick', 'balanced', 'deep']);

export const CreateResearchBriefSchema = z
  .object({
    seed: z
      .object({
        doi: z.string().optional(),
        wosUid: z.string().optional(),
        scopusEid: z.string().optional(),
        openalexId: z.string().optional(),
        title: z.string().optional()
      })
      .strict()
      .refine(
        seed => Boolean(seed.doi || seed.wosUid || seed.scopusEid || seed.openalexId || seed.title),
        'At least one seed identifier is required'
      ),
    intent: z.string().trim().min(1).max(4000),
    focus: z.array(z.string().trim().min(1)).max(20).optional(),
    scope: z
      .object({
        years: z.string().optional(),
        discipline: z.string().optional(),
        regions: z.array(z.string()).optional(),
        exclusions: z.array(z.string()).optional()
      })
      .strict()
      .optional(),
    includeCitationContext: z.boolean().optional().default(true)
  })
  .strict();

export const SearchLiteratureSchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    briefId: z.string().optional(),
    mode: SearchModeSchema.optional().default('balanced'),
    layer: ResultLayerSchema.optional().default('abstract'),
    sources: z.array(LiteratureSourceSchema).max(5).optional(),
    maxResults: z.number().int().min(1).max(300).optional(),
    perSource: z.number().int().min(1).max(100).optional(),
    year: z.string().optional(),
    author: z.string().optional(),
    journal: z.string().optional(),
    openAccess: z.boolean().optional(),
    sortBy: SortBySchema.optional(),
    sortOrder: SortOrderSchema.optional(),
    abstractChars: z.number().int().min(500).max(8000).optional().default(3000)
  })
  .strict();

export const GetLiteratureRecordsSchema = z
  .object({
    searchId: z.string().optional(),
    recordIds: z.array(z.string()).max(50).optional(),
    dois: z.array(z.string()).max(20).optional(),
    refresh: z.boolean().optional().default(false),
    includeAbstract: z.boolean().optional().default(true),
    includeReferences: z.boolean().optional().default(true),
    fetchReferences: z.boolean().optional().default(false)
  })
  .strict()
  .refine(
    value => Boolean(value.searchId || value.recordIds?.length || value.dois?.length),
    'Provide searchId, recordIds, or dois'
  );

export const ExpandCitationGraphSchema = z
  .object({
    searchId: z.string().optional(),
    seeds: z.array(z.string().trim().min(1)).min(1).max(10),
    directions: z.array(z.enum(['references', 'citing', 'related'])).max(3).optional(),
    limitPerSeed: z.number().int().min(1).max(100).optional().default(50),
    recordView: z.enum(['short', 'full']).optional().default('full')
  })
  .strict();

export const SaveScreeningSchema = z
  .object({
    searchId: z.string().min(1),
    decisions: z
      .array(
        z
          .object({
            recordId: z.string().min(1),
            verdict: z.enum(['include', 'exclude', 'maybe']),
            reason: z.string().trim().min(1).max(1000),
            tags: z.array(z.string()).optional(),
            confidence: z.number().min(0).max(1).optional()
          })
          .strict()
      )
      .min(1)
      .max(100),
    notes: z.string().max(4000).optional()
  })
  .strict();

export const ExportLiteratureSchema = z
  .object({
    searchId: z.string().optional(),
    briefId: z.string().optional(),
    recordIds: z.array(z.string()).max(200).optional(),
    format: z.enum(['bibtex', 'ris', 'json', 'markdown']),
    verdict: z.enum(['include', 'exclude', 'maybe', 'all']).optional(),
    includeAbstract: z.boolean().optional().default(true)
  })
  .strict()
  .refine(value => Boolean(value.searchId || value.briefId), 'Provide searchId or briefId');

export const GetSourceStatusSchema = z
  .object({
    validate: z.boolean().optional().default(false)
  })
  .strict();

export function isDoiOnlyInput(value: string): boolean {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
      if (url.username || url.password || !['doi.org', 'dx.doi.org'].includes(hostname)) return false;
    } catch {
      return false;
    }
  } else if (!/^doi:/i.test(trimmed) && !/^10\./i.test(trimmed)) {
    return false;
  }
  return sanitizeDoi(trimmed).valid;
}

function validatePublicPaperReference(
  value: { platform: PublicPaperPlatform; paperId: string },
  context: z.RefinementCtx
): void {
  if (value.platform === 'googlescholar') {
    if (!isScholarReferenceInput(value.paperId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['paperId'], message: 'Google Scholar paperId must be an opaque session reference' });
    }
    return;
  }
  if (!isDoiOnlyInput(value.paperId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['paperId'], message: 'Publisher and Sci-Hub paperId must contain only a DOI' });
  }
}

function isScholarReferenceInput(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
    && !/^https?:\/\//i.test(value)
    && !/[\\/?#@]/.test(value);
}

function normalizePublicPaperArgs(
  value: { platform: PublicPaperPlatform; paperId: string; savePath?: string }
): { platform: PublicPaperPlatform; paperId: string; savePath?: string } {
  if (value.platform === 'googlescholar') {
    return { ...value, paperId: value.paperId.trim() };
  }
  const normalized = sanitizeDoi(value.paperId);
  if (!normalized.valid) throw new Error('Invalid DOI format');
  return { ...value, paperId: normalized.sanitized };
}

export type ToolName =
  | 'search_papers'
  | 'search_arxiv'
  | 'search_webofscience'
  | 'get_webofscience_related_records'
  | 'search_pubmed'
  | 'search_biorxiv'
  | 'search_medrxiv'
  | 'search_semantic_scholar'
  | 'search_iacr'
  | 'download_paper'
  | 'download_public_paper'
  | 'get_paper_markdown'
  | 'search_google_scholar'
  | 'get_paper_by_doi'
  | 'discover_paper_access'
  | 'search_scihub'
  | 'check_scihub_mirrors'
  | 'get_platform_status'
  | 'search_sciencedirect'
  | 'search_springer'
  | 'search_scopus'
  | 'search_crossref'
  | 'search_openalex'
  | 'search_ieee'
  | 'create_research_brief'
  | 'search_literature'
  | 'get_literature_records'
  | 'expand_citation_graph'
  | 'save_screening'
  | 'export_literature'
  | 'get_source_status'
  | 'get_citations';

export function parseToolArgs(toolName: ToolName, args: unknown): any {
  switch (toolName) {
    case 'search_papers':
      return SearchPapersSchema.parse(args);
    case 'search_arxiv':
      return SearchArxivSchema.parse(args);
    case 'search_webofscience':
      return SearchWebOfScienceSchema.parse(args);
    case 'get_webofscience_related_records':
      return GetWebOfScienceRelatedRecordsSchema.parse(args);
    case 'search_pubmed':
      return SearchPubMedSchema.parse(args);
    case 'search_biorxiv':
      return SearchBioRxivSchema.parse(args);
    case 'search_medrxiv':
      return SearchMedRxivSchema.parse(args);
    case 'search_semantic_scholar':
      return SearchSemanticScholarSchema.parse(args);
    case 'search_iacr':
      return SearchIACRSchema.parse(args);
    case 'download_paper':
      return DownloadPaperSchema.parse(args);
    case 'download_public_paper': {
      const parsed = DownloadPublicPaperSchema.parse(args);
      return normalizePublicPaperArgs(parsed);
    }
    case 'get_paper_markdown': {
      const parsed = GetPaperMarkdownSchema.parse(args);
      return normalizePublicPaperArgs(parsed);
    }
    case 'search_google_scholar':
      return SearchGoogleScholarSchema.parse(args);
    case 'get_paper_by_doi':
      return GetPaperByDoiSchema.parse(args);
    case 'discover_paper_access':
      return DiscoverPaperAccessSchema.parse(args);
    case 'search_scihub':
      return SearchSciHubSchema.parse(args);
    case 'check_scihub_mirrors':
      return CheckSciHubMirrorsSchema.parse(args);
    case 'get_platform_status':
      return GetPlatformStatusSchema.parse(args ?? {});
    case 'get_citations':
      return GetCitationsSchema.parse(args);
    case 'search_sciencedirect':
      return SearchScienceDirectSchema.parse(args);
    case 'search_springer':
      return SearchSpringerSchema.parse(args);
    case 'search_scopus':
      return SearchScopusSchema.parse(args);
    case 'search_crossref':
      return SearchCrossrefSchema.parse(args);
    case 'search_openalex':
      return SearchOpenAlexSchema.parse(args);
    case 'search_ieee':
      return SearchIEEESchema.parse(args);
    case 'create_research_brief':
      return CreateResearchBriefSchema.parse(args);
    case 'search_literature':
      return SearchLiteratureSchema.parse(args);
    case 'get_literature_records':
      return GetLiteratureRecordsSchema.parse(args);
    case 'expand_citation_graph':
      return ExpandCitationGraphSchema.parse(args);
    case 'save_screening':
      return SaveScreeningSchema.parse(args);
    case 'export_literature':
      return ExportLiteratureSchema.parse(args);
    case 'get_source_status':
      return GetSourceStatusSchema.parse(args ?? {});
    default:
      return args;
  }
}
