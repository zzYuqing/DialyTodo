// 职责：行业资讯的行业清单、AI 初审与信源推荐、行业及日报快照恢复。
// AI 推荐的信源必须经真实 RSS 抓取验证；删除时行业与报告一起进入回收站。

import { join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import {
  AUTOMOTIVE_FALLBACK_SOURCES,
  INDUSTRIES_FILE,
  INDUSTRY_MERGE_SYSTEM_PROMPT,
  INDUSTRY_RELATION_SYSTEM_PROMPT,
  INDUSTRY_REPORT_MERGE_SYSTEM_PROMPT,
  INDUSTRY_REVIEW_IDLE_TIMEOUT_MS,
  INDUSTRY_REVIEW_SYSTEM_PROMPT,
  INDUSTRY_REVIEW_TIMEOUT_MS,
  INDUSTRY_SOURCE_REVIEW_SYSTEM_PROMPT,
  INSIGHT_RAW_ARCHIVE_KEEP,
  industryChannelId,
} from "@/constants";
import type {
  AiProviderConfig,
  IndustriesFile,
  IndustryAddResult,
  IndustryProfile,
  IndustryRelationSelection,
  IndustryRelationSuggestion,
  IndustryReview,
  IndustrySource,
  InsightReport,
  InsightsFile,
  RawBatch,
  TrashIndustryPayload,
} from "@/types";
import { streamChatCompletion } from "./aiService";
import { atomicWrite } from "./atomicWrite";
import { fetchRssItems, loadInsights, saveInsights } from "./insightService";
import { dataRoot } from "./paths";

let fileCache: IndustriesFile | null = null;
let automotiveRepairAttempted = false;
const industriesListeners = new Set<() => void>();

/** 订阅行业清单变化（后台补源、换源等保存后通知）；返回取消订阅函数 */
export function subscribeIndustries(listener: () => void): () => void {
  industriesListeners.add(listener);
  return () => industriesListeners.delete(listener);
}

function notifyIndustriesChanged(): void {
  for (const listener of industriesListeners) listener();
}

/** 读取全部已添加行业；文件缺失或损坏时按空清单处理 */
export async function listIndustries(): Promise<IndustryProfile[]> {
  const file = await loadIndustries();
  // 存量汽车相关行业若只有泛科技源，后台一次性补验内置汽车垂直兜底源
  if (!automotiveRepairAttempted) {
    automotiveRepairAttempted = true;
    if (file.industries.length > 0) {
      void repairAutomotiveSources().catch(() => undefined);
    }
  }
  return file.industries;
}

/** AI 初审并推荐信源，再逐个真实抓取验证；整个过程不写文件 */
export async function reviewIndustry(
  input: string,
  config: AiProviderConfig,
  onProgress?: (line: string) => void,
  onReasoning?: (accumulated: string) => void,
): Promise<IndustryReview> {
  const name = input.trim();
  if (name === "") throw new Error("请先输入你关心的行业");
  if (name.length > 40) throw new Error("行业名称请控制在 40 个字以内");

  onProgress?.("AI 正在初审行业并推荐相关信源…");
  const content = await streamChatCompletion(
    config,
    [
      { role: "system", content: INDUSTRY_REVIEW_SYSTEM_PROMPT },
      { role: "user", content: `请初审这个行业输入并推荐 RSS / Atom 信源：${name}` },
    ],
    { onContent: () => undefined, onReasoning },
    INDUSTRY_REVIEW_TIMEOUT_MS,
    INDUSTRY_REVIEW_IDLE_TIMEOUT_MS,
  );
  const review = parseIndustryReview(content, name);
  if (!review.approved) return review;

  let sources: IndustrySource[] = [];
  if (review.sources.length > 0) {
    onProgress?.(`正在验证 ${review.sources.length} 个候选信源…`);
    sources = await validateIndustrySources(review.sources);
  }
  if (sources.length === 0) {
    const fallback = automotiveFallbackFor(review.name, review.aliases);
    if (fallback.length > 0) {
      onProgress?.("AI 信源不可用，正在验证内置汽车行业信源…");
      sources = await validateIndustrySources(fallback);
    }
  }
  if (sources.length === 0) {
    throw new Error("AI 推荐及可用兜底信源均未通过实际抓取验证，请检查网络后重试");
  }
  sources = await ensureAutomotiveSources(review.name, review.aliases, sources, onProgress);
  onProgress?.(`已通过 ${sources.length} 个行业信源`);
  return { ...review, sources };
}

/**
 * 为已有行业重新推荐并验证信源，整体替换后落盘。
 * 行业名称、别称、并入主题与历史日报均不动；失败时不修改任何数据。
 */
export async function refreshIndustrySources(
  industryId: string,
  config: AiProviderConfig,
  onProgress?: (line: string) => void,
  onReasoning?: (accumulated: string) => void,
): Promise<IndustryProfile> {
  const file = await loadIndustries();
  const industry = file.industries.find((item) => item.id === industryId);
  if (industry === undefined) throw new Error("该行业已不存在");

  onProgress?.(`AI 正在为「${industry.name}」重新推荐信源…`);
  const scopeText = [
    `行业：${industry.name}`,
    `别称：${industry.aliases.join("、") || "无"}`,
    `已并入主题：${industry.includedTopics.join("、") || "无"}`,
  ].join("；");
  const content = await streamChatCompletion(
    config,
    [
      { role: "system", content: INDUSTRY_SOURCE_REVIEW_SYSTEM_PROMPT },
      { role: "user", content: `${scopeText}。请只输出信源 JSON。` },
    ],
    { onContent: () => undefined, onReasoning },
    INDUSTRY_REVIEW_TIMEOUT_MS,
    INDUSTRY_REVIEW_IDLE_TIMEOUT_MS,
  );
  let sources = await validateIndustrySources(parseSourceReview(content));
  if (sources.length === 0) {
    const fallback = automotiveFallbackFor(industry.name, industry.aliases);
    if (fallback.length > 0) {
      onProgress?.("AI 信源不可用，正在验证内置汽车行业信源…");
      sources = await validateIndustrySources(fallback);
    }
  }
  if (sources.length === 0) {
    throw new Error("重新推荐的信源均未通过实际抓取验证，未修改任何信源，请稍后重试");
  }
  const next: IndustryProfile = { ...industry, sources };
  await saveIndustries({
    version: 1,
    industries: file.industries.map((item) => (item.id === industryId ? next : item)),
  });
  notifyIndustriesChanged();
  onProgress?.(`已用 ${sources.map((source) => source.name).join("、")} 替换旧信源`);
  return next;
}

/** 仅生成主行业的上下游候选；不验证未选条目，也绝不递归查询新行业 */
export async function recommendIndustryRelations(
  primary: IndustryReview,
  config: AiProviderConfig,
  onProgress?: (line: string) => void,
  onReasoning?: (accumulated: string) => void,
): Promise<IndustryRelationSuggestion[]> {
  if (!primary.approved) throw new Error("主行业尚未通过初审");
  onProgress?.(`AI 正在梳理「${primary.name}」的上下游…`);
  const content = await streamChatCompletion(
    config,
    [
      { role: "system", content: INDUSTRY_RELATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `主行业信息：${JSON.stringify({ name: primary.name, aliases: primary.aliases })}\n请列出上游与下游候选，不要继续展开这些候选的上下游。`,
      },
    ],
    { onContent: () => undefined, onReasoning },
    INDUSTRY_REVIEW_TIMEOUT_MS,
    INDUSTRY_REVIEW_IDLE_TIMEOUT_MS,
  );
  const relations = parseIndustryRelations(content, primary);
  onProgress?.(`AI 给出了 ${relations.length} 个上下游候选，请选择需要关注的条目`);
  return relations;
}

/** 一次性保存主行业、并入主题与单独行业；只有用户勾选的上下游信源会被验证 */
export async function addIndustryBundle(
  review: IndustryReview,
  selections: IndustryRelationSelection[],
  onProgress?: (line: string) => void,
): Promise<IndustryAddResult> {
  if (!review.approved) throw new Error(review.reason || "该输入未通过 AI 初审");
  if (review.sources.length === 0) throw new Error("主行业没有可用信源，不能添加");

  const file = await loadIndustries();
  const usedNames = new Set(file.industries.map((item) => normalizeName(item.name)));
  if (usedNames.has(normalizeName(review.name))) {
    throw new Error(`「${review.name}」已经添加过了`);
  }
  usedNames.add(normalizeName(review.name));
  for (const selection of selections) {
    if (selection.mode !== "separate") continue;
    const normalized = normalizeName(selection.suggestion.name);
    if (usedNames.has(normalized)) {
      throw new Error(`「${selection.suggestion.name}」已经添加或与本次其他行业重名，请取消该项或改为并入`);
    }
    usedNames.add(normalized);
  }

  let checkedSelections = selections;
  if (selections.length > 0) {
    onProgress?.(`正在验证 ${selections.length} 个已选上下游条目的信源…`);
    checkedSelections = await Promise.all(
      selections.map(async (selection) => {
        const { suggestion } = selection;
        let sources = await validateIndustrySources(suggestion.sources);
        if (sources.length === 0) {
          sources = await validateIndustrySources(
            automotiveFallbackFor(suggestion.name, suggestion.aliases),
          );
        }
        if (sources.length === 0) {
          throw new Error(`「${suggestion.name}」的推荐及兜底信源均未通过实际抓取验证，请取消勾选或改选其他条目`);
        }
        sources = await ensureAutomotiveSources(suggestion.name, suggestion.aliases, sources);
        return { ...selection, suggestion: { ...suggestion, sources } };
      }),
    );
  }

  const merged = checkedSelections.filter((selection) => selection.mode === "merge");
  const separate = checkedSelections.filter((selection) => selection.mode === "separate");
  const createdAt = new Date().toISOString();
  const primary: IndustryProfile = {
    id: crypto.randomUUID(),
    name: review.name.trim(),
    aliases: uniqueNames([
      ...review.aliases,
      ...merged.flatMap((selection) => [
        selection.suggestion.name,
        ...selection.suggestion.aliases,
      ]),
    ]),
    includedTopics: uniqueNames(merged.map((selection) => selection.suggestion.name)),
    sources: dedupeIndustrySources([
      ...review.sources,
      ...merged.flatMap((selection) => selection.suggestion.sources),
    ]),
    reviewNote: review.reason,
    createdAt,
  };
  const separateIndustries: IndustryProfile[] = separate.map((selection) => ({
    id: crypto.randomUUID(),
    name: selection.suggestion.name,
    aliases: selection.suggestion.aliases,
    includedTopics: [],
    sources: selection.suggestion.sources,
    reviewNote: `由「${review.name}」的上下游建议添加：${selection.suggestion.reason}`,
    createdAt,
  }));

  await saveIndustries({
    version: 1,
    industries: [...file.industries, primary, ...separateIndustries],
  });
  onProgress?.("行业与信源已保存");
  return { primary, separateIndustries };
}

/** 不添加上下游时沿用单行业入口 */
export async function addIndustry(review: IndustryReview): Promise<IndustryProfile> {
  const result = await addIndustryBundle(review, []);
  return result.primary;
}

export interface IndustryMergeResult {
  industry: IndustryProfile;
  removed: TrashIndustryPayload[];
}

/**
 * AI 整理多个已有行业的名称、范围与已有信源，验证后创建新行业。
 * 原行业及各自日报作为独立快照返回给回收站；新行业不拼接历史报告正文。
 */
export async function mergeIndustriesWithReports(
  industryIds: string[],
  config: AiProviderConfig,
  onProgress?: (line: string) => void,
  onReasoning?: (accumulated: string) => void,
): Promise<IndustryMergeResult> {
  const ids = new Set(industryIds);
  const file = await loadIndustries();
  const selected = file.industries.filter((item) => ids.has(item.id));
  if (ids.size < 2 || selected.length !== ids.size) {
    throw new Error("请至少选择两个仍然存在的行业进行合并");
  }

  onProgress?.("AI 正在整理合并后的行业范围与信源…");
  const content = await streamChatCompletion(
    config,
    [
      { role: "system", content: INDUSTRY_MERGE_SYSTEM_PROMPT },
      { role: "user", content: `请合并以下已有行业：${JSON.stringify(selected)}` },
    ],
    { onContent: () => undefined, onReasoning },
    INDUSTRY_REVIEW_TIMEOUT_MS,
    INDUSTRY_REVIEW_IDLE_TIMEOUT_MS,
  );
  const plan = parseIndustryMerge(content, selected);
  if (
    file.industries.some(
      (item) => !ids.has(item.id) && normalizeName(item.name) === normalizeName(plan.name),
    )
  ) {
    throw new Error(`合并后的名称「${plan.name}」与未选中的行业重名，请重试`);
  }

  onProgress?.(`正在重新验证合并后的 ${plan.sources.length} 个信源…`);
  const sources = await validateIndustrySources(plan.sources);
  if (sources.length === 0) {
    throw new Error("合并信源均未通过实际抓取验证，未修改任何行业，请检查网络后重试");
  }

  const industry: IndustryProfile = {
    id: crypto.randomUUID(),
    name: plan.name,
    aliases: uniqueNames([...plan.aliases, ...selected.flatMap((item) => item.aliases)])
      .filter((name) => normalizeName(name) !== normalizeName(plan.name))
      .slice(0, 20),
    includedTopics: uniqueNames([
      ...selected.map((item) => item.name),
      ...selected.flatMap((item) => item.includedTopics),
      ...plan.includedTopics,
    ]).filter((name) => normalizeName(name) !== normalizeName(plan.name)),
    sources,
    reviewNote: plan.reason,
    createdAt: new Date().toISOString(),
  };

  const insights = await loadInsights();
  const removed = selected.map((item) => {
    const channelId = industryChannelId(item.id);
    return {
      industry: item,
      reports: insights.reports[channelId] ?? {},
      rawArchive: insights.rawArchive[channelId] ?? [],
    };
  });
  // 所有历史日报先在内存中整合成功，再统一落盘；任一日期失败都不影响现有数据
  const history = await mergeHistoricalReports(
    selected,
    insights,
    industry,
    config,
    onProgress,
    onReasoning,
  );

  await saveIndustries({
    version: 1,
    industries: [...file.industries.filter((item) => !ids.has(item.id)), industry],
  });
  const nextInsights = {
    ...insights,
    reports: { ...insights.reports },
    rawArchive: { ...insights.rawArchive },
  };
  for (const item of selected) {
    const channelId = industryChannelId(item.id);
    delete nextInsights.reports[channelId];
    delete nextInsights.rawArchive[channelId];
  }
  const mergedChannelId = industryChannelId(industry.id);
  nextInsights.reports[mergedChannelId] = history.reports;
  nextInsights.rawArchive[mergedChannelId] = history.rawArchive;
  await saveInsights(nextInsights);
  onProgress?.(`已创建「${industry.name}」，全部历史日报已迁入，原始快照将保留在回收站`);
  return { industry, removed };
}

/** 全部历史日期迁入新渠道；同日多份依次交给 AI 去重整合，单日单份原样保留 */
async function mergeHistoricalReports(
  selected: IndustryProfile[],
  insights: InsightsFile,
  mergedIndustry: IndustryProfile,
  config: AiProviderConfig,
  onProgress?: (line: string) => void,
  onReasoning?: (accumulated: string) => void,
): Promise<{ reports: Record<string, InsightReport>; rawArchive: RawBatch[] }> {
  const channelId = industryChannelId(mergedIndustry.id);
  const dates = [
    ...new Set(
      selected.flatMap((item) => Object.keys(insights.reports[industryChannelId(item.id)] ?? {})),
    ),
  ].sort();
  const reports: Record<string, InsightReport> = {};

  for (const [index, date] of dates.entries()) {
    const daily = selected.flatMap((item) => {
      const report = insights.reports[industryChannelId(item.id)]?.[date];
      return report === undefined ? [] : [{ industry: item.name, report }];
    });
    if (daily.length === 1) {
      onProgress?.(`正在迁移 ${date} 的历史日报（${index + 1}/${dates.length}）…`);
      reports[date] = { ...daily[0].report, channelId };
      continue;
    }

    onProgress?.(
      `正在整合 ${date} 的 ${daily.length} 份历史日报（${index + 1}/${dates.length}）…`,
    );
    const content = await streamChatCompletion(
      config,
      [
        { role: "system", content: INDUSTRY_REPORT_MERGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `日期：${date}\n合并后行业名：${mergedIndustry.name}\n请整合以下原日报：${JSON.stringify(
            daily.map((item) => ({ industry: item.industry, content: item.report.content })),
          )}`,
        },
      ],
      { onContent: () => undefined, onReasoning },
      INDUSTRY_REVIEW_TIMEOUT_MS,
      INDUSTRY_REVIEW_IDLE_TIMEOUT_MS,
    );
    if (content.trim() === "") throw new Error(`${date} 的历史日报合并结果为空，请重试`);
    reports[date] = {
      channelId,
      date,
      content: content.trim(),
      generatedAt: new Date().toISOString(),
      model: config.model.trim(),
      sourceCount: daily.reduce((sum, item) => sum + item.report.sourceCount, 0),
      loadHistory: daily
        .flatMap((item) => item.report.loadHistory)
        .sort((a, b) => a.at.localeCompare(b.at)),
    };
  }

  const rawArchive = selected
    .flatMap((item) => insights.rawArchive[industryChannelId(item.id)] ?? [])
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))
    .slice(-INSIGHT_RAW_ARCHIVE_KEEP);
  return { reports, rawArchive };
}

