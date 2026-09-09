// 职责：长期任务预览页的单行 —— 复用 TaskItem 卡片视觉（@/components/TaskItem/TaskItem.module.css），
// 但按「预览页」语义展示：起始→结束区间、剩余/逾期天数、完成态文案，并提供勾选完成/编辑/归档。
// 与 DayMode 的 TaskItem 不同：这里没有「单日」概念，完成即置 completedAt（长期 DDL 的永久完成）。

import { memo } from "react";
import type { Task } from "@/types";
import { daysBetweenKeys } from "@/lib";
import { SCHEDULE_TYPE_LABELS } from "@/constants";
import { BellIcon, CheckIcon, EditIcon, TrashIcon } from "@/components/Icons";
import taskStyles from "@/components/TaskItem/TaskItem.module.css";
import styles from "./LongTermTaskRow.module.css";

export type LongTermTone = "pending" | "overdue" | "done";

interface LongTermTaskRowProps {
  task: Task;
  /** 当前分组色调：决定左侧色条与逾期徽标配色 */
  tone: LongTermTone;
  /** 今天日期键，用于计算剩余/逾期天数 */
  today: string;
  onToggleDone: (id: string, done: boolean) => void;
  onEdit: (task: Task) => void;
  onRemove: (id: string) => void;
}

/** 左侧状态色条按色调取色（显式映射，禁止动态拼接） */
const BAR_CLASS: Record<LongTermTone, string> = {
  pending: styles.bar_pending,
  overdue: styles.bar_overdue,
  done: styles.bar_done,
};

export const LongTermTaskRow = memo(function LongTermTaskRow({
  task,
  tone,
  today,
  onToggleDone,
  onEdit,
  onRemove,
}: LongTermTaskRowProps) {
  const isDone = task.completedAt != null;
  // endDate 为 null = 未指定截止日的长期任务：无紧迫性、无逾期，也不参与「提前/准时完成」计时
  const endDate = task.schedule.endDate;

  // 剩余 / 逾期天数（仅未完成时展示）；无截止日时只标注「无截止日」
  let daysText: string | null = null;
  if (!isDone) {
    if (endDate === null) {
      daysText = "无截止日";
    } else {
      const diff = daysBetweenKeys(today, endDate);
      if (tone === "overdue") {
        daysText = `已逾期 ${Math.max(1, -diff)} 天`;
      } else if (diff > 0) {
        daysText = `剩 ${diff} 天`;
      } else {
        daysText = "今天截止";
      }
    }
  }

  // 完成态文案：提前 / 准时 / 逾期后完成；无截止日时只有「已完成」
  let doneText: string | null = null;
  if (isDone && task.completedAt != null) {
    if (endDate === null) {
      doneText = "已完成";
    } else {
      const ahead = daysBetweenKeys(task.completedAt, endDate);
      if (ahead > 0) doneText = `提前 ${ahead} 天完成`;
      else if (ahead === 0) doneText = "准时完成";
      else doneText = "逾期后完成";
    }
  }

  const rowClasses = [taskStyles.row];
  if (isDone) rowClasses.push(taskStyles.done);

  return (
    <li className={rowClasses.join(" ")}>
      <span className={`${styles.bar} ${BAR_CLASS[tone]}`} aria-hidden="true" />
      <button
        type="button"
        className={taskStyles.checkbox}
        aria-pressed={isDone}
        aria-label={isDone ? "标记为未完成" : "标记为已完成"}
        title={isDone ? "标记为未完成" : "标记为已完成"}
        onClick={() => onToggleDone(task.id, !isDone)}
      >
        {isDone && <CheckIcon size={12} />}
      </button>

      <div className={taskStyles.body} onDoubleClick={() => onEdit(task)} title="双击编辑">
        <div className={taskStyles.title}>{task.title}</div>
        {task.note.length > 0 && <div className={taskStyles.note}>{task.note}</div>}
        <div className={taskStyles.meta}>
          <span className={taskStyles.badge}>{SCHEDULE_TYPE_LABELS[task.schedule.type]}</span>
          <span className={`${taskStyles.badge} ${styles.range}`}>
            {endDate === null
              ? `起 ${task.schedule.startDate}，无截止日`
              : `起 ${task.schedule.startDate} → 止 ${endDate}`}
          </span>
          {task.reminder.enabled && (
            <span className={`${taskStyles.badge} ${taskStyles.badgeReminder}`}>
              <BellIcon size={11} />
              {task.reminder.time}
            </span>
          )}
          {doneText !== null && (
            <span className={`${taskStyles.badge} ${taskStyles.badgeCompletion}`}>{doneText}</span>
          )}
          {daysText !== null && (
            <span
              className={`${taskStyles.badge} ${styles.days}${
                tone === "overdue" ? ` ${styles.days_overdue}` : ""
              }`}
            >
              {daysText}
            </span>
          )}
        </div>
      </div>

      <div className={taskStyles.actions}>
        <button
          type="button"
          className={taskStyles.iconButton}
          aria-label="编辑任务"
          title="编辑"
          onClick={() => onEdit(task)}
        >
          <EditIcon size={14} />
        </button>
        <button
          type="button"
          className={`${taskStyles.iconButton} ${taskStyles.danger}`}
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
