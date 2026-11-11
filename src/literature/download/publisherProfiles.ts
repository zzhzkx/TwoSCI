// Generated from scansci-pdf publisher_profiles.py (22 profiles).
// Keeps the deterministic PDF URL templates; browser-only selectors are intentionally omitted.

export interface PdfSourcePathTemplate {
  domain: string;
  pathPrefix: string;
  pathTemplate: string;
}

export interface PublisherProfile {
  name: string;
  aliases: string[];
  doiPrefixes: string[];
  baseDomains: string[];
  articleUrlTemplate: string;
  pdfUrlTemplates: string[];
  pdfUrlMarkers: string[];
  supplementaryUrlMarkers: string[];
  pdfSourcePathTemplates: PdfSourcePathTemplate[];
}

export const PUBLISHER_PROFILES: PublisherProfile[] = [
  {
    name: "ACS",
    aliases: ["acs","american-chemical-society"],
    doiPrefixes: ["10.1021"],
    baseDomains: ["pubs.acs.org"],
    articleUrlTemplate: "https://pubs.acs.org/doi/{doi}",
    pdfUrlTemplates: ["https://pubs.acs.org/doi/pdf/{doi}?ref=article_openPDF","https://pubs.acs.org/doi/pdf/{doi}","https://pubs.acs.org/doi/epdf/{doi}"],
    pdfUrlMarkers: ["/doi/pdf/","/doi/epdf/","/pdf/","/pdf","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "AIP Publishing",
    aliases: ["aip","aip-publishing","american-institute-of-physics"],
    doiPrefixes: ["10.1063"],
    baseDomains: ["pubs.aip.org"],
    articleUrlTemplate: "https://pubs.aip.org/doi/{doi}",
    pdfUrlTemplates: ["https://pubs.aip.org/doi/epdf/{doi}","https://pubs.aip.org/doi/pdf/{doi}"],
    pdfUrlMarkers: ["/doi/epdf/","/doi/pdf/","pdf"],
    supplementaryUrlMarkers: ["supplementary","supplemental","supporting-information","suppl_file"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "AMS",
    aliases: ["ams","ametsoc","american-meteorological-society"],
    doiPrefixes: ["10.1175"],
    baseDomains: ["journals.ametsoc.org","ametsoc.org"],
    articleUrlTemplate: "https://journals.ametsoc.org/doi/{doi}",
    pdfUrlTemplates: ["https://journals.ametsoc.org/doi/epdf/{doi}","https://journals.ametsoc.org/doi/pdf/{doi}"],
    pdfUrlMarkers: ["/doi/epdf/","/doi/pdf/","pdf"],
    supplementaryUrlMarkers: ["supplementary","supplemental","supporting-information","suppl_file"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "ACM",
    aliases: ["acm","association-for-computing-machinery"],
    doiPrefixes: ["10.1145","10.5555"],
    baseDomains: ["dl.acm.org","acm.org"],
    articleUrlTemplate: "https://dl.acm.org/doi/{doi}",
    pdfUrlTemplates: ["https://dl.acm.org/doi/pdf/{doi}"],
    pdfUrlMarkers: ["/doi/pdf/","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "Annual Reviews",
    aliases: ["annual-reviews","annualreviews"],
    doiPrefixes: ["10.1146"],
    baseDomains: ["annualreviews.org"],
    articleUrlTemplate: "https://annualreviews.org/doi/{doi}",
    pdfUrlTemplates: ["https://annualreviews.org/doi/pdf/{doi}"],
    pdfUrlMarkers: ["/doi/pdf/","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "APS",
    aliases: ["aps","american-physical-society"],
    doiPrefixes: ["10.1103"],
    baseDomains: ["journals.aps.org","link.aps.org"],
    articleUrlTemplate: "https://link.aps.org/doi/{doi}",
    pdfUrlTemplates: ["https://link.aps.org/pdf/{doi}"],
    pdfUrlMarkers: ["/pdf/","/pdf","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "Copernicus",
    aliases: ["copernicus","copernicus-publications"],
    doiPrefixes: ["10.5194"],
    baseDomains: ["copernicus.org"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: [],
    pdfUrlMarkers: [".pdf","/articles/","pdf"],
    supplementaryUrlMarkers: ["assets","supplement","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "Wiley",
    aliases: ["wiley","wiley-online-library","onlinelibrary"],
    doiPrefixes: ["10.1002","10.1111"],
    baseDomains: ["onlinelibrary.wiley.com"],
    articleUrlTemplate: "https://onlinelibrary.wiley.com/doi/{doi}",
    pdfUrlTemplates: ["https://onlinelibrary.wiley.com/doi/pdfdirect/{doi}","https://onlinelibrary.wiley.com/doi/pdf/{doi}","https://onlinelibrary.wiley.com/doi/epdf/{doi}"],
    pdfUrlMarkers: ["/doi/pdf/","/doi/epdf/","/doi/pdfdirect/","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary","/pb-assets/","wechat-wiley-chem"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "Elsevier",
    aliases: ["elsevier","sciencedirect","science-direct"],
    doiPrefixes: ["10.1016"],
    baseDomains: ["www.sciencedirect.com","sciencedirect.com","linkinghub.elsevier.com"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: [],
    pdfUrlMarkers: ["/pdfft","/pdf","download","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary","/content/image/","-mmc","_mmc"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "Frontiers",
    aliases: ["frontiers"],
    doiPrefixes: ["10.3389"],
    baseDomains: ["www.frontiersin.org","frontiersin.org"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: ["https://www.frontiersin.org/articles/{doi}/pdf"],
    pdfUrlMarkers: ["/pdf","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "IEEE",
    aliases: ["ieee","ieee-xplore"],
    doiPrefixes: ["10.1109"],
    baseDomains: ["ieeexplore.ieee.org","ieee.org"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: [],
    pdfUrlMarkers: ["stampPDF","getPDF","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "IOP",
    aliases: ["iop","iopscience"],
    doiPrefixes: ["10.1088"],
    baseDomains: ["iopscience.iop.org"],
    articleUrlTemplate: "https://iopscience.iop.org/article/{doi}",
    pdfUrlTemplates: ["https://iopscience.iop.org/article/{doi}/pdf"],
    pdfUrlMarkers: ["/pdf","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "MDPI",
    aliases: ["mdpi","mdpi-ag"],
    doiPrefixes: ["10.3390"],
    baseDomains: ["www.mdpi.com","mdpi.com"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: [],
    pdfUrlMarkers: ["/pdf","pdf"],
    supplementaryUrlMarkers: ["supplementary","supplement","/s1","table-s","figure-s"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "Optica",
    aliases: ["optica","osa","opg","optica-publishing-group","optical-society-of-america"],
    doiPrefixes: ["10.1364"],
    baseDomains: ["opg.optica.org","optica.org","osapublishing.org"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: ["https://opg.optica.org/viewmedia.cfm?r=1&uri={doi}","https://opg.optica.org/viewmedia.cfm?r=1&uri={doi_quoted}"],
    pdfUrlMarkers: ["viewmedia.cfm","/pdf","download","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "Oxford Academic",
    aliases: ["oxfordacademic","oxford-academic","oup","oxford-university-press"],
    doiPrefixes: ["10.1093"],
    baseDomains: ["academic.oup.com"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: ["https://academic.oup.com/doi/pdf/{doi}","https://academic.oup.com/doi/epdf/{doi}"],
    pdfUrlMarkers: ["/doi/pdf/","/doi/epdf/","/article-pdf/","pdf"],
    supplementaryUrlMarkers: ["supplementary","supplement","suppl_file"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "PLOS",
    aliases: ["plos","public-library-of-science"],
    doiPrefixes: ["10.1371"],
    baseDomains: ["journals.plos.org","plos.org"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: [],
    pdfUrlMarkers: ["type=printable","/article/file","pdf"],
    supplementaryUrlMarkers: ["type=supplementary","supplementary","figure/image","thumbnail"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "PNAS",
    aliases: ["pnas","proceedings-national-academy-sciences"],
    doiPrefixes: ["10.1073"],
    baseDomains: ["www.pnas.org","pnas.org"],
    articleUrlTemplate: "https://www.pnas.org/doi/{doi}",
    pdfUrlTemplates: ["https://www.pnas.org/doi/epdf/{doi}","https://www.pnas.org/doi/pdf/{doi}?download=true","https://www.pnas.org/doi/pdf/{doi}"],
    pdfUrlMarkers: ["/doi/epdf/","/doi/pdf/","download=true","pdf"],
    supplementaryUrlMarkers: ["supplementary","suppl_file","supporting-information"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "Royal Society Publishing",
    aliases: ["royalsocietypublishing","royal-society-publishing","the-royal-society"],
    doiPrefixes: ["10.1098"],
    baseDomains: ["royalsocietypublishing.org"],
    articleUrlTemplate: "https://royalsocietypublishing.org/doi/{doi}",
    pdfUrlTemplates: ["https://royalsocietypublishing.org/doi/pdf/{doi}"],
    pdfUrlMarkers: ["/doi/pdf/","pdf"],
    supplementaryUrlMarkers: ["supplementary","supplement","suppl_file"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "RSC",
    aliases: ["rsc","royal-society-of-chemistry"],
    doiPrefixes: ["10.1039"],
    baseDomains: ["pubs.rsc.org"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: ["https://pubs.rsc.org/en/content/articlepdf/{doi}"],
    pdfUrlMarkers: ["/content/articlepdf/","/pdf","download","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
      {
        domain: "pubs.rsc.org",
        pathPrefix: "/en/content/articlelanding/",
        pathTemplate: "/en/content/articlepdf/{source_path_after_prefix}"
      },
    ]
  },
  {
    name: "Science",
    aliases: ["science","aaas","american-association-for-the-advancement-of-science"],
    doiPrefixes: ["10.1126"],
    baseDomains: ["www.science.org","science.org"],
    articleUrlTemplate: "https://www.science.org/doi/{doi}",
    pdfUrlTemplates: ["https://www.science.org/doi/epdf/{doi}","https://www.science.org/doi/pdf/{doi}","https://www.science.org/doi/pdf/{doi}?download=true"],
    pdfUrlMarkers: ["/doi/epdf/","/doi/pdf/","download=true","pdf"],
    supplementaryUrlMarkers: ["supplementary","supplement","suppl_file"],
    pdfSourcePathTemplates: [
    ]
  },
  {
    name: "Springer Nature",
    aliases: ["springer","springer-nature","nature"],
    doiPrefixes: ["10.1007","10.1038"],
    baseDomains: ["link.springer.com","www.nature.com","nature.com"],
    articleUrlTemplate: "https://doi.org/{doi}",
    pdfUrlTemplates: ["https://link.springer.com/content/pdf/{doi_quoted}.pdf","https://www.nature.com/articles/{doi_suffix}.pdf"],
    pdfUrlMarkers: ["/content/pdf/",".pdf","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
      {
        domain: "link.springer.com",
        pathPrefix: "/article/",
        pathTemplate: "/content/pdf/{doi_quoted}.pdf"
      },
      {
        domain: "nature.com",
        pathPrefix: "/articles/",
        pathTemplate: "{source_path}.pdf"
      },
    ]
  },
  {
    name: "World Scientific",
    aliases: ["world-scientific","worldscientific"],
    doiPrefixes: ["10.1142"],
    baseDomains: ["www.worldscientific.com","worldscientific.com"],
    articleUrlTemplate: "https://www.worldscientific.com/doi/{doi}",
    pdfUrlTemplates: ["https://www.worldscientific.com/doi/pdf/{doi}"],
    pdfUrlMarkers: ["/doi/pdf/","pdf"],
    supplementaryUrlMarkers: ["suppl_file","suppdata","supporting-information","supplementary"],
    pdfSourcePathTemplates: [
    ]
  },
];

export function inferPublisherProfile(doi: string): PublisherProfile | undefined {
  const normalized = doi.trim().toLowerCase();
  let best: PublisherProfile | undefined;
  let bestLength = 0;
  for (const profile of PUBLISHER_PROFILES) {
    for (const prefix of profile.doiPrefixes) {
      if (!normalized.startsWith(`${prefix.toLowerCase()}/`) && normalized !== prefix.toLowerCase()) continue;
      if (prefix.length > bestLength) { best = profile; bestLength = prefix.length; }
    }
  }
  return best;
}

export function inferPublisherProfileFromUrl(rawUrl: string): PublisherProfile | undefined {
  let host = "";
  try { host = new URL(rawUrl).hostname.toLowerCase(); } catch { return undefined; }
  return PUBLISHER_PROFILES.find(profile =>
    profile.baseDomains.some(domain => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`))
  );
}

export function publisherPdfUrls(profile: PublisherProfile, doi: string): string[] {
  const suffix = doi.includes('/') ? doi.split('/').slice(1).join('/') : doi;
  const values: Record<string, string> = {
    doi,
    doi_quoted: encodeURIComponent(doi),
    doi_suffix: suffix,
    doi_suffix_quoted: encodeURIComponent(suffix)
  };
  return profile.pdfUrlTemplates.map(template => template.replace(/\{([a-z_]+)\}/g, (_, key) => values[key] ?? ''));
}
