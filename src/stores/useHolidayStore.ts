// 职责：节假日缓存状态的持有者，对外提供工作日判定。
// 硬性约束（提示词 5.3）：绝不自动联网。加载缓存是本地 IO；
// 只有调用 refreshYear 时才会发起网络请求，而该方法只由用户主动操作触发。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { buildWorkdayChecker, isWorkdayByWeekday } from "@/lib";
import type { WorkdayChecker } from "@/lib";
import { getWorkdayChecker, loadYearCache, refreshYear } from "@/services";

interface HolidayState {
  /** 年份 -> 该年的工作日判定函数 */
  checkers: Record<number, WorkdayChecker>;
  /** 已确认无本地数据的年份，用于提示"是否刷新" */
  missingYears: number[];
  /** 加载某年的本地缓存（不联网）；返回 true 表示命中本地缓存，false 表示无数据已降级 */
  ensureYear: (year: number) => Promise<boolean>;
  /** 用户主动触发的联网刷新 */
  refresh: (year: number, urlTemplate: string) => Promise<boolean>;
  /** 对外的工作日判定：无数据时自动降级为按星期判定 */
  isWorkday: (dateKey: string) => boolean;
}

export const useHolidayStore = create<HolidayState>()(
  devtools((set, get) => ({
    checkers: {},
    missingYears: [],

    async ensureYear(year) {
      if (get().checkers[year] !== undefined) return true;

      const cache = await loadYearCache(year);
      // 无缓存时降级为按星期判定，绝不在此联网（提示词 5.3）
      const checker: WorkdayChecker =
        cache === null ? isWorkdayByWeekday : buildWorkdayChecker(cache.days);

      set((state) => ({
        checkers: { ...state.checkers, [year]: checker },
        missingYears:
          cache === null
            ? state.missingYears.includes(year)
              ? state.missingYears
              : [...state.missingYears, year]
            : state.missingYears.filter((item) => item !== year),
      }));

      // 命中本地缓存返回 true；无数据降级返回 false（由调用方决定是否自动拉取）
      return cache !== null;
    },

    async refresh(year, urlTemplate) {
      const ok = await refreshYear(year, urlTemplate);
      if (!ok) return false;

      // 刷新成功后用新数据重建判定函数
      const checker = await getWorkdayChecker(year);
      set((state) => ({
        checkers: { ...state.checkers, [year]: checker },
        missingYears: state.missingYears.filter((item) => item !== year),
      }));
      return true;
    },

    isWorkday(dateKey) {
      const year = Number(dateKey.slice(0, 4));
      const checker = get().checkers[year];
      if (checker === undefined) return isWorkdayByWeekday(dateKey);
      return checker(dateKey);
    },
  })),
);
