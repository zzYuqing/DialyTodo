// 职责：行业资讯的存储常量、AI 初审与信源推荐提示词、动态日报渠道。
// 每个行业使用 AI 推荐且实测可用的专属信源；抓取与归纳仍复用洞察AI管线。

import type { IndustryProfile, IndustrySource } from "@/types";
import {
  INSIGHT_LLM_IDLE_TIMEOUT_MS,
  INSIGHT_LLM_TIMEOUT_MS,
  type InsightChannelDef,
} from "./insight";

/** 用户行业清单存储文件名（位于数据根目录下） */
export const INDUSTRIES_FILE = "industries.json";

/** 初审与上下游推荐沿用日报标准：整体 5 分钟、块间空闲 60 秒，兼容思考型模型 */
export const INDUSTRY_REVIEW_TIMEOUT_MS = INSIGHT_LLM_TIMEOUT_MS;
export const INDUSTRY_REVIEW_IDLE_TIMEOUT_MS = INSIGHT_LLM_IDLE_TIMEOUT_MS;

/** 汽车相关行业在 AI 信源全部失效时的实测兜底；仍需经过同一套 RSS 解析验证 */
export const AUTOMOTIVE_FALLBACK_SOURCES: IndustrySource[] = [
  {
    name: "盖世汽车 · 供应链",
    query: "https://auto.gasgoo.com/Rss/ClassRss.aspx?ClassId=103",
    take: 16,
  },
  {
    name: "盖世汽车 · 新技术",
    query: "https://auto.gasgoo.com/Rss/ClassRss.aspx?ClassId=409",
    take: 16,
  },
  {
    name: "盖世汽车 · 行业",
    query: "https://auto.gasgoo.com/Rss/ClassRss.aspx?ClassId=108",
    take: 16,
  },
];

/** 行业报告的渠道 id 与报告存储键 */
export function industryChannelId(industryId: string): string {
  return `industry:${industryId}`;
}

/** AI 初审只输出固定 JSON，界面据此决定能否添加 */
export const INDUSTRY_REVIEW_SYSTEM_PROMPT = [
  "你是「行业资讯」的行业准入编辑与信源研究员。判断用户输入是否是一个边界明确、适合持续跟踪公开资讯的行业或产业领域。",
  "可以接受具体行业、产业或清晰的细分领域（如人工智能、新能源汽车、汽车照明、生物医药）；不接受人名、公司名、单个产品、模糊主题或无法界定日报范围的词。",
  "通过时给出规范行业名、不超过 5 个常见别称，并推荐 1-4 个覆盖该行业的 RSS / Atom 信源，不要为凑数量推荐不确定的地址。",
  "信源要求：优先行业垂直媒体、协会、研究机构与企业资讯聚合；必须给出你明确知道的 RSS / Atom 订阅地址，不要给网站首页、新闻列表页或搜索页，不要编造地址。",
  "严禁推荐与所审行业无关的泛科技大众媒体（如雷锋网、IT之家、爱范儿等通用科技资讯源）作为行业信源——这类源内容庞杂，会把大量无关资讯倒进日报素材。只有在该行业确实找不到更垂直的源时，才允许使用其上级行业的综合行业媒体（例如汽车照明可使用汽车零部件或汽车产业综合信源）。",
  "优先中国大陆可直接访问的源，不要求信源允许浏览器跨域读取；若不确定地址或可用性，少推荐几个，由系统通过系统网络实际抓取验证。",
  "只输出一个 JSON 对象，不要 Markdown 代码块，不要额外解释。格式：",
  '{"approved":true,"name":"规范行业名","aliases":["别称"],"sources":[{"name":"信源名","url":"https://example.com/feed","take":12}],"reason":"80 字以内的初审理由"}',
  "不通过时 approved=false，name 回显用户输入，aliases=[]，sources=[]。全文使用简体中文。",
].join("\n");

