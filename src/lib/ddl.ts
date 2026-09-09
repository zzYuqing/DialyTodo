// 职责：DDL 任务语义的单一真相源（方向 B）。
// 起止同日的 once 任务不算长期 DDL（不染红、不显示「已过期」）。
// 真正的 DDL（endDate ≠ startDate）「已过期」仅在其 endDate 当天、且未完成时成立；
// 超过 endDate 的任务由 occursOn / isWithinRange 过滤，不会出现在日清单，故无需在此处理。
//
// 纯函数，不碰 IO、不依赖 @tauri-apps/*、react、zustand。
// 直接 import @/lib/date 取 daysBetweenKeys，避免经 @/lib 索引造成循环依赖。

import type { Schedule, Task } from "@/types";
import { daysBetweenKeys } from "@/lib/date";

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

/** 已过期判定：长期 DDL 任务在结束日当天且尚未完成 */
export function isOverdueDdl(task: Task, dateKey: string): boolean {
  return (
    isLongDdlTask(task.schedule) &&
    dateKey === task.schedule.endDate &&
    task.completedAt == null
  );
}

/** 活跃 DDL：长期 DDL 且未完成、未归档（用于日清单置顶） */
export function isActiveDdlTask(task: Task): boolean {
  return isLongDdlTask(task.schedule) && task.completedAt == null && !task.archived;
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
  const diff = daysBetweenKeys(dateKey, endDate);
  if (diff < 0) return null;
  if (diff === 0) return "today";
  if (diff <= 2) return "imminent";
  if (diff <= 4) return "soon";
  return "far";
}
