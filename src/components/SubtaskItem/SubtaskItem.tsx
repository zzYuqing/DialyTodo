// 职责：任务集展开区里的单条子任务行。
// 与 TaskItem 的关键差别（也是它单独一个文件的原因）：
// - 完成状态来源是 childDoneAt 而不是 instances —— 子任务不参与日清单
//   的 top-level 完成记录、完成率、贡献墙、DDL 提示任何一条既有链路；
// - 不显示周期徽标（恒为 once）、不显示提醒（提醒只在父任务上）；
// - 多一个「从任务集删除」操作 —— 删除单个子任务必须连带从数组里移除，
//   否则它会因为"没有任何父收录它"而降级回普通任务，重新冒到日清单顶层。

import { memo, useState } from "react";
import type { Task } from "@/types";
import { formatDoneAt, formatMonthDay, subtaskUrgencyOf, type SubtaskUrgency } from "@/lib";
import { CheckIcon, GripIcon, NoteIcon, TrashIcon, ChevronRightIcon } from "@/components/Icons";
import type { DragSortItemHandle } from "@/hooks";
import styles from "./SubtaskItem.module.css";

// 紧迫度档位 → className 的显式映射，禁止 styles[`x${y}`] 动态拼接
const URGENCY_CLASS: Record<Exclude<SubtaskUrgency, null>, string> = {
  overdue: styles.toneOverdue,
  today: styles.toneToday,
  soon: styles.toneSoon,
  none: styles.toneNone,
};

/** 按视觉宽度估算备注是否足够短：中文字符/全角按 1 计，ASCII/半角按 0.5 计。
 * 阈值 18 约对应 80% 宽度胶囊（11px 字体）的单行容量；够短就不需要展开按钮。 */
const noteVisualWidth = (text: string): number => {
  let w = 0;
  for (const char of text) {
    w += char.charCodeAt(0) > 127 ? 1 : 0.5;
  }
  return w;
};

interface SubtaskItemProps {
  task: Task;
  /** 当前选中日期，YYYY-MM-DD。紧迫度以此为基准 */
  dateKey: string;
  /** 未来日期下禁用勾选 */
  disabledDone?: boolean;
  onToggleDone: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
  /** 拖拽句柄；省略表示本行不参与排序（已完成的子任务） */
  drag?: DragSortItemHandle;
}

export const SubtaskItem = memo(function SubtaskItem({
  task,
  dateKey,
  disabledDone = false,
  onToggleDone,
  onRemove,
  drag,
}: SubtaskItemProps) {
  const done = task.childDoneAt != null;
  // 备注胶囊仅在「未完成且有备注」时出现：完成行按方案 C 保持原样（不改写已完成态视觉），
  // 无备注行不渲染任何气泡（用户明确要求：没备注就不显示空气泡）。
  const hasNote = !done && task.note.trim().length > 0;
  const noteShort = hasNote && noteVisualWidth(task.note) <= 18;
  const [noteOpen, setNoteOpen] = useState(false);
  const urgency = subtaskUrgencyOf(task, dateKey);
  const endDate = task.schedule.endDate;
  // 完成时间徽章文案：优先用 childDoneAt（ISO 时刻）格式化为「9月5日 14:30」，
  // 兜底用 endDate（仅日期）的月日文案，再不行就只显示「已完成」。
  const doneText = done
    ? (formatDoneAt(task.childDoneAt) ?? (endDate !== null ? `${formatMonthDay(endDate)}完成` : "已完成"))
    : null;

  const classes = [styles.row];
  if (done) classes.push(styles.done);
  if (drag !== undefined) classes.push(styles.draggable);
  if (drag?.dragging === true) classes.push(styles.dragging);
  if (drag?.dropHint === "above") classes.push(styles.dropAbove);
  if (drag?.dropHint === "below") classes.push(styles.dropBelow);

  const checkboxDisabled = disabledDone;

  return (
    <li
      className={classes.join(" ")}
      style={drag?.dragging === true
        ? { transform: `translateY(${drag.offsetY}px) scale(0.9)` }
        : undefined}
      onPointerDown={(event) => {
        // 必须始终阻止冒泡：展开区嵌在父任务行的 <li> 里，
        // 否则哪怕是不参与拖拽的已完成行，也会带着父列表一起开始拖。
        event.stopPropagation();
        if (drag === undefined) return;
        drag.onPointerDown(drag.index, event);
      }}
    >
      {drag !== undefined ? (
        <span className={styles.grip} aria-hidden="true">
          <GripIcon size={12} />
        </span>
      ) : (
        <span className={styles.gripPlaceholder} aria-hidden="true" />
      )}

      <button
        type="button"
        className={styles.checkbox}
        aria-pressed={done}
        aria-disabled={checkboxDisabled}
        disabled={checkboxDisabled}
        aria-label={done ? "标记为未完成" : "标记为已完成"}
        title={disabledDone ? "未来日期暂不可勾选完成" : undefined}
        // 勾选是点按交互，必须拦住 pointerdown 冒泡到行级拖拽，否则 click 会被拖拽手势吞掉
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          if (!checkboxDisabled) onToggleDone(task.id, !done);
        }}
      >
        {done && <CheckIcon size={11} />}
      </button>

      <div className={styles.main}>
        <div className={styles.body}>
          <span className={styles.title}>{task.title}</span>
          <span className={styles.meta}>
            {endDate === null ? (
              <span className={styles.noDate}>无截止日</span>
            ) : (
              <span className={`${styles.due} ${URGENCY_CLASS[urgency ?? "none"]}`}>
                {urgency === "today" ? "今天截止" : `截止 ${formatMonthDay(endDate)}`}
              </span>
            )}
            {done && doneText !== null && <span className={styles.doneBadge}>{doneText}</span>}
          </span>
        </div>
        {hasNote && (
          noteShort ? (
            <span className={`${styles.notePill} ${styles.notePillStatic}`}>
              <span className={styles.noteIcon}>
                <NoteIcon size={11} />
              </span>
              <span className={styles.noteText}>{task.note}</span>
            </span>
          ) : (
            <button
              type="button"
              className={`${styles.notePill} ${noteOpen ? styles.notePillOpen : ""}`}
              aria-expanded={noteOpen}
              aria-label={noteOpen ? "收起备注" : "展开备注"}
              onClick={() => setNoteOpen((v) => !v)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className={styles.noteIcon}>
                <NoteIcon size={11} />
              </span>
              <span className={noteOpen ? styles.noteTextOpen : styles.noteText}>{task.note}</span>
              <span className={noteOpen ? styles.noteChevronOpen : styles.noteChevron}>
                <ChevronRightIcon size={10} />
              </span>
            </button>
          )
        )}
      </div>

      <button
        type="button"
        className={styles.remove}
        aria-label="从任务集删除"
        title="从任务集删除"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onRemove(task.id)}
      >
        <TrashIcon size={12} />
      </button>
    </li>
  );
});
