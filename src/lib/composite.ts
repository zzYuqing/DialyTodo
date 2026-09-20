// 职责：复合任务（任务集）的纯函数层 —— 父子关系、进度推导、展示排序、DDL 收敛。
// 硬性约束：不得 import @tauri-apps/*、react、zustand；只允许依赖 types/ 与 lib/date。
//
// 关系模型（见 docs/复合任务设计.md 第二节）：
//   - 父的 children: string[] 是**权威源**（成员 + 顺序）；
//   - 子的 parentId 是**派生索引**，由 syncChildrenIndex 从 children 全量重建；
//   - 方向只能是 children → parentId —— 顺序只存在于 children，反过来重建会丢顺序。
// 因此这里的关系写入函数必须是全项目唯一碰 children 的地方，且每次都同步维护 parentId。

import type { CompositeEdit, SubtaskDraft, Task } from "@/types";
import { daysBetweenKeys } from "@/lib/date";

/** id → task 的索引。渲染层在进入列表循环前建一次，避免逐个父任务扫全表成 O(n·m) */
export type TaskMap = Map<string, Task>;

// ─────────────────────────────── 身份判定（全部 O(1)）───────────────────────────────

export function buildTaskMap(tasks: Task[]): TaskMap {
  const map: TaskMap = new Map();
  for (const task of tasks) map.set(task.id, task);
  return map;
}

/** 是否是任务集（复合任务） */
export function isComposite(task: Task): boolean {
  return task.kind === "composite";
}

/** 子任务 id 列表；防御 children 缺失 / 非数组（手工改过文件的脏数据） */
export function childIdsOf(parent: Task): string[] {
  return Array.isArray(parent.children) ? parent.children : [];
}

/** 是否是顶层任务：parentId 为空即没有被任何任务集收录 */
export function isRootTask(task: Task): boolean {
  return (task.parentId ?? null) == null;
}

/** 是否是某个任务集的成员 */
export function isSubtask(task: Task): boolean {
  return !isRootTask(task);
}

/** 反向查父：直接读 parentId 后按 id 取，O(1) */
export function findParentOf(map: TaskMap, task: Task): Task | null {
  const parentId = task.parentId;
  if (parentId == null) return null;
  return map.get(parentId) ?? null;
}

/** 按 children 顺序返回子集实体；自动跳过指向不存在任务的幽灵 id */
export function childTasksOf(map: TaskMap, parent: Task): Task[] {
  const out: Task[] = [];
  for (const id of childIdsOf(parent)) {
    const child = map.get(id);
    if (child !== undefined) out.push(child);
  }
  return out;
}

// ─────────────────────────────── 进度与展示 ───────────────────────────────

export interface SubtaskProgress {
  done: number;
  total: number;
  /** 0 - 1；空任务集为 0 */
  ratio: number;
}

export function subtaskProgressOf(map: TaskMap, parent: Task): SubtaskProgress {
  const children = childTasksOf(map, parent);
  const total = children.length;
  const done = children.filter((child) => child.childDoneAt != null).length;
  return { done, total, ratio: total === 0 ? 0 : done / total };
}

/**
 * 展示口径的排序：未完成的在前（保持 children 原序），已完成的恒沉底。
 * 与既有 sortUnfinishedTasks 的分区思路一致，但不需要 order 字段。
 * 已完成区再按完成时间升序（早完成的在上），便于对照先后。
 * childDoneAt 一律是 new Date().toISOString()（UTC Z 结尾），字典序等价于时间序。
 */
export function sortSubtasksForDisplay(subtasks: Task[]): Task[] {
  const undone: Task[] = [];
  const done: Task[] = [];
  for (const task of subtasks) {
    if (task.childDoneAt == null) undone.push(task);
    else done.push(task);
  }
  done.sort((a, b) => (a.childDoneAt ?? "").localeCompare(b.childDoneAt ?? ""));
  return [...undone, ...done];
}

/** 子任务行展示的紧迫度档位 */
export type SubtaskUrgency = "overdue" | "today" | "soon" | "none" | null;

/**
 * 子任务紧迫度：已完成或无截止日时返回 null（不展示任何徽标）。
 * 未完成 overdue 走红色系，today / soon 走中性提示，其余为 none。
 */
