import * as fs from 'node:fs';
import axios from 'axios';
import {
  buildPdfCandidates,
  discoverPdfCandidatesFromHtml,
  publisherProfileFor
} from './publisherPdfRouter.js';
import {
  tryArxiv,
  tryCrossref,
  tryEuropePmc,
  tryOpenAlex,
  tryPmc,
  trySemanticScholar,
  tryUnpaywall
} from './openAccess.js';
import {
  buildInstitutionalTargets,
  carsiCookieFileForDoi,
  cookieHeaderForUrl,
  loadCookies,
  loadInstitutionalConfig,
  type InstitutionalConfig
} from './institutionalAccess.js';
import { downloadPdfToFile, fetchHtml } from './pdfDownload.js';
import { getBrowserResolver, type BrowserResolveResult } from './browserResolver.js';
import type { DownloadAttempt, PdfFetchOptions, PdfFetchResult } from './types.js';

/**
 * Native PDF acquisition pipeline, ported from scansci-pdf's PaperFetcher.
 *
 * Order: direct/record link -> arXiv -> Unpaywall -> OpenAlex ->
 * Semantic Scholar -> Europe PMC -> PMC -> Crossref -> Elsevier API ->
 * publisher URL construction (CARSI/WebVPN) -> landing-page link discovery.
 *
 * Browser-only flows are intentionally separate: this module never shells out.
 */

