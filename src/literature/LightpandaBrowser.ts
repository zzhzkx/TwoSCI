import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import type { CookieRecord } from './InstitutionalAccess.js';

/**
 * Lightweight headless-browser bridge for PDF landing pages.
 *
 * Lightpanda (https://github.com/lightpanda-io/browser) speaks CDP, so the
 * browser is only used to execute the landing page and collect cookies plus
 * PDF links. The final PDF bytes are still fetched over plain HTTPS.
 *
 * Windows has no native Lightpanda binary; the managed copy under
 * ~/.twosci/bin/lightpanda is executed through WSL2.
 */

export interface LightpandaRuntime {
  kind: 'cdp' | 'native' | 'wsl';
  description: string;
}

export interface BrowserPageResult {
  finalUrl: string;
  title: string;
  pdfUrls: string[];
  cookies: CookieRecord[];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface CdpSocket extends WebSocket {
  __pending?: Map<number, PendingRequest>;
}

const MANAGED_BINARY = path.join(os.homedir(), '.twosci', 'bin', 'lightpanda');
const DEFAULT_PORT = 9222;
let runtimeCache: { key: string; value: LightpandaRuntime | undefined; checkedAt: number } | undefined;

function wslDistro(): string {
  const configured = process.env.LIGHTPANDA_WSL_DISTRO;
  if (configured) return configured;
  try {
    const result = spawnSync('wsl', ['-l', '-q'], { encoding: 'buffer', timeout: 5000 });
    const text = Buffer.from(result.stdout || [])
      .toString('utf16le')
      .replace(/\0/g, '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    return text[0] || 'Ubuntu-24.04';
  } catch {
    return 'Ubuntu-24.04';
  }
}

function toWslPath(windowsPath: string): string {
  const match = path.resolve(windowsPath).match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) return windowsPath;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function commandExists(command: string): boolean {
  const probe = process.platform === 'win32'
    ? spawnSync('where', [command], { timeout: 5000 })
    : spawnSync('sh', ['-lc', `command -v "${command}"`], { timeout: 5000 });
  return probe.status === 0;
}

function wslHasBinary(binary: string): boolean {
  const probe = spawnSync(
    'wsl',
    ['-d', wslDistro(), '--', 'bash', '-lc', binary.includes('/') ? `test -x "${binary}"` : `command -v "${binary}"`],
    { timeout: 8000 }
  );
  return probe.status === 0;
}

export function detectLightpandaRuntime(): LightpandaRuntime | undefined {
  const cacheKey = [
    process.env.LIGHTPANDA_CDP_URL || '',
    process.env.LIGHTPANDA_BIN || '',
    process.env.LIGHTPANDA_WSL_DISTRO || ''
  ].join('|');
  if (runtimeCache && runtimeCache.key === cacheKey && Date.now() - runtimeCache.checkedAt < 60_000) {
    return runtimeCache.value;
  }
  const runtime = detectLightpandaRuntimeUncached();
  runtimeCache = { key: cacheKey, value: runtime, checkedAt: Date.now() };
  return runtime;
}

function detectLightpandaRuntimeUncached(): LightpandaRuntime | undefined {
  if (process.env.LIGHTPANDA_CDP_URL) {
    return { kind: 'cdp', description: `external CDP ${process.env.LIGHTPANDA_CDP_URL}` };
  }

  const explicitBin = process.env.LIGHTPANDA_BIN;
  if (process.platform !== 'win32') {
    if (explicitBin) return { kind: 'native', description: explicitBin };
    if (fs.existsSync(MANAGED_BINARY)) return { kind: 'native', description: MANAGED_BINARY };
    if (commandExists('lightpanda')) return { kind: 'native', description: 'lightpanda (PATH)' };
    return undefined;
  }

  const wslBinary = explicitBin
    ? (path.isAbsolute(explicitBin) ? toWslPath(explicitBin) : explicitBin)
    : (fs.existsSync(MANAGED_BINARY) ? toWslPath(MANAGED_BINARY) : 'lightpanda');
  if (wslHasBinary(wslBinary)) {
    return { kind: 'wsl', description: `WSL ${wslDistro()} ${wslBinary}` };
  }
  return undefined;
}

export function extractPdfUrls(candidates: string[], baseUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || /^(?:javascript|data|mailto):/i.test(candidate)) continue;
    let absolute: string;
    try {
      absolute = new URL(candidate, baseUrl).toString();
    } catch {
      continue;
    }
    const looksLikePdf = /\.pdf(?:$|[?#])/i.test(absolute)
      || /\/pdf(?:ft)?(?:$|[?#/])/i.test(absolute)
      || /[?&](?:type|format)=pdf(?:&|$)/i.test(absolute)
      || /citation_pdf_url/i.test(absolute);
    if (!looksLikePdf || seen.has(absolute)) continue;
    seen.add(absolute);
    urls.push(absolute);
  }
  return urls.slice(0, 10);
}

export class LightpandaBrowser {
  private child?: ChildProcess;
  private port = Number(process.env.LIGHTPANDA_PORT || DEFAULT_PORT);
  private requestId = 0;

  runtime(): LightpandaRuntime | undefined {
    return detectLightpandaRuntime();
  }

  async ensureStarted(): Promise<boolean> {
    if (process.env.LIGHTPANDA_CDP_URL) return true;
    if (await this.ping()) return true;
    const runtime = this.runtime();
    if (!runtime || runtime.kind === 'cdp') return false;

    const commonArgs = ['serve', '--port', String(this.port), '--log-level', 'error'];
    if (runtime.kind === 'native') {
      this.child = spawn(runtime.description, ['--host', '127.0.0.1', ...commonArgs], {
        stdio: 'ignore',
        windowsHide: true
      });
    } else {
      const binary = runtime.description.replace(/^WSL \S+ /, '');
      this.child = spawn(
        'wsl',
        ['-d', wslDistro(), '--', binary, '--host', '0.0.0.0', '--advertise-host', '127.0.0.1', ...commonArgs],
        { stdio: 'ignore', windowsHide: true }
      );
    }
    this.child.on('exit', () => { this.child = undefined; });

    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (await this.ping()) return true;
    }
    return false;
  }

  async fetchPage(
    rawUrl: string,
    options: { cookies?: CookieRecord[]; timeoutMs?: number; settleMs?: number } = {}
  ): Promise<BrowserPageResult | undefined> {
    if (!(await this.ensureStarted())) return undefined;
    const timeoutMs = options.timeoutMs ?? 20000;
    const settleMs = options.settleMs ?? 5000;

    let targetId: string | undefined;
    let socket: WebSocket | undefined;
    try {
      socket = await this.connect();
      const created = await this.send(socket, 'Target.createTarget', { url: 'about:blank' }) as { targetId: string };
      targetId = created.targetId;
      const attached = await this.send(socket, 'Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
      const sessionId = attached.sessionId;

      await this.send(socket, 'Page.enable', {}, sessionId);
      await this.send(socket, 'Runtime.enable', {}, sessionId);
      await this.send(socket, 'Network.enable', {}, sessionId);
      if (options.cookies && options.cookies.length > 0) {
        await this.send(socket, 'Network.setCookies', {
          cookies: options.cookies
            .filter(cookie => cookie.domain || cookie.name)
            .map(cookie => ({
              name: cookie.name,
              value: cookie.value,
              ...(cookie.domain ? { domain: cookie.domain } : {}),
              path: cookie.path || '/',
              ...(cookie.expires && cookie.expires > 0 ? { expires: cookie.expires } : {}),
              secure: cookie.secure === true,
              httpOnly: cookie.httpOnly === true
            }))
        }, sessionId);
      }

      await this.send(socket, 'Page.navigate', { url: rawUrl }, sessionId);
      await this.waitForReady(socket, sessionId, timeoutMs);
      const payload = await this.readPagePayload(socket, sessionId, settleMs);
      const finalUrl = payload.url || rawUrl;
      const pdfUrls = extractPdfUrls(payload.candidates || [], finalUrl);
      if (/\.pdf(?:$|[?#])/i.test(finalUrl) && !pdfUrls.includes(finalUrl)) {
        pdfUrls.unshift(finalUrl);
      }

      const cookieResult = await this.send(socket, 'Network.getCookies', { urls: [finalUrl] }, sessionId) as {
        cookies?: CookieRecord[];
      };
      return {
        finalUrl,
        title: payload.title || '',
        pdfUrls,
        cookies: cookieResult.cookies || []
      };
    } catch {
      return undefined;
    } finally {
      if (socket && targetId) {
        try {
          await this.send(socket, 'Target.closeTarget', { targetId });
        } catch {
          // target may already be gone
        }
      }
      if (socket) {
        (socket as CdpSocket).__pending?.clear();
        try { socket.close(); } catch { /* already closed */ }
      }
    }
  }

  close(): void {
    if (this.child) {
      try { this.child.kill(); } catch { /* already exited */ }
      this.child = undefined;
    }
  }

  private async connect(): Promise<WebSocket> {
    const endpoint = process.env.LIGHTPANDA_CDP_URL || `ws://127.0.0.1:${this.port}`;
    const socket = new WebSocket(endpoint) as CdpSocket;
    socket.__pending = new Map();
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', error => reject(error));
    });
    socket.on('message', data => {
      const message = JSON.parse(String(data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (typeof message.id !== 'number') return;
      const pending = socket.__pending?.get(message.id);
      if (!pending) return;
      socket.__pending?.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'CDP error'));
      } else {
        pending.resolve(message.result);
      }
    });
    return socket;
  }

  private send(
    socket: WebSocket,
    method: string,
    params: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        (socket as CdpSocket).__pending?.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      (socket as CdpSocket).__pending?.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private async waitForReady(socket: WebSocket, sessionId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = await this.send(socket, 'Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true
        }, sessionId) as { result?: { value?: string } };
        if (result.result?.value === 'complete') return;
      } catch {
        // page may be mid-navigation
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  private async readPagePayload(
    socket: WebSocket,
    sessionId: string,
    settleMs: number
  ): Promise<{ url?: string; title?: string; candidates?: string[] }> {
    const deadline = Date.now() + Math.max(0, settleMs);
    let payload: { url?: string; title?: string; candidates?: string[] } = {};
    while (true) {
      try {
        const evaluated = await this.send(socket, 'Runtime.evaluate', {
          expression: `JSON.stringify({
            url: location.href,
            title: document.title,
            candidates: [
              (document.querySelector('meta[name="citation_pdf_url"]') || {}).content || '',
              ...[...document.querySelectorAll('a[href], iframe[src], embed[src], link[href]')]
                .map(element => element.href || element.src || '')
            ]
          })`,
          returnByValue: true
        }, sessionId) as { result?: { value?: string } };
        payload = JSON.parse(evaluated.result?.value || '{}');
      } catch {
        // page may be mid-navigation; retry until the deadline
      }
      if (extractPdfUrls(payload.candidates || [], payload.url || 'about:blank').length > 0) {
        return payload;
      }
      if (Date.now() >= deadline) return payload;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private async ping(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/json/version`, {
        signal: AbortSignal.timeout(1500)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

}

let sharedBrowser: LightpandaBrowser | undefined;

export function getLightpandaBrowser(): LightpandaBrowser {
  if (!sharedBrowser) {
    sharedBrowser = new LightpandaBrowser();
    process.once('exit', () => sharedBrowser?.close());
  }
  return sharedBrowser;
}
