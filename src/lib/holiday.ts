// 职责：节假日的纯函数部分 —— 降级判定与数据解析（提示词 5.3）。
// 联网与缓存落盘属于副作用，在 services/holidayService.ts，本文件不涉及。

import {
  HOLIDAY_FILE_PREFIX,
  HOLIDAY_FILE_SUFFIX,
} from "@/constants";
import type { HolidayCache, HolidayCnDay, HolidayCnResponse } from "@/types";
import { isWeekendByCalendar, nowIso } from "./date";
import type { WorkdayChecker } from "./schedule";

/**
 * 降级规则：无任何数据时，周一至周五视为工作日，周六周日视为非工作日。
 */
export function isWorkdayByWeekday(dateKey: string): boolean {
  return !isWeekendByCalendar(dateKey);
}

/**
 * 由某年的节假日数据构造工作日判定函数。
 * 思路：先建「日期 -> 是否休息」的映射，查表命中时以 isOffDay 取反为准
 * （isOffDay = false 即调休上班日，必须识别为工作日）；
 * 未命中时按星期降级。
 */
export function buildWorkdayChecker(days: HolidayCnDay[]): WorkdayChecker {
  const offDayMap = new Map<string, boolean>();
  for (const day of days) {
    offDayMap.set(day.date, day.isOffDay);
  }

  return (dateKey: string): boolean => {
    const isOffDay = offDayMap.get(dateKey);
    if (isOffDay === undefined) return isWorkdayByWeekday(dateKey);
    return !isOffDay;
  };
}

/**
 * 解析 holiday-cn 的响应文本。
 * 失败一律返回 null，不抛异常 —— 调用方据此静默降级，不阻塞 UI（提示词 5.3）。
 */
export function parseHolidayResponse(raw: string, year: number): HolidayCache | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidResponse(parsed)) return null;

    return {
      year,
      updatedAt: nowIso(),
      days: parsed.days,
    };
  } catch {
    return null;
  }
}

/** 校验 holiday-cn 响应的结构，避免脏数据写坏缓存 */
function isValidResponse(value: unknown): value is HolidayCnResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<HolidayCnResponse>;
  if (typeof candidate.year !== "number") return false;
  if (!Array.isArray(candidate.days)) return false;

  return candidate.days.every(isHolidayCnDay);
}

function isHolidayCnDay(value: unknown): value is HolidayCnDay {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<HolidayCnDay>;
  return (
    typeof candidate.date === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.isOffDay === "boolean"
  );
}

/** 节假日缓存文件名：holidays_YYYY.json */
export function holidayFileName(year: number): string {
  return `${HOLIDAY_FILE_PREFIX}${year}${HOLIDAY_FILE_SUFFIX}`;
}
