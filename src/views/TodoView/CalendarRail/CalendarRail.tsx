// 职责：Todo 页左栏 —— 「月历化贡献墙」导航栏（阶段 4 布局定版）。
// 设计要点：
// - 数据与原顶部贡献墙同源：getContributionDays(近 12 个月) + calcDaysCompletion 批量算档；
// - 两种时间粒度顶部切换：月 = MonthRail（迷你月历竖排），年 = YearRail（整年色块转置，
//   7 列为周一~周日、每行为一周、从旧到新向下，最新在最下面）；
// - 点击格子只 setSelectedDate，右侧日视图随之加载当日任务，本栏不做任何页面跳转；
// - 右缘拖把可调宽度（RAIL_WIDTH_MIN ~ RAIL_WIDTH_MAX），粒度与宽度均为会话级状态（useViewStore）；
// - 底部常驻统计（一年内完成 N 项）与色阶图例（「少 → 多」渐变，不显示具体数量）。

import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useWorkdayChecker } from "@/hooks";
import {
  calcDaysCompletion,
  getContributionDays,
  getYearDays,
  getYearRemainingDays,
  type DayCompletion,
} from "@/lib";
import { useTaskStore, useViewStore } from "@/stores";
import { RAIL_WIDTH_MAX, RAIL_WIDTH_MIN } from "@/stores";
import {
  CONTRIBUTION_COLORS,
  CONTRIBUTION_LEVELS,
  CONTRIBUTION_YEAR_MONTHS,
} from "@/constants";
import { MonthRail } from "./MonthRail";
import { YearRail } from "./YearRail";
import styles from "./CalendarRail.module.css";

/** 月/年两种粒度共享的窗口数据 */
export interface RailData {
  /** 窗口内的日期序列（周一起始，截至今天） */
  days: string[];
  /** 日期键 -> 完成情况 */
  completions: Record<string, DayCompletion>;
}

