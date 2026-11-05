/**
 * Schemas Unit Tests
 * Tests for MCP tool argument parsing and validation
 */

import { describe, it, expect } from '@jest/globals';
import { parseToolArgs } from '../../src/mcp/schemas.js';

describe('parseToolArgs', () => {
  describe('search_papers', () => {
    it('should require a query', () => {
      expect(() => parseToolArgs('search_papers', {})).toThrow();
    });

    it('should apply defaults', () => {
      const args = parseToolArgs('search_papers', { query: 'machine learning' });
      expect(args.platform).toBe('crossref');
      expect(args.maxResults).toBe(10);
      expect(args.sortBy).toBe('relevance');
      expect(args.sortOrder).toBe('desc');
    });

    it('should strip unknown fields', () => {
      const args = parseToolArgs('search_papers', {
        query: 'test',
        unexpected: 'should-be-stripped'
      });
      expect(args.unexpected).toBeUndefined();
    });

    it('should cap maxResults at 100', () => {
      expect(() =>
        parseToolArgs('search_papers', { query: 'test', maxResults: 101 })
      ).toThrow();
    });

    it('should accept IEEE Xplore as a platform', () => {
      expect(parseToolArgs('search_papers', {
        query: 'optical phased array',
        platform: 'ieee'
      }).platform).toBe('ieee');
    });
  });

  describe('search_webofscience', () => {
    it('defaults to auto product resolution and rejects Starter recordView', () => {
      const args = parseToolArgs('search_webofscience', { query: 'test' });
      expect(args.apiProduct).toBe('auto');
      expect(args.discoverAccess).toBe(false);
      expect(() => parseToolArgs('search_webofscience', {
        query: 'test',
        apiProduct: 'starter',
        recordView: 'full'
      })).toThrow();
    });

    it('allows search results above the independent discovery limit', () => {
      const args = parseToolArgs('search_webofscience', { query: 'test', discoverAccess: true, maxResults: 6 });
      expect(args.maxResults).toBe(6);
    });

    it('bounds the independent discovery limit', () => {
      expect(() => parseToolArgs('search_webofscience', { query: 'test', discoverAccess: true, discoverAccessMaxItems: 101 })).toThrow(/discoverAccessMaxItems/i);
    });
  });

  describe('get_webofscience_related_records', () => {
    it('applies relationship defaults and rejects recordView for references', () => {
      const args = parseToolArgs('get_webofscience_related_records', { uid: 'WOS:1', relation: 'citing' });
      expect(args.maxResults).toBe(50);
      expect(args.firstRecord).toBe(1);
      expect(() => parseToolArgs('get_webofscience_related_records', { uid: 'WOS:1', relation: 'references', recordView: 'full' })).toThrow();
    });
  });

  describe('download_paper', () => {
    it('should require paperId and platform', () => {
      expect(() => parseToolArgs('download_paper', { platform: 'arxiv' })).toThrow();
      expect(() => parseToolArgs('download_paper', { paperId: '123' })).toThrow();
    });

    it('should accept a valid savePath', () => {
      const args = parseToolArgs('download_paper', {
        paperId: '2301.00123',
        platform: 'arxiv',
        savePath: './my-downloads'
      });
      expect(args.savePath).toBe('./my-downloads');
    });

    it('should reject invalid platform values', () => {
      expect(() =>
        parseToolArgs('download_paper', { paperId: 'x', platform: 'not-a-platform' })
      ).toThrow();
    });
  });

  describe('public paper tools', () => {
    it('strictly parses and normalizes DOI-backed download and markdown inputs', () => {
      expect(parseToolArgs('download_public_paper', {
        platform: 'publisher',
        paperId: 'doi:10.1000/Test',
        savePath: 'sub'
      })).toEqual({ platform: 'publisher', paperId: '10.1000/Test', savePath: 'sub' });
      expect(parseToolArgs('get_paper_markdown', {
        platform: 'scihub',
        paperId: 'https://doi.org/10.1000/Test'
      })).toEqual({ platform: 'scihub', paperId: '10.1000/Test' });
      expect(parseToolArgs('download_public_paper', {
        platform: 'googlescholar',
        paperId: 'gs_abc_123'
      })).toEqual({ platform: 'googlescholar', paperId: 'gs_abc_123', savePath: './downloads' });
    });

    it('rejects unknown fields, arbitrary URLs, and invalid platform references', () => {
      expect(() => parseToolArgs('download_public_paper', {
        platform: 'publisher', paperId: '10.1000/test', provider: 'scrapingant'
      })).toThrow();
      expect(() => parseToolArgs('get_paper_markdown', {
        platform: 'publisher', paperId: 'https://publisher.example/article'
      })).toThrow(/DOI/i);
      expect(() => parseToolArgs('download_public_paper', {
        platform: 'googlescholar', paperId: 'https://publisher.example/article'
      })).toThrow();
      expect(() => parseToolArgs('get_paper_markdown', {
        platform: 'publisher', paperId: '10.1000/test', savePath: './downloads'
      })).toThrow();
    });
  });

  describe('get_citations', () => {
    it('should require a DOI', () => {
      expect(() => parseToolArgs('get_citations', {})).toThrow();
    });

    it('should apply forceRefresh default', () => {
      const args = parseToolArgs('get_citations', { doi: '10.1038/nature12373' });
      expect(args.forceRefresh).toBe(false);
    });
  });

  describe('get_paper_by_doi', () => {
    it('accepts exactly the declared platform values and applies the all default', () => {
      expect(parseToolArgs('get_paper_by_doi', { doi: '10.1038/nature12373' }).platform).toBe('all');
      for (const platform of ['arxiv', 'webofscience', 'scihub', 'ieee', 'all']) {
        expect(parseToolArgs('get_paper_by_doi', {
          doi: '10.1038/nature12373',
          platform
        }).platform).toBe(platform);
      }
      expect(() => parseToolArgs('get_paper_by_doi', {
        doi: '10.1038/nature12373',
        platform: 'scrapingant'
      })).toThrow();
    });

    it('strips unknown fields without changing the validated DOI route', () => {
      const args = parseToolArgs('get_paper_by_doi', {
        doi: '10.1038/nature12373',
        platform: 'scihub',
        provider: 'scrapingant',
        purpose: 'publisher_discovery',
        budget: 500
      });
      expect(args).toEqual({ doi: '10.1038/nature12373', platform: 'scihub' });
    });
  });

  describe('search_ieee', () => {
    it('applies IEEE defaults and accepts documented content types', () => {
      expect(parseToolArgs('search_ieee', { query: 'photonic integration' })).toEqual({
        query: 'photonic integration',
        maxResults: 25
      });
      expect(parseToolArgs('search_ieee', {
        query: 'photonic integration',
        maxResults: 50,
        contentType: 'Journals',
        year: '2020-2025'
      })).toEqual({
        query: 'photonic integration',
        maxResults: 50,
        contentType: 'Journals',
        year: '2020-2025'
      });
    });

    it('rejects results above the IEEE single-request limit', () => {
      expect(() => parseToolArgs('search_ieee', { query: 'test', maxResults: 201 })).toThrow();
    });
  });

  describe('search_literature', () => {
    it('accepts IEEE as an opt-in source', () => {
      const args = parseToolArgs('search_literature', {
        query: 'optical phased array',
        sources: ['ieee', 'openalex']
      });
      expect(args.sources).toEqual(['ieee', 'openalex']);
    });
  });

  describe('discover_paper_access', () => {
    it('accepts DOI-only inputs and defaults verification off', () => {
      const args = parseToolArgs('discover_paper_access', { doi: 'https://doi.org/10.1038/nature12373' });
      expect(args.verifyPdf).toBe(false);
    });

    it('rejects arbitrary URLs, DOI userinfo, and unknown fields', () => {
      expect(() => parseToolArgs('discover_paper_access', { doi: 'https://publisher.example/article' })).toThrow(/DOI/i);
      expect(() => parseToolArgs('discover_paper_access', { doi: 'https://user:pass@doi.org/10.1038/nature12373' })).toThrow(/DOI/i);
      expect(() => parseToolArgs('discover_paper_access', { doi: '10.1038/nature12373', provider: 'scrapingant' })).toThrow();
    });
  });

  describe('search_scihub', () => {
    it('should accept a DOI or URL', () => {
      const args = parseToolArgs('search_scihub', { doiOrUrl: '10.1038/nature12373' });
      expect(args.downloadPdf).toBe(false);
    });
  });

  describe('literature workflow tools', () => {
    it('parses a seed brief and applies search defaults', () => {
      const brief = parseToolArgs('create_research_brief', {
        seed: { doi: '10.1000/green.1' },
        intent: 'Find indicators and policy evaluations in this field'
      });
      expect(brief.includeCitationContext).toBe(true);
      expect(brief.seed.doi).toBe('10.1000/green.1');

      const search = parseToolArgs('search_literature', { query: 'green building carbon' });
      expect(search.mode).toBe('balanced');
      expect(search.layer).toBe('abstract');
      expect(search.abstractChars).toBe(3000);
    });

    it('parses export_literature with markdown and verdict filtering', () => {
      const args = parseToolArgs('export_literature', {
        searchId: 'search_123',
        format: 'markdown',
        verdict: 'include',
        includeAbstract: false
      });
      expect(args.format).toBe('markdown');
      expect(args.verdict).toBe('include');
      expect(args.includeAbstract).toBe(false);
    });

    it('parses resolve_fulltext_access and generate_reading_cards schemas', () => {
      const resolveArgs = parseToolArgs('resolve_fulltext_access', {
        searchId: 'search_123',
        verdict: 'include'
      });
      expect(resolveArgs.searchId).toBe('search_123');
      expect(resolveArgs.verdict).toBe('include');

      const cardsArgs = parseToolArgs('generate_reading_cards', {
        briefId: 'brief_123',
        verdict: 'all'
      });
      expect(cardsArgs.briefId).toBe('brief_123');
      expect(cardsArgs.verdict).toBe('all');
    });

    it('requires a seed identifier and a valid screening decision', () => {
      expect(() => parseToolArgs('create_research_brief', {
        seed: {},
        intent: 'test'
      })).toThrow(/seed identifier/i);
      expect(() => parseToolArgs('save_screening', {
        searchId: 'srch_1',
        decisions: [{ recordId: 'lit_1', verdict: 'unknown', reason: 'x' }]
      })).toThrow();
    });

    it('requires a selector for hydration and export', () => {
      expect(() => parseToolArgs('get_literature_records', {})).toThrow(/searchId/i);
      expect(() => parseToolArgs('export_literature', { format: 'bibtex' })).toThrow(/searchId/i);
    });

    it('accepts a bounded citation graph request', () => {
      const args = parseToolArgs('expand_citation_graph', {
        seeds: ['10.1000/green.1'],
        directions: ['references', 'citing']
      });
      expect(args.limitPerSeed).toBe(50);
      expect(args.recordView).toBe('full');
    });
  });
});
