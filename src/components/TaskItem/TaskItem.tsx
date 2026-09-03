// 职责：单条任务行 —— 显示标题、备注、周期徽标、完成状态、操作图标。
// 交互：
// - 点击 checkbox 切换今日完成
// - 双击标题 / 点击右侧 ✎ 图标 → 触发 onEdit
// - 点击右侧 🗑 图标 → 触发 onRemove（语义为归档）
// - 已完成任务整体变灰、标题加删除线

import { memo } from "react";
import type { Task } from "@/types";
import { isDoneOn } from "@/lib";
import { SCHEDULE_TYPE_LABELS } from "@/constants";
import styles from "./TaskItem.module.css";

interface TaskItemProps {
  task: Task;
  /** 当前选中日期，YYYY-MM-DD */
  dateKey: string;
  onToggleDone: (id: string, done: boolean) => void;
  onEdit: (task: Task) => void;
  onRemove: (id: string) => void;
}

export const TaskItem = memo(function TaskItem({
  task,
  dateKey,
  onToggleDone,
  onEdit,
  onRemove,
}: TaskItemProps) {
  const done = isDoneOn(task, dateKey);
  const scheduleLabel = SCHEDULE_TYPE_LABELS[task.schedule.type];

  return (
    <li className={`${styles.row} ${done ? styles.done : ''}`}>
      <button
        type="button"
        className={styles.checkbox}
        aria-pressed={done}
        aria-label={done ? "标记为未完成" : "标记为已完成"}
        onClick={() => onToggleDone(task.id, !done)}
      >
        {done && <span aria-hidden="true">✓</span>}
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
          <span className={styles.date}>起 {task.schedule.startDate}</span>
          {task.reminder.enabled && (
            <span className={styles.badge}>🔔 {task.reminder.time}</span>
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
          ✎
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.danger}`}
          aria-label="归档任务"
          title="归档"
          onClick={() => onRemove(task.id)}
        >
          🗑
        </button>
      </div>
    </li>
  );
});