import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserContext, Page } from 'patchright';
import { discoverPdfCandidatesFromHtml } from './publisherPdfRouter.js';
import type { CookieRecord } from './institutionalAccess.js';

/**
 * Patchright + local Chrome/Edge browser resolver, ported from scansci-pdf's
 * browser_pdf flow. The browser is only used when HTTP/API routes fail.
 *
 * Cloudflare/Akamai:
 * - Patchright removes the usual Playwright automation leaks.
 * - Local Chrome channel is preferred over bundled Chromium.
 * - A persistent profile keeps challenge cookies across downloads.
 * - Headless is attempted first; auto mode relaunches headed when a challenge
 *   does not clear (MDPI/Akamai blocks headless Chrome even with Patchright).
 */

export interface BrowserResolveOptions {
  doi?: string;
  timeoutMs?: number;
  challengeTimeoutMs?: number;
}

export interface BrowserResolveResult {
  success: boolean;
  pdf?: Buffer;
  pdfUrl?: string;
  pdfUrls?: string[];
  cookies: CookieRecord[];
  finalUrl?: string;
  title?: string;
  authRequired?: boolean;
  challenge?: boolean;
  attempts: string[];
}

type PatchrightModule = typeof import('patchright');

const CHALLENGE_MARKERS = [
  'just a moment',
  'checking your browser',
  'verify you are human',
  'enable javascript and cookies',
  'access denied',
  'attention required',
  'please wait',
  '请稍候',
  '正在进行安全验证',
  '安全验证',
  '人机验证',
  'captcha',
  'robot'
];
const LOGIN_MARKERS = [
  '统一身份认证',
  '身份认证',
  '请登录',
  'sign in to continue',
  'log in to continue'
];

let patchrightModule: PatchrightModule | undefined;

async function loadPatchright(): Promise<PatchrightModule | undefined> {
  if (patchrightModule) return patchrightModule;
  try {
    patchrightModule = await import('patchright');
    return patchrightModule;
  } catch {
    return undefined;
  }
}

export async function isPatchrightAvailable(): Promise<boolean> {
  return Boolean(await loadPatchright());
}

export function isChallengePage(title: string, body: string, url: string): boolean {
  const text = `${title} ${body} ${url}`.toLowerCase();
  return CHALLENGE_MARKERS.some(marker => text.includes(marker));
}

export function isLoginPage(title: string, body: string, url: string): boolean {
  const text = `${title} ${body}`.toLowerCase();
  const lowerUrl = url.toLowerCase();
  if (/(?:^|\/)(?:cas|login|sso|auth)(?:\/|$|\?)/i.test(lowerUrl)) return true;
  if (LOGIN_MARKERS.some(marker => text.includes(marker))) return true;
  return text.length < 3000
    && /(?:^|\s)(?:login|sign in|log in)(?:\s|$)/i.test(text)
    && !/citation_pdf_url|download pdf|full text/i.test(text);
}

