// 职责：按日期所属年份分派工作日判定，并确保区间涉及的年份缓存已加载。
// 背景：日模式只渲染单日，直接取当年 checker 就够；月模式网格含邻月、贡献墙跨 12 个月，
// 都可能跨年，因此需要"按日期找年份"的分派逻辑，年份集合由传入的日期区间推导。
// 硬性约束（提示词 5.3）：ensureYear 只做本地缓存 IO，无缓存时降级为按星期判定，绝不联网。
// 自动识别（用户授权）：某年首次被需要且本地无缓存时，自动触发一次 refresh 拉取并落盘，
// 成功后 store 重建 checker 即转为节假日感知；失败则保持 Mon-Fri，本会话不再重试。

import { useCallback, useEffect, useMemo } from "react";
import { isWorkdayByWeekday, type WorkdayChecker } from "@/lib";
import { useHolidayStore, useSettingsStore } from "@/stores";

/** 本会话内已尝试自动拉取的年份，防止 ensureYear 多次触发重复请求 */
const autoFetched = new Set<number>();

/**
 * 返回可对任意日期键调用的判定函数。
 * 依赖只有 checkerByYear，因此节假日缓存更新或年份补齐后会自动重建。
 */
export function useWorkdayChecker(dateKeys: string[]): WorkdayChecker {
  const ensureYear = useHolidayStore((s) => s.ensureYear);
  const refresh = useHolidayStore((s) => s.refresh);
  const checkerByYear = useHolidayStore((s) => s.checkers);
  const holidayUrl = useSettingsStore((s) => s.settings.holidayUrlTemplate);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const key of dateKeys) set.add(Number(key.slice(0, 4)));
    return [...set].sort();
  }, [dateKeys]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const year of years) {
        if (cancelled) return;
        // 本地缓存加载（无缓存时降级为按星期判定，ensureYear 返回 false）
        const loaded = await ensureYear(year);
        // 首次用到某年且无本地数据：自动拉取一次（用户授权的一次性识别）
        if (!loaded && holidayUrl.trim() !== "" && !autoFetched.has(year)) {
          autoFetched.add(year);
          void refresh(year, holidayUrl);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [years, ensureYear, refresh, holidayUrl]);

  return useCallback((dateKey: string) => {
    const checker = checkerByYear[Number(dateKey.slice(0, 4))];
    return (checker ?? isWorkdayByWeekday)(dateKey);
  }, [checkerByYear]);
}
