// 职责：节假日缓存管理与联网刷新（提示词 5.3）。
// 判定优先级：本地缓存 holidays_YYYY.json > 联网刷新 > 降级规则。
// 联网策略：仅在用户主动触发时请求（设置页手动刷新，或新增/修改周期任务且本地无当年数据）。
// 绝对禁止：后台定时联网、启动自动联网、任何数据上传。

import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { HOLIDAY_FETCH_TIMEOUT_MS } from "@/constants";
import { buildWorkdayChecker, isWorkdayByWeekday, parseHolidayResponse } from "@/lib";
import type { HolidayCache, HolidayCnDay } from "@/types";
import { holidayFilePath } from "./paths";

/** 年份 -> 该年的节假日数据 */
const yearCache = new Map<number, HolidayCache>();

/** 正在请求中的年份，防止重复请求 */
const pendingYears = new Set<number>();

/** 读取某年的本地缓存，未命中返回 null。纯本地 IO，不联网。 */
export async function loadYearCache(year: number): Promise<HolidayCache | null> {
  const cached = yearCache.get(year);
  if (cached !== undefined) return cached;

  const path = await holidayFilePath(year);
  try {
    if (!(await exists(path))) return null;
    const parsed: unknown = JSON.parse(await readTextFile(path));
    if (!isHolidayCache(parsed)) return null;

    yearCache.set(year, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** 本地是否已有某年的可用数据 */
export function hasYear(year: number): boolean {
  return yearCache.has(year);
}

/**
 * 获取某年的工作日判定函数。
 * 有缓存时用缓存（含调休识别），无缓存时退化为按星期判定。
 */
export async function getWorkdayChecker(year: number): Promise<(dateKey: string) => boolean> {
  const cache = await loadYearCache(year);
  return cache === null ? isWorkdayByWeekday : buildWorkdayChecker(cache.days);
}

/**
 * 主动联网刷新某年数据（唯一会发起网络请求的地方）。
 * URL 模板留空、已在请求中、或请求失败，均静默返回，不抛异常、不阻塞 UI。
 */
export async function refreshYear(year: number, urlTemplate: string): Promise<boolean> {
  if (urlTemplate.trim() === "") return false;
  if (pendingYears.has(year)) return false;

  const url = urlTemplate.replace("%1", String(year));
  pendingYears.add(year);

  try {
    const raw = await fetchWithTimeout(url, HOLIDAY_FETCH_TIMEOUT_MS);
    const cache = parseHolidayResponse(raw, year);
    if (cache === null) return false;

    yearCache.set(year, cache);
    await writeTextFile(await holidayFilePath(year), JSON.stringify(cache, null, 2));
    return true;
  } catch {
    return false;
  } finally {
    pendingYears.delete(year);
  }
}

/** 带超时的 fetch，超时即中断（提示词 5.3：超时 5 秒，失败静默降级） */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 校验缓存文件结构 */
function isHolidayCache(value: unknown): value is HolidayCache {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<HolidayCache>;
  if (typeof candidate.year !== "number") return false;
  if (typeof candidate.updatedAt !== "string") return false;
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