export function subtaskUrgencyOf(child: Task, today: string): SubtaskUrgency {
  const endDate = child.schedule.endDate;
  if (endDate === null || child.childDoneAt != null) return null;
  const diff = daysBetweenKeys(today, endDate);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  return "none";
}

// ─────────────────────────────── 内部工具 ───────────────────────────────

/** 就地替换一条任务；id 不存在时原样返回（不制造无意义的新数组） */
function patchTask(tasks: Task[], id: string, transform: (task: Task) => Task): Task[] {
  let hit = false;
  const next = tasks.map((task) => {
    if (task.id !== id) return task;
    hit = true;
    return transform(task);
  });
  return hit ? next : tasks;
}

// ─────────────────────────────── 关系写入（双写收口） ───────────────────────────────

/**
 * 把 childId 加进任务集：先从其他任务集里摘掉以保证唯一归属，再同步维护双方的 children 与 parentId。
 * 非法目标（父不是 composite、子不存在、子自己是 composite、自己收录自己）一律原样返回。
 */
export function attachSubtask(tasks: Task[], parentId: string, childId: string): Task[] {
  const parent = tasks.find((task) => task.id === parentId);
  if (parent === undefined || !isComposite(parent)) return tasks;
  const child = tasks.find((task) => task.id === childId);
  if (child === undefined || child.id === parentId) return tasks;
  // 只两级：任务集自身不能当别人的子任务
  if (isComposite(child)) return tasks;

  let next = tasks;
  // 唯一归属：先从别处摘掉
  for (const other of tasks) {
    if (other.id === parentId || !isComposite(other)) continue;
    if (!childIdsOf(other).includes(childId)) continue;
    next = patchTask(next, other.id, (task) => ({
      ...task,
      children: childIdsOf(task).filter((id) => id !== childId),
    }));
  }

  const current = next.find((task) => task.id === parentId);
  if (current === undefined) return tasks;
  const kept = childIdsOf(current).filter((id) => id !== childId && id !== parentId);
  next = patchTask(next, parentId, (task) => ({ ...task, children: [...kept, childId] }));
  return patchTask(next, childId, (task) => ({ ...task, parentId, kind: "single" }));
}

/**
 * 从任务集摘掉 childId：children 移除该项 + child.parentId 置 null。
 * 子任务随即「降级」回普通顶层任务 —— 幂等、零残留。
 */
export function detachSubtask(tasks: Task[], parentId: string, childId: string): Task[] {
  const parent = tasks.find((task) => task.id === parentId);
  if (parent === undefined || !isComposite(parent)) return tasks;
  if (!childIdsOf(parent).includes(childId)) return tasks;
  const next = patchTask(tasks, parentId, (task) => ({
    ...task,
    children: childIdsOf(task).filter((id) => id !== childId),
  }));
  return patchTask(next, childId, (task) => ({ ...task, parentId: null }));
}

/**
 * 拖拽后写回顺序：按 orderedIds 重排该父的 children（成员不变，parentId 无需改动）。
 * orderedIds 里可以只给出部分 id —— 未出现的保持相对顺序排在其后。
 */
export function reorderSubtasks(tasks: Task[], parentId: string, orderedIds: string[]): Task[] {
  const parent = tasks.find((task) => task.id === parentId);
  if (parent === undefined || !isComposite(parent)) return tasks;
  const existing = childIdsOf(parent);
  const head: string[] = [];
  for (const id of orderedIds) {
    if (!existing.includes(id) || head.includes(id)) continue;
    head.push(id);
  }
  const tail = existing.filter((id) => !head.includes(id));
  return patchTask(tasks, parentId, (task) => ({ ...task, children: [...head, ...tail] }));
}

// ─────────────────────────────── 载入 / 导入后的一次性自愈 ───────────────────────────────

/**
 * 以 children 为准，全量重建每一条任务的 parentId。
 * 挂在载入与导入合并之后（与 sortTasksByCreatedAt 并列），跑完内存里两份数据保证一致。
 *
 * 三步：
 *   1. 每个 composite 的 children 过滤掉幽灵 id / 自身 id / 另一个 composite（保序 + 去重）；
 *   2. 按 children 建 (childId -> parentId) 映射，重复归属时按 tasks 数组序取第一个；
 *   3. 全表每条任务写 parentId = 映射值 ?? null。
 *
 * 这是「全覆盖」的重建，因此任何中途的对不上都会被自愈而不是累积成脏数据：
 * 任何没能被收录的任务都降级回普通顶层任务，**不会消失**。
 */
