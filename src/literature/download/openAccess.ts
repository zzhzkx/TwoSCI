import axios from 'axios';
import { downloadPdfToFile } from './pdfDownload.js';
import type { DownloadAttempt, PdfFetchOptions } from './types.js';

interface OaCandidate {
  channel: string;
  url: string;
}

const ARXIV_DOI_RE = /^10\.48550\/arxiv\.(.+)$/i;
const ARXIV_ID_RE = /(?:arxiv[:./]|abs\/|pdf\/)([a-z-]+(?:\.[a-z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i;

function contactEmail(options: PdfFetchOptions): string {
  return options.email
    || process.env.OA_EMAIL
    || process.env.UNPAYWALL_EMAIL
    || process.env.CROSSREF_MAILTO
    || 'twosci@example.com';
}

export function normalizeArxivId(doiOrId: string): string | undefined {
  const trimmed = doiOrId.trim().replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '');
  const doiMatch = trimmed.match(ARXIV_DOI_RE);
  if (doiMatch) return doiMatch[1].replace(/\.pdf$/i, '');
  const idMatch = trimmed.match(ARXIV_ID_RE);
  if (idMatch) return idMatch[1];
  if (/^\d{4}\.\d{4,5}(?:v\d+)?$/.test(trimmed)) return trimmed.replace(/v\d+$/, '');
  if (/^[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?$/i.test(trimmed)) return trimmed.replace(/v\d+$/, '');
  return undefined;
}

async function tryCandidates(
  channel: string,
  candidates: string[],
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[]
): Promise<OaCandidate | undefined> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      await downloadPdfToFile(candidate, destPath, {
        timeoutMs: options.timeoutMs,
        minBytes: options.minBytes
      });
      attempts.push({ channel, status: 'success', url: candidate });
      return { channel, url: candidate };
    } catch (error) {
      attempts.push({
        channel,
        status: 'miss',
        url: candidate,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return undefined;
}

export async function tryArxiv(
  identifier: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[]
): Promise<OaCandidate | undefined> {
  const arxivId = normalizeArxivId(identifier);
  if (!arxivId) return undefined;
  return tryCandidates('arxiv', [
    `https://arxiv.org/pdf/${arxivId}.pdf`,
    `https://export.arxiv.org/pdf/${arxivId}.pdf`
  ], destPath, options, attempts);
}

export async function tryUnpaywall(
  doi: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[]
): Promise<OaCandidate | undefined> {
  try {
    const response = await axios.get(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`, {
      params: { email: contactEmail(options) },
      timeout: 20_000,
      headers: { 'User-Agent': 'TwoSCI/0.3.2' }
    });
    const data = response.data as {
      best_oa_location?: { url_for_pdf?: string; url?: string };
      oa_locations?: Array<{ url_for_pdf?: string; url?: string }>;
    };
    const candidates: string[] = [];
    const push = (value?: string) => {
      if (value && !candidates.includes(value)) candidates.push(value);
    };
    push(data.best_oa_location?.url_for_pdf);
    push(data.best_oa_location?.url);
    for (const location of data.oa_locations || []) {
      push(location.url_for_pdf);
      push(location.url);
    }
    return tryCandidates('unpaywall', candidates, destPath, options, attempts);
  } catch (error) {
    attempts.push({
      channel: 'unpaywall',
      status: 'miss',
      reason: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

export async function tryOpenAlex(
  doi: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[]
): Promise<OaCandidate | undefined> {
  try {
    const response = await axios.get(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`, {
      params: {
        select: 'open_access,best_oa_location',
        ...(contactEmail(options) ? { mailto: contactEmail(options) } : {})
      },
      timeout: 20_000,
      headers: { 'User-Agent': 'TwoSCI/0.3.2' }
    });
    const data = response.data as {
      open_access?: { oa_url?: string };
      best_oa_location?: { pdf_url?: string; landing_page_url?: string };
    };
    const candidates = [
      data.best_oa_location?.pdf_url,
      data.open_access?.oa_url,
      data.best_oa_location?.landing_page_url
    ].filter((value): value is string => Boolean(value));
    return tryCandidates('openalex', candidates, destPath, options, attempts);
  } catch (error) {
    attempts.push({
      channel: 'openalex',
      status: 'miss',
      reason: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

export async function trySemanticScholar(
  doi: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[]
): Promise<OaCandidate | undefined> {
  try {
    const response = await axios.get(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}`,
      {
        params: { fields: 'openAccessPdf,isOpenAccess' },
        timeout: 20_000,
        headers: {
          'User-Agent': 'TwoSCI/0.3.2',
          ...(process.env.SEMANTIC_SCHOLAR_API_KEY
            ? { 'x-api-key': process.env.SEMANTIC_SCHOLAR_API_KEY }
            : {})
        }
      }
    );
    const data = response.data as { openAccessPdf?: { url?: string } };
    const candidates = data.openAccessPdf?.url ? [data.openAccessPdf.url] : [];
    return tryCandidates('semantic_scholar', candidates, destPath, options, attempts);
  } catch (error) {
    attempts.push({
      channel: 'semantic_scholar',
      status: 'miss',
      reason: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

export async function tryEuropePmc(
  doi: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[]
): Promise<OaCandidate | undefined> {
  try {
    const response = await axios.get('https://www.ebi.ac.uk/europepmc/webservices/rest/search', {
      params: {
        query: `DOI:"${doi}"`,
        format: 'json',
        resultType: 'core',
        pageSize: 1
      },
      timeout: 20_000,
      headers: { 'User-Agent': 'TwoSCI/0.3.2' }
    });
    const result = (response.data as {
      resultList?: { result?: Array<{
        pmcid?: string;
        fullTextUrlList?: { fullTextUrl?: Array<{ url?: string; documentStyle?: string; availabilityCode?: string }> };
      }> };
    }).resultList?.result?.[0];
    const candidates: string[] = [];
    const push = (value?: string) => {
      if (value && !candidates.includes(value)) candidates.push(value);
    };
    for (const entry of result?.fullTextUrlList?.fullTextUrl || []) {
      if (/pdf/i.test(entry.documentStyle || '') || /^OA$/i.test(entry.availabilityCode || '')) {
        push(entry.url);
      }
    }
    if (result?.pmcid) {
      push(`https://www.ebi.ac.uk/europepmc/webservices/rest/${result.pmcid}/fullTextPDF`);
    }
    return tryCandidates('europepmc', candidates, destPath, options, attempts);
  } catch (error) {
    attempts.push({
      channel: 'europepmc',
      status: 'miss',
      reason: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

export async function tryPmc(
  doi: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[]
): Promise<OaCandidate | undefined> {
  try {
    const response = await axios.get('https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/', {
      params: {
        ids: doi,
        format: 'json',
        tool: 'twosci',
        email: contactEmail(options)
      },
      timeout: 20_000,
      headers: { 'User-Agent': 'TwoSCI/0.3.2' }
    });
    const record = (response.data as {
      records?: Array<{ pmcid?: string }>;
    }).records?.[0];
    const pmcid = record?.pmcid;
    if (!pmcid) {
      attempts.push({ channel: 'pmc', status: 'miss', reason: 'no_pmcid' });
      return undefined;
    }
    return tryCandidates('pmc', [
      `https://europepmc.org/articles/${pmcid}?pdf=render`,
      `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/pdf/`
    ], destPath, options, attempts);
  } catch (error) {
    attempts.push({
      channel: 'pmc',
      status: 'miss',
      reason: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

export async function tryCrossref(
  doi: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[]
): Promise<OaCandidate | undefined> {
  try {
    const response = await axios.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      timeout: 20_000,
      headers: { 'User-Agent': `TwoSCI/0.3.2 (mailto:${contactEmail(options)})` }
    });
    const links = (response.data as {
      message?: { link?: Array<{ URL?: string; 'content-type'?: string }> };
    }).message?.link || [];
    const candidates = links
      .filter(link => /pdf/i.test(link['content-type'] || '') || /\.pdf(?:$|[?#])/i.test(link.URL || ''))
      .map(link => link.URL)
      .filter((value): value is string => Boolean(value));
    return tryCandidates('crossref', candidates, destPath, options, attempts);
  } catch (error) {
    attempts.push({
      channel: 'crossref',
      status: 'miss',
      reason: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}
