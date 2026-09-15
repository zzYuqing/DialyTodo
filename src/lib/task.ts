// 职责：任务的不可变变换。全部为纯函数，返回新对象，不修改入参。

import type { CreateTaskInput, Reminder, Schedule, Task, TaskEdit } from "@/types";
import { nowIso } from "./date";
import { isActiveDdlTask, isLongTermOnce } from "./ddl";

/** 生成任务 ID。使用 WebView2 内置的 crypto.randomUUID，不引入 uuid 依赖。 */
export function generateTaskId(): string {
  return crypto.randomUUID();
}

/** 新建任务。id 允许注入，便于测试。 */
export function createTask(input: CreateTaskInput, id: string = generateTaskId()): Task {
  return {
    id,
    title: input.title,
    note: input.note,
    createdAt: nowIso(),
    schedule: input.schedule,
    instances: {},
    reminder: input.reminder,
    archived: false,
    completedAt: null,
  };
}

/**
 * 切换某一天的完成状态。
 * 取消完成时直接删除 instances 里的日期键，避免无限累积无效记录（沿用上一版设计）。
 *
 * 跨天的一次性长期任务判定统一走 ddl.ts 的 isLongTermOnce（once 且 endDate ≠ startDate，
 * 含 endDate === null 的「未指定截止日」长期任务）：
 * 勾选时同步设置 completedAt = dateKey（永久完成，此后不再出现在未来日期）；
 * 取消勾选时清零 completedAt（任务重新回到每天待办）。
 * 起止同日的 once 任务是单日任务，不写 completedAt。其他周期类型按原语义逐日记录。
 */
export function toggleTaskDone(task: Task, dateKey: string, done: boolean): Task {
  const instances = { ...task.instances };
  const isLongOnce = isLongTermOnce(task.schedule);

  if (done) {
    instances[dateKey] = { done: true, doneAt: nowIso() };
    if (isLongOnce) return { ...task, instances, completedAt: dateKey };
    return { ...task, instances };
  }

  delete instances[dateKey];
  if (isLongOnce) return { ...task, instances, completedAt: null };
  return { ...task, instances };
}

/** 判断任务在某一天是否已完成 */
export function isDoneOn(task: Task, dateKey: string): boolean {
  return task.instances[dateKey]?.done === true;
}

/** 更新任务的标题与描述 */
export function updateTaskText(task: Task, title: string, note: string): Task {
  return { ...task, title, note };
}

/** 更新任务的周期规则 */
export function updateTaskSchedule(task: Task, schedule: Schedule): Task {
  return { ...task, schedule };
}

/** 更新任务的提醒设置 */
export function updateTaskReminder(task: Task, reminder: Reminder): Task {
  return { ...task, reminder };
}

/** 应用表单提交值：一次性写入 title / note / schedule / reminder（避免多次落盘） */
export function applyTaskEdit(task: Task, edit: TaskEdit): Task {
  return { ...task, title: edit.title, note: edit.note, schedule: edit.schedule, reminder: edit.reminder };
}

/** 按创建时间升序排列，保证列表顺序稳定 */
export function sortTasksByCreatedAt(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 日清单里「未完成任务」的排序：手动排过序的（order 为数字）按升序在前，
 * 没排过的走默认规则 —— 活跃 DDL 置顶，其余保持创建顺序。
 *
 * 分段而非统一 comparator 的原因：order 只覆盖用户真正拖过的那部分，
 * 存量任务（order 缺失）仍要享受 DDL 置顶，两者不能混在一起比较。
 * 已完成的任务不进本函数，由调用方统一沉底。
 */
export function sortUnfinishedTasks(tasks: Task[]): Task[] {
  const manual: Task[] = [];
  const ddl: Task[] = [];
  const rest: Task[] = [];
  for (const task of tasks) {
    if (typeof task.order === "number") manual.push(task);
    else if (isActiveDdlTask(task)) ddl.push(task);
    else rest.push(task);
  }
  manual.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return [...manual, ...ddl, ...rest];
}