/** 删除行业及其全部日报 / 素材归档，返回放进回收站的完整快照 */
export async function removeIndustryWithReports(
  industryId: string,
): Promise<TrashIndustryPayload | null> {
  const file = await loadIndustries();
  const industry = file.industries.find((item) => item.id === industryId);
  if (industry === undefined) return null;

  const insights = await loadInsights();
  const channelId = industryChannelId(industryId);
  const snapshot: TrashIndustryPayload = {
    industry,
    reports: insights.reports[channelId] ?? {},
    rawArchive: insights.rawArchive[channelId] ?? [],
  };

  await saveIndustries({
    version: 1,
    industries: file.industries.filter((item) => item.id !== industryId),
  });
  const nextInsights = {
    ...insights,
    reports: { ...insights.reports },
    rawArchive: { ...insights.rawArchive },
  };
  delete nextInsights.reports[channelId];
  delete nextInsights.rawArchive[channelId];
  await saveInsights(nextInsights);
  return snapshot;
}

/** 从回收站恢复行业及全部日报；同名或同 id 行业已存在时不覆盖，保持回收站条目 */
export async function restoreIndustryWithReports(
  snapshot: TrashIndustryPayload,
): Promise<boolean> {
  const file = await loadIndustries();
  const normalized = normalizeName(snapshot.industry.name);
  if (
    file.industries.some(
      (item) => item.id === snapshot.industry.id || normalizeName(item.name) === normalized,
    )
  ) {
    return false;
  }

  const insights = await loadInsights();
  const industry = normalizeIndustry(snapshot.industry);
  const channelId = industryChannelId(industry.id);
  await saveIndustries({ version: 1, industries: [...file.industries, industry] });
  await saveInsights({
    ...insights,
    reports: { ...insights.reports, [channelId]: snapshot.reports },
    rawArchive: { ...insights.rawArchive, [channelId]: snapshot.rawArchive },
  });
  return true;
}

