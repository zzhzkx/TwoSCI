import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCipheriv } from 'node:crypto';

/**
 * Native port of scansci-pdf WebVPN/CARSI access.
 *
 * Configuration is owned by TwoSCI. An existing scansci profile can be
 * imported explicitly with TWOSCI_SCANSCI_CONFIG, but it is never required.
 */

export interface InstitutionalConfig {
  webVpnEnabled: boolean;
  webVpnBaseUrl: string;
  webVpnCookieFile: string;
  carsiEnabled: boolean;
  carsiCookieDir: string;
  carsiIdpName: string;
}

export interface CookieRecord {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
}

export interface InstitutionalTarget {
  url: string;
  cookieHeader?: string;
  channel: 'webvpn' | 'carsi';
}

const WEBVPN_KEY = Buffer.from('wrdvpnisthebest!', 'utf8');

const CARSI_PUBLISHER_BY_DOI_PREFIX: Record<string, string> = {
  '10.1016': 'sciencedirect',
  '10.1109': 'ieee',
  '10.1088': 'iop',
  '10.1038': 'nature',
  '10.1177': 'sage',
  '10.1002': 'wiley',
  '10.1145': 'acm'
};

function truthy(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function existingFile(candidate: string | undefined): string {
  if (!candidate) return '';
  try {
    return fs.statSync(candidate).isFile() ? candidate : '';
  } catch {
    return '';
  }
}

function existingDir(candidate: string | undefined): string {
  if (!candidate) return '';
  try {
    return fs.statSync(candidate).isDirectory() ? candidate : '';
  } catch {
    return '';
  }
}

interface ScansciLikeConfig {
  vpnsci_enabled?: unknown;
  vpnsci_base_url?: unknown;
  vpnsci_cookie_file?: unknown;
  carsi_enabled?: unknown;
  carsi_cookie_dir?: unknown;
  carsi_idp_name?: unknown;
}

function readScansciConfig(): ScansciLikeConfig | undefined {
  const explicit = process.env.TWOSCI_SCANSCI_CONFIG;
  if (!explicit) return undefined;
  try {
    return JSON.parse(fs.readFileSync(explicit, 'utf8')) as ScansciLikeConfig;
  } catch {
    return undefined;
  }
}

export function loadInstitutionalConfig(): InstitutionalConfig | undefined {
  const imported = readScansciConfig();
  const webVpnBaseUrl = String(
    process.env.TWOSCI_WEBVPN_BASE_URL
    || imported?.vpnsci_base_url
    || ''
  ).replace(/\/+$/, '');
  const webVpnCookieFile = existingFile(
    process.env.TWOSCI_WEBVPN_COOKIE_FILE
    || String(imported?.vpnsci_cookie_file || '')
  );
  const carsiCookieDir = existingDir(
    process.env.TWOSCI_CARSI_COOKIE_DIR
    || String(imported?.carsi_cookie_dir || '')
  );
  const webVpnEnabled = process.env.TWOSCI_WEBVPN_ENABLED !== undefined
    ? truthy(process.env.TWOSCI_WEBVPN_ENABLED)
    : Boolean(webVpnBaseUrl && webVpnCookieFile) || truthy(imported?.vpnsci_enabled);
  const carsiEnabled = process.env.TWOSCI_CARSI_ENABLED !== undefined
    ? truthy(process.env.TWOSCI_CARSI_ENABLED)
    : truthy(imported?.carsi_enabled);

  if (!webVpnEnabled && !carsiEnabled) return undefined;
  return {
    webVpnEnabled: Boolean(webVpnEnabled && webVpnBaseUrl),
    webVpnBaseUrl,
    webVpnCookieFile,
    carsiEnabled: Boolean(carsiEnabled && carsiCookieDir),
    carsiCookieDir,
    carsiIdpName: String(process.env.TWOSCI_CARSI_IDP_NAME || imported?.carsi_idp_name || '')
  };
}

export function convertToWebVpnUrl(rawUrl: string, baseUrl: string): string | undefined {
  if (!baseUrl) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) return undefined;

  const cipher = createCipheriv('aes-128-cfb', WEBVPN_KEY, WEBVPN_KEY);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(parsed.hostname, 'utf8')),
    cipher.final()
  ]);
  const gatewayHost = WEBVPN_KEY.toString('hex') + encrypted.toString('hex');
  const schemePart = parsed.port
    ? `${parsed.protocol.replace(':', '')}-${parsed.port}`
    : parsed.protocol.replace(':', '');
  return `${baseUrl}/${schemePart}/${gatewayHost}${parsed.pathname}${parsed.search}`;
}

