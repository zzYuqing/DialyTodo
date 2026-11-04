// 职责：AI 报告的纯函数层 —— 自然周切分、区间完成素材收集与提示词组装。
//
// 完成口径（与贡献墙 completion.ts 对齐，避免周报数字与左栏色阶对不上）：
// - 顶层任务的完成看 instances[dateKey].done；
// - 任务集父任务的「派生完成」不计（它是子任务完成的汇总，计入会双重计数）；
// - 子任务的完成看 childDoneAt。
//
// 时区说明（有意与 completion.ts 不同）：childDoneAt 是 UTC ISO 串，
// completion.ts 的贡献墙用 slice(0,10) 直接切 UTC 日期；周报回答的是
// 「我实际在哪天完成的」，必须用 toDateKey(new Date(at)) 转本地日期键，
// 否则北京时间早上八点前完成的子任务会被记到前一天。该差异已知，
// 是否统一贡献墙口径由用户另行拍板，本文件不替它做决定。
//
// 本文件为纯函数，不得 import 任何 Tauri / React / zustand 依赖。

import type { DoneItem, ReportMaterial, Task, WeeklyReport } from "@/types";
import {
  DEFAULT_REPORT_TEMPLATE,
  REPORT_GUARDRAILS,
  REPORT_ROLE_PROMPT,
  REPORT_TEMPLATE_PREAMBLE,
} from "@/constants";
import {
  addDaysToKey,
  daysBetweenKeys,
  formatShortMonthDay,
  toDateKey,
  weekdayIndexOf,
} from "./date";
import { isComposite, isRootTask } from "./composite";

/** dateKey 所在自然周的周一（周一起始，与贡献墙星期列一致） */
export function weekStartOf(dateKey: string): string {
  return addDaysToKey(dateKey, -weekdayIndexOf(dateKey));
}

/** 周一日期所在自然周的周日 */
export function weekEndOf(weekStart: string): string {
  return addDaysToKey(weekStart, 6);
}

/**
 * [from, to] 区间内各自然周的周一列表（升序）。
 * from 向前对齐到所在周的周一；to 落在哪周就收哪周（允许不完整周）。
 */
export function weekStartsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = weekStartOf(from);
  while (cursor <= to) {
    out.push(cursor);
    cursor = addDaysToKey(cursor, 7);
  }
  return out;
}

/** 自定义区间的报告 key（与自然周的周一日期键空间隔离，永不冲突） */
export function customReportKey(start: string, end: string): string {
  return `custom:${start}_${end}`;
}

/**
 * 判断 [start, end] 是否恰好是一个自然周：
 * - start 必须是周一（weekStartOf(start) === start）；
 * - end 等于该周周日，或（进行中的本周）等于今天（截到今日）。
 * 用途：把「日期框选出的整周」与「周翻页器选中的同一周」归一到同一个报告 key，
 * 避免同一周被存成两份（一份自然周、一份自定义）。
 */
export function isNaturalWeekRange(start: string, end: string, today: string): boolean {
  if (start > today) return false;
  if (weekStartOf(start) !== start) return false;
  const weekEnd = weekEndOf(start);
  return end === weekEnd || end === today;
}

/**
 * 区间 → 报告 key：整周归自然周 key（周一日期），其余归 custom 键。
 * 合并「生成周报」与「自定义范围」两个入口后，报告归属统一由本函数判定。
 */
export function resolveReportKey(start: string, end: string, today: string): string {
  return isNaturalWeekRange(start, end, today) ? start : customReportKey(start, end);
}

/**
 * 生成入口的默认目标周：在 [today 往前 52 周] 内，取「最近一个未生成且确有完成记录」的周一。
 * 本周（进行中）若已有完成记录则优先选本周（可生成「本周至今」）；都没有则回退到上周。
 * 用途：左栏只列已生成周之后，给「＋ 生成周报」按钮一个合理的默认落点。
 */
export function defaultGenerateWeek(
  tasks: Task[],
  reports: Record<string, WeeklyReport>,
  today: string,
): string {
  const thisWeek = weekStartOf(today);
  for (let i = 0; i < 52; i++) {
    const ws = addDaysToKey(thisWeek, -7 * i);
    if (reports[ws] !== undefined) continue;
    const end = weekEndOf(ws);
    const effectiveEnd = end > today ? today : end;
    if (collectDoneItems(tasks, ws, effectiveEnd).totalDone > 0) return ws;
  }
  return addDaysToKey(thisWeek, -7);
}

