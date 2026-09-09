// 职责：本地时区的日期工具。
// 硬性约束（提示词 4.3）：所有日期用本地时区的 YYYY-MM-DD 字符串，禁止用时间戳做日期主键。
// 本文件为纯函数，不得 import 任何 Tauri / React / zustand 依赖。

import {
  addDays,
  differenceInDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  parseISO,
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
 * 两日期键相差的天数（end - start）；可负数。日期键按本地零点解析，差值与日历一致。
 * DDL 任务档位判定依赖此函数保持「跨月 / 跨年」的天数正确性。
 */
export function daysBetweenKeys(start: string, end: string): number {
  return differenceInDays(parseISO(end), parseISO(start));
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
 * 生成某自然月的所有日期（仅当月，不含邻月溢出）。
 * 返回按日期先后排序的 YYYY-MM-DD 列表；周首尾的空白对齐交由调用方用占位元素补齐。
 */
export function getMonthDays(year: number, month: number): string[] {
  const start = new Date(year, month, 1);
  const end = endOfMonth(start);
  return eachDayOfInterval({ start, end }).map(toDateKey);
}

/** 形如「9月5日」的月日文案，不带星期 */
export function formatMonthDay(key: string): string {
  const date = fromDateKey(key);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 形如「9月2日 周三」的展示文案 */
export function formatDateLabel(key: string): string {
  const date = fromDateKey(key);
  return `${formatMonthDay(key)} ${WEEKDAY_LABELS[date.getDay()]}`;
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

/** 距离下一个本地午夜的毫秒数（提醒跨日重排用，恒为正数）。 */
export function millisecondsUntilMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/** Date -> YYYY-MM */
export function toMonthKey(date: Date): string {
  return format(date, MONTH_KEY_FORMAT);
}

/**
 * 生成贡献墙的日期序列（GitHub 风格整年，提示词 5.6）。
 * 思路：从今天往前推 months-1 个月，取该月 1 号所在周的周一为起点，
 * 到今天为止（未来日期不渲染）；起点取整周保证所有列与星期对齐。
 */
export function getContributionDays(months: number, now: Date = new Date()): string[] {
  const windowStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const start = startOfWeek(windowStart, { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end: now }).map(toDateKey);
}
