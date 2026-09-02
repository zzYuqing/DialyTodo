// 职责：解析 %APPDATA%/DailyTodo/ 下的文件路径，并保障目录存在（提示词 4.1）。
// 不使用安装目录，避免 Program Files 下的权限问题。

import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { BACKUP_DIR, DATA_DIR_NAME, SETTINGS_FILE, TASKS_FILE } from "@/constants";
import { holidayFileName } from "@/lib";

/** 数据根目录缓存，避免每次 IO 都重新解析 */
let cachedRoot: string | null = null;

/** %APPDATA%/DailyTodo */
export async function dataRoot(): Promise<string> {
  if (cachedRoot !== null) return cachedRoot;
  const base = await appDataDir();
  cachedRoot = await join(base, DATA_DIR_NAME);
  return cachedRoot;
}

/** 保障数据根目录与备份目录存在（幂等，可重复调用） */
export async function ensureDirectories(): Promise<void> {
  const root = await dataRoot();
  const backup = await backupDirPath();

  if (!(await exists(root))) await mkdir(root, { recursive: true });
  if (!(await exists(backup))) await mkdir(backup, { recursive: true });
}

/** %APPDATA%/DailyTodo/tasks.json */
export async function tasksFilePath(): Promise<string> {
  return join(await dataRoot(), TASKS_FILE);
}

/** %APPDATA%/DailyTodo/settings.json */
export async function settingsFilePath(): Promise<string> {
  return join(await dataRoot(), SETTINGS_FILE);
}

/** %APPDATA%/DailyTodo/backup */
export async function backupDirPath(): Promise<string> {
  return join(await dataRoot(), BACKUP_DIR);
}

/** %APPDATA%/DailyTodo/holidays_YYYY.json */
export async function holidayFilePath(year: number): Promise<string> {
  return join(await dataRoot(), holidayFileName(year));
}