export function parseCookieJar(content: string): CookieRecord[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { cookies?: unknown }).cookies)
          ? (parsed as { cookies: unknown[] }).cookies
          : []);
      return list
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .filter(item => typeof item.name === 'string' && typeof item.value === 'string')
        .map(item => ({
          name: String(item.name),
          value: String(item.value),
          domain: typeof item.domain === 'string' ? item.domain : undefined,
          path: typeof item.path === 'string' ? item.path : '/',
          expires: typeof item.expires === 'number' ? item.expires : undefined,
          secure: item.secure === true,
          httpOnly: item.httpOnly === true
        }));
    } catch {
      return [];
    }
  }

  const cookies: CookieRecord[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const httpOnly = line.startsWith('#HttpOnly_');
    const body = httpOnly ? line.slice('#HttpOnly_'.length) : line;
    if (!body || (body.startsWith('#') && !httpOnly)) continue;
    const parts = body.split('\t');
    if (parts.length < 7) continue;
    const expires = Number(parts[4]);
    cookies.push({
      domain: parts[0],
      path: parts[2] || '/',
      secure: parts[3].toUpperCase() === 'TRUE',
      expires: Number.isFinite(expires) ? expires : undefined,
      name: parts[5],
      value: parts[6],
      httpOnly
    });
  }
  return cookies;
}

export function loadCookies(filePath: string): CookieRecord[] {
  if (!filePath) return [];
  try {
    return parseCookieJar(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

export function cookieHeaderForUrl(cookies: CookieRecord[], rawUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  const now = Date.now() / 1000;
  const matches = cookies.filter(cookie => {
    if (cookie.expires !== undefined && cookie.expires > 0 && cookie.expires < now) return false;
    if (cookie.secure && parsed.protocol !== 'https:') return false;
    const domain = (cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (domain && host !== domain && !host.endsWith(`.${domain}`)) return false;
    const cookiePath = cookie.path || '/';
    return cookiePath === '/'
      || parsed.pathname === cookiePath
      || parsed.pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
  });
  if (matches.length === 0) return undefined;
  return matches
    .sort((left, right) => (right.path || '/').length - (left.path || '/').length)
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function carsiCookieFileForDoi(doi: string, config: InstitutionalConfig): string {
  if (!config.carsiEnabled || !config.carsiCookieDir) return '';
  const prefix = (doi.match(/^(10\.\d{4,9})/) || [])[1];
  const publisher = prefix ? CARSI_PUBLISHER_BY_DOI_PREFIX[prefix] : undefined;
  if (!publisher) return '';
  return existingFile(path.join(config.carsiCookieDir, `${publisher}.json`));
}

export function buildInstitutionalTargets(
  rawUrl: string,
  doi: string,
  config: InstitutionalConfig
): InstitutionalTarget[] {
  const targets: InstitutionalTarget[] = [];
  const carsiFile = carsiCookieFileForDoi(doi, config);
  if (carsiFile) {
    targets.push({
      url: rawUrl,
      cookieHeader: cookieHeaderForUrl(loadCookies(carsiFile), rawUrl),
      channel: 'carsi'
    });
  }
  if (config.webVpnEnabled && config.webVpnBaseUrl) {
    const webVpnUrl = convertToWebVpnUrl(rawUrl, config.webVpnBaseUrl);
    if (webVpnUrl) {
      targets.push({
        url: webVpnUrl,
        cookieHeader: cookieHeaderForUrl(loadCookies(config.webVpnCookieFile), webVpnUrl),
        channel: 'webvpn'
      });
    }
  }
  return targets;
}

export function institutionalSummary(config: InstitutionalConfig | undefined): Record<string, unknown> {
  if (!config) return { configured: false };
  return {
    configured: true,
    webvpn: {
      enabled: config.webVpnEnabled,
      base_url: config.webVpnBaseUrl,
      profile_loaded: Boolean(config.webVpnCookieFile)
    },
    carsi: {
      enabled: config.carsiEnabled,
      idp: config.carsiIdpName,
      profile_loaded: Boolean(config.carsiCookieDir)
    }
  };
}

