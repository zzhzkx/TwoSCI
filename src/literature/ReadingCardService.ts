/**
 * Reading Card & Evidence Extraction Service.
 *
 * Designed to companion with MinerU PDF-to-Markdown parsers or full-text agents,
 * transforming long academic papers into rigorous, structured scientific evidence cards.
 */

import type { LiteratureRecord, ResearchBrief } from './types.js';
import type { FullTextRoute } from './FullTextRouter.js';

export interface ReadingCardTemplate {
  recordId: string;
  title: string;
  doi: string;
  venue?: string;
  year?: number;
  authors: string[];
  fullTextRoute?: FullTextRoute;
  screeningVerdict?: string;
  screeningReason?: string;
  markdownTemplate: string;
  mineruPrompt: string;
}

export interface ReadingPacketResult {
  totalCards: number;
  briefContext?: {
    intent?: string;
    focusAreas?: string[];
    seedDoi?: string;
  };
  cards: ReadingCardTemplate[];
  combinedMarkdown: string;
}

export class ReadingCardService {
  /**
   * Generate a structured reading packet for a collection of literature records.
   */
  static generatePacket(
    records: LiteratureRecord[],
    routesMap?: Map<string, FullTextRoute>,
    screeningMap?: Record<string, { verdict: string; reason: string }>,
    brief?: ResearchBrief
  ): ReadingPacketResult {
    const cards: ReadingCardTemplate[] = records.map((record, index) => {
      const route = routesMap?.get(record.recordId);
      const screening = screeningMap?.[record.recordId];
      return this.generateSingleCard(record, index + 1, route, screening, brief);
    });

    const combinedMarkdown = this.buildCombinedMarkdown(cards, brief);

    return {
      totalCards: cards.length,
      briefContext: brief
        ? {
            intent: brief.intent,
            focusAreas: brief.focus,
            seedDoi: brief.seed?.doi
          }
        : undefined,
      cards,
      combinedMarkdown
    };
  }

