// 职责：周期类型的展示文案与选项集中定义（提示词 5.2）。

import type { ScheduleType } from "@/types";

/** 四种周期规则的中文文案 */
export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  once: "仅一次",
  workday: "工作日",
  weekend: "非工作日",
  daily: "每天",
};

/** 周期类型列表，用于下拉框渲染顺序 */
export const SCHEDULE_TYPES: ScheduleType[] = ["once", "workday", "weekend", "daily"];

/** 执行日期选项，实际日期由调用方计算（提示词 5.2） */
export type StartDatePreset = "today" | "tomorrow" | "custom";

export const START_DATE_PRESET_LABELS: Record<StartDatePreset, string> = {
  today: "今日",
  tomorrow: "明日",
  custom: "自定义日期",
};

export const START_DATE_PRESETS: StartDatePreset[] = ["today", "tomorrow", "custom"];
