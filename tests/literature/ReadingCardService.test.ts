import { describe, expect, it } from '@jest/globals';
import { ReadingCardService } from '../../src/literature/ReadingCardService.js';
import { FullTextRouter } from '../../src/literature/FullTextRouter.js';
import type { LiteratureRecord, ResearchBrief } from '../../src/literature/types.js';

function sampleRecord(): LiteratureRecord {
  return {
    recordId: 'rec_002',
    title: 'Hybrid Algorithm for Initial Phase Calibration of Silicon Optical Phased Arrays',
    authors: ['Ye, Gu', 'Shuai, Chang'],
    year: 2026,
    venue: 'Acta Optica Sinica',
    abstract: 'Abstract content about phase calibration.',
    keywords: ['Optical phased array', 'Phase calibration'],
    categories: ['Engineering'],
    doi: '10.3788/aos260908',
    url: 'https://doi.org/10.3788/aos260908',
    pdfUrl: '',
    openAccess: false,
    identifiers: { doi: '10.3788/aos260908' },
    sources: [{ source: 'webofscience', sourceId: 'WOS:001', rank: 1 }],
    citedBy: {},
    references: [],
    extra: {}
  };
}

describe('ReadingCardService', () => {
  it('generates a structured reading card template with 6 core sections and MinerU prompt', () => {
    const record = sampleRecord();
    const route = FullTextRouter.resolveRoute(record);
    const screening = {
      verdict: 'include',
      reason: 'Directly validates phase calibration convergence speedup by 2.15x'
    };
    const brief: ResearchBrief = {
      briefId: 'brf_001',
      createdAt: '2026-11-05T00:00:00.000Z',
      intent: 'Investigate fast phase calibration for space laser communications',
      focus: ['calibration', 'beam steering'],
      scope: {},
      seed: record,
      seedProfile: {
        keywords: [],
        concepts: [],
        frequentTerms: [],
        referenceCount: 30,
        citingCount: 2,
        topReferences: [],
        topCiting: []
      },
      warnings: []
    };

    const card = ReadingCardService.generateSingleCard(record, 1, route, screening, brief);

    expect(card.title).toBe(record.title);
    expect(card.screeningVerdict).toBe('include');
    expect(card.markdownTemplate).toContain('【文献精读卡 #1】');
    expect(card.markdownTemplate).toContain('一、文献基本信息与获取路径');
    expect(card.markdownTemplate).toContain('二、与本研究课题的关联度 (Relevance)');
    expect(card.markdownTemplate).toContain('三、核心方案与数学/算法推导 (Methodology & Algorithms)');
    expect(card.markdownTemplate).toContain('四、实验验证与量化性能指标对比表 (Quantitative Benchmark)');
    expect(card.markdownTemplate).toContain('五、实验设置与环境约束 (Experimental Setup & Constraints)');
    expect(card.markdownTemplate).toContain('六、局限性与未来研究切入点 (Limitations & Research Gaps)');
    expect(card.markdownTemplate).toContain('Directly validates phase calibration');

    expect(card.mineruPrompt).toContain('请作为【calibration / beam steering】领域的严谨科研评审专家');
    expect(card.mineruPrompt).toContain('基于 MinerU 提取自论文');
    expect(card.mineruPrompt).toContain(record.title);
  });

  it('generates a combined reading packet across multiple records', () => {
    const record = sampleRecord();
    const packet = ReadingCardService.generatePacket([record]);

    expect(packet.totalCards).toBe(1);
    expect(packet.cards).toHaveLength(1);
    expect(packet.combinedMarkdown).toContain('# TwoSCI 文献精读证据包');
    expect(packet.combinedMarkdown).toContain('【文献精读卡 #1】');
  });
});
