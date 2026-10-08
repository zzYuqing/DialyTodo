// 职责：经验数据与分类的单一数据源（与 useTaskStore 同构：组件只发 action）。
// 所有变更经 experienceService 原子落盘；分类与经验同存一份 experiences.json。
// 分类增删改序的约束由上层保证：本层只负责照做，不校验「是否有记录引用」。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { generateTaskId, nowIso } from "@/lib";
import {
  DEFAULT_CATEGORIES,
  loadExperiences,
  saveExperiences,
} from "@/services";
import type { Experience, ExperienceAttachment, ExperienceCategory } from "@/types";

export interface NewExperienceInput {
  /**
   * 新增时可指定 id：附件在落库前就已复制到 <数据根>/experiences/attachments/<id>，
   * 落库必须沿用同一个 id，否则会出现「文件在但记录指不到」的错位。缺省时自行生成。
   */
  id?: string;
  date: string;
  category: string;
  title: string;
  content: string;
  attachments?: ExperienceAttachment[];
}

/** 分类可改部分：改名与换色，两者独立提交 */
export interface CategoryPatch {
  name?: string;
  color?: string;
}

interface ExperienceState {
  experiences: Experience[];
  categories: ExperienceCategory[];
  loaded: boolean;
  initialize: () => Promise<void>;
  addExperience: (input: NewExperienceInput) => Promise<void>;
  updateExperience: (id: string, patch: Partial<NewExperienceInput>) => Promise<void>;
  removeExperience: (id: string) => Promise<void>;
  /** 从回收站还原整条经验（含其附件数组）：同名 id 已存在则跳过，避免重复还原 */
  restoreExperience: (exp: Experience) => Promise<void>;
  addCategory: (name: string, color: string) => Promise<void>;
  updateCategory: (id: string, patch: CategoryPatch) => Promise<void>;
  removeCategory: (id: string) => Promise<void>;
  /** direction: -1 上移、-2… 实际只取 ±1；已在边界时原样返回 */
  moveCategory: (id: string, direction: -1 | 1) => Promise<void>;
}

export const useExperienceStore = create<ExperienceState>()(
  devtools((set, get) => {
    /** 分类变更的统一出口：更新内存后立即落盘，避免各 action 重复这段 */
    const commitCategories = async (next: ExperienceCategory[]) => {
      set({ categories: next });
      await saveExperiences(next, get().experiences);
    };

    return {
      experiences: [],
      categories: DEFAULT_CATEGORIES,
      loaded: false,

      async initialize() {
        const { categories, experiences } = await loadExperiences();
        set({ categories, experiences, loaded: true });
      },

      async addExperience(input) {
        const ts = nowIso();
        const exp: Experience = {
          id: input.id ?? generateTaskId(),
          date: input.date,
          category: input.category,
          title: input.title.trim(),
          content: input.content,
          attachments: input.attachments ?? [],
          createdAt: ts,
          updatedAt: ts,
        };
        const next = [...get().experiences, exp];
        set({ experiences: next });
        await saveExperiences(get().categories, next);
      },

      async updateExperience(id, patch) {
        const next = get().experiences.map((e) =>
          e.id === id ? { ...e, ...patch, updatedAt: nowIso() } : e,
        );
        set({ experiences: next });
        await saveExperiences(get().categories, next);
      },

      async removeExperience(id) {
        // 软删除：仅从经验数组移除并落盘。磁盘附件目录保留，由回收站在彻底删除 / 过期时清理，
        // 这样删除经验后附件文件不会立刻消失，仍可在回收站里还原整条经验（含附件）。
        const next = get().experiences.filter((e) => e.id !== id);
        set({ experiences: next });
        await saveExperiences(get().categories, next);
      },

      async restoreExperience(exp) {
        // 还原整条经验（含其 attachments 数组）；id 已存在则跳过，避免重复还原
        if (get().experiences.some((e) => e.id === exp.id)) return;
        const next = [...get().experiences, exp];
        set({ experiences: next });
        await saveExperiences(get().categories, next);
      },

      async addCategory(name, color) {
        const trimmed = name.trim();
        if (trimmed.length === 0) return;
        const cat: ExperienceCategory = { id: generateTaskId(), name: trimmed, color };
        await commitCategories([...get().categories, cat]);
      },

      async updateCategory(id, patch) {
        let touched = false;
        const next = get().categories.map((c) => {
          if (c.id !== id) return c;
          const name = patch.name === undefined ? c.name : patch.name.trim();
          // 空名视为放弃改名，保留原值，避免落成一个无法辨认的分类
          const safeName = name.length > 0 ? name : c.name;
          const merged: ExperienceCategory = { ...c, name: safeName, color: patch.color ?? c.color };
          touched = true;
          return merged;
        });
        if (!touched) return;
        await commitCategories(next);
      },

      async removeCategory(id) {
        const next = get().categories.filter((c) => c.id !== id);
        if (next.length === get().categories.length) return;
        await commitCategories(next);
      },

      async moveCategory(id, direction) {
        const list = get().categories;
        const from = list.findIndex((c) => c.id === id);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= list.length) return;
        const next = [...list];
        [next[from], next[to]] = [next[to], next[from]];
        await commitCategories(next);
      },
    };
  }),
);
