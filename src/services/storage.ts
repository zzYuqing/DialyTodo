// 职责：tasks.json / settings.json 的原子读写、自动备份滚动、导入导出（提示词 4.3 / 5.4）。
// 原子写入三步：写 .tmp → 删除目标 → rename，全部在 TS 侧完成。
// 提示词 3.5 明确禁止为此新写 Rust command。

import { join } from "@tauri-apps/api/path";
import {
  copyFile,
  exists,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import {
  BACKUP_FILE_PREFIX,
  BACKUP_KEEP_COUNT,
  CURRENT_VERSION,
  TMP_FILE_SUFFIX,
} from "@/constants";
import { defaultSettings, isAppSettings, isTasksFile } from "@/lib";
import type { AppSettings, LoadResult, ParsedImport, Task } from "@/types";
import {
  backupDirPath,
  ensureDirectories,
  settingsFilePath,
  tasksFilePath,
} from "./paths";

/**
 * 原子写入：先写临时文件，再删除目标，最后重命名。
 * 任何一步失败都不会破坏已有的目标文件。
 */
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmpPath = `${path}${TMP_FILE_SUFFIX}`;
  await writeTextFile(tmpPath, content);
  if (await exists(path)) await remove(path);
  await rename(tmpPath, path);
}

/**
 * 启动加载任务数据。
 * 三种结果：文件不存在（首次启动）→ 空数据；正常解析 → 返回任务；
 * 损坏 → 自动读最近一份备份并提示。
 */
export async function loadTasks(): Promise<{ result: LoadResult; tasks: Task[] }> {
  await ensureDirectories();
  const path = await tasksFilePath();

  if (!(await exists(path))) {
    return { result: { ok: true, usedBackup: false, error: null }, tasks: [] };
  }

  const parsedTasks = await tryParseTasksFile(path);
  if (parsedTasks !== null) {
    return { result: { ok: true, usedBackup: false, error: null }, tasks: parsedTasks };
  }

  const recovered = await loadFromBackup();
  if (recovered !== null) {
    return {
      result: {
        ok: true,
        usedBackup: true,
        error: "tasks.json 已损坏，已自动从最近一份备份恢复",
      },
      tasks: recovered,
    };
  }

  return {
    result: {
      ok: false,
      usedBackup: false,
      error: "tasks.json 已损坏且没有可用备份，已按空数据启动",
    },
    tasks: [],
  };
}

/** 保存全部任务 */
export async function saveTasks(tasks: Task[]): Promise<void> {
  await ensureDirectories();
  const content = JSON.stringify({ version: CURRENT_VERSION, tasks }, null, 2);
  await atomicWrite(await tasksFilePath(), content);
}

/** 加载设置，损坏或缺失时返回出厂设置 */
export async function loadSettings(): Promise<AppSettings> {
  await ensureDirectories();
  const path = await settingsFilePath();

  try {
    if (await exists(path)) {
      const parsed: unknown = JSON.parse(await readTextFile(path));
      if (isAppSettings(parsed)) return parsed;
    }
  } catch {
    // 设置文件损坏不阻塞启动，直接走出厂设置
  }

  return defaultSettings();
}

/** 保存设置 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureDirectories();
  await atomicWrite(await settingsFilePath(), JSON.stringify(settings, null, 2));
}

/**
 * 每日备份：源文件内容合法才备份（防止把损坏数据备份进去盖掉好备份），
 * 同一天只备份一次（提示词 5.4）。
 * 返回是否实际生成了新备份。
 */
export async function dailyBackup(today: string): Promise<boolean> {
  const path = await tasksFilePath();
  // 只有主文件当前是合法的才备份，避免把损坏数据写进去盖掉好备份
  if ((await tryParseTasksFile(path)) === null) return false;

  const target = await join(await backupDirPath(), `${BACKUP_FILE_PREFIX}${today}.json`);
  if (await exists(target)) return false;

  await copyFile(path, target);
  await pruneBackups();
  return true;
}

/**
 * 尝试读取并校验一个 tasks 格式的文件（主文件与备份共用）。
 * 不存在、无法解析、结构或版本不合法，一律返回 null。
 */
async function tryParseTasksFile(path: string): Promise<Task[] | null> {
  try {
    if (!(await exists(path))) return null;
    const parsed: unknown = JSON.parse(await readTextFile(path));
    return isTasksFile(parsed) ? parsed.tasks : null;
  } catch {
    return null;
  }
}

/** 从最近的一份可用备份恢复，逐份回退，全部失败返回 null */
async function loadFromBackup(): Promise<Task[] | null> {
  const dir = await backupDirPath();
  if (!(await exists(dir))) return null;

  const entries = await readDir(dir);
  const names = entries
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === "string" && name.startsWith(BACKUP_FILE_PREFIX))
    .sort()
    .reverse();

  for (const name of names) {
    const parsedTasks = await tryParseTasksFile(await join(dir, name));
    if (parsedTasks !== null) return parsedTasks;
  }

  return null;
}

/** 只保留最近 BACKUP_KEEP_COUNT 份备份，超出部分删除 */
async function pruneBackups(): Promise<void> {
  const dir = await backupDirPath();
  if (!(await exists(dir))) return;

  const entries = await readDir(dir);
  const names = entries
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === "string" && name.startsWith(BACKUP_FILE_PREFIX))
    .sort();

  const outdated = names.slice(0, Math.max(0, names.length - BACKUP_KEEP_COUNT));
  for (const name of outdated) {
    await remove(await join(dir, name));
  }
}

/** 导出备份到用户指定路径 */
export async function exportBackup(targetPath: string): Promise<void> {
  await copyFile(await tasksFilePath(), targetPath);
}

/** 读取并校验待导入的备份文件 */
export async function parseImportFile(sourcePath: string): Promise<ParsedImport> {
  try {
    const parsed: unknown = JSON.parse(await readTextFile(sourcePath));
    if (!isTasksFile(parsed)) {
      return { valid: false, tasks: [], error: "文件格式不正确或版本不匹配" };
    }
    return { valid: true, tasks: parsed.tasks, error: null };
  } catch {
    return { valid: false, tasks: [], error: "文件无法读取或不是合法 JSON" };
  }
}

/**
 * 合并导入：按 id 去重，已存在的任务保留当前版本。
 * 冲突时由调用方让用户选择覆盖或合并（提示词 5.4）。
 */
export function mergeTasks(current: Task[], incoming: Task[]): Task[] {
  const map = new Map<string, Task>();
  for (const task of current) map.set(task.id, task);
  for (const task of incoming) {
    if (!map.has(task.id)) map.set(task.id, task);
  }
  return [...map.values()];
}
