import * as fs from 'node:fs';
import axios from 'axios';

export const DEFAULT_MIN_PDF_BYTES = 10_000;
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface DownloadRequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  minBytes?: number;
  maxRedirects?: number;
}

export function validatePdfBuffer(buffer: Buffer, url: string, minBytes = DEFAULT_MIN_PDF_BYTES): void {
  if (!buffer || buffer.length < minBytes) {
    throw new Error(`PDF too small (${buffer?.length || 0} bytes): ${url}`);
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`Not a PDF response (possible login or challenge page): ${url}`);
  }
}

export async function downloadPdfToFile(
  url: string,
  destPath: string,
  options: DownloadRequestOptions = {}
): Promise<void> {
  let originalHost = '';
  try { originalHost = new URL(url).hostname; } catch { originalHost = ''; }
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: options.timeoutMs ?? 30_000,
    maxRedirects: options.maxRedirects ?? 5,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
      ...(options.headers || {})
    },
    beforeRedirect: (redirect: { href?: string; headers?: Record<string, string> }) => {
      if (!options.headers?.Cookie || !redirect.href || !originalHost) return;
      try {
        const targetHost = new URL(redirect.href).hostname;
        const base = (host: string) => host.split('.').slice(-2).join('.');
        if (base(originalHost) !== base(targetHost)) {
          delete redirect.headers?.Cookie;
          delete redirect.headers?.cookie;
        }
      } catch {
        // malformed redirect target
      }
    },
    validateStatus: status => status >= 200 && status < 300
  });
  const buffer = Buffer.from(response.data);
  validatePdfBuffer(buffer, url, options.minBytes ?? DEFAULT_MIN_PDF_BYTES);
  fs.writeFileSync(destPath, buffer);
}

export async function fetchHtml(
  url: string,
  options: DownloadRequestOptions = {}
): Promise<{ html: string; finalUrl: string }> {
  const response = await axios.get(url, {
    responseType: 'text',
    timeout: options.timeoutMs ?? 25_000,
    maxRedirects: options.maxRedirects ?? 5,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      ...(options.headers || {})
    },
    validateStatus: status => status >= 200 && status < 300
  });
  const finalUrl = String(
    (response.request as { res?: { responseUrl?: string } })?.res?.responseUrl || url
  );
  return { html: String(response.data || ''), finalUrl };
}
