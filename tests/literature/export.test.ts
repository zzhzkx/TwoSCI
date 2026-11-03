import { describe, expect, it } from '@jest/globals';
import { exportRecords } from '../../src/literature/export.js';
import type { LiteratureRecord, ScreeningDecision, ResearchBrief } from '../../src/literature/types.js';

function sampleRecord(overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    recordId: 'lit_test01',
    title: 'Phase calibration of optical phased array with genetic algorithms',
    authors: ['Zhang, Wei', 'Li, Ming'],
    year: 2024,
    venue: 'Journal of Lightwave Technology',
    volume: '42',
    issue: '4',
    pages: '120-130',
    abstract: 'This paper proposes a fast calibration algorithm for large-scale optical phased arrays in free-space communication.',
    keywords: ['Optical phased array', 'Calibration', 'Genetic algorithm'],
    categories: ['Engineering'],
    doi: '10.1109/JLT.2024.1234567',
    url: 'https://doi.org/10.1109/JLT.2024.1234567',
    pdfUrl: 'https://example.com/paper.pdf',
    openAccess: true,
    identifiers: {
      doi: '10.1109/JLT.2024.1234567',
      wosUid: 'WOS:00099999'
    },
    sources: [
      { source: 'webofscience', sourceId: 'WOS:00099999', rank: 1, citedBy: 16 },
      { source: 'ieee', sourceId: '1001234', rank: 1, citedBy: 14 }
    ],
    citedBy: {
      webofscience: 16,
      ieee: 14
    },
    references: ['10.1109/REF.1', '10.1109/REF.2'],
    extra: {},
    ...overrides
  };
}

describe('exportRecords', () => {
  it('exports records to Markdown with overview table and detailed evidence cards', () => {
    const record = sampleRecord();
    const screening: Record<string, ScreeningDecision> = {
      [record.recordId]: {
        recordId: record.recordId,
        verdict: 'include',
        reason: 'Directly validates fast calibration methodology for space lasers',
        tags: ['calibration', 'space-comm'],
        confidence: 0.95,
        decidedAt: '2026-11-03T08:00:00.000Z'
      }
    };

    const md = exportRecords([record], 'markdown', {
      includeAbstract: true,
      context: {
        query: 'optical phased array calibration',
        screening
      }
    });

    expect(md).toContain('# TwoSCI 文献研究与筛选报告');
    expect(md).toContain('optical phased array calibration');
    expect(md).toContain('## 一、文献一览表 (Overview Table)');
    expect(md).toContain('| 1 | Phase calibration of optical phased array with genetic algorithms | 2024 |');
    expect(md).toContain('✅ 纳入 (Include)');
    expect(md).toContain('## 二、文献详细证据卡片 (Detailed Records)');
    expect(md).toContain('### [1] Phase calibration of optical phased array with genetic algorithms');
    expect(md).toContain('Zhang, Wei, Li, Ming');
    expect(md).toContain('Directly validates fast calibration methodology for space lasers');
    expect(md).toContain('calibration, space-comm');
    expect(md).toContain('This paper proposes a fast calibration algorithm');
    expect(md).toContain('WoS: 16, IEEE Xplore: 14');
  });

  it('exports records to JSON with embedded screening decisions', () => {
    const record = sampleRecord();
    const screening: Record<string, ScreeningDecision> = {
      [record.recordId]: {
        recordId: record.recordId,
        verdict: 'maybe',
        reason: 'Simulation only, lacks experimental validation',
        tags: ['simulation'],
        confidence: 0.6,
        decidedAt: '2026-11-03T08:30:00.000Z'
      }
    };

    const jsonStr = exportRecords([record], 'json', {
      includeAbstract: true,
      context: { screening }
    });

    const parsed = JSON.parse(jsonStr);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].record_id).toBe('lit_test01');
    expect(parsed[0].title).toBe(record.title);
    expect(parsed[0].screening).toEqual({
      verdict: 'maybe',
      reason: 'Simulation only, lacks experimental validation',
      tags: ['simulation'],
      confidence: 0.6,
      decided_at: '2026-11-03T08:30:00.000Z'
    });
    expect(parsed[0].abstract).toBe(record.abstract);
  });

  it('respects includeAbstract: false across Markdown and JSON', () => {
    const record = sampleRecord();
    const md = exportRecords([record], 'markdown', { includeAbstract: false });
    expect(md).not.toContain('This paper proposes a fast calibration algorithm');

    const jsonStr = exportRecords([record], 'json', { includeAbstract: false });
    const parsed = JSON.parse(jsonStr);
    expect(parsed[0].abstract).toBeUndefined();
  });

  it('includes seed paper and intent when exporting with ResearchBrief context', () => {
    const seed = sampleRecord({
      title: 'Baseline Space OPA Study',
      doi: '10.1109/JLT.2025.3581583'
    });
    const brief: ResearchBrief = {
      briefId: 'brief_123',
      createdAt: '2026-11-03T07:00:00.000Z',
      intent: 'Investigate real-time phase calibration and beam steering performance',
      focus: ['calibration', 'metrics'],
      scope: { years: '2020-2026' },
      seed,
      seedProfile: {
        keywords: ['OPA'],
        concepts: ['Optical communication'],
        frequentTerms: [],
        referenceCount: 30,
        citingCount: 5,
        topReferences: [],
        topCiting: []
      },
      warnings: []
    };

    const md = exportRecords([seed], 'markdown', {
      context: { brief }
    });

    expect(md).toContain('Investigate real-time phase calibration and beam steering performance');
    expect(md).toContain('Baseline Space OPA Study');
    expect(md).toContain('10.1109/JLT.2025.3581583');
    expect(md).toContain('calibration, metrics');
  });
});
