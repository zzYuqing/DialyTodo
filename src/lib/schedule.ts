// 职责：周期规则判定 —— 某任务的周期规则在给定日期是否应出现（提示词 5.2）。
// 纯函数，不持状态、不碰 IO。
// 设计要点（沿用上一版 ScheduleRule）：工作日判定由外部回调注入，
// 使本模块与节假日服务解耦 —— 单测时传 () => true 即可覆盖全部周期分支。

import { SCHEDULE_TYPE_LABELS, WEEKDAY_SHORT_LABELS } from "@/constants";
import type { Schedule, SpecialSchedule } from "@/types";
import { daysBetweenKeys, fromDateKey, toDateKey, weekdayIndexOf } from "./date";

/** 工作日判定回调，由节假日服务提供 */
export type WorkdayChecker = (dateKey: string) => boolean;

/**
 * 周期规则的人类可读文案：weekly 具体到星期（如「每周一、五」），其余类型用常量表。
 * 徽标展示统一走这里，新增周期类型时只需在本函数补一个分支。
 */
export function describeSchedule(schedule: Schedule): string {
  if (schedule.type !== "weekly" && schedule.type !== "special") {
    return SCHEDULE_TYPE_LABELS[schedule.type];
  }
  if (schedule.type === "weekly") {
    const days = [...(schedule.weekdays ?? [])].sort((a, b) => a - b);
    if (days.length === 0) return "每周（未选日期）";
    return `每周${days.map((day) => WEEKDAY_SHORT_LABELS[day]).join("、")}`;
  }
  return describeSpecial(schedule.special);
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
    case "special":
      return occursOnSpecial(schedule, dateKey, isWorkday, completedAt);
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

/**
 * 以周一为周边界，计算 date 相对 start 所在周的「周序号差」。
 * start 所在周为第 0 周；相邻整周差即为 weekIndexSince。
 * 用于特殊周期 week 单位的「每 N 周」对齐（cron 式周对齐，非 7 天滑动窗口）。
 */
function weekIndexSince(start: string, date: string): number {
  const s = fromDateKey(start);
  const d = fromDateKey(date);
  const sMonday = new Date(s);
  sMonday.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  const dMonday = new Date(d);
  dMonday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Math.round(daysBetweenKeys(toDateKey(sMonday), toDateKey(dMonday)) / 7);
}

/** 整月差（跨年正确）：(年差 × 12) + 月差 */
function monthDiff(start: string, date: string): number {
  const s = fromDateKey(start);
  const d = fromDateKey(date);
  return (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth());
}

/**
 * date 是否为当月的第 ordinal 个 weekday（周一制 weekday 序号）。
 * ordinal = 5 表示「最后一个」：若第 5 个超出当月天数，回退一周取实际最后一个；
 * ordinal ≤ 4 时该 weekday 每月必存在，无需回退。
 */
function nthWeekdayOfMonth(dateKey: string, ordinal: number, weekday: number): boolean {
  const date = fromDateKey(dateKey);
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7;
  const firstMatchDay = 1 + ((weekday - firstWeekday + 7) % 7);
  let targetDay = firstMatchDay + (ordinal - 1) * 7;
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (targetDay > lastDay) targetDay -= 7;
  return date.getDate() === targetDay;
}

/** dateKey 是否为当月最后一天：不论大小月 / 2 月，自动取到正确末日（new Date(y, m+1, 0)） */
function isLastDayOfMonth(dateKey: string): boolean {
  const date = fromDateKey(dateKey);
  return date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * 特殊周期命中判定（docs/特殊周期设计.md 第 4 节）。
 * 先过区间过滤，再按 unit 分派；startDate 同时是周期锚点（第 0 次基准）。
 */
function occursOnSpecial(
  schedule: Schedule,
  dateKey: string,
  _isWorkday: WorkdayChecker,
  _completedAt: string | null,
): boolean {
  if (!isWithinRange(schedule, dateKey)) return false;
  const sp = schedule.special;
  if (sp == null) return false;

  switch (sp.unit) {
    case "day":
      // start 当天算第 0 次命中；之后每 interval 天一次
      return daysBetweenKeys(schedule.startDate, dateKey) % sp.interval === 0;
    case "week": {
      if ((sp.weekdays ?? []).length === 0) return false;
      const wk = weekIndexSince(schedule.startDate, dateKey);
      return wk % sp.interval === 0 && (sp.weekdays ?? []).includes(weekdayIndexOf(dateKey));
    }
    case "month": {
      if (monthDiff(schedule.startDate, dateKey) % sp.interval !== 0) return false;
      const dom = fromDateKey(dateKey).getDate();
      if ((sp.monthDays ?? []).includes(dom)) return true;
      if (sp.monthLastDay === true && isLastDayOfMonth(dateKey)) return true;
      if (sp.monthWeekday) {
        for (const mw of sp.monthWeekday) {
          if (nthWeekdayOfMonth(dateKey, mw.ordinal, mw.weekday)) return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

/** ordinal 的中文描述：1–4 = 第N个，5 = 最后 */
function ordinalLabel(ordinal: number): string {
  return ordinal === 5 ? "最后" : `第${ordinal}`;
}

/**
 * 特殊周期的人类可读文案（docs/特殊周期设计.md 第 8 节）。
 * special 缺失时给降级文案，避免渲染层崩。
 */
export function describeSpecial(special: SpecialSchedule | undefined): string {
  if (special == null) return SCHEDULE_TYPE_LABELS.special;
  const unitLabel = special.unit === "day" ? "天" : special.unit === "week" ? "周" : "月";
  const head = `每 ${special.interval} ${unitLabel}`;
  if (special.unit === "day") return head;
  if (special.unit === "week") {
    const days = [...(special.weekdays ?? [])].sort((a, b) => a - b);
    if (days.length === 0) return `${head}（未选星期）`;
    return `${head} ${days.map((day) => WEEKDAY_SHORT_LABELS[day]).join("、")}`;
  }
  // month
  const parts: string[] = [];
  if (special.monthDays && special.monthDays.length > 0) {
    parts.push(`${[...special.monthDays].sort((a, b) => a - b).join("、")} 号`);
  }
  if (special.monthLastDay === true) parts.push("最后一天");
  if (special.monthWeekday && special.monthWeekday.length > 0) {
    parts.push(
      special.monthWeekday
        .map((mw) => `${ordinalLabel(mw.ordinal)}个${WEEKDAY_SHORT_LABELS[mw.weekday]}`)
        .join("、"),
    );
  }
  if (parts.length === 0) return `${head}（未选日期）`;
  return `${head} ${parts.join("，")}`;
}
