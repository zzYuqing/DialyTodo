// 职责：贡献栏格子 —— 月、年两种粒度共用的最小渲染单元。
// 设计要点：
// - 完成度色阶与旧贡献墙同源（CONTRIBUTION_COLORS）；
// - 选中 = 实线描边、今天 = 内圈描边，两者可叠加；
// - 未来日期渲染为「未到」格：空心描边（透明填充 + 虚线边），可点开日视图、可加任务，但不可勾选完成；
// - 悬浮仅显示日期，不显示具体完成数量（数量由色阶深浅表达）；
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

  // 未来日期：空心描边的「未到」格，可点开日视图、可加任务，但不可勾选完成
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

  const completion = raw ?? EMPTY_COMPLETION;
  const classes = [styles.cell];
  if (dateKey === today) classes.push(styles.cellToday);
  if (dateKey === selectedDate) classes.push(styles.cellSelected);

  // 悬浮只给日期，不给具体完成数量（数量由色阶深浅表达）
  const title = formatDateLabel(dateKey);

  return (
    <button
      type="button"
      className={classes.join(" ")}
      style={{ background: CONTRIBUTION_COLORS[completion.level] }}
      title={title}
      onClick={() => setSelectedDate(dateKey)}
    />
  );
}
