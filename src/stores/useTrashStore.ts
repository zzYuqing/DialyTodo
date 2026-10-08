// 职责：回收站数据的单一数据源（与任务 / 经验 store 同构：组件只发 action）。
// 删除动作统一从这里入口：把被删数据的整份快照写入 trash.json，并保留磁盘文件；
// 还原把快照写回原 store；彻底删除（手动 / 过期扫描）才真正清盘。
// 直接 import 兄弟 store 文件以避免经 @/stores 桶形成循环依赖。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { generateTaskId, isComposite } from "@/lib";
import { SCHEDULE_TYPE_LABELS } from "@/constants";
import {
  addTrashEntries,
  purgeEntriesDisk,
  removeTrashEntries,
  saveTrash,
  sweepTrash,
} from "@/services";
import type { CompositeEdit, ExperienceAttachment, Task, TrashEntry } from "@/types";
import { useTaskStore } from "./useTaskStore";
import { useExperienceStore } from "./useExperienceStore";
import { useSettingsStore } from "./useSettingsStore";

interface TrashState {
  entries: TrashEntry[];
  loaded: boolean;
  /** 启动加载 + 过期扫描（依赖设置里的保留天数，需 settings 先初始化） */
  initialize: () => Promise<void>;
  /** 进入回收站视图时再扫一次：清掉已过期条目（同时清盘），刷新剩余项的过期文案 */
  sweep: () => Promise<void>;
  /** 任务（含任务集的子任务）移入回收站：先软删主数组，再写快照 */
  moveTaskToTrash: (id: string) => Promise<void>;
  /** 整条经验移入回收站：软删经验数组（保留磁盘附件），再写快照 */
  moveExperienceToTrash: (id: string) => Promise<void>;
  /** 单条附件移入回收站：直接收附件对象（调用方已从经验里摘掉），避免删后再从 store 反查找不到 */
  moveAttachmentToTrash: (expId: string, attachment: ExperienceAttachment) => Promise<void>;
  /** 单个子任务移入回收站：先快照（含父任务集引用与原始位置），再摘关系 + 移出主数组 */
  moveSubtaskToTrash: (parentId: string, childId: string) => Promise<void>;
  /** 编辑任务集后，草稿里消失而被连带删除的子任务同样进回收站 */
  updateCompositeWithTrash: (id: string, edit: CompositeEdit) => Promise<void>;
  /** 还原一条目回原 store */
  restore: (id: string) => Promise<void>;
  /** 彻底删除一条目（清盘） */
  purge: (id: string) => Promise<void>;
  /** 清空回收站（全部清盘） */
  empty: () => Promise<void>;
}

