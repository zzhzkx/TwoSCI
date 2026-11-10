import { describe, expect, it } from '@jest/globals';
import { CitationTopologyService } from '../../src/literature/CitationTopologyService.js';
import type { LiteratureRecord } from '../../src/literature/types.js';

describe('CitationTopologyService', () => {
  const seedPaper: LiteratureRecord = {
    recordId: 'seed_01',
    title: '100 km Free-Space Optical Communication Using OPA',
    authors: ['Li, Meng', 'Guo, Jin'],
    year: 2025,
    doi: '10.1109/jlt.2025.3581583',
    venue: 'Journal of Lightwave Technology',
    url: '',
    pdfUrl: '',
    abstract: '100 km laser communication demonstrated.',
    keywords: ['OPA', 'FSO'],
    categories: [],
    openAccess: true,
    identifiers: { doi: '10.1109/jlt.2025.3581583' },
    sources: [],
    citedBy: { webofscience: 12 },
    references: []
  };

  const refPaper: LiteratureRecord = {
    recordId: 'ref_01',
    title: 'Optical Phased Array Technology',
    authors: ['McManamon, P. F.'],
    year: 2009,
    doi: '10.1109/jproc.2009.2017248',
    venue: 'Proc. IEEE',
    url: '',
    pdfUrl: '',
    abstract: 'Foundations of OPA beam steering.',
    keywords: ['phased array'],
    categories: [],
    openAccess: false,
    identifiers: { doi: '10.1109/jproc.2009.2017248' },
    sources: [],
    citedBy: { webofscience: 500 },
    references: []
  };

  const citingPaper: LiteratureRecord = {
    recordId: 'cite_01',
    title: 'Fractional-Order Disturbance Observer for Liquid Crystal OPA',
    authors: ['Liu, Xuelian', 'Wang, Chunyang'],
    year: 2026,
    doi: '10.1016/j.optlastec.2026.116502',
    venue: 'Optics and Laser Technology',
    url: '',
    pdfUrl: '',
    abstract: 'Advancing pointing robustness under dynamic disturbances.',
    keywords: ['DOB', 'LCOPA'],
    categories: [],
    openAccess: false,
    identifiers: { doi: '10.1016/j.optlastec.2026.116502' },
    sources: [],
    citedBy: { webofscience: 1 },
    references: []
  };

  it('generates topology result with Mermaid graph and evolutionary narrative', () => {
    const result = CitationTopologyService.buildTopology(seedPaper, [refPaper], [citingPaper]);

    expect(result.foundations.length).toBe(1);
    expect(result.evolutions.length).toBe(1);
    expect(result.mermaidGraph).toContain('```mermaid');
    expect(result.mermaidGraph).toContain('graph TD');
    expect(result.markdownReport).toContain('# 🕸️ 学术引文网络与演化拓扑追踪报告');
    expect(result.markdownReport).toContain('向前溯源：参考文献拓扑脉络');
    expect(result.markdownReport).toContain('向后追踪：施引文献演进脉络');
    expect(result.markdownReport).toContain('Optical Phased Array Technology');
    expect(result.markdownReport).toContain('Fractional-Order Disturbance Observer for Liquid Crystal OPA');
    expect(result.markdownReport).not.toContain('物理与数学模型基石');
    expect(result.markdownReport).not.toContain('技术演进突破');
  });
});