/** 已有行业换源：不重新初审行业，只重新推荐并验证该行业的信源 */
export const INDUSTRY_SOURCE_REVIEW_SYSTEM_PROMPT = [
  "你是「行业资讯」的信源研究员。用户已有一个正在跟踪的行业，你需要为它重新推荐更合适的 RSS / Atom 信源，替换现有信源。",
  "推荐 1-4 个与该行业直接相关的信源，优先行业垂直媒体、协会、研究机构与企业资讯聚合；必须给出你明确知道的 RSS / Atom 订阅地址，不要给网站首页、新闻列表页或搜索页，不要编造地址。",
  "严禁推荐与该行业无关的泛科技大众媒体（如雷锋网、IT之家、爱范儿等通用科技资讯源）；细分行业缺少垂直源时，可用其上级行业的综合行业媒体（例如汽车照明可用汽车零部件或汽车产业综合信源）。",
  "优先中国大陆可直接访问的源，不要求允许浏览器跨域读取；不确定就少推荐，由系统通过系统网络实际抓取验证。",
  "只输出一个 JSON 对象，不要 Markdown 代码块，不要额外解释。格式：",
  '{"sources":[{"name":"信源名","url":"https://example.com/feed","take":12}],"reason":"60 字以内的换源说明"}',
  "全文使用简体中文。",
].join("\n");

/** 上下游推荐只列候选，不替用户决定保留或新增，也绝不递归展开 */
export const INDUSTRY_RELATION_SYSTEM_PROMPT = [
  "你是「行业资讯」的产业链研究员。基于已经通过初审的主行业，列出与日报跟踪直接相关的上游和下游行业或产业环节。",
  "上游指原材料、零部件、核心技术、设备等供应环节；下游指整机厂、客户、渠道与应用等需求环节。不要混淆方向。",
  "只推荐行业或产业环节，不要推荐单一公司、产品、人名或过于宽泛的主题；不要重复主行业，同一环节只出现一次。",
  "上下游合计推荐 4-10 项，两侧都应尽量覆盖；每项用一句简体中文说明它与主行业的关系，并给出不超过 5 个常见别称。",
  "每项推荐 1-3 个覆盖该环节的 RSS / Atom 信源。必须是明确知道的订阅地址，不要给网站首页、新闻列表页或搜索页，不要为凑数编造地址。",
  "严禁推荐与该环节无关的泛科技大众媒体（如雷锋网、IT之家、爱范儿等）；细分环节缺少垂直信源时，可使用覆盖该环节的上级行业综合媒体。优先中国大陆可直接访问的源，不要求允许浏览器跨域读取；若不确定就少推荐，系统只会通过系统网络实际验证用户最终选中的条目。",
  "只输出一个 JSON 对象，不要 Markdown 代码块，不要额外解释。格式：",
  '{"relations":[{"direction":"upstream","name":"产业环节名","aliases":["别称"],"reason":"与主行业的关系","sources":[{"name":"信源名","url":"https://example.com/feed","take":12}]}]}',
  "direction 只能是 upstream 或 downstream。全文使用简体中文。",
].join("\n");

/** 合并行业只整理用户已有的行业与信源，不凭空扩展新的跟踪范围或订阅地址 */
export const INDUSTRY_MERGE_SYSTEM_PROMPT = [
  "你是「行业资讯」的行业档案整理编辑。用户选择了多个已有行业，要把它们合并成一个新行业并共用日报。",
  "根据输入的行业名称、别称、已并入主题和现有信源，给出简洁准确的合并后名称、别称、关注范围与信源清单。",
  "信源只能从输入的现有信源中选择，按 URL 原样返回；去除重复和明显无关的源，保留能共同覆盖所有已选行业的源。严禁新增、猜测或改写订阅地址。",
  "合并后名称不超过 40 个字，别称不超过 12 个，信源最多 12 个。关注范围应保留所有原行业和已并入主题，不得悄悄缩窄。",
  "只输出一个 JSON 对象，不要 Markdown 代码块，不要额外解释。格式：",
  '{"name":"合并后行业名","aliases":["别称"],"includedTopics":["关注主题"],"sources":[{"name":"信源名","url":"必须来自输入的现有 URL","take":12}],"reason":"80 字以内的合并说明"}',
  "全文使用简体中文。",
].join("\n");

/** 同一天存在多份历史日报时，只基于这些原文整合，不能补充外部事实 */
export const INDUSTRY_REPORT_MERGE_SYSTEM_PROMPT = [
  "你是「行业资讯」的历史日报整合编辑。把同一天、不同原行业的日报合并成一份新的行业日报。",
  "只能使用输入日报正文中已经存在的事实、数据与表述，严禁新增外部事实、推测、预测或投资建议。",
  "同一事件重复出现时合并成一条；不同事件按内容自然分板块保留，不要因为篇幅限制删掉原日报中的独立资讯。",
  "保留「今日头条」与「今日观察」结构；观察只能归纳输入正文已有内容。",
  "不输出任何来源链接或裸露 URL，不解释合并过程，不要 Markdown 代码块。全文使用简体中文。",
  "开头只保留一个一级标题，格式为：输入日期 + 合并后行业名 + 行业日报。",
].join("\n");