export function syncChildrenIndex(tasks: Task[]): Task[] {
  const map = buildTaskMap(tasks);
  const childToParent = new Map<string, string>();
  const keptByParent = new Map<string, string[]>();

  for (const task of tasks) {
    if (!isComposite(task) || keptByParent.has(task.id)) continue;
    const kept: string[] = [];
    for (const id of childIdsOf(task)) {
      if (id === task.id) continue;
      const child = map.get(id);
      if (child === undefined || isComposite(child)) continue;
      if (kept.includes(id) || childToParent.has(id)) continue;
      childToParent.set(id, task.id);
      kept.push(id);
    }
    keptByParent.set(task.id, kept);
  }

  return tasks.map((task) => {
    if (isComposite(task)) {
      return { ...task, children: keptByParent.get(task.id) ?? [], parentId: null, childDoneAt: null };
    }
    const parentId = childToParent.get(task.id) ?? null;
    return {
      ...task,
      kind: "single",
      children: undefined,
      parentId,
      childDoneAt: parentId === null ? null : (task.childDoneAt ?? null),
    };
  });
}

// ─────────────────────────────── 完成状态推导 ───────────────────────────────

/**
 * 按 children 当前状态重算父任务的完成态（新增/删除子任务、导入之后调用）。
 *
 * 推导规则（docs 4.1）：
 *   - 全部子任务 childDoneAt !== null → 父 completedAt = 各 childDoneAt 的最大日期，
 *     并在父 instances 写入该天；
 *   - 任一未完成 → 父 completedAt 清零，并删掉上一次推导写入的那条 instances；
 *   - 空任务集（children 为空）没有可推导的事实，保持原样不动。
 *
 * 只维护「推导出的完成日」这一个键：previous = parent.completedAt 即上次推导写入的那天。
 */
export function deriveCompositeCompletion(tasks: Task[], parentId: string): Task[] {
  const parent = tasks.find((task) => task.id === parentId);
  if (parent === undefined || !isComposite(parent)) return tasks;
  const children = childTasksOf(buildTaskMap(tasks), parent);
  if (children.length === 0) return tasks;

  const instances = { ...parent.instances };
  const previous = parent.completedAt;
  if (previous !== null) delete instances[previous];

  const doneOnes = children.filter((child) => child.childDoneAt != null);
  if (doneOnes.length !== children.length) {
    return patchTask(tasks, parentId, () => ({ ...parent, instances, completedAt: null }));
  }

  // childDoneAt 一律是 new Date().toISOString()（UTC Z 结尾），字典序等价于时间序
  const latest = doneOnes.reduce<string>((acc, child) => {
    const value = child.childDoneAt ?? "";
    return value > acc ? value : acc;
  }, "");
  const completionDate = latest.slice(0, 10);
  if (completionDate.length === 0) return tasks;

  instances[completionDate] = { done: true, doneAt: latest };
  return patchTask(tasks, parentId, () => ({ ...parent, instances, completedAt: completionDate }));
}

/** 勾选 / 取消单个子任务（写 childDoneAt），并同步推导父任务的 completedAt 与 instances */
export function toggleSubtask(
  tasks: Task[],
  parentId: string,
  childId: string,
  done: boolean,
  doneAt: string,
): Task[] {
  const parent = tasks.find((task) => task.id === parentId);
  if (parent === undefined || !isComposite(parent)) return tasks;
  if (!childIdsOf(parent).includes(childId)) return tasks;
  const next = patchTask(tasks, childId, (task) => ({
    ...task,
    childDoneAt: done ? doneAt : null,
  }));
  return deriveCompositeCompletion(next, parentId);
}

// ─────────────────────────────── DDL 收敛 ───────────────────────────────

/**
 * 单个子任务截止日在父区间内的收敛值。
 * 表单（即时裁剪）与落盘前（clampSubtaskDueDates）共用这一份规则，避免两处实现打架。
 *
 * - 父无截止日：子任务可有可无截止日，有值时不能早于父 startDate；
 * - 父有截止日：子任务必填，且必须落在 [父 startDate, 父 endDate] 内。
 */
