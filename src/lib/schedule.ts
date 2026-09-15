// 职责：周期规则判定 —— 某任务的周期规则在给定日期是否应出现（提示词 5.2）。
// 纯函数，不持状态、不碰 IO。
// 设计要点（沿用上一版 ScheduleRule）：工作日判定由外部回调注入，
// 使本模块与节假日服务解耦 —— 单测时传 () => true 即可覆盖全部周期分支。

import { SCHEDULE_TYPE_LABELS, WEEKDAY_SHORT_LABELS } from "@/constants";
import type { Schedule } from "@/types";
import { weekdayIndexOf } from "./date";

/** 工作日判定回调，由节假日服务提供 */
export type WorkdayChecker = (dateKey: string) => boolean;

/**
 * 周期规则的人类可读文案：weekly 具体到星期（如「每周一、五」），其余类型用常量表。
 * 徽标展示统一走这里，新增周期类型时只需在本函数补一个分支。
 */
export function describeSchedule(schedule: Schedule): string {
  if (schedule.type !== "weekly") return SCHEDULE_TYPE_LABELS[schedule.type];
  const days = [...(schedule.weekdays ?? [])].sort((a, b) => a - b);
  if (days.length === 0) return "每周（未选日期）";
  return `每周${days.map((day) => WEEKDAY_SHORT_LABELS[day]).join("、")}`;
}

/**
 * 判断任务在给定日期是否应出现。
 * 思路：先做日期区间过滤（startDate / endDate），再按周期类型分派；
 * workday / weekend 依赖外部传入的工作日判定（含调休逻辑）；
 * weekly（每周指定几天）按用户显式勾选的星期命中，与节假日 / 调休无关，不调 isWorkday。
 *
 * 「一次性任务 = 长期任务」语义（阶段 7 起）：schedule.type === "once" 的任务从 startDate
 * 起每天都出现，直到被完成（勾选即关闭）。endDate 只是可选封顶：
 * - endDate === null（未指定截止日）：无限期出现，靠 completedAt 关闭；
 * - endDate !== null：到截止日为止的有界长期任务。
 * 已完成（completedAt 非空）后仅显示 <= 完成日的日期。completedAt 默认 null，旧调用方保持兼容。
 *
 * 日期键为 YYYY-MM-DD 格式，字典序等价于时间序，可直接用字符串比较。
 */
export function occursOn(
  schedule: Schedule,
  dateKey: string,
  isWorkday: WorkdayChecker,
  completedAt: string | null = null,
): boolean {
  if (!isWithinRange(schedule, dateKey)) return false;

  switch (schedule.type) {
    case "once": {
      // 已完成：仅显示 <= 完成日（历史格子灰化、未来日期消失）
      if (completedAt !== null) return dateKey <= completedAt;
      // 未完成：从起始日起每天都出现。endDate 为可选封顶，已由 isWithinRange 处理
      return true;
    }
    case "daily":
      return true;
    case "workday":
      return isWorkday(dateKey);
    case "weekend":
      return !isWorkday(dateKey);
    case "weekly":
      // 每周指定几天：取该日期的周一制星期序号，命中 weekdays 即出现。
      // weekdays 与日历/节假日无关（用户显式指定星期），因此不调 isWorkday。
      return (schedule.weekdays ?? []).includes(weekdayIndexOf(dateKey));
    default:
      return false;
  }
}

/** 仅判断日期是否落在生效区间内（含端点），不涉及周期类型 */
export function isWithinRange(schedule: Schedule, dateKey: string): boolean {
  if (dateKey < schedule.startDate) return false;
  if (schedule.endDate !== null && dateKey > schedule.endDate) return false;
  return true;
}
