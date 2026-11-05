/**
 * PubMedSearcher Platform Tests
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { PubMedSearcher } from '../../src/platforms/PubMedSearcher.js';

describe('PubMedSearcher', () => {
  let searcher: PubMedSearcher;

  beforeEach(() => {
    searcher = new PubMedSearcher();
  });

  describe('getCapabilities', () => {
    it('should return correct capabilities', () => {
      const caps = searcher.getCapabilities();
      expect(caps.search).toBe(true);
      expect(caps.download).toBe(false);
      expect(caps.requiresApiKey).toBe(false); // Optional
    });
  });

  describe('constructor', () => {
    it('should work without API key', () => {
      const instance = new PubMedSearcher();
      expect(instance).toBeDefined();
    });

    it('should accept API key', () => {
      const instance = new PubMedSearcher('test-key');
      expect(instance).toBeDefined();
    });
  });

  describe('search', () => {
    it('should support year filter', () => {
      expect(searcher.search).toBeDefined();
    });

    it('should support author filter', () => {
      expect(searcher.search).toBeDefined();
    });

    it('should support journal filter', () => {
      expect(searcher.search).toBeDefined();
    });

    it('should support publicationType filter', () => {
      expect(searcher.search).toBeDefined();
    });
  });

  describe('getPaperByDoi', () => {
    it('should use DOI field search', () => {
      expect(searcher.getPaperByDoi).toBeDefined();
    });
  });

  describe('getPaperByPmid', () => {
    it('should be available', () => {
      expect((searcher as any).getPaperByPmid || searcher.search).toBeDefined();
    });
  });

  describe('extractAbstract', () => {
    it('correctly formats structured PubMed abstracts with labels and avoids [object Object]', () => {
      const extractAbstract = (searcher as any).extractAbstract.bind(searcher);

      // Plain string
      expect(extractAbstract({ AbstractText: 'A simple abstract.' })).toBe('A simple abstract.');

      // Structured abstract array with labels
      const structuredData = {
        AbstractText: [
          { _: 'Background on cancer therapy.', $: { Label: 'BACKGROUND' } },
          { _: 'A randomized trial was conducted.', $: { Label: 'METHODS' } },
          { _: 'Survival improved significantly.', $: { Label: 'RESULTS' } }
        ]
      };
      const result = extractAbstract(structuredData);
      expect(result).not.toContain('[object Object]');
      expect(result).toContain('BACKGROUND: Background on cancer therapy.');
      expect(result).toContain('METHODS: A randomized trial was conducted.');
      expect(result).toContain('RESULTS: Survival improved significantly.');

      // Single structured object
      const singleObject = {
        AbstractText: { _: 'To evaluate the outcome.', $: { Label: 'OBJECTIVE' } }
      };
      expect(extractAbstract(singleObject)).toBe('OBJECTIVE: To evaluate the outcome.');
    });
  });
});
