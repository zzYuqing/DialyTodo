// 职责：任务集展开区里的单条子任务行。
// 与 TaskItem 的关键差别（也是它单独一个文件的原因）：
// - 完成状态来源是 childDoneAt 而不是 instances —— 子任务不参与日清单
//   的 top-level 完成记录、完成率、贡献墙、DDL 提示任何一条既有链路；
// - 不显示周期徽标（恒为 once）、不显示提醒（提醒只在父任务上）；
// - 多一个「从任务集删除」操作 —— 删除单个子任务必须连带从数组里移除，
//   否则它会因为"没有任何父收录它"而降级回普通任务，重新冒到日清单顶层。
// - 行内可「编辑」：点铅笔图标就地展开表单，改标题 / 备注 / 截止日（与编辑弹窗的子任务块同口径）；
//   已勾选完成的行标题与截止日只读，但完成时刻可手动修正 —— 右键「修改完成时间」直达同一张表单。
// - 右键菜单：复制标题（所有行）+ 修改完成时间（仅已完成行）。

import { memo, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Textarea, TextInput } from "@mantine/core";
import type { Task } from "@/types";
import {
  formatDoneAt,
  formatMonthDay,
  joinDoneAt,
  nowIso,
  splitDoneAt,
  subtaskUrgencyOf,
  type SubtaskEdit,
  type SubtaskUrgency,
} from "@/lib";
import {
  CheckIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  GripIcon,
  NoteIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/Icons";
import { RowContextMenu, type ContextMenuGroup } from "@/components";
import { CollapsibleNote } from "@/components/CollapsibleNote/CollapsibleNote";
import { useSettingsStore } from "@/stores";
import type { DragSortItemHandle } from "@/hooks";
import styles from "./SubtaskItem.module.css";

/** 复制文本到剪贴板：优先 Clipboard API（tauri / web 安全上下文均可用），失败回退 execCommand。 */
const copyToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* 极端环境复制失败，静默处理 */
    }
    document.body.removeChild(ta);
  }
};

// 紧迫度档位 → className 的显式映射，禁止 styles[`x${y}`] 动态拼接
const URGENCY_CLASS: Record<Exclude<SubtaskUrgency, null>, string> = {
  overdue: styles.toneOverdue,
  today: styles.toneToday,
  soon: styles.toneSoon,
  none: styles.toneNone,
};

/** 行内表单草稿：SubtaskEdit + 完成时刻的两个本地输入值（date / time 输入框只认真实值） */
interface EditDraft extends SubtaskEdit {
  /** YYYY-MM-DD */
  doneDate: string;
  /** HH:mm */
  doneTime: string;
}

/** 由任务派生草稿。打开编辑时初始化，避免残留上一次的值 */
const draftOf = (task: Task): EditDraft => {
  const doneParts = splitDoneAt(task.childDoneAt);
  return {
    title: task.title,
    note: task.note,
    endDate: task.schedule.endDate,
    doneDate: doneParts?.dateKey ?? "",
    doneTime: doneParts?.time ?? "",
  };
};

interface SubtaskItemProps {
  task: Task;
  /** 当前选中日期，YYYY-MM-DD。紧迫度以此为基准 */
  dateKey: string;
  /** 父任务的整体起始日，作为子任务截止日的下限与「+ 截止」默认值 */
  parentStart: string;
  /** 父任务的整体截止日；非 null 时子任务截止日必填、不可清除 */
  parentEnd: string | null;
  /** 未来日期下禁用勾选 */
  disabledDone?: boolean;
  onToggleDone: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
  /** 行内编辑提交：标题 / 备注 / 截止日；已完成行另带修改后的完成时刻 */
  onEdit?: (id: string, edit: SubtaskEdit) => void;
  /** 拖拽句柄；省略表示本行不参与排序（已完成的子任务） */
  drag?: DragSortItemHandle;
}

