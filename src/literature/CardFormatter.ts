import type { LiteratureRecord, SearchScope } from './types.js';

export interface FormatCardOptions {
  scope?: SearchScope;
  index?: number;
  matchedKeywords?: string[];
  evidenceSnippet?: string;
}

export class CardFormatter {
  /**
   * Format a single literature record into a card according to the specified search scope.
   */
  static formatRecord(record: LiteratureRecord, options: FormatCardOptions = {}): string {
    const scope = options.scope || 'abstract';
    const index = options.index ?? 1;

    switch (scope) {
      case 'metadata':
        return this.formatMetadataCard(record, index);
      case 'fulltext':
        return this.formatFullTextCard(record, index, options);
      case 'abstract':
      default:
        return this.formatAbstractCard(record, index);
    }
  }

  /**
   * Format an array of literature records into formatted cards.
   */
  static formatRecords(records: LiteratureRecord[], scope: SearchScope = 'abstract'): string {
    if (!records || records.length === 0) {
      return '*未检索到符合条件的文献记录*';
    }
    return records
      .map((record, i) => this.formatRecord(record, { scope, index: i + 1 }))
      .join('\n\n---\n\n');
  }

  /**
   * 1.1 元数据级卡片:
   * 包含：标题、作者列表、出版期刊与年份、标识符 (DOI 链接)、各库被引频次、作者关键词。
   * (已删去文献类型/OA状态、元数据命中匹配)
   */
  private static formatMetadataCard(record: LiteratureRecord, index: number): string {
    const padIndex = String(index).padStart(2, '0');
    const authorsStr = record.authors && record.authors.length > 0
      ? record.authors.join('; ')
      : '未知作者 (Unknown)';
    const venueStr = record.venue ? `${record.venue}${record.year ? ` (${record.year})` : ''}` : (record.year ? String(record.year) : '未知期刊/会议');
    
    const idParts: string[] = [];
    if (record.doi) {
      idParts.push(`DOI: [${record.doi}](https://doi.org/${encodeURI(record.doi)})`);
    }
    if (record.identifiers?.wosUid) {
      idParts.push(`WoS: ${record.identifiers.wosUid}`);
    }
    if (record.identifiers?.scopusEid) {
      idParts.push(`Scopus: ${record.identifiers.scopusEid}`);
    }
    if (record.identifiers?.openalexId) {
      idParts.push(`OpenAlex: ${record.identifiers.openalexId}`);
    }
    const idStr = idParts.length > 0 ? idParts.join(' | ') : '无标识符';

    const citStr = this.buildCitationsSummary(record);
    const keywordsStr = record.keywords && record.keywords.length > 0
      ? record.keywords.join('; ')
      : '无关键词记录';

    return [
      `### 📄 [Meta-${padIndex}] ${record.title}`,
      `- **作者 (Authors)**: ${authorsStr}`,
      `- **出版期刊 (Venue)**: ${venueStr}`,
      `- **标识符 (Identifiers)**: ${idStr}`,
      `- **被引频次 (Citations)**: ${citStr}`,
      `- **作者关键词 (Keywords)**: ${keywordsStr}`
    ].join('\n');
  }