async function loadIndustries(): Promise<IndustriesFile> {
  if (fileCache !== null) return fileCache;
  try {
    const path = await join(await dataRoot(), INDUSTRIES_FILE);
    if (await exists(path)) {
      const parsed: unknown = JSON.parse(await readTextFile(path));
      if (isIndustriesFile(parsed)) {
        fileCache = { version: 1, industries: parsed.industries.map(normalizeIndustry) };
        return fileCache;
      }
    }
  } catch {
    // 行业清单损坏时不阻塞页面；下次添加会重建有效文件
  }
  fileCache = { version: 1, industries: [] };
  return fileCache;
}

async function saveIndustries(file: IndustriesFile): Promise<void> {
  fileCache = file;
  await atomicWrite(
    await join(await dataRoot(), INDUSTRIES_FILE),
    JSON.stringify(file, null, 2),
  );
}

function isIndustriesFile(value: unknown): value is IndustriesFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<IndustriesFile>;
  return typeof candidate.version === "number" && Array.isArray(candidate.industries);
}

/** 归一化行业字段；旧数据没有 includedTopics 时按未并入主题处理 */
function normalizeIndustry(value: IndustryProfile): IndustryProfile {
  return {
    id: typeof value.id === "string" && value.id !== "" ? value.id : crypto.randomUUID(),
    name: typeof value.name === "string" ? value.name.trim() : "未命名行业",
    aliases: Array.isArray(value.aliases)
      ? uniqueNames(value.aliases.filter((item): item is string => typeof item === "string"))
      : [],
    includedTopics: Array.isArray(value.includedTopics)
      ? uniqueNames(value.includedTopics.filter((item): item is string => typeof item === "string"))
      : [],
    sources: Array.isArray(value.sources)
      ? value.sources
          .filter(
            (item): item is IndustrySource =>
              typeof item?.name === "string" && typeof item.query === "string",
          )
          .map((item) => ({
            name: item.name.trim(),
            query: item.query.trim(),
            take: normalizeTake(item.take),
          }))
      : [],
    reviewNote: typeof value.reviewNote === "string" ? value.reviewNote : "",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
  };
}

