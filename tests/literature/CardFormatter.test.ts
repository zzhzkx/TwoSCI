import { describe, expect, it } from '@jest/globals';
import { CardFormatter } from '../../src/literature/CardFormatter.js';
import type { LiteratureRecord } from '../../src/literature/types.js';

describe('CardFormatter', () => {
  const sampleRecord: LiteratureRecord = {
    recordId: 'rec-001',
    title: 'High-Precision Beam Steering with Optical Phased Arrays',
    authors: ['Zhang, Wei', 'Liu, Kang', 'Wang, Jian'],
    year: 2026,
    venue: 'IEEE Journal of Lightwave Technology',
    volume: '44',
    issue: '2',
    pages: '100-108',
    abstract: 'We demonstrate an integrated optical phased array achieving micro-radian steering precision under atmospheric turbulence.',
    keywords: ['optical phased array', 'beam steering', 'laser communication'],
    categories: ['optics'],
    doi: '10.1109/jlt.2026.1234567',
    url: 'https://ieeexplore.ieee.org/document/1234567',
    pdfUrl: 'https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=1234567',
    openAccess: true,
    identifiers: {
      doi: '10.1109/jlt.2026.1234567',
      wosUid: 'WOS:000123456700001',
      scopusEid: '2-s2.0-8501234567'
    },
    sources: [
      { source: 'webofscience', sourceId: 'WOS:000123456700001', rank: 1, citedBy: 15 },
      { source: 'scopus', sourceId: '2-s2.0-8501234567', rank: 1, citedBy: 18 }
    ],
    citedBy: {
      webofscience: 15,
      scopus: 18,
      ieee: 12
    },
    references: []
  };

  it('formats metadata card without OA status and without metadata hit match lines', () => {
    const card = CardFormatter.formatRecord(sampleRecord, { scope: 'metadata', index: 1 });
    
    expect(card).toContain('### 📄 [Meta-01] High-Precision Beam Steering with Optical Phased Arrays');
    expect(card).toContain('**作者 (Authors)**: Zhang, Wei; Liu, Kang; Wang, Jian');
    expect(card).toContain('**出版期刊 (Venue)**: IEEE Journal of Lightwave Technology (2026)');
    expect(card).toContain('**标识符 (Identifiers)**: DOI: [10.1109/jlt.2026.1234567](https://doi.org/10.1109/jlt.2026.1234567)');
    expect(card).toContain('**被引频次 (Citations)**: WoS: 15 | Scopus: 18 | IEEE: 12');
    expect(card).toContain('**作者关键词 (Keywords)**: optical phased array; beam steering; laser communication');

    // 验证删去的内容
    expect(card).not.toContain('文献类型');
    expect(card).not.toContain('OA 状态');
    expect(card).not.toContain('元数据命中匹配');
  });

  it('formats abstract card with clickable direct link under 文献获取', () => {
    const card = CardFormatter.formatRecord(sampleRecord, { scope: 'abstract', index: 2 });

    expect(card).toContain('### 📄 [Abs-02] High-Precision Beam Steering with Optical Phased Arrays');
    expect(card).toContain('**基本信息**: IEEE Journal of Lightwave Technology · 2026 · Vol. 44 · No. 2 · [10.1109/jlt.2026.1234567](https://doi.org/10.1109/jlt.2026.1234567)');
    expect(card).toContain('**作者**: Zhang, Wei; Liu, Kang; Wang, Jian');
    expect(card).toContain('**引用统计**: WoS: 15 | Scopus: 18 | IEEE: 12');
    expect(card).toContain('**核心关键词**: optical phased array; beam steering; laser communication');
    expect(card).toContain('**摘要内容**:');
    expect(card).toContain('We demonstrate an integrated optical phased array achieving micro-radian steering precision');
    
    // 验证文献获取直接跳转链接
    expect(card).toContain('- **文献获取**: [https://doi.org/10.1109/jlt.2026.1234567](https://doi.org/10.1109/jlt.2026.1234567)');
    expect(card).not.toContain('获取通道速查');
  });

  it('formats fulltext card with concise Yes/No availability', () => {
    const cardYes = CardFormatter.formatRecord(sampleRecord, {
      scope: 'fulltext',
      index: 1,
      matchedKeywords: ['micro-radian', 'atmospheric turbulence'],
      evidenceSnippet: 'Measured pointing jitter is reduced to 0.85 urad.'
    });
    expect(cardYes).toContain('### 📄 [FullText-01] High-Precision Beam Steering with Optical Phased Arrays');
    expect(cardYes).toContain('**全文命中关键词**: "micro-radian", "atmospheric turbulence"');
    expect(cardYes).toContain('**关键证据摘录**:');
    expect(cardYes).toContain('Measured pointing jitter is reduced to 0.85 urad.');
    expect(cardYes).toContain('- **全文可获取**: Yes');
    expect(cardYes).not.toContain('全文资源就绪度');

    const recordNoOA: LiteratureRecord = {
      ...sampleRecord,
      doi: '10.9999/unknown.paywalled',
      openAccess: false,
      pdfUrl: ''
    };
    const cardNo = CardFormatter.formatRecord(recordNoOA, { scope: 'fulltext', index: 2 });
    expect(cardNo).toContain('- **全文可获取**: No');
  });
});
