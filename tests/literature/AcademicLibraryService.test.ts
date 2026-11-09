import { describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AcademicLibraryService } from '../../src/literature/AcademicLibraryService.js';
import type { LiteratureRecord } from '../../src/literature/types.js';

describe('AcademicLibraryService', () => {
  const sampleRecord: LiteratureRecord = {
    recordId: 'rec_01',
    title: 'Hybrid Algorithm for Initial Phase Calibration of Silicon Optical Phased Arrays',
    authors: ['Zhao, Haoran', 'Sun, Peng'],
    year: 2026,
    doi: '10.3788/aos260908',
    venue: 'Acta Optica Sinica',
    url: '',
    pdfUrl: '',
    abstract: 'Combining REV with dynamic gain SPGD algorithm.',
    keywords: ['Silicon photonics', 'Phase calibration'],
    categories: [],
    openAccess: false,
    identifiers: { doi: '10.3788/aos260908' },
    sources: [{ source: 'webofscience', sourceId: 'WOS:1', rank: 1 }],
    citedBy: { webofscience: 1 },
    references: []
  };

  it('builds ACADEMIC_LIBRARY.md, references.bib, and screening_audit.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twosci-library-'));
    try {
      const res = AcademicLibraryService.buildLibrary([sampleRecord], {
        workDir: tmpDir,
        brief: {
          briefId: 'brief_123',
          createdAt: '2026-11-09',
          intent: '空间激光通信相控阵快速标定算法调研',
          focus: ['标定收敛速度', '主瓣增益'],
          scope: {},
          seed: sampleRecord,
          seedProfile: {
            keywords: ['OPA'],
            concepts: [],
            frequentTerms: [],
            referenceCount: 0,
            citingCount: 0,
            topReferences: [],
            topCiting: []
          },
          warnings: []
        },
        screening: {
          rec_01: {
            recordId: 'rec_01',
            verdict: 'include',
            reason: '契合快速初始标定需求',
            decidedAt: '2026-11-09'
          }
        }
      });

      expect(fs.existsSync(res.libraryMarkdownPath)).toBe(true);
      expect(fs.existsSync(res.bibtexPath)).toBe(true);
      expect(fs.existsSync(res.auditJsonPath)).toBe(true);

      const mdContent = fs.readFileSync(res.libraryMarkdownPath, 'utf8');
      expect(mdContent).toContain('# 📚 TwoSCI 学术文献数据库 (Academic Research Library)');
      expect(mdContent).toContain('空间激光通信相控阵快速标定算法调研');
      expect(mdContent).toContain('Hybrid Algorithm for Initial Phase Calibration');
      expect(mdContent).toContain('✅ 纳入');

      const bibContent = fs.readFileSync(res.bibtexPath, 'utf8');
      expect(bibContent).toContain('@article{');
      expect(bibContent).toContain('Zhao, Haoran and Sun, Peng');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
