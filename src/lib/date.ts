// 职责：本地时区的日期工具。
// 硬性约束（提示词 4.3）：所有日期用本地时区的 YYYY-MM-DD 字符串，禁止用时间戳做日期主键。
// 本文件为纯函数，不得 import 任何 Tauri / React / zustand 依赖。

import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export const DATE_KEY_FORMAT = "yyyy-MM-dd";
export const MONTH_KEY_FORMAT = "yyyy-MM";

/** 周日到周六的中文标签，索引与 Date.getDay() 一致 */
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Date -> YYYY-MM-DD */
export function toDateKey(date: Date): string {
  return format(date, DATE_KEY_FORMAT);
}

/** YYYY-MM-DD -> Date（本地时区零点） */
export function fromDateKey(key: string): Date {
  return parseISO(key);
}

/** 今天的日期键 */
export function todayKey(): string {
  return toDateKey(new Date());
}

/** 在日期键上加减天数 */
export function addDaysToKey(key: string, amount: number): string {
  return toDateKey(addDays(fromDateKey(key), amount));
}

/**
 * 周一为一周起始的星期序号：0 = 周一，... 6 = 周日。
 * Date.getDay() 以周日为 0，故做一次偏移。
 */
export function weekdayIndexOf(key: string): number {
  return (fromDateKey(key).getDay() + 6) % 7;
}

/** 按日历判断是否为周六或周日（不含调休，仅用于降级规则） */
export function isWeekendByCalendar(key: string): boolean {
  const day = fromDateKey(key).getDay();
  return day === 0 || day === 6;
}

/**
 * 生成月视图的日期网格（提示词 5.2）。
 * 思路：取当月首日所在周的周一为起点、当月末日所在周的周日为终点，
 * 保证网格恒为整周，行数随月份在 5-6 行之间浮动。
 */
export function getMonthGrid(year: number, month: number): string[] {
  const anchor = new Date(year, month, 1);
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map(toDateKey);
}

/** 形如「9月2日 周三」的展示文案 */
export function formatDateLabel(key: string): string {
  const date = fromDateKey(key);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

/** 形如「2026年9月」的月份展示文案 */
export function formatMonthLabel(year: number, month: number): string {
  return `${year}年${month + 1}月`;
}

/** 当前时刻的 ISO8601 字符串，用于 createdAt / doneAt */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 计算某个 HH:mm 距离当前时刻的毫秒数。
 * 若该时刻当天已过，返回 -1，由调用方决定是否跳过（提醒调度用）。
 */
export function millisecondsUntil(time: string, now: Date = new Date()): number {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return -1;

  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return target.getTime() - now.getTime();
}
