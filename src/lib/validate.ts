// 职责：JSON 结构校验与 version 校验（提示词 4.3）。
// 纯函数：一律返回布尔值，不抛异常，由调用方决定如何降级。

import { CURRENT_VERSION, HOLIDAY_URL_TEMPLATE, MIN_SUPPORTED_VERSION } from "@/constants";
import type { AppSettings, DayRecord, Reminder, Schedule, Task, TasksFile } from "@/types";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_TYPE_SET = new Set(["once", "workday", "weekend", "daily", "weekly"]);

/** 星期序号数组：元素必须是 0（周一）到 6（周日）的整数 */
function isWeekdays(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((day) => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)
  );
}

/** 是否为合法日期键 YYYY-MM-DD */
export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_KEY_PATTERN.test(value);
}

function isSchedule(value: unknown): value is Schedule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Schedule>;
  if (typeof candidate.type !== "string" || !SCHEDULE_TYPE_SET.has(candidate.type)) return false;
  if (!isDateKey(candidate.startDate)) return false;
  // 用 != null 同时放过 null 与 undefined：老数据可能整个缺 endDate 字段，
  // 严格写 !== null 会让 undefined 走进 isDateKey 并被判非法，导致整份文件被误判损坏。
  if (candidate.endDate != null && !isDateKey(candidate.endDate)) return false;
  // weekdays 是 weekly 专属字段，存量数据整个缺失；存在时必须合法，缺失放行（由 normalize 补 []）
  if (candidate.weekdays != null && !isWeekdays(candidate.weekdays)) return false;
  return true;
}

function isReminder(value: unknown): value is Reminder {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Reminder>;
  return typeof candidate.enabled === "boolean" && typeof candidate.time === "string";
}

function isDayRecord(value: unknown): value is DayRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DayRecord>;
  if (typeof candidate.done !== "boolean") return false;
  return candidate.doneAt === null || typeof candidate.doneAt === "string";
}

/**
 * 复合任务三个新字段的结构校验。
 * 用 != null 放过「整个字段缺失」的存量数据，存在时才校验类型 —— 与 completedAt 同样的理由：
 * 严格写 !== null 会让老数据整份被判废。
 *
 * 注意这里**只做单条粒度的类型校验**：children 指向的任务是否存在、children 与 parentId
 * 是否互相一致，都需要全表上下文，属于 syncChildrenIndex 的职责（载入 / 导入时自愈)。
 */
function hasValidCompositeFields(candidate: Partial<Task>): boolean {
  if (candidate.kind != null && candidate.kind !== "single" && candidate.kind !== "composite") {
    return false;
  }
  if (candidate.children != null) {
    if (!Array.isArray(candidate.children)) return false;
    if (!candidate.children.every((id) => typeof id === "string")) return false;
  }
  if (candidate.parentId != null && typeof candidate.parentId !== "string") return false;
  if (candidate.childDoneAt != null && typeof candidate.childDoneAt !== "string") return false;
  return true;
}

/** 是否为合法的任务对象 */
export function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Task>;

  if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
  if (typeof candidate.title !== "string") return false;
  if (typeof candidate.note !== "string") return false;
  if (typeof candidate.createdAt !== "string") return false;
  if (!isSchedule(candidate.schedule)) return false;
  if (!isReminder(candidate.reminder)) return false;
  if (typeof candidate.archived !== "boolean") return false;
  // completedAt 是阶段 6 新增字段，存量数据里整个缺失。用 != null 同时放过
  // null 与 undefined：写成 !== null 时 undefined 会被 isDateKey 判非法，
  // 进而让整份 tasks.json（及全部备份）被误判为「损坏」，数据凭空消失。
  if (candidate.completedAt != null && !isDateKey(candidate.completedAt)) return false;

  if (typeof candidate.instances !== "object" || candidate.instances === null) return false;
  if (!Object.values(candidate.instances).every(isDayRecord)) return false;
  return hasValidCompositeFields(candidate);
}

