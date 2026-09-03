// 职责：任务领域模型的类型定义（提示词 4.2）。
// 设计要点：周期任务不展开成多条记录，用 schedule（周期规则）+ instances（日期 -> 完成记录）
// 映射表达，避免数据膨胀。渲染某一天时先按 schedule 判定该日期是否应出现，再查 instances 取状态。

/** 周期类型：仅一次 / 工作日 / 非工作日 / 每天 */
export type ScheduleType = "once" | "workday" | "weekend" | "daily";

/** 执行周期规则 */
export interface Schedule {
  type: ScheduleType;
  /** 生效起始日，YYYY-MM-DD */
  startDate: string;
  /** 结束日，null 表示不封顶 */
  endDate: string | null;
}

/** 某一天的完成记录，键为本地日期 YYYY-MM-DD */
export interface DayRecord {
  done: boolean;
  /** 完成时刻 ISO8601，未完成为 null */
  doneAt: string | null;
}

/** 提醒设置 */
export interface Reminder {
  enabled: boolean;
  /** 提醒时刻，HH:mm */
  time: string;
}

/** 任务实体 */
export interface Task {
  /** UUID v4 */
  id: string;
  title: string;
  note: string;
  /** 创建时刻 ISO8601 */
  createdAt: string;
  schedule: Schedule;
  /** 日期字符串 YYYY-MM-DD -> 完成记录 */
  instances: Record<string, DayRecord>;
  reminder: Reminder;
  /**
   * 删除即归档（提示词 5.1）：置为 true 后任务不再出现在任何日期的待办与完成率分母中，
   * 但 instances 历史记录保留，贡献墙历史格子不会因删除而缺洞。
   */
  archived: boolean;
}

/** 新建任务时的入参 */
export interface CreateTaskInput {
  title: string;
  note: string;
  schedule: Schedule;
  reminder: Reminder;
}

/**
 * 编辑/新建表单的统一提交值：一次性写入 title / note / schedule / reminder。
 * 字段与 CreateTaskInput 完全一致，因此同一套表单既能新建也能编辑。
 */
export interface TaskEdit {
  title: string;
  note: string;
  schedule: Schedule;
  reminder: Reminder;
}