/** 仅对明确的汽车相关行业启用兜底，避免把汽车信源塞进无关行业 */
function automotiveFallbackFor(name: string, aliases: string[]): IndustrySource[] {
  const text = [name, ...aliases].join(" ");
  if (!/汽车|车灯|车用|车载|整车|车规|主机厂|主车厂/.test(text)) return [];
  return AUTOMOTIVE_FALLBACK_SOURCES.map((source) => ({ ...source }));
}

/** 已有信源里是否已包含任一内置汽车垂直源 */
function includesAutomotiveFallback(sources: IndustrySource[]): boolean {
  const fallbackUrls = new Set(AUTOMOTIVE_FALLBACK_SOURCES.map((source) => sourceKey(source.query)));
  return sources.some((source) => fallbackUrls.has(sourceKey(source.query)));
}

/**
 * 汽车行业即使 AI 推荐的泛科技源验证通过，也补验内置垂直兜底源并合并，
 * 避免素材被大量无关资讯淹没；非汽车行业原样返回。
 */
async function ensureAutomotiveSources(
  name: string,
  aliases: string[],
  sources: IndustrySource[],
  onProgress?: (line: string) => void,
): Promise<IndustrySource[]> {
  const fallback = automotiveFallbackFor(name, aliases);
  if (fallback.length === 0 || includesAutomotiveFallback(sources)) return sources;
  onProgress?.("正在补充内置汽车行业垂直信源…");
  const extra = await validateIndustrySources(fallback);
  if (extra.length === 0) return sources;
  return dedupeIndustrySources([...sources, ...extra]);
}

