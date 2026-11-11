import * as cheerio from 'cheerio';
import {
  inferPublisherProfile,
  inferPublisherProfileFromUrl,
  publisherPdfUrls,
  type PublisherProfile
} from './publisherProfiles.js';

/**
 * TypeScript port of scansci-pdf publisher_pdf_router.py.
 *
 * Deterministic PDF routes first, then links discovered on the landing page.
 * No browser is involved: the caller decides how to fetch the URL.
 */

const PDF_LINK_TEXT_MARKERS = ['pdf', 'download pdf', 'full text pdf', 'view pdf'];
const PDF_URL_MARKERS = ['.pdf', '/pdf', '/epdf', '/pdfdirect', '/pdfft', 'download=true'];
const PDF_JS_DEFAULT_URL_RE =
  /PDFViewerApplicationOptions\.set\(\s*['"]defaultUrl['"]\s*,\s*['"]([^'"]+)['"]/i;

const PLOS_JOURNAL_PATHS: Record<string, string> = {
  pbio: 'plosbiology',
  pcbi: 'ploscompbiol',
  pclm: 'climate',
  pdig: 'digitalhealth',
  pgen: 'plosgenetics',
  pgph: 'globalpublichealth',
  pmed: 'plosmedicine',
  pntd: 'plosntds',
  pone: 'plosone',
  ppat: 'plospathogens',
  pstr: 'sustainabilitytransformation',
  pwat: 'water'
};
const PLOS_DOI_JOURNAL_RE = /^10\.1371\/journal\.([a-z0-9]+)\./i;
const COPERNICUS_DOI_RE =
  /^10\.5194\/(?<journal>[a-z0-9]+)-(?<volume>\d+)-(?<page>.+)-(?<year>\d{4})$/i;

const MDPI_ISSN_JOURNAL_CODES: Record<string, string> = {
  '1424-8220': 's',
  '1660-4601': 'ijerph',
  '1996-1073': 'en',
  '2071-1050': 'su',
  '2072-4292': 'rs',
  '2073-4441': 'w',
  '2075-5309': 'buildings',
  '2077-0375': 'membranes',
  '2227-7390': 'math',
  '2304-8158': 'foods'
};
const MDPI_JOURNAL_CODE_ISSNS: Record<string, string> = Object.fromEntries(
  Object.entries(MDPI_ISSN_JOURNAL_CODES).map(([issn, code]) => [code, issn])
);
const MDPI_NUMERIC_PATH_RE = /\/[0-9]{4}-[0-9Xx]{3,4}\/[0-9]+\/[0-9]+\/[0-9]+$/;
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

export function extractElsevierPii(url: string): string {
  for (const pattern of [
    /\/pii\/([A-Z0-9]+)/i,
    /\/retrieve\/pii\/([A-Z0-9]+)/i,
    /[?&]pii=([A-Z0-9]+)/i,
    /1-s2\.0-([A-Z0-9]+)/i
  ]) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return '';
}

export function extractIeeeArticleNumber(url: string): string {
  for (const pattern of [/\/document\/(\d+)/i, /[?&]arnumber=(\d+)/i]) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return '';
}

export function getMdpiCdnVariants(doi: string): string[] {
  const normalized = doi.trim().toLowerCase();
  const match = normalized.match(/^10\.3390\/([a-z]+)(\d{6,})$/i);
  if (!match) return [];
  const prefix = match[1].toLowerCase();
  const digits = match[2];
  const slug = MDPI_SLUGS[prefix] || prefix;
  const variants: string[] = [];
  const seen = new Set<string>();
  for (const volumeTake of [2, 1]) {
    if (digits.length <= volumeTake + 2) continue;
    const volume = String(parseInt(digits.slice(0, volumeTake), 10)).padStart(2, '0');
    const article = String(parseInt(digits.slice(volumeTake + 2), 10)).padStart(5, '0');
    const base = `${slug}-${volume}-${article}`;
    if (seen.has(base)) continue;
    seen.add(base);
    for (const suffix of ['', '-v2', '-v3', '-v4']) {
      variants.push(`https://mdpi-res.com/d_attachment/${slug}/${base}/article_deploy/${base}${suffix}.pdf`);
    }
  }
  return variants;
}

export function discoverPdfCandidatesFromHtml(html: string, sourceUrl: string): string[] {
  const candidates: string[] = [];
  const $ = cheerio.load(html);

  $('meta').each((_, element) => {
    const node = $(element);
    const key = clean(node.attr('name') || node.attr('property') || node.attr('itemprop')).toLowerCase();
    const content = clean(node.attr('content'));
    if (content && (key.includes('citation_pdf_url') || key.endsWith('pdf_url') || key === 'pdf_url')) {
      appendCandidate(candidates, content, sourceUrl);
      appendQueryPdfCandidates(candidates, content, sourceUrl);
    }
  });

  $('a, link, iframe, embed, object').each((_, element) => {
    const node = $(element);
    const target = clean(node.attr('href') || node.attr('src') || node.attr('data'));
    if (!target) return;
    const label = clean([
      node.text(),
      node.attr('title'),
      node.attr('aria-label')
    ].filter(Boolean).join(' ')).toLowerCase();
    const contentType = clean(node.attr('type')).toLowerCase();
    const lowerTarget = target.toLowerCase();
    if (
      PDF_URL_MARKERS.some(marker => lowerTarget.includes(marker))
      || PDF_LINK_TEXT_MARKERS.some(marker => label.includes(marker))
      || contentType.includes('pdf')
    ) {
      appendCandidate(candidates, target, sourceUrl);
      appendQueryPdfCandidates(candidates, target, sourceUrl);
    }
  });

  $('script').each((_, element) => {
    const text = $(element).text();
    for (const match of text.matchAll(new RegExp(PDF_JS_DEFAULT_URL_RE.source, 'gi'))) {
      const target = decodeHtmlEntities(match[1]);
      if (PDF_URL_MARKERS.some(marker => target.toLowerCase().includes(marker))) {
        appendCandidate(candidates, target, sourceUrl);
        appendQueryPdfCandidates(candidates, target, sourceUrl);
      }
    }
  });

  return candidates;
}

export interface BuildPdfCandidatesOptions {
  sourceUrl?: string;
  discoveredUrls?: string[];
}

export function buildPdfCandidates(
  profile: PublisherProfile,
  doi: string,
  options: BuildPdfCandidatesOptions = {}
): string[] {
  const candidates: string[] = [];
  const sourceUrl = options.sourceUrl || '';
  const pii = extractElsevierPii(sourceUrl);
  const profileName = profile.name.toLowerCase();

  if (profileName === 'elsevier' && pii) {
    appendCandidate(candidates, `https://www.sciencedirect.com/science/article/pii/${pii}/pdfft`);
  }
  const arnumber = extractIeeeArticleNumber(sourceUrl);
  if (profileName === 'ieee' && arnumber) {
    appendCandidate(candidates, `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&isnumber=&arnumber=${arnumber}`);
    appendCandidate(candidates, `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${arnumber}`);
  }
  if (profileName === 'aps') appendApsCandidates(candidates, sourceUrl);
  if (profileName === 'ams') appendAmsCandidates(candidates, sourceUrl);
  if (profileName === 'plos') appendPlosCandidates(candidates, doi, sourceUrl);
  if (profileName === 'copernicus') appendCopernicusCandidates(candidates, doi, sourceUrl);
  if (profileName === 'mdpi') appendMdpiCandidates(candidates, doi, sourceUrl);
  if (profileName === 'oxford academic') appendOxfordCandidates(candidates, doi, sourceUrl);

  appendSourcePathCandidates(candidates, profile, doi, sourceUrl);
  for (const url of publisherPdfUrls(profile, doi)) appendCandidate(candidates, url);

  for (const url of options.discoveredUrls || []) {
    if (!clean(url)) continue;
    if (isSupplementaryUrl(profile, url)) continue;
    if (!isPdfCandidateUrl(profile, url)) continue;
    if (!belongsToCurrentArticle(profile, url, doi, sourceUrl)) continue;
    appendCandidate(candidates, url, sourceUrl);
  }
  return candidates;
}

export function publisherProfileFor(doi: string, sourceUrl?: string): PublisherProfile | undefined {
  return (sourceUrl ? inferPublisherProfileFromUrl(sourceUrl) : undefined) || inferPublisherProfile(doi);
}

export function isPdfCandidateUrl(profile: PublisherProfile, url: string): boolean {
  const lower = url.toLowerCase();
  return lower.endsWith('.pdf') || profile.pdfUrlMarkers.some(marker => lower.includes(marker.toLowerCase()));
}

export function isSupplementaryUrl(profile: PublisherProfile, url: string): boolean {
  const lower = url.toLowerCase();
  return profile.supplementaryUrlMarkers.some(marker => lower.includes(marker.toLowerCase()));
}

export function belongsToCurrentArticle(
  profile: PublisherProfile,
  url: string,
  doi: string,
  sourceUrl = ''
): boolean {
  if (profile.name.toLowerCase() === 'aps') {
    const lower = url.toLowerCase();
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { host = ''; }
    if (host.endsWith('journals.aps.org') || host.endsWith('link.aps.org')) {
      if (lower.includes('/accepted')) return false;
      const doiLower = doi.toLowerCase();
      const doiEscaped = doiLower.replace('/', '%2f');
      if (lower.includes('/pdf/') || lower.includes('/doi/')) {
        return lower.includes(doiLower) || lower.includes(doiEscaped);
      }
    }
    return true;
  }
  if (profile.name.toLowerCase() !== 'elsevier') return true;
  const sourcePii = extractElsevierPii(sourceUrl);
  const candidatePii = extractElsevierPii(url);
  if (sourcePii && candidatePii) return sourcePii.toLowerCase() === candidatePii.toLowerCase();
  const lower = url.toLowerCase();
  const doiLower = doi.toLowerCase();
  const doiEscaped = doiLower.replace('/', '%2f');
  if (sourcePii) return lower.includes(sourcePii.toLowerCase()) || lower.includes(doiLower) || lower.includes(doiEscaped);
  return true;
}

function appendSourcePathCandidates(
  candidates: string[],
  profile: PublisherProfile,
  doi: string,
  sourceUrl: string
): void {
  const normalized = clean(sourceUrl);
  if (!normalized) return;
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { return; }
  const host = parsed.hostname.toLowerCase();
  const sourcePath = parsed.pathname.replace(/\/+$/, '');
  if (!/^https?:$/.test(parsed.protocol) || !host || !sourcePath) return;

  for (const template of profile.pdfSourcePathTemplates) {
    const domain = template.domain.toLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    const prefix = clean(template.pathPrefix);
    if (prefix && !sourcePath.startsWith(prefix)) continue;
    const afterPrefix = prefix ? sourcePath.slice(prefix.length).replace(/^\/+/, '') : sourcePath.replace(/^\/+/, '');
    const candidatePath = formatTemplate(template.pathTemplate, {
      doi,
      doi_quoted: encodeURIComponent(doi),
      doi_suffix: doi.includes('/') ? doi.split('/').slice(1).join('/') : doi,
      doi_suffix_quoted: encodeURIComponent(doi.includes('/') ? doi.split('/').slice(1).join('/') : doi),
      source_path: sourcePath,
      source_path_quoted: encodeURIComponent(sourcePath).replace(/%2F/gi, '/'),
      source_path_after_prefix: afterPrefix,
      source_path_after_prefix_quoted: encodeURIComponent(afterPrefix).replace(/%2F/gi, '/')
    });
    if (!candidatePath) continue;
    if (/^https?:\/\//i.test(candidatePath)) {
      appendCandidate(candidates, candidatePath);
    } else {
      appendCandidate(candidates, candidatePath.startsWith('/') ? candidatePath : `/${candidatePath}`, `${parsed.protocol}//${parsed.host}`);
    }
  }
}

function appendApsCandidates(candidates: string[], sourceUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(clean(sourceUrl)); } catch { return; }
  const host = parsed.hostname.toLowerCase();
  const sourcePath = parsed.pathname.replace(/\/+$/, '');
  if (!/^https?:$/.test(parsed.protocol) || !host || !sourcePath) return;
  if (host.endsWith('link.aps.org') && sourcePath.startsWith('/doi/')) {
    appendCandidate(candidates, `${parsed.protocol}//${parsed.host}${sourcePath.replace('/doi/', '/pdf/')}`);
    return;
  }
  if (!host.endsWith('journals.aps.org')) return;
  if (sourcePath.includes('/abstract/')) {
    appendCandidate(candidates, `${parsed.protocol}//${parsed.host}${sourcePath.replace('/abstract/', '/pdf/')}`);
  } else if (sourcePath.endsWith('/pdf')) {
    appendCandidate(candidates, parsed.toString());
  }
}

function appendAmsCandidates(candidates: string[], sourceUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(clean(sourceUrl)); } catch { return; }
  const host = parsed.hostname.toLowerCase();
  const sourcePath = parsed.pathname.replace(/\/+$/, '');
  if (!/^https?:$/.test(parsed.protocol) || !host.endsWith('journals.ametsoc.org')) return;
  if (!sourcePath.startsWith('/view/') || !sourcePath.toLowerCase().endsWith('.xml')) return;
  const pdfPath = `/downloadpdf${sourcePath.slice(0, -4)}.pdf`;
  appendCandidate(candidates, `${parsed.protocol}//${parsed.host}${pdfPath}`);
}

function appendPlosCandidates(candidates: string[], doi: string, sourceUrl: string): void {
  const journalPath = plosJournalPathFromSource(sourceUrl) || plosJournalPathFromDoi(doi);
  if (!journalPath) return;
  appendCandidate(candidates, `https://journals.plos.org/${journalPath}/article/file?id=${doi}&type=printable`);
}

function plosJournalPathFromSource(sourceUrl: string): string {
  let parsed: URL;
  try { parsed = new URL(clean(sourceUrl)); } catch { return ''; }
  if (parsed.hostname.toLowerCase() !== 'journals.plos.org') return '';
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] === 'article') return '';
  return parts[0];
}

