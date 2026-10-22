// 职责：DDL 任务语义的单一真相源（方向 B）。
// 起止同日的 once 任务不算长期 DDL（不染红、不显示「已过期」）。
// 注：endDate === null 的 once 任务同属长期任务（未指定截止日，见 isLongTermOnce），
//     但没有截止日可算，因此不参与任何 DDL 专属表现（紧迫度染色 / 已过期徽章）。
// 真正的 DDL（endDate ≠ startDate）「已过期」仅在「过去日期」视图、其 endDate 当天且未完成时成立；
// 今天或未来的截止日当天一律不算过期（显示「剩 0 天」而非「已过期」），因为还未真正越过截止点。
// 超过 endDate 的任务由 occursOn / isWithinRange 过滤，不会出现在日清单，故无需在此处理。
//
// 纯函数，不碰 IO、不依赖 @tauri-apps/*、react、zustand。
// 直接 import @/lib/date 取 daysBetweenKeys，避免经 @/lib 索引造成循环依赖。

import type { Schedule, Task } from "@/types";
import { daysBetweenKeys, todayKey } from "@/lib/date";

/** DDL 行展示的紧迫度档位（基于 dateKey 与 schedule.endDate 的差值） */
export type DdlUrgency = "overdue" | "today" | "imminent" | "soon" | "far" | null;

/** 长期 DDL 任务判定：周期一次且仅一次、指定结束日、且结束日 ≠ 起始日 */
export function isLongDdlTask(schedule: Schedule): boolean {
  return (
    schedule.type === "once" &&
    schedule.endDate != null &&
    schedule.endDate !== schedule.startDate
  );
}

/**
 * 跨天的一次性长期任务判定：type === "once" 且结束日 ≠ 起始日。
 * 覆盖两种情况：
 * - endDate === null（未指定截止日）：从起始日起每天出现，靠 completedAt 关闭；
 * - endDate !== null 且 ≠ 起始日：有界长期任务（即 isLongDdlTask）。
 * 起止同日的 once 任务仍是「单日任务」，不算长期。
 *
 * 与 isLongDdlTask 的分工：本函数用于「是否需要记录永久完成（completedAt）」
 * 与「长期任务预览页收录范围」；isLongDdlTask 用于需要 endDate 才能计算的
 * DDL 专属表现（紧迫度染色、已过期徽章）。
 */
export function isLongTermOnce(schedule: Schedule): boolean {
  return schedule.type === "once" && schedule.endDate !== schedule.startDate;
}

/**
 * 已过期判定：长期 DDL 任务在「过去日期」视图下、其 endDate 当天且尚未完成。
 * 锚定真实今天（todayKey）：今天或未来的截止日当天不算过期——那时只是「剩 0 天」，
 * 真正越过截止点（endDate 已落入过去）且仍在该过去视图中，才显示「已过期」。
 */
export function isOverdueDdl(task: Task, dateKey: string): boolean {
  if (!isLongDdlTask(task.schedule)) return false;
  const endDate = task.schedule.endDate;
  if (endDate == null) return false;
  return dateKey === endDate && dateKey < todayKey() && task.completedAt == null;
}

/** 活跃 DDL：长期 DDL 且未完成、未删除（用于日清单置顶） */
export function isActiveDdlTask(task: Task): boolean {
  return isLongDdlTask(task.schedule) && task.completedAt == null && !task.archived;
}

/**
 * 按「有效截止日」计算紧迫度档位（不关心任务本身是不是 DDL、也不要求传入 Task）。
 * 用途：任务集（复合任务）的行底色由父自身与子任务共同收敛出的截止日决定，
 * 拿不到单一 Task 实体，故单独开放这一层；普通任务仍走 ddlUrgencyFor。
 * 档位规则与单任务完全一致：0=today、1-2=imminent、3-4=soon、>=5=far；
 * 截止日已落在 dateKey 之前（diff < 0）返回 null —— 倒计时结束，改由「逾期」表达。
 */
export function urgencyOfEndDate(endDate: string, dateKey: string): DdlUrgency {
  const diff = daysBetweenKeys(dateKey, endDate);
  if (diff < 0) return null;
  if (diff === 0) return "today";
  if (diff <= 2) return "imminent";
  if (diff <= 4) return "soon";
  return "far";
}

/**
 * 计算当前日期键在 DDL 任务上的紧迫度档位：
 * - 非长期 DDL 任务 → null
 * - 已过期（endDate 当天且未完成） → "overdue"
 * - 其余按距 endDate 天数递进：0=today、1-2=imminent、3-4=soon、>=5=far
 */
export function ddlUrgencyFor(task: Task, dateKey: string): DdlUrgency {
  if (!isLongDdlTask(task.schedule)) return null;
  if (isOverdueDdl(task, dateKey)) return "overdue";
  const endDate = task.schedule.endDate;
  if (endDate == null) return null;
  return urgencyOfEndDate(endDate, dateKey);
}

/** 长期任务在「长期任务预览」页中的归类 */
export type LongTermBucket = "pending" | "overdue" | "done";

/**
 * 长期任务在预览页的归类（整体视角，非单日）：
 * - done：已永久完成（completedAt != null）；
 * - overdue：截止日已过去且未完成（today > endDate）；
 * - pending：尚未完成且未过截止日。
 * 与日清单的 isOverdueDdl（仅在 endDate 当天标记「已过期」）口径不同。
 * 调用方需先过滤掉已删除任务。
 */
export function longTermBucket(task: Task, today: string): LongTermBucket {
  if (task.completedAt != null) return "done";
  const endDate = task.schedule.endDate;
  if (endDate != null && today > endDate) return "overdue";
  return "pending";
}

/**
 * 按结束日升序（近的在前），用于待完成 / 已逾期分组。
 * 无截止日（endDate 为 null）的任务没有紧迫性，统一排在最后。
 */
export function sortByEndDateAsc(a: Task, b: Task): number {
  const ea = a.schedule.endDate;
  const eb = b.schedule.endDate;
  if (ea === eb) return 0;
  if (ea === null) return 1;
  if (eb === null) return -1;
  return ea.localeCompare(eb);
}

/** 按永久完成日降序（新的在前），用于已完成分组 */
export function sortByCompletedAtDesc(a: Task, b: Task): number {
  return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
}
