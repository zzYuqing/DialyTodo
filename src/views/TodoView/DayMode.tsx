// 职责：Todo 页的日模式 —— 单日任务清单 + 完成/编辑/删除 + 新建入口。
// 设计要点：
// - 任务过滤在纯函数层完成（lib/），本组件只负责按周期判定与展示；
// - 工作日判定由 useWorkdayChecker 注入，缓存未就绪时降级为按星期判定；
// - 新建与编辑共用 EditTaskModal，新建时即配置周期与提醒，不做"先建后改"；
// - 日期导航在 TodoView 容器上，本组件只渲染清单本体；
// - 未来日期（selectedDate > 今天）仍可点开并新建任务，但不可勾选完成（透传 disabledDone）。

import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { TaskItem } from "@/components/TaskItem/TaskItem";
import { AddTaskFab } from "@/components/AddTaskFab/AddTaskFab";
import { EditTaskModal, type TaskModalTarget } from "@/components/EditTaskModal/EditTaskModal";
import { ConfirmDialog } from "@/components/ConfirmDialog/ConfirmDialog";
import {
  buildTaskMap,
  collectTasksOfDay,
  isComposite,
  todayKey,
  sortUnfinishedTasks,
} from "@/lib";
import { useTaskStore, useViewStore } from "@/stores";
import { useWorkdayChecker } from "@/hooks";
import type { CompositeTarget, Task, TaskSubmitPayload } from "@/types";
import styles from "./DayMode.module.css";

/** 拖拽启动阈值（px）：位移小于它一律当点击处理，不影响勾选与双击编辑 */
const DRAG_THRESHOLD_PX = 4;

/** 一次拖拽的实时状态，序号都限定在未完成区内 */
interface DragState {
  /** 被拖起的行 */
  from: number;
  /** 当前插入位置 */
  to: number;
  /** 鼠标相对按下点的垂直位移，用于把行"提"到光标位置 */
  dy: number;
  /** 是否已越过阈值；未越过前只记起点，不改任何视觉 */
  active: boolean;
}

