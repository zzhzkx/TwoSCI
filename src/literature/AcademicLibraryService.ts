import * as fs from 'node:fs';
import * as path from 'node:path';
import { MineruService } from './MineruService.js';
import type { LiteratureRecord, ResearchBrief, ScreeningDecision } from './types.js';

export interface BuildLibraryOptions {
  brief?: ResearchBrief;
  screening?: Record<string, ScreeningDecision>;
  outputPath?: string;
  workDir?: string;
}

export interface AcademicLibraryResult {
  libraryMarkdownPath: string;
  bibtexPath: string;
  auditJsonPath: string;
  totalRecords: number;
  markdownContent: string;
}

export class AcademicLibraryService {
  /**
   * Build and write ACADEMIC_LIBRARY.md into ./twosci directory.
   */
  static buildLibrary(
    records: LiteratureRecord[],
    options: BuildLibraryOptions = {}
  ): AcademicLibraryResult {
    const workDir = options.workDir || process.cwd();
    const twosciDir = path.resolve(workDir, 'twosci');
    fs.mkdirSync(twosciDir, { recursive: true });

    const libraryMdPath = options.outputPath || path.join(twosciDir, 'ACADEMIC_LIBRARY.md');
    const bibtexPath = path.join(twosciDir, 'references.bib');
    const auditJsonPath = path.join(twosciDir, 'screening_audit.json');

    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' (UTC)';
    const topicStr = options.brief?.intent || '前沿科学文献调研与技术路线追踪';
    const seedStr = options.brief?.seed
      ? `${options.brief.seed.title} (DOI: ${options.brief.seed.doi || '无'})`
      : '（无初始种子文献）';

    const lines: string[] = [
      `# 📚 TwoSCI 学术文献数据库 (Academic Research Library)`,
      ``,
      `- **调研课题**: ${topicStr}`,
      `- **构建时间**: ${nowStr}`,
      `- **收录文献总数**: 共 ${records.length} 篇核心文献`,
      `- **基准种子文献**: ${seedStr}`,
      `- **本地全文资产目录**: \`./twosci/\``,
      ``,
      `---`,
      ``,
      `## 一、文献分类总览表 (Library Overview Table)`,
      ``,
      `| # | 标题 (Title) | 年份 | 期刊 / 出版源 | 初筛结论 | 本地全文目录 | 核心方案概要 |`,
      `|---|-------------|------|--------------|----------|-------------|-------------|`
    ];

    records.forEach((rec, i) => {
      const index = i + 1;
      const shortTitle = rec.title.length > 45 ? rec.title.slice(0, 42) + '...' : rec.title;
      const yearStr = rec.year ? String(rec.year) : 'ND';
      const venueStr = rec.venue ? (rec.venue.length > 20 ? rec.venue.slice(0, 18) + '..' : rec.venue) : '学术期刊';
      
      const screening = options.screening?.[rec.recordId];
      const verdictStr = screening?.verdict === 'include'
        ? '✅ 纳入'
        : (screening?.verdict === 'maybe' ? '❓ 待定' : (screening?.verdict === 'exclude' ? '❌ 排除' : '已收录'));
      
      const folderName = MineruService.buildDirectoryName(rec);
      const folderRelLink = `[查看目录](./${folderName}/)`;
      const summary = rec.keywords && rec.keywords.length > 0
        ? rec.keywords.slice(0, 2).join('; ')
        : (rec.abstract ? rec.abstract.slice(0, 30) + '...' : '核心技术方案');

      lines.push(`| ${index} | ${shortTitle} | ${yearStr} | ${venueStr} | ${verdictStr} | ${folderRelLink} | ${summary} |`);
    });

    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 二、结构化文献卡片档案 (Structured Records)`);
    lines.push(``);

    records.forEach((rec, i) => {
      const index = i + 1;
      const authorsStr = rec.authors.length > 0 ? rec.authors.join('; ') : '未知作者';
      const venueYear = rec.venue ? `${rec.venue} (${rec.year || 'ND'})` : (rec.year ? String(rec.year) : '未知出版物');
      const doiLink = rec.doi ? `[${rec.doi}](https://doi.org/${encodeURI(rec.doi)})` : '暂无 DOI';
      const folderName = MineruService.buildDirectoryName(rec);

      const abstractClean = rec.abstract && rec.abstract.trim()
        ? rec.abstract.trim().slice(0, 450) + (rec.abstract.length > 450 ? '...' : '')
        : '（该文献已收录，正文已在本地 MinerU 目录中建立解析索引）';

      lines.push(`### [Record #${index}] ${rec.title}`);
      lines.push(`- **作者 (Authors)**: ${authorsStr}`);
      lines.push(`- **出版信息**: ${venueYear}`);
      lines.push(`- **DOI**: ${doiLink}`);
      lines.push(`- **本地归档目录**: \`./twosci/${folderName}/\``);
      lines.push(`- **简要学术介绍**:`);
      lines.push(`  ${abstractClean.replace(/\n+/g, ' ')}`);
      lines.push(``);
    });

    lines.push(`---`);
    lines.push(``);
    lines.push(`## 三、引用与复现元数据 (Export & Reproduction)`);
    lines.push(`- **BibTeX 格式引文文件**: \`./twosci/references.bib\``);
    lines.push(`- **初筛审计日志**: \`./twosci/screening_audit.json\``);

    const markdownContent = lines.join('\n');
    fs.writeFileSync(libraryMdPath, markdownContent, 'utf8');

    // 写入 BibTeX 文件
    const bibtexContent = this.generateBibtex(records);
    fs.writeFileSync(bibtexPath, bibtexContent, 'utf8');

    // 写入审计 JSON
    const auditJson = {
      generatedAt: nowStr,
      topic: topicStr,
      recordsCount: records.length,
      screening: options.screening || {},
      records: records.map(r => ({
        recordId: r.recordId,
        title: r.title,
        authors: r.authors,
        year: r.year,
        venue: r.venue,
        doi: r.doi,
        sources: r.sources.map(s => s.source)
      }))
    };
    fs.writeFileSync(auditJsonPath, JSON.stringify(auditJson, null, 2), 'utf8');

    return {
      libraryMarkdownPath: libraryMdPath,
      bibtexPath,
      auditJsonPath,
      totalRecords: records.length,
      markdownContent
    };
  }

  private static generateBibtex(records: LiteratureRecord[]): string {
    return records.map((rec, i) => {
      const firstAuthorKey = rec.authors[0]?.split(/[\s,]+/)[0]?.replace(/[^a-zA-Z]/g, '') || `Paper${i + 1}`;
      const yearKey = rec.year || 'ND';
      const citeKey = `${firstAuthorKey}${yearKey}`;
      const authorList = rec.authors.join(' and ');
      return [
        `@article{${citeKey},`,
        `  title = {${rec.title}},`,
        `  author = {${authorList}},`,
        rec.venue ? `  journal = {${rec.venue}},` : '',
        rec.year ? `  year = {${rec.year}},` : '',
        rec.doi ? `  doi = {${rec.doi}},` : '',
        `}`
      ].filter(Boolean).join('\n');
    }).join('\n\n');
  }
}
