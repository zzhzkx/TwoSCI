import { describe, expect, it } from '@jest/globals';
import { detectLightpandaRuntime, extractPdfUrls } from '../../src/literature/LightpandaBrowser.js';

describe('LightpandaBrowser', () => {
  it('extracts PDF links from metadata, anchors and iframes', () => {
    const urls = extractPdfUrls([
      'https://example.com/article/pdf',
      '/download/paper.pdf?token=1',
      'https://example.com/article/pdfft?md5=abc',
      'https://example.com/about',
      'javascript:void(0)'
    ], 'https://example.com/article');

    expect(urls).toContain('https://example.com/article/pdf');
    expect(urls).toContain('https://example.com/download/paper.pdf?token=1');
    expect(urls).toContain('https://example.com/article/pdfft?md5=abc');
    expect(urls).not.toContain('https://example.com/about');
    expect(urls.some(url => url.startsWith('javascript:'))).toBe(false);
  });

  it('deduplicates and caps extracted PDF links', () => {
    const repeated = Array.from({ length: 20 }, () => '/paper.pdf');
    const urls = extractPdfUrls(repeated, 'https://example.com');
    expect(urls).toHaveLength(1);
  });

  it('prefers an explicitly configured CDP endpoint', () => {
    const saved = process.env.LIGHTPANDA_CDP_URL;
    process.env.LIGHTPANDA_CDP_URL = 'ws://127.0.0.1:9333';
    try {
      const runtime = detectLightpandaRuntime();
      expect(runtime?.kind).toBe('cdp');
      expect(runtime?.description).toContain('9333');
    } finally {
      if (saved === undefined) delete process.env.LIGHTPANDA_CDP_URL;
      else process.env.LIGHTPANDA_CDP_URL = saved;
    }
  });
});
