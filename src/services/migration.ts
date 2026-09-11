// 职责：数据目录迁移（设置页「更改位置…」调用）。
// 安全语义：先完整复制并校验目标数据 → 写数据目录指针 → 最后才删除源目录。
// 复制/校验任一步失败即中止，不写指针、不删源，保证数据零丢失。

import { join } from "@tauri-apps/api/path";
import { copyFile, exists, mkdir, readDir, readTextFile, remove } from "@tauri-apps/plugin-fs";
import {
  BACKUP_DIR,
  HOLIDAY_FILE_PREFIX,
  SETTINGS_FILE,
  TASKS_FILE,
  TMP_FILE_SUFFIX,
} from "@/constants";
import { parseTasksFileCompatible } from "@/lib";
import {
  authorizeDirectory,
  clearDataRootCache,
  dataRoot,
  isPathWithin,
  isSamePath,
  writeDataRootPointer,
} from "./paths";

export interface MigrationResult {
  ok: boolean;
  /** 迁移后的数据根目录（成功时） */
  root?: string;
  /** 失败原因（ok = false） */
  error?: string;
  /** 成功但需注意的警示（ok = true，如旧目录有内容未能删除） */
  warning?: string;
}

/** 各类数据的复制计数，供校验与结果提示用（backup/ 单独计） */
interface CopyCount {
  files: number;
  backups: number;
  holidays: number;
}

/**
 * 前置校验：目标是否可迁移。返回 null 表示可迁移，否则返回拒绝原因。
 * 规则：不能是当前数据目录本身、不能与其互相嵌套、不能已含 DailyTodo 数据文件（要求空目录）。
 * 顺带把目标目录加入运行时 fs 白名单（仅内存，不落盘），后续读写才不会被 scope 拒绝。
 */
export async function canMigrateTo(targetDir: string): Promise<string | null> {
  const src = await dataRoot();

  if (isSamePath(src, targetDir)) {
    return "目标目录与当前数据目录相同，无需迁移";
  }
  // 嵌套会导致「复制完成后删除源」把刚复制的副本一起删掉，必须挡在前面
  if (isPathWithin(targetDir, src) || isPathWithin(src, targetDir)) {
    return "目标目录不能位于当前数据目录内部（或反过来），请选择其他目录";
  }

  // 目标目录不在 capabilities 静态 scope 内，必须先动态授权：
  // 否则下面的存在性检查会因越界直接抛 forbidden path，而不是返回 false。
  try {
    await authorizeDirectory(targetDir);
  } catch (err) {
    return `目标目录授权失败：${readableError(err)}`;
  }

  if (await hasDataFile(targetDir)) {
    return "目标目录已包含 tasks.json / settings.json（DailyTodo 数据文件），请选择空目录";
  }
  return null;
}

/**
 * 把数据从当前目录迁移到 targetDir。
 * 前置条件：targetDir 必须存在（由系统目录选择框选出）、不含 DailyTodo 数据文件、且不等于当前目录。
 */
export async function migrateDataTo(targetDir: string): Promise<MigrationResult> {
  // 迁移入口统一走 canMigrateTo，其中已包含目标目录的动态授权
  const preflightError = await canMigrateTo(targetDir);
  if (preflightError !== null) {
    return { ok: false, error: preflightError };
  }

  const src = await dataRoot();

  // 1. 复制数据文件到目标目录
  let copied: CopyCount;
  try {
    copied = await copyDataFiles(src, targetDir);
  } catch (err) {
    return { ok: false, error: `复制数据失败：${readableError(err)}` };
  }

  // 2. 校验目标数据完整（tasks.json 双端比对，其余文件复制成功即视为完整）
  const verifyError = await verifyTarget(src, targetDir, copied);
  if (verifyError !== null) {
    return { ok: false, error: verifyError };
  }

  // 3. 写数据目录指针（源数据此时完好，指针一旦落盘即切换生效）
  try {
    await writeDataRootPointer(targetDir);
  } catch (err) {
    return { ok: false, error: `写入数据目录指针失败：${readableError(err)}` };
  }

  // 4. 清缓存，让后续读写按新指针解析
  clearDataRootCache();

  // 5. 最后删除源目录内容（尽力而为，残留降级为警示而非失败）
  // 删除失败时返回未能删除的条目名列表（null = 全删干净），收敛成一条可读警示文本
  const leftover = await removeSourceDir(src);
  const warning =
    leftover != null && leftover.length > 0
      ? `旧数据目录有 ${leftover.length} 项未能删除：${leftover.join("、")}`
      : undefined;
  return { ok: true, root: targetDir, warning };
}

