import { describe, expect, it, jest } from '@jest/globals';
import { OpenAlexSearcher } from '../../src/platforms/OpenAlexSearcher.js';

function response(data: any) {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {},
    request: {}
  };
}

function work(id: string, overrides: Record<string, any> = {}) {
  return {
    id: `https://openalex.org/${id}`,
    title: `Paper ${id}`,
    doi: `https://doi.org/10.1000/${id.toLowerCase()}`,
    publication_date: '2024-03-01',
    cited_by_count: 9,
    authorships: [{ author: { display_name: 'Alice Chen' } }],
    abstract_inverted_index: {
      Green: [0],
      building: [1],
      metrics: [2]
    },
    referenced_works: ['https://openalex.org/W2', 'https://openalex.org/W3'],
    related_works: ['https://openalex.org/W4'],
    primary_location: {
      landing_page_url: 'https://example.test/paper',
      source: { display_name: 'Journal of Green Building' }
    },
    open_access: { is_oa: true, oa_status: 'gold' },
    best_oa_location: { pdf_url: 'https://example.test/paper.pdf' },
    ...overrides
  };
}

describe('OpenAlexSearcher', () => {
  it('reconstructs abstracts and normalizes OpenAlex works', async () => {
    const searcher = new OpenAlexSearcher();
    const client = (searcher as any).client;
    client.defaults.adapter = jest.fn(async () => response({
      meta: { next_cursor: null },
      results: [work('W1')]
    }));

    const papers = await searcher.search('green building', { maxResults: 1 });

    expect(papers).toHaveLength(1);
    expect(papers[0].abstract).toBe('Green building metrics');
    expect(papers[0].doi).toBe('10.1000/w1');
    expect(papers[0].extra?.openalexId).toBe('W1');
    expect(papers[0].extra?.isOa).toBe(true);
    expect(papers[0].references).toEqual(['W2', 'W3']);
  });

  it('resolves DOI seeds and one-hop references in batches', async () => {
    const searcher = new OpenAlexSearcher();
    const client = (searcher as any).client;
    client.defaults.adapter = jest.fn(async (config: any) => {
      if (config.params?.filter?.startsWith('doi:')) {
        return response({ results: [work('W1')] });
      }
      if (config.params?.filter?.startsWith('openalex_id:')) {
        return response({
          results: [
            work('W2', { referenced_works: [], related_works: [] }),
            work('W3', { referenced_works: [], related_works: [] })
          ]
        });
      }
      return response({ results: [] });
    });

    const references = await searcher.getReferences('10.1000/w1', { maxResults: 10 });

    expect(references.map(paper => paper.paperId)).toEqual(['W2', 'W3']);
    expect(client.defaults.adapter).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ filter: 'openalex_id:W2|W3' })
    }));
  });
});
