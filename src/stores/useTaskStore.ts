// 职责：任务数据的单一数据源（提示词 3.4）。
// 组件只发 action，不直接改数据；所有变更先经 lib/ 的纯函数变换，再落盘。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  addSubtask,
  applyCompositeSubtasks,
  applyTaskEdit,
  attachExistingTask,
  childIdsOf,
  clampSubtaskDueDates,
  createTask,
  deriveCompositeCompletion,
  detachSubtask,
  editSubtask,
  generateTaskId,
  isComposite,
  nowIso,
  pinTaskToTop,
  reorderSubtasks,
  sortTasksByCreatedAt,
  syncChildrenIndex,
  toggleSubtask,
  toggleTaskDone,
  todayKey,
} from "@/lib";
import { dailyBackup, loadTasks, saveTasks } from "@/services";
import type {
  CompositeEdit,
  CreateTaskInput,
  Task,
  TaskEdit,
  TrashSubtaskPayload,
} from "@/types";
import type { SubtaskEdit } from "@/lib";

interface TaskState {
  tasks: Task[];
  loaded: boolean;
  /** 启动加载时产生的提示信息，null 表示无异常 */
  loadError: string | null;
  /** 损坏兜底生成的备份路径（绝对路径），null 表示未生成。UI 用它指引用户去找原文件 */
  corruptedBackupPath: string | null;
  /** 启动加载：读主文件，损坏则回退备份；成功后执行每日一次备份 */
  initialize: () => Promise<void>;
  addTask: (input: CreateTaskInput) => Promise<void>;
  updateTask: (id: string, edit: TaskEdit) => Promise<void>;
  setDone: (id: string, dateKey: string, done: boolean) => Promise<void>;
  /** 删除任务（软删除：仅从主数组移除并落盘，磁盘无独立文件；快照由回收站持有） */
  removeTask: (id: string) => Promise<void>;
  /** 从回收站还原任务（含任务集的子任务）：按 id 去重后追加回主数组并落盘 */
  restoreTasks: (tasks: Task[]) => Promise<void>;
  /**
   * 从回收站还原单个子任务：先在数组里补回任务实体，再挂回父任务集的 children，
   * 并尽量放回原始下标（index 越界时收敛到末尾）。父任务集已不存在则原样返回不写盘。
   */
  restoreSubtask: (parentId: string, subtask: Task, index: number) => Promise<void>;