export function clampEndDateWithin(
  current: string | null,
  parentStart: string,
  parentEnd: string | null,
): string | null {
  if (parentEnd === null) {
    return current !== null && current < parentStart ? parentStart : current;
  }
  if (current === null) return parentEnd;
  if (current < parentStart) return parentStart;
  if (current > parentEnd) return parentEnd;
  return current;
}

/** 把越界的子任务截止日收敛到父区间内，返回修改后的全表与受影响条数 */
export function clampSubtaskDueDates(
  tasks: Task[],
  parent: Task,
  parentStart: string,
  parentEnd: string | null,
): { tasks: Task[]; adjustedCount: number } {
  const ids = childIdsOf(parent);
  if (ids.length === 0) return { tasks, adjustedCount: 0 };

  let next = tasks;
  let adjustedCount = 0;
  for (const id of ids) {
    const child = next.find((task) => task.id === id);
    if (child === undefined) continue;
    const current = child.schedule.endDate;
    const clamped = clampEndDateWithin(current, parentStart, parentEnd);
    if (clamped === current) continue;
    adjustedCount += 1;
    const target: string | null = clamped;
    next = patchTask(next, id, (task) => ({
      ...task,
      schedule: { ...task.schedule, endDate: target },
    }));
  }
  return { tasks: next, adjustedCount };
}

// ─────────────────────────────── 收编既有任务（右键菜单入口）───────────────────────────────

/**
 * 把一条**已经存在**的普通任务收编进任务集（右键菜单「添加到任务集」走这条）。
 *
 * 除了 attachSubtask 的关系写入，还要做三件「入列对齐」，否则收编进来的任务
 * 会和任务集的其他规则打架：
 *   1. 截止日收敛到父区间、起始日不早于父起始日 —— 与表单落盘共用 clampEndDateWithin；
 *   2. 已经完成的普通任务补写 childDoneAt（日期沿用它的 completedAt），
 *      否则父的完成推导（只看 childDoneAt）永远算不出它已完成；
 *   3. 重跑父的完成推导。
 *
 * 已经是该任务集成员时幂等返回原表 —— 避免「点一次就被挪到列表末尾」。
 */
export function attachExistingTask(tasks: Task[], parentId: string, childId: string): Task[] {
  const parent = tasks.find((task) => task.id === parentId);
  if (parent === undefined || !isComposite(parent)) return tasks;
  if (childIdsOf(parent).includes(childId)) return tasks;

  const attached = attachSubtask(tasks, parentId, childId);
  if (attached === tasks) return tasks;

  const parentStart = parent.schedule.startDate;
  const parentEnd = parent.schedule.endDate;
  const aligned = patchTask(attached, childId, (task) => ({
    ...task,
    schedule: {
      ...task.schedule,
      startDate: task.schedule.startDate < parentStart ? parentStart : task.schedule.startDate,
      endDate: clampEndDateWithin(task.schedule.endDate, parentStart, parentEnd),
    },
    // 原本就完成的跨天一次性任务沿用原日期，历史格子与父的推导才对得上
    childDoneAt:
      task.childDoneAt ?? (task.completedAt === null ? null : `${task.completedAt}T00:00:00.000Z`),
  }));
  return deriveCompositeCompletion(aligned, parentId);
}

// ─────────────────────────────── 表单草稿落盘 ───────────────────────────────

/**
 * 把复合任务表单的子任务草稿落到数据上：新增 / 改名 / 改截止日 / 硬删除 + 最终顺序。
 * 调用方需先自行把父任务的 title / note / schedule / reminder 写好（applyTaskEdit）。
 *
 * newIds 的长度必须 ≥ 草稿里「无 id」的条数（id 由调用方生成，保持本层无副作用）。
 */