/**
 * 存量修复：早期版本可能把泛科技源存进汽车行业（初审提示词未禁止），
 * 这里为缺少汽车垂直源的汽车行业后台补验并合并内置兜底源，每次会话只试一次。
 */
async function repairAutomotiveSources(): Promise<void> {
  const file = await loadIndustries();
  const targetIds = new Set(
    file.industries
      .filter(
        (industry) =>
          automotiveFallbackFor(industry.name, industry.aliases).length > 0 &&
          !includesAutomotiveFallback(industry.sources),
      )
      .map((industry) => industry.id),
  );
  if (targetIds.size === 0) return;
  const validated = await validateIndustrySources(AUTOMOTIVE_FALLBACK_SOURCES);
  if (validated.length === 0) return;
  const fresh = await loadIndustries();
  await saveIndustries({
    version: 1,
    industries: fresh.industries.map((industry) =>
      targetIds.has(industry.id)
        ? { ...industry, sources: dedupeIndustrySources([...industry.sources, ...validated]) }
        : industry,
    ),
  });
  notifyIndustriesChanged();
}

/** 并行实测候选信源；非法 URL、跨域失败、非 RSS 或无有效条目的地址全部丢弃 */
async function validateIndustrySources(sources: IndustrySource[]): Promise<IndustrySource[]> {
  const candidates = dedupeIndustrySources(sources);
  const checked = await Promise.all(
    candidates.map(async (source) => {
      try {
        await fetchRssItems(source.name, source.query, 1);
        return source;
      } catch {
        return null;
      }
    }),
  );
  return checked.filter((source): source is IndustrySource => source !== null);
}

