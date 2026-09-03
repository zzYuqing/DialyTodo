// 职责：任务数据的单一数据源（提示词 3.4）。
// 组件只发 action，不直接改数据；所有变更先经 lib/ 的纯函数变换，再落盘。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  applyTaskEdit,
  archiveTask,
  createTask,
  restoreTask,
  sortTasksByCreatedAt,
  toggleTaskDone,
  todayKey,
} from "@/lib";
import { dailyBackup, loadTasks, saveTasks } from "@/services";
import type { CreateTaskInput, Task, TaskEdit } from "@/types";

interface TaskState {
  tasks: Task[];
  loaded: boolean;
  /** 启动加载时产生的提示信息，null 表示无异常 */
  loadError: string | null;
  /** 启动加载：读主文件，损坏则回退备份；成功后执行每日一次备份 */
  initialize: () => Promise<void>;
  addTask: (input: CreateTaskInput) => Promise<void>;
  updateTask: (id: string, edit: TaskEdit) => Promise<void>;
  setDone: (id: string, dateKey: string, done: boolean) => Promise<void>;
  /** 删除语义为归档（提示词 5.1） */
  removeTask: (id: string) => Promise<void>;
  restoreArchived: (id: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>()(
  devtools((set, get) => ({
    tasks: [],
    loaded: false,
    loadError: null,

    async initialize() {
      const { result, tasks } = await loadTasks();
      set({ tasks: sortTasksByCreatedAt(tasks), loaded: true, loadError: result.error });

      // 只在数据可用时才备份，避免把损坏数据写进备份
      if (result.ok) await dailyBackup(todayKey());
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
      const next = get().tasks.map((task) => (task.id === id ? archiveTask(task) : task));
      set({ tasks: next });
      await saveTasks(next);
    },

    async restoreArchived(id) {
      const next = get().tasks.map((task) => (task.id === id ? restoreTask(task) : task));
      set({ tasks: next });
      await saveTasks(next);
    },
  })),
);