export function DayMode() {
  const tasks = useTaskStore((s) => s.tasks);
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const setDone = useTaskStore((s) => s.setDone);
  const removeTask = useTaskStore((s) => s.removeTask);
  const reorderTasks = useTaskStore((s) => s.reorderTasks);
  const addComposite = useTaskStore((s) => s.addComposite);
  const updateComposite = useTaskStore((s) => s.updateComposite);
  const setSubtaskDone = useTaskStore((s) => s.setSubtaskDone);
  const removeSubtask = useTaskStore((s) => s.removeSubtask);
  const reorderSubtasks = useTaskStore((s) => s.reorderSubtasks);
  const editSubtask = useTaskStore((s) => s.editSubtask);
  const addSubtask = useTaskStore((s) => s.addSubtask);
  const attachToComposite = useTaskStore((s) => s.attachToComposite);

  const selectedDate = useViewStore((s) => s.selectedDate);
  const hideCompleted = useViewStore((s) => s.hideCompleted);

  const isWorkday = useWorkdayChecker([selectedDate]);
  const isFuture = selectedDate > todayKey();
  const [target, setTarget] = useState<TaskModalTarget | null>(null);
  // 展开的是哪个任务集。存 id 而不是布尔：多个任务集可以同时展开，互不干扰
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [drag, setDrag] = useState<DragState | null>(null);
  // 拖拽状态另存一份 ref：window 上的 move 回调读它做"位置没变就不重渲染"的判断
  const dragRef = useRef<DragState | null>(null);
  // 未完成任务的最新快照：window 回调里闭包拿到的是按下那一刻的数组，
  // 落盘要基于最新数据算下标
  const unfinishedRef = useRef<Task[]>([]);
  // 拖拽进行中的解绑函数，组件卸载时兜底调用
  const detachDrag = useRef<(() => void) | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 过滤当日应出现的任务
  const visibleTasks = useMemo(
    () => collectTasksOfDay(tasks, selectedDate, isWorkday),
    [tasks, selectedDate, isWorkday],
  );

  // 「已完成」的判定口径与「隐藏已完成」开关一致：当天 instances.done
  const isDoneToday = (task: Task) => task.instances[selectedDate]?.done === true;
  const filtered = hideCompleted ? visibleTasks.filter((t) => !isDoneToday(t)) : visibleTasks;

  // 分区：未完成区（可手动排序，内部先按 order、再按活跃 DDL 置顶与创建顺序）
  // + 已完成区（恒沉底、不可拖动、也不接受放置）。
  const unfinished = useMemo(
    () => sortUnfinishedTasks(filtered.filter((t) => !isDoneToday(t))),
    [filtered, selectedDate],
  );
  const finished = filtered.filter((t) => isDoneToday(t));
  const sorted = [...unfinished, ...finished];
  unfinishedRef.current = unfinished;

  // id → task 索引：任务集要它才能取到子任务实体。整页只用一份，不在每行重复构建
  const taskMap = useMemo(() => buildTaskMap(tasks), [tasks]);

  // 右键菜单「添加到任务集」的候选：所有未删除的任务集。
  // 只带 id / 标题，「这一行当前属于哪个」由行内拿 parentId 比，这里才能整页只建一份
  const compositeTargets = useMemo<CompositeTarget[]>(
    () =>
      tasks
        .filter((task) => isComposite(task) && !task.archived)
        .map((task) => ({ id: task.id, title: task.title })),
    [tasks],
  );

  // —— 子任务展开区 ——
  const toggleExpand = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 卸载兜底：拖拽途中切换页面 / 日期时解绑 window 监听
  useEffect(() => () => detachDrag.current?.(), []);

  // —— 拖拽排序 ——
  // 用 Pointer Events 自己实现，不用 HTML5 drag & drop：WebView2 里原生拖拽
  // 会被窗口的文件拖放处理吃掉，dragstart 时常起不来；自绘还能精确控制
  // 「已完成区不可拖、也放不进去」。
  const updateDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  /**
   * 按鼠标 Y 坐标算插入位置：取「垂直中线在鼠标之下」的第一行。
   * 只在未完成区的前 N 行里找，鼠标进入已完成区时返回未完成区末尾 —— 放不进去。
   * 被拖的那一行此刻已跟着鼠标位移，要先减掉 dy 还原它在流中的原位再比较，
   * 否则它自己的中线永远贴着鼠标，插入位置会算死在原地。
   */
  const resolveDropIndex = (clientY: number, from: number, dy: number): number => {
    const list = listRef.current;
    const count = unfinishedRef.current.length;
    if (list === null || count === 0) return 0;
    const rows = Array.from(list.children).slice(0, count) as HTMLElement[];
    const hit = rows.findIndex((row, index) => {
      const rect = row.getBoundingClientRect();
      const top = index === from ? rect.top - dy : rect.top;
      return clientY < top + rect.height / 2;
    });
    return hit === -1 ? count - 1 : hit;
  };

  /** 落盘：未完成区整段按下标写回 order，之后 DDL 置顶让位于用户顺序 */
  const commitReorder = (state: DragState) => {
    const next = [...unfinishedRef.current];
    const [moved] = next.splice(state.from, 1);
    if (moved === undefined) return;
    next.splice(state.to, 0, moved);
    void reorderTasks(next.map((t) => t.id));
  };

  /**
   * 拖起的是「展开中」的任务集时，先收起它的展开区。
   * 展开区挂在父行 <li> 内部，拖起来会跟着整行一起位移，
   * 既挡住后面的行，也让按行高判定插入位置的结果失真。
   * 收起是单向的：拖完落位后不自动还原，避免刚排好的顺序又被撑开的面板打乱。
   */
  const collapseDraggedComposite = (index: number) => {
    const dragged = unfinishedRef.current[index];
    if (dragged === undefined || !isComposite(dragged)) return;
    setExpandedIds((current) => {
      if (!current.has(dragged.id)) return current;
      const next = new Set(current);
      next.delete(dragged.id);
      return next;
    });
  };

  /**
   * 按下即挂 window 上的 move / up 监听（而不是只听 li 的 onPointerMove）：
   * 鼠标甩得快时会离开原行，挂在 li 上就再也收不到事件，拖拽会卡住。
   * 也不用 setPointerCapture —— 它会把 click / dblclick 一并重定向到 li，
   * 双击标题编辑会失效。
   */
  const handleDragPointerDown = (index: number, event: PointerEvent<HTMLLIElement>) => {
    if (event.button !== 0) return;
    // 在按钮（勾选 / 编辑 / 删除）上按下时不启动拖拽，把事件让给点击
    if ((event.target as HTMLElement).closest("button") !== null) return;

    const startY = event.clientY;
    let state: DragState = { from: index, to: index, dy: 0, active: false };
    updateDrag(state);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (!state.active) {
        // 没越过阈值就不动状态：单击勾选、双击编辑照常工作
        if (Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return;
        window.getSelection()?.removeAllRanges();
        // 越过阈值才算真在拖：此刻收起被拖任务集的展开区，松手后不再自动展开
        collapseDraggedComposite(state.from);
      }
      const dy = moveEvent.clientY - startY;
      const to = resolveDropIndex(moveEvent.clientY, state.from, dy);
      // 插入位置没变也要更新：位移变了，行得继续跟着鼠标
      if (state.active && to === state.to && dy === state.dy) return;
      state = { ...state, to, dy, active: true };
      updateDrag(state);
    };

    const onUp = () => {
      detach();
      const last = state;
      updateDrag(null);
      if (last.active && last.from !== last.to) commitReorder(last);
    };

    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      detachDrag.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    // 组件卸载（切换页面 / 日期）时兜底解绑，避免监听泄漏与野状态
    detachDrag.current = detach;
  };

  const handleSubmit = (payload: TaskSubmitPayload) => {
    if (target === null) return;
    if (target.kind === "create") {
      if (payload.kind === "composite") void addComposite(payload.edit);
      else void addTask(payload.edit);
      return;
    }
    if (payload.kind === "composite") void updateComposite(target.task.id, payload.edit);
    else void updateTask(target.task.id, payload.edit);
  };

  /**
   * 待删除对象：用一个状态对象驱动二次确认弹窗，普通任务与子任务共用同一份。
   * null = 弹窗关闭；非 null = 弹窗开启并显示对应文案。
   * 取代原先的 window.confirm：原生对话框在浅/深主题下不可控、不可聚焦、阻断交互线程。
   */
  type PendingDelete =
    | { kind: "task"; id: string }
    | { kind: "subtask"; parentId: string; childId: string }
    | null;
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  const requestArchive = (id: string) => setPendingDelete({ kind: "task", id });
  const requestRemoveSubtask = (parentId: string, childId: string) =>
    setPendingDelete({ kind: "subtask", parentId, childId });

  // 真正执行删除：从 pendingDelete 取出目标，按类型走各自 store 动作，然后收起弹窗
  const confirmDelete = () => {
    if (pendingDelete === null) return;
    if (pendingDelete.kind === "task") void removeTask(pendingDelete.id);
    else void removeSubtask(pendingDelete.parentId, pendingDelete.childId);
    setPendingDelete(null);
  };

  // 弹窗文案：动态嵌入被删除对象的标题；任务集额外点明「及其全部子任务」
  const deleteMessage = useMemo<ReactNode>(() => {
    if (pendingDelete === null) return null;
    if (pendingDelete.kind === "task") {
      const t = tasks.find((x) => x.id === pendingDelete.id);
      const title = t?.title ?? "未命名任务";
      return t !== undefined && isComposite(t) ? (
        <>删除后任务集「<strong>{title}</strong>」及其全部子任务、历史完成记录将一并移除，不可恢复。</>
      ) : (
        <>删除后任务「<strong>{title}</strong>」及其历史完成记录将一并移除，不可恢复。</>
      );
    }
    const child = tasks.find((x) => x.id === pendingDelete.childId);
    const parent = tasks.find((x) => x.id === pendingDelete.parentId);
    return (
      <>子任务「<strong>{child?.title ?? "未命名子任务"}</strong>」将从任务集「<strong>{parent?.title ?? "未命名任务集"}</strong>」中删除，不可恢复。</>
    );
  }, [pendingDelete, tasks]);

  /**
   * 右键「添加到任务集」：收编后该任务会从日清单顶层移进任务集的展开区，
   * 视觉上等于"从列表里消失"，所以先讲清后果再动手。
   */
  const handleAttachToComposite = (childId: string, parentId: string) => {
    const child = tasks.find((task) => task.id === childId);
    const parent = tasks.find((task) => task.id === parentId);
    if (child === undefined || parent === undefined) return;
    const ok = window.confirm(
      `把「${child.title}」加入任务集「${parent.title}」。\n` +
        "之后它会从日清单顶层移入该任务集的展开区，截止日若超出任务集区间会自动收敛。\n" +
        "确定？",
    );
    if (ok) void attachToComposite(parentId, childId);
  };

  return (
    <div className={styles.mode}>
      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {visibleTasks.length === 0
            ? (isFuture
                ? "这是未来的日子，现在还不能勾完成，但可以先建好任务。"
                : "这一天还没有任务，点击右下角 ＋ 新建一条吧。")
            : "这一天的任务已全部完成，干得漂亮 🎉"}
        </p>
      ) : (
        <ul
          ref={listRef}
          className={drag?.active === true ? `${styles.list} ${styles.dragging}` : styles.list}
        >
          {sorted.map((task, index) => (
            <TaskItem
              key={task.id}
              task={task}
              dateKey={selectedDate}
              disabledDone={isFuture}
              drag={
                index < unfinished.length
                  ? {
                      index,
                      dragging: drag?.active === true && drag.from === index,
                      offsetY: drag?.active === true && drag.from === index ? drag.dy : 0,
                      // 后移时插入线画在目标行下方，前移时画在上方，与实际落点一致
                      dropHint:
                        drag?.active === true && drag.to !== drag.from && drag.to === index
                          ? drag.to > drag.from
                            ? "below"
                            : "above"
                          : null,
                      onPointerDown: handleDragPointerDown,
                    }
                  : undefined
              }
              taskMap={taskMap}
              expanded={expandedIds.has(task.id)}
              onToggleExpand={toggleExpand}
              onToggleSubtask={(parentId, childId, done) =>
                void setSubtaskDone(parentId, childId, done)
              }
              onRemoveSubtask={requestRemoveSubtask}
              onReorderSubtasks={(parentId, ids) => void reorderSubtasks(parentId, ids)}
              onEditSubtask={(parentId, childId, edit) => void editSubtask(parentId, childId, edit)}
              onAddSubtask={(parentId, title) => void addSubtask(parentId, title)}
              compositeTargets={compositeTargets}
              onAttachToComposite={handleAttachToComposite}
              onToggleDone={(id, done) => void setDone(id, selectedDate, done)}
              onEdit={(t) => setTarget({ kind: "edit", task: t })}
              onRemove={requestArchive}
            />
          ))}
        </ul>
      )}

      <AddTaskFab onClick={() => setTarget({ kind: "create", startDate: selectedDate })} />

      <EditTaskModal
        target={target}
        tasks={tasks}
        onSubmit={handleSubmit}
        onClose={() => setTarget(null)}
      />

      <ConfirmDialog
        opened={pendingDelete !== null}
        title={pendingDelete?.kind === "subtask" ? "删除子任务" : "删除任务"}
        message={deleteMessage}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
