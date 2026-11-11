import { describe, expect, it } from '@jest/globals';
import {
  buildPdfCandidates,
  discoverPdfCandidatesFromHtml,
  getMdpiCdnVariants
} from '../../src/literature/download/publisherPdfRouter.js';
import {
  inferPublisherProfile,
  inferPublisherProfileFromUrl
} from '../../src/literature/download/publisherProfiles.js';
import {
  buildInstitutionalTargets,
  convertToWebVpnUrl,
  cookieHeaderForUrl,
  parseCookieJar,
  type InstitutionalConfig
} from '../../src/literature/download/institutionalAccess.js';
import { normalizeArxivId } from '../../src/literature/download/openAccess.js';
import { normalizeDoi } from '../../src/literature/download/pdfFetcher.js';

describe('publisher profile registry', () => {
  it('infers profiles from DOI prefixes and landing-page hosts', () => {
    expect(inferPublisherProfile('10.1016/j.enbuild.2015.07.058')?.name).toBe('Elsevier');
    expect(inferPublisherProfile('10.3390/buildings15111900')?.name).toBe('MDPI');
    expect(inferPublisherProfile('10.3389/fenrg.2020.00001')?.name).toBe('Frontiers');
    expect(inferPublisherProfileFromUrl('https://www.sciencedirect.com/science/article/pii/S0378778815301742')?.name).toBe('Elsevier');
  });
});

describe('publisher PDF routing', () => {
  it('builds an Elsevier pdfft route from a PII', () => {
    const profile = inferPublisherProfile('10.1016/j.enbuild.2015.07.058')!;
    const candidates = buildPdfCandidates(profile, '10.1016/j.enbuild.2015.07.058', {
      sourceUrl: 'https://www.sciencedirect.com/science/article/pii/S0378778815301742'
    });
    expect(candidates[0]).toBe('https://www.sciencedirect.com/science/article/pii/S0378778815301742/pdfft');
  });

  it('builds MDPI open-CDN variants before www.mdpi.com links', () => {
    const variants = getMdpiCdnVariants('10.3390/buildings15111900');
    expect(variants[0]).toContain('mdpi-res.com');
    expect(variants[0]).toContain('buildings-15-01900.pdf');

    const profile = inferPublisherProfile('10.3390/buildings15111900')!;
    const candidates = buildPdfCandidates(profile, '10.3390/buildings15111900');
    expect(candidates[0]).toContain('mdpi-res.com');
    expect(candidates.some(url => url.includes('www.mdpi.com'))).toBe(true);
  });

  it('builds PLOS, Frontiers, Copernicus and APS routes', () => {
    const plos = inferPublisherProfile('10.1371/journal.pone.0123456')!;
    expect(buildPdfCandidates(plos, '10.1371/journal.pone.0123456')[0])
      .toContain('journals.plos.org/plosone/article/file');

    const frontiers = inferPublisherProfile('10.3389/fenrg.2020.00001')!;
    expect(buildPdfCandidates(frontiers, '10.3389/fenrg.2020.00001')[0])
      .toContain('frontiersin.org');

    const copernicus = inferPublisherProfile('10.5194/acp-20-1-2020')!;
    expect(buildPdfCandidates(copernicus, '10.5194/acp-20-1-2020')[0])
      .toContain('copernicus.org/articles/20/1/2020');

    const aps = inferPublisherProfile('10.1103/PhysRevLett.116.061102')!;
    expect(buildPdfCandidates(aps, '10.1103/PhysRevLett.116.061102', {
      sourceUrl: 'https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.116.061102'
    })[0]).toBe('https://journals.aps.org/prl/pdf/10.1103/PhysRevLett.116.061102');
  });

  it('discovers PDF links from citation metadata, anchors and iframes', () => {
    const html = `
      <html><head>
        <meta name="citation_pdf_url" content="/article/123/pdf">
      </head><body>
        <a href="/download/paper.pdf">Download PDF</a>
        <iframe src="https://cdn.example.org/view.pdf"></iframe>
      </body></html>`;
    const candidates = discoverPdfCandidatesFromHtml(html, 'https://publisher.example.org/article/123');
    expect(candidates).toContain('https://publisher.example.org/article/123/pdf');
    expect(candidates).toContain('https://publisher.example.org/download/paper.pdf');
    expect(candidates).toContain('https://cdn.example.org/view.pdf');
  });
});

describe('institutional access port', () => {
  it('converts WebVPN URLs exactly like scansci-pdf', () => {
    expect(convertToWebVpnUrl(
      'https://www.sciencedirect.com/science/article/pii/S0378778815301742?x=1',
      'https://wvpn.ustc.edu.cn'
    )).toBe(
      'https://wvpn.ustc.edu.cn/https/77726476706e69737468656265737421e7e056d234336155700b8ca891472636a6d29e640e/science/article/pii/S0378778815301742?x=1'
    );
  });

  it('parses and filters cookies by domain, path and expiry', () => {
    const jar = parseCookieJar(JSON.stringify([
      { name: 'a', value: '1', domain: '.example.com', path: '/' },
      { name: 'b', value: '2', domain: '.other.com', path: '/' },
      { name: 'c', value: '3', domain: '.example.com', path: '/', expires: 1 }
    ]));
    const header = cookieHeaderForUrl(jar, 'https://www.example.com/article');
    expect(header).toBe('a=1');
  });

  it('builds CARSI and WebVPN targets from explicit configuration', () => {
    const config: InstitutionalConfig = {
      webVpnEnabled: true,
      webVpnBaseUrl: 'https://wvpn.example.edu',
      webVpnCookieFile: '',
      carsiEnabled: false,
      carsiCookieDir: '',
      carsiIdpName: ''
    };
    const targets = buildInstitutionalTargets(
      'https://www.sciencedirect.com/science/article/pii/S0378778815301742',
      '10.1016/j.enbuild.2015.07.058',
      config
    );
    expect(targets.some(target => target.channel === 'webvpn')).toBe(true);
  });
});

describe('identifier normalization', () => {
  it('normalizes arXiv DOI, abs URL and bare id forms', () => {
    expect(normalizeArxivId('10.48550/arXiv.2401.01234')).toBe('2401.01234');
    expect(normalizeArxivId('https://arxiv.org/abs/2401.01234v2')).toBe('2401.01234');
    expect(normalizeArxivId('2401.01234')).toBe('2401.01234');
  });

  it('normalizes DOI inputs', () => {
    expect(normalizeDoi('https://doi.org/10.3390/Buildings15111900')).toBe('10.3390/buildings15111900');
    expect(normalizeDoi('doi: 10.1016/j.enbuild.2015.07.058')).toBe('10.1016/j.enbuild.2015.07.058');
  });
});
