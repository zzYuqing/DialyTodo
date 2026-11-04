// 职责：AI 报告页左栏 —— 已生成报告的「区间条」导航（对齐 Todo 页贡献栏的交互模型）。
// 设计要点：
// - 数据与 Todo 主页贡献墙完全同源：getContributionDays(近 12 个月) + calcDaysCompletion
//   同参计算，条内微缩日格的颜色与主页格子一一对应；
// - 自然周报告与自定义区间报告**合并成一个列表**，按生成时间倒序排列，
//   不区分类型、不分区、无「自定义」标题（用户拍板：只按时间看）；
// - 每条 = 一个区间：区间文本 + 微缩正方形日格（≤16 格一天一格，更长分桶取最高档），
//   格子 hover 显示对应日期与当日完成数；右上实心点表示已生成（列表里恒真）；
// - 「＋ 新建报告」按钮固定在列表上方；
// - 宽度与 Todo 主页共用 railWidth（同一份用户偏好），右缘拖宽把手行为一致。

import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  addDaysToKey,
  calcDaysCompletion,
  formatShortMonthDay,
  getContributionDays,
  todayKey,
  weekStartOf,
  type DayCompletion,
} from "@/lib";
import {
  CONTRIBUTION_COLORS,
  CONTRIBUTION_LEVELS,
  CONTRIBUTION_YEAR_MONTHS,
  type ContributionLevel,
} from "@/constants";
import { useReportTaskStore, useTaskStore, useViewStore, RAIL_WIDTH_MAX, RAIL_WIDTH_MIN } from "@/stores";
import { useWorkdayChecker } from "@/hooks";
import type { WeeklyReport } from "@/types";
import styles from "./ReportsView.module.css";

interface ReportRailProps {
  /** 全部已生成报告（自然周 key = 周一日期；自定义 key = custom:start_end） */
  reports: Record<string, WeeklyReport>;
  /** 当前查看的报告 key；null = 未选中（新建报告或空态） */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** 打开「新建报告」编辑器（按周/自定义在面板内切换） */
  onCompose: () => void;
}

/** 微缩格数量上限：正方形 9px + 间距 2px，16 格约 176px，适配左栏最小宽度 */
const MAX_MINI_CELLS = 16;

export function ReportRail({ reports, selectedKey, onSelect, onCompose }: ReportRailProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const railWidth = useViewStore((s) => s.railWidth);
  const setRailWidth = useViewStore((s) => s.setRailWidth);
  // 同一时间只允许一份报告在生成（store.start 亦会忽略并发请求），按钮同步禁用
  const generating = useReportTaskStore((s) => s.running !== null);

  const today = todayKey();
  const railRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 与 Todo 主页完全同源的近一年窗口：起点 = 12 个月前月初所在周的周一，截至今天。
  // 色阶分档基准（scaleKeys）也用同一窗口，保证同一天在两页颜色一致。
  const railDays = useMemo(() => getContributionDays(CONTRIBUTION_YEAR_MONTHS), []);
  const isWorkday = useWorkdayChecker(railDays);
  const completions = useMemo(
    () => calcDaysCompletion(tasks, railDays, isWorkday, railDays),
    [tasks, railDays, isWorkday],
  );

  // 合并列表：自然周 + 自定义一起，按生成时间倒序（最新在最上）。
  // 同刻 fallback 按 key 倒序，保证顺序稳定。
  const entries = useMemo(
    () =>
      Object.values(reports).sort((a, b) => {
        if (a.generatedAt !== b.generatedAt) return a.generatedAt < b.generatedAt ? 1 : -1;
        return a.key < b.key ? 1 : -1;
      }),
    [reports],
  );

  // 初始滚动定位到顶部（列表即最新，顶部就是定位点）
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll !== null) scroll.scrollTop = 0;
  }, []);

  // 拖动右缘调宽：与 CalendarRail 同款实现（宽度实时夹紧到限值内）
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

  const thisWeekStart = weekStartOf(today);

  return (
    <div ref={railRef} className={styles.rail} style={{ width: railWidth }}>
      <div ref={scrollRef} className={styles.railScroll}>
        <button
          type="button"
          className={styles.genEntry}
          onClick={onCompose}
          disabled={generating}
          title={generating ? "正在生成报告，完成后可再新建" : "新建一份报告：按周或自定义区间"}
        >
          ＋ 新建报告
        </button>

        {entries.map((r) => (
          <RangeStrip
            key={r.key}
            start={r.start}
            end={r.end}
            completions={completions}
            tag={r.start === thisWeekStart ? "本周" : undefined}
            totalDays={r.kind === "natural" ? 7 : undefined}
            doneOverride={r.doneCount}
            selected={selectedKey === r.key}
            innerRef={r.start === thisWeekStart ? currentRef : undefined}
            onSelect={() => onSelect(r.key)}
          />
        ))}
      </div>

      <div className={styles.railFooter}>
        <span className={styles.railStats}>已生成 {entries.length} 篇</span>
        <span className={styles.legend} aria-label="完成数量色阶：少 → 多">
          {CONTRIBUTION_LEVELS.map((level) => (
            <span
              key={level}
              className={styles.legendItem}
              style={{ background: CONTRIBUTION_COLORS[level] }}
            />
          ))}
        </span>
      </div>

      <div
        className={styles.resizer}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整报告栏宽度"
        title="拖动调整宽度"
        onPointerDown={handleResizeStart}
      />
    </div>
  );
}

