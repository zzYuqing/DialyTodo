// 职责：贡献栏格子 —— 月、年两种粒度共用的最小渲染单元。
// 设计要点：
// - 完成度色阶与旧贡献墙同源（CONTRIBUTION_COLORS）；
// - 只有「选中」= 实线描边（强调色）；今天不做任何视觉标记，由页面头部的「今天」按钮回跳定位；
// - 未来日期渲染为「未到」格：空心描边（透明填充 + 虚线边），可点开日视图、可加任务，但不可勾选完成；
// - 今日及过去：悬浮显示「日期 · 完成 N 项」，有过期 DDL 时追加「N 项任务过期」；
// - 未来：悬浮显示「日期 · 待完成 N 项」，有 DDL 命中该日时追加「X 项当日截止」；
// - 阶段 6 DDL 扩展：当日过期 DDL 任务数 > 0 时，右下角显示数字角标，hover 追加「N 项任务过期」；
// - 点击只 setSelectedDate，日视图随之加载当日任务，不做任何跳转。

import { EMPTY_COMPLETION, formatDateLabel, todayKey, type DayCompletion } from "@/lib";
import { useViewStore } from "@/stores";
import { CONTRIBUTION_COLORS } from "@/constants";
import styles from "./CalendarRail.module.css";

interface RailCellProps {
  dateKey: string;
  completion: DayCompletion | undefined;
}

export function RailCell({ dateKey, completion: raw }: RailCellProps) {
  const selectedDate = useViewStore((s) => s.selectedDate);
  const setSelectedDate = useViewStore((s) => s.setSelectedDate);
  const today = todayKey();
  const completion = raw ?? EMPTY_COMPLETION;
  const hasExpired = completion.expiredDdlCount > 0;

  // 未来日期：空心描边的「未到」格，可点开日视图、可加任务，但不可勾选完成。
  // 未来日没有「已完成」可言，故提示口径换成「待完成」：应完成任务数减去已提前勾选的数量。
  // expiredDdlCount 的判定是「endDate 命中当天且未完成」，落在未来日即「当日截止」，
  // 因此这里直接复用它，不需要为未来日另写一套 DDL 判定（见 lib/ddl.ts 的 isOverdueDdl）。
  if (dateKey > today) {
    const classes = [styles.cell, styles.cellFuture];
    if (dateKey === selectedDate) classes.push(styles.cellSelected);
    const pending = Math.max(0, completion.total - completion.done);
    const dueCount = completion.expiredDdlCount;
    const cellTitle = [
      formatDateLabel(dateKey),
      `待完成 ${pending} 项`,
      dueCount > 0 ? `${dueCount} 项当日截止` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <button
        type="button"
        className={classes.join(" ")}
        title={cellTitle}
        aria-label={cellTitle}
        onClick={() => setSelectedDate(dateKey)}
      />
    );
  }

  const classes = [styles.cell];
  if (dateKey === selectedDate) classes.push(styles.cellSelected);

  // 悬浮文案：日期 + 完成数量；存在过期 DDL 任务时追加过期条数，避免与角标重复提示
  const cellTitle = [
    formatDateLabel(dateKey),
    `完成 ${completion.done} 项`,
    hasExpired ? `${completion.expiredDdlCount} 项任务过期` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      className={classes.join(" ")}
      style={{ background: CONTRIBUTION_COLORS[completion.level] }}
      title={cellTitle}
      aria-label={cellTitle}
      onClick={() => setSelectedDate(dateKey)}
    >
      {hasExpired && (
        <span
          className={styles.expiredBadge}
          aria-label={`${completion.expiredDdlCount} 项 DDL 任务已过期`}
        />
      )}
    </button>
  );
}
