import { describe, expect, it, jest } from '@jest/globals';
import { IEEEXploreSearcher } from '../../src/platforms/IEEEXploreSearcher.js';

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

function article(overrides: Record<string, any> = {}) {
  return {
    article_number: '11012345',
    title: 'Optical Phased Arrays for Space Lasers',
    abstract: 'A study of optical phased array calibration and beam steering.',
    doi: '10.1109/JLT.2025.3581583',
    authors: {
      authors: [
        { full_name: 'Second Author', author_order: 2, affiliation: 'Lab B' },
        { full_name: 'First Author', author_order: 1, affiliation: 'Lab A' }
      ]
    },
    author_terms: ['optical phased array', 'beam steering'],
    ieee_terms: ['Phased arrays', 'Optical beams'],
    publication_title: 'Journal of Lightwave Technology',
    publication_year: 2025,
    publication_date: '2025-06-15',
    volume: '43',
    issue: '12',
    start_page: '5001',
    end_page: '5010',
    content_type: 'Journals',
    access_type: 'Locked',
    is_open_access: false,
    citing_paper_count: 7,
    citing_patent_count: 2,
    pdf_url: 'https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=11012345',
    html_url: 'https://ieeexplore.ieee.org/document/11012345',
    ...overrides
  };
}

describe('IEEEXploreSearcher', () => {
  it('maps IEEE records and forwards documented search filters', async () => {
    const searcher = new IEEEXploreSearcher('test-ieee-key');
    const client = (searcher as any).client;
    const adapter = jest.fn(async () => response({
      total_records: 1,
      total_searched: 6000000,
      articles: [article()]
    }));
    client.defaults.adapter = adapter;

    const papers = await searcher.search('optical phased array', {
      maxResults: 500,
      year: '2020-2025',
      author: 'Zhang',
      journal: 'Journal of Lightwave Technology',
      openAccess: false,
      contentType: 'Journals'
    });

    expect(papers).toHaveLength(1);
    expect(papers[0]).toEqual(expect.objectContaining({
      paperId: '11012345',
      title: 'Optical Phased Arrays for Space Lasers',
      source: 'ieee',
      doi: '10.1109/JLT.2025.3581583',
      journal: 'Journal of Lightwave Technology',
      volume: '43',
      issue: '12',
      pages: '5001-5010',
      year: 2025,
      citationCount: 7
    }));
    expect(papers[0].authors).toEqual(['First Author', 'Second Author']);
    expect(papers[0].keywords).toContain('beam steering');
    expect(papers[0].extra?.isOa).toBe(false);

    expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        querytext: 'optical phased array',
        max_records: 200,
        start_record: 1,
        format: 'json',
        start_year: 2020,
        end_year: 2025,
        author: 'Zhang',
        publication_title: 'Journal of Lightwave Technology',
        open_access: false,
        content_type: 'Journals'
      })
    }));
    expect(((adapter.mock.calls as any)[0][0] as any).params.apikey).toEqual(expect.any(String));
  });

  it('uses the documented DOI query for seed resolution', async () => {
    const searcher = new IEEEXploreSearcher('test-ieee-key');
    const client = (searcher as any).client;
    const adapter = jest.fn(async () => response({ articles: [article()] }));
    client.defaults.adapter = adapter;

    const paper = await searcher.getPaperByDoi('doi:10.1109/JLT.2025.3581583');

    expect(paper?.paperId).toBe('11012345');
    expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ doi: '10.1109/JLT.2025.3581583' })
    }));
  });

  it('reports an inactive IEEE application without retrying', async () => {
    const searcher = new IEEEXploreSearcher('test-ieee-key');
    const client = (searcher as any).client;
    const adapter = jest.fn(async () => {
      throw Object.assign(new Error('Request failed with status code 403'), {
        response: {
          status: 403,
          headers: {
            'x-mashery-error-code': 'ERR_403_DEVELOPER_INACTIVE',
            'x-error-detail-header': 'Account Inactive'
          },
          data: '<h1>Developer Inactive</h1>'
        }
      });
    });
    client.defaults.adapter = adapter;

    await expect(searcher.search('test')).rejects.toThrow(/inactive/i);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('requires a configured key', async () => {
    const original = process.env.IEEE_XPLORE_API_KEY;
    const originalAlias = process.env.IEEE_API_KEY;
    delete process.env.IEEE_XPLORE_API_KEY;
    delete process.env.IEEE_API_KEY;
    try {
      const searcher = new IEEEXploreSearcher();
      await expect(searcher.search('test')).rejects.toThrow(/API key is required/i);
    } finally {
      if (original !== undefined) process.env.IEEE_XPLORE_API_KEY = original;
      if (originalAlias !== undefined) process.env.IEEE_API_KEY = originalAlias;
    }
  });
});