/** 单个区间条：一整格 = 一个已生成报告的区间，内部微缩**正方形**日格沿用贡献墙色阶。
 *  每个格子 hover（title）显示对应日期与当日完成数；>16 天的区间分桶，
 *  桶格 hover 显示日期范围与桶内完成合计。 */
function RangeStrip({
  start,
  end,
  completions,
  tag,
  totalDays,
  doneOverride,
  selected,
  innerRef,
  onSelect,
}: {
  start: string;
  end: string;
  completions: Record<string, DayCompletion>;
  tag?: string;
  /** 区间完整天数（自然周固定 7，本周可画出未来占位格；不传则按实际天数） */
  totalDays?: number;
  /** 报告里存的完成项数：区间超出色阶统计窗口时用它兜底显示 */
  doneOverride?: number;
  selected: boolean;
  innerRef?: RefObject<HTMLButtonElement>;
  onSelect: () => void;
}) {
  const today = todayKey();

  // 今天之后的日期不能进报告，统计与画格子都截到今天
  const effectiveEnd = end > today ? today : end;
  const days: string[] = [];
  for (let key = start; key <= effectiveEnd; key = addDaysToKey(key, 1)) days.push(key);
  const span = totalDays ?? days.length;
  const futureCount = Math.max(0, span - days.length);

  // 色阶统计按本机实际完成量算；区间落在统计窗口外时退回报告里存的项数
  const computedDone = days.reduce((sum, key) => sum + (completions[key]?.done ?? 0), 0);
  const totalDone = computedDone > 0 ? computedDone : (doneOverride ?? 0);
  const title = [
    `${formatShortMonthDay(start)} – ${formatShortMonthDay(end)}`,
    tag ?? "已生成报告",
    `完成 ${totalDone} 项`,
  ].join(" · ");

  const classes = [styles.strip, styles.stripGenerated];
  if (tag !== undefined) classes.push(styles.stripCurrent);
  if (selected) classes.push(styles.stripSelected);

  return (
    <button
      ref={innerRef}
      type="button"
      className={classes.join(" ")}
      title={title}
      aria-label={title}
      onClick={onSelect}
    >
      <span className={styles.stripRow}>
        <span className={styles.stripRange}>
          {formatShortMonthDay(start)} – {formatShortMonthDay(end)}
        </span>
        {tag !== undefined && <span className={styles.stripTag}>{tag}</span>}
        <span className={styles.stripCount}>{totalDone > 0 ? `${totalDone} 项` : "—"}</span>
      </span>
      <span className={styles.stripMinis}>
        {buildMiniCells(days, completions).map((cell, index) => (
          <span key={`m-${index}`} className={styles.stripMini} title={cell.title}
            style={{ background: CONTRIBUTION_COLORS[cell.level] }}
          />
        ))}
        {futureCount > 0 &&
          Array.from({ length: futureCount }, (_, index) => (
            <span key={`f-${index}`} className={styles.stripMiniFuture} />
          ))}
      </span>
    </button>
  );
}

/** 微缩格数据：≤16 天一天一格（hover = 单日日期 + 当日完成数）；
 *  更长的区间分桶取桶内最高档（hover = 日期范围 + 桶内完成合计）。
 *  分桶而非截断，是为了让「哪几天最活跃」在条上仍能看出来。 */
function buildMiniCells(
  days: string[],
  completions: Record<string, DayCompletion>,
): { title: string; level: ContributionLevel }[] {
  if (days.length <= MAX_MINI_CELLS) {
    return days.map((key) => ({
      title: `${formatShortMonthDay(key)} · 完成 ${completions[key]?.done ?? 0} 项`,
      level: completions[key]?.level ?? 0,
    }));
  }
  const cells: { title: string; level: ContributionLevel }[] = [];
  for (let i = 0; i < MAX_MINI_CELLS; i += 1) {
    const from = Math.floor((i * days.length) / MAX_MINI_CELLS);
    const to = Math.max(from + 1, Math.floor(((i + 1) * days.length) / MAX_MINI_CELLS));
    let level: ContributionLevel = 0;
    let done = 0;
    for (let j = from; j < to; j += 1) {
      const dayLevel = completions[days[j]]?.level ?? 0;
      if (dayLevel > level) level = dayLevel;
      done += completions[days[j]]?.done ?? 0;
    }
    cells.push({
      title: `${formatShortMonthDay(days[from])}–${formatShortMonthDay(days[to - 1])} · 完成 ${done} 项`,
      level,
    });
  }
  return cells;
}
