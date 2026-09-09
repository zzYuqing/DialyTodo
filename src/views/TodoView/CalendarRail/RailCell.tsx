// 职责：贡献栏格子 —— 月、年两种粒度共用的最小渲染单元。
// 设计要点：
// - 完成度色阶与旧贡献墙同源（CONTRIBUTION_COLORS）；
// - 选中 = 实线描边、今天 = 内圈描边，两者可叠加；
// - 未来日期渲染为「未到」格：空心描边（透明填充 + 虚线边），可点开日视图、可加任务，但不可勾选完成；
// - 悬浮仅显示日期，不显示具体完成数量（数量由色阶深浅表达）；
// - 阶段 6 DDL 扩展：当日过期 DDL 任务数 > 0 时，右下角显示数字角标，hover 显示「N 项任务过期」；
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

  // 未来日期：空心描边的「未到」格，可点开日视图、可加任务，但不可勾选完成；
  // 未来日恒不存在过期角标（completedAt 在未来的 DDL 任务不会出现在过期判定中）。
  if (dateKey > today) {
    const classes = [styles.cell, styles.cellFuture];
    if (dateKey === selectedDate) classes.push(styles.cellSelected);
    return (
      <button
        type="button"
        className={classes.join(" ")}
        title={formatDateLabel(dateKey)}
        onClick={() => setSelectedDate(dateKey)}
      />
    );
  }

  const classes = [styles.cell];
  if (dateKey === today) classes.push(styles.cellToday);
  if (dateKey === selectedDate) classes.push(styles.cellSelected);

  // 悬浮只给日期文本；当存在过期 DDL 任务时把数字带在 title 内，避免与 hover title 重复
  const cellTitle =
    hasExpired
      ? `${formatDateLabel(dateKey)} · ${completion.expiredDdlCount} 项任务过期`
      : formatDateLabel(dateKey);

  return (
    <button
      type="button"
      className={classes.join(" ")}
      style={{ background: CONTRIBUTION_COLORS[completion.level] }}
      title={cellTitle}
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
