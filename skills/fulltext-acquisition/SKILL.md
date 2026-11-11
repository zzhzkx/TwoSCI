---
name: fulltext-acquisition
description: >
  用于全网学术论文全文获取与 MinerU 结构化解析。支持根据单篇 DOI/链接或批量 DOI 列表获取 PDF，
  并调用 MinerU 转化为 Markdown 及 img/ 图表切图。严格按规范在当前工作目录的 ./twosci/ 下进行文件管理。
---

# 全文获取与 MinerU 结构化解析 (Full-Text Acquisition)

本技能打通学术文献从“全网通道探测”、“PDF 安全下载”到“MinerU 转换为 Markdown 与插图”的自动化流。

## 1. 严格的文件系统存储契约

所有获取的文献只保存一份，严格落盘在**当前 Agent 工作目录下的 `twosci` 文件夹**中：

```
当前工作目录/
└── twosci/
    └── {第一作者}-{年份}-{论文名称}-{DOI}/
        ├── {论文名称}.pdf           (原版 PDF 文件)
        ├── {论文名称}.md            (MinerU 解析转换的高清 Markdown)
        └── img/                     (论文提取的所有图片、图表、公式切图)
            ├── figure_1_xxx.png
            └── ...
```

## 2. 操作流程

1. **接收入口**：
   - 单篇模式：用户提供单个 DOI 或文献 URL。
   - 批量模式：前序检索（基础检索或意图检索）筛选出的一组核心 DOI 列表。
2. **通道探测**：调用 `resolve_fulltext_access` 探测最优获取路径（Tier 1 OA直链 / Tier 2 出版商 API / Tier 3 校园网）。
3. **下载与解析**：调用 `download_and_parse_mineru`，传入 `dois` 或 `urls`。系统自动下载 PDF、调用 MinerU 转换为结构化 Markdown 并将插图提取到 `img/` 子目录。
4. **交付反馈**：向用户汇报成功解析的文献篇数、本地文件夹路径与图片资产数量。

## 3. 浏览器兜底

- 默认顺序：记录直链 → arXiv/Unpaywall/OpenAlex/Semantic Scholar/Europe PMC/PMC/Crossref → Elsevier API → 出版商 PDF 路由 → 落地页 HTML → Patchright 浏览器。
- Patchright 优先驱动本机 Chrome，其次 Edge；不捆绑 Chromium。
- `TWOSCI_BROWSER_HEADLESS=auto` 先无头运行，遇到 Akamai/Cloudflare 挑战自动切换有头模式。
- 浏览器共享单实例、持久 profile、拦截图片/字体/媒体，空闲 5 分钟关闭。
- 遇到 CAS/机构登录页会返回 `auth_required`；可让用户用有头模式人工登录一次，profile 会保留会话。
- Turnstile 不保证通过；不要向用户承诺绕过所有验证。