export function buildBrowserPdfPaths(doi: string, currentUrl: string): string[] {
  let host = '';
  try { host = new URL(currentUrl).hostname.toLowerCase(); } catch { host = ''; }
  const paths: string[] = [];
  if (host.includes('sciencedirect') || host.includes('elsevier')) {
    const pii = currentUrl.match(/pii\/([A-Z0-9]+)/i);
    if (pii) paths.push(`/science/article/pii/${pii[1]}/pdfft`);
    if (doi) paths.push(`/doi/pdfdirect/${doi}`);
  } else if (host.includes('springer')) {
    if (doi) paths.push(`/content/pdf/${doi}.pdf`);
  } else if (host.includes('wiley')) {
    if (doi) {
      paths.push(`/doi/pdfdirect/${doi}`);
      paths.push(`/doi/pdf/${doi}`);
    }
  }
  if (doi) paths.push(`/doi/pdf/${doi}`);
  return paths;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class BrowserResolver {
  private context?: BrowserContext;
  private headless = resolveHeadless();
  private idleTimer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();

  async resolve(
    landingUrl: string,
    options: BrowserResolveOptions = {}
  ): Promise<BrowserResolveResult> {
    return this.withLock(() => this.resolveLocked(landingUrl, options, false));
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    const context = this.context;
    this.context = undefined;
    if (context) {
      try { await context.close(); } catch { /* already closed */ }
    }
  }

  async status(): Promise<Record<string, unknown>> {
    return {
      available: await isPatchrightAvailable(),
      channel: process.env.TWOSCI_BROWSER_CHANNEL || 'auto',
      headless_mode: process.env.TWOSCI_BROWSER_HEADLESS || 'auto',
      effective_headless: this.headless,
      profile_dir: profileDir()
    };
  }

  private async resolveLocked(
    landingUrl: string,
    options: BrowserResolveOptions,
    escalated: boolean
  ): Promise<BrowserResolveResult> {
    const attempts: string[] = [];
    let context: BrowserContext | undefined;
    try {
      context = await this.ensureContext();
    } catch (error) {
      return {
        success: false,
        cookies: [],
        attempts: [`launch_error:${describeError(error)}`]
      };
    }
    if (!context) {
      return { success: false, cookies: [], attempts: ['patchright unavailable'] };
    }
    const page = await context.newPage();
    const cookies: CookieRecord[] = [];
    try {
      page.setDefaultTimeout(options.timeoutMs ?? 30000);
      attempts.push(`navigate:${landingUrl}`);
      let navigationStatus: number | undefined;
      try {
        const navigation = await page.goto(landingUrl, {
          waitUntil: 'domcontentloaded',
          timeout: options.timeoutMs ?? 45000
        });
        navigationStatus = navigation?.status();
      } catch (error) {
        attempts.push(`navigate_error:${describeError(error)}`);
      }

      const challengeTimeout = navigationStatus === 403
        ? Math.min(4000, options.challengeTimeoutMs ?? 30000)
        : (options.challengeTimeoutMs ?? 30000);
      const cleared = await this.waitForChallenge(page, challengeTimeout);
      if (!cleared && !escalated && this.headless && allowHeadedEscalation()) {
        attempts.push('challenge:headless_failed_relaunch_headed');
        await this.close();
        this.headless = false;
        return this.resolveLocked(landingUrl, options, true);
      }
      if (!cleared) {
        return {
          success: false,
          cookies: await this.readCookies(context),
          finalUrl: page.url(),
          title: await page.title().catch(() => ''),
          challenge: true,
          attempts
        };
      }

      await this.handleLinkingHub(page, options.doi || '', attempts);
      const pdfLink = await this.extractPdfLink(page);
      const title = await page.title().catch(() => '');
      const body = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
      if (!pdfLink && isLoginPage(title, body, page.url())) {
        attempts.push('login_required');
        return {
          success: false,
          authRequired: true,
          cookies: await this.readCookies(context),
          finalUrl: page.url(),
          title,
          attempts
        };
      }

      if (pdfLink) attempts.push(`pdf_link:${pdfLink}`);
      const currentUrl = page.url();
      const origin = safeOrigin(currentUrl);
      const allUrls = uniqueUrls([
        ...(pdfLink ? [pdfLink] : []),
        ...buildBrowserPdfPaths(options.doi || '', currentUrl).map(candidate =>
          candidate.startsWith('/') ? `${origin}${candidate}` : candidate
        )
      ]);

      const captured = await this.capturePdfs(page, context, allUrls, currentUrl, attempts);
      const pdf = captured.pdf;
      return {
        success: Boolean(pdf),
        ...(pdf ? { pdf } : {}),
        ...(captured.pdfUrl ? { pdfUrl: captured.pdfUrl } : {}),
        pdfUrls: allUrls,
        cookies: await this.readCookies(context),
        finalUrl: page.url(),
        title,
        attempts
      };
    } catch (error) {
      attempts.push(`error:${describeError(error)}`);
      return {
        success: false,
        cookies,
        finalUrl: page.url(),
        title: await page.title().catch(() => ''),
        attempts
      };
    } finally {
      try { await page.close(); } catch { /* already closed */ }
      this.touch();
    }
  }

  private async ensureContext(): Promise<BrowserContext | undefined> {
    if (this.context) return this.context;
    const patchright = await loadPatchright();
    if (!patchright) return undefined;
    const channels = configuredChannels();
    let lastError: unknown;
    for (const channel of channels) {
      try {
        const context = await patchright.chromium.launchPersistentContext(profileDir(), {
          channel,
          headless: this.headless,
          viewport: null,
          acceptDownloads: true,
          ignoreDefaultArgs: ['--enable-automation'],
          args: [
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-sync',
            '--metrics-recording-only'
          ]
        });
        await context.route('**/*', route => {
          if (process.env.TWOSCI_BROWSER_BLOCK_RESOURCES === 'false') return route.continue();
          const type = route.request().resourceType();
          if (type === 'image' || type === 'media' || type === 'font') return route.abort();
          return route.continue();
        });
        this.context = context;
        return context;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Patchright could not launch Chrome/Edge: ${describeError(lastError)}`);
  }

  private async waitForChallenge(page: Page, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const title = await page.title().catch(() => '');
      const body = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
      if (!isChallengePage(title, body, page.url())) return true;
      if (process.env.TWOSCI_BROWSER_TURNSTILE_CLICK === 'true') {
        await this.tryTurnstileClick(page);
      }
      await page.waitForTimeout(1000).catch(() => undefined);
    }
    const title = await page.title().catch(() => '');
    const body = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
    return !isChallengePage(title, body, page.url());
  }

  private async tryTurnstileClick(page: Page): Promise<void> {
    try {
      const frame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]');
      const checkbox = frame.locator('input[type="checkbox"]');
      if (await checkbox.count() > 0) {
        await checkbox.first().click({ timeout: 1500 });
      }
    } catch {
      // Turnstile may be in a closed shadow root or require interaction
    }
  }

  private async handleLinkingHub(page: Page, doi: string, attempts: string[]): Promise<void> {
    const currentUrl = page.url();
    if (!/linkinghub|retrieve\/pii/i.test(currentUrl)) return;
    attempts.push('linkinghub:wait_redirect');
    await page.waitForTimeout(5000).catch(() => undefined);
    if (/linkinghub/i.test(page.url())) {
      const pii = page.url().match(/pii\/([A-Z0-9]+)/i);
      if (pii) {
        const direct = `https://www.sciencedirect.com/science/article/pii/${pii[1]}`;
        await page.goto(direct, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
        await page.waitForTimeout(3000).catch(() => undefined);
        attempts.push(`linkinghub->${direct}`);
      }
    }
  }

  private async extractPdfLink(page: Page): Promise<string | undefined> {
    try {
      const link = await page.evaluate(() => {
        const meta = document.querySelector('meta[name="citation_pdf_url"]') as HTMLMetaElement | null;
        if (meta?.content) return meta.content;
        const labelled = document.querySelector('a[aria-label*="PDF" i], a[title*="PDF" i]') as HTMLAnchorElement | null;
        if (labelled?.href) return labelled.href;
        for (const anchor of Array.from(document.querySelectorAll('a'))) {
          const href = (anchor.href || '').toLowerCase();
          const text = (anchor.textContent || '').toLowerCase();
          if (href.includes('/pdfft') || href.includes('/pdfdirect')) return anchor.href;
          if (href.includes('pdf') && !href.includes('supplement') && !href.includes('cite')) return anchor.href;
          if (text.includes('pdf') && (text.includes('download') || text.includes('view'))) return anchor.href;
        }
        return null;
      });
      return typeof link === 'string' ? link : undefined;
    } catch {
      return undefined;
    }
  }

  private async capturePdfs(
    page: Page,
    context: BrowserContext,
    urls: string[],
    referer: string,
    attempts: string[]
  ): Promise<{ pdf?: Buffer; pdfUrl?: string }> {
    const captured: Array<{ buffer: Buffer; url: string }> = [];
    const onResponse = async (response: import('patchright').Response): Promise<void> => {
      try {
        const contentType = (response.headers()['content-type'] || '').toLowerCase();
        if (!contentType.includes('pdf') && !contentType.includes('octet')) return;
        const body = await response.body();
        if (body.subarray(0, 5).toString('ascii') === '%PDF-') {
          captured.push({ buffer: body, url: response.url() });
        }
      } catch {
        // redirect/download responses may not expose a body
      }
    };
    const onDownload = async (download: import('patchright').Download): Promise<void> => {
      try {
        const filePath = await download.path();
        if (!filePath) return;
        const buffer = fs.readFileSync(filePath);
        if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
          captured.push({ buffer, url: download.url() });
        }
      } catch {
        // download may have been cancelled
      }
    };
    page.on('response', onResponse);
    page.on('download', onDownload);
    try {
      for (const url of urls) {
        if (captured.length > 0) break;
        attempts.push(`pdf_navigate:${url}`);
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.waitForChallenge(page, 6000);
        } catch (error) {
          attempts.push(`pdf_navigate_error:${describeError(error)}`);
        }
        if (captured.length > 0) break;

        try {
          const response = await context.request.get(url, {
            headers: { Referer: referer },
            timeout: 30000
          });
          const body = Buffer.from(await response.body());
          if (body.subarray(0, 5).toString('ascii') === '%PDF-') {
            captured.push({ buffer: body, url });
          }
        } catch (error) {
          attempts.push(`context_request_error:${describeError(error)}`);
        }

        if (captured.length === 0) {
          const viewerUrl = await page.evaluate(() => {
            const object = document.querySelector('object[type="application/pdf"]') as HTMLObjectElement | null;
            const embed = document.querySelector('embed[type="application/pdf"]') as HTMLEmbedElement | null;
            const iframe = document.querySelector('iframe[src*="pdf"]') as HTMLIFrameElement | null;
            return object?.data || embed?.src || iframe?.src || null;
          }).catch(() => null);
          if (viewerUrl && typeof viewerUrl === 'string') {
            const absolute = new URL(viewerUrl, page.url()).toString();
            try {
              await page.goto(absolute, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await page.waitForTimeout(2000);
            } catch {
              // viewer may be an embedded PDF that already fired a response
            }
          }
        }
      }
    } finally {
      page.off('response', onResponse);
      page.off('download', onDownload);
    }

    const valid = captured
      .filter(item => item.buffer.length > 5000)
      .sort((left, right) => right.buffer.length - left.buffer.length);
    return valid.length > 0
      ? { pdf: valid[0].buffer, pdfUrl: valid[0].url }
      : {};
  }

  private async readCookies(context: BrowserContext): Promise<CookieRecord[]> {
    try {
      return (await context.cookies()).map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly
      }));
    } catch {
      return [];
    }
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const idleMs = Number(process.env.TWOSCI_BROWSER_IDLE_MS || 300000);
    this.idleTimer = setTimeout(() => { void this.close(); }, Number.isFinite(idleMs) ? idleMs : 300000);
    this.idleTimer.unref?.();
  }

  private async withLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

function resolveHeadless(): boolean {
  const value = (process.env.TWOSCI_BROWSER_HEADLESS || 'auto').toLowerCase();
  if (value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  return true;
}

function allowHeadedEscalation(): boolean {
  return (process.env.TWOSCI_BROWSER_HEADLESS || 'auto').toLowerCase() === 'auto';
}

function configuredChannels(): string[] {
  const configured = (process.env.TWOSCI_BROWSER_CHANNEL || 'auto').toLowerCase();
  if (configured === 'auto') return ['chrome', 'msedge'];
  return [configured];
}

function profileDir(): string {
  return process.env.TWOSCI_BROWSER_PROFILE_DIR
    || path.join(os.homedir(), '.twosci', 'browser-profile');
}

function safeOrigin(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

let sharedResolver: BrowserResolver | undefined;

export function getBrowserResolver(): BrowserResolver {
  if (!sharedResolver) {
    sharedResolver = new BrowserResolver();
    process.once('beforeExit', () => { void sharedResolver?.close(); });
  }
  return sharedResolver;
}
