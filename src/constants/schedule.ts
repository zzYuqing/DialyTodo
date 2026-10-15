// 职责：周期类型的展示文案与选项集中定义（提示词 5.2）。

import type { ScheduleType } from "@/types";

/** 六种周期规则的中文文案 */
export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  once: "仅一次",
  workday: "工作日",
  weekend: "非工作日",
  daily: "每天",
  weekly: "每周指定",
  special: "特殊周期",
};

/** 周期类型列表，用于下拉框渲染顺序 */
export const SCHEDULE_TYPES: ScheduleType[] = ["once", "workday", "weekend", "daily", "weekly", "special"];

/**
 * 星期选项，供 weekly 的多选控件渲染。
 * value 即 Schedule.weekdays 的取值：0 = 周一 … 6 = 周日。
 */
export const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "周一" },
  { value: 1, label: "周二" },
  { value: 2, label: "周三" },
  { value: 3, label: "周四" },
  { value: 4, label: "周五" },
  { value: 5, label: "周六" },
  { value: 6, label: "周日" },
];

/** 星期简称，索引与 WEEKDAY_OPTIONS 的 value 一致，用于拼「每周一、五」这类文案 */
export const WEEKDAY_SHORT_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
