// 职责：解析数据目录下各文件路径，并保障目录存在。
// 数据目录默认 %APPDATA%/<identifier>/DailyTodo，可在设置页自定义（迁移）。
// 自定义后经「数据目录指针」文件（appDataDir()/data-dir，位于数据目录之外）持久化，
// 否则迁移删除旧目录时会把指针自己删掉。路径解析见函数注释。

import { appDataDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { tauriBridge } from "@/bridge";
import {
  BACKUP_DIR,
  DATA_DIR_NAME,
  DATA_DIR_POINTER_FILE,
  EXPERIENCE_ATTACHMENTS_DIR,
  SETTINGS_FILE,
  TASKS_DIR,
  TASKS_FILE,
  TASK_TYPE_FILE_SUFFIX,
  TMP_FILE_SUFFIX,
} from "@/constants";
import { holidayFileName } from "@/lib";

/**
 * 构建模式区分：dev（npm run tauri dev）与 release（打包出的 exe）共用同一 bundle
 * identifier（com.yoyo.dailytodo），因此 appDataDir() 完全相同、数据目录指针文件也共用 ——
 * 这正是「dev 删数据、exe 跟着没」的根因。用 Vite 注入的 import.meta.env.DEV 区分两者：
 * - dev     → 指针 data-dir-dev、默认目录 DailyTodo-dev
 * - release → 指针 data-dir、默认目录 DailyTodo
 * 使 dev 与 exe 的数据目录彻底独立，互不影响、可同时运行。
 */
export const IS_DEV = import.meta.env.DEV;
const POINTER_FILE = IS_DEV ? "data-dir-dev" : DATA_DIR_POINTER_FILE;
const DEFAULT_DIR_NAME = IS_DEV ? "DailyTodo-dev" : DATA_DIR_NAME;

/** 数据根目录缓存，避免每次 IO 都重新解析 */
let cachedRoot: string | null = null;

/** 指针文件路径缓存（appDataDir 进程内不变，缓存一次即可） */
let cachedPointer: string | null = null;

/** 首次解析的并发闸：App 启动时 loadTasks / loadSettings 并行，只解析与授权一次 */
let initPromise: Promise<string> | null = null;

/** 已授权过的自定义目录，避免重复 invoke */
const authorizedRoots = new Set<string>();

/**
 * 数据根目录 = 指针指向的目录；无指针（首次启动 / 从未自定义）时为默认目录
 * %APPDATA%/<identifier>/DailyTodo。
 *
 * 注意：appDataDir() 返回的已是 `%APPDATA%/<bundle-identifier>`
 * （即 ...\Roaming\com.yoyo.dailytodo），**本身已包含 identifier**。
 * capabilities 的 fs scope 因此覆盖 $APPDATA 整层（含指针文件与默认数据目录）。
 */
export async function dataRoot(): Promise<string> {
  if (cachedRoot !== null) return cachedRoot;
  if (initPromise === null) initPromise = resolveDataRoot();
  return await initPromise;
}

/** 首次解析：读指针 → 定根目录 → 自定义目录需动态授权 → 缓存 */
async function resolveDataRoot(): Promise<string> {
  const base = await appDataDir();
  cachedPointer = await join(base, POINTER_FILE);

  let root: string;
  if (await exists(cachedPointer)) {
    try {
      const target = (await readTextFile(cachedPointer)).trim();
      root = target.length > 0 ? target : await defaultDataRootPath();
    } catch {
      // 指针文件损坏不影响启动，按默认目录处理
      root = await defaultDataRootPath();
    }
  } else {
    root = await defaultDataRootPath();
  }

  await authorizeDataRoot(root);
  cachedRoot = root;
  return root;
}

/** 默认数据根目录 = appDataDir() + "DailyTodo" */
export async function defaultDataRootPath(): Promise<string> {
  return join(await appDataDir(), DEFAULT_DIR_NAME);
}

/**
 * 自定义数据目录（非默认）不在 capabilities 静态 scope 内，
 * 需经 authorize_dir 动态加入 fs 白名单。只对目录本身放行，不持久化，每次启动重新授权。
 */
async function authorizeDataRoot(root: string): Promise<void> {
  if (isSamePath(root, await defaultDataRootPath())) return;
  await authorizeDirectory(root);
}

/** 把目录加入 fs 动态白名单（幂等）。非宿主环境下由 bridge 降级为 no-op。 */
export async function authorizeDirectory(dir: string): Promise<void> {
  const normalized = normalizePath(dir);
  if (authorizedRoots.has(normalized)) return;

  await tauriBridge.invoke("authorize_dir", { path: dir });
  authorizedRoots.add(normalized);
}

/** 路径比较前归一化：统一斜杠 + 小写（Windows 路径大小写不敏感） */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** 两个路径是否指向同一位置（忽略大小写与斜杠方向差异） */
export function isSamePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/**
 * child 是否位于 parent 内部（严格包含，相等不算）。
 * 用于阻止把数据目录迁移到它自己的子目录里——那样删除源时会把刚复制的副本一起删掉。
 */
export function isPathWithin(child: string, parent: string): boolean {
  const normalizedChild = normalizePath(child);
  const normalizedParent = normalizePath(parent).replace(/\/+$/, "");
  if (normalizedChild === normalizedParent) return false;
  return normalizedChild.startsWith(`${normalizedParent}/`);
}

/** 数据目录指针文件路径（appDataDir()/data-dir，数据目录之外） */
export async function pointerFilePath(): Promise<string> {
  if (cachedPointer === null) {
    cachedPointer = await join(await appDataDir(), POINTER_FILE);
  }
  return cachedPointer;
}

/** 读数据目录指针；文件缺失或内容为空返回 null（调用方按默认目录处理） */
export async function readDataRootPointer(): Promise<string | null> {
  const path = await pointerFilePath();
  if (!(await exists(path))) return null;
  try {
    const content = (await readTextFile(path)).trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/** 写数据目录指针（先写 .tmp 再 rename），迁移成功后调用 */
export async function writeDataRootPointer(root: string): Promise<void> {
  const path = await pointerFilePath();
  const tmpPath = `${path}${TMP_FILE_SUFFIX}`;
  await writeTextFile(tmpPath, root);
  if (await exists(path)) await remove(path);
  await rename(tmpPath, path);
}

/** 数据目录变更后调用，使 dataRoot 缓存失效，下次按新指针重新解析 */
export function clearDataRootCache(): void {
  cachedRoot = null;
  initPromise = null;
}

/** 保障数据根目录与备份目录存在（幂等，可重复调用） */
export async function ensureDirectories(): Promise<void> {
  const root = await dataRoot();
  const backup = await backupDirPath();

  if (!(await exists(root))) await mkdir(root, { recursive: true });
  if (!(await exists(backup))) await mkdir(backup, { recursive: true });
}

/** <数据根目录>/tasks.json（release 单文件存储；dev 仅在首次迁移时读取旧格式） */
export async function tasksFilePath(): Promise<string> {
  return join(await dataRoot(), TASKS_FILE);
}

/** dev 构建：每种任务类型独立存放的子目录 <数据根目录>/tasks */
export async function tasksDirPath(): Promise<string> {
  return join(await dataRoot(), TASKS_DIR);
}

/** dev 构建：单类型任务文件 <数据根目录>/tasks/<type>.json */
export async function taskTypeFilePath(type: string): Promise<string> {
  return join(await tasksDirPath(), `${type}${TASK_TYPE_FILE_SUFFIX}`);
}

/** <数据根目录>/settings.json */
export async function settingsFilePath(): Promise<string> {
  return join(await dataRoot(), SETTINGS_FILE);
}

/** <数据根目录>/backup */
export async function backupDirPath(): Promise<string> {
  return join(await dataRoot(), BACKUP_DIR);
}

/** <数据根目录>/holidays_YYYY.json */
export async function holidayFilePath(year: number): Promise<string> {
  return join(await dataRoot(), holidayFileName(year));
}

/**
 * 单条经验的附件目录 <数据根目录>/experiences/attachments/<经验id>。
 * md 引用的图片与直接上传的附件都落在这里；新增时由编辑器预先生成 id，
 * 因此「还没落库的经验」也能先把文件复制进来。
 */
export async function experienceAttachmentsDir(expId: string): Promise<string> {
  return join(await dataRoot(), EXPERIENCE_ATTACHMENTS_DIR, expId);
}
