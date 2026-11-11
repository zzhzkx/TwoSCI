import * as fs from 'node:fs';
import * as path from 'node:path';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { PDFExtractor } from '../utils/PDFExtractor.js';
import { FullTextRouter, getMdpiCdnVariants, type FullTextRoute } from './FullTextRouter.js';
import {
  buildInstitutionalTargets,
  carsiCookieFileForDoi,
  cookieHeaderForUrl,
  isWebVpnSessionAlive,
  loadCookies,
  loadInstitutionalConfig,
  type CookieRecord
} from './InstitutionalAccess.js';
import { getLightpandaBrowser } from './LightpandaBrowser.js';
import type { LiteratureRecord } from './types.js';

export function extractFirstAuthorSurname(authors?: string[]): string {
  if (!authors || authors.length === 0) return 'UnknownAuthor';
  const raw = (authors[0] || '').trim();
  if (!raw) return 'UnknownAuthor';
  if (raw.includes(',')) {
    const surname = raw.split(',')[0].trim();
    return surname || 'UnknownAuthor';
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1].replace(/[.,]/g, '');
  if (/^(jr|sr|ii|iii|iv|v|phd|md)$/i.test(last) && parts.length > 2) {
    return parts[parts.length - 2];
  }
  return parts[parts.length - 1];
}

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
    const surname = extractFirstAuthorSurname(record.authors);
    const firstAuthor = this.sanitizeName(surname, 30);
    const year = record.year ? String(record.year).trim() : 'ND';
    const cleanTitle = this.sanitizeName(record.title, 50);
    const cleanDoi = this.sanitizeName(record.doi || 'no-doi', 40);
    return `${firstAuthor}-${year}-${cleanTitle}-${cleanDoi}`;
  }

  static async resolveMetadataForDoi(doi: string): Promise<LiteratureRecord | undefined> {
    const cleanDoi = doi.trim().replace(/^doi:\s*/i, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/[.,;)\s]+$/, '');
    if (!cleanDoi) return undefined;
    try {
      const resp = await axios.get(`https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'TwoSCI/0.2.3 (mailto:research@twosci.org)' }
      });
      const item = resp.data?.message;
      if (item) {
        const title = Array.isArray(item.title) ? item.title[0] : (item.title || '');
        const authors: string[] = [];
        if (Array.isArray(item.author)) {
          for (const a of item.author) {
            if (a.family && a.given) {
              authors.push(`${a.given} ${a.family}`);
            } else if (a.family) {
              authors.push(a.family);
            } else if (a.name) {
              authors.push(a.name);
            }
          }
        }
        const year = item['published-print']?.['date-parts']?.[0]?.[0]
          || item['published-online']?.['date-parts']?.[0]?.[0]
          || item.created?.['date-parts']?.[0]?.[0];
        const link = item.link?.find((l: any) => l['content-type'] === 'application/pdf')?.URL;
        return {
          recordId: cleanDoi,
          title: title || `Paper_${cleanDoi}`,
          authors: authors.length > 0 ? authors : ['Author'],
          year,
          doi: cleanDoi,
          url: `https://doi.org/${cleanDoi}`,
          pdfUrl: link || '',
          abstract: item.abstract ? String(item.abstract).replace(/<[^>]+>/g, ' ').trim() : '',
          keywords: [],
          categories: [],
          openAccess: Boolean(link),
          identifiers: { doi: cleanDoi },
          sources: [],
          citedBy: {},
          references: []
        };
      }
    } catch {
      // Optional fallback
    }
    return undefined;
  }

  /**
   * Process single paper: download PDF and convert with MinerU into standard ./twosci directory.
   */
  static async processSinglePaper(
    input: { doi?: string; url?: string; record?: LiteratureRecord },
    workDir: string = process.cwd()
  ): Promise<ProcessedPaperArtifact> {
    let record = input.record;
    const doi = input.doi || record?.doi || '';
    if (!record && doi) {
      record = await this.resolveMetadataForDoi(doi);
    }

    const title = record?.title || (doi ? `Paper_${this.sanitizeName(doi)}` : 'Academic_Paper');
    const authors = record?.authors || ['Author'];
    const firstAuthor = extractFirstAuthorSurname(authors);
    const year = record?.year || new Date().getFullYear();

    const folderName = this.buildDirectoryName({ authors, year, title, doi });
    const targetDir = path.resolve(workDir, 'twosci', folderName);
    const imgDir = path.join(targetDir, 'img');

    const cleanTitle = this.sanitizeName(title, 60);
    const pdfPath = path.join(targetDir, `${cleanTitle}.pdf`);
    const mdPath = path.join(targetDir, `${cleanTitle}.md`);

    let route: FullTextRoute | undefined;
    if (record) {
      route = FullTextRouter.resolveRoute(record);
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
    const candidateUrls = route?.candidatePdfUrls || [];
    let channel: string = route?.channel || 'oa_direct';
    const landingUrl = input.url || route?.landingUrl || (doi ? `https://doi.org/${encodeURI(doi)}` : undefined);

    try {
      // 1. 获取真实 PDF (若本地已存在有效 PDF 则复用，保证每篇论文只存一份)
      if (!fs.existsSync(pdfPath)) {
        fs.mkdirSync(imgDir, { recursive: true });
        const resolvedChannel = await this.acquirePdf(downloadUrl, pdfPath, {
          candidateUrls,
          doi,
          landingUrl,
          targetDir,
          elsevierApiKey: process.env.ELSEVIER_API_KEY
        });
        if (resolvedChannel) channel = resolvedChannel;
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
        abstract: record?.abstract
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

  private static async acquirePdf(
    url: string,
    destPath: string,
    options?: {
      candidateUrls?: string[];
      doi?: string;
      landingUrl?: string;
      targetDir?: string;
      elsevierApiKey?: string;
    }
  ): Promise<string | undefined> {
    interface PdfCandidate {
      url: string;
      cookieHeader?: string;
      referer?: string;
      channel: string;
    }
    const candidates: PdfCandidate[] = [];
    const seen = new Set<string>();

    const addUrl = (target?: string, cookieHeader?: string, channel = 'oa_direct', referer?: string) => {
      if (!target || target.startsWith('#')) return;
      const key = `${channel}|${target}|${cookieHeader || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ url: target, cookieHeader, channel, referer });
    };

    // 1. MDPI DOI 优先使用开放 CDN 直链 (彻底避免 www.mdpi.com 的 403 反爬)
    if (options?.doi && /^10\.3390\//i.test(options.doi)) {
      for (const cdnUrl of getMdpiCdnVariants(options.doi)) {
        addUrl(cdnUrl);
      }
    }

    // 2. 路由推荐候选直链
    if (options?.candidateUrls) {
      for (const u of options.candidateUrls) addUrl(u);
    }

    // 3. 初始 downloadUrl (跳过已知反爬的 www.mdpi.com/pdf)
    if (url && !url.includes('www.mdpi.com/')) {
      addUrl(url);
    }

    // 4. Elsevier 专属 API 认证直连
    if (options?.doi && /^10\.1016\//i.test(options.doi) && options?.elsevierApiKey) {
      addUrl(`https://api.elsevier.com/content/article/doi/${encodeURIComponent(options.doi)}?httpAccept=application/pdf`);
    }

    // 5. 机构通道：WebVPN 改写 + CARSI cookie（只读复用 ~/.scansci-pdf）
    const institutional = loadInstitutionalConfig();
    const doi = options?.doi || '';
    const backend = (process.env.TWOSCI_BROWSER_BACKEND || 'auto').toLowerCase();
    let webVpnAlive = false;
    if (institutional && backend !== 'off') {
      const primary = url && !url.includes('www.mdpi.com/') ? url : options?.candidateUrls?.[0];
      if (primary) {
        for (const target of buildInstitutionalTargets(primary, doi, institutional)) {
          if (target.channel === 'carsi') addUrl(target.url, target.cookieHeader, target.channel);
        }
      }
      if (options?.landingUrl) {
        for (const target of buildInstitutionalTargets(options.landingUrl, doi, institutional)) {
          if (target.channel === 'carsi') addUrl(target.url, target.cookieHeader, target.channel);
        }
      }
    }

    let lastError: Error | undefined;
    for (const candidate of candidates) {
      try {
        await this.downloadPdf(candidate, destPath, options?.elsevierApiKey);
        return candidate.channel;
      } catch (err: any) {
        lastError = err;
      }
    }

    webVpnAlive = institutional && backend !== 'off'
      ? await isWebVpnSessionAlive(institutional)
      : false;

    // 6. Lightpanda 无头浏览器解析落地页，提取 PDF 链接与浏览器 cookie
    if (backend !== 'off' && backend !== 'scansci' && process.env.NODE_ENV !== 'test') {
      const browserChannel = await this.resolveViaLightpanda(
        options?.landingUrl,
        doi,
        destPath,
        options?.elsevierApiKey,
        institutional
      );
      if (browserChannel) return browserChannel;
    }

    // 7. WebVPN 直连（仅在会话探测通过后尝试，避免死会话拖慢链路）
    if (webVpnAlive && institutional && backend !== 'off') {
      const primary = url && !url.includes('www.mdpi.com/') ? url : options?.candidateUrls?.[0];
      const webVpnTargets = [
        ...(primary ? buildInstitutionalTargets(primary, doi, institutional) : []),
        ...(options?.landingUrl ? buildInstitutionalTargets(options.landingUrl, doi, institutional) : [])
      ].filter(target => target.channel === 'webvpn');
      for (const target of webVpnTargets) {
        try {
          await this.downloadPdf(
            { url: target.url, cookieHeader: target.cookieHeader },
            destPath,
            options?.elsevierApiKey
          );
          return target.channel;
        } catch (err: any) {
          lastError = err;
        }
      }
    }

    // 8. 本地 scansci-pdf CLI 兜底（含 Chrome 机构登录流程）
    if (doi && process.env.NODE_ENV !== 'test' && backend !== 'lightpanda') {
      const scansciOk = await this.tryScansciDownload(doi, destPath, options?.targetDir);
      if (scansciOk) return 'scansci_cli';
    }

    if (candidates.length === 0 && !url) {
      throw new Error('未提供有效的 PDF 下载链接');
    }

    const suffix = lastError?.message ? `; last error: ${lastError.message}` : '';
    throw new Error(`PDF 下载失败: 未能在开放获取或机构渠道获取到有效 PDF 原文。已尝试开放 CDN、仓储直链、WebVPN/CARSI 与 Lightpanda (${doi || url})${suffix}`);
  }

  private static async downloadPdf(
    candidate: { url: string; cookieHeader?: string; referer?: string },
    destPath: string,
    elsevierApiKey?: string
  ): Promise<void> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8'
    };
    if (candidate.cookieHeader) headers.Cookie = candidate.cookieHeader;
    if (candidate.referer) headers.Referer = candidate.referer;
    if (candidate.url.includes('api.elsevier.com') && elsevierApiKey) {
      headers['X-ELS-APIKey'] = elsevierApiKey;
    }

    const originalHost = new URL(candidate.url).hostname;
    const response = await axios.get(candidate.url, {
      responseType: 'arraybuffer',
      timeout: 25000,
      headers,
      maxRedirects: 5,
      beforeRedirect: (options: { href?: string; headers?: Record<string, string> }) => {
        if (!candidate.cookieHeader || !options.href) return;
        try {
          if (!sameSite(originalHost, new URL(options.href).hostname)) {
            delete options.headers?.Cookie;
            delete options.headers?.cookie;
          }
        } catch {
          // malformed redirect target; keep the request as-is
        }
      }
    });

    const buffer = Buffer.from(response.data);
    this.validatePdfBuffer(buffer, candidate.url);
    fs.writeFileSync(destPath, buffer);
  }

  private static async resolveViaLightpanda(
    landingUrl: string | undefined,
    doi: string,
    destPath: string,
    elsevierApiKey: string | undefined,
    institutional: ReturnType<typeof loadInstitutionalConfig>
  ): Promise<string | undefined> {
    if (!landingUrl) return undefined;
    const browser = getLightpandaBrowser();
    if (!browser.runtime()) return undefined;

    const attempts: Array<{ url: string; cookies?: CookieRecord[] }> = [];
    const carsiCookieFile = institutional ? carsiCookieFileForDoi(doi, institutional) : '';
    attempts.push({
      url: landingUrl,
      cookies: carsiCookieFile ? loadCookies(carsiCookieFile) : undefined
    });

    if (institutional?.vpnsciEnabled && institutional.vpnsciBaseUrl
      && await isWebVpnSessionAlive(institutional)) {
      const webVpn = buildInstitutionalTargets(landingUrl, doi, institutional)
        .find(target => target.channel === 'webvpn');
      if (webVpn) {
        attempts.push({
          url: webVpn.url,
          cookies: loadCookies(institutional.vpnsciCookieFile)
        });
      }
    }

    for (const attempt of attempts) {
      const page = await browser.fetchPage(attempt.url, { cookies: attempt.cookies });
      if (!page || page.pdfUrls.length === 0) continue;
      const pageCookieHeader = cookieHeaderForUrl(page.cookies, page.finalUrl);
      for (const pdfUrl of page.pdfUrls) {
        const cookieHeader = mergeCookieHeaders(
          pageCookieHeader,
          cookieHeaderForUrl(attempt.cookies || [], pdfUrl)
        );
        try {
          await this.downloadPdf(
            { url: pdfUrl, cookieHeader, referer: page.finalUrl },
            destPath,
            elsevierApiKey
          );
          return 'lightpanda_browser';
        } catch {
          // try next extracted PDF link
        }
      }
    }
    return undefined;
  }

  private static async tryScansciDownload(
    doi: string,
    destPath: string,
    targetDir?: string
  ): Promise<boolean> {
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      const outDir = targetDir || path.dirname(destPath);

      await execAsync(`python -m scansci_pdf get "${doi}" --output "${outDir}"`, {
        timeout: 45000
      });

      const files = fs.readdirSync(outDir);
      const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf') && f !== path.basename(destPath));
      if (pdfFiles.length > 0) {
        const downloadedPdf = path.join(outDir, pdfFiles[0]);
        const buf = fs.readFileSync(downloadedPdf);
        if (buf.length > 500 && buf.slice(0, 5).toString('ascii') === '%PDF-') {
          fs.renameSync(downloadedPdf, destPath);
          return true;
        }
      }
      if (fs.existsSync(destPath)) {
        const buf = fs.readFileSync(destPath);
        if (buf.length > 500 && buf.slice(0, 5).toString('ascii') === '%PDF-') {
          return true;
        }
      }
    } catch {
      // scansci CLI 未安装或失败
    }
    return false;
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

    // 1. 优先尝试真实的 MinerU Cloud API
    if (mineruToken) {
      try {
        const cloudRes = await this.callMineruCloudApi(pdfPath, mdPath, imgDir, mineruToken);
        if (cloudRes.success) {
          return { imageCount: cloudRes.imageCount, method: 'mineru_cloud' };
        }
      } catch {
        // MinerU 云端调用受限时降级
      }
    }

    // 2. 尝试本地 mineru CLI
    try {
      const cliRes = await this.tryMineruCliParse(pdfPath, mdPath, imgDir);
      if (cliRes.success) {
        return { imageCount: cliRes.imageCount, method: 'mineru_cloud' };
      }
    } catch {
      // mineru CLI 不可用
    }

    // 3. 本地真实 PDF 文本提取降级（从实际 PDF 缓冲中抽取真实文字，绝无虚构）
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

    // 2. 上传 PDF 到预签名 URL (注意：Aliyun OSS 预签名未包含 Content-Type，置空以通过签名验证)
    const pdfBuffer = fs.readFileSync(pdfPath);
    await axios.put(uploadUrl, pdfBuffer, {
      headers: { 'Content-Type': '' },
      timeout: 60000
    });

    // 3. 轮询解析结果 (支持最多 30 次轮询，每次 2.5 秒，共 75 秒)
    let zipUrl: string | undefined;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2500));
      const pollRes = await axios.get(
        `https://mineru.net/api/v4/extract-results/batch/${batchId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000
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
      timeout: 60000
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

  private static async tryMineruCliParse(
    pdfPath: string,
    mdPath: string,
    imgDir: string
  ): Promise<{ success: boolean; imageCount: number }> {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);

    await execAsync(`mineru parse "${pdfPath}" -o "${mdPath}" --no-marker`, {
      timeout: 60000
    });
    if (fs.existsSync(mdPath) && fs.statSync(mdPath).size > 100) {
      let count = 0;
      if (fs.existsSync(imgDir)) {
        const images = fs.readdirSync(imgDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
        count = images.length;
      }
      return { success: true, imageCount: count };
    }
    return { success: false, imageCount: 0 };
  }
}

function mergeCookieHeaders(...headers: Array<string | undefined>): string | undefined {
  const cookies = new Map<string, string>();
  for (const header of headers) {
    if (!header) continue;
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator <= 0) continue;
      cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
    }
  }
  if (cookies.size === 0) return undefined;
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function sameSite(left: string, right: string): boolean {
  if (left === right) return true;
  const base = (host: string) => host.split('.').slice(-2).join('.');
  return base(left) === base(right);
}