function plosJournalPathFromDoi(doi: string): string {
  const match = doi.trim().match(PLOS_DOI_JOURNAL_RE);
  return match ? (PLOS_JOURNAL_PATHS[match[1].toLowerCase()] || '') : '';
}

function appendCopernicusCandidates(candidates: string[], doi: string, sourceUrl: string): void {
  const match = doi.trim().toLowerCase().match(COPERNICUS_DOI_RE);
  if (!match || !match.groups) return;
  let host = '';
  try { host = new URL(clean(sourceUrl)).hostname.toLowerCase(); } catch { host = ''; }
  if (!host.endsWith('copernicus.org')) host = `${match.groups.journal.toLowerCase()}.copernicus.org`;
  const suffix = doi.split('/').slice(1).join('/').toLowerCase();
  const path = `/articles/${match.groups.volume}/${match.groups.page}/${match.groups.year}/${suffix}.pdf`;
  appendCandidate(candidates, `https://${host}${path}`);
}

function appendMdpiCandidates(candidates: string[], doi: string, sourceUrl: string): void {
  for (const cdn of getMdpiCdnVariants(doi)) appendCandidate(candidates, cdn);
  const sourcePdf = mdpiPdfUrlFromLandingUrl(sourceUrl);
  if (sourcePdf) appendCandidate(candidates, sourcePdf);
  const derivedLanding = mdpiLandingUrlFromDoi(doi);
  const derivedPdf = mdpiPdfUrlFromLandingUrl(derivedLanding);
  if (derivedPdf) appendCandidate(candidates, derivedPdf);
}

