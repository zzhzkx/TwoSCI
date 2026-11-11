import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCipheriv } from 'node:crypto';
import axios from 'axios';

/**
 * Read-only port of scansci-pdf's institutional access configuration.
 *
 * scansci-pdf stores its WebVPN/CARSI session state under ~/.scansci-pdf.
 * TwoSCI never writes there; it only reuses the gateway URL, cookie jars and
 * publisher mapping so an existing institutional login keeps working.
 */

export interface InstitutionalConfig {
  configPath: string;
  vpnsciEnabled: boolean;
  vpnsciBaseUrl: string;
  vpnsciCookieFile: string;
  vpnsciSchool: string;
  carsiEnabled: boolean;
  carsiCookieDir: string;
  carsiIdpName: string;
  ezproxyEnabled: boolean;
  ezproxyLoginUrl: string;
  networkProxy: string;
  isCampusNetwork: boolean;
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

function boolValue(value: unknown): boolean {
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

export function scansciConfigPath(): string {
  return process.env.TWOSCI_SCANSCI_CONFIG
    || path.join(os.homedir(), '.scansci-pdf', 'config.json');
}

export function loadInstitutionalConfig(): InstitutionalConfig | undefined {
  const configPath = scansciConfigPath();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const home = os.homedir();
  const defaultCookie = path.join(home, '.scansci-pdf', 'cookies', 'webvpn-cookies.json');
  const defaultCarsiDir = path.join(home, '.scansci-pdf', 'cache', 'carsi_cookies');
  const vpnsciCookieFile = existingFile(String(raw.vpnsci_cookie_file || ''))
    || existingFile(defaultCookie);
  const carsiCookieDir = existingDir(String(raw.carsi_cookie_dir || ''))
    || existingDir(defaultCarsiDir);

  return {
    configPath,
    vpnsciEnabled: boolValue(raw.vpnsci_enabled),
    vpnsciBaseUrl: String(raw.vpnsci_base_url || '').replace(/\/+$/, ''),
    vpnsciCookieFile,
    vpnsciSchool: String(raw.vpnsci_school || ''),
    carsiEnabled: boolValue(raw.carsi_enabled),
    carsiCookieDir,
    carsiIdpName: String(raw.carsi_idp_name || ''),
    ezproxyEnabled: boolValue(raw.ezproxy_enabled),
    ezproxyLoginUrl: String(raw.ezproxy_login_url || '').replace(/\/+$/, ''),
    networkProxy: String(raw.network_proxy || ''),
    isCampusNetwork: boolValue(raw.is_campus_network)
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
    return parsed.pathname === cookiePath
      || parsed.pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`)
      || cookiePath === '/';
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

  if (config.vpnsciEnabled && config.vpnsciBaseUrl) {
    const webVpnUrl = convertToWebVpnUrl(rawUrl, config.vpnsciBaseUrl);
    if (webVpnUrl) {
      targets.push({
        url: webVpnUrl,
        cookieHeader: cookieHeaderForUrl(loadCookies(config.vpnsciCookieFile), webVpnUrl),
        channel: 'webvpn'
      });
    }
  }

  const carsiFile = carsiCookieFileForDoi(doi, config);
  if (carsiFile) {
    targets.push({
      url: rawUrl,
      cookieHeader: cookieHeaderForUrl(loadCookies(carsiFile), rawUrl),
      channel: 'carsi'
    });
  }

  return targets;
}

let webVpnStatus: { key: string; alive: boolean; checkedAt: number } | undefined;

/**
 * Fast, cached probe for an expired WebVPN session. A dead gateway returns
 * the campus SSO page with HTTP 200, so status alone is not enough.
 */
export async function isWebVpnSessionAlive(
  config: InstitutionalConfig | undefined,
  timeoutMs = 6000
): Promise<boolean> {
  if (!config?.vpnsciEnabled || !config.vpnsciBaseUrl) return false;
  let cookieStamp = 0;
  try {
    cookieStamp = fs.statSync(config.vpnsciCookieFile).mtimeMs;
  } catch {
    cookieStamp = 0;
  }
  const key = `${config.vpnsciBaseUrl}|${config.vpnsciCookieFile}|${cookieStamp}`;
  if (webVpnStatus && webVpnStatus.key === key && Date.now() - webVpnStatus.checkedAt < 5 * 60 * 1000) {
    return webVpnStatus.alive;
  }

  const cookieHeader = cookieHeaderForUrl(loadCookies(config.vpnsciCookieFile), config.vpnsciBaseUrl);
  const probeUrl = convertToWebVpnUrl('https://www.nature.com', config.vpnsciBaseUrl);
  if (!cookieHeader || !probeUrl) {
    webVpnStatus = { key, alive: false, checkedAt: Date.now() };
    return false;
  }

  try {
    const response = await axios.get(probeUrl, {
      headers: {
        Cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html'
      },
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: () => true
    });
    const finalUrl = String((response.request as { res?: { responseUrl?: string } })?.res?.responseUrl || '');
    const body = typeof response.data === 'string' ? response.data : '';
    const alive = response.status >= 200
      && response.status < 400
      && !/(?:login|cas|authserver|sso)/i.test(finalUrl)
      && !/统一身份认证|统一身份|请登录|sign\s*in/i.test(body);
    webVpnStatus = { key, alive, checkedAt: Date.now() };
    return alive;
  } catch {
    webVpnStatus = { key, alive: false, checkedAt: Date.now() };
    return false;
  }
}

export function institutionalSummary(config: InstitutionalConfig | undefined): Record<string, unknown> {
  if (!config) {
    return { configured: false };
  }
  return {
    configured: true,
    config_path: config.configPath,
    campus_network: config.isCampusNetwork,
    webvpn: {
      enabled: config.vpnsciEnabled,
      school: config.vpnsciSchool,
      profile_loaded: Boolean(config.vpnsciCookieFile)
    },
    carsi: {
      enabled: config.carsiEnabled,
      idp: config.carsiIdpName,
      profile_loaded: Boolean(config.carsiCookieDir)
    },
    ezproxy: {
      enabled: config.ezproxyEnabled
    }
  };
}