/** 兼容模型偶发返回的 JSON 代码块或前后解释文字 */
function parseIndustryReview(content: string, originalName: string): IndustryReview {
  const candidate = parseAiObject(content, "初审");
  if (typeof candidate.approved !== "boolean") {
    throw new Error("AI 初审未给出明确结论，请重试");
  }
  const name =
    typeof candidate.name === "string" && candidate.name.trim() !== ""
      ? candidate.name.trim()
      : originalName;
  const aliases = Array.isArray(candidate.aliases)
    ? candidate.aliases
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item !== "" && normalizeName(item) !== normalizeName(name))
        .slice(0, 5)
    : [];
  const sources = Array.isArray(candidate.sources)
    ? candidate.sources.map(parseIndustrySource).filter((item): item is IndustrySource => item !== null)
    : [];
  const reason =
    typeof candidate.reason === "string" && candidate.reason.trim() !== ""
      ? candidate.reason.trim()
      : candidate.approved
        ? "行业边界明确，可以生成日报"
        : "请输入更明确的行业名称";
  if (candidate.approved && (name === "" || name.length > 40)) {
    throw new Error("AI 返回的规范行业名无效，请重试");
  }
  return {
    approved: candidate.approved,
    name,
    aliases: uniqueNames(aliases),
    sources: candidate.approved ? sources.slice(0, 6) : [],
    reason,
  };
}