/**
 * 收集 [start, end] 区间内的全部完成事项并聚合成素材。
 * 思路：顶层任务遍历 instances 按日取 done；子任务按 childDoneAt（本地日期）取；
 * 任务集父与已归档任务跳过。同一任务多次完成聚合成一条 DoneItem（周报按「事项 × 次数」表达）。
 */
export function collectDoneItems(
  tasks: Task[],
  start: string,
  end: string,
): ReportMaterial {
  const items = new Map<string, DoneItem>();
  const byDay: Record<string, number> = {};
  // 父任务 id -> 标题，只建一次供子任务标注归属
  const titleOf = new Map<string, string>();
  for (const task of tasks) {
    if (isComposite(task)) titleOf.set(task.id, task.title);
  }

  const inRange = (key: string) => key >= start && key <= end;
  const record = (
    taskId: string,
    title: string,
    parentTitle: string | null,
    note: string,
    day: string,
  ) => {
    const existing = items.get(taskId);
    if (existing !== undefined) {
      if (!existing.dates.includes(day)) {
        existing.dates.push(day);
        existing.dates.sort();
        existing.times = existing.dates.length;
      }
    } else {
      items.set(taskId, { taskId, title, parentTitle, dates: [day], times: 1, note });
    }
    byDay[day] = (byDay[day] ?? 0) + 1;
  };

  for (const task of tasks) {
    if (task.archived || isComposite(task)) continue;
    if (isRootTask(task)) {
      for (const [dateKey, inst] of Object.entries(task.instances)) {
        if (inst.done && inRange(dateKey)) {
          record(task.id, task.title, null, task.note, dateKey);
        }
      }
    } else {
      const at = task.childDoneAt;
      if (at == null) continue;
      const day = toDateKey(new Date(at));
      if (inRange(day)) {
        const parentTitle = task.parentId != null ? (titleOf.get(task.parentId) ?? null) : null;
        record(task.id, task.title, parentTitle, task.note, day);
      }
    }
  }

  // 排序：完成次数多的在前，同次数按首次完成日升序（周报「关键进展」的天然顺序）
  const sorted = [...items.values()].sort((a, b) =>
    a.times !== b.times ? b.times - a.times : a.dates[0] < b.dates[0] ? -1 : 1,
  );
  const totalDone = sorted.reduce((sum, item) => sum + item.times, 0);

  return {
    start,
    end,
    totalDone,
    itemCount: sorted.length,
    activeDays: Object.keys(byDay).length,
    items: sorted,
    byDay,
  };
}

/** 单条备注喂给模型的最大长度：备注是补充语境，不是正文，超长截断防撑爆上下文 */
const MAX_NOTE_CHARS = 200;

/**
 * 组装周报生成的两条消息。
 * system = 角色 + 真实性硬约束 + 模板（自定义模板整体替换内置模板，硬约束不受影响）；
 * user = 区间统计 + 事项清单（次数多的在前，任务集子项标注归属，带任务备注）。
 */
export function buildReportMessages(
  material: ReportMaterial,
  template: string,
): { system: string; user: string } {
  const effective = template.trim() === "" ? DEFAULT_REPORT_TEMPLATE : template;
  const lines = material.items.map((item) => {
    const owner = item.parentTitle === null ? "" : `（任务集「${item.parentTitle}」的子项）`;
    const dates = item.dates.map(formatShortMonthDay).join("、");
    const rawNote = item.note.trim();
    const note =
      rawNote === ""
        ? ""
        : `｜备注：${rawNote.length > MAX_NOTE_CHARS ? `${rawNote.slice(0, MAX_NOTE_CHARS)}…` : rawNote}`;
    return `- ${item.title}${owner}｜完成 ${item.times} 次（${dates}）${note}`;
  });

  const user = [
    `【区间】${material.start} 至 ${material.end}（共 ${daysBetweenKeys(material.start, material.end) + 1} 天，有完成记录 ${material.activeDays} 天，完成 ${material.totalDone} 项，去重后 ${material.itemCount} 个事项）`,
    "",
    "【已完成事项】（完成次数多的在前）",
    ...(lines.length > 0 ? lines : ["（该区间没有完成记录）"]),
  ].join("\n");

  const system = [
    REPORT_ROLE_PROMPT,
    REPORT_GUARDRAILS,
    // 结构指令句系统统一拼接（模板内容保持纯净，用户模板无需自带这句）
    REPORT_TEMPLATE_PREAMBLE,
    effective,
  ].join("\n\n");
  return { system, user };
}
