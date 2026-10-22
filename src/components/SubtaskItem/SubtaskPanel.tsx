// 职责：任务集的展开区 —— 子任务列表 + 拖拽排序 + 列表末尾的「+ 添加子任务」入口。
// 日清单的 TaskItem 与长期页的 LongTermTaskRow 共用这一份，
// 保证两个入口的展开区行为完全一致（同一套排序规则、同一套完成源）。
//
// 只渲染列表本身：进度条与展开箭头由外层行自己负责（收起时也要显示进度）。

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { TextInput } from "@mantine/core";
import { PlusIcon } from "@/components/Icons";
import { DeadlineSortControl } from "@/components/DeadlineSortControl/DeadlineSortControl";
import type { Task } from "@/types";
import {
  childTasksOf,
  formatShortMonthDay,
  sortSubtasksForDisplay,
  sortTasksByDimension,
  splitDoneAt,
  type NoDatePolicy,
  type SortDimension,
  type SortDirection,
  type SubtaskEdit,
  type TaskMap,
} from "@/lib";
import { useDragSort } from "@/hooks";
import { useSettingsStore } from "@/stores";
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
  /** 行内编辑单条子任务：改标题 / 备注 / 截止日；已完成行再加完成时刻 */
  onEditSubtask?: (parentId: string, childId: string, edit: SubtaskEdit) => void;
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
  onEditSubtask,
  onAddSubtask,
}: SubtaskPanelProps) {
  // 展示口径排序：未完成在前（保持 children 原序），已完成恒沉底
  const ordered = useMemo(() => sortSubtasksForDisplay(childTasksOf(map, parent)), [map, parent]);
  // 拖拽只在未完成区间内进行，已完成沉底是展示规则、不该被拖乱
  const draggable = useMemo(() => ordered.filter((child) => child.childDoneAt == null), [ordered]);
  const doneChildren = useMemo(
    () => ordered.filter((child) => child.childDoneAt != null),
    [ordered],
  );
  const doneIds = useMemo(() => doneChildren.map((child) => child.id), [doneChildren]);
  // 排序按钮可用性：未完成子任务 ≥ 2 才激活；「按截止」维度另需带截止期 ≥ 2（与主页同口径）
  const noDeadlineCount = draggable.filter((child) => child.schedule.endDate === null).length;
  const datedCount = draggable.length - noDeadlineCount;
  const sortDisabled = draggable.length < 2;
  const canSortByDeadline = datedCount >= 2;

  // 只重排未完成子任务（已完成恒沉底），按所选维度 / 方向（+ 无截止期归位策略）排出新顺序后落盘
  const handleSortSubtasks = (
    dimension: SortDimension,
    direction: SortDirection,
    policy: NoDatePolicy,
  ) => {
    const sorted = sortTasksByDimension(draggable, dimension, direction, policy);
    onReorderSubtasks(parent.id, [...sorted.map((child) => child.id), ...doneIds]);
  };
  // 折叠时保留「最近完成的 keep 条」，更早完成的隐藏。keep 来自设置（默认 5，用户可配）；
  // 已完成数不超过 keep 时返回 null 表示不隐藏任何。
  const keep = useSettingsStore((s) => s.settings.subtaskDoneKeep);
  const recentDoneIds = useMemo(() => {
    if (doneChildren.length <= keep) return null;
    const keepSet = new Set(
      [...doneChildren]
        .sort((a, b) => (b.childDoneAt ?? "").localeCompare(a.childDoneAt ?? ""))
        .slice(0, keep)
        .map((c) => c.id),
    );
    return keepSet;
  }, [doneChildren, keep]);
  // 折叠节点上的时间跨度：被收起的那些较早完成项，从最早到最晚的月日区间（如「9/16 – 9/18」）。
  // 只统计被隐藏的部分，不含保留在列表里的最近 keep 条。
  const hiddenRange = useMemo(() => {
    if (recentDoneIds === null) return null;
    const keys = doneChildren
      .filter((child) => !recentDoneIds.has(child.id))
      .map((child) => splitDoneAt(child.childDoneAt)?.dateKey)
      .filter((key): key is string => typeof key === "string")
      .sort();
    if (keys.length === 0) return null;
    const first = keys[0];
    const last = keys[keys.length - 1];
    return first === last
      ? formatShortMonthDay(first)
      : `${formatShortMonthDay(first)} – ${formatShortMonthDay(last)}`;
  }, [doneChildren, recentDoneIds]);

  const { listRef, getHandle } = useDragSort(draggable, (ids) => {
    onReorderSubtasks(parent.id, [...ids, ...doneIds]);
  });

  const doneCount = doneIds.length;
  const over = doneCount > keep;
  // 初始：已完成超过 keep 条默认折叠。之后是否折叠由用户切换控制；
  // 但「跨过阈值（≤keep → >keep）」的瞬间立即折叠，不必等父任务重新展开才生效。
  // 阈值本身也可在设置里改小，同样会立即生效。
  const [collapsed, setCollapsed] = useState(over);
  const wasOver = useRef(over);
  useEffect(() => {
    if (over && !wasOver.current) {
      setCollapsed(true);
    }
    wasOver.current = over;
  }, [over]);

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
      {/* 待勾选子任务（未完成，可拖拽排序） */}
      {draggable.map((child) => {
        const index = runningIndex++;
        return (
          <SubtaskItem
            key={child.id}
            task={child}
            dateKey={dateKey}
            parentStart={parent.schedule.startDate}
            parentEnd={parent.schedule.endDate}
            disabledDone={disabledDone}
            // 置顶：把这一条提到 children 首位即可 —— 展示排序是「未完成按 children 原序、
            // 已完成恒沉底」，所以提到首位就等于未完成区的顶部，其余条目顺序不变。
            onPinTop={() => onReorderSubtasks(parent.id, [child.id])}
            onToggleDone={(childId, done) => onToggleSubtask(parent.id, childId, done)}
            onRemove={(childId) => onRemoveSubtask(parent.id, childId)}
            onEdit={
              onEditSubtask !== undefined
                ? (childId, edit) => onEditSubtask(parent.id, childId, edit)
                : undefined
            }
            drag={getHandle(index)}
          />
        );
      })}
      {/* 折叠节点置于「待勾选」与「已勾选」之间：它本身就是时间轴上的一个虚线节点，
          被收起的较早完成项从它下方展开，视觉上就是「中间那一段被收拢了」。 */}
      {over && (
        <li>
          <button
            type="button"
            className={styles.collapseDone}
            onClick={() => setCollapsed((v) => !v)}
          >
            <span className={`${styles.rail} ${styles.railDashed}`} aria-hidden="true" />
            <span className={styles.collapseText}>
              {hiddenRange === null
                ? `${doneCount - keep} 条较早完成`
                : `${hiddenRange} · ${doneCount - keep} 条较早完成`}
            </span>
            <span className={styles.collapseAction}>{collapsed ? "展开" : "收起"}</span>
          </button>
        </li>
      )}
      {/* 已勾选子任务（已完成，沉底且不可拖拽；折叠态隐藏超出最近 keep 条的旧项目） */}
      {doneChildren.map((child) => {
        if (collapsed && recentDoneIds !== null && !recentDoneIds.has(child.id)) {
          return null;
        }
        return (
          <SubtaskItem
            key={child.id}
            task={child}
            dateKey={dateKey}
            parentStart={parent.schedule.startDate}
            parentEnd={parent.schedule.endDate}
            disabledDone={disabledDone}
            // 已勾选的子任务由 SubtaskItem 内部判掉「置顶」，这里只管把闭包给足，
            // 免得同一份列表出现两种传参写法。
            onPinTop={() => onReorderSubtasks(parent.id, [child.id])}
            onToggleDone={(childId, done) => onToggleSubtask(parent.id, childId, done)}
            onRemove={(childId) => onRemoveSubtask(parent.id, childId)}
            onEdit={
              onEditSubtask !== undefined
                ? (childId, edit) => onEditSubtask(parent.id, childId, edit)
                : undefined
            }
            drag={undefined}
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
          <div className={styles.sortRow}>
            <button type="button" className={styles.addToggle} onClick={startAdding}>
              <PlusIcon size={14} />
              添加子任务
            </button>
            <span className={styles.sortDivider} aria-hidden="true" />
            <DeadlineSortControl
              variant="inline"
              disabled={sortDisabled}
              canSortByDeadline={canSortByDeadline}
              hasUndated={noDeadlineCount > 0}
              undatedCount={noDeadlineCount}
              onSort={handleSortSubtasks}
            />
          </div>
        )}
      </li>
    </ul>
  );
}