/** 解析换源结果：只取 sources 数组；AI 没给出可识别信源时返回空，由调用方走兜底 */
function parseSourceReview(content: string): IndustrySource[] {
  const candidate = parseAiObject(content, "换源");
  if (!Array.isArray(candidate.sources)) return [];
  return candidate.sources
    .map(parseIndustrySource)
    .filter((source): source is IndustrySource => source !== null)
    .slice(0, 6);
}

/** 解析上下游候选并去重；此处只解析，不发起任何额外行业初审或信源请求 */
function parseIndustryRelations(
  content: string,
  primary: IndustryReview,
): IndustryRelationSuggestion[] {
  const candidate = parseAiObject(content, "上下游推荐");
  if (!Array.isArray(candidate.relations)) {
    throw new Error("AI 上下游推荐结果缺少条目，请重试");
  }

  const relations: IndustryRelationSuggestion[] = [];
  const seen = new Set([primary.name, ...primary.aliases].map(normalizeName));
  for (const value of candidate.relations) {
    if (typeof value !== "object" || value === null) continue;
    const item = value as Record<string, unknown>;
    if (item.direction !== "upstream" && item.direction !== "downstream") continue;
    if (typeof item.name !== "string") continue;
    const name = item.name.trim();
    const normalized = normalizeName(name);
    if (name === "" || name.length > 40 || seen.has(normalized)) continue;
    seen.add(normalized);

    const aliases = Array.isArray(item.aliases)
      ? item.aliases
          .filter((alias): alias is string => typeof alias === "string")
          .map((alias) => alias.trim())
          .filter((alias) => alias !== "" && normalizeName(alias) !== normalized)
          .slice(0, 5)
      : [];
    const sources = Array.isArray(item.sources)
      ? item.sources
          .map(parseIndustrySource)
          .filter((source): source is IndustrySource => source !== null)
          .slice(0, 5)
      : [];
    relations.push({
      name,
      aliases: uniqueNames(aliases),
      direction: item.direction,
      reason:
        typeof item.reason === "string" && item.reason.trim() !== ""
          ? item.reason.trim()
          : item.direction === "upstream"
            ? `「${primary.name}」的上游供应环节`
            : `「${primary.name}」的下游需求环节`,
      sources: dedupeIndustrySources(sources),
    });
    if (relations.length >= 10) break;
  }
  return relations;
}

