import { describe, expect, it } from '@jest/globals';
import { PaperFactory } from '../../src/models/Paper.js';
import {
  applyReciprocalRankFusion,
  dedupeRecords,
  recordFromPaper
} from '../../src/literature/normalize.js';

function paper(overrides: Record<string, any> = {}) {
  return PaperFactory.create({
    paperId: 'WOS:0001',
    title: 'Embodied carbon metrics for green buildings',
    authors: ['Alice Chen'],
    abstract: 'A short abstract.',
    doi: '10.1000/green.1',
    publishedDate: new Date('2024-01-01T00:00:00.000Z'),
    pdfUrl: '',
    url: 'https://example.test/paper',
    source: 'webofscience',
    year: 2024,
    journal: 'Journal of Green Building',
    citationCount: 12,
    extra: { uid: 'WOS:0001', recordView: 'full' },
    ...overrides
  });
}

describe('literature normalization', () => {
  it('merges the same DOI across sources and keeps citation counts separate', () => {
    const wos = recordFromPaper(paper(), 'webofscience', 1);
    const scopus = recordFromPaper(paper({
      paperId: '2-s2.0-1',
      source: 'scopus',
      abstract: 'A longer Scopus abstract with metrics.',
      citationCount: 15,
      extra: { eid: '2-s2.0-1' }
    }), 'scopus', 2);
    const merged = dedupeRecords([wos, scopus]);

    expect(merged).toHaveLength(1);
    expect(merged[0].sources.map(source => source.source)).toEqual(expect.arrayContaining([
      'webofscience',
      'scopus'
    ]));
    expect(merged[0].citedBy).toEqual(expect.objectContaining({
      webofscience: 12,
      scopus: 15
    }));
    expect(merged[0].abstract).toBe('A short abstract.');
  });

  it('does not merge records with conflicting DOIs', () => {
    const left = recordFromPaper(paper(), 'webofscience', 1);
    const right = recordFromPaper(paper({
      paperId: 'WOS:0002',
      doi: '10.1000/green.2',
      extra: { uid: 'WOS:0002' }
    }), 'webofscience', 2);

    expect(dedupeRecords([left, right])).toHaveLength(2);
  });

  it('treats DOI case variants as the same work', () => {
    const upper = recordFromPaper(paper({
      doi: '10.1109/JLT.2025.3581583',
      title: 'Upper DOI record'
    }), 'webofscience', 1);
    const lower = recordFromPaper(paper({
      paperId: 'W4386122897',
      source: 'openalex',
      doi: '10.1109/jlt.2025.3581583',
      title: 'Lower DOI record',
      extra: { openalexId: 'W4386122897' }
    }), 'openalex', 1);

    const merged = dedupeRecords([upper, lower]);
    expect(merged).toHaveLength(1);
    expect(merged[0].doi).toBe('10.1109/jlt.2025.3581583');
  });

  it('merges DOI-less records by a conservative title and year match', () => {
    const left = recordFromPaper(paper({
      paperId: 'WOS:0001',
      doi: '',
      extra: { uid: 'WOS:0001' }
    }), 'webofscience', 1);
    const right = recordFromPaper(paper({
      paperId: 'W1',
      doi: '',
      source: 'openalex',
      title: 'Embodied carbon metrics for green buildings',
      year: 2024,
      extra: { openalexId: 'W1' }
    }), 'openalex', 1);

    expect(dedupeRecords([left, right])).toHaveLength(1);
  });

  it('uses reciprocal rank fusion across source ranks', () => {
    const left = recordFromPaper(paper(), 'webofscience', 1);
    const right = recordFromPaper(paper({
      paperId: 'WOS:0002',
      doi: '10.1000/other',
      title: 'A different paper',
      citationCount: 1,
      extra: { uid: 'WOS:0002' }
    }), 'webofscience', 2);
    const scored = applyReciprocalRankFusion([left, right]);

    expect(scored[0].score).toBeGreaterThan(scored[1].score!);
  });
});