/**
 * 按指定类型校验任务。与 isTask 的区别：schedule.type 只要求等于传入的 type，
 * 新增任务类型时只需登记自己的校验分支，已有类型的判断逻辑完全不动
 * （满足「新增类型不影响旧 task」）。基础字段校验与 isTask 保持一致。
 */
export function validateTaskOfType(type: string, value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Task>;

  if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
  if (typeof candidate.title !== "string") return false;
  if (typeof candidate.note !== "string") return false;
  if (typeof candidate.createdAt !== "string") return false;
  if (typeof candidate.schedule !== "object" || candidate.schedule === null) return false;
  if (candidate.schedule.type !== type) return false;
  if (!isDateKey(candidate.schedule.startDate)) return false;
  if (candidate.schedule.endDate != null && !isDateKey(candidate.schedule.endDate)) return false;
  if (candidate.schedule.weekdays != null && !isWeekdays(candidate.schedule.weekdays)) return false;
  if (!isReminder(candidate.reminder)) return false;
  if (typeof candidate.archived !== "boolean") return false;
  if (candidate.completedAt != null && !isDateKey(candidate.completedAt)) return false;
  if (typeof candidate.instances !== "object" || candidate.instances === null) return false;
  if (!Object.values(candidate.instances).every(isDayRecord)) return false;
  return hasValidCompositeFields(candidate);
}

/**
 * 结构迁移路由：version 低于 CURRENT_VERSION 时逐级应用 MIGRATIONS，
 * 最后统一 normalize（补齐新增的可选字段）。version 低于 MIN_SUPPORTED_VERSION 视为无法迁移，返回 null。
 *
 * 新增任务类型 / 字段时：把升级步骤登记进 MIGRATIONS[旧版本]，旧数据加载时自动升到最新版本，
 * 无需全量重写文件，也不会因「版本号不匹配」整份判废。
 */
const MIGRATIONS: Record<number, (file: TasksFile) => TasksFile> = {};

export function migrateTasksFile(parsed: TasksFile): TasksFile | null {
  if (parsed.version < MIN_SUPPORTED_VERSION) return null;
  let file = parsed;
  while (file.version < CURRENT_VERSION) {
    const step = MIGRATIONS[file.version];
    file = step ? step(file) : file;
    file = { ...file, version: file.version + 1 };
  }
  return {
    version: CURRENT_VERSION,
    tasks: file.tasks.map(normalizeTask),
  };
}

/**
 * 宽松解析任意来源（主文件 / 备份 / 单类型文件）的 tasks 结构：
 * 只要求 version 达到最低兼容版本，不要求精确等于 CURRENT_VERSION。
 * 通过则执行迁移并返回归一化结果，否则 null。
 * dev 构建的 per-type 存储与备份恢复统一走此函数，彻底消除
 * 「版本号一 bump 就将所有旧文件 + 备份判废」的隐患。
 */
export function parseTasksValueTolerant(value: unknown): TasksFile | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<TasksFile>;
  if (typeof candidate.version !== "number") return null;
  if (!Array.isArray(candidate.tasks)) return null;
  return migrateTasksFile({ version: candidate.version, tasks: candidate.tasks });
}

/**
 * release 路径的任务文件解析（主文件 / 备份 / 导入文件共用）。
 *
 * 结构校验仍逐条过 isTask，但版本只要求达到 MIN_SUPPORTED_VERSION，
 * 再经 migrateTasksFile 逐级升到 CURRENT_VERSION。
 *
 * 目的：release 的 exe 升级是「覆盖同一个 exe 文件」，数据文件在 %APPDATA% 下、不在安装位置，
 * 覆盖本身碰不到它 —— 真正会毁掉旧数据的是「新 exe 读不懂旧格式 → 判废 → 空启动 → 首次写入覆盖」。
 * 把闸门换成最低兼容 + 迁移，就是掐断这条链路。
 *
 * 注意与 parseTasksValueTolerant 的分工：那个函数不做逐条结构校验（dev per-type 靠
 * 单条隔离 + quarantine 兜底）；这个用于 release 单文件，必须保留整体结构校验。
 */
