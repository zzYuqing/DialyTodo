// 职责：回收站数据的原子读写与过期清理（落 trash.json）。
// 回收站只存「被删数据的快照」，磁盘本体（任务无独立文件、经验附件目录、单附件文件）在回收站内保留，
// 只有彻底删除（手动或过期扫描）时才调用 experienceService 删盘。
// 本文件不直接依赖任何 store，避免与 React 侧形成环。

import { join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { TRASH_FILE } from "@/constants";
import { atomicWrite } from "./atomicWrite";
import {
  deleteAttachmentFile,
  deleteExperienceAttachments,
} from "./experienceService";
import { ensureDirectories, dataRoot } from "./paths";
import type { TrashEntry, TrashKind } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_KINDS: ReadonlySet<string> = new Set<TrashKind>([
  "task",
  "experience",
  "attachment",
  "subtask",
  "hunong",
]);

async function trashFilePath(): Promise<string> {
  return join(await dataRoot(), TRASH_FILE);
}

/** 轻量结构校验：只需保证能安全渲染与还原，不做 Task/Experience 内部逐条校验
 * （快照来自运行中的 store，本就是合法数据；存盘损坏才走这里兜底丢弃）。 */
function isTrashEntry(value: unknown): value is TrashEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string") return false;
  if (typeof e.kind !== "string" || !TRASH_KINDS.has(e.kind)) return false;
  if (typeof e.deletedAt !== "number") return false;
  switch (e.kind) {
    case "task":
      return Array.isArray(e.tasks);
    case "experience":
      return typeof e.experience === "object" && e.experience !== null;
    case "attachment":
      return typeof e.attachment === "object" && e.attachment !== null;
    case "subtask":
      return typeof e.subtask === "object" && e.subtask !== null;
    case "hunong":
      return Array.isArray(e.hunong);
    default:
      return false;
  }
}

/** 启动加载：文件缺失或结构非法均按空启动（回收站非关键数据，不做备份兜底） */
export async function loadTrash(): Promise<TrashEntry[]> {
  await ensureDirectories();
  const path = await trashFilePath();
  if (!(await exists(path))) return [];
  try {
    const parsed: unknown = JSON.parse(await readTextFile(path));
    if (Array.isArray(parsed)) {
      return parsed.filter(isTrashEntry);
    }
  } catch {
    // 文件损坏：按空启动，下次写入覆盖
  }
  return [];
}

/** 原子写入全部条目 */
export async function saveTrash(entries: TrashEntry[]): Promise<void> {
  await ensureDirectories();
  await atomicWrite(await trashFilePath(), JSON.stringify(entries, null, 2));
}

/** 追加新条目并落盘，返回合并后的完整列表 */
export async function addTrashEntries(added: TrashEntry[]): Promise<TrashEntry[]> {
  const merged = [...(await loadTrash()), ...added];
  await saveTrash(merged);
  return merged;
}

/** 按 id 移除条目并落盘，返回剩余列表 */
export async function removeTrashEntries(ids: string[]): Promise<TrashEntry[]> {
  const drop = new Set(ids);
  const kept = (await loadTrash()).filter((e) => !drop.has(e.id));
  await saveTrash(kept);
  return kept;
}

/** 彻底删除某条目的磁盘残留：经验删整个附件目录、附件删单文件、任务无独立文件 */
async function purgeEntryDisk(entry: TrashEntry): Promise<void> {
  if (entry.kind === "experience" && entry.experience !== undefined) {
    await deleteExperienceAttachments(entry.experience.id);
  } else if (entry.kind === "attachment" && entry.attachment !== undefined) {
    const { expId, attachment } = entry.attachment;
    await deleteAttachmentFile(expId, attachment.storedName);
  }
}

/** 批量彻底删除磁盘残留（不落 trash.json，由调用方负责更新文件） */
export async function purgeEntriesDisk(entries: TrashEntry[]): Promise<void> {
  for (const entry of entries) {
    await purgeEntryDisk(entry);
  }
}

/** 计算某条目的过期时间戳（epoch ms） */
export function trashExpiresAtMs(entry: TrashEntry, retentionDays: number): number {
  return entry.deletedAt + retentionDays * DAY_MS;
}

/**
 * 启动扫描：保留天数外的条目彻底删除（先清磁盘再落盘），返回保留下来的列表。
 * retentionDays 由设置提供，已在加载时收敛到合法区间。
 */
export async function sweepTrash(retentionDays: number): Promise<TrashEntry[]> {
  const all = await loadTrash();
  const now = Date.now();
  const kept: TrashEntry[] = [];
  const expired: TrashEntry[] = [];
  for (const entry of all) {
    if (trashExpiresAtMs(entry, retentionDays) <= now) expired.push(entry);
    else kept.push(entry);
  }
  if (expired.length > 0) {
    await purgeEntriesDisk(expired);
    await saveTrash(kept);
  }
  return kept;
}