  /**
   * Generate a reading card template for a single literature record.
   */
  static generateSingleCard(
    record: LiteratureRecord,
    index: number,
    route?: FullTextRoute,
    screening?: { verdict: string; reason: string },
    brief?: ResearchBrief
  ): ReadingCardTemplate {
    const title = record.title || 'Untitled Paper';
    const doi = record.doi || 'N/A';
    const authorsStr = record.authors?.join(', ') || 'Unknown Authors';
    const venueStr = record.venue || 'Academic Journal / Conference';
    const yearStr = record.year ? String(record.year) : 'n.d.';

    const bestPdf = route?.bestPdfUrl ? `[PDF 链接](${route.bestPdfUrl})` : (record.pdfUrl ? `[PDF 链接](${record.pdfUrl})` : '需通过机构/出版商获取');
    const channelStr = route?.channelDetails?.recommendedMethod || (record.openAccess ? '开放获取 (OA)' : '机构通道');

    const intentContext = brief?.intent ? `> **本次调研目标**: ${brief.intent}\n` : '';

    const template = [
      `# 【文献精读卡 #${index}】${title}`,
      '',
      '## 一、文献基本信息与获取路径',
      `- **标题 (Title)**: ${title}`,
      `- **作者 (Authors)**: ${authorsStr}`,
      `- **出版信息 (Publication)**: ${venueStr} (${yearStr})`,
      `- **DOI**: [${doi}](https://doi.org/${doi})`,
      `- **全文获取渠道 (Full-Text Channel)**: ${channelStr}`,
      `- **PDF 推荐地址**: ${bestPdf}`,
      ...(screening ? [
        `- **前期初筛评估**: ${screening.verdict === 'include' ? '✅ 纳入核心精读' : '❓ 待定研判'}`,
        `- **初筛纳入理由**: ${screening.reason}`
      ] : []),
      '',
      '## 二、与本研究课题的关联度 (Relevance)',
      intentContext,
      `- **本工作解决的核心痛点**: *(请基于 MinerU 解析后的引言第一/二节提炼)*`,
      `- **与基准种子工作的承接或对比点**: *(与本课题研究方案的异同)*`,
      '',
      '## 三、核心方案与数学/算法推导 (Methodology & Algorithms)',
      '- **核心系统架构/模型物理图景**:',
      '  - ',
      '- **关键算法步骤与公式推导 (支持 LaTeX $...$ 表达)**:',
      '  - 步骤 1: ',
      '  - 步骤 2: ',
      '  - 关键公式: $$ $$',
      '',
      '## 四、实验验证与量化性能指标对比表 (Quantitative Benchmark)',
      '*(请从正文表格或实验结果段落中精确提取量化数值，禁止编造)*',
      '',
      '| 评估指标 (Metric) | 本文实测/仿真数值 | 对比基线 (Baseline) | 提升幅度 / 结论 |',
      '|-------------------|-------------------|---------------------|-----------------|',
      '| 核心性能指标 1     |                   |                     |                 |',
      '| 核心性能指标 2     |                   |                     |                 |',
      '| 计算开销 / 效率    |                   |                     |                 |',
      '| 误差 / 精度 / 损失 |                   |                     |                 |',
      '',
      '## 五、实验设置与环境约束 (Experimental Setup & Constraints)',
      '- **数据集 / 样本规模 / 实验对象**: ',
      '- **测试环境 / 硬件平台 / 参数配置**: ',
      '',
      '## 六、局限性与未来研究切入点 (Limitations & Research Gaps)',
      '- **作者明确承认的缺陷/未覆盖场景**: ',
      '- **对我们当前课题的启发与后续可改进方向**: ',
      '',
      '---',
      ''
    ].join('\n');

    const domain = brief?.scope?.discipline
      || (brief?.focus?.length ? brief.focus.join(' / ') : '')
      || (record.categories?.length ? record.categories.join(' / ') : '')
      || '相关学术研究';

    const prompt = [
      `请作为【${domain}】领域的严谨科研评审专家，基于 MinerU 提取自论文《${title}》(DOI: ${doi}) 的 Markdown 全文，`,
      `严格按照上述【文献精读卡】的 6 大板块提取学术证据。要求：`,
      `1. 所有的数值指标必须来源于原文表格或图注，严禁虚构。`,
      `2. 公式推导请使用标准 LaTeX 表达。`,
      `3. 突出该工作对当前研究意图（"${brief?.intent || '相关领域'}"）的技术启发与局限性。`
    ].join('\n');

    return {
      recordId: record.recordId,
      title,
      doi,
      venue: record.venue,
      year: record.year,
      authors: record.authors,
      fullTextRoute: route,
      screeningVerdict: screening?.verdict,
      screeningReason: screening?.reason,
      markdownTemplate: template,
      mineruPrompt: prompt
    };
  }

  private static buildCombinedMarkdown(cards: ReadingCardTemplate[], brief?: ResearchBrief): string {
    const header = [
      '# TwoSCI 文献精读证据包 (Reading Packet & Extraction Cards)',
      '',
      `- **生成时间**: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
      `- **精读文献总数**: 共 ${cards.length} 篇核心文献`,
      ...(brief ? [
        `- **研究意图 (Intent)**: ${brief.intent}`,
        `- **基准种子文献 (Seed)**: ${brief.seed?.title} (DOI: ${brief.seed?.doi || 'N/A'})`
      ] : []),
      '',
      '---',
      '',
      '> **使用提示**：本精读证据包已预设规范的学术提取 Schema。将 PDF 文件交由 MinerU 解析后，可将对应的精读卡模板与解析文本输入分析 Agent，自动化完成结构化知识入库。',
      '',
      '---',
      ''
    ].join('\n');

    return header + '\n' + cards.map(c => c.markdownTemplate).join('\n\n');
  }
}

export default ReadingCardService;
