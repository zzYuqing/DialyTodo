// 职责：任务集的展开区 —— 子任务列表 + 拖拽排序 + 列表末尾的「+ 添加子任务」入口。
// 日清单的 TaskItem 与长期页的 LongTermTaskRow 共用这一份，
// 保证两个入口的展开区行为完全一致（同一套排序规则、同一套完成源）。
//
// 只渲染列表本身：进度条与展开箭头由外层行自己负责（收起时也要显示进度）。

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { TextInput } from "@mantine/core";
import { PlusIcon } from "@/components/Icons";
import type { Task } from "@/types";
import { childTasksOf, sortSubtasksForDisplay, type TaskMap } from "@/lib";
import { useDragSort } from "@/hooks";
import { SubtaskItem } from "./SubtaskItem";
import styles from "./SubtaskItem.module.css";

interface SubtaskPanelProps {
  /** 父任务（任务集） */
  parent: Task;
  /** id → task 索引，由外层统一构建 */
  map: TaskMap;
  dateKey: string;
  disabledDone?: boolean;
  onToggleSubtask: (parentId: string, childId: string, done: boolean) => void;
  onRemoveSubtask: (parentId: string, childId: string) => void;
  onReorderSubtasks: (parentId: string, ids: string[]) => void;
  /** 列表末尾「+ 添加子任务」入口提交时调用 */
  onAddSubtask: (parentId: string, title: string) => void;
}

export function SubtaskPanel({
  parent,
  map,
  dateKey,
  disabledDone = false,
  onToggleSubtask,
  onRemoveSubtask,
  onReorderSubtasks,
  onAddSubtask,
}: SubtaskPanelProps) {
  // 展示口径排序：未完成在前（保持 children 原序），已完成恒沉底
  const ordered = useMemo(() => sortSubtasksForDisplay(childTasksOf(map, parent)), [map, parent]);
  // 拖拽只在未完成区间内进行，已完成沉底是展示规则、不该被拖乱
  const draggable = useMemo(() => ordered.filter((child) => child.childDoneAt == null), [ordered]);
  const doneIds = useMemo(
    () => ordered.filter((child) => child.childDoneAt != null).map((child) => child.id),
    [ordered],
  );

  const { listRef, getHandle } = useDragSort(draggable, (ids) => {
    onReorderSubtasks(parent.id, [...ids, ...doneIds]);
  });

  // 「+ 添加子任务」入口的折叠态：true = 显示输入框，false = 显示按钮。
  // 提交后保持输入框激活，便于连续录入多条子任务；ESC 收起，失焦也收起。
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // adding 切到 true 时聚焦输入框。useEffect 在 DOM 挂载后跑，能稳定拿到节点。
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed.length > 0) {
      onAddSubtask(parent.id, trimmed);
    }
    setDraft("");
    // 留在 adding=true，连续录入下一条
  };

  const cancel = () => {
    setDraft("");
    setAdding(false);
  };

  const startAdding = () => setAdding(true);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  let runningIndex = 0;

  return (
    <ul className={styles.panel} ref={listRef}>
      {ordered.length === 0 && (
        <li className={styles.empty}>这个任务集还没有子任务，直接下方输入</li>
      )}
      {ordered.map((child) => {
        const canDrag = child.childDoneAt == null;
        const index = canDrag ? runningIndex++ : -1;
        return (
          <SubtaskItem
            key={child.id}
            task={child}
            dateKey={dateKey}
            disabledDone={disabledDone}
            onToggleDone={(childId, done) => onToggleSubtask(parent.id, childId, done)}
            onRemove={(childId) => onRemoveSubtask(parent.id, childId)}
            drag={canDrag ? getHandle(index) : undefined}
          />
        );
      })}
      <li>
        {adding ? (
          <div className={styles.addForm}>
            <TextInput
              ref={inputRef}
              className={styles.addInput}
              size="xs"
              placeholder="子任务标题，回车提交"
              value={draft}
              maxLength={120}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              onBlur={cancel}
            />
          </div>
        ) : (
          <button type="button" className={styles.addToggle} onClick={startAdding}>
            <PlusIcon size={14} />
            添加子任务
          </button>
        )}
      </li>
    </ul>
  );
}
