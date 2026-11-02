// 职责：洞察AI的渠道定义、写死提示词、资讯信源与模型预设。
// 渠道仅开发侧维护（与 ToolsView 的 TOOLS 同约定）：新增渠道在此追加一项即可，
// 视图与服务层按渠道 id 通用处理，为「行业动态」等后续渠道复用同一套管线。
//
// 资讯真实性约束：报告只能基于 fetch 到的真实条目，提示词里对此有硬性要求；
// 大模型知识截止日期问题由「先抓资讯再总结」的方案规避，禁止让模型凭空写日报。

import type { NewsItem } from "@/types";

/** 单个资讯信源定义 */
export interface InsightSourceDef {
  /** 信源展示名，同时写入素材的 source 字段 */
  name: string;
  /**
   * 抓取策略：
   * - rss  RSS / Atom 订阅源（XML，正文有摘要）
   * 信源必须「国内可达 + 自带 CORS 放行」双达标，登记前实测验证；
   * 前端直连被 CORS 拦截时会尝试境外公共转发兜底，但访问不了境外的网络下兜底同样失效。
   */
  kind: "rss";
  /** 订阅地址（RSS / Atom） */
  query: string;
  /** 该信源最多取多少条素材 */
  take: number;
}

/** 渠道定义：信源 + 提示词。id 同时是 insights.json 的存储键。 */
export interface InsightChannelDef {
  id: string;
  label: string;
  desc: string;
  sources: InsightSourceDef[];
  /** 写死的系统提示词（开发侧维护，用户不可见不可改）：首次生成模式 */
  systemPrompt: string;
  /** 写死的系统提示词：补充模式（把新素材融入已有日报，产出完整版） */
  supplementSystemPrompt: string;
  /** 写死的用户提示词模板：素材与日期由服务层填入（首次生成） */
  buildUserPrompt: (dateLabel: string, items: NewsItem[]) => string;
  /** 写死的用户提示词模板：已有日报 + 新增素材（补充模式） */
  buildSupplementUserPrompt: (
    dateLabel: string,
    existingContent: string,
    items: NewsItem[],
  ) => string;
}

/** 洞察AI报告存储文件名（位于数据根目录下） */
export const INSIGHTS_FILE = "insights.json";

/** 每个渠道最多保留多少天的历史报告，超出部分生成新报告时滚动清理 */
export const INSIGHT_REPORT_KEEP_DAYS = 30;

/**
 * 当日最早可生成小时（0-23）：此前当日新闻太少，按钮禁用。
 * 早上时段的替代动作是补充昨日日报（昨日全天任何时间都可补）。
 */
export const INSIGHT_TODAY_START_HOUR = 12;

/** 每个渠道保留多少个已消费素材批次，超出滚动清理（跨批次去重的依据） */
export const INSIGHT_RAW_ARCHIVE_KEEP = 20;

/** 单个信源请求超时（毫秒）。信源多、逐个抓，单个不能拖太久 */
export const INSIGHT_SOURCE_TIMEOUT_MS = 10000;

/** 大模型生成的整体超时（毫秒）。推理模型（kimi-k3）归纳长素材动辄数分钟，给到 5 分钟 */
export const INSIGHT_LLM_TIMEOUT_MS = 300000;

/** 大模型流式生成的块间空闲超时（毫秒）：超过该时长没有任何数据视为连接卡死 */
export const INSIGHT_LLM_IDLE_TIMEOUT_MS = 60000;

/**
 * 公共 CORS 转发兜底（allorigins）。前端直连被目标站 CORS 拦截时
 * （fetch 以 TypeError 失败，可捕获）改走转发再试一次。
 * 注意：allorigins 自身在境外，访问不了国外站点的网络环境下本兜底同样失效——
 * 因此渠道登记的信源必须「国内可达 + 自带 CORS 放行」双达标（均已实测验证），
 * 本兜底只作为个别网络环境下的补充，不能当主力通道。
 */
export const CORS_RELAY_RAW_URL = "https://api.allorigins.win/raw?url=";

/** 模型下拉预设（OpenAI 兼容接口，主流服务商的常见模型；名字以各平台控制台为准） */
export const AI_MODEL_PRESETS: { label: string; model: string }[] = [
  { label: "DeepSeek · deepseek-chat", model: "deepseek-chat" },
  { label: "Kimi · kimi-k3", model: "kimi-k3" },
  { label: "Kimi · kimi-k2.6", model: "kimi-k2.6" },
  { label: "通义千问 · qwen-plus", model: "qwen-plus" },
  { label: "智谱 · glm-4-plus", model: "glm-4-plus" },
  { label: "OpenAI · gpt-4o-mini", model: "gpt-4o-mini" },
];