/** 合并结果只接受已有 URL；AI 没给出可识别信源时，回退为全部已有信源去重 */
function parseIndustryMerge(content: string, selected: IndustryProfile[]) {
  const candidate = parseAiObject(content, "行业合并");
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (name === "" || name.length > 40) throw new Error("AI 返回的合并行业名无效，请重试");

  const available = dedupeIndustrySources(selected.flatMap((item) => item.sources));
  const allowedUrls = new Map(available.map((source) => [sourceKey(source.query), source.query]));
  const picked = Array.isArray(candidate.sources)
    ? candidate.sources
        .map(parseIndustrySource)
        .filter((source): source is IndustrySource => source !== null)
        .filter((source) => allowedUrls.has(sourceKey(source.query)))
        .map((source) => ({ ...source, query: allowedUrls.get(sourceKey(source.query))! }))
    : [];
  const stringList = (value: unknown, limit: number): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item !== "")
          .slice(0, limit)
      : [];

  return {
    name,
    aliases: uniqueNames(stringList(candidate.aliases, 12)),
    includedTopics: uniqueNames(stringList(candidate.includedTopics, 30)),
    sources: picked.length > 0 ? dedupeIndustrySources(picked).slice(0, 12) : available,
    reason:
      typeof candidate.reason === "string" && candidate.reason.trim() !== ""
        ? candidate.reason.trim()
        : `由 ${selected.map((item) => item.name).join("、")} 合并`,
  };
}

function parseAiObject(content: string, operation: string): Record<string, unknown> {
  const fenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`AI ${operation}结果无法识别，请重试`);
  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`AI ${operation}结果不是有效 JSON，请重试`);
  }
}

function parseIndustrySource(value: unknown): IndustrySource | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.url !== "string") return null;
  let url: URL;
  try {
    url = new URL(candidate.url.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return {
    name:
      typeof candidate.name === "string" && candidate.name.trim() !== ""
        ? candidate.name.trim()
        : url.hostname,
    query: url.toString(),
    take: normalizeTake(candidate.take),
  };
}

function sourceKey(url: string): string {
  try {
    return new URL(url.trim()).toString().toLocaleLowerCase();
  } catch {
    return url.trim().toLocaleLowerCase();
  }
}

function dedupeIndustrySources(sources: IndustrySource[]): IndustrySource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = sourceKey(source.query);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of names) {
    const name = value.trim();
    const key = normalizeName(name);
    if (name === "" || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function normalizeTake(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(20, Math.max(6, Math.round(value)))
    : 12;
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, "");
}
