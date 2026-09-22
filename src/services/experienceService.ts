// 职责：experiences.json 的原子读写（经验记录 + 分类）。
// 与 tasks.json 同构：{ version, categories, experiences }；损坏按空启动
// （经验属非关键数据，不做备份兜底，下次写入自然覆盖）。

import { join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { CATEGORY_COLORS, CURRENT_VERSION } from "@/constants";
import { ensureDirectories, dataRoot } from "./paths";
import { atomicWrite } from "./atomicWrite";
import type { Experience, ExperienceCategory, ExperienceFile } from "@/types";

const EXPERIENCE_FILE = "experiences.json";

// 预置分类：覆盖最常见的几类经验沉淀场景，首启即带。
// 颜色取自 CATEGORY_COLORS 前 5 位，id 与既有数据保持一致，调整色板顺序会改变这里的外观。
export const DEFAULT_CATEGORIES: ExperienceCategory[] = [
  { id: "bug", name: "重大 Bug", color: CATEGORY_COLORS[0] },
  { id: "architecture", name: "架构决策", color: CATEGORY_COLORS[1] },
  { id: "ops", name: "运维事故", color: CATEGORY_COLORS[2] },
  { id: "pitfall", name: "踩坑记录", color: CATEGORY_COLORS[3] },
  { id: "other", name: "其他", color: CATEGORY_COLORS[4] },
];

async function experienceFilePath(): Promise<string> {
  return join(await dataRoot(), EXPERIENCE_FILE);
}

export interface LoadExperiencesResult {
  categories: ExperienceCategory[];
  experiences: Experience[];
}

/** 启动加载：文件缺失或结构非法均按「首次启动」处理（预置分类 + 空记录） */
export async function loadExperiences(): Promise<LoadExperiencesResult> {
  await ensureDirectories();
  const path = await experienceFilePath();
  if (!(await exists(path))) {
    return { categories: DEFAULT_CATEGORIES, experiences: [] };
  }
  try {
    const parsed: unknown = JSON.parse(await readTextFile(path));
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Partial<ExperienceFile>;
      const categories =
        Array.isArray(record.categories) && record.categories.length > 0
          ? record.categories
          : DEFAULT_CATEGORIES;
      const experiences = Array.isArray(record.experiences) ? record.experiences : [];
      return { categories, experiences };
    }
  } catch {
    // 文件损坏：按空启动，下次写入覆盖（经验数据非关键，不做备份兜底）
  }
  return { categories: DEFAULT_CATEGORIES, experiences: [] };
}

/** 保存全部经验与分类（原子写入） */
export async function saveExperiences(
  categories: ExperienceCategory[],
  experiences: Experience[],
): Promise<void> {
  await ensureDirectories();
  const file: ExperienceFile = { version: CURRENT_VERSION, categories, experiences };
  await atomicWrite(await experienceFilePath(), JSON.stringify(file, null, 2));
}
