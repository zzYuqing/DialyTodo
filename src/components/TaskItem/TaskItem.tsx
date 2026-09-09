// 职责：单条任务行 —— 显示标题、备注、周期徽标、完成状态、操作图标。
// 交互：
// - 点击 checkbox 切换当日完成（future 日由 disabledDone 禁用）
// - 长期 DDL 任务已完成且 dateKey < completedAt 时：整行灰化、checkbox 禁用无勾（防止补勾）
// - 双击标题 / 点击右侧编辑图标 → 触发 onEdit
// - 点击右侧归档图标 → 触发 onRemove（语义为归档）
// - 已完成任务整体变灰、标题加删除线
//
// 方向 B（DDL 语义重定义）：
// - 长期 DDL = 周期 once 且 endDate 存在且 endDate ≠ startDate；
//   起止同日的 once 任务不算 DDL，不染红、不显示「已过期」。
// - 「已过期」仅在其 endDate 当天、且未完成时成立（isOverdueDdl）；
//   超过 endDate 的任务由 occursOn/isWithinRange 过滤，不会出现在日清单。
// - 紧迫度走整条左侧色条 + 标题色阶（低饱和暖灰，避红橙），不染徽章；
//   「已过期」走独立红徽章，置于周期徽章右侧、日期之前。

import { memo } from "react";
import type { Task } from "@/types";
import {
  daysBetweenKeys,
  isDoneOn,
  isLongDdlTask,
  isOverdueDdl,
  ddlUrgencyFor,
  type DdlUrgency,
} from "@/lib";
import { SCHEDULE_TYPE_LABELS } from "@/constants";
import { BellIcon, CheckIcon, EditIcon, TrashIcon } from "@/components/Icons";
import styles from "./TaskItem.module.css";

interface TaskItemProps {
  task: Task;
  /** 当前选中日期，YYYY-MM-DD */
  dateKey: string;
  /** 未来日期下禁用勾选完成（仍可编辑 / 归档 / 新建） */
  disabledDone?: boolean;
  onToggleDone: (id: string, done: boolean) => void;
  onEdit: (task: Task) => void;
  onRemove: (id: string) => void;
}

// 紧迫度档位 → 整条行类名（显式映射，禁止 styles[`tone${x}`] 动态拼接）
const URGENCY_ROW_CLASS: Record<Exclude<DdlUrgency, null>, string> = {
  far: styles.toneFar,
  soon: styles.toneSoon,
  imminent: styles.toneImminent,
  today: styles.toneToday,
  overdue: styles.toneOverdue,
};

export const TaskItem = memo(function TaskItem({
  task,
  dateKey,
  disabledDone = false,
  onToggleDone,
  onEdit,
  onRemove,
}: TaskItemProps) {
  const done = isDoneOn(task, dateKey);
  const scheduleLabel = SCHEDULE_TYPE_LABELS[task.schedule.type];

  // 长期 DDL 判定：一次且仅一次、有结束日、且结束日 ≠ 起始日
  const isLongDdl = isLongDdlTask(task.schedule);
  const isDdlCompleted = isLongDdl && task.completedAt != null;
  const isDdlCompletedDay = isDdlCompleted && task.completedAt === dateKey;
  // 过去格子：DDL 已完成但 dateKey 早于完成日（防止补勾）
  const isDdlPastDay =
    isDdlCompleted && task.completedAt != null && dateKey < task.completedAt;

  // 紧迫度档位：仅长期 DDL 未完成时按 dateKey 计算（含 overdue 档）
  const urgency: DdlUrgency =
    isLongDdl && !isDdlCompleted ? ddlUrgencyFor(task, dateKey) : null;
  // 已过期：长期 DDL 在结束日当天且未完成（独立于档位，走红徽章）
  const overdue = isOverdueDdl(task, dateKey);

  // 完成态追加文字：完成时距 DDL 的剩余天数（endDate - completedAt）
  const daysAhead =
    isDdlCompletedDay && task.schedule.endDate != null && task.completedAt != null
      ? daysBetweenKeys(task.completedAt, task.schedule.endDate)
      : null;

  // 行类与禁用：除未来日，DDL 过去格子也禁用
  const rowClasses = [styles.row];
  if (done) rowClasses.push(styles.done);
  if (isDdlPastDay) rowClasses.push(styles.pastDay);
  if (urgency != null) rowClasses.push(URGENCY_ROW_CLASS[urgency]);
  const checkboxDisabled = disabledDone || isDdlPastDay;

  return (
    <li className={rowClasses.join(" ")}>
      <button
        type="button"
        className={styles.checkbox}
        aria-pressed={done}
        aria-disabled={checkboxDisabled}
        disabled={checkboxDisabled}
        aria-label={
          isDdlPastDay
            ? "已完成的 DDL 任务，该日期不能再勾选"
            : disabledDone
              ? "未来日期不可勾选完成"
              : done
                ? "标记为未完成"
                : "标记为已完成"
        }
        title={
          isDdlPastDay
            ? "DDL 任务已完成，该日期不能再勾选"
            : disabledDone
              ? "未来日期暂不可勾选完成"
              : undefined
        }
        onClick={() => {
          if (!checkboxDisabled) onToggleDone(task.id, !done);
        }}
      >
        {done && <CheckIcon size={12} />}
      </button>

      <div
        className={styles.body}
        onDoubleClick={() => onEdit(task)}
        title="双击编辑"
      >
        <div className={styles.title}>{task.title}</div>
        {task.note.length > 0 && <div className={styles.note}>{task.note}</div>}
        <div className={styles.meta}>
          <span className={styles.badge}>{scheduleLabel}</span>
          {overdue && (
            <span className={`${styles.badge} ${styles.badgeExpired}`}>已过期</span>
          )}
          {daysAhead !== null && daysAhead > 0 && (
            <span className={`${styles.badge} ${styles.badgeCompletion}`}>
              提前 {daysAhead} 天完成
            </span>
          )}
          {daysAhead === 0 && (
            <span className={`${styles.badge} ${styles.badgeCompletion}`}>准时完成</span>
          )}
          <span className={styles.date}>起 {task.schedule.startDate}</span>
          {task.reminder.enabled && (
            <span className={`${styles.badge} ${styles.badgeReminder}`}>
              <BellIcon size={11} />
              {task.reminder.time}
            </span>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="编辑任务"
          title="编辑"
          onClick={() => onEdit(task)}
        >
          <EditIcon size={14} />
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.danger}`}
          aria-label="归档任务"
          title="归档"
          onClick={() => onRemove(task.id)}
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </li>
  );
});
