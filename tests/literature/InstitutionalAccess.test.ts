import { describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildInstitutionalTargets,
  cookieHeaderForUrl,
  convertToWebVpnUrl,
  loadInstitutionalConfig,
  parseCookieJar
} from '../../src/literature/InstitutionalAccess.js';

describe('InstitutionalAccess', () => {
  it('converts a publisher URL exactly like scansci-pdf WebVPN', () => {
    const converted = convertToWebVpnUrl(
      'https://www.sciencedirect.com/science/article/pii/S0378778815301742?x=1',
      'https://wvpn.ustc.edu.cn'
    );
    expect(converted).toBe(
      'https://wvpn.ustc.edu.cn/https/77726476706e69737468656265737421e7e056d234336155700b8ca891472636a6d29e640e/science/article/pii/S0378778815301742?x=1'
    );
  });

  it('keeps an explicit port in the WebVPN scheme segment', () => {
    const converted = convertToWebVpnUrl('http://example.com:8080/a', 'https://wvpn.example.edu');
    expect(converted).toContain('/http-8080/');
    expect(converted?.endsWith('/a')).toBe(true);
  });

  it('parses Playwright JSON and Netscape cookie jars', () => {
    const json = parseCookieJar(JSON.stringify([
      { name: 'sid', value: 'abc', domain: '.wvpn.ustc.edu.cn', path: '/', expires: -1 }
    ]));
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe('sid');

    const netscape = parseCookieJar([
      '# Netscape HTTP Cookie File',
      '.example.com\tTRUE\t/\tTRUE\t0\tsid\tabc'
    ].join('\n'));
    expect(netscape).toHaveLength(1);
    expect(netscape[0].domain).toBe('.example.com');
    expect(netscape[0].secure).toBe(true);
  });

  it('filters cookie headers by domain, path, secure flag and expiry', () => {
    const header = cookieHeaderForUrl([
      { name: 'a', value: '1', domain: '.example.com', path: '/' },
      { name: 'b', value: '2', domain: '.example.com', path: '/deep' },
      { name: 'c', value: '3', domain: '.other.com', path: '/' },
      { name: 'd', value: '4', domain: '.example.com', path: '/', secure: true },
      { name: 'e', value: '5', domain: '.example.com', path: '/', expires: 1 }
    ], 'https://www.example.com/deep/page');

    expect(header).toContain('a=1');
    expect(header).toContain('b=2');
    expect(header).toContain('d=4');
    expect(header).not.toContain('c=3');
    expect(header).not.toContain('e=5');
  });

  it('loads WebVPN and CARSI targets from a scansci profile', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twosci-institutional-'));
    const carsiDir = path.join(tmp, 'carsi');
    fs.mkdirSync(carsiDir, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'webvpn.json'), JSON.stringify([
      { name: 'wvpn_sid', value: 'x', domain: '.wvpn.example.edu', path: '/' }
    ]));
    fs.writeFileSync(path.join(carsiDir, 'sciencedirect.json'), JSON.stringify([
      { name: 'carsi_sid', value: 'y', domain: '.sciencedirect.com', path: '/' }
    ]));
    const configPath = path.join(tmp, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vpnsci_enabled: true,
      vpnsci_base_url: 'https://wvpn.example.edu',
      vpnsci_cookie_file: path.join(tmp, 'webvpn.json'),
      carsi_enabled: true,
      carsi_cookie_dir: carsiDir
    }));

    const saved = process.env.TWOSCI_SCANSCI_CONFIG;
    process.env.TWOSCI_SCANSCI_CONFIG = configPath;
    try {
      const config = loadInstitutionalConfig();
      expect(config?.vpnsciEnabled).toBe(true);
      const targets = buildInstitutionalTargets(
        'https://www.sciencedirect.com/science/article/pii/S0378778815301742',
        '10.1016/j.enbuild.2015.07.058',
        config!
      );
      expect(targets.some(target => target.channel === 'webvpn')).toBe(true);
      const carsi = targets.find(target => target.channel === 'carsi');
      expect(carsi?.cookieHeader).toBe('carsi_sid=y');
    } finally {
      if (saved === undefined) delete process.env.TWOSCI_SCANSCI_CONFIG;
      else process.env.TWOSCI_SCANSCI_CONFIG = saved;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
