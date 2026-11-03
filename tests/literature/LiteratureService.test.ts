import { describe, expect, it, jest } from '@jest/globals';
import { PaperFactory } from '../../src/models/Paper.js';
import { LiteratureService } from '../../src/literature/LiteratureService.js';
import { ResearchStore } from '../../src/literature/ResearchStore.js';

function paper(overrides: Record<string, any> = {}) {
  return PaperFactory.create({
    paperId: 'WOS:0001',
    title: 'Embodied carbon metrics for green buildings',
    authors: ['Alice Chen'],
    abstract: 'This paper studies embodied carbon indicators for green buildings.',
    doi: '10.1000/green.1',
    publishedDate: new Date('2024-01-01T00:00:00.000Z'),
    pdfUrl: '',
    url: 'https://doi.org/10.1000/green.1',
    source: 'webofscience',
    year: 2024,
    journal: 'Journal of Green Building',
    citationCount: 12,
    keywords: ['embodied carbon', 'green building'],
    extra: { uid: 'WOS:0001', recordView: 'full' },
    ...overrides
  });
}

function makeSearchers() {
  const wosPaper = paper();
  const scopusPaper = paper({
    paperId: '2-s2.0-1',
    source: 'scopus',
    citationCount: 14,
    abstract: 'Scopus abstract with additional detail.',
    extra: { eid: '2-s2.0-1' }
  });
  const openAlexPaper = paper({
    paperId: 'W1',
    source: 'openalex',
    doi: '10.1000/green.1',
    citationCount: 20,
    extra: { openalexId: 'W1', isOa: true }
  });
  const crossrefPaper = paper({
    paperId: '10.1000/green.1',
    source: 'crossref',
    citationCount: 8,
    extra: {}
  });
  const reference = {
    uid: 'WOS:REF1',
    doi: '10.1000/ref.1',
    citedAuthor: 'Bob Lee',
    citedTitle: 'A foundational carbon metric study',
    citedWork: 'Building Research',
    year: 2018,
    timesCited: 44
  };
  const citing = paper({
    paperId: 'WOS:CITE1',
    doi: '10.1000/cite.1',
    title: 'Follow-up study on building carbon indicators',
    citationCount: 5,
    extra: { uid: 'WOS:CITE1' }
  });

  return {
    webofscience: {
      hasApiKey: () => true,
      getDefaultProduct: () => 'expanded',
      search: jest.fn(async () => [wosPaper]),
      getPaperByDoi: jest.fn(async () => wosPaper),
      getRecordByUid: jest.fn(async () => wosPaper),
      getRelatedRecords: jest.fn(async (_uid: string, relation: string) => ({
        items: relation === 'references' ? [reference] : [citing],
        queryResult: {}
      }))
    },
    scopus: {
      hasApiKey: () => true,
      search: jest.fn(async () => [scopusPaper]),
      getPaperByDoi: jest.fn(async () => scopusPaper),
      getAbstract: jest.fn(async () => scopusPaper)
    },
    openalex: {
      search: jest.fn(async () => [openAlexPaper]),
      getPaperByDoi: jest.fn(async () => openAlexPaper),
      getPaperById: jest.fn(async () => openAlexPaper),
      getReferences: jest.fn(async () => [openAlexPaper]),
      getCiting: jest.fn(async () => [openAlexPaper]),
      getRelated: jest.fn(async () => [openAlexPaper])
    },
    crossref: {
      search: jest.fn(async () => [crossrefPaper]),
      getPaperByDoi: jest.fn(async () => crossrefPaper),
      getReferences: jest.fn(async () => [crossrefPaper]),
      getCitations: jest.fn(async () => [crossrefPaper])
    }
  };
}