export const SubtaskItem = memo(function SubtaskItem({
  task,
  dateKey,
  parentStart,
  parentEnd,
  disabledDone = false,
  onToggleDone,
  onRemove,
  onEdit,
  drag,
}: SubtaskItemProps) {
  const done = task.childDoneAt != null;
  // 已勾选完成的子任务：标题与截止日锁定只读，只放开备注与完成时刻（手动修正），
  // 与编辑弹窗的 doneLocked 一致 —— 防止「已完成」状态被改标题/截止日造成历史完成态对不上的语义漂移。
  const doneLocked = done;
  // 父有整体截止日时子任务截止日必填，不允许清除（与编辑弹窗的 endDateLocked 一致）。
  const endLocked = parentEnd !== null;
  // 备注折叠行数：来自设置，改后立即生效（CollapsibleNote 据此决定是否截断）。
  const noteCollapseLines = useSettingsStore((s) => s.settings.noteCollapseLines);
  const urgency = subtaskUrgencyOf(task, dateKey);
  const endDate = task.schedule.endDate;
  // 完成时间徽章文案：优先用 childDoneAt（ISO 时刻）格式化为「9月5日 14:30」，
  // 兜底用 endDate（仅日期）的月日文案，再不行就只显示「已完成」。
  const doneText = done
    ? (formatDoneAt(task.childDoneAt) ?? (endDate !== null ? `${formatMonthDay(endDate)}完成` : "已完成"))
    : null;
  // 完成时间输入的上限 = 当前时刻。封顶规则在 lib/composite 的 applyDoneAtEdit，
  // 这里只是让原生选择器不给用户挑未来时刻的机会。nowIso 必然可解析，?. 仅兜返回类型。
  const doneCap = splitDoneAt(nowIso());

  // ── 行内编辑态 ──
  const [editing, setEditing] = useState(false);
  // 右键菜单：所有条目可「复制标题」，已完成的条目再加一项「修改完成时间」
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<EditDraft>(() => draftOf(task));
  const startEdit = () => {
    setDraft(draftOf(task));
    setEditing(true);
  };
  const canSave = draft.title.trim().length > 0;
  const commitEdit = () => {
    if (!canSave) return;
    // 完成时刻只在已完成行提交（未完成行根本不渲染这两个输入框）。
    // 输入不完整时 joinDoneAt 返回 null → 省略该字段 = 保留原时刻，不会把时刻写坏。
    const doneAt = done ? joinDoneAt(draft.doneDate, draft.doneTime) : null;
    onEdit?.(task.id, {
      title: draft.title,
      note: draft.note,
      endDate: draft.endDate,
      ...(doneAt === null ? {} : { childDoneAt: doneAt }),
    });
    setEditing(false);
  };
  const cancelEdit = () => setEditing(false);
  // 备注是多行字段：Enter 换行（textarea 默认行为），仅 Esc 保留「取消编辑」。
  const handleNoteKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  };
  const handleEditKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  };

  // 右键菜单分组：只有一个动作组，故不给分组标题（省略 title 即不渲染标题行）。
  // 「修改完成时间」只在已勾选的行出现 —— 未完成的条目还没有完成时刻。
  const menuGroups: ContextMenuGroup[] = [
    {
      items: [
        { id: "copy-title", label: "复制标题" },
        ...(done ? [{ id: "edit-done-at", label: "修改完成时间" }] : []),
      ],
    },
  ];

  const classes = [styles.row];
  if (done) classes.push(styles.done);
  if (drag !== undefined) classes.push(styles.draggable);
  if (drag?.dragging === true) classes.push(styles.dragging);
  if (drag?.dropHint === "above") classes.push(styles.dropAbove);
  if (drag?.dropHint === "below") classes.push(styles.dropBelow);

  const checkboxDisabled = disabledDone || editing;

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
        // 编辑态下整行不参与拖拽（输入框命中测试交给浏览器）。
        if (drag === undefined || editing) return;
        drag.onPointerDown(drag.index, event);
      }}
      onContextMenu={(event: ReactMouseEvent<HTMLLIElement>) => {
        // 阻止冒泡到父 TaskItem 的右键菜单：子任务嵌在父行展开区里，
        // 否则会同时弹出父任务的「编辑 / 删除 / 添加到任务集」。
        event.preventDefault();
        event.stopPropagation();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {/* 已完成条目是完成时间轴上的一个节点：渲染轴与圆点，未完成条目不占用轴区 */}
      {done && <span className={styles.rail} aria-hidden="true" />}
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
        {editing ? (
          <div className={styles.editForm}>
            <div className={styles.editLine}>
              <TextInput
                className={styles.editTitle}
                placeholder="子任务标题"
                value={draft.title}
                maxLength={120}
                readOnly={doneLocked}
                // 已完成行的标题只读，焦点让给完成时间输入框（右键「修改完成时间」的落点就是那里）
                autoFocus={!doneLocked}
                onChange={(e) => {
                  // 必须在事件处理函数内同步读出值：setDraft 的函数式 updater 会被延后执行，
                  // 那时 e.currentTarget 已被 DOM 复位为 null，再读 .value 会抛
                  // "Cannot read properties of null (reading 'value')"。
                  const next = e.currentTarget.value;
                  setDraft((d) => ({ ...d, title: next }));
                }}
                onKeyDown={handleEditKey}
                onPointerDown={(e) => e.stopPropagation()}
              />
              {/* 截止日：未设置 = 虚线胶囊，点一下设为父起始日；
                  已设置 = 浅绿胶囊内嵌无边框日期输入 + 清除键。
                  父有整体截止日时不允许清除（endLocked），已勾选完成的行整体只读（doneLocked）。 */}
              {draft.endDate === null ? (
                <button
                  type="button"
                  className={styles.dueAdd}
                  disabled={doneLocked}
                  onClick={() => setDraft((d) => ({ ...d, endDate: parentStart }))}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <PlusIcon size={11} />
                  截止
                </button>
              ) : (
                <div className={styles.dueSet}>
                  <TextInput
                    type="date"
                    size="xs"
                    variant="unstyled"
                    className={styles.dueInput}
                    value={draft.endDate}
                    readOnly={doneLocked}
                    onChange={(e) => {
                      // 同步读出，避免 updater 延后执行时 e.currentTarget 已被复位为 null
                      const next = e.currentTarget.value || null;
                      setDraft((d) => ({ ...d, endDate: next }));
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                  {!endLocked && !doneLocked && (
                    <button
                      type="button"
                      className={styles.dueClear}
                      aria-label="清除截止日"
                      title="清除截止日"
                      onClick={() => setDraft((d) => ({ ...d, endDate: null }))}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <CloseIcon size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
            {/* 完成时间：仅已完成的行出现（右键「修改完成时间」或点铅笔进入编辑）。
                手动回填用，上限为当前时刻；未完成的行没有「完成时刻」这个概念，故不渲染。 */}
            {done && (
              <div className={styles.editDoneAt}>
                <span className={styles.fieldIcon}>
                  <ClockIcon size={11} />
                </span>
                <TextInput
                  type="date"
                  variant="unstyled"
                  size="xs"
                  className={styles.doneDateInput}
                  value={draft.doneDate}
                  max={doneCap?.dateKey}
                  autoFocus={doneLocked}
                  onChange={(e) => {
                    // 同步读出，避免 updater 延后执行时 e.currentTarget 已被复位为 null
                    const next = e.currentTarget.value;
                    setDraft((d) => ({ ...d, doneDate: next }));
                  }}
                  onKeyDown={handleEditKey}
                  onPointerDown={(e) => e.stopPropagation()}
                />
                <TextInput
                  type="time"
                  variant="unstyled"
                  size="xs"
                  className={styles.doneTimeInput}
                  value={draft.doneTime}
                  // 只有日期就是今天时才限制时间上限，选过去某天则 00:00-23:59 全放开
                  max={draft.doneDate === doneCap?.dateKey ? doneCap?.time : undefined}
                  onChange={(e) => {
                    // 同步读出，避免 updater 延后执行时 e.currentTarget 已被复位为 null
                    const next = e.currentTarget.value;
                    setDraft((d) => ({ ...d, doneTime: next }));
                  }}
                  onKeyDown={handleEditKey}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              </div>
            )}
            <div className={styles.editNote}>
              <span className={styles.fieldIcon}>
                <NoteIcon size={11} />
              </span>
              <Textarea
                variant="unstyled"
                size="xs"
                className={styles.editNoteInput}
                placeholder="备注（可选）"
                value={draft.note}
                onChange={(e) => {
                  // 同步读出，避免 updater 延后执行时 e.currentTarget 已被复位为 null
                  const next = e.currentTarget.value;
                  setDraft((d) => ({ ...d, note: next }));
                }}
                onKeyDown={handleNoteKey}
                onPointerDown={(e) => e.stopPropagation()}
                autosize
                minRows={1}
                maxRows={4}
              />
            </div>
            {doneLocked && (
              <div className={styles.doneHint}>已勾选完成：标题与截止日不可改，完成时间可修正</div>
            )}
          </div>
        ) : (
          <>
            <div className={styles.body}>
              {/* 标题：单行省略号保持行布局紧凑；原生 title 让鼠标悬停时浮出完整标题，
                  避免过长标题被硬截断后无从查看（对应「悬浮显示全标题文本」）。 */}
              <span className={styles.title} title={task.title}>
                {task.title}
              </span>
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
            {/* 备注仅在「未完成且有备注」时出现：完成行保持原样（不改写已完成态视觉），
                无备注行不渲染任何气泡。超出 noteCollapseLines 行的备注由 CollapsibleNote 折叠。
                短备注（未溢出）以静态胶囊呈现，不显示展开箭头。 */}
            {!done && task.note.trim().length > 0 && (
              <CollapsibleNote text={task.note} maxLines={noteCollapseLines} variant="pill" />
            )}
          </>
        )}
      </div>

      {editing ? (
        <div className={styles.editActions}>
          <button
            type="button"
            className={`${styles.editSave} ${canSave ? "" : styles.editSaveDisabled}`}
            aria-label="保存"
            title="保存"
            disabled={!canSave}
            onClick={commitEdit}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <CheckIcon size={13} />
          </button>
          <button
            type="button"
            className={styles.editCancel}
            aria-label="取消"
            title="取消"
            onClick={cancelEdit}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <CloseIcon size={13} />
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={styles.editBtn}
            aria-label="编辑子任务"
            title="编辑"
            onClick={startEdit}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <EditIcon size={12} />
          </button>
          <button
            type="button"
            className={styles.remove}
            aria-label="从任务集删除"
            title="从任务集删除"
            onClick={() => onRemove(task.id)}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <TrashIcon size={12} />
          </button>
        </>
      )}
      {menu !== null && (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          groups={menuGroups}
          onSelect={(id) => {
            if (id === "copy-title") void copyToClipboard(task.title);
            // 完成时间复用行内编辑表单：已完成行的标题与截止日只读，进去改的就是完成时间与备注
            if (id === "edit-done-at") startEdit();
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </li>
  );
});
