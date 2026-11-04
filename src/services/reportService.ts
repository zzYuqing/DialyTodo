// 职责：AI 报告的生成管线与存储（reports.json）。
// 管线：collectDoneItems（lib/report.ts，唯一事实来源）→ 组装消息 →
//       streamChatCompletion（与洞察AI 同一条网络管道，流式 + 双超时）→ 按 key 落盘。
// 存储：reports.json 以报告 key 平铺；自然周 key = 周一日期，自定义 key = custom:<start>_<end>。
// 覆盖语义：同一 key 重新生成直接替换旧报告（2026-11-03 拍板），不做多版本。
// 真实性命门：素材全部来自本地完成记录，模型只归纳；提示词硬约束禁止编造。

import { join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import {
  REPORTS_FILE,
  REPORTS_VERSION,
  TEMPLATE_REVIEW_IDLE_TIMEOUT_MS,
  TEMPLATE_REVIEW_PROMPT,
  TEMPLATE_REVIEW_TIMEOUT_MS,
  TEMPLATE_TOPIC_PROMPT,
} from "@/constants";
import { buildReportMessages, nowIso, parseAiObject } from "@/lib";
import type {
  AiProviderConfig,
  ReportMaterial,
  ReportsFile,
  TemplateReview,
  WeeklyReport,
} from "@/types";
import { streamChatCompletion, type StreamHandlers } from "./aiService";
import { atomicWrite } from "./atomicWrite";
import { dataRoot } from "./paths";

/** 内存缓存：会话内读一次 reports.json，保存后同步。
 *  禁止调用方原地改返回对象 —— 视图层把它直接存进 React state，
 *  原地改会让 setState 被引用相等 bail out，页面不刷新（2026-11-04 修过的坑）。 */
let fileCache: ReportsFile | null = null;

/** 单条报告的最小结构校验：key / content 必须是字符串，其余字段脏值不影响展示 */
function isWeeklyReport(value: unknown): value is WeeklyReport {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<WeeklyReport>;
  return typeof record.key === "string" && typeof record.content === "string";
}

/** 读 reports.json；缺失 / 损坏按空文件处理（报告可重新生成，丢了不心疼） */
export async function loadReports(): Promise<ReportsFile> {
  if (fileCache !== null) return fileCache;
  try {
    const path = await join(await dataRoot(), REPORTS_FILE);
    if (await exists(path)) {
      const parsed: unknown = JSON.parse(await readTextFile(path));
      if (typeof parsed === "object" && parsed !== null) {
        const raw = (parsed as { reports?: unknown }).reports;
        const reports: Record<string, WeeklyReport> = {};
        if (typeof raw === "object" && raw !== null) {
          for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (isWeeklyReport(value) && value.key === key) reports[key] = value;
          }
        }
        fileCache = { version: REPORTS_VERSION, reports };
        return fileCache;
      }
    }
  } catch {
    // 损坏不阻塞：报告可重新生成
  }
  fileCache = { version: REPORTS_VERSION, reports: {} };
  return fileCache;
}

/** 写 reports.json（原子写），并同步内存缓存 */
async function saveReports(file: ReportsFile): Promise<void> {
  fileCache = file;
  await atomicWrite(await join(await dataRoot(), REPORTS_FILE), JSON.stringify(file, null, 2));
}

/** 全部自定义范围报告，按生成时间倒序（左栏「自定义」分区的数据源） */
export async function listCustomReports(): Promise<WeeklyReport[]> {
  const file = await loadReports();
  return Object.values(file.reports)
    .filter((r) => r.kind === "custom")
    .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
}

/**
 * 生成一份区间报告并落盘（覆盖同 key 旧报告）。
 * template 为空白串时用内置默认模板（与 lib/report.ts 的组装口径一致）；
 * templateId = "default" 或模板库条目 id，原样落库供重新生成时回查模板。
 */
