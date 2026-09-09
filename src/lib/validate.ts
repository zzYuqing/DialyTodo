// 职责：JSON 结构校验与 version 校验（提示词 4.3）。
// 纯函数：一律返回布尔值，不抛异常，由调用方决定如何降级。

import { CURRENT_VERSION, HOLIDAY_URL_TEMPLATE } from "@/constants";
import type { AppSettings, DayRecord, Reminder, Schedule, Task, TasksFile } from "@/types";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_TYPE_SET = new Set(["once", "workday", "weekend", "daily"]);

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
  return Object.values(candidate.instances).every(isDayRecord);
}

/**
 * 校验 tasks.json 的顶层结构。
 * version 不匹配一律判为非法 —— 调用方会据此尝试读最近一份备份（提示词 4.3）。
 */
export function isTasksFile(value: unknown): value is TasksFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TasksFile>;
  if (candidate.version !== CURRENT_VERSION) return false;
  if (!Array.isArray(candidate.tasks)) return false;
  return candidate.tasks.every(isTask);
}

/** 校验 settings.json 的结构 */
export function isAppSettings(value: unknown): value is AppSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AppSettings>;

  if (candidate.version !== CURRENT_VERSION) return false;
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