function mdpiPdfUrlFromLandingUrl(rawUrl: string): string {
  const candidate = clean(rawUrl);
  if (!candidate) return '';
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { return ''; }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'www.mdpi.com' && host !== 'mdpi.com') return '';
  const path = parsed.pathname.replace(/\/+$/, '');
  if (!path) return '';
  if (path.endsWith('/pdf') || path.includes('/pdf/')) {
    parsed.pathname = path;
    parsed.search = '';
    return parsed.toString();
  }
  if (!MDPI_NUMERIC_PATH_RE.test(path)) return '';
  parsed.pathname = `${path}/pdf`;
  parsed.search = '';
  return parsed.toString();
}

function mdpiLandingUrlFromDoi(doi: string): string {
  const normalized = doi.trim().toLowerCase();
  if (!normalized.startsWith('10.3390/') || !normalized.includes('/')) return '';
  const suffix = normalized.split('/').slice(1).join('/');
  const journalCodes = Object.keys(MDPI_JOURNAL_CODE_ISSNS).sort((a, b) => b.length - a.length);
  for (const journalCode of journalCodes) {
    if (!suffix.startsWith(journalCode)) continue;
    const encoded = suffix.slice(journalCode.length);
    if (encoded.length < 7 || !/^\d+$/.test(encoded)) continue;
    const volume = encoded.slice(0, -6);
    const issue = encoded.slice(-6, -4);
    const articleNumber = encoded.slice(-4);
    if (!volume) continue;
    return `https://www.mdpi.com/${MDPI_JOURNAL_CODE_ISSNS[journalCode]}/${Number(volume)}/${Number(issue)}/${Number(articleNumber)}`;
  }
  return '';
}