export function CalendarRail() {
  const tasks = useTaskStore((s) => s.tasks);

  const railMode = useViewStore((s) => s.railMode);
  const setRailMode = useViewStore((s) => s.setRailMode);
  const railWidth = useViewStore((s) => s.railWidth);
  const setRailWidth = useViewStore((s) => s.setRailWidth);

  const railRef = useRef<HTMLDivElement>(null);

  // 日期序列不随任何视图状态变化，应用会话内只需计算一次
  const days = useMemo(() => getContributionDays(CONTRIBUTION_YEAR_MONTHS), []);
  // 月视图年份切换器选中的年份（会话级 UI 状态，默认当前年）。切到任何年份时，
  // 该年全量日期都并入 allDays 参与完成度计算：未来年渲染为「未来透明格」，过去年如实上色。
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const yearDays = useMemo(() => getYearDays(selectedYear), [selectedYear]);
  // 年份切换器上下界：上界=当前年+1（未来一年）；下界=最早一条 task 的年份
  // （createdAt 与 startDate 取较早者，避免漏掉早年数据）。无任务时退化为当前年。
  const currentYear = new Date().getFullYear();
  const maxYear = currentYear + 1;
  const minYear = useMemo(() => {
    const active = tasks.filter((task) => !task.archived);
    if (active.length === 0) return currentYear;
    let min = currentYear;
    for (const task of active) {
      const created = Number(task.createdAt.slice(0, 4));
      const start = Number(task.schedule.startDate.slice(0, 4));
      const y = Math.min(created, start);
      if (y < min) min = y;
    }
    return min;
  }, [tasks]);
  // 未来日期（今天所在自然年的剩余天）：月粒度会把整年 12 个月都画出来，
  // 未来格要显示「待完成 N 项 / X 项当日截止」，故一并参与批量计算。
  // 这些天的 done 恒为 0，不会抬高色阶分档用的 maxDone，色阶语义不变。
  const futureDays = useMemo(() => getYearRemainingDays(), []);
  const allDays = useMemo(
    () => [...new Set([...days, ...futureDays, ...yearDays])],
    [days, futureDays, yearDays],
  );
  const isWorkday = useWorkdayChecker(allDays);
  // 分档基准锁死在「近一年」窗口（days），无论切到哪一年，配色口径都不变（completion.ts 硬定义）。
  const completions = useMemo(
    () => calcDaysCompletion(tasks, allDays, isWorkday, days),
    [tasks, allDays, isWorkday, days],
  );

  // 「一年内完成 N 项」始终只统计近一年窗口，不随选中年份漂移。
  const totalDone = useMemo(
    () => days.reduce((sum, key) => sum + (completions[key]?.done ?? 0), 0),
    [completions, days],
  );

  // 年份切换器（顶栏右侧，仅月粒度显示）：越界一律夹回界内，配合按钮 disabled 双保险。
  const handleYearChange = (year: number) => {
    setSelectedYear(Math.min(maxYear, Math.max(minYear, year)));
  };

  // 拖动右缘调宽：宽度实时夹紧到限值内。
  // 拖动期间给 body 挂类（统一 col-resize 光标并禁用文本选择），松手/取消时移除。
  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const railLeft = railRef.current?.getBoundingClientRect().left ?? 0;
    document.body.classList.add(styles.bodyResizing);

    const handleMove = (moveEvent: PointerEvent) => {
      const width = Math.round(moveEvent.clientX - railLeft);
      setRailWidth(Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, width)));
    };
    const handleEnd = () => {
      window.removeEventListener("pointermove", handleMove);
      document.body.classList.remove(styles.bodyResizing);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd, { once: true });
    window.addEventListener("pointercancel", handleEnd, { once: true });
  };

  const railData: RailData = { days, completions };

  return (
    <div ref={railRef} className={styles.rail} style={{ width: railWidth }}>
      <div className={styles.railHeader}>
        <div className={styles.toggle} role="group" aria-label="贡献栏粒度">
          <button
            type="button"
            className={railMode === "month" ? styles.toggleButtonActive : styles.toggleButton}
            onClick={() => setRailMode("month")}
            title="按月查看（迷你月历）"
          >
            月
          </button>
          <button
            type="button"
            className={railMode === "year" ? styles.toggleButtonActive : styles.toggleButton}
            onClick={() => setRailMode("year")}
            title="按年查看（整年色块）"
          >
            年
          </button>
        </div>

        {/* 年份切换器：月/年切换同一行的最右侧，仅月粒度显示。
            ‹/› 翻年到界禁用；点年份标签回当年（已是当年时禁用）。 */}
        {railMode === "month" && (
          <div className={styles.yearNav} role="group" aria-label="切换年份">
            <button
              type="button"
              className={styles.yearNavBtn}
              onClick={() => handleYearChange(selectedYear - 1)}
              disabled={selectedYear <= minYear}
              aria-label="上一年"
            >
              ‹
            </button>
            <button
              type="button"
              className={styles.yearLabel}
              onClick={() => handleYearChange(currentYear)}
              disabled={selectedYear === currentYear}
              title="回到今年"
            >
              {selectedYear} 年
            </button>
            <button
              type="button"
              className={styles.yearNavBtn}
              onClick={() => handleYearChange(selectedYear + 1)}
              disabled={selectedYear >= maxYear}
              aria-label="下一年"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <div className={styles.railBody}>
        {railMode === "month" ? (
          <MonthRail {...railData} selectedYear={selectedYear} />
        ) : (
          <YearRail {...railData} />
        )}
      </div>

      <div className={styles.railFooter}>
        <span className={styles.railStats}>一年内完成 {totalDone} 项</span>
        <span className={styles.legend} aria-label="完成数量色阶：少 → 多">
          <span className={styles.legendLabel}>少</span>
          {CONTRIBUTION_LEVELS.map((level) => (
            <span
              key={level}
              className={styles.legendItem}
              style={{ background: CONTRIBUTION_COLORS[level] }}
            />
          ))}
          <span className={styles.legendLabel}>多</span>
        </span>
      </div>

      <div
        className={styles.resizer}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整贡献栏宽度"
        title="拖动调整宽度"
        onPointerDown={handleResizeStart}
      />
    </div>
  );
}
