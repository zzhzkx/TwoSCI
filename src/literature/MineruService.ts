import * as fs from 'node:fs';
import * as path from 'node:path';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { PDFExtractor } from '../utils/PDFExtractor.js';
import { FullTextRouter, type FullTextRoute } from './FullTextRouter.js';
import type { LiteratureRecord } from './types.js';

export interface ProcessedPaperArtifact {
  doi: string;
  title: string;
  firstAuthor: string;
  year: number | string;
  directory: string;
  pdfPath: string;
  markdownPath: string;
  imageDirPath: string;
  imageCount: number;
  sourceChannel: string;
  status: 'success' | 'partial' | 'failed';
  method?: 'mineru_cloud' | 'local_pdf_parse';
  message?: string;
}

export interface MineruBatchResult {
  totalRequested: number;
  successCount: number;
  failedCount: number;
  outputDirectory: string;
  artifacts: ProcessedPaperArtifact[];
}

export class MineruService {
  /**
   * Clean and sanitize string for filesystem directory or file name.
   */
  static sanitizeName(raw: string, maxLength = 60): string {
    if (!raw) return 'unknown';
    const cleaned = raw
      .replace(/[\\/:*?"<>|#%&{}\\$!'@+`=.]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/-/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return cleaned.slice(0, maxLength) || 'unnamed';
  }

  /**
   * Build standard directory name: {first_author}-{year}-{sanitized_title}-{sanitized_doi}
   */
  static buildDirectoryName(record: {
    authors?: string[];
    year?: number | string;
    title: string;
    doi?: string;
  }): string {
    const firstAuthor = this.sanitizeName(record.authors?.[0]?.split(/[\s,]+/)[0] || 'UnknownAuthor', 30);
    const year = record.year ? String(record.year).trim() : 'ND';
    const cleanTitle = this.sanitizeName(record.title, 50);
    const cleanDoi = this.sanitizeName(record.doi || 'no-doi', 40);
    return `${firstAuthor}-${year}-${cleanTitle}-${cleanDoi}`;
  }

  /**
   * Process single paper: download PDF and convert with MinerU into standard ./twosci directory.
   */
  static async processSinglePaper(
    input: { doi?: string; url?: string; record?: LiteratureRecord },
    workDir: string = process.cwd()
  ): Promise<ProcessedPaperArtifact> {
    const doi = input.doi || input.record?.doi || '';
    const title = input.record?.title || (doi ? `Paper_${this.sanitizeName(doi)}` : 'Academic_Paper');
    const authors = input.record?.authors || ['Author'];
    const firstAuthor = authors[0]?.split(/[\s,]+/)[0] || 'Author';
    const year = input.record?.year || new Date().getFullYear();

    const folderName = this.buildDirectoryName({ authors, year, title, doi });
    const targetDir = path.resolve(workDir, 'twosci', folderName);
    const imgDir = path.join(targetDir, 'img');

    const cleanTitle = this.sanitizeName(title, 60);
    const pdfPath = path.join(targetDir, `${cleanTitle}.pdf`);
    const mdPath = path.join(targetDir, `${cleanTitle}.md`);

    let route: FullTextRoute | undefined;
    if (input.record) {
      route = FullTextRouter.resolveRoute(input.record);
    } else if (doi) {
      route = FullTextRouter.resolveRoute({
        recordId: 'temp',
        title,
        authors,
        doi,
        url: input.url || `https://doi.org/${encodeURI(doi)}`,
        pdfUrl: '',
        abstract: '',
        keywords: [],
        categories: [],
        openAccess: false,
        identifiers: { doi },
        sources: [],
        citedBy: {},
        references: []
      });
    }

    const downloadUrl = input.url || route?.bestPdfUrl || (doi ? `https://doi.org/${encodeURI(doi)}` : '');
    const channel = route?.channel || 'oa_direct';

    try {
      // 1. 获取真实 PDF (若本地已存在有效 PDF 则复用，保证每篇论文只存一份)
      if (!fs.existsSync(pdfPath)) {
        fs.mkdirSync(imgDir, { recursive: true });
        await this.acquirePdf(downloadUrl, pdfPath);
      } else {
        fs.mkdirSync(imgDir, { recursive: true });
        this.validatePdfFile(pdfPath);
      }

      // 2. 调用真实 MinerU 开放接口或本地真实 pdf 引擎生成 Markdown 与图片
      const conversion = await this.convertWithMineru(pdfPath, mdPath, imgDir, {
        title,
        authors,
        year,
        doi,
        abstract: input.record?.abstract
      });

      return {
        doi,
        title,
        firstAuthor,
        year,
        directory: targetDir,
        pdfPath,
        markdownPath: mdPath,
        imageDirPath: imgDir,
        imageCount: conversion.imageCount,
        sourceChannel: channel,
        method: conversion.method,
        status: 'success'
      };
    } catch (err: any) {
      // 下载或解析失败时，绝不伪造 PDF 或 Markdown 文件！
      try {
        if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length === 0) {
          fs.rmdirSync(targetDir);
        }
      } catch {
        // ignore cleanup error
      }
      return {
        doi,
        title,
        firstAuthor,
        year,
        directory: targetDir,
        pdfPath,
        markdownPath: mdPath,
        imageDirPath: imgDir,
        imageCount: 0,
        sourceChannel: channel,
        status: 'failed',
        message: err?.message || String(err)
      };
    }
  }

  /**
   * Process batch of DOIs or literature records.
   */
  static async processBatch(
    items: Array<{ doi?: string; url?: string; record?: LiteratureRecord }>,
    workDir: string = process.cwd()
  ): Promise<MineruBatchResult> {
    const artifacts: ProcessedPaperArtifact[] = [];
    for (const item of items) {
      const res = await this.processSinglePaper(item, workDir);
      artifacts.push(res);
    }
    const successCount = artifacts.filter(a => a.status === 'success').length;
    return {
      totalRequested: items.length,
      successCount,
      failedCount: items.length - successCount,
      outputDirectory: path.resolve(workDir, 'twosci'),
      artifacts
    };
  }

  private static async acquirePdf(url: string, destPath: string): Promise<void> {
    if (!url || url.startsWith('#')) {
      throw new Error('未提供有效的 PDF 下载链接');
    }
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 25000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8'
        }
      });

      const buffer = Buffer.from(response.data);
      this.validatePdfBuffer(buffer, url);
      fs.writeFileSync(destPath, buffer);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        throw new Error(`下载失败 (403 Forbidden): 出版商启用了反爬保护 (如 Akamai/Cloudflare)。未生成伪造文件。建议通过浏览器或校园网/VPN直接访问: ${url}`);
      }
      if (err?.response?.status === 404) {
        throw new Error(`下载失败 (404 Not Found): PDF 链接不可用 (${url})`);
      }
      throw new Error(`PDF 下载失败: ${err?.message || String(err)} (${url})`);
    }
  }

  private static validatePdfBuffer(buffer: Buffer, url?: string): void {
    if (!buffer || buffer.length < 500) {
      throw new Error(`下载内容尺寸过小 (${buffer?.length || 0} bytes)，非有效 PDF 文件`);
    }
    const header = buffer.slice(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw new Error(`下载内容为非 PDF 数据 (可能遇到反爬验证页或登录跳转): ${url || ''}`);
    }
  }

  private static validatePdfFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 500) {
      throw new Error(`PDF 文件尺寸异常 (${stat.size} bytes)，疑似空壳或损坏`);
    }
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    if (buf.toString('ascii') !== '%PDF-') {
      throw new Error(`文件不是标准 PDF: ${filePath}`);
    }
  }

  private static async convertWithMineru(
    pdfPath: string,
    mdPath: string,
    imgDir: string,
    meta: { title: string; authors: string[]; year: number | string; doi: string; abstract?: string }
  ): Promise<{ imageCount: number; method: 'mineru_cloud' | 'local_pdf_parse' }> {
    const mineruToken = process.env.MINERU_TOKEN || process.env.MINERU_API_TOKEN;

    // 优先尝试真实的 MinerU Cloud API
    if (mineruToken) {
      try {
        const cloudRes = await this.callMineruCloudApi(pdfPath, mdPath, imgDir, mineruToken);
        if (cloudRes.success) {
          return { imageCount: cloudRes.imageCount, method: 'mineru_cloud' };
        }
      } catch {
        // MinerU 云端调用受限时降级为本地真实 PDF 文本解析
      }
    }

    // 本地真实 PDF 文本提取降级（从实际 PDF 缓冲中抽取真实文字，绝无虚构）
    const pdfBuffer = fs.readFileSync(pdfPath);
    const extractor = new PDFExtractor();
    const parsed = await extractor.extractFromBuffer(pdfBuffer);
    const realText = (parsed?.text || '').trim();

    const cleanAbstract = meta.abstract ? `## Abstract\n\n${meta.abstract}\n\n` : '';
    const realMd = [
      `# ${meta.title}`,
      '',
      `**Authors**: ${meta.authors.join('; ')}  `,
      `**Year**: ${meta.year} | **DOI**: [${meta.doi}](https://doi.org/${encodeURI(meta.doi)})  `,
      '',
      '---',
      '',
      cleanAbstract,
      '*(注：本文档由本地 PDF 文本引擎从下载的原始 PDF 正文中真实提取)*',
      '',
      '## 正文提取内容 (Extracted Text)',
      '',
      realText || '*(PDF 未包含可提取的纯文本图层)*'
    ].filter(Boolean).join('\n');

    fs.writeFileSync(mdPath, realMd, 'utf8');
    return { imageCount: 0, method: 'local_pdf_parse' };
  }

  private static async callMineruCloudApi(
    pdfPath: string,
    mdPath: string,
    imgDir: string,
    token: string
  ): Promise<{ success: boolean; imageCount: number }> {
    const fileName = path.basename(pdfPath);
    // 1. 创建批次任务
    const batchRes = await axios.post(
      'https://mineru.net/api/v4/file-urls/batch',
      { files: [{ name: fileName, is_ocr: false }] },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        timeout: 15000
      }
    );

    const batchId = batchRes.data?.data?.batch_id;
    const uploadUrl = batchRes.data?.data?.file_urls?.[0];
    if (!batchId || !uploadUrl) {
      return { success: false, imageCount: 0 };
    }

    // 2. 上传 PDF 到预签名 URL
    const pdfBuffer = fs.readFileSync(pdfPath);
    await axios.put(uploadUrl, pdfBuffer, {
      headers: { 'Content-Type': 'application/pdf' },
      timeout: 30000
    });

    // 3. 轮询解析结果
    let zipUrl: string | undefined;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await axios.get(
        `https://mineru.net/api/v4/extract-results/batch/${batchId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000
        }
      );
      const result = pollRes.data?.data?.extract_result?.[0];
      if (result?.state === 'done') {
        zipUrl = result.full_zip_url;
        break;
      }
      if (result?.state === 'failed') {
        return { success: false, imageCount: 0 };
      }
    }

    if (!zipUrl) {
      return { success: false, imageCount: 0 };
    }

    // 4. 下载 zip 并真实解压
    const zipRes = await axios.get(zipUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });

    const zip = new AdmZip(Buffer.from(zipRes.data));
    const entries = zip.getEntries();
    let imageCount = 0;

    for (const entry of entries) {
      const lower = entry.entryName.toLowerCase();
      if (lower.endsWith('.md')) {
        const mdText = entry.getData().toString('utf8');
        fs.writeFileSync(mdPath, mdText, 'utf8');
      } else if (/\.(png|jpe?g|webp|svg)$/i.test(lower)) {
        const imgTarget = path.join(imgDir, path.basename(entry.entryName));
        fs.writeFileSync(imgTarget, entry.getData());
        imageCount++;
      }
    }

    return { success: true, imageCount };
  }
}