export const useTrashStore = create<TrashState>()(
  devtools((set, get) => ({
    entries: [],
    loaded: false,

    async initialize() {
      const retention = useSettingsStore.getState().settings.trashRetentionDays;
      const kept = await sweepTrash(retention);
      set({ entries: kept, loaded: true });
    },

    async sweep() {
      const retention = useSettingsStore.getState().settings.trashRetentionDays;
      const kept = await sweepTrash(retention);
      set({ entries: kept });
    },

    async moveTaskToTrash(id) {
      const taskStore = useTaskStore.getState();
      const parent = taskStore.tasks.find((t) => t.id === id);
      if (parent === undefined) return;
      // 任务集：连同其全部子任务一起移入（子任务不在主数组里会降级回普通任务重新冒出）
      const removed: Task[] = isComposite(parent)
        ? taskStore.tasks.filter((t) => t.id === id || (parent.children ?? []).includes(t.id))
        : [parent];
      await taskStore.removeTask(id);
      const entry: TrashEntry = {
        id: generateTaskId(),
        kind: "task",
        deletedAt: Date.now(),
        name: parent.title,
        source: `任务 · ${SCHEDULE_TYPE_LABELS[parent.schedule.type]}`,
        tasks: removed,
      };
      const merged = await addTrashEntries([entry]);
      set({ entries: merged });
    },

    async moveExperienceToTrash(id) {
      const expStore = useExperienceStore.getState();
      const exp = expStore.experiences.find((e) => e.id === id);
      if (exp === undefined) return;
      // 软删：仅从经验数组移除并落盘，磁盘附件目录保留到回收站彻底清除时
      await expStore.removeExperience(id);
      const entry: TrashEntry = {
        id: generateTaskId(),
        kind: "experience",
        deletedAt: Date.now(),
        name: exp.title,
        source: `经验 · ${exp.date}`,
        experience: exp,
      };
      const merged = await addTrashEntries([entry]);
      set({ entries: merged });
    },

    async moveAttachmentToTrash(expId, attachment) {
      // 调用方传入的已是附件对象本身，不再从 store 反查（经验此刻可能已移除该附件）
      const expTitle =
        useExperienceStore.getState().experiences.find((e) => e.id === expId)?.title ?? "";
      const entry: TrashEntry = {
        id: generateTaskId(),
        kind: "attachment",
        deletedAt: Date.now(),
        name: attachment.name,
        source: `经验「${expTitle}」`,
        attachment: { expId, expTitle, attachment },
      };
      const merged = await addTrashEntries([entry]);
      set({ entries: merged });
    },

    async moveSubtaskToTrash(parentId, childId) {
      const taskStore = useTaskStore.getState();
      const parent = taskStore.tasks.find((t) => t.id === parentId);
      const child = taskStore.tasks.find((t) => t.id === childId);
      if (parent === undefined || child === undefined) return;
      // 先快照（含原始位置），再摘关系 + 移出主数组 —— 顺序反了就取不到 parentId / children
      const rawIndex = (parent.children ?? []).indexOf(childId);
      await taskStore.removeSubtask(parentId, childId);
      const entry: TrashEntry = {
        id: generateTaskId(),
        kind: "subtask",
        deletedAt: Date.now(),
        name: child.title,
        source: `任务集「${parent.title}」的子任务`,
        subtask: {
          parentId,
          parentTitle: parent.title,
          index: rawIndex < 0 ? 0 : rawIndex,
          task: child,
        },
      };
      const merged = await addTrashEntries([entry]);
      set({ entries: merged });
    },

    async updateCompositeWithTrash(id, edit) {
      const removed = await useTaskStore.getState().updateComposite(id, edit);
      if (removed.length === 0) return;
      const now = Date.now();
      const entries: TrashEntry[] = removed.map((snapshot) => ({
        id: generateTaskId(),
        kind: "subtask",
        deletedAt: now,
        name: snapshot.task.title,
        source: `任务集「${snapshot.parentTitle}」的子任务`,
        subtask: snapshot,
      }));
      const merged = await addTrashEntries(entries);
      set({ entries: merged });
    },

    async restore(id) {
      const entry = get().entries.find((e) => e.id === id);
      if (entry === undefined) return;

      if (entry.kind === "task" && entry.tasks !== undefined) {
        await useTaskStore.getState().restoreTasks(entry.tasks);
      } else if (entry.kind === "experience" && entry.experience !== undefined) {
        await useExperienceStore.getState().restoreExperience(entry.experience);
      } else if (entry.kind === "attachment" && entry.attachment !== undefined) {
        const expStore = useExperienceStore.getState();
        const exp = expStore.experiences.find((e) => e.id === entry.attachment!.expId);
        // 原经验已删除：附件无法单独还原，保持回收站条目不动（UI 已禁用还原按钮）
        if (exp === undefined) return;
        await expStore.updateExperience(entry.attachment.expId, {
          attachments: [...exp.attachments, entry.attachment.attachment],
        });
      } else if (entry.kind === "subtask" && entry.subtask !== undefined) {
        const taskStore = useTaskStore.getState();
        const parent = taskStore.tasks.find((t) => t.id === entry.subtask!.parentId);
        // 原任务集已删除：子任务无处可挂，保持回收站条目不动（UI 已禁用还原按钮）
        if (parent === undefined) return;
        await taskStore.restoreSubtask(
          entry.subtask.parentId,
          entry.subtask.task,
          entry.subtask.index,
        );
      } else {
        return;
      }

      const kept = await removeTrashEntries([id]);
      set({ entries: kept });
    },

    async purge(id) {
      const entry = get().entries.find((e) => e.id === id);
      if (entry === undefined) return;
      await purgeEntriesDisk([entry]);
      const kept = await removeTrashEntries([id]);
      set({ entries: kept });
    },

    async empty() {
      const purged = get().entries;
      if (purged.length === 0) return;
      await purgeEntriesDisk(purged);
      await saveTrash([]);
      set({ entries: [] });
    },
  })),
);
