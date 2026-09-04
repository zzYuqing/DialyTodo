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
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useWorkdayChecker } from "@/hooks";
import { calcDaysCompletion, getContributionDays, type DayCompletion } from "@/lib";
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
  const isWorkday = useWorkdayChecker(days);
  const completions = useMemo(
    () => calcDaysCompletion(tasks, days, isWorkday),
    [tasks, days, isWorkday],
  );

  const totalDone = useMemo(
    () => Object.values(completions).reduce((sum, item) => sum + item.done, 0),
    [completions],
  );

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
      </div>

      <div className={styles.railBody}>
        {railMode === "month" ? (
          <MonthRail {...railData} />
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