/** 把某个行业转成洞察AI通用管线可消费的渠道定义 */
export function buildIndustryChannel(industry: IndustryProfile): InsightChannelDef {
  const industryLabel = `${industry.name}行业`;
  const aliasText = industry.aliases.length > 0 ? industry.aliases.join("、") : "无";
  const topicText =
    industry.includedTopics.length > 0 ? industry.includedTopics.join("、") : "无";
  const scopeText = `${industry.name}（别称：${aliasText}）；并入的上下游主题：${topicText}`;

  const systemPrompt = [
    `你是「行业资讯」的资深行业编辑，负责撰写每日${industryLabel}日报。`,
    `跟踪范围：${scopeText}。并入主题与主行业同等重要，相关素材也应纳入日报。`,
    "铁律（必须严格遵守）：",
    "1. 只能使用「素材」清单中提供的新闻条目，严禁编造、推测或引入素材之外的事实、数据、公司名、产品名与数字。",
    "2. 只保留与跟踪行业直接相关的素材；弱相关或纯广告素材直接丢弃。素材不足以支撑的内容不要写。",
    "3. 素材之间说法矛盾时如实并列呈现，不要自行调和。",
    "4. 输出中不要包含任何来源链接：不写 [文字](url) 形式的 Markdown 链接，也不裸露 URL。",
    "5. 全文使用简体中文，输出 Markdown；同一事件被多个信源重复报道时合并成一条。",
  ].join("\n");

  const supplementSystemPrompt = [
    `你是「行业资讯」的资深行业编辑，此前已撰写一份${industryLabel}日报（见「已有日报」）。`,
    "现在拿到了此后新抓取的补充素材（见「新增素材」）。你的任务是输出更新后的完整日报。",
    `只跟踪以下范围：${scopeText}。丢弃与主行业及并入主题弱相关或纯广告的素材。`,
    "铁律（必须严格遵守）：",
    "1. 「新增素材」中与已有日报重复的新闻直接丢弃，全文任何位置都不得重复出现同一事件。",
    "2. 新事件按内容融入对应板块；重要性足以改变判断时更新「今日头条」。",
    "3. 只使用「已有日报」与「新增素材」中的事实，严禁编造、推测或引入两者之外的内容。",
    "4. 不输出任何来源链接或裸露 URL；全文使用简体中文 Markdown。",
    "5. 结尾「今日观察」结合补充后的全部素材重新归纳，只归纳，不预测、不给投资建议。",
  ].join("\n");

  return {
    id: industryChannelId(industry.id),
    label: `${industry.name}日报`,
    desc: `每天汇总${industry.name}行业的重要动态。`,
    // 信源按行业隔离；时段过滤、去重和补充仍走通用管线
    sources: industry.sources.map((source) => ({ ...source, kind: "rss" as const })),
    systemPrompt,
    supplementSystemPrompt,
    buildUserPrompt: (dateLabel, items) =>
      [
        `今天是 ${dateLabel}。请基于以下素材撰写今日${industryLabel}日报。`,
        `跟踪范围：${scopeText}。主行业与并入主题的素材都要判断和收录。`,
        "",
        "素材（JSON 数组，每条含来源、标题、链接、摘要、发布时间）：",
        JSON.stringify(items),
        "",
        "输出要求（Markdown）：",
        `1. 开头一行一级标题：${dateLabel} ${industryLabel}日报。`,
        "2. 「今日头条」板块：素材中最值得关注的 1-3 条，每条 2-3 句话。",
        "3. 之后按素材内容自然分板块，只写有素材的板块。",
        "4. 每条新闻一句话概括核心事实，再补一句细节或背景（背景只能来自素材本身）。",
        "5. 结尾「今日观察」：3-5 句话归纳今天素材体现出的行业趋势，只归纳，不预测、不给投资建议。",
        "6. 全文 400-800 字；若素材均与行业无关，如实说明今日没有可用行业资讯，不得编造。",
      ].join("\n"),
    buildSupplementUserPrompt: (dateLabel, existingContent, items) =>
      [
        `日期：${dateLabel}。跟踪范围：${scopeText}。`,
        "",
        "已有日报（Markdown，此前生成的版本）：",
        existingContent,
        "",
        "新增素材（JSON 数组，此后新抓取的新闻）：",
        JSON.stringify(items),
        "",
        "请输出更新后的完整版行业日报（Markdown，保持原有结构，融入新增素材）。",
      ].join("\n"),
  };
}
