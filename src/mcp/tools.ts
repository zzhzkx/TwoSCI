import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const TOOLS: Tool[] = [
  {
    name: 'search_papers',
    description: 'Search academic papers from multiple sources including arXiv, Web of Science, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        platform: {
          type: 'string',
          enum: [
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
          ],
          description:
            'Platform to search (default: crossref). Options: arxiv, webofscience/wos, pubmed, biorxiv, medrxiv, semantic, iacr, googlescholar/scholar, scihub, sciencedirect, springer, scopus, crossref, openalex, ieee, or all. "all" uses the unified multi-source path; prefer search_literature for seed-aware workflows. Note: Wiley only supports PDF download by DOI, use download_paper instead.'
        },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return'
        },
        year: { type: 'string', description: 'Year filter (e.g., "2023", "2020-2023", "2020-")' },
        author: { type: 'string', description: 'Author name filter' },
        journal: { type: 'string', description: 'Journal name filter' },
        category: { type: 'string', description: 'Category filter (e.g., cs.AI for arXiv)' },
        days: {
          type: 'number',
          description: 'Number of days to search back (bioRxiv/medRxiv only)'
        },
        fetchDetails: {
          type: 'boolean',
          description: 'Fetch detailed information (IACR only)'
        },
        fieldsOfStudy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields of study filter (Semantic Scholar only)'
        },
        sortBy: {
          type: 'string',
          enum: ['relevance', 'date', 'citations'],
          description: 'Sort results by relevance, date, or citations'
        },
        sortOrder: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order: ascending or descending'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_arxiv',
    description: 'Search academic papers specifically from arXiv preprint server',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 50,
          description: 'Maximum number of results to return'
        },
        category: { type: 'string', description: 'arXiv category filter (e.g., cs.AI, physics.gen-ph)' },
        author: { type: 'string', description: 'Author name filter' },
        year: { type: 'string', description: 'Year filter (e.g., "2023", "2020-2023")' },
        sortBy: {
          type: 'string',
          enum: ['relevance', 'date', 'citations'],
          description: 'Sort results by field'
        },
        sortOrder: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order: ascending or descending'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_webofscience',
    description: 'Search Web of Science. Defaults to Expanded when its key is configured, otherwise Starter; explicitly selecting a product is optional.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          default: 10,
          description: 'Maximum number of results to return'
        },
        year: { type: 'string', description: 'Publication year filter (e.g., "2023", "2020-2023")' },
        author: { type: 'string', description: 'Author name filter' },
        journal: { type: 'string', description: 'Journal name filter' },
        sortBy: {
          type: 'string',
          enum: ['relevance', 'date', 'citations'],
          description: 'Starter-supported sort field'
        },
        sortOrder: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order: ascending or descending'
        },
        apiProduct: {
          type: 'string',
          enum: ['auto', 'starter', 'expanded'],
          default: 'auto',
          description: 'auto uses Expanded when configured; otherwise Starter'
        },
        recordView: {
          type: 'string',
          enum: ['short', 'full'],
          description: 'Expanded record detail; defaults to full to avoid a second quota-consuming lookup'
        },
        discoverAccess: {
          type: 'boolean',
          default: false,
          description: 'Find public publisher PDF links using controlled direct retrieval and optional paid fallback'
        },
        discoverAccessMaxItems: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum result items to enrich; defaults to ACCESS_DISCOVERY_MAX_ITEMS or 5'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_webofscience_related_records',
    description: 'Get references, citing records, or related records through Web of Science Expanded API',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: 'Web of Science UID' },
        relation: { type: 'string', enum: ['references', 'citing', 'related'] },
        maxResults: { type: 'number', minimum: 1, maximum: 100, default: 50 },
        firstRecord: { type: 'number', minimum: 1, maximum: 100000, default: 1 },
        recordView: { type: 'string', enum: ['short', 'full'], description: 'Not accepted for references' }
      },
      required: ['uid', 'relation']
    }
  },
  {
    name: 'search_pubmed',
    description: 'Search biomedical literature from PubMed/MEDLINE database using NCBI E-utilities API',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return'
        },
        year: { type: 'string', description: 'Publication year filter (e.g., "2023", "2020-2023")' },
        author: { type: 'string', description: 'Author name filter' },
        journal: { type: 'string', description: 'Journal name filter' },
        publicationType: {
          type: 'array',
          items: { type: 'string' },
          description: 'Publication type filter (e.g., ["Journal Article", "Review"])'
        },
        sortBy: {
          type: 'string',
          enum: ['relevance', 'date'],
          description: 'Sort results by relevance or date'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_biorxiv',
    description: 'Search bioRxiv preprint server for biology papers',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return'
        },
        days: {
          type: 'number',
          description: 'Number of days to search back (default: 30)'
        },
        category: { type: 'string', description: 'Category filter (e.g., neuroscience, genomics)' }
      },
      required: ['query']
    }
  },
  {
    name: 'search_medrxiv',
    description: 'Search medRxiv preprint server for medical papers',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return'
        },
        days: {
          type: 'number',
          description: 'Number of days to search back (default: 30)'
        },
        category: { type: 'string', description: 'Category filter (e.g., infectious_diseases, epidemiology)' }
      },
      required: ['query']
    }
  },
  {
    name: 'search_semantic_scholar',
    description: 'Search Semantic Scholar for academic papers with citation data',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return'
        },
        year: { type: 'string', description: 'Year filter (e.g., "2023", "2020-2023")' },
        fieldsOfStudy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields of study filter (e.g., ["Computer Science", "Biology"])'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_iacr',
    description: 'Search IACR ePrint Archive for cryptography papers',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 50,
          description: 'Maximum number of results to return'
        },
        fetchDetails: {
          type: 'boolean',
          description: 'Fetch detailed information for each paper (slower)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'download_paper',
    description: 'Download PDF file of an academic paper',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string', description: 'Paper ID (e.g., arXiv ID, DOI for Sci-Hub)' },
        platform: {
          type: 'string',
          enum: ['arxiv', 'biorxiv', 'medrxiv', 'semantic', 'iacr', 'scihub', 'springer', 'wiley'],
          description: 'Platform where the paper is from'
        },
        savePath: {
          type: 'string',
          description: 'Directory to save the PDF file'
        }
      },
      required: ['paperId', 'platform']
    }
  },
  {
    name: 'download_public_paper',
    description: 'Download a public paper from Publisher, Google Scholar, or Sci-Hub using bounded page fallback and local PDF validation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        platform: {
          type: 'string',
          enum: ['publisher', 'googlescholar', 'scihub'],
          description: 'Canonical public-paper platform'
        },
        paperId: {
          type: 'string',
          description: 'DOI for Publisher/Sci-Hub, or a current-session Google Scholar reference'
        },
        savePath: {
          type: 'string',
          default: './downloads',
          description: 'Validated download directory; the output filename is derived internally'
        }
      },
      required: ['platform', 'paperId']
    }
  },
  {
    name: 'get_paper_markdown',
    description: 'Explicitly retrieve bounded, untrusted ScrapingAnt Markdown for a Publisher, Scholar, or Sci-Hub paper reference',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        platform: {
          type: 'string',
          enum: ['publisher', 'googlescholar', 'scihub'],
          description: 'Canonical Markdown platform'
        },
        paperId: {
          type: 'string',
          description: 'DOI for Publisher/Sci-Hub, or a current-session Google Scholar reference'
        }
      },
      required: ['platform', 'paperId']
    }
  },
  {
    name: 'search_google_scholar',
    description: 'Search Google Scholar for academic papers using web scraping',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 20,
          description: 'Maximum number of results to return'
        },
        yearLow: {
          type: 'number',
          description: 'Earliest publication year'
        },
        yearHigh: {
          type: 'number',
          description: 'Latest publication year'
        },
        author: {
          type: 'string',
          description: 'Author name filter'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_paper_by_doi',
    description: 'Retrieve paper information using DOI from available platforms',
    inputSchema: {
      type: 'object',
      properties: {
        doi: { type: 'string', description: 'DOI (Digital Object Identifier)' },
        platform: {
          type: 'string',
          enum: ['arxiv', 'webofscience', 'scihub', 'ieee', 'all'],
          description: 'Platform to search'
        }
      },
      required: ['doi']
    }
  },
  {
    name: 'discover_paper_access',
    description: 'Discover a public publisher PDF candidate for one DOI without claiming open-license or complete download success',
    inputSchema: {
      type: 'object',
      properties: {
        doi: {
          type: 'string',
          description: 'A DOI, doi: prefix, or doi.org URL; arbitrary HTTP URLs are rejected'
        },
        verifyPdf: {
          type: 'boolean',
          default: false,
          description: 'Optionally perform a bounded direct PDF prefix probe'
        }
      },
      required: ['doi']
    }
  },
  {
    name: 'search_scihub',
    description:
      'Controlled, opt-in Sci-Hub DOI adapter (disabled by default); accepts DOI/doi.org URLs only, tries direct mirrors before bounded ScrapingAnt fallback, and does not grant access rights.',
    inputSchema: {
      type: 'object',
      properties: {
        doiOrUrl: {
          type: 'string',
          description: 'DOI or doi.org URL only (e.g., "10.1038/nature12373"); ordinary paper URLs are rejected'
        },
        downloadPdf: {
          type: 'boolean',
          description: 'Whether to download the PDF file',
          default: false
        },
        savePath: {
          type: 'string',
          description: 'Directory to save the PDF file (if downloadPdf is true)'
        }
      },
      required: ['doiOrUrl']
    }
  },
  {
    name: 'check_scihub_mirrors',
    description: 'Check the health status of all Sci-Hub mirror sites',
    inputSchema: {
      type: 'object',
      properties: {
        forceCheck: {
          type: 'boolean',
          description: 'Force a fresh health check even if recent data exists',
          default: false
        }
      }
    }
  },
  {
    name: 'get_platform_status',
    description: 'Check the status and capabilities of available academic platforms',
    inputSchema: {
      type: 'object',
      properties: {
        validate: {
          type: 'boolean',
          description:
            'Whether to validate configured API keys by making a real request (may trigger rate limits). Default: false.'
        }
      }
    }
  },
  {
    name: 'search_sciencedirect',
    description: 'Search academic papers from Elsevier ScienceDirect database (requires API key)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return'
        },
        year: { type: 'string', description: 'Year filter (e.g., "2023", "2020-2023")' },
        author: { type: 'string', description: 'Author name filter' },
        journal: { type: 'string', description: 'Journal name filter' },
        openAccess: {
          type: 'boolean',
          description: 'Filter for open access articles only'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_springer',
    description:
      'Search academic papers from Springer Nature database. Uses Metadata API by default (all content) or OpenAccess API when openAccess=true (full text available). Same API key works for both.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return'
        },
        year: { type: 'string', description: 'Year filter (e.g., "2023", "2020-2023")' },
        author: { type: 'string', description: 'Author name filter' },
        journal: { type: 'string', description: 'Journal name filter' },
        subject: { type: 'string', description: 'Subject area filter' },
        openAccess: {
          type: 'boolean',
          description: 'Search only open access content'
        },
        type: {
          type: 'string',
          enum: ['Journal', 'Book', 'Chapter'],
          description: 'Publication type filter'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_scopus',
    description: 'Search the Scopus abstract and citation database (requires Elsevier API key). COMPLETE view returns abstracts and is paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 200,
          description: 'Maximum number of results; COMPLETE requests are paginated in pages of 25'
        },
        year: { type: 'string', description: 'Year filter (e.g., "2023", "2020-2023")' },
        author: { type: 'string', description: 'Author name filter' },
        journal: { type: 'string', description: 'Journal name filter' },
        affiliation: { type: 'string', description: 'Institution/affiliation filter' },
        subject: { type: 'string', description: 'Subject area filter' },
        openAccess: {
          type: 'boolean',
          description: 'Filter for open access articles only'
        },
        documentType: {
          type: 'string',
          enum: ['ar', 'cp', 're', 'bk', 'ch'],
          description: 'Document type: ar=article, cp=conference paper, re=review, bk=book, ch=chapter'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_crossref',
    description:
      'Search academic papers from Crossref database. Free API with extensive scholarly metadata coverage across publishers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return'
        },
        year: { type: 'string', description: 'Year filter (e.g., "2023", "2020-2023")' },
        author: { type: 'string', description: 'Author name filter' },
        sortBy: {
          type: 'string',
          enum: ['relevance', 'date', 'citations'],
          description: 'Sort results by relevance, date, or citations'
        },
        sortOrder: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order: ascending or descending'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_openalex',
    description: 'Search OpenAlex for fast free discovery and one-hop citation enrichment',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 300,
          description: 'Maximum number of results'
        },
        year: { type: 'string', description: 'Year filter (e.g., "2023", "2020-2023")' },
        openAccess: { type: 'boolean', description: 'Filter for open-access works only' },
        sortBy: { type: 'string', enum: ['relevance', 'date', 'citations'] },
        sortOrder: { type: 'string', enum: ['asc', 'desc'] }
      },
      required: ['query']
    }
  },
  {
    name: 'search_ieee',
    description:
      'Search IEEE Xplore metadata and abstracts (requires IEEE_XPLORE_API_KEY). One request returns up to 200 records; results may include metadata outside the caller\'s institutional subscription.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text IEEE Xplore query' },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 200,
          description: 'Maximum number of records (IEEE API limit: 200 per request)'
        },
        year: { type: 'string', description: 'Year filter (e.g., "2024" or "2020-2024")' },
        author: { type: 'string', description: 'Author name filter' },
        journal: { type: 'string', description: 'Publication title filter' },
        openAccess: { type: 'boolean', description: 'Filter to IEEE open-access records' },
        contentType: {
          type: 'string',
          enum: ['Books', 'Conferences', 'Courses', 'Early Access', 'Journals', 'Magazines', 'Standards'],
          description: 'IEEE content type filter (case-sensitive)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'create_research_brief',
    description:
      'Create a research brief from a seed paper plus the user intent. Resolves the seed with WoS Expanded (when configured), Scopus, OpenAlex, and Crossref; returns its abstract, keywords, references, citing sample, and a brief_id for later searches.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seed: {
          type: 'object',
          additionalProperties: false,
          properties: {
            doi: { type: 'string' },
            wosUid: { type: 'string' },
            scopusEid: { type: 'string' },
            openalexId: { type: 'string' },
            title: { type: 'string' }
          }
        },
        intent: {
          type: 'string',
          description: 'What the user wants to learn from or around this seed paper, including the target field, indicators, methods, or policy context'
        },
        focus: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional facets such as background, metrics, methods, mechanisms, or policy'
        },
        scope: {
          type: 'object',
          additionalProperties: false,
          properties: {
            years: { type: 'string' },
            discipline: { type: 'string' },
            regions: { type: 'array', items: { type: 'string' } },
            exclusions: { type: 'array', items: { type: 'string' } }
          }
        },
        includeCitationContext: {
          type: 'boolean',
          default: true,
          description: 'Fetch a bounded references/citing sample for understanding the seed paper context'
        }
      },
      required: ['seed', 'intent']
    }
  },
  {
    name: 'search_literature',
    description:
      'Unified deduplicated literature search across WoS (Expanded by default when configured), Scopus, OpenAlex, Crossref, and IEEE Xplore (opt-in source). Returns candidates with source provenance and a search_id. Use layer=metadata for cheap triage, abstract for screening, evidence for deeper evidence packets. Screening should be delegated to subagents in batches.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Boolean or natural-language query composed by the agent' },
        briefId: { type: 'string', description: 'Optional research brief that supplies seed context' },
        mode: {
          type: 'string',
          enum: ['quick', 'balanced', 'deep'],
          default: 'balanced',
          description: 'quick: 10/source; balanced: 25/source; deep: 50/source'
        },
        layer: {
          type: 'string',
          enum: ['metadata', 'abstract', 'evidence'],
          default: 'abstract',
          description: 'Response detail only; WoS/Scopus are fetched once at full detail to avoid duplicate quota use'
        },
        sources: {
          type: 'array',
          items: { type: 'string', enum: ['webofscience', 'scopus', 'openalex', 'crossref', 'ieee'] }
        },
        maxResults: { type: 'number', minimum: 1, maximum: 300 },
        perSource: { type: 'number', minimum: 1, maximum: 100 },
        year: { type: 'string' },
        author: { type: 'string' },
        journal: { type: 'string' },
        openAccess: { type: 'boolean' },
        sortBy: { type: 'string', enum: ['relevance', 'date', 'citations'] },
        sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        abstractChars: {
          type: 'number',
          minimum: 500,
          maximum: 8000,
          default: 3000,
          description: 'Per-record abstract cap in the response'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_literature_records',
    description:
      'Hydrate stored search results by record_id, or resolve DOIs, without re-running discovery. By default returns the full abstract and references already held in the session. Set refresh=true only when fresh provider metadata is required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        searchId: { type: 'string' },
        recordIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        dois: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        refresh: { type: 'boolean', default: false },
        includeAbstract: { type: 'boolean', default: true },
        includeReferences: { type: 'boolean', default: true },
        fetchReferences: {
          type: 'boolean',
          default: false,
          description: 'Fetch references for selected records when they are not already in the session; this may make one provider request per record'
        }
      }
    }
  },
  {
    name: 'expand_citation_graph',
    description:
      'Expand one hop from seed papers through references, citing papers, or related records. Uses WoS Expanded first when the seed has a WoS UID, then OpenAlex, then Crossref. Returns graph nodes, typed edges, and a search_id for export or hydration.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        searchId: { type: 'string', description: 'Optional session containing the seed record_ids' },
        seeds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 10,
          description: 'record_id, DOI, WoS UID, or OpenAlex work ID'
        },
        directions: {
          type: 'array',
          items: { type: 'string', enum: ['references', 'citing', 'related'] },
          default: ['references', 'citing']
        },
        limitPerSeed: { type: 'number', minimum: 1, maximum: 100, default: 50 },
        recordView: { type: 'string', enum: ['short', 'full'], default: 'full' }
      },
      required: ['seeds']
    }
  },
  {
    name: 'save_screening',
    description:
      'Persist include/exclude/maybe decisions and reasons from abstract-screening subagents. The decision ledger is attached to the search_id and can be exported or reviewed later.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        searchId: { type: 'string' },
        decisions: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              recordId: { type: 'string' },
              verdict: { type: 'string', enum: ['include', 'exclude', 'maybe'] },
              reason: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number', minimum: 0, maximum: 1 }
            },
            required: ['recordId', 'verdict', 'reason']
          }
        },
        notes: { type: 'string' }
      },
      required: ['searchId', 'decisions']
    }
  },
  {
    name: 'export_literature',
    description:
      'Export a search result set to BibTeX, RIS, or JSON. Export is user-initiated and is the intended way to retain WoS/Scopus records outside the process.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        searchId: { type: 'string' },
        briefId: { type: 'string' },
        recordIds: { type: 'array', items: { type: 'string' }, maxItems: 200 },
        format: { type: 'string', enum: ['bibtex', 'ris', 'json'] },
        includeAbstract: { type: 'boolean', default: true }
      },
      required: ['format']
    }
  },
  {
    name: 'get_source_status',
    description:
      'Report configured sources, WoS default product, quota/rate status, OpenAlex/Crossref cache state, IEEE rate status, and in-memory brief/search session counts. Set validate=true only when an actual key validation request is acceptable.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        validate: { type: 'boolean', default: false }
      }
    }
  },
  {
    name: 'get_citations',
    description:
      'Retrieve citation data (citation count, references, venue) for a paper by DOI using Semantic Scholar',
    inputSchema: {
      type: 'object',
      properties: {
        doi: { type: 'string', description: 'DOI (Digital Object Identifier)' },
        forceRefresh: {
          type: 'boolean',
          description: 'Bypass the cache and fetch fresh data (default: false)'
        }
      },
      required: ['doi']
    }
  }
];