export function applyCompositeSubtasks(
  tasks: Task[],
  parentId: string,
  drafts: SubtaskDraft[],
  newIds: string[],
  parentStart: string,
  createdAt: string,
): Task[] {
  const parent = tasks.find((task) => task.id === parentId);
  if (parent === undefined || !isComposite(parent)) return tasks;

  const existing = childIdsOf(parent);
  const keptIds = new Set(
    drafts.map((draft) => draft.id).filter((id): id is string => id !== undefined),
  );

  let next = tasks;
  // 1) 草稿里没出现 = 用户删掉了：摘关系 + 从数组里硬删除。
  for (const id of existing) {
    if (keptIds.has(id)) continue;
    next = detachSubtask(next, parentId, id);
  }
  const deletedIds = existing.filter((id) => !keptIds.has(id));
  if (deletedIds.length > 0) {
    const removeSet = new Set(deletedIds);
    next = next.filter((task) => !removeSet.has(task.id));
  }

  // 2) 按草稿顺序更新既有、创建新增
  let cursor = 0;
  const order: string[] = [];
  for (const draft of drafts) {
    if (draft.id !== undefined) {
      const current = next.find((task) => task.id === draft.id);
      if (current === undefined) continue;
      order.push(draft.id);
      const startDate =
        current.schedule.startDate < parentStart ? parentStart : current.schedule.startDate;
      next = patchTask(next, draft.id, (task) => ({
        ...task,
        title: draft.title,
        note: draft.note,
        schedule: { ...task.schedule, startDate, endDate: draft.endDate },
      }));
      continue;
    }

    const id = newIds[cursor];
    if (id === undefined) continue;
    cursor += 1;
    order.push(id);
    next = [
      ...next,
      {
        id,
        title: draft.title,
        note: draft.note,
        createdAt,
        schedule: { type: "once", startDate: parentStart, endDate: draft.endDate, weekdays: [] },
        instances: {},
        reminder: { enabled: false, time: "09:00" },
        archived: false,
        completedAt: null,
        kind: "single",
        children: undefined,
        parentId,
        childDoneAt: null,
      },
    ];
  }

  next = patchTask(next, parentId, (task) => ({ ...task, kind: "composite", children: order }));
  return deriveCompositeCompletion(next, parentId);
}

/**
 * 在既有任务集里追加单条子任务（主页展开区「+」入口用）。
 * 与 applyCompositeSubtasks 走同一条子任务构造口径：周期恒 once、起始 = 父起始、
 * 截止 = clampEndDateWithin(null, 父起始, 父截止)（父有截止日时填父截止日，无则留空）。
 * 完成态由 deriveCompositeCompletion 自动重算。
 */
export function addSubtask(
  tasks: Task[],
  parentId: string,
  childId: string,
  title: string,
  createdAt: string,
): Task[] {
  const parent = tasks.find((task) => task.id === parentId);
  if (parent === undefined || !isComposite(parent)) return tasks;
  const parentStart = parent.schedule.startDate;
  const parentEnd = parent.schedule.endDate;
  const endDate = clampEndDateWithin(null, parentStart, parentEnd);
  const child: Task = {
    id: childId,
    title,
    note: "",
    createdAt,
    schedule: { type: "once", startDate: parentStart, endDate, weekdays: [] },
    instances: {},
    reminder: { enabled: false, time: "09:00" },
    archived: false,
    completedAt: null,
    kind: "single",
    children: undefined,
    parentId,
    childDoneAt: null,
  };
  const appended = [...tasks, child];
  const patched = patchTask(appended, parentId, (task) => ({
    ...task,
    kind: "composite",
    children: [...childIdsOf(parent), childId],
  }));
  return deriveCompositeCompletion(patched, parentId);
}

/** 复合任务表单的整体提交入口：父字段 + 子任务群一起落 */
export function applyCompositeEdit(
  tasks: Task[],
  parentId: string,
  edit: CompositeEdit,
  newIds: string[],
  createdAt: string,
): Task[] {
  const patch = (task: Task): Task => ({
    ...task,
    title: edit.title,
    note: edit.note,
    schedule: edit.schedule,
    reminder: edit.reminder,
    kind: "composite",
  });
  let next = patchTask(tasks, parentId, patch);
  const parentAfterEdit = next.find((task) => task.id === parentId);
  if (parentAfterEdit === undefined) return tasks;
  const clamped = clampSubtaskDueDates(
    next,
    parentAfterEdit,
    edit.schedule.startDate,
    edit.schedule.endDate,
  );
  return applyCompositeSubtasks(
    clamped.tasks,
    parentId,
    edit.subtasks,
    newIds,
    edit.schedule.startDate,
    createdAt,
  );
}
