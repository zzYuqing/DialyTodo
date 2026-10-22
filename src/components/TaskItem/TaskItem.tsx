// 职责：单条任务行 —— 显示标题、备注、周期徽标、完成状态、操作图标。
// 交互：
// - 点击 checkbox 切换当日完成（future 日由 disabledDone 禁用）
// - 一次性长期任务（含无截止日）被某日勾选关闭后，早于完成日的空格子：整行灰化、
//   checkbox 禁用无勾（防止补勾），并追加「X月X日已完成」徽章说明关闭时间；
//   未来日期由 occursOn 直接过滤，不渲染（DDL 同理）
// - 双击标题 / 点击右侧编辑图标 → 触发 onEdit
// - 点击右侧删除图标 → 触发 onRemove（硬删除）
// - 右键「置顶」：仅出现在未勾选的行，把该行挪到未完成清单顶部（写 task.order）
// - 已完成任务整体变灰、标题加删除线
//
// 方向 B（DDL 语义重定义）：
// - 长期 DDL = 周期 once 且 endDate 存在且 endDate ≠ startDate；
//   起止同日的 once 任务不算 DDL，不染红、不显示「已过期」。
// - 「已过期」仅在其 endDate 当天、且未完成时成立（isOverdueDdl）；
//   超过 endDate 的任务由 occursOn/isWithinRange 过滤，不会出现在日清单。
// - 紧迫度走整行底色 + 左侧色条 + 标题色阶（低饱和暖灰，避红橙），不染徽章；
//   未完成且未到截止日的长期 DDL 追加「剩 N 天」徽章（中性色，数字等宽）；
//   截止日当天（含长期任务最后一天）显示「今日截止」；
//   「已过期」走独立红徽章，置于周期徽章右侧、日期之前。
//
// 任务集（复合任务）的 DDL 表现：
// - 行底色与倒计时按「有效截止日」= min(父自身 DDL 的 endDate, 未完成子任务的最小 endDate) 计算，
//   子任务先到期时父行跟着加深，不会出现「子任务火烧眉毛、父行毫无提示」；
//   已逾期的候选不参与取最小 —— 它的紧迫度交给下面的红徽章，不该压掉别的子任务的倒计时；
// - 子任务逾期（endDate < 当前查看日且仍未完成）时，标题右侧追加红徽章「N 项子任务逾期」，
//   收起状态同样可见；逾期子任务全部完成后徽章自动消失。

