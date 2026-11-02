// 职责：洞察AI的生成管线与报告存储（insights.json）。
// 管线：按渠道定义抓资讯（逐信源容错、进度汇报）→ 目标时段过滤 + 跨批次去重
//       → 首次生成 / 合并式补充（把新素材融入已有日报，产出当日完整版）→ 按天缓存落盘。
// 真实性命门：素材全部来自实时抓取，模型只负责归纳，提示词禁止其编造；
// 任一新源失败只降级跳过，全部失败才报错。
// 一日多批次：报告 content 始终是该日完整版，loadHistory 记录每次加载；已消费素材
// 记入 rawArchive，既供跨批次去重，也是「昨日后续消息」的素材池。
// 新增渠道（行业动态等）在 constants/insight.ts 登记后，本服务零改动直接可用。

import { join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { format } from "date-fns";
import {
  INSIGHT_CHANNELS,
  INSIGHT_RAW_ARCHIVE_KEEP,
  INSIGHT_REPORT_KEEP_DAYS,
  INSIGHT_SOURCE_TIMEOUT_MS,
  INSIGHT_TODAY_START_HOUR,
  INSIGHTS_FILE,
  type InsightChannelDef,
} from "@/constants";
import { addDaysToKey, fromDateKey, todayKey } from "@/lib";
import type {
  AiProviderConfig,
  InsightReport,
  InsightsFile,
  NewsItem,
} from "@/types";
import { fetchPublicText, streamChatCompletion } from "./aiService";
import { atomicWrite } from "./atomicWrite";
import { dataRoot } from "./paths";

// ---------------------------------------------------------------------------
// 渠道与报告的读取
// ---------------------------------------------------------------------------

/** 按 id 找渠道定义，未知 id 返回 null */
export function getInsightChannel(channelId: string): InsightChannelDef | null {
  return INSIGHT_CHANNELS.find((c) => c.id === channelId) ?? null;
}

/** 内存缓存：会话内读一次 insights.json，保存后原地更新 */
let fileCache: InsightsFile | null = null;

/** 读 insights.json；缺失 / 损坏按空文件处理（报告是可再生成的缓存，丢了不心疼） */
export async function loadInsights(): Promise<InsightsFile> {
  if (fileCache !== null) return fileCache;
  try {
    const path = await join(await dataRoot(), INSIGHTS_FILE);
    if (await exists(path)) {
      const parsed: unknown = JSON.parse(await readTextFile(path));
      if (isInsightsFile(parsed)) {
        fileCache = normalizeInsightsFile(parsed);
        return fileCache;
      }
    }
  } catch {
    // 损坏不阻塞：报告可重新生成
  }
  fileCache = { version: 1, reports: {}, rawArchive: {} };
  return fileCache;
}

/** 写 insights.json（原子写），并同步内存缓存 */
export async function saveInsights(file: InsightsFile): Promise<void> {
  fileCache = file;
  await atomicWrite(await join(await dataRoot(), INSIGHTS_FILE), JSON.stringify(file, null, 2));
}

/** 取某渠道某天的报告，没有返回 null */
export async function getReport(channelId: string, dateKey: string): Promise<InsightReport | null> {
  const file = await loadInsights();
  return file.reports[channelId]?.[dateKey] ?? null;
}

/**
 * 统计最终报告里实际成文的资讯条数：按 ## 模块内「条目块」计数——
 * 每个独立段落算 1 条；整块都是列表行（- / * / 数字序号开头）的按行数计；
 * 「今日观察」是归纳性文字，不计。报告为合并式完整版，结果即「这份日报讲了几条新闻」。
 */
export function countReportItems(content: string): number {
  const LIST_LIKE = /^\s*([-*+]|\d{1,2}[.、)])\s/;
  const SKIP_SECTION = /今日观察/;
  let count = 0;
  let section: string | null = null;
  let block: string[] = [];

  const flush = () => {
    if (block.length === 0) return;
    count += block.every((l) => LIST_LIKE.test(l)) ? block.length : 1;
    block = [];
  };

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      flush();
      section = line.slice(3);
    } else if (line === "") {
      flush();
    } else if (section !== null && !SKIP_SECTION.test(section)) {
      block.push(line);
    }
  }
  flush();
  return count;
}

/**
 * 某渠道各日期的「报告条数」（最终日报成文的资讯条数，见 countReportItems），供月历格子显示。
 */
