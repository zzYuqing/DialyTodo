// 职责：长期任务预览页的单行 —— 复用 TaskItem 卡片视觉（@/components/TaskItem/TaskItem.module.css），
// 但按「预览页」语义展示：起始→结束区间、剩余/逾期天数、完成态文案，并提供勾选完成/编辑/删除。
// 与 DayMode 的 TaskItem 不同：这里没有「单日」概念，完成即置 completedAt（长期 DDL 的永久完成）。

import { memo, useCallback, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { CompositeTarget, Task } from "@/types";
import {
  daysBetweenKeys,
  describeSchedule,
  isComposite,
  subtaskProgressOf,
  type TaskMap,
} from "@/lib";
import {
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  EditIcon,
  TrashIcon,
} from "@/components/Icons";
import { SubtaskPanel } from "@/components/SubtaskItem/SubtaskPanel";
import {
  ATTACH_ITEM_PREFIX,
  RowContextMenu,
  type ContextMenuGroup,
} from "@/components/RowContextMenu/RowContextMenu";
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

  // ── 复合任务（任务集）专属 ──
  taskMap?: TaskMap;
  expanded?: boolean;
  onToggleExpand?: (id: string) => void;
  onToggleSubtask?: (parentId: string, childId: string, done: boolean) => void;
  onRemoveSubtask?: (parentId: string, childId: string) => void;
  onReorderSubtasks?: (parentId: string, ids: string[]) => void;
  /** 列表末尾「+ 添加子任务」入口提交时调用 */
  onAddSubtask?: (parentId: string, title: string) => void;
  /** 右键菜单里可收编本行的任务集；省略则不显示「添加到任务集」分组 */
  compositeTargets?: CompositeTarget[];
  /** 右键「添加到任务集 → 某个任务集」 */
  onAttachToComposite?: (childId: string, parentId: string) => void;
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
  taskMap,
  expanded = false,
  onToggleExpand,
  onToggleSubtask,
  onRemoveSubtask,
  onReorderSubtasks,
  onAddSubtask,
  compositeTargets,
  onAttachToComposite,
}: LongTermTaskRowProps) {
  // 复合任务：完成态由子任务推导，行本身不可直接勾选，改由展开区逐条操作。
  // 提前到最前：右键菜单分组也要用它决定「是否显示添加到任务集」。
  const composite = isComposite(task);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const handleContextMenu = (event: ReactMouseEvent<HTMLLIElement>) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const handleMenuSelect = (itemId: string) => {
    setMenu(null);
    if (itemId === "edit") {
      onEdit(task);
      return;
    }
    if (itemId === "archive") {
      onRemove(task.id);
      return;
    }
    if (itemId.startsWith(ATTACH_ITEM_PREFIX)) {
      onAttachToComposite?.(task.id, itemId.slice(ATTACH_ITEM_PREFIX.length));
    }
  };

  const menuGroups: ContextMenuGroup[] = [
    {
      title: "任务",
      items: [
        { id: "edit", label: "编辑" },
        { id: "archive", label: composite ? "删除任务集及其子任务" : "删除", danger: true },
      ],
    },
  ];
  if (!composite && compositeTargets !== undefined) {
    menuGroups.push({
      title: "添加到任务集",
      empty: "还没有任务集",
      items: compositeTargets.map((target) => {
        const current = task.parentId === target.id;
        return {
          id: `${ATTACH_ITEM_PREFIX}${target.id}`,
          label: target.title,
          ...(current ? { hint: "当前所属", checked: true, disabled: true } : {}),
        };
      }),
    });
  }

  const isDone = task.completedAt != null;
  const progress = composite && taskMap !== undefined ? subtaskProgressOf(taskMap, task) : null;
  const showExpand = composite && expanded;
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
  if (composite) rowClasses.push(taskStyles.compositeRow);

  return (
    <li className={rowClasses.join(" ")} onContextMenu={handleContextMenu}>
      <span className={`${styles.bar} ${BAR_CLASS[tone]}`} aria-hidden="true" />
      {composite && (
        <button
          type="button"
          className={`${taskStyles.expandButton} ${expanded ? taskStyles.expandButtonOpen : ""}`}
          aria-expanded={expanded}
          aria-label={expanded ? "收起子任务" : "展开子任务"}
          title={expanded ? "收起子任务" : "展开子任务"}
          onClick={() => onToggleExpand?.(task.id)}
        >
          <ChevronRightIcon size={12} />
        </button>
      )}
      {/* 父任务（任务集）不渲染勾选圆圈：完成态由子任务推导，行本身不可直接勾选。
          普通任务在此保留圆圈，是长期任务页的主要交互入口。 */}
      {!composite && (
        <button
          type="button"
          className={taskStyles.checkbox}
          aria-pressed={isDone}
          aria-label={isDone ? "标记为未完成" : "标记为已完成"}
          title={isDone ? "标记为未完成" : "标记为已完成"}
          onClick={() => {
            onToggleDone(task.id, !isDone);
          }}
        >
          {isDone && <CheckIcon size={12} />}
        </button>
      )}

      <div className={taskStyles.body} onDoubleClick={() => onEdit(task)} title="双击编辑">
        <div className={taskStyles.title}>{task.title}</div>
        {task.note.length > 0 && <div className={taskStyles.note}>{task.note}</div>}
        <div className={taskStyles.meta}>
          {/* 周期徽标：weekly 具体到星期（如「每周一、五」），其余类型用常量表文案。
              「仅一次」在长期任务页恒成立（全是一次性任务），徽章会刷屏，直接过滤掉不渲染。 */}
          {task.schedule.type !== "once" && (
            <span className={taskStyles.badge}>{describeSchedule(task.schedule)}</span>
          )}
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
          {progress !== null && (
            <span className={taskStyles.progressBadge}>
              {progress.done}/{progress.total}
            </span>
          )}
        </div>
        {progress !== null && (
          <div className={taskStyles.progressRow}>
            <span className={taskStyles.progressTrack}>
              <span
                className={taskStyles.progressFill}
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
              />
            </span>
          </div>
        )}
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
          aria-label={composite ? "删除任务集及其全部子任务" : "删除任务"}
          title={composite ? "删除任务集及其全部子任务" : "删除"}
          onClick={() => onRemove(task.id)}
        >
          <TrashIcon size={14} />
        </button>
      </div>

      {showExpand && taskMap !== undefined && (
        <div className={taskStyles.expand}>
          <SubtaskPanel
            parent={task}
            map={taskMap}
            dateKey={today}
            onToggleSubtask={onToggleSubtask ?? (() => undefined)}
            onRemoveSubtask={onRemoveSubtask ?? (() => undefined)}
            onReorderSubtasks={onReorderSubtasks ?? (() => undefined)}
            onAddSubtask={onAddSubtask ?? (() => undefined)}
          />
        </div>
      )}

      {menu !== null && (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          groups={menuGroups}
          onSelect={handleMenuSelect}
          onClose={closeMenu}
        />
      )}
    </li>
  );
});