export function parseTasksFileCompatible(value: unknown): TasksFile | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<TasksFile>;
  if (typeof candidate.version !== "number") return null;
  if (!Array.isArray(candidate.tasks)) return null;
  if (!candidate.tasks.every(isTask)) return null;
  return migrateTasksFile({ version: candidate.version, tasks: candidate.tasks });
}

/**
 * 补齐存量数据缺失的可选字段，使内存态与 Task 类型定义一致。
 * - completedAt：阶段 6 新增，老数据整个字段缺失；
 * - schedule.endDate：老字段，但放宽校验后理论上允许缺失，一并归一；
 * - schedule.weekdays：阶段 7 随 weekly 周期新增，老数据整个字段缺失。
 * 三者缺失时下游都用 `!== null` 判空，undefined 会被误读成「有值」；
 * weekdays 补 [] 后 occursOn 的 includes 判定天然不命中，非 weekly 任务行为不变。
 *
 * 归入纯函数校验层（与 isTask / normalize 同处），由 storage 与迁移路由共用。
 */
export function normalizeTask(task: Task): Task {
  const kind = task.kind === "composite" ? "composite" : "single";
  const composite = kind === "composite";
  return {
    ...task,
    kind,
    // children 只对任务集有意义：非 composite 一律归一成 undefined（不落盘），
    // 保证「有 children 数组」等价于「是任务集」这条语义不被脏数据破坏。
    children: composite ? (Array.isArray(task.children) ? task.children : []) : undefined,
    parentId: task.parentId ?? null,
    childDoneAt: task.childDoneAt ?? null,
    completedAt: task.completedAt ?? null,
    schedule: {
      ...task.schedule,
      endDate: task.schedule.endDate ?? null,
      weekdays: task.schedule.weekdays ?? [],
    },
  };
}

/** 校验 settings.json 的结构 */
export function isAppSettings(value: unknown): value is AppSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AppSettings>;

  // 版本号只要求「是数字」，不要求等于 CURRENT_VERSION。
  // settings 的演进方式是「新增字段由出厂默认值补齐」（见 loadSettings 的 merge），没有迁移函数，
  // 若这里要求精确相等，bump 版本会让老版本设置整份判废 —— 主题 / 自启动 / 布局等偏好全部回出厂。
  if (typeof candidate.version !== "number") return false;
  if (candidate.theme !== "light" && candidate.theme !== "dark") return false;
  if (typeof candidate.alwaysOnTop !== "boolean") return false;
  if (candidate.layout !== "full" && candidate.layout !== "simple" && candidate.layout !== "mini") {
    return false;
  }
  if (typeof candidate.closeToTray !== "boolean") return false;
  if (typeof candidate.autoStart !== "boolean") return false;
  if (typeof candidate.petEnabled !== "boolean") return false;
  if (typeof candidate.hideCompleted !== "boolean") return false;
  if (typeof candidate.holidayUrlTemplate !== "string") return false;
  if (candidate.lastBackupDate !== null && !isDateKey(candidate.lastBackupDate)) return false;

  return true;
}

/** 出厂设置。autoStart 默认 false，符合提示词第八节「不开机自启除非用户手动开启」。 */
export function defaultSettings(): AppSettings {
  return {
    version: CURRENT_VERSION,
    theme: "light",
    // 默认不置顶、完整布局，符合桌面应用的常规形态
    alwaysOnTop: false,
    layout: "full",
    // 常驻托盘符合提示词 5.5「最小化到系统托盘后台常驻」，退出入口保留在托盘菜单
    closeToTray: true,
    autoStart: false,
    petEnabled: false,
    hideCompleted: false,
    holidayUrlTemplate: HOLIDAY_URL_TEMPLATE,
    lastBackupDate: null,
  };
}

/** 首次启动时的空数据文件 */
export function emptyTasksFile(): TasksFile {
  return {
    version: CURRENT_VERSION,
    tasks: [],
  };
}