  // ── 复合任务（任务集）──
  /** 新建复合任务：创建任务集实体 + 首屏给出的子任务实体，一步落盘 */
  addComposite: (edit: CompositeEdit) => Promise<void>;
  /**
   * 编辑复合任务：父字段 + 子任务群（新增 / 改名 / 改截止日 / 删除）+ DDL 收敛。
   * 返回「草稿里消失而被连带删除」的子任务快照（含原下标与父引用），供调用方移入回收站；
   * 删除本身发生在 applyCompositeSubtasks 内部，这里只负责在动手前先把快照留下来。
   */
  updateComposite: (id: string, edit: CompositeEdit) => Promise<TrashSubtaskPayload[]>;
  /** 勾选 / 取消单个子任务。写 childDoneAt，父任务的完成态由 lib 推导 */
  setSubtaskDone: (parentId: string, childId: string, done: boolean) => Promise<void>;
  /** 删除单个子任务：摘关系 + 硬删除（否则它会以普通任务身份复活在日清单） */
  removeSubtask: (parentId: string, childId: string) => Promise<void>;
  /**
   * 在既有任务集里直接追加一条子任务（主页展开区「+」入口）。
   * 与 EditTaskModal 走同一条子任务构造口径，但只追加单条不动其他子任务。
   */
  addSubtask: (parentId: string, title: string) => Promise<void>;
  /** 展开区拖拽排序：ids 是该父此刻全部子任务的新顺序 */
  reorderSubtasks: (parentId: string, ids: string[]) => Promise<void>;
  /** 行内编辑单条子任务：改标题 / 备注 / 截止日；已完成行再加完成时刻（截止日收敛到父区间） */
  editSubtask: (parentId: string, childId: string, edit: SubtaskEdit) => Promise<void>;
  /** 把一条已存在的普通任务收编进任务集（右键菜单「添加到任务集」） */
  attachToComposite: (parentId: string, childId: string) => Promise<void>;
  /**
   * 手动排序：ids 是拖动后未完成区的新顺序，按下标写回各任务的 order 并落盘。
   * 只改出现在 ids 里的任务，其余（已完成 / 不在当天的）保持原值。
   */
  reorderTasks: (ids: string[]) => Promise<void>;
  /**
   * 右键「置顶」：把该任务挪到未完成清单顶部。
   * 与 reorderTasks 的区别是只改这一条任务的 order，不重排其余任务。
   */
  pinTask: (id: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>()(
  devtools((set, get) => ({
    tasks: [],
    loaded: false,
    loadError: null,
    corruptedBackupPath: null,

    async initialize() {
      const { result, tasks } = await loadTasks();
      // 载入后自愈：以 children 为准全量重建 parentId，并清掉幽灵 id。
      // 之后整份内存数据里「是否为顶层」的判断就可以无条件信任 parentId。
      let cleaned = sortTasksByCreatedAt(syncChildrenIndex(tasks));
      // 一次性数据迁移：旧版本里 archived=true 的任务一律硬删除。
      const archivedCount = cleaned.filter((t) => t.archived === true).length;
      if (archivedCount > 0) {
        cleaned = cleaned.filter((t) => t.archived !== true);
      }
      set({
        tasks: cleaned,
        loaded: true,
        loadError: result.error,
        corruptedBackupPath: result.corruptedBackupPath,
      });

      // 只在数据可用时才备份，避免把损坏数据写进备份
      if (result.ok) {
        if (archivedCount > 0) await saveTasks(cleaned);
        await dailyBackup(todayKey());
      }
    },

async addTask(input) {
      const task = createTask(input);
      const next = [...get().tasks, task];
      set({ tasks: next });
      await saveTasks(next);
    },

    async updateTask(id, edit) {
      const next = get().tasks.map((task) => (task.id === id ? applyTaskEdit(task, edit) : task));
      set({ tasks: next });
      await saveTasks(next);
    },

    async setDone(id, dateKey, done) {
      const next = get().tasks.map((task) =>
        task.id === id ? toggleTaskDone(task, dateKey, done) : task,
      );
      set({ tasks: next });
      await saveTasks(next);
    },

    async removeTask(id) {
      const parent = get().tasks.find((task) => task.id === id);
      // 任务集连带删除其全部子任务：否则子任务会因为无人收录而降级回普通任务重新冒到日清单。
      // 删子任务前先读 children，因为 filter 掉父之后子任务的 parentId 还指向已删的 id，
      // syncChildrenIndex 下次启动会把它们降级回顶层 —— 不删就会复活。
      const childIds = parent !== undefined && isComposite(parent) ? new Set(parent.children ?? []) : null;
      const next =
        childIds === null
          ? get().tasks.filter((task) => task.id !== id)
          : get().tasks.filter((task) => task.id !== id && !childIds.has(task.id));
      set({ tasks: next });
      await saveTasks(next);
    },

    async restoreTasks(tasksToRestore) {
      // 还原时以快照为准；与主数据按 id 去重，已存在的跳过，避免重复还原同一份
      const existing = new Set(get().tasks.map((task) => task.id));
      const appended = tasksToRestore.filter((task) => !existing.has(task.id));
      if (appended.length === 0) return;
      const next = [...get().tasks, ...appended];
      set({ tasks: next });
      await saveTasks(next);
    },

    async restoreSubtask(parentId, subtask, index) {
      // 还原以快照为准；已存在的实体不重复追加，避免同 id 撞键
      const exists = get().tasks.some((task) => task.id === subtask.id);
      const base = exists ? get().tasks : [...get().tasks, subtask];
      // attachExistingTask 会挂关系 + 收敛截止日 + 重算父完成态；原样返回表示父不存在 / 已是成员
      const attached = attachExistingTask(base, parentId, subtask.id);
      if (attached === base) return;
      // 放回原始位置：先从 children 里摘出，再按 index 插回（越界收敛到末尾）
      const parent = attached.find((task) => task.id === parentId);
      if (parent === undefined) return;
      const without = childIdsOf(parent).filter((id) => id !== subtask.id);
      const at = Math.min(Math.max(index, 0), without.length);
      const ordered = [...without.slice(0, at), subtask.id, ...without.slice(at)];
      const next = reorderSubtasks(attached, parentId, ordered);
      set({ tasks: next });
      await saveTasks(next);
    },

    async addComposite(edit) {
      const parentId = generateTaskId();
      const newIds = edit.subtasks
        .filter((draft) => draft.id === undefined)
        .map(() => generateTaskId());
      const parent: Task = {
        ...createTask(
          {
            title: edit.title,
            note: edit.note,
            schedule: edit.schedule,
            reminder: edit.reminder,
          },
          parentId,
        ),
        kind: "composite",
        children: [],
        parentId: null,
        childDoneAt: null,
      };
      const next = applyCompositeSubtasks(
        [...get().tasks, parent],
        parentId,
        edit.subtasks,
        newIds,
        edit.schedule.startDate,
        nowIso(),
      );
      set({ tasks: next });
      await saveTasks(next);
    },

    async updateComposite(id, edit) {
      const current = get().tasks.find((task) => task.id === id);
      if (current === undefined) return [];
      // 动手前先留下快照：草稿里没出现的子任务会被 applyCompositeSubtasks 摘关系 + 硬删除，
      // 删完就取不到 parentId / children 了。调用方（回收站）据此把它们移入回收站。
      const keptIds = new Set(
        edit.subtasks.map((draft) => draft.id).filter((draftId): draftId is string => draftId !== undefined),
      );
      const removed: TrashSubtaskPayload[] = [];
      childIdsOf(current).forEach((childId, index) => {
        if (keptIds.has(childId)) return;
        const child = get().tasks.find((task) => task.id === childId);
        if (child === undefined) return;
        removed.push({ parentId: id, parentTitle: current.title, index, task: child });
      });
      const newIds = edit.subtasks
        .filter((draft) => draft.id === undefined)
        .map(() => generateTaskId());
      // 先写父字段（维持与既有 updateTask 同一条链路），再做 DDL 收敛与子任务群同步
      const edited = get().tasks.map((task) =>
        task.id === id
          ? { ...applyTaskEdit(task, edit), kind: "composite" as const, children: current.children }
          : task,
      );
      const parentAfterEdit = edited.find((task) => task.id === id);
      if (parentAfterEdit === undefined) return [];
      const clamped = clampSubtaskDueDates(
        edited,
        parentAfterEdit,
        edit.schedule.startDate,
        edit.schedule.endDate,
      );
      // 子任务群变动后重跑推导：新增一条未完成子任务要让父「取消完成」，
      // 删掉最后一条未完成的则要让父「补上完成」
      const next = deriveCompositeCompletion(
        applyCompositeSubtasks(
          clamped.tasks,
          id,
          edit.subtasks,
          newIds,
          edit.schedule.startDate,
          nowIso(),
        ),
        id,
      );
      set({ tasks: next });
      await saveTasks(next);
      return removed;
    },

    async setSubtaskDone(parentId, childId, done) {
      const next = toggleSubtask(get().tasks, parentId, childId, done, nowIso());
      set({ tasks: next });
      await saveTasks(next);
    },

    async removeSubtask(parentId, childId) {
      const detached = detachSubtask(get().tasks, parentId, childId);
      if (detached === get().tasks) return;
      // 摘关系后从数组里硬删除：已不在任何 children 里，留着会以普通任务身份重新出现在日清单顶层
      const removed = detached.filter((task) => task.id !== childId);
      // 移走的可能正是最后一条未完成的子任务，父的完成态要跟着重算
      const next = deriveCompositeCompletion(removed, parentId);
      set({ tasks: next });
      await saveTasks(next);
    },

    async addSubtask(parentId, title) {
      const parent = get().tasks.find((task) => task.id === parentId);
      if (parent === undefined || !isComposite(parent)) return;
      const trimmed = title.trim();
      if (trimmed.length === 0) return;
      const childId = generateTaskId();
      const next = addSubtask(get().tasks, parentId, childId, trimmed, nowIso());
      set({ tasks: next });
      await saveTasks(next);
    },

    async reorderSubtasks(parentId, ids) {
      const next = reorderSubtasks(get().tasks, parentId, ids);
      set({ tasks: next });
      await saveTasks(next);
    },

    async editSubtask(parentId, childId, edit) {
      const trimmed = edit.title.trim();
      if (trimmed.length === 0) return;
      const next = editSubtask(get().tasks, parentId, childId, { ...edit, title: trimmed });
      // 原样返回 = 目标非法或子不在成员里，不写盘
      if (next === get().tasks) return;
      set({ tasks: next });
      await saveTasks(next);
    },

    async attachToComposite(parentId, childId) {
      const next = attachExistingTask(get().tasks, parentId, childId);
      // 原样返回 = 目标非法或已是成员，不写盘
      if (next === get().tasks) return;
      set({ tasks: next });
      await saveTasks(next);
    },

    async reorderTasks(ids) {
      const rank = new Map(ids.map((id, index) => [id, index]));
      const next = get().tasks.map((task) => {
        const order = rank.get(task.id);
        return order === undefined ? task : { ...task, order };
      });
      set({ tasks: next });
      await saveTasks(next);
    },

    async pinTask(id) {
      const next = pinTaskToTop(get().tasks, id);
      // 原样返回 = 目标不存在或已在顶部，不写盘
      if (next === get().tasks) return;
      set({ tasks: next });
      await saveTasks(next);
    },
  })),
);