function appendOxfordCandidates(candidates: string[], doi: string, sourceUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(clean(sourceUrl)); } catch { return; }
  const host = parsed.hostname.toLowerCase();
  const sourcePath = parsed.pathname.replace(/\/+$/, '');
  if (!/^https?:$/.test(parsed.protocol) || !host.endsWith('academic.oup.com')) return;
  const match = sourcePath.match(/^\/(?<journal>[^/]+)\/article\/(?<rest>.+)$/i);
  if (!match || !match.groups) return;
  const suffix = doi.includes('/') ? doi.split('/').slice(1).join('/') : doi;
  appendCandidate(
    candidates,
    `${parsed.protocol}//${parsed.host}/${match.groups.journal}/article-pdf/${match.groups.rest}/${suffix}.pdf`
  );
}

function formatTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => values[key] ?? '');
}

function appendCandidate(candidates: string[], candidate: string | null | undefined, sourceUrl = ''): void {
  const normalized = clean(candidate);
  if (!normalized) return;
  let absolute = normalized;
  if (sourceUrl) {
    try { absolute = new URL(normalized, sourceUrl).toString(); } catch { return; }
  }
  let parsed: URL;
  try { parsed = new URL(absolute); } catch { return; }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) return;
  if (!candidates.includes(absolute)) candidates.push(absolute);
}

function appendQueryPdfCandidates(candidates: string[], candidate: string, sourceUrl: string): void {
  let absolute: string;
  try { absolute = new URL(clean(candidate), sourceUrl).toString(); } catch { return; }
  let parsed: URL;
  try { parsed = new URL(absolute); } catch { return; }
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!['file', 'pdf', 'src', 'url'].includes(key.toLowerCase())) continue;
    if (PDF_URL_MARKERS.some(marker => value.toLowerCase().includes(marker))) {
      appendCandidate(candidates, value, absolute);
    }
  }
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