/** 目标目录是否已含 DailyTodo 数据文件（非空数据目录的标志） */
async function hasDataFile(dir: string): Promise<boolean> {
  const tasks = await join(dir, TASKS_FILE);
  const settings = await join(dir, SETTINGS_FILE);
  return (await exists(tasks)) || (await exists(settings));
}

/**
 * 复制全部数据文件：tasks.json / settings.json / holidays_*.json / backup/ 整个目录。
 * 复制前先检查源目录顶层没有应用不认识的条目（用户误放的文件会在删除源时被误删，一律拒绝）。
 */
async function copyDataFiles(src: string, dst: string): Promise<CopyCount> {
  const counted: CopyCount = { files: 0, backups: 0, holidays: 0 };
  const entries = await readDir(src);

  const unknownNames = entries
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === "string" && !isKnownTopEntry(name));
  if (unknownNames.length > 0) {
    throw new Error(`数据目录含非 DailyTodo 内容（${unknownNames.join("、")}），请先移走再重试`);
  }

  for (const entry of entries) {
    if (typeof entry.name !== "string") continue;
    const source = await join(src, entry.name);

    if (entry.name === TASKS_FILE || entry.name === SETTINGS_FILE) {
      await copyFile(source, await join(dst, entry.name));
      counted.files += 1;
    } else if (entry.name.startsWith(HOLIDAY_FILE_PREFIX)) {
      await copyFile(source, await join(dst, entry.name));
      counted.holidays += 1;
    } else if (entry.name === BACKUP_DIR) {
      const dstBackup = await join(dst, BACKUP_DIR);
      await mkdir(dstBackup, { recursive: true });
      const backupEntries = await readDir(source);
      // backup/ 内全部搬走（不限于 backup_*.json，避免删源时误删用户放的文件）
      for (const backup of backupEntries) {
        if (typeof backup.name !== "string") continue;
        await copyFile(await join(source, backup.name), await join(dstBackup, backup.name));
        counted.backups += 1;
      }
    }
  }

  return counted;
}

/** 数据目录顶层条目是否为应用自产（可随迁移带走或可丢弃的原子写残留） */
function isKnownTopEntry(name: string): boolean {
  return (
    name === TASKS_FILE ||
    name === SETTINGS_FILE ||
    name === BACKUP_DIR ||
    name.startsWith(HOLIDAY_FILE_PREFIX) ||
    name.endsWith(TMP_FILE_SUFFIX)
  );
}

/**
 * 校验目标目录的数据与源一致：源有 tasks.json 时，目标必须存在且任务数一致；
 * 源没有 tasks.json（如仅 settings.json）时，文件复制成功即视为完整；
 * 复制清单全空（源本来没数据）时直接放行。
 */
async function verifyTarget(src: string, dst: string, copied: CopyCount): Promise<string | null> {
  if (copied.files === 0 && copied.backups === 0 && copied.holidays === 0) return null;

  const srcTasksPath = await join(src, TASKS_FILE);
  const dstTasksPath = await join(dst, TASKS_FILE);
  if (!(await exists(srcTasksPath))) return null;

  if (!(await exists(dstTasksPath))) return "目标目录缺少 tasks.json，迁移已中止（源数据未动）";
  try {
    const srcCount = tasksCount(await readTextFile(srcTasksPath));
    const dstCount = tasksCount(await readTextFile(dstTasksPath));
    if (srcCount !== dstCount) {
      return `目标 tasks.json 任务数（${dstCount}）与源（${srcCount}）不一致，迁移已中止（源数据未动）`;
    }
  } catch {
    return "tasks.json 校验失败，迁移已中止（源数据未动）";
  }

  return null;
}

/** 解析 tasks.json 中的任务数；结构非法时抛错，由调用方按校验失败处理 */
function tasksCount(content: string): number {
  const parsed: unknown = JSON.parse(content);
  const file = parseTasksFileCompatible(parsed);
  if (file === null) throw new Error("invalid tasks file");
  return file.tasks.length;
}

/** 删除源目录全部内容，最后删除目录本身。返回未能删除的条目名列表（空 = 全删干净） */
async function removeSourceDir(src: string): Promise<string[] | null> {
  const failed: string[] = [];
  let entries: Awaited<ReturnType<typeof readDir>> = [];
  try {
    entries = await readDir(src);
  } catch {
    return ["（目录无法读取）"];
  }

  for (const entry of entries) {
    if (typeof entry.name !== "string") continue;
    try {
      await remove(await join(src, entry.name), { recursive: true });
    } catch {
      failed.push(entry.name);
    }
  }

  if (failed.length === 0) {
    try {
      await remove(src);
    } catch {
      failed.push("（目录本身）");
    }
  }

  return failed.length > 0 ? failed : null;
}

/** 把异常转成可读文本，避免把整段堆栈甩给用户 */
function readableError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
