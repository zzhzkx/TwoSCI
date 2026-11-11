/**
 * Full-Text Acquisition Router.
 *
 * Inspired by the zero-cost channel prediction, tiered cascading, and
 * direct-construction strategies of scansci-pdf.
 *
 * Prioritizes:
 *   Tier 1: Direct open-access / CDN links (MDPI, PLOS, arXiv, PMC, OpenAlex OA)
 *   Tier 2: Official publisher API routes (Elsevier API, IEEE OA, Springer TDM)
 *   Tier 3: Institutional WebVPN / CARSI and fallback companion routes
 */

import type { LiteratureRecord } from './types.js';

export type FullTextChannel =
  | 'oa_direct'
  | 'arxiv'
  | 'mdpi_cdn'
  | 'plos_oa'
  | 'elsevier_api'
  | 'ieee_xplore'
  | 'springer_nature'
  | 'wiley_tdm'
  | 'optica_open'
  | 'institution_or_vpn';

export type AccessStatus =
  | 'direct_pdf_ready'
  | 'publisher_api_ready'
  | 'open_access_landing'
  | 'institutional_required'
  | 'unresolved';

export interface FullTextRoute {
  recordId: string;
  title: string;
  doi: string;
  channel: FullTextChannel;
  publisher: string;
  accessStatus: AccessStatus;
  isDirectDownloadable: boolean;
  bestPdfUrl?: string;
  candidatePdfUrls?: string[];
  landingUrl?: string;
  channelDetails: {
    doiPrefix?: string;
    hasConfiguredKey: boolean;
    recommendedMethod: string;
  };
}

export interface FullTextResolutionResult {
  totalRecords: number;
  directPdfCount: number;
  publisherApiCount: number;
  institutionalCount: number;
  routes: FullTextRoute[];
}

const MDPI_SLUGS: Record<string, string> = {
  su: 'sustainability',
  atmos: 'atmosphere',
  w: 'water',
  f: 'forests',
  min: 'minerals',
  en: 'energies',
  polym: 'polymers',
  applbiosci: 'appliedbiosciences',
  app: 'applsci',
  educsci: 'education',
  tourhosp: 'tourismhosp',
  d: 'diversity',
  a: 'algorithms',
  dj: 'dentistry',
  ma: 'materials',
  catal: 'catalysts'
};

export function getMdpiCdnVariants(doi: string): string[] {
  const clean = normalizeDoi(doi);
  const m = clean.match(/^10\.3390\/([a-z]+)(\d{6,})$/i);
  if (!m) return [];
  const pref = m[1].toLowerCase();
  const digits = m[2];
  const slug = MDPI_SLUGS[pref] || pref;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const volTake of [2, 1]) {
    if (digits.length <= volTake + 2) continue;
    const vol = String(parseInt(digits.slice(0, volTake), 10)).padStart(2, '0');
    const art = String(parseInt(digits.slice(volTake + 2), 10)).padStart(5, '0');
    const base = `${slug}-${vol}-${art}`;
    if (seen.has(base)) continue;
    seen.add(base);
    for (const suffix of ['', '-v2', '-v3', '-v4']) {
      out.push(`https://mdpi-res.com/d_attachment/${slug}/${base}/article_deploy/${base}${suffix}.pdf`);
    }
  }
  return out;
}

const DOI_CHANNEL_MAP: Record<string, { channel: FullTextChannel; publisher: string }> = {
  '10.1016': { channel: 'elsevier_api', publisher: 'Elsevier / ScienceDirect' },
  '10.3390': { channel: 'mdpi_cdn', publisher: 'MDPI' },
  '10.1109': { channel: 'ieee_xplore', publisher: 'IEEE' },
  '10.1007': { channel: 'springer_nature', publisher: 'Springer' },
  '10.1038': { channel: 'springer_nature', publisher: 'Nature Portfolio' },
  '10.1002': { channel: 'wiley_tdm', publisher: 'Wiley' },
  '10.1371': { channel: 'plos_oa', publisher: 'PLOS' },
  '10.5194': { channel: 'oa_direct', publisher: 'Copernicus' },
  '10.1021': { channel: 'institution_or_vpn', publisher: 'ACS Publications' },
  '10.1364': { channel: 'optica_open', publisher: 'Optica Publishing Group (OSA)' },
  '10.1088': { channel: 'institution_or_vpn', publisher: 'IOP Publishing' },
  '10.1098': { channel: 'institution_or_vpn', publisher: 'Royal Society' },
  '10.1063': { channel: 'institution_or_vpn', publisher: 'AIP Publishing' }
};