export async function listReportStats(channelId: string): Promise<Record<string, number>> {
  const file = await loadInsights();
  const byDate = file.reports[channelId];
  if (byDate === undefined) return {};
  const stats: Record<string, number> = {};
  for (const [dateKey, report] of Object.entries(byDate)) {
    stats[dateKey] = countReportItems(report.content);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// 可生成性规则（在点击时判定，不做定时器）
// ---------------------------------------------------------------------------

export interface DayAvailability {
  allowed: boolean;
  /** 不允许时的原因（按钮旁提示） */
  reason: string | null;
}

/**
 * 目标日期是否允许生成/补充：
 * - 未来日期：不允许
 * - 今日：INSIGHT_TODAY_START_HOUR 点之前不允许（当日新闻尚早）；之后允许
 * - 昨日：全天允许，但仅允许今日补充一次（loadHistory 已有今日记录则关闭）
 * - 前日及更早：只读存档（feed 也已滚过，事实上无法生成）
 */
export function getDayAvailability(
  channelId: string,
  dateKey: string,
  now: Date = new Date(),
  loadedToday: boolean = false,
): DayAvailability {
  if (getInsightChannel(channelId) === null) return { allowed: false, reason: "未知渠道" };
  const today = todayKey();
  if (dateKey > today) return { allowed: false, reason: "未来日期不能生成" };
  if (dateKey === today) {
    if (now.getHours() < INSIGHT_TODAY_START_HOUR) {
      return {
        allowed: false,
        reason: `当日新闻尚早，${INSIGHT_TODAY_START_HOUR}:00 后开放生成；可以先补充昨日日报`,
      };
    }
    return { allowed: true, reason: null };
  }
  if (dateKey === addDaysToKey(today, -1)) {
    if (loadedToday) {
      return { allowed: false, reason: "昨日日报今天已补充过一次，明天请直接生成当日日报" };
    }
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: "仅支持生成今日与昨日，更早的日期只读存档" };
}

// ---------------------------------------------------------------------------
// 生成管线
// ---------------------------------------------------------------------------

/** 补充模式下「该时段没有新资讯」的专用错误，视图层单独友好提示（不算失败） */
export class NoNewItemsError extends Error {
  constructor() {
    super("该时段没有新的资讯，无需补充");
    this.name = "NoNewItemsError";
  }
}

/** 生成过程的可选回调：进度行 + 流式正文的实时累计（用于界面进度展示） */
export interface GenerateOptions {
  onProgress?: (line: string) => void;
  onToken?: (accumulated: string) => void;
  /** 推理内容的实时累计（仅思考型模型有输出） */
  onReasoning?: (accumulatedReasoning: string) => void;
}

/**
 * 生成（或补充）某渠道指定日期的日报并落盘。
 * dateKey 缺省为今天；传 existing（该日期已有报告）即进入合并式补充模式。
 * 全程通过 opts.onProgress 汇报进度，opts.onToken 实时回传模型流式输出的累计正文。
 */
export async function generateInsightReport(
  channelId: string,
  config: AiProviderConfig,
  dateKey: string = todayKey(),
  opts: GenerateOptions = {},
  existing: InsightReport | null = null,
): Promise<InsightReport> {
  const channel = getInsightChannel(channelId);
  if (channel === null) throw new Error(`未知渠道：${channelId}`);
  const say = (line: string) => opts.onProgress?.(line);
  const dayLabel = format(fromDateKey(dateKey), "M月d日");

  // 0. 目标时段：补充=上次加载之后；昨日=昨天全天；今日=今天 0 点之后
  const window = resolveWindow(dateKey, existing);
  say("正在抓取资讯…");

  // 1. 抓素材：逐信源独立容错，只汇报条数、不逐个展示信源（用户不关心在读哪个站）
  const fetchedAll: NewsItem[] = [];
  const failures: string[] = [];
  for (const source of channel.sources) {
    try {
      const fetched = await fetchRssItems(source.name, source.query, source.take);
      if (fetched.length > 0) fetchedAll.push(...fetched);
      else failures.push(`${source.name} 没有抓到条目`);
    } catch {
      failures.push(`${source.name} 抓取失败`);
    }
  }

  // 2. 目标时段过滤 + 跨批次去重（rawArchive 里已消费过的不再用）
  const file = await loadInsights();
  const consumedKeys = collectConsumedKeys(file.rawArchive[channelId]);
  const inWindow = fetchedAll.filter((item) =>
    isInWindow(item, window.startMs, window.endMs, window.requireDate),
  );
  const fresh = dedupeItems(inWindow).filter((item) => !consumedKeys.has(itemKey(item)));
  say(
    `抓取 ${fetchedAll.length} 条，${dayLabel}时段内 ${inWindow.length} 条，` +
      `去掉已报道的后 ${fresh.length} 条新素材`,
  );
  if (fresh.length === 0) {
    if (existing !== null) throw new NoNewItemsError();
    const detail = failures.length > 0 ? `（${failures.join("；")}）` : "";
    throw new Error(`没有抓到任何资讯${detail}，请检查网络后重试`);
  }

  // 3. 拼提示词：首次生成 or 合并式补充，流式调模型（逐字回传）
  say(`调用 ${config.model.trim()} 归纳中…`);
  const dateLabel = format(fromDateKey(dateKey), "yyyy年M月d日");
  const messages =
    existing === null
      ? [
          { role: "system" as const, content: channel.systemPrompt },
          { role: "user" as const, content: channel.buildUserPrompt(dateLabel, fresh) },
        ]
      : [
          { role: "system" as const, content: channel.supplementSystemPrompt },
          {
            role: "user" as const,
            content: channel.buildSupplementUserPrompt(dateLabel, existing.content, fresh),
          },
        ];
  const content = await streamChatCompletion(config, messages, {
    onReasoningStart: () => say("模型正在思考…"),
    onReasoning: (accumulatedReasoning) => opts.onReasoning?.(accumulatedReasoning),
    onContent: (accumulated) => opts.onToken?.(accumulated),
  });
  say("生成完成，已保存");

  // 4. 落盘：报告（合并 loadHistory）+ 素材归档 + 滚动清理
  const nowIso = new Date().toISOString();
  const report: InsightReport = {
    channelId,
    date: dateKey,
    content,
    generatedAt: nowIso,
    model: config.model.trim(),
    sourceCount: fresh.length,
    loadHistory: [
      ...(existing?.loadHistory ?? []),
      { at: nowIso, itemCount: fresh.length },
    ],
  };
  const byDate = { ...(file.reports[channelId] ?? {}) };
  byDate[dateKey] = report;
  file.reports[channelId] = pruneChannelReports(byDate);
  const archive = [...(file.rawArchive[channelId] ?? []), { fetchedAt: nowIso, items: fresh }];
  file.rawArchive[channelId] = archive.slice(-INSIGHT_RAW_ARCHIVE_KEEP);
  await saveInsights(file);
  return report;
}

/** 目标时段窗口：补充=上次加载之后→目标日结束；昨日=昨天全天；今日=今天 0 点→现在 */
function resolveWindow(
  dateKey: string,
  existing: InsightReport | null,
): { startMs: number; endMs: number; requireDate: boolean } {
  const nowMs = Date.now();
  // 目标日的日终：补充非今日日期时，窗口不允许越过当天 24:00（否则今天的新闻会混入昨天的报告）
  const dayEnd = fromDateKey(dateKey);
  dayEnd.setHours(23, 59, 59, 999);
  const cappedEndMs = Math.min(dayEnd.getTime(), nowMs);

  if (existing !== null) {
    // 补充今日：只取上次加载之后的消息。无 pubDate 的条目靠跨批次去重兜底，仍放行。
    return { startMs: Date.parse(existing.generatedAt), endMs: cappedEndMs, requireDate: false };
  }
  // 首次生成：今日=今天 0 点之后；昨日=昨天全天（无 pubDate 的条目无法归日，昨日一律丢弃）
  const start = fromDateKey(dateKey);
  start.setHours(0, 0, 0, 0);
  return {
    startMs: start.getTime(),
    endMs: cappedEndMs,
    requireDate: dateKey !== todayKey(),
  };
}

/** 条目是否在时段内：无 pubDate 时仅在不要求日期证据时放行 */
function isInWindow(
  item: NewsItem,
  startMs: number,
  endMs: number,
  requireDate: boolean,
): boolean {
  if (item.publishedAt === undefined || item.publishedAt === "") {
    return !requireDate;
  }
  const ms = Date.parse(item.publishedAt);
  if (Number.isNaN(ms)) return !requireDate;
  return ms >= startMs && ms <= endMs;
}

/** 单条素材的去重键：URL 优先，其次规范化标题 */
function itemKey(item: NewsItem): string {
  if (item.url.trim() !== "") return `u:${item.url.toLowerCase()}`;
  return `t:${item.title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 40)}`;
}

/** 汇总归档里所有已消费条目的去重键 */
function collectConsumedKeys(batches: InsightsFile["rawArchive"][string] | undefined): Set<string> {
  const keys = new Set<string>();
  if (batches === undefined) return keys;
  for (const batch of batches) {
    for (const item of batch.items) keys.add(itemKey(item));
  }
  return keys;
}

/** 滚动清理：按日期升序只留最近 INSIGHT_REPORT_KEEP_DAYS 份 */
function pruneChannelReports(byDate: Record<string, InsightReport>): Record<string, InsightReport> {
  const dates = Object.keys(byDate).sort();
  if (dates.length <= INSIGHT_REPORT_KEEP_DAYS) return byDate;
  const keep = new Set(dates.slice(-INSIGHT_REPORT_KEEP_DAYS));
  const next: Record<string, InsightReport> = {};
  for (const date of dates) {
    if (keep.has(date)) next[date] = byDate[date];
  }
  return next;
}

/** RSS / Atom：用 DOMParser 解析，摘要去 HTML 标签并截断 */
async function fetchRssItems(name: string, feedUrl: string, take: number): Promise<NewsItem[]> {
  const xml = await fetchPublicText(feedUrl, INSIGHT_SOURCE_TIMEOUT_MS);
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror") !== null) throw new Error("RSS 解析失败");

  // RSS 的 item 与 Atom 的 entry 都支持
  const nodes = [...doc.querySelectorAll("item"), ...doc.querySelectorAll("entry")];
  const items: NewsItem[] = [];
  for (const node of nodes.slice(0, take)) {
    const title = textOf(node, "title");
    if (title === "") continue;
    const link = linkOf(node);
    if (link === "") continue;
    const summary = stripHtml(textOf(node, "description") || textOf(node, "summary"));
    const publishedAt =
      textOf(node, "pubDate") || textOf(node, "published") || textOf(node, "updated");
    items.push({
      source: name,
      title,
      url: link,
      summary: summary === "" ? "" : summary.slice(0, 300),
      ...(publishedAt === "" ? {} : { publishedAt }),
    });
  }
  if (items.length === 0) throw new Error("RSS 无有效条目");
  return items;
}

/** 取节点下第一个同名子元素的文本（去首尾空白） */
function textOf(node: Element, tag: string): string {
  return node.querySelector(tag)?.textContent?.trim() ?? "";
}

/** 取条目链接：优先 <link> 文本，其次 <link href="">（Atom） */
function linkOf(node: Element): string {
  const linkEl = node.querySelector("link");
  if (linkEl === null) return "";
  const href = linkEl.getAttribute("href");
  if (href !== null && href.trim() !== "") return href.trim();
  return linkEl.textContent?.trim() ?? "";
}

/** 去 HTML 标签并折叠空白 */
function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** 去重：同 URL 或规范化标题相同视为同一事件，保留先抓到的 */
function dedupeItems(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const result: NewsItem[] = [];
  for (const item of items) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 存储结构校验与归一化
// ---------------------------------------------------------------------------

function isInsightsFile(value: unknown): value is InsightsFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<InsightsFile>;
  if (typeof candidate.version !== "number") return false;
  if (typeof candidate.reports !== "object" || candidate.reports === null) return false;
  return true;
}

/** 加载归一化：存量报告补 loadHistory（等价于一条「首次生成」记录）；rawArchive 缺省补空 */
function normalizeInsightsFile(file: InsightsFile): InsightsFile {
  const reports: InsightsFile["reports"] = {};
  for (const [channelId, byDate] of Object.entries(file.reports)) {
    const next: Record<string, InsightReport> = {};
    for (const [date, report] of Object.entries(byDate)) {
      if (typeof report?.content !== "string" || typeof report.generatedAt !== "string") continue;
      next[date] = {
        ...report,
        channelId: report.channelId ?? channelId,
        date: report.date ?? date,
        model: typeof report.model === "string" ? report.model : "",
        sourceCount: typeof report.sourceCount === "number" ? report.sourceCount : 0,
        loadHistory:
          Array.isArray(report.loadHistory) && report.loadHistory.length > 0
            ? report.loadHistory
            : [{ at: report.generatedAt, itemCount: report.sourceCount ?? 0 }],
      };
    }
    reports[channelId] = next;
  }
  const rawArchive: InsightsFile["rawArchive"] = {};
  for (const [channelId, batches] of Object.entries(file.rawArchive ?? {})) {
    if (!Array.isArray(batches)) continue;
    rawArchive[channelId] = batches.filter(
      (b) => typeof b?.fetchedAt === "string" && Array.isArray(b.items),
    );
  }
  return { ...file, reports, rawArchive };
}
