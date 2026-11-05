import { describe, expect, it } from '@jest/globals';
import { FullTextRouter } from '../../src/literature/FullTextRouter.js';
import type { LiteratureRecord } from '../../src/literature/types.js';

function sampleRecord(overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    recordId: 'rec_001',
    title: 'Test Paper Title',
    authors: ['Alice', 'Bob'],
    year: 2025,
    venue: 'Journal of Testing',
    abstract: '',
    keywords: [],
    categories: [],
    doi: '10.1016/j.optlastec.2026.116502',
    url: 'https://doi.org/10.1016/j.optlastec.2026.116502',
    pdfUrl: '',
    openAccess: false,
    identifiers: {},
    sources: [],
    citedBy: {},
    references: [],
    extra: {},
    ...overrides
  };
}

describe('FullTextRouter', () => {
  it('routes 10.1016 to Elsevier API channel and identifies API endpoint', () => {
    const record = sampleRecord({ doi: '10.1016/j.optlastec.2026.116502' });
    const route = FullTextRouter.resolveRoute(record);

    expect(route.channel).toBe('elsevier_api');
    expect(route.publisher).toContain('Elsevier');
    expect(route.channelDetails.doiPrefix).toBe('10.1016');
    expect(route.channelDetails.scansciCommand).toContain('scansci-pdf get 10.1016/j.optlastec.2026.116502');
  });

  it('constructs direct MDPI CDN link for 10.3390 papers', () => {
    const record = sampleRecord({
      doi: '10.3390/s24010123',
      openAccess: true
    });
    const route = FullTextRouter.resolveRoute(record);

    expect(route.channel).toBe('mdpi_cdn');
    expect(route.isDirectDownloadable).toBe(true);
    expect(route.accessStatus).toBe('direct_pdf_ready');
    expect(route.bestPdfUrl).toBe('https://www.mdpi.com/10.3390/s24010123/pdf');
  });

  it('constructs direct PLOS printable file link for 10.1371 papers', () => {
    const record = sampleRecord({
      doi: '10.1371/journal.pone.0123456',
      openAccess: true
    });
    const route = FullTextRouter.resolveRoute(record);

    expect(route.channel).toBe('plos_oa');
    expect(route.isDirectDownloadable).toBe(true);
    expect(route.bestPdfUrl).toContain('type=printable');
  });

  it('routes arXiv identifiers directly to arxiv.org PDF endpoint', () => {
    const record = sampleRecord({
      doi: '',
      identifiers: { arxiv: '2401.12345' },
      url: 'https://arxiv.org/abs/2401.12345'
    });
    const route = FullTextRouter.resolveRoute(record);

    expect(route.channel).toBe('arxiv');
    expect(route.isDirectDownloadable).toBe(true);
    expect(route.bestPdfUrl).toBe('https://arxiv.org/pdf/2401.12345.pdf');
  });

  it('routes IEEE 10.1109 papers and captures article number for stamp URL', () => {
    const record = sampleRecord({
      doi: '10.1109/JLT.2025.3581583',
      sources: [{ source: 'ieee', sourceId: '10500123', rank: 1 }],
      openAccess: true
    });
    const route = FullTextRouter.resolveRoute(record);

    expect(route.channel).toBe('ieee_xplore');
    expect(route.publisher).toBe('IEEE');
    expect(route.bestPdfUrl).toContain('arnumber=10500123');
  });

  it('aggregates batch statistics across multiple records', () => {
    const records = [
      sampleRecord({ doi: '10.3390/s24010123', openAccess: true }),
      sampleRecord({ doi: '10.1016/j.future.2025.01.001' }),
      sampleRecord({ doi: '10.1088/1361-6463/ac0001' })
    ];
    const result = FullTextRouter.resolveBatch(records);

    expect(result.totalRecords).toBe(3);
    expect(result.directPdfCount).toBeGreaterThanOrEqual(1);
    expect(result.routes).toHaveLength(3);
  });
});
