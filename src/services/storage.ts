// 职责：tasks.json / settings.json 的原子读写、自动备份滚动、导入导出（提示词 4.3 / 5.4）。
// 原子写入：写 .tmp → rename 原地原子替换目标，全部在 TS 侧完成。
// 提示词 3.5 明确禁止为此新写 Rust command。

import { join } from "@tauri-apps/api/path";
import {
  copyFile,
  exists,
  mkdir,
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
  QUARANTINE_SUFFIX,
  TASK_TYPE_FILE_SUFFIX,
  TMP_FILE_SUFFIX,
} from "@/constants";
import {
  defaultSettings,
  isAppSettings,
  parseTasksFileCompatible,
  parseTasksValueTolerant,
  syncChildrenIndex,
  validateTaskOfType,
} from "@/lib";
import type { AppSettings, LoadResult, ParsedImport, Task, TasksFile } from "@/types";
import {
  backupDirPath,
  ensureDirectories,
  IS_DEV,
  settingsFilePath,
  tasksDirPath,
  tasksFilePath,
  taskTypeFilePath,
} from "./paths";

/**
 * 原子写入：先写临时文件，再 rename 原地替换目标。
 * 关键：不先删除目标——rename 在 POSIX 与 Windows（MoveFileEx MOVEFILE_REPLACE_EXISTING）
 * 上都是原子替换。这样即便写入过程中进程崩溃，目标文件始终停在「旧完整版」或「新完整版」之一，
 * 绝不会留下半截文件导致整份数据损坏。
 * 旧实现先 remove 再 rename 会在两步之间留出「目标不存在」的空窗，崩溃即丢数据，故移除该步骤。
 */
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmpPath = `${path}${TMP_FILE_SUFFIX}`;
  await writeTextFile(tmpPath, content);
  await rename(tmpPath, path);
}

/**
 * 启动加载任务数据。
 * 三种结果：文件不存在（首次启动）→ 空数据；正常解析 → 返回任务；
 * 损坏 → 自动读最近一份备份并提示。
 *
 * 兜底：只要主文件被判定为损坏，必须先把原文件 rename 为 .bak.{timestamp} 保留，
 * 再尝试读备份或返回空数据。这样后续 saveTasks 写入新数据时不会覆盖损坏原文件，
 * 用户事后可手动用文本编辑器/版本控制/原始备份比对恢复（避免「数据加载异常 → 空启动 →
  首次写入就抹掉损坏文件 → 数据彻底丢失」的连环丢数据链路）。
 */
export async function loadTasks(): Promise<{ result: LoadResult; tasks: Task[] }> {
  if (IS_DEV) return loadTasksDev();
  await ensureDirectories();
  const path = await tasksFilePath();

  if (!(await exists(path))) {
    return {
      result: { ok: true, usedBackup: false, error: null, corruptedBackupPath: null },
      tasks: [],
    };
  }

  const parsedTasks = await tryParseTasksFile(path);
  if (parsedTasks !== null) {
    return {
      result: { ok: true, usedBackup: false, error: null, corruptedBackupPath: null },
      tasks: parsedTasks,
    };
  }

  // 主文件损坏：先把原文件 rename 备份保留，再尝试读备份目录里的旧备份
  const corruptedBackupPath = await renameCorruptedToBackup(path);

  const recovered = await loadFromBackup();
  if (recovered !== null) {
    return {
      result: {
        ok: true,
        usedBackup: true,
        error: `tasks.json 已损坏，已自动从最近一份备份恢复。原文件已保留为 ${corruptedBackupPath ?? path}`,
        corruptedBackupPath,
      },
      tasks: recovered,
    };
  }

  return {
    result: {
      ok: false,
      usedBackup: false,
      error: `tasks.json 已损坏且没有可用备份，已按空数据启动。原文件已保留为 ${corruptedBackupPath ?? path}`,
      corruptedBackupPath,
    },
    tasks: [],
  };
}

/**
 * 把损坏的 tasks.json rename 为 .bak.{ISO8601 时间戳} 保留在同目录。
 * 返回新路径；失败（权限不足等）返回 null，调用方在 error 文案里兜底用原路径。
 * 同秒多次启动会撞名，加序号去重。
 */
async function renameCorruptedToBackup(path: string): Promise<string | null> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseBackup = `${path}.bak.${timestamp}`;
  let target = baseBackup;
  try {
    let i = 1;
    while (await exists(target)) {
      target = `${baseBackup}.${i}`;
      i += 1;
    }
    await rename(path, target);
    return target;
  } catch {
    return null;
  }
}