export class FullTextRouter {
  /**
   * Resolve the full-text route for a list of literature records.
   */
  static resolveBatch(records: LiteratureRecord[]): FullTextResolutionResult {
    const routes = records.map(record => this.resolveRoute(record));

    let directPdfCount = 0;
    let publisherApiCount = 0;
    let institutionalCount = 0;

    for (const r of routes) {
      if (r.isDirectDownloadable) {
        directPdfCount++;
      } else if (r.accessStatus === 'publisher_api_ready') {
        publisherApiCount++;
      } else {
        institutionalCount++;
      }
    }

    return {
      totalRecords: records.length,
      directPdfCount,
      publisherApiCount,
      institutionalCount,
      routes
    };
  }

  /**
   * Resolve the full-text route for a single literature record.
   */
  static resolveRoute(record: LiteratureRecord): FullTextRoute {
    const cleanDoi = normalizeDoi(record.doi);
    const doiPrefix = extractDoiPrefix(cleanDoi);
    const channelInfo = doiPrefix ? DOI_CHANNEL_MAP[doiPrefix] : undefined;

    // 1. Check for arXiv
    const arxivId = record.identifiers?.arxiv || extractArxivId(record.url) || extractArxivId(record.pdfUrl);
    if (arxivId) {
      const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
      const exportPdfUrl = `https://export.arxiv.org/pdf/${arxivId}.pdf`;
      return {
        recordId: record.recordId,
        title: record.title,
        doi: cleanDoi,
        channel: 'arxiv',
        publisher: 'arXiv',
        accessStatus: 'direct_pdf_ready',
        isDirectDownloadable: true,
        bestPdfUrl: pdfUrl,
        candidatePdfUrls: [pdfUrl, exportPdfUrl],
        landingUrl: `https://arxiv.org/abs/${arxivId}`,
        channelDetails: {
          doiPrefix,
          hasConfiguredKey: true,
          recommendedMethod: 'arXiv 开放获取直接下载'
        }
      };
    }

    // 2. Check for MDPI (10.3390)
    if (doiPrefix === '10.3390' && cleanDoi) {
      const mdpiVariants = getMdpiCdnVariants(cleanDoi);
      const bestUrl = mdpiVariants[0] || (record.pdfUrl && !record.pdfUrl.includes('www.mdpi.com') ? record.pdfUrl : `https://doi.org/${cleanDoi}`);
      return {
        recordId: record.recordId,
        title: record.title,
        doi: cleanDoi,
        channel: 'mdpi_cdn',
        publisher: 'MDPI',
        accessStatus: 'direct_pdf_ready',
        isDirectDownloadable: true,
        bestPdfUrl: bestUrl,
        candidatePdfUrls: mdpiVariants,
        landingUrl: record.url || `https://doi.org/${cleanDoi}`,
        channelDetails: {
          doiPrefix,
          hasConfiguredKey: true,
          recommendedMethod: 'MDPI 开放 CDN 直连 (mdpi-res.com)'
        }
      };
    }

    // 3. Check for PLOS (10.1371)
    if (doiPrefix === '10.1371' && cleanDoi) {
      const plosPdfUrl = `https://journals.plos.org/plosone/article/file?id=${encodeURIComponent(cleanDoi)}&type=printable`;
      return {
        recordId: record.recordId,
        title: record.title,
        doi: cleanDoi,
        channel: 'plos_oa',
        publisher: 'PLOS',
        accessStatus: 'direct_pdf_ready',
        isDirectDownloadable: true,
        bestPdfUrl: record.pdfUrl || plosPdfUrl,
        candidatePdfUrls: [plosPdfUrl, ...(record.pdfUrl ? [record.pdfUrl] : [])],
        landingUrl: record.url || `https://doi.org/${cleanDoi}`,
        channelDetails: {
          doiPrefix,
          hasConfiguredKey: true,
          recommendedMethod: 'PLOS 官方开放获取直取'
        }
      };
    }

    // 4. Check for pre-existing direct PDF from OpenAlex or Crossref OA
    if (record.pdfUrl && record.openAccess) {
      return {
        recordId: record.recordId,
        title: record.title,
        doi: cleanDoi,
        channel: 'oa_direct',
        publisher: channelInfo?.publisher || 'Open Access Repository',
        accessStatus: 'direct_pdf_ready',
        isDirectDownloadable: true,
        bestPdfUrl: record.pdfUrl,
        candidatePdfUrls: [record.pdfUrl],
        landingUrl: record.url || (cleanDoi ? `https://doi.org/${cleanDoi}` : undefined),
        channelDetails: {
          doiPrefix,
          hasConfiguredKey: true,
          recommendedMethod: '已验证开放获取 (Gold/Green OA) PDF 直链'
        }
      };
    }

    // 5. Elsevier / ScienceDirect (10.1016)
    if (doiPrefix === '10.1016' && cleanDoi) {
      const hasKey = Boolean(process.env.ELSEVIER_API_KEY);
      const apiUrl = `https://api.elsevier.com/content/article/doi/${encodeURIComponent(cleanDoi)}?httpAccept=application/pdf`;
      return {
        recordId: record.recordId,
        title: record.title,
        doi: cleanDoi,
        channel: 'elsevier_api',
        publisher: 'Elsevier / ScienceDirect',
        accessStatus: hasKey ? 'publisher_api_ready' : 'institutional_required',
        isDirectDownloadable: hasKey,
        bestPdfUrl: hasKey ? apiUrl : undefined,
        candidatePdfUrls: hasKey ? [apiUrl] : (record.pdfUrl ? [record.pdfUrl] : []),
        landingUrl: record.url || `https://doi.org/${cleanDoi}`,
        channelDetails: {
          doiPrefix,
          hasConfiguredKey: hasKey,
          recommendedMethod: hasKey
            ? 'Elsevier API 极速通道 (配合校园网/VPN出口可免 insttoken 直接下载)'
            : 'Elsevier ScienceDirect 机构访问 (需配置 ELSEVIER_API_KEY 或校园网)'
        }
      };
    }

    // 6. IEEE Xplore (10.1109)
    if (doiPrefix === '10.1109') {
      const ieeeSourceId = record.sources?.find(s => s.source === 'ieee')?.sourceId;
      const articleNumber = (record.extra as any)?.ieeeArticleNumber
        || (ieeeSourceId && /^\d+$/.test(ieeeSourceId) ? ieeeSourceId : '')
        || extractIeeeArticleNumber(record.url);
      const ieeePdfUrl = articleNumber
        ? `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${articleNumber}`
        : undefined;
      const isOa = record.openAccess || (record.extra as any)?.isOa === true;

      return {
        recordId: record.recordId,
        title: record.title,
        doi: cleanDoi,
        channel: 'ieee_xplore',
        publisher: 'IEEE',
        accessStatus: isOa ? 'direct_pdf_ready' : 'institutional_required',
        isDirectDownloadable: isOa && Boolean(ieeePdfUrl),
        bestPdfUrl: isOa ? (record.pdfUrl || ieeePdfUrl) : undefined,
        candidatePdfUrls: isOa && ieeePdfUrl ? [ieeePdfUrl] : (record.pdfUrl ? [record.pdfUrl] : []),
        landingUrl: record.url || (articleNumber ? `https://ieeexplore.ieee.org/document/${articleNumber}` : (cleanDoi ? `https://doi.org/${cleanDoi}` : undefined)),
        channelDetails: {
          doiPrefix,
          hasConfiguredKey: Boolean(process.env.IEEE_XPLORE_API_KEY),
          recommendedMethod: isOa
            ? 'IEEE Xplore 开放获取直接访问'
            : 'IEEE 机构订阅通道 (需校园网/WebVPN/CARSI登录)'
        }
      };
    }

    // 7. Springer Nature (10.1007, 10.1038)
    if ((doiPrefix === '10.1007' || doiPrefix === '10.1038') && cleanDoi) {
      const hasKey = Boolean(process.env.SPRINGER_API_KEY || process.env.SPRINGER_OPENACCESS_API_KEY);
      const isOa = record.openAccess;
      return {
        recordId: record.recordId,
        title: record.title,
        doi: cleanDoi,
        channel: 'springer_nature',
        publisher: channelInfo?.publisher || 'Springer Nature',
        accessStatus: isOa ? 'direct_pdf_ready' : (hasKey ? 'publisher_api_ready' : 'institutional_required'),
        isDirectDownloadable: isOa && Boolean(record.pdfUrl),
        bestPdfUrl: isOa ? record.pdfUrl : undefined,
        candidatePdfUrls: isOa && record.pdfUrl ? [record.pdfUrl] : [],
        landingUrl: record.url || `https://doi.org/${cleanDoi}`,
        channelDetails: {
          doiPrefix,
          hasConfiguredKey: hasKey,
          recommendedMethod: isOa
            ? 'Springer Nature 开放获取直达'
            : (hasKey ? 'Springer TDM 官方接口提取' : 'SpringerLink 机构访问 (校园网 WebVPN)')
        }
      };
    }

    // 8. Publisher profile routes (22 publishers ported from scansci-pdf)
    const profile = publisherProfileFor(cleanDoi, record.url);
    const profileCandidates = profile
      ? buildPdfCandidates(profile, cleanDoi, {
          sourceUrl: record.url,
          discoveredUrls: record.pdfUrl ? [record.pdfUrl] : []
        })
      : [];
    if (profileCandidates.length > 0) {
      return {
        recordId: record.recordId,
        title: record.title,
        doi: cleanDoi,
        channel: 'oa_direct',
        publisher: profile!.name,
        accessStatus: 'direct_pdf_ready',
        isDirectDownloadable: true,
        bestPdfUrl: profileCandidates[0],
        candidatePdfUrls: profileCandidates,
        landingUrl: record.url || (cleanDoi ? `https://doi.org/${cleanDoi}` : undefined),
        channelDetails: {
          doiPrefix,
          hasConfiguredKey: false,
          recommendedMethod: `${profile!.name} 官方 PDF 路由`
        }
      };
    }

    // 9. General publisher / institutional fallback
    const publisherName = channelInfo?.publisher || record.venue || 'Academic Publisher';
    return {
      recordId: record.recordId,
      title: record.title,
      doi: cleanDoi,
      channel: 'institution_or_vpn',
      publisher: publisherName,
      accessStatus: record.openAccess && record.pdfUrl ? 'direct_pdf_ready' : 'institutional_required',
      isDirectDownloadable: Boolean(record.openAccess && record.pdfUrl),
      bestPdfUrl: record.openAccess ? record.pdfUrl : undefined,
      candidatePdfUrls: record.openAccess && record.pdfUrl ? [record.pdfUrl] : [],
      landingUrl: record.url || (cleanDoi ? `https://doi.org/${cleanDoi}` : undefined),
      channelDetails: {
        doiPrefix,
        hasConfiguredKey: false,
        recommendedMethod: record.openAccess
          ? '公共开放获取仓储'
          : `${publisherName} 机构订阅通道 (需校园网/WebVPN/CARSI 或手动导入 cookie)`
      }
    };
  }
}

function normalizeDoi(value?: string): string {
  if (!value) return '';
  return value
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/[.,;)\s]+$/, '')
    .toLowerCase();
}

function extractDoiPrefix(doi: string): string | undefined {
  const match = doi.match(/^(10\.\d{4,9})/);
  return match ? match[1] : undefined;
}

function extractArxivId(url?: string): string | undefined {
  if (!url) return undefined;
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([a-z\-]+(?:\.[a-z]{2})?\/\d{7}|\d{4}\.\d{4,5})/i);
  return match ? match[1] : undefined;
}

function extractIeeeArticleNumber(url?: string): string | undefined {
  if (!url) return undefined;
  const match = url.match(/\/document\/(\d+)/i) || url.match(/[?&]arnumber=(\d+)/i);
  return match ? match[1] : undefined;
}

export default FullTextRouter;
import { buildPdfCandidates, publisherProfileFor } from './download/publisherPdfRouter.js';