export function normalizeDoi(value: string): string | undefined {
  const trimmed = value.trim().replace(/^doi:\s*/i, '');
  if (/^10\.\d{4,9}\//i.test(trimmed)) return trimmed.replace(/[.,;)\s]+$/, '').toLowerCase();
  const match = trimmed.match(/(10\.\d{4,9}\/[^\s&?#]+)/i);
  return match ? match[1].replace(/[.,;)\s]+$/, '').toLowerCase() : undefined;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function isLikelyPdfUrl(value: string): boolean {
  return /\.pdf(?:$|[?#])/i.test(value)
    || /\/pdf(?:ft|direct)?(?:$|[?#/])/i.test(value)
    || /[?&](?:type|format)=pdf(?:&|$)/i.test(value);
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attempt(
  channel: string,
  url: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[],
  headers?: Record<string, string>
): Promise<boolean> {
  try {
    await downloadPdfToFile(url, destPath, {
      headers,
      timeoutMs: options.timeoutMs ?? 20_000,
      minBytes: options.minBytes
    });
    attempts.push({ channel, status: 'success', url });
    return true;
  } catch (error) {
    attempts.push({ channel, status: 'miss', url, reason: errorReason(error) });
    return false;
  }
}

async function resolveDoiLanding(doi: string): Promise<string | undefined> {
  try {
    const response = await axios.get(`https://doi.org/${encodeURIComponent(doi)}`, {
      maxRedirects: 5,
      timeout: 15_000,
      headers: { 'User-Agent': 'TwoSCI/0.3.2' },
      validateStatus: status => status < 400
    });
    const finalUrl = String(
      (response.request as { res?: { responseUrl?: string } })?.res?.responseUrl
      || `https://doi.org/${doi}`
    );
    return finalUrl === `https://doi.org/${doi}` ? undefined : finalUrl;
  } catch {
    return undefined;
  }
}

async function tryElsevierApi(
  doi: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[]
): Promise<boolean> {
  if (!/^10\.1016\//i.test(doi) || !options.elsevierApiKey) return false;
  const url = `https://api.elsevier.com/content/article/doi/${encodeURIComponent(doi)}?httpAccept=application/pdf`;
  return attempt('elsevier_api', url, destPath, options, attempts, {
    'X-ELS-APIKey': options.elsevierApiKey
  });
}

async function tryPublisherCandidate(
  candidate: string,
  doi: string,
  landingUrl: string | undefined,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[],
  config: InstitutionalConfig | undefined
): Promise<boolean> {
  if (config && doi) {
    for (const target of buildInstitutionalTargets(candidate, doi, config)) {
      const ok = await attempt(
        `publisher_${target.channel}`,
        target.url,
        destPath,
        options,
        attempts,
        {
          ...(target.cookieHeader ? { Cookie: target.cookieHeader } : {}),
          ...(landingUrl ? { Referer: landingUrl } : {})
        }
      );
      if (ok) return true;
    }
  }
  return attempt('publisher', candidate, destPath, options, attempts, {
    ...(landingUrl ? { Referer: landingUrl } : {})
  });
}

async function tryPublisherCandidates(
  candidates: string[],
  doi: string,
  landingUrl: string | undefined,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[],
  config: InstitutionalConfig | undefined
): Promise<boolean> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (await tryPublisherCandidate(candidate, doi, landingUrl, destPath, options, attempts, config)) {
      return true;
    }
  }
  return false;
}

async function discoverLandingCandidates(
  landingUrl: string,
  doi: string,
  destPath: string,
  options: PdfFetchOptions,
  attempts: DownloadAttempt[],
  config: InstitutionalConfig | undefined
): Promise<boolean> {
  const profile = publisherProfileFor(doi, landingUrl);
  const directCookieFile = config && doi ? carsiCookieFileForDoi(doi, config) : '';
  const directCookie = directCookieFile
    ? cookieHeaderForUrl(loadCookies(directCookieFile), landingUrl)
    : undefined;

  const attemptsToFetch: Array<{ url: string; cookie?: string; channel: string }> = [
    { url: landingUrl, cookie: directCookie, channel: 'landing' }
  ];
  if (config?.webVpnEnabled && config.webVpnBaseUrl) {
    for (const target of buildInstitutionalTargets(landingUrl, doi, config)) {
      if (target.channel === 'webvpn') {
        attemptsToFetch.push({ url: target.url, cookie: target.cookieHeader, channel: 'landing_webvpn' });
      }
    }
  }

  for (const entry of attemptsToFetch) {
    try {
      const page = await fetchHtml(entry.url, {
        timeoutMs: options.timeoutMs,
        headers: {
          ...(entry.cookie ? { Cookie: entry.cookie } : {}),
          ...(landingUrl ? { Referer: landingUrl } : {})
        }
      });
      attempts.push({ channel: entry.channel, status: 'miss', url: entry.url, reason: 'html_loaded' });
      const discovered = discoverPdfCandidatesFromHtml(page.html, page.finalUrl);
      const candidates = profile
        ? buildPdfCandidates(profile, doi, { sourceUrl: page.finalUrl, discoveredUrls: discovered })
        : discovered;
      if (await tryPublisherCandidates(candidates, doi, page.finalUrl, destPath, options, attempts, config)) {
        return true;
      }
      if (entry.cookie) {
        for (const candidate of candidates) {
          const ok = await attempt('landing_link', candidate, destPath, options, attempts, {
            Cookie: entry.cookie,
            Referer: page.finalUrl
          });
          if (ok) return true;
        }
      }
    } catch (error) {
      attempts.push({
        channel: entry.channel,
        status: 'miss',
        url: entry.url,
        reason: errorReason(error)
      });
    }
  }
  return false;
}

export async function fetchPdf(
  input: string,
  destPath: string,
  options: PdfFetchOptions = {}
): Promise<PdfFetchResult> {
  const attempts: DownloadAttempt[] = [];
  const doi = options.doi || normalizeDoi(input);
  const inputUrl = isHttpUrl(input) ? input.trim() : undefined;
  const landingUrl = options.landingUrl
    || options.record?.url
    || (inputUrl && !isLikelyPdfUrl(inputUrl) ? inputUrl : undefined);
  const directUrl = options.record?.pdfUrl
    || (inputUrl && isLikelyPdfUrl(inputUrl) ? inputUrl : undefined);

  if (directUrl && await attempt('record_pdf', directUrl, destPath, options, attempts)) {
    return { success: true, channel: 'record_pdf', url: directUrl, attempts };
  }

  if (doi) {
    const arxiv = await tryArxiv(doi, destPath, options, attempts);
    if (arxiv) return { success: true, channel: arxiv.channel, url: arxiv.url, attempts };

    const unpaywall = await tryUnpaywall(doi, destPath, options, attempts);
    if (unpaywall) return { success: true, channel: unpaywall.channel, url: unpaywall.url, attempts };

    const openalex = await tryOpenAlex(doi, destPath, options, attempts);
    if (openalex) return { success: true, channel: openalex.channel, url: openalex.url, attempts };

    const semantic = await trySemanticScholar(doi, destPath, options, attempts);
    if (semantic) return { success: true, channel: semantic.channel, url: semantic.url, attempts };

    const europePmc = await tryEuropePmc(doi, destPath, options, attempts);
    if (europePmc) return { success: true, channel: europePmc.channel, url: europePmc.url, attempts };

    const pmc = await tryPmc(doi, destPath, options, attempts);
    if (pmc) return { success: true, channel: pmc.channel, url: pmc.url, attempts };

    const crossref = await tryCrossref(doi, destPath, options, attempts);
    if (crossref) return { success: true, channel: crossref.channel, url: crossref.url, attempts };

    if (await tryElsevierApi(doi, destPath, options, attempts)) {
      return { success: true, channel: 'elsevier_api', attempts };
    }
  }

  const resolvedLanding = landingUrl
    || (doi ? await resolveDoiLanding(doi) : undefined)
    || (doi ? `https://doi.org/${doi}` : undefined);
  const config = loadInstitutionalConfig();
  const profile = doi ? publisherProfileFor(doi, resolvedLanding) : undefined;

  if (profile) {
    const constructed = buildPdfCandidates(profile, doi!, { sourceUrl: resolvedLanding || '' });
    if (await tryPublisherCandidates(constructed, doi!, resolvedLanding, destPath, options, attempts, config)) {
      return { success: true, channel: 'publisher_constructed', attempts };
    }
  }

  if (resolvedLanding && isLikelyPdfUrl(resolvedLanding)) {
    if (await attempt('landing_pdf', resolvedLanding, destPath, options, attempts)) {
      return { success: true, channel: 'landing_pdf', url: resolvedLanding, attempts };
    }
  }

  if (resolvedLanding && await discoverLandingCandidates(
    resolvedLanding,
    doi || '',
    destPath,
    options,
    attempts,
    config
  )) {
    const success = attempts.find(item => item.status === 'success');
    return { success: true, channel: success?.channel, url: success?.url, attempts };
  }

  if (resolvedLanding
    && process.env.NODE_ENV !== 'test'
    && process.env.TWOSCI_BROWSER_ENABLED !== 'false') {
    let browser: BrowserResolveResult | undefined;
    try {
      browser = await getBrowserResolver().resolve(resolvedLanding, { doi });
    } catch (error) {
      attempts.push({
        channel: 'browser',
        status: 'error',
        reason: error instanceof Error ? error.message : String(error)
      });
    }
    if (!browser) {
      return { success: false, attempts, message: 'Browser fallback failed to start.' };
    }
    if (browser.pdf) {
      fs.writeFileSync(destPath, browser.pdf);
      attempts.push({ channel: 'browser', status: 'success', url: browser.pdfUrl });
      return { success: true, channel: 'browser', url: browser.pdfUrl, attempts };
    }
    const cookieHeader = browser.cookies.length > 0
      ? cookieHeaderForUrl(browser.cookies, browser.finalUrl || resolvedLanding)
      : undefined;
    for (const pdfUrl of browser.pdfUrls || []) {
      const ok = await attempt('browser_cookie', pdfUrl, destPath, options, attempts, {
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...(browser.finalUrl ? { Referer: browser.finalUrl } : {})
      });
      if (ok) return { success: true, channel: 'browser_cookie', url: pdfUrl, attempts };
    }
    if (browser.authRequired) {
      attempts.push({ channel: 'browser', status: 'blocked', reason: 'auth_required' });
    } else if (browser.challenge) {
      attempts.push({ channel: 'browser', status: 'blocked', reason: 'challenge_not_solved' });
    } else if (browser.attempts.length > 0) {
      attempts.push({ channel: 'browser', status: 'miss', reason: browser.attempts.slice(-3).join(' | ') });
    }
  }

  return {
    success: false,
    attempts,
    message: doi
      ? `No PDF acquired for DOI ${doi}. Tried OA sources, publisher routes and institutional access.`
      : 'No PDF acquired. Provide a DOI or a direct PDF URL.'
  };
}
