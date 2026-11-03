// 职责：洞察AI（AI 日报 / 后续行业动态等渠道）的类型定义。
// 渠道模型：每个渠道 = 一组资讯信源 + 写死提示词 + 按天缓存的报告。
// 新增渠道（如行业动态）只需在 constants/insight.ts 登记渠道定义，本文件类型无需改动。

/** 大模型服务商配置（设置页与 AI 工具内部共用，存 settings.json 的 aiProvider 字段） */
export interface AiProviderConfig {
  /** OpenAI 兼容接口根地址，如 https://api.deepseek.com/v1 */
  baseUrl: string;
  /** 用户自己的 API Key */
  apiKey: string;
  /** 模型名，如 deepseek-chat */
  model: string;
}

/** 单个服务商的模型列表缓存（settings.aiModelCache 的值，键为 baseUrl） */
export interface AiModelCacheEntry {
  /** 该服务商的模型 id 列表（经 GET /models 拉取） */
  models: string[];
  /** 拉取时间 ISO8601 */
  fetchedAt: string;
}

/** 从信源抓到的单条资讯（喂给大模型的素材） */
export interface NewsItem {
  /** 信源名称，如「机器之心」 */
  source: string;
  title: string;
  url: string;
  /** 摘要 / 正文片段，已去 HTML 标签；HN 等无正文的信源为空串 */
  summary: string;
  /** 原文发布时间（RSS pubDate 等，可能没有） */
  publishedAt?: string;
}

/** 单次加载记录：一日可补充加载多批，loadHistory 按时间先后追加 */
export interface InsightLoadRecord {
  /** 本次加载完成时间 ISO8601 */
  at: string;
  /** 本批参与归纳的素材条数 */
  itemCount: number;
}

/** 某渠道某一天的生成结果（insights.json 的存储单元）。合并式补充：content 始终是当日完整日报 */
export interface InsightReport {
  /** 渠道 id，如 ai-daily */
  channelId: string;
  /** 报告日期 YYYY-MM-DD */
  date: string;
  /** 生成的 Markdown 正文（最近一次补充后的完整版） */
  content: string;
  /** 最近一次生成/补充完成时间 ISO8601 */
  generatedAt: string;
  /** 使用的模型名 */
  model: string;
  /** 最近一批参与总结的资讯条数 */
  sourceCount: number;
  /** 全部加载批次（含首次生成），存量报告缺该字段时由加载逻辑补一条等价记录 */
  loadHistory: InsightLoadRecord[];
}

/** 原始素材归档批次：记录「哪些资讯已被消费」，供跨批次去重与昨日补充过滤 */
export interface RawBatch {
  /** 抓取时间 ISO8601 */
  fetchedAt: string;
  /** 本批实际消费（写入报告）的条目 */
  items: NewsItem[];
}

/** insights.json 顶层结构：渠道 → 日期 → 报告；rawArchive 按渠道归档已消费素材 */
export interface InsightsFile {
  version: number;
  reports: Record<string, Record<string, InsightReport>>;
  rawArchive: Record<string, RawBatch[]>;
}