/** API 地址下拉预设（OpenAI 兼容端点） */
export const AI_BASE_URL_PRESETS: { label: string; baseUrl: string }[] = [
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { label: "Kimi（月之暗面）", baseUrl: "https://api.moonshot.cn/v1" },
  { label: "通义千问（兼容模式）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
];

// ---------------------------------------------------------------------------
// 渠道登记（当前仅 AI 日报；行业动态等后续渠道在此追加）
// ---------------------------------------------------------------------------

const AI_DAILY_SYSTEM_PROMPT = [
  "你是「洞察AI」的资深科技编辑，负责撰写每日 AI 行业日报。",
  "铁律（必须严格遵守）：",
  "1. 只能使用「素材」清单中提供的新闻条目，严禁编造、推测或引入素材之外的事实、数据、公司名、产品名与数字。",
  "2. 素材不足以支撑的内容不要写；素材之间说法矛盾时如实并列呈现，不要自行调和。",
  "3. 输出中不要包含任何来源链接：不写 [文字](url) 形式的 Markdown 链接，也不裸露 URL。",
  "4. 全文使用简体中文，输出 Markdown。",
  "5. 同一事件被多个信源重复报道时合并成一条，信源名称可在句中以纯文字提及（如「据雷峰网报道」），不加链接。",
].join("\n");

const AI_DAILY_USER_PROMPT_TEMPLATE = [
  "今天是 {date}。请基于以下素材撰写今日 AI 日报。",
  "",
  "素材（JSON 数组，每条含来源、标题、链接、摘要、热度；summary 为空的条目只有标题与链接）：",
  "{items}",
  "",
  "输出要求（Markdown）：",
  "1. 开头一行一级标题：{date} AI 日报。",
  "2. 「今日头条」板块：素材中最值得关注的 1-3 条，每条 2-3 句话。",
  "3. 之后按素材内容自然分板块，板块名自拟（如：大模型与技术进展 / 产品与应用 / 研究论文 / 社区热议），只写有素材的板块，素材撑不起来的板块整个省略。",
  "4. 每条新闻一句话概括核心事实，再补一句细节或背景（背景只能来自素材本身）。",
  "5. 结尾「今日观察」：3-5 句话归纳今天素材体现出的趋势，只归纳，不预测、不给投资建议。",
  "6. 全文 400-800 字；与 AI 弱相关或纯广告的素材直接丢弃不用。",
].join("\n");

// 补充模式（合并式）：把新增素材融入已有日报，产出当日完整版
const AI_DAILY_SUPPLEMENT_SYSTEM_PROMPT = [
  "你是「洞察AI」的资深科技编辑，此前已基于较早的素材撰写了一份 AI 日报（见用户消息中的「已有日报」）。",
  "现在拿到了此后新抓取的补充素材（见「新增素材」）。你的任务是输出更新后的完整日报。",
  "铁律（必须严格遵守）：",
  "1. 「新增素材」中与已有日报重复的新闻（同一事件）直接丢弃，全文任何位置都不得重复出现同一事件。",
  "2. 新增素材中的新事件按内容融入对应板块；重要性足以改变判断时更新「今日头条」。",
  "3. 只使用「已有日报」与「新增素材」中的事实，严禁编造、推测或引入两者之外的内容。",
  "4. 输出中不要包含任何来源链接：不写 [文字](url) 形式的链接，也不裸露 URL；全文简体中文 Markdown。",
  "5. 结尾「今日观察」结合补充后的全部素材重新归纳，可改写原观察。",
  "6. 篇幅较原日报适度增长即可，不要为凑数重复罗列。",
].join("\n");

const AI_DAILY_SUPPLEMENT_USER_TEMPLATE = [
  "日期：{date}。",
  "",
  "已有日报（Markdown，此前生成的版本）：",
  "{existing}",
  "",
  "新增素材（JSON 数组，此后新抓取的新闻）：",
  "{items}",
  "",
  "请输出更新后的完整版日报（Markdown，保持原有结构，融入新增素材）。",
].join("\n");

export const INSIGHT_CHANNELS: InsightChannelDef[] = [
  {
    id: "ai-daily",
    label: "AI 日报",
    desc: "每天汇总全球 AI 领域的重要动态。",
    sources: [
      // 以下三个信源均为 RSS 2.0、国内可达 + 自带 CORS 放行（2026-11-02 在用户机器上
      // 实测验证过响应体确为有效 feed）。用户网络访问不了境外站点，禁止登记境外信源
      // （Google News / arXiv / HN 已因此移除）；境外公共转发（allorigins）在该网络下
      // 同样不可达，不能作为兜底依赖。
      // 注意：部分站点（品玩 / 51CTO 实测）对 feed 地址返回 404 页或反爬 JS 挑战，
      // 状态码却是 200——登记新信源时必须验证响应体是合法 XML。
      // take 调大：补充模式要按 pubDate 过滤目标时段，feed 多拿一些才能覆盖到。
      // 雷峰网（AI 科技评论）：中文 AI 垂直媒体，主力信源
      { name: "雷峰网", kind: "rss", query: "https://www.leiphone.com/feed", take: 16 },
      // 少数派：效率与科技，AI 内容占比高，ACAO: *
      { name: "少数派", kind: "rss", query: "https://sspai.com/feed", take: 12 },
      // 极客公园：科技产业报道，AI 覆盖多（放行方式为回显 Origin，开发/正式环境均可用）
      { name: "极客公园", kind: "rss", query: "https://www.geekpark.net/rss", take: 12 },
    ],
    systemPrompt: AI_DAILY_SYSTEM_PROMPT,
    supplementSystemPrompt: AI_DAILY_SUPPLEMENT_SYSTEM_PROMPT,
    buildUserPrompt: (dateLabel, items) =>
      AI_DAILY_USER_PROMPT_TEMPLATE.replace("{date}", dateLabel).replace(
        "{items}",
        JSON.stringify(items),
      ),
    buildSupplementUserPrompt: (dateLabel, existingContent, items) =>
      AI_DAILY_SUPPLEMENT_USER_TEMPLATE.replace("{date}", dateLabel)
        .replace("{existing}", existingContent)
        .replace("{items}", JSON.stringify(items)),
  },
];
