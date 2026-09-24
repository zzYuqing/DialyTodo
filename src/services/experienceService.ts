// 职责：experiences.json 的原子读写（经验记录 + 分类）。
// 与 tasks.json 同构：{ version, categories, experiences }；损坏按空启动
// （经验属非关键数据，不做备份兜底，下次写入自然覆盖）。

import { join } from "@tauri-apps/api/path";
import { copyFile, exists, mkdir, readTextFile } from "@tauri-apps/plugin-fs";
import { CATEGORY_COLORS, CURRENT_VERSION } from "@/constants";
import { generateTaskId } from "@/lib";
import { ensureDirectories, dataRoot, experienceAttachmentsDir } from "./paths";
import { atomicWrite } from "./atomicWrite";
import type {
  Experience,
  ExperienceAttachment,
  ExperienceCategory,
  ExperienceFile,
} from "@/types";

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

/**
 * 兼容老数据：attachments 是后期新增字段，旧 experiences.json 里没有。
 * 缺失一律补空数组，绝不因缺字段判整份文件损坏（与 Task/Settings 的兼容铁律同口径）。
 */
function normalizeExperience(raw: Experience): Experience {
  return {
    ...raw,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
  };
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
      const experiences = Array.isArray(record.experiences)
        ? record.experiences.map(normalizeExperience)
        : [];
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

/** 取路径末段文件名（Windows 同时认 / 与 \，避免再调一次异步 path API） */
function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** 取扩展名（含点）；无点或点在最末返回空串 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : "";
}

/** 按扩展名推断 mime，仅用于附件展示与打开判断，不追求完整覆盖 */
function mimeOf(ext: string): string {
  const table: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".txt": "text/plain",
    ".log": "text/plain",
    ".json": "application/json",
    ".md": "text/markdown",
  };
  return table[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * 把用户选中的文件复制进该经验的附件目录，返回附件描述。
 * 存储名用 generateTaskId() 重新生成，避免同名文件互相覆盖；原始名另存于 name 供展示。
 * 源文件经 dialog 选中已进入 fs scope，目标目录位于数据根目录（已在白名单内）。
 */
export async function copyAttachmentInto(
  expId: string,
  srcPath: string,
): Promise<ExperienceAttachment> {
  const dir = await experienceAttachmentsDir(expId);
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  const name = baseNameOf(srcPath);
  const ext = extensionOf(name);
  const storedName = `${generateTaskId()}${ext}`;
  await copyFile(srcPath, await join(dir, storedName));
  return { id: generateTaskId(), name, storedName, mime: mimeOf(ext) };
}