export async function generateWeeklyReport(
  material: ReportMaterial,
  key: string,
  kind: WeeklyReport["kind"],
  config: AiProviderConfig,
  template: string,
  templateId: string,
  handlers: StreamHandlers,
): Promise<WeeklyReport> {
  const { system, user } = buildReportMessages(material, template);
  const content = await streamChatCompletion(
    config,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    handlers,
  );

  const report: WeeklyReport = {
    key,
    kind,
    start: material.start,
    end: material.end,
    content,
    generatedAt: nowIso(),
    model: config.model.trim(),
    doneCount: material.totalDone,
    templateId,
  };
  // 不可变更新：不得原地改缓存对象（file.reports[key] = ... 会让 loadReports 返回
  // 与调用方 state 里同一引用，setState 被 React 引用相等 bail out，列表不刷新）
  const file = await loadReports();
  await saveReports({
    version: file.version,
    reports: { ...file.reports, [key]: report },
  });
  return report;
}

/**
 * 润色 / 识别加工前的主题守门：只判「值不值得交给 AI 加工」。
 * 与保存闸门（reviewTemplate）刻意松紧不同 ——
 * 「给我个程序员周报模板」这类需求委托在这里必须放行（随后由润色按需求生成），
 * 但它不是模板内容，保存入库时仍会被 reviewTemplate 拦下。
 */
export async function checkTemplateTopic(
  content: string,
  config: AiProviderConfig,
  signal?: AbortSignal,
): Promise<{ related: boolean; reason: string }> {
  const text = content.trim();
  if (text === "") return { related: false, reason: "内容为空" };

  const raw = await streamChatCompletion(
    config,
    [
      { role: "system", content: TEMPLATE_TOPIC_PROMPT },
      { role: "user", content: text },
    ],
    { onContent: () => undefined },
    TEMPLATE_REVIEW_TIMEOUT_MS,
    TEMPLATE_REVIEW_IDLE_TIMEOUT_MS,
    signal,
  );
  const candidate = parseAiObject(raw, "主题检查");
  if (typeof candidate.related !== "boolean") {
    throw new Error("AI 主题检查未给出明确结论，请重试");
  }
  return {
    related: candidate.related,
    reason:
      typeof candidate.reason === "string" && candidate.reason.trim() !== ""
        ? candidate.reason.trim()
        : "内容与周报 / 工作总结无关",
  };
}

/**
 * 模板入库前的 AI 初审：判定草稿能不能作为一份报告模板存进模板库。
 * 只判「主题相关 + 形态可用」，不判写得好不好（判定红线见 TEMPLATE_REVIEW_PROMPT）。
 * 注意两类失败必须区分：判定不通过正常返回 approved=false（视图层不允许绕过）；
 * 调用本身失败（未配置 API / 网络）直接抛错，视图层据此给「仍然保存」的降级出口。
 */
export async function reviewTemplate(
  content: string,
  config: AiProviderConfig,
  signal?: AbortSignal,
): Promise<TemplateReview> {
  const text = content.trim();
  // 本地已在按钮层拦住空内容，这里只作兜底，不必走网络
  if (text === "") return { approved: false, kind: "unformatted", reason: "模板内容为空" };

  const raw = await streamChatCompletion(
    config,
    [
      { role: "system", content: TEMPLATE_REVIEW_PROMPT },
      { role: "user", content: text },
    ],
    { onContent: () => undefined },
    TEMPLATE_REVIEW_TIMEOUT_MS,
    TEMPLATE_REVIEW_IDLE_TIMEOUT_MS,
    signal,
  );
  const candidate = parseAiObject(raw, "模板初审");
  if (typeof candidate.approved !== "boolean") {
    throw new Error("AI 初审未给出明确结论，请重试");
  }
  if (candidate.approved) return { approved: true, kind: null, reason: "" };

  return {
    approved: false,
    kind: candidate.kind === "off-topic" ? "off-topic" : "unformatted",
    reason:
      typeof candidate.reason === "string" && candidate.reason.trim() !== ""
        ? candidate.reason.trim()
        : "这份内容没能通过模板初审",
  };
}