describe('LiteratureService', () => {
  it('builds a brief from a DOI and uses the seed citation context', async () => {
    const searchers = makeSearchers();
    const service = new LiteratureService(() => searchers as any, new ResearchStore());

    const brief = await service.createBrief({
      seed: { doi: 'https://doi.org/10.1000/green.1' },
      intent: 'Find indicators and policy evaluation studies in this field',
      focus: ['metrics', 'policy']
    });

    expect(brief.briefId).toMatch(/^brf_/);
    expect(brief.seed.doi).toBe('10.1000/green.1');
    expect(brief.seed.sources.length).toBeGreaterThan(1);
    expect(brief.seedProfile.referenceCount).toBe(1);
    expect(brief.seedProfile.citingCount).toBe(1);
    expect(brief.seedProfile.keywords).toContain('embodied carbon');
    expect(searchers.webofscience.getPaperByDoi).toHaveBeenCalled();
    expect(searchers.webofscience.getRelatedRecords).toHaveBeenCalledWith(
      'WOS:0001',
      'references',
      expect.objectContaining({ maxResults: 50 })
    );
  });

  it('deduplicates a multi-source search and preserves per-source citation counts', async () => {
    const searchers = makeSearchers();
    const service = new LiteratureService(() => searchers as any, new ResearchStore());

    const result = await service.search({
      query: 'embodied carbon green building indicator',
      mode: 'quick',
      layer: 'abstract'
    });

    expect(result.search.searchId).toMatch(/^srch_/);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toEqual(expect.objectContaining({
      title: 'Embodied carbon metrics for green buildings',
      cited_by: expect.objectContaining({
        webofscience: 12,
        scopus: 14,
        openalex: 20
      })
    }));
    expect(result.search.sourceRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'webofscience', status: 'ok' }),
      expect.objectContaining({ source: 'scopus', status: 'ok' }),
      expect.objectContaining({ source: 'openalex', status: 'ok' })
    ]));
  });

  it('persists screening decisions and exports only the selected records', async () => {
    const searchers = makeSearchers();
    const service = new LiteratureService(() => searchers as any, new ResearchStore());
    const result = await service.search({
      query: 'embodied carbon',
      mode: 'quick',
      layer: 'abstract'
    });
    const recordId = result.search.records[0].recordId;

    const screening = service.saveScreening({
      searchId: result.search.searchId,
      decisions: [{
        recordId,
        verdict: 'include',
        reason: 'Directly reports the target indicators',
        confidence: 0.9
      }]
    });
    expect(screening.counts.include).toBe(1);

    const exported = service.export({
      searchId: result.search.searchId,
      recordIds: [recordId],
      format: 'bibtex'
    });
    expect(exported.content).toContain('@article');
    expect(exported.content).toContain('10.1000/green.1');
  });

  it('expands a stored seed through WoS and returns graph edges', async () => {
    const searchers = makeSearchers();
    const service = new LiteratureService(() => searchers as any, new ResearchStore());
    const result = await service.search({
      query: 'embodied carbon',
      mode: 'quick',
      layer: 'abstract'
    });
    const seedId = result.search.records[0].recordId;

    const graph = await service.expand({
      searchId: result.search.searchId,
      seeds: [seedId],
      directions: ['references', 'citing'],
      limitPerSeed: 10
    });

    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'references', source: 'webofscience' }),
      expect.objectContaining({ relation: 'citing', source: 'webofscience' })
    ]));
    expect(graph.search.searchId).toMatch(/^srch_/);
  });

  it('expands a brief seed record_id without requiring a search session', async () => {
    const searchers = makeSearchers();
    const service = new LiteratureService(() => searchers as any, new ResearchStore());
    const brief = await service.createBrief({
      seed: { doi: '10.1000/green.1' },
      intent: 'Map the field around this seed',
      includeCitationContext: false
    });

    const graph = await service.expand({
      seeds: [brief.seed.recordId],
      directions: ['citing'],
      limitPerSeed: 5
    });

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'citing', source: 'webofscience' })
    ]));
  });

  it('optionally hydrates references for selected records', async () => {
    const searchers = makeSearchers();
    const service = new LiteratureService(() => searchers as any, new ResearchStore());
    const result = await service.search({
      query: 'embodied carbon',
      mode: 'quick',
      layer: 'abstract'
    });

    const hydrated = await service.hydrate({
      searchId: result.search.searchId,
      recordIds: [result.search.records[0].recordId],
      fetchReferences: true
    });

    expect(hydrated[0].references).toContain('10.1000/ref.1');
  });
});
