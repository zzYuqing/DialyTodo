// 职责：贡献栏格子 —— 月、年两种粒度共用的最小渲染单元。
// 设计要点：
// - 完成度色阶与旧贡献墙同源（CONTRIBUTION_COLORS）；
// - 只有「选中」= 实线描边（强调色）；今天不做任何视觉标记，由页面头部的「今天」按钮回跳定位；
// - 未来日期渲染为「未到」格：空心描边（透明填充 + 虚线边），可点开日视图、可加任务，但不可勾选完成；
// - 今日及过去：悬浮显示「日期 · 完成 N 项」；该日已过去且有 DDL 未完成追加「N 项任务过期」，
//   今天有任务到期（含任务集的子任务）则只追加「N 项今日截止」—— 当天不算过期；
// - 未来：悬浮显示「日期 · 待完成 N 项」，有 DDL 命中该日时追加「X 项当日截止」；
// - 阶段 6 DDL 扩展：右下角红点角标仅在「该日早于今天 且 当日截止未完成数 > 0」时出现 ——
//   截止日当天不点（那天还来得及做），次日仍未完成，该格才点亮。
//   计数 = 顶层任务 + 任务集的子任务（子任务不进日清单顶层，但截止日同样要在墙上标出来）。
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
  const dueCount = completion.expiredDdlCount;
  // 红点口径对齐 ddl.ts 的 isOverdueDdl：截止日当天不算过期（那天还来得及做完），
  // 只有「该日已落入过去且仍未完成」才点亮。今天到期的任务（含任务集的子任务）因此只出文案、
  // 不点红点；若到明天仍未完成，这一格自然转入「过去」判定，红点届时补上。
  const hasExpired = dateKey < today && dueCount > 0;

  // 未来日期：空心描边的「未到」格，可点开日视图、可加任务，但不可勾选完成。
  // 未来日没有「已完成」可言，故提示口径换成「待完成」：应完成任务数减去已提前勾选的数量。
  // expiredDdlCount 的判定是「endDate 命中当天且未完成」，落在未来日即「当日截止」，
  // 因此这里直接复用它，不需要为未来日另写一套 DDL 判定。
  // 计数含任务集的子任务：子任务不进日清单顶层，但它的截止日同样是那天要交的事实，
  // 父与子同日截止按 2 项计（见 lib/completion.ts 的 subtaskDueByDay）。
  if (dateKey > today) {
    const classes = [styles.cell, styles.cellFuture];
    if (dateKey === selectedDate) classes.push(styles.cellSelected);
    const pending = Math.max(0, completion.total - completion.done);
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

  // 悬浮文案：日期 + 完成数量；日期已过去且仍有 DDL 未完成 → 追加过期条数（避免与角标重复提示）；
  // 今天到期 → 追加「今日截止」（当天还算得及做，不按过期处理，故不点红点、只给文案）。
  const cellTitle = [
    formatDateLabel(dateKey),
    `完成 ${completion.done} 项`,
    dueCount > 0 ? (hasExpired ? `${dueCount} 项任务过期` : `${dueCount} 项今日截止`) : null,
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
          aria-label={`${dueCount} 项 DDL 任务已过期`}
        />
      )}
    </button>
  );
}
