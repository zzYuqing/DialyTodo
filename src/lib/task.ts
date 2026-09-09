// 职责：任务的不可变变换。全部为纯函数，返回新对象，不修改入参。

import type { CreateTaskInput, Reminder, Schedule, Task, TaskEdit } from "@/types";
import { nowIso } from "./date";

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
 * 「once + endDate」扩展（DDL 任务）：勾选时同步设置 completedAt = dateKey（永久完成）；
 * 取消勾选时清零 completedAt。其他模式按原语义工作。
 */
export function toggleTaskDone(task: Task, dateKey: string, done: boolean): Task {
  const instances = { ...task.instances };
  const isDdlOnce = task.schedule.type === "once" && task.schedule.endDate !== null;

  if (done) {
    instances[dateKey] = { done: true, doneAt: nowIso() };
    if (isDdlOnce) return { ...task, instances, completedAt: dateKey };
    return { ...task, instances };
  }

  delete instances[dateKey];
  if (isDdlOnce) return { ...task, instances, completedAt: null };
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

/** 删除即归档：置 archived = true，保留 instances 历史，贡献墙不会缺洞（提示词 5.1） */
export function archiveTask(task: Task): Task {
  return { ...task, archived: true };
}

/** 从归档列表恢复 */
export function restoreTask(task: Task): Task {
  return { ...task, archived: false };
}

/** 应用表单提交值：一次性写入 title / note / schedule / reminder（避免多次落盘） */
export function applyTaskEdit(task: Task, edit: TaskEdit): Task {
  return { ...task, title: edit.title, note: edit.note, schedule: edit.schedule, reminder: edit.reminder };
}

/** 按创建时间升序排列，保证列表顺序稳定 */
export function sortTasksByCreatedAt(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