  /**
   * 1.2 摘要级卡片:
   * 包含：基本信息、作者、引用统计、核心关键词、结构化摘要、文献获取可点击链接。
   */
  private static formatAbstractCard(record: LiteratureRecord, index: number): string {
    const padIndex = String(index).padStart(2, '0');
    const authorsStr = record.authors && record.authors.length > 0
      ? record.authors.join('; ')
      : '未知作者';
    
    const metaParts: string[] = [];
    if (record.venue) metaParts.push(record.venue);
    if (record.year) metaParts.push(String(record.year));
    if (record.volume) metaParts.push(`Vol. ${record.volume}`);
    if (record.issue) metaParts.push(`No. ${record.issue}`);
    if (record.doi) metaParts.push(`[${record.doi}](https://doi.org/${encodeURI(record.doi)})`);
    const basicInfo = metaParts.length > 0 ? metaParts.join(' · ') : '未知出版信息';

    const citStr = this.buildCitationsSummary(record);
    const keywordsStr = record.keywords && record.keywords.length > 0
      ? record.keywords.join('; ')
      : '无记录';
    
    const abstractText = record.abstract && record.abstract.trim()
      ? record.abstract.trim()
      : '（该文献数据库记录中暂未提供完整摘要正文）';
    
    // 文献获取直达链接
    const directUrl = record.doi
      ? `https://doi.org/${encodeURI(record.doi)}`
      : (record.pdfUrl || record.url || '#');
    const accessLink = `[${directUrl}](${directUrl})`;

    return [
      `### 📄 [Abs-${padIndex}] ${record.title}`,
      `- **基本信息**: ${basicInfo}`,
      `- **作者**: ${authorsStr}`,
      `- **引用统计**: ${citStr}`,
      `- **核心关键词**: ${keywordsStr}`,
      `- **摘要内容**:`,
      `  > ${abstractText.replace(/\n+/g, ' ')}`,
      `- **文献获取**: ${accessLink}`
    ].join('\n');
  }

  /**
   * 1.3 全文级卡片:
   * 包含：基本信息、作者、引用统计、全文命中关键词、关键证据摘录、全文可获取: Yes/No。
   */
  private static formatFullTextCard(
    record: LiteratureRecord,
    index: number,
    options: FormatCardOptions
  ): string {
    const padIndex = String(index).padStart(2, '0');
    const authorsStr = record.authors && record.authors.length > 0
      ? (record.authors.length > 3 ? `${record.authors.slice(0, 3).join('; ')}; et al.` : record.authors.join('; '))
      : '未知作者';
    
    const venueYear = record.venue ? `${record.venue}${record.year ? ` (${record.year})` : ''}` : (record.year ? String(record.year) : '未知出版物');
    const doiPart = record.doi ? ` · DOI: [${record.doi}](https://doi.org/${encodeURI(record.doi)})` : '';
    const basicInfo = `${venueYear}${doiPart}`;
    const citStr = this.buildCitationsSummary(record);

    const matchedKw = options.matchedKeywords && options.matchedKeywords.length > 0
      ? options.matchedKeywords.map(k => `"${k}"`).join(', ')
      : (record.keywords.length > 0 ? record.keywords.slice(0, 3).map(k => `"${k}"`).join(', ') : '"核心主题匹配"');

    const snippet = options.evidenceSnippet || (record.abstract ? record.abstract.slice(0, 300) + '...' : '正文段落已在检索层建立索引。');
    const hasFullText = Boolean(record.openAccess || record.pdfUrl || (record.doi && /^(10\.1016|10\.1109|10\.1007|10\.3390|10\.1371|10\.48550)/i.test(record.doi)));
    const fullTextAvailableStr = hasFullText ? 'Yes' : 'No';

    return [
      `### 📄 [FullText-${padIndex}] ${record.title}`,
      `- **基本信息**: ${basicInfo}`,
      `- **作者**: ${authorsStr}`,
      `- **引用统计**: ${citStr}`,
      `- **全文命中关键词**: ${matchedKw}`,
      `- **关键证据摘录**:`,
      `  > ${snippet.replace(/\n+/g, ' ')}`,
      `- **全文可获取**: ${fullTextAvailableStr}`
    ].join('\n');
  }

  private static buildCitationsSummary(record: LiteratureRecord): string {
    const parts: string[] = [];
    if (record.citedBy?.webofscience !== undefined) {
      parts.push(`WoS: ${record.citedBy.webofscience}`);
    }
    if (record.citedBy?.scopus !== undefined) {
      parts.push(`Scopus: ${record.citedBy.scopus}`);
    }
    if (record.citedBy?.ieee !== undefined) {
      parts.push(`IEEE: ${record.citedBy.ieee}`);
    }
    if (record.citedBy?.openalex !== undefined) {
      parts.push(`OpenAlex: ${record.citedBy.openalex}`);
    }
    if (record.citedBy?.crossref !== undefined) {
      parts.push(`Crossref: ${record.citedBy.crossref}`);
    }
    if (parts.length === 0) {
      return '暂无分库被引数据';
    }
    return parts.join(' | ');
  }
}