import {
  memo,
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from "react";
import type { CompositeTarget, Task } from "@/types";
import {
  daysBetweenKeys,
  describeSchedule,
  formatMonthDay,
  isComposite,
  isDoneOn,
  isLongDdlTask,
  isLongTermOnce,
  isOverdueDdl,
  subtaskProgressOf,
  compositeDdlView,
  ddlUrgencyFor,
  urgencyOfEndDate,
  todayKey,
  type DdlUrgency,
  type SubtaskEdit,
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
  PIN_ITEM_ID,
  RowContextMenu,
  type ContextMenuItem,
  type ContextMenuGroup,
} from "@/components/RowContextMenu/RowContextMenu";
import { CollapsibleNote } from "@/components/CollapsibleNote/CollapsibleNote";
import { useSettingsStore } from "@/stores";
import styles from "./TaskItem.module.css";

/**
 * 拖拽排序句柄。传入即启用整行拖动；不传（已完成任务）则整行既不响应拖动、
 * 也不会被算作放置目标。
 *
 * 用 Pointer Events 而非 HTML5 drag & drop：WebView2 里原生拖拽会被窗口的
 * 文件拖放处理吃掉，dragstart 常常起不来，自绘更可靠，也方便控制"不能放进已完成区"。
 */
export interface DragSortHandle {
  /** 本行在可排序区间（未完成区）内的序号 */
  index: number;
  dragging: boolean;
  /** 插入指示线画在本行的上方还是下方，null 表示本行不是当前放置目标 */
  dropHint: "above" | "below" | null;
  /** 拖拽中本行跟随鼠标的垂直位移（px），非拖拽行为 0 */
  offsetY: number;
  /** 只转发按下事件，后续 move / up 由调用方在 window 上接管 */
  onPointerDown: (index: number, event: PointerEvent<HTMLLIElement>) => void;
}

interface TaskItemProps {
  task: Task;
  /** 当前选中日期，YYYY-MM-DD */
  dateKey: string;
  /** 未来日期下禁用勾选完成（仍可编辑 / 删除 / 新建） */
  disabledDone?: boolean;
  onToggleDone: (id: string, done: boolean) => void;
  onEdit: (task: Task) => void;
  onRemove: (id: string) => void;
  /** 右键「置顶」：把本行挪到未完成清单顶部；省略则不显示该项 */
  onPinTop?: (id: string) => void;
  /** 拖拽排序：省略表示本行不参与排序（已完成条目） */
  drag?: DragSortHandle;

  // ── 复合任务（任务集）专属 ──
  /** id → task 索引。复合任务要取子任务实体算进度，由列表页统一构建后传入 */
  taskMap?: TaskMap;
  /** 子任务展开区是否展开；仅复合任务使用 */
  expanded?: boolean;
  onToggleExpand?: (id: string) => void;
  onToggleSubtask?: (parentId: string, childId: string, done: boolean) => void;
  onRemoveSubtask?: (parentId: string, childId: string) => void;
  onReorderSubtasks?: (parentId: string, ids: string[]) => void;
  /** 行内编辑单条子任务：改标题 / 备注 / 截止日；已完成行再加完成时刻 */
  onEditSubtask?: (parentId: string, childId: string, edit: SubtaskEdit) => void;
  /** 列表末尾「+ 添加子任务」入口提交时调用 */
  onAddSubtask?: (parentId: string, title: string) => void;
  /**
   * 右键菜单里可收编本行的任务集（页面统一构造一份传进来，本行只负责比对 parentId）。
   * 省略则不显示「添加到任务集」分组。
   */
  compositeTargets?: CompositeTarget[];
  /** 右键「添加到任务集 → 某个任务集」 */
  onAttachToComposite?: (childId: string, parentId: string) => void;
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
  onPinTop,
  drag,
  taskMap,
  expanded = false,
  onToggleExpand,
  onToggleSubtask,
  onRemoveSubtask,
  onReorderSubtasks,
  onEditSubtask,
  onAddSubtask,
  compositeTargets,
  onAttachToComposite,
}: TaskItemProps) {
  // 复合任务：完成态由子任务推导而来，行本身不可直接勾选，改由展开区逐条操作。
  // 提前到最前：右键菜单的分组也要用它决定「是否显示添加到任务集」。
  const composite = isComposite(task);
  // 备注折叠行数：来自设置，改后立即生效（CollapsibleNote 据此决定是否截断）。
  const noteCollapseLines = useSettingsStore((s) => s.settings.noteCollapseLines);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const handleContextMenu = (event: ReactMouseEvent<HTMLLIElement>) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const handleMenuSelect = (itemId: string) => {
    setMenu(null);
    if (itemId === PIN_ITEM_ID) {
      onPinTop?.(task.id);
      return;
    }
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

  const done = isDoneOn(task, dateKey);

  // 菜单分组：任务操作恒有；「添加到任务集」只给普通任务（任务集不能嵌套）。
  // 「置顶」只给未勾选的行 —— 已完成条目恒沉底，给它置顶没有意义（子任务同理）。
  const taskItems: ContextMenuItem[] = [];
  if (!done) taskItems.push({ id: PIN_ITEM_ID, label: "置顶" });
  taskItems.push({ id: "edit", label: "编辑" });
  taskItems.push({
    id: "archive",
    label: composite ? "删除任务集及其子任务" : "删除",
    danger: true,
  });
  const menuGroups: ContextMenuGroup[] = [{ title: "任务", items: taskItems }];
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

  const progress = composite && taskMap !== undefined ? subtaskProgressOf(taskMap, task) : null;
  const showExpand = composite && expanded;
  // 周期徽标：weekly 具体到星期（如「每周一、五」），其余类型用常量表文案。
  // 「仅一次」太常见，徽章会刷屏，这里直接过滤掉不渲染（编辑表单仍显示该选项，不受影响）。
  const scheduleLabel = task.schedule.type === "once" ? null : describeSchedule(task.schedule);

  // 跨天的一次性长期任务判定：含 endDate === null 的「未指定截止日」长期任务
  const isLongOnce = isLongTermOnce(task.schedule);
  const isDdlCompleted = isLongOnce && task.completedAt != null;
  const isDdlCompletedDay = isDdlCompleted && task.completedAt === dateKey;
  // 过去格子：已永久完成但 dateKey 早于完成日（防止补勾）
  const isDdlPastDay =
    isDdlCompleted && task.completedAt != null && dateKey < task.completedAt;

  // 任务集的 DDL 收敛：在「尚未逾期」的候选里取最近截止日（父自身 + 未完成子任务），
  // 并单独统计逾期子任务条数。收起状态也要看见逾期提示，故不依赖展开与否。
  const ddlView =
    composite && taskMap !== undefined ? compositeDdlView(taskMap, task, dateKey) : null;
  const effectiveEndDate = ddlView?.effectiveEndDate ?? null;
  const overdueSubtaskCount = ddlView?.overdueCount ?? 0;

  // 已过期：长期 DDL 在结束日当天且未完成（独立于档位，走红徽章）
  const overdue = isOverdueDdl(task, dateKey);

  // 紧迫度档位：仅未完成时计算（含 overdue 档）。
  // - 普通任务：ddlUrgencyFor 内部仍要求 isLongDdlTask（有 endDate），无截止日的长期任务自然返回 null；
  // - 任务集：改按收敛出的有效截止日取档 —— 子任务先到期时，父行底色要跟着它一起加深。
  const urgency: DdlUrgency = isDdlCompleted
    ? null
    : ddlView !== null
      ? overdue
        ? "overdue"
        : effectiveEndDate === null
          ? null
          : urgencyOfEndDate(effectiveEndDate, dateKey)
      : ddlUrgencyFor(task, dateKey);

  // 截止日徽章：仅未完成时计算，与「已过期」互斥（仅过去日标记已过期）。
  // - 长期 DDL 的剩余天数：正数 →「剩 N 天」；截止日当天（含长期任务最后一天）→「今日截止」；
  // - 非长期 DDL 但 endDate 命中真实今天且未完成（如起止同日的单日任务）→ 补「今日截止」。
  // 任务集的倒计时基准是收敛后的有效截止日，与行底色同源 —— 否则会出现「有色无数字」。
  const endDate = task.schedule.endDate;
  const countdownEnd =
    ddlView !== null ? effectiveEndDate : isLongDdlTask(task.schedule) ? endDate : null;
  const daysLeft =
    countdownEnd != null && !isDdlCompleted ? daysBetweenKeys(dateKey, countdownEnd) : null;
  const deadlineBadge =
    daysLeft !== null && !overdue
      ? daysLeft === 0
        ? "今日截止"
        : `剩 ${daysLeft} 天`
      : null;
  const dueTodayBadge =
    deadlineBadge === null && countdownEnd != null && countdownEnd === todayKey() && !isDdlCompleted
      ? "今日截止"
      : null;
  const deadlineText = deadlineBadge ?? dueTodayBadge;

  // 完成态追加文字：完成时距 DDL 的剩余天数（endDate - completedAt）
  const daysAhead =
    isDdlCompletedDay && endDate != null && task.completedAt != null
      ? daysBetweenKeys(task.completedAt, endDate)
      : null;

  // 过去格子文案：任务已在某日永久关闭，本行早于完成日 —— 标注具体完成日。
  // 与 daysAhead（完成当日，可算「提前/准时」）互斥，两者不同时出现。
  const completedDateText =
    isDdlPastDay && task.completedAt != null
      ? `${formatMonthDay(task.completedAt)}已完成`
      : null;

  // 行类与禁用：除未来日，DDL 过去格子也禁用
  const rowClasses = [styles.row];
  if (done) rowClasses.push(styles.done);
  if (isDdlPastDay) rowClasses.push(styles.pastDay);
  if (urgency != null) rowClasses.push(URGENCY_ROW_CLASS[urgency]);
  if (drag !== undefined) rowClasses.push(styles.draggable);
  if (drag?.dragging === true) rowClasses.push(styles.dragging);
  if (drag?.dropHint === "above") rowClasses.push(styles.dropAbove);
  if (drag?.dropHint === "below") rowClasses.push(styles.dropBelow);
  // 复合任务需要让展开区换到下一"虚拟行"，这里允许 wrap；非复合任务的横向布局完全不变
  if (composite) rowClasses.push(styles.compositeRow);
  // 复合任务已不渲染勾选圆圈（条件渲染），这里只关心普通任务的禁用条件
  const checkboxDisabled = disabledDone || isDdlPastDay;

  return (
    <li
      className={rowClasses.join(" ")}
      // 拖拽中整行跟着鼠标走：transform 不参与布局，原位自然留空作为「落点参考」
      style={drag?.dragging === true
        ? { transform: `translateY(${drag.offsetY}px) scale(0.9)` }
        : undefined}
      onPointerDown={
        drag === undefined ? undefined : (event) => drag.onPointerDown(drag.index, event)
      }
      onContextMenu={handleContextMenu}
    >
      {composite && (
        <button
          type="button"
          className={`${styles.expandButton} ${expanded ? styles.expandButtonOpen : ""}`}
          aria-expanded={expanded}
          aria-label={expanded ? "收起子任务" : "展开子任务"}
          title={expanded ? "收起子任务" : "展开子任务"}
          onClick={() => onToggleExpand?.(task.id)}
        >
          <ChevronRightIcon size={12} />
        </button>
      )}

      {/* 父任务（任务集）不渲染勾选圆圈：完成态由子任务推导，行本身不可直接勾选。
          普通任务在此保留圆圈，是日清单的主要交互入口。 */}
      {!composite && (
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
      )}

      <div
        className={styles.body}
        onDoubleClick={() => onEdit(task)}
        title="双击编辑"
      >
        {/* 标题右侧的逾期提示：走流内排布，长标题时自然折到下一行；
            收起状态同样渲染 —— 用户不展开也得一眼看见有子任务逾期。 */}
        <div className={styles.title}>
          {task.title}
          {overdueSubtaskCount > 0 && (
            <span className={`${styles.badge} ${styles.badgeExpired} ${styles.titleBadge}`}>
              {overdueSubtaskCount} 项子任务逾期
            </span>
          )}
        </div>
        {task.note.length > 0 && (
          <CollapsibleNote text={task.note} maxLines={noteCollapseLines} variant="block" />
        )}
        <div className={styles.meta}>
          {scheduleLabel !== null && <span className={styles.badge}>{scheduleLabel}</span>}
          {overdue && (
            <span className={`${styles.badge} ${styles.badgeExpired}`}>已过期</span>
          )}
          {deadlineText !== null && (
            <span className={`${styles.badge} ${styles.days}`}>{deadlineText}</span>
          )}
          {completedDateText !== null && (
            <span className={`${styles.badge} ${styles.badgeCompletion}`}>
              {completedDateText}
            </span>
          )}
          {daysAhead !== null && daysAhead > 0 && (
            <span className={`${styles.badge} ${styles.badgeCompletion}`}>
              提前 {daysAhead} 天完成
            </span>
          )}
          {daysAhead === 0 && (
            <span className={`${styles.badge} ${styles.badgeCompletion}`}>准时完成</span>
          )}
          {progress !== null && (
            <span className={styles.progressBadge}>
              {progress.done}/{progress.total}
            </span>
          )}
          <span className={styles.date}>起 {task.schedule.startDate}</span>
          {task.reminder.enabled && (
            <span className={`${styles.badge} ${styles.badgeReminder}`}>
              <BellIcon size={11} />
              {task.reminder.time}
            </span>
          )}
        </div>
        {progress !== null && (
          <div className={styles.progressRow}>
            <span className={styles.progressTrack}>
              <span
                className={styles.progressFill}
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
              />
            </span>
          </div>
        )}
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
          aria-label={composite ? "删除任务集及其全部子任务" : "删除任务"}
          title={composite ? "删除任务集及其全部子任务" : "删除"}
          onClick={() => onRemove(task.id)}
        >
          <TrashIcon size={14} />
        </button>
      </div>

      {/* 展开区独占一整行宽度（靠 .compositeRow 的 wrap 换行到下一"虚拟行"） */}
      {showExpand && taskMap !== undefined && (
        <div className={styles.expand}>
          <SubtaskPanel
            parent={task}
            map={taskMap}
            dateKey={dateKey}
            disabledDone={disabledDone}
            onToggleSubtask={onToggleSubtask ?? (() => undefined)}
            onRemoveSubtask={onRemoveSubtask ?? (() => undefined)}
            onReorderSubtasks={onReorderSubtasks ?? (() => undefined)}
            onEditSubtask={onEditSubtask ?? (() => undefined)}
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
