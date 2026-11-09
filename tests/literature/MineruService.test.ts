import { describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MineruService } from '../../src/literature/MineruService.js';

describe('MineruService', () => {
  it('builds standard directory name following {first_author}-{year}-{title}-{doi}', () => {
    const dir = MineruService.buildDirectoryName({
      authors: ['Liu, Xuelian', 'Wang, Chunyang'],
      year: 2026,
      title: 'A disturbance-observer-based control method',
      doi: '10.1016/j.optlastec.2026.116502'
    });
    expect(dir).toBe('Liu-2026-A_disturbance_observer_based_control_method-10_1016_j_optlastec_2026_116502');
  });

  it('processes single paper and creates standard directory structure with pdf, md, and img', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twosci-test-'));
    try {
      const res = await MineruService.processSinglePaper(
        {
          doi: '10.1016/j.optlastec.2026.116502',
          record: {
            recordId: 'rec_01',
            title: 'Disturbance Observer Control for LCOPA',
            authors: ['Liu, Xuelian', 'Ma, Xinjie'],
            year: 2026,
            doi: '10.1016/j.optlastec.2026.116502',
            url: '',
            pdfUrl: '',
            abstract: 'A disturbance-observer-based method is proposed.',
            keywords: ['LCOPA'],
            categories: [],
            openAccess: false,
            identifiers: { doi: '10.1016/j.optlastec.2026.116502' },
            sources: [],
            citedBy: {},
            references: []
          }
        },
        tmpDir
      );

      expect(res.status).toBe('success');
      expect(fs.existsSync(res.directory)).toBe(true);
      expect(fs.existsSync(res.pdfPath)).toBe(true);
      expect(fs.existsSync(res.markdownPath)).toBe(true);
      expect(fs.existsSync(res.imageDirPath)).toBe(true);
      
      const mdContent = fs.readFileSync(res.markdownPath, 'utf8');
      expect(mdContent).toContain('# Disturbance Observer Control for LCOPA');
      expect(mdContent).toContain('img/figure_1_system_architecture.png');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
