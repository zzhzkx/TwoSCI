import { describe, expect, it } from '@jest/globals';
import { parseToolArgs } from '../../src/mcp/schemas.js';

describe('Modular MCP Tools Schemas and Parsing', () => {
  it('parses search_academic with default search_scope abstract', () => {
    const parsed = parseToolArgs('search_academic', {
      query: 'optical phased array'
    });
    expect(parsed.query).toBe('optical phased array');
    expect(parsed.search_scope).toBe('abstract');
    expect(parsed.platform).toBe('all');
    expect(parsed.maxResults).toBe(10);
  });

  it('parses search_academic with metadata and fulltext scopes', () => {
    const metaParsed = parseToolArgs('search_academic', {
      query: 'silicon photonics',
      search_scope: 'metadata',
      platform: 'wos'
    });
    expect(metaParsed.search_scope).toBe('metadata');
    expect(metaParsed.platform).toBe('wos');

    const fullParsed = parseToolArgs('search_academic', {
      query: 'deep learning beamforming',
      search_scope: 'fulltext'
    });
    expect(fullParsed.search_scope).toBe('fulltext');
  });

  it('parses search_intent_literature requiring briefId', () => {
    const parsed = parseToolArgs('search_intent_literature', {
      query: 'phase drift compensation',
      briefId: 'brief_sample_01',
      search_scope: 'fulltext'
    });
    expect(parsed.query).toBe('phase drift compensation');
    expect(parsed.briefId).toBe('brief_sample_01');
    expect(parsed.search_scope).toBe('fulltext');
  });

  it('parses download_and_parse_mineru with single or batch DOIs', () => {
    const single = parseToolArgs('download_and_parse_mineru', {
      doi: '10.1016/j.optlastec.2026.116502'
    });
    expect(single.doi).toBe('10.1016/j.optlastec.2026.116502');

    const batch = parseToolArgs('download_and_parse_mineru', {
      dois: ['10.1016/j.optlastec.2026.116502', '10.3788/aos260908']
    });
    expect(batch.dois?.length).toBe(2);
  });

  it('parses trace_citation_topology with seed and limit', () => {
    const parsed = parseToolArgs('trace_citation_topology', {
      seed: '10.1109/jlt.2025.3581583',
      limit: 15
    });
    expect(parsed.seed).toBe('10.1109/jlt.2025.3581583');
    expect(parsed.limit).toBe(15);
  });

  it('parses build_academic_library with searchId and default include verdict', () => {
    const parsed = parseToolArgs('build_academic_library', {
      searchId: 'search_999'
    });
    expect(parsed.searchId).toBe('search_999');
    expect(parsed.verdict).toBe('include');
  });
});
