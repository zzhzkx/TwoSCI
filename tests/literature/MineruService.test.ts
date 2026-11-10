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

  it('fails honestly without creating fake files when download URL is invalid', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twosci-test-'));
    try {
      const res = await MineruService.processSinglePaper(
        {
          doi: '10.1016/j.optlastec.2026.116502',
          url: ''
        },
        tmpDir
      );
      expect(res.status).toBe('failed');
      expect(res.message).toMatch(/(未提供有效的 PDF 下载链接|非 PDF 数据)/);
      // 验证绝不创建伪造文件
      expect(fs.existsSync(res.pdfPath)).toBe(false);
      expect(fs.existsSync(res.markdownPath)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('processes valid PDF and extracts real text without fake optical formulas', async () => {
    const savedToken = process.env.MINERU_TOKEN;
    delete process.env.MINERU_TOKEN;
    delete process.env.MINERU_API_TOKEN;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twosci-test-'));
    try {
      const folderName = MineruService.buildDirectoryName({
        authors: ['Zhao, Haoran'],
        year: 2025,
        title: 'Carbon Tax on Green Building Transition',
        doi: '10.3390/buildings15111900'
      });
      const targetDir = path.join(tmpDir, 'twosci', folderName);
      fs.mkdirSync(targetDir, { recursive: true });
      
      const cleanTitle = MineruService.sanitizeName('Carbon Tax on Green Building Transition', 60);
      const pdfPath = path.join(targetDir, `${cleanTitle}.pdf`);
      // 使用 Base64 编码的合规单页真实文字 PDF，避免 CRLF 换行符影响 xref 字节计算
      const validPdfBase64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNTggPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiAxMDAgNzAwIFRkIChDYXJib24gYWNjb3VudGluZyBmcmFtZXdvcmsgZm9yIGNvbnN0cnVjdGlvbiBpbmR1c3RyeS4pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmICAKMDAwMDAwMDAwOSAwMDAwMCBuICAKMDAwMDAwMDA1OCAwMDAwMCBuICAKMDAwMDAwMDExNSAwMDAwMCBuICAKMDAwMDAwMDI0MSAwMDAwMCBuICAKMDAwMDAwMDMxMSAwMDAwMCBuICAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0NDcKJSVFT0YK';
      const validPdfBuffer = Buffer.from(validPdfBase64, 'base64');
      fs.writeFileSync(pdfPath, validPdfBuffer);

      const res = await MineruService.processSinglePaper(
        {
          doi: '10.3390/buildings15111900',
          record: {
            recordId: 'rec_01',
            title: 'Carbon Tax on Green Building Transition',
            authors: ['Zhao, Haoran'],
            year: 2025,
            doi: '10.3390/buildings15111900',
            url: '',
            pdfUrl: '',
            abstract: 'Study on carbon tax in green building industry.',
            keywords: ['green building', 'carbon tax'],
            categories: [],
            openAccess: true,
            identifiers: { doi: '10.3390/buildings15111900' },
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
      
      const mdContent = fs.readFileSync(res.markdownPath, 'utf8');
      expect(mdContent).toContain('# Carbon Tax on Green Building Transition');
      expect(mdContent).toContain('Carbon accounting framework for construction industry.');
      // 严禁包含假光学公式
      expect(mdContent).not.toContain('E(r, \\theta, z)');
      expect(mdContent).not.toContain('optical phase modulation');
    } finally {
      if (savedToken) process.env.MINERU_TOKEN = savedToken;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