/** 保存全部任务 */
export async function saveTasks(tasks: Task[]): Promise<void> {
  if (IS_DEV) return saveTasksDev(tasks);
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
      // 以出厂设置为基底合并后再校验：新增设置项时，老文件不会因缺字段被整体判废。
      // 顺带剔除旧版废弃字段（windowMode/onBlur 已拆分为 alwaysOnTop/layout），避免残留在下次保存里。
      if (typeof parsed === "object" && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        delete record.windowMode;
        delete record.onBlur;
        const merged: unknown = {
          ...defaultSettings(),
          ...record,
          // 版本号一律抬到当前：settings 的演进方式是「新增字段由出厂默认值补齐」，
          // 没有迁移函数，抬版本即完成升级，下次保存写出的文件也就带上了当前版本。
          version: CURRENT_VERSION,
        };
        if (isAppSettings(merged)) return merged;
      }
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
  if (IS_DEV) return dailyBackupDev(today);
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
 *
 * 版本闸门走 parseTasksFileCompatible（最低兼容 + 迁移），不是精确相等：
 * 覆盖 exe 不会碰到数据文件，真正丢数据的途径是「新 exe 读不懂旧版本文件 → 判废 →
 * 空启动 → 首次写入覆盖」，主文件与备份同一判定、备份也救不了。这里换成兼容解析即掐断该链路。
 *
 * 读出的任务会经 migrateTasksFile 统一 normalize 补齐新增字段：completedAt 是阶段 6 才加的，
 * 存量文件里整个字段缺失。光放宽校验不够 —— 内存里留着 undefined 会让
 * TaskItem 的 `completedAt !== null` 把「从未完成」误判成「已完成」。
 */
async function tryParseTasksFile(path: string): Promise<Task[] | null> {
  try {
    if (!(await exists(path))) return null;
    const parsed: unknown = JSON.parse(await readTextFile(path));
    return parseTasksFileCompatible(parsed)?.tasks ?? null;
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
    // 导入旧版本导出的备份属于正常场景，走兼容解析（能迁移就读进来），
    // 只有低于最低兼容版本或结构非法才拒绝。
    const file = parseTasksFileCompatible(parsed);
    if (file === null) {
      return { valid: false, tasks: [], error: "文件格式不正确或版本过低" };
    }
    return { valid: true, tasks: file.tasks, error: null };
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
  // 合并后关系的两侧可能与父 / 子不在同一份数据里，跑一次自愈：
  // 以 children 为准重建 parentId，找不到父的任务一律降级回普通顶层任务（不会消失）。
  return syncChildrenIndex([...map.values()]);
}

// ============================================================================
// dev 构建：每种任务类型独立一个文件（<数据根>/tasks/<type>.json）
// 用 IS_DEV 隔离，release 构建完全不进入这些分支，旧 exe 的单文件 tasks.json 不受影响。
// 对外 API（loadTasks / saveTasks / dailyBackup）签名不变，下游零改动。
// ============================================================================

/**
 * 宽松解析单个 JSON 文件（类型文件或整合备份），返回归一化后的 TasksFile；
 * 任何失败（不存在 / 非 JSON / version 过低）返回 null。version 闸门走
 * parseTasksValueTolerant（最低兼容而非精确匹配），避免 bump 版本整份判废。
 */
async function tryParseTypeFileRaw(path: string): Promise<TasksFile | null> {
  try {
    if (!(await exists(path))) return null;
    const parsed: unknown = JSON.parse(await readTextFile(path));
    return parseTasksValueTolerant(parsed);
  } catch {
    return null;
  }
}

/** 把无法校验的任务隔离写入 <type>.quarantine.json，绝不静默丢弃 */
async function writeQuarantine(type: string, bad: Task[]): Promise<void> {
  const path = await join(await tasksDirPath(), `${type}${QUARANTINE_SUFFIX}`);
  await atomicWrite(path, JSON.stringify({ version: CURRENT_VERSION, tasks: bad }, null, 2));
}

/**
 * 首次在 dev 下运行：把旧的单个 tasks.json 按类型拆分到 tasks/ 目录。
 * 原文件改名保留（.migrated.<时间戳>），绝不删除。已迁移过（tasks 目录已有类型文件）则跳过。
 */
async function migrateLegacyTasksFile(): Promise<void> {
  try {
    const tasksDir = await tasksDirPath();
    const legacy = await tasksFilePath();

    if (await exists(tasksDir)) {
      const entries = await readDir(tasksDir);
      const hasTypeFile = entries.some(
        (e) =>
          typeof e.name === "string" &&
          e.name.endsWith(TASK_TYPE_FILE_SUFFIX) &&
          !e.name.endsWith(QUARANTINE_SUFFIX),
      );
      if (hasTypeFile) return;
    }
    if (!(await exists(legacy))) return;

    const parsed: unknown = JSON.parse(await readTextFile(legacy));
    const file = parseTasksValueTolerant(parsed);
    if (file === null) return; // 旧文件损坏：不动，交由后续加载流程处理

    if (!(await exists(tasksDir))) await mkdir(tasksDir, { recursive: true });
    const byType = new Map<string, Task[]>();
    for (const task of file.tasks) {
      const list = byType.get(task.schedule.type);
      if (list) list.push(task);
      else byType.set(task.schedule.type, [task]);
    }
    for (const [type, list] of byType) {
      await atomicWrite(
        await taskTypeFilePath(type),
        JSON.stringify({ version: CURRENT_VERSION, tasks: list }, null, 2),
      );
    }
    // 原文件改名保留，便于事后比对
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(legacy, `${legacy}.migrated.${ts}`);
  } catch {
    // 迁移失败不应阻塞启动，后续按「无旧文件」流程继续
  }
}

/** dev 加载：逐类型文件读取；单文件损坏尝试从整合备份找回该类型，否则隔离改名 */
async function loadTasksDev(): Promise<{ result: LoadResult; tasks: Task[] }> {
  await ensureDirectories();
  const tasksDir = await tasksDirPath();

  // 首次运行：把旧的单文件 tasks.json 拆成 per-type
  await migrateLegacyTasksFile();

  const entries = (await exists(tasksDir)) ? await readDir(tasksDir) : [];
  const typeFiles = entries
    .map((e) => e.name)
    .filter(
      (name): name is string =>
        typeof name === "string" &&
        name.endsWith(TASK_TYPE_FILE_SUFFIX) &&
        !name.endsWith(QUARANTINE_SUFFIX),
    );

  const allTasks: Task[] = [];
  let usedBackup = false;
  let corruptedBackupPath: string | null = null;
  let error: string | null = null;

  for (const name of typeFiles) {
    const type = name.slice(0, -TASK_TYPE_FILE_SUFFIX.length);
    const path = await join(tasksDir, name);
    const raw = await tryParseTypeFileRaw(path);
    if (raw === null) {
      // 整个类型文件损坏：尝试从最近一份整合备份里找回该类型
      const recovered = await loadLatestConsolidatedBackup();
      const ofType = recovered?.filter((t) => t.schedule.type === type) ?? [];
      if (ofType.length > 0) {
        allTasks.push(...ofType);
        usedBackup = true;
        continue;
      }
      corruptedBackupPath = await renameCorruptedToBackup(path);
      error = `tasks/${name} 已损坏，已尝试从备份恢复（原文件保留于 ${corruptedBackupPath ?? path}）。`;
      continue;
    }
    const good = raw.tasks.filter((t) => validateTaskOfType(type, t));
    const bad = raw.tasks.filter((t) => !validateTaskOfType(type, t));
    if (bad.length > 0) await writeQuarantine(type, bad);
    allTasks.push(...good);
  }

  return {
    result: { ok: error === null, usedBackup, error, corruptedBackupPath },
    tasks: allTasks,
  };
}

/** dev 保存：按类型分组写入各自文件，并清理已无任何任务的类型文件（避免陈旧数据回读） */
async function saveTasksDev(tasks: Task[]): Promise<void> {
  await ensureDirectories();
  const tasksDir = await tasksDirPath();
  if (!(await exists(tasksDir))) await mkdir(tasksDir, { recursive: true });

  const byType = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = byType.get(task.schedule.type);
    if (list) list.push(task);
    else byType.set(task.schedule.type, [task]);
  }

  for (const [type, list] of byType) {
    await atomicWrite(
      await taskTypeFilePath(type),
      JSON.stringify({ version: CURRENT_VERSION, tasks: list }, null, 2),
    );
  }

  // 删除已无任务的类型文件，防止下次加载把陈旧数据重新读回
  const entries = await readDir(tasksDir);
  for (const e of entries) {
    const name = e.name;
    if (typeof name !== "string") continue;
    if (!name.endsWith(TASK_TYPE_FILE_SUFFIX) || name.endsWith(QUARANTINE_SUFFIX)) continue;
    const type = name.slice(0, -TASK_TYPE_FILE_SUFFIX.length);
    if (!byType.has(type)) await remove(await join(tasksDir, name));
  }
}

/** dev 备份：把全部类型文件整合为一份 backup_YYYY-MM-DD.json 快照（沿用原备份命名与保留份数） */
async function dailyBackupDev(today: string): Promise<boolean> {
  const tasksDir = await tasksDirPath();
  if (!(await exists(tasksDir))) return false;

  const entries = await readDir(tasksDir);
  const allTasks: Task[] = [];
  for (const e of entries) {
    const name = e.name;
    if (typeof name !== "string") continue;
    if (!name.endsWith(TASK_TYPE_FILE_SUFFIX) || name.endsWith(QUARANTINE_SUFFIX)) continue;
    const raw = await tryParseTypeFileRaw(await join(tasksDir, name));
    if (raw === null) return false; // 有类型文件损坏则不覆盖好备份
    allTasks.push(...raw.tasks);
  }

  const target = await join(await backupDirPath(), `${BACKUP_FILE_PREFIX}${today}.json`);
  if (await exists(target)) return false;
  await atomicWrite(target, JSON.stringify({ version: CURRENT_VERSION, tasks: allTasks }, null, 2));
  await pruneBackups();
  return true;
}

/** 从最近的整合备份恢复全部任务（dev 类型文件整文件损坏时的兜底） */
async function loadLatestConsolidatedBackup(): Promise<Task[] | null> {
  const dir = await backupDirPath();
  if (!(await exists(dir))) return null;
  const entries = await readDir(dir);
  const names = entries
    .map((e) => e.name)
    .filter(
      (name): name is string =>
        typeof name === "string" && name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(TASK_TYPE_FILE_SUFFIX),
    )
    .sort()
    .reverse();
  for (const name of names) {
    const raw = await tryParseTypeFileRaw(await join(dir, name));
    if (raw !== null) return raw.tasks;
  }
  return null;
}
