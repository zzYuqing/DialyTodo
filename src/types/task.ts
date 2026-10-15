// 职责：任务领域模型的类型定义（提示词 4.2）。
// 设计要点：周期任务不展开成多条记录，用 schedule（周期规则）+ instances（日期 -> 完成记录）
// 映射表达，避免数据膨胀。渲染某一天时先按 schedule 判定该日期是否应出现，再查 instances 取状态。

/** 周期类型：仅一次 / 工作日 / 非工作日 / 每天 / 每周指定几天 / 特殊周期 */
export type ScheduleType = "once" | "workday" | "weekend" | "daily" | "weekly" | "special";

/** 特殊周期的时间单位 */
export type SpecialUnit = "day" | "week" | "month";

/**
 * 月锚点：每月第 ordinal 个星期几。
 * ordinal 取值 1–4 表示第 1–4 个，5 表示「最后一个」（当月不足 5 个时取实际最后一个）。
 * weekday 与全局一致：0 = 周一 … 6 = 周日。
 */
export interface MonthWeekdayAnchor {
  ordinal: 1 | 2 | 3 | 4 | 5;
  weekday: number;
}

/**
 * 特殊周期规则（ScheduleType = "special"）。
 * 三要素：unit（单位）× interval（每隔 N 个单位）× anchor（该单位内的命中锚点）。
 * 非对应 unit 的锚点字段恒为缺省（undefined / 空数组），由 normalizeTask 统一补齐。
 * 设计见 docs/特殊周期设计.md。
 */
export interface SpecialSchedule {
  unit: SpecialUnit;
  /** 每隔 N 个 unit 一次，整数 ≥ 1 */
  interval: number;
  /** unit=week：命中星期（0=周一…6=周日） */
  weekdays?: number[];
  /** unit=month：命中日期 1..31（多选） */
  monthDays?: number[];
  /** unit=month：命中「第几个星期几」 */
  monthWeekday?: MonthWeekdayAnchor[];
  /**
   * unit=month：是否命中「每月最后一天」。
   * 与 monthDays 互补 —— 数字 29/30/31 在 2 月 / 小月不存在（前端已禁止选择），
   * 「最后一天」自动取当月末日，大小月与闰年 2 月都适用，无需关心当月具体天数。
   */
  monthLastDay?: boolean;
}

/**
 * 任务形态。single = 普通任务（默认），composite = 任务集（复合任务）。
 * UI 判定一律走 lib/composite.ts 的 isComposite()，不裸比较字符串。
 */
export type TaskKind = "single" | "composite";

/** 执行周期规则 */
export interface Schedule {
  type: ScheduleType;
  /** 生效起始日，YYYY-MM-DD */
  startDate: string;
  /** 结束日，null 表示不封顶 */
  endDate: string | null;
  /**
   * 每周指定哪几天执行，仅 weekly 使用；其余类型恒为空数组。
   * 取值 0 = 周一 … 6 = 周日，与 lib/date.ts 的 weekdayIndexOf 一致（贡献墙同样以周一为起点）。
   * 空数组表示不落在任何一天（表单禁止提交空选，运行时兜底为 false）。
   * 该字段为阶段 7 新增的可选字段，存量数据没有它，由 normalizeTask 统一补 []。
   */
  weekdays?: number[];
  /**
   * 特殊周期规则，仅 type === "special" 使用；其余类型恒为 undefined。
   * 设计见 docs/特殊周期设计.md，结构与 weekly 的 weekdays 同样的「可选字段演化」模式。
   */
  special?: SpecialSchedule;
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
  /** 预留字段：删除任务时不再写入，store 启动时会清掉历史残留。 */
  archived: boolean;
  /**
   * 永久完成日期。仅跨天的一次性长期任务使用（定义见 lib/ddl.ts 的 isLongTermOnce：
   * schedule.type === "once" 且 endDate !== startDate，含 endDate === null 的无截止日任务）：
   * null 表示任务尚未完成；非 null 表示一次性勾选完成的日期（YYYY-MM-DD），
   * 该字段决定历史格子灰化与未来日期消失。起止同日的 once 任务与其他周期类型恒为 null。
   */
  completedAt: string | null;
  /**
   * 日清单手动排序序号，仅对未完成任务生效（已完成恒定沉底且不可拖动）：
   * - 数字：手动排过序，未完成区按升序排列；
   * - null / 字段缺失：未手动排过，走默认规则（活跃 DDL 置顶，其余按创建时间）。
   *
   * 拖动排序时按当时的显示顺序把未完成区整体固化成 0..n-1，
   * 因此手动排过后 DDL 自动置顶让位于用户顺序（拖到哪就是哪）。
   * 序号只表达相对顺序，允许不连续、允许与已完成任务的值重复（后者不参与比较）。
   */
  order?: number | null;

  /**
   * 任务形态。缺失视为 "single"，由 normalizeTask 补齐。
   * 显式存它（而不是用 children 的存在性推导）的唯一理由：要表达「零子任务的空任务集」，
   * 且表单开关 / 长期行展开区 / 校验都依赖这个显式概念。
   */
  kind?: TaskKind;

  /**
   * 子任务 id 列表，**数组顺序即显示顺序**。这是父子关系的权威源。
   * invariant（由 normalizeTask 与 composite.ts 的关系写入函数共同保证）：
   *   - kind === "composite" → children 必为数组（[] = 还没加子任务的空任务集）
   *   - kind !== "composite" → children 恒为 undefined
   *   - 同一个 childId 只能出现在一个 composite 的 children 里
   *   - children 里不出现自身 id，也不出现另一个 composite 的 id（只两级）
   */
  children?: string[];

  /**
   * 所属任务集的 id；**顶层任务恒为 null**（这个 null 就是「我是普通任务」的标记）。
   * 这是 children 的派生索引而非第二份关系数据：唯一生产者是 syncChildrenIndex
   * （载入 / 导入时全量重建）与 composite.ts 的关系写入函数。
   * 存它只为让「是不是顶层」「属于哪个父」变成 O(1) 读取，不必到处传 Set。
   */
  parentId?: string | null;

  /**
   * 作为子任务时的完成时刻（ISO8601），未完成为 null。顶层任务恒为 null。
   * 不复用 completedAt：后者定义为「跨天一次性长期任务的永久完成日期」，
   * 且会驱动 occursOn 关闭未来日期 —— 子任务不走那条链路，写它只会语义打架。
   */
  childDoneAt?: string | null;
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

/** 复合任务表单里的一条子任务草稿。id 为空表示尚未落盘的新子任务 */
export interface SubtaskDraft {
  /** 编辑既有子任务时有值；新增的为 undefined */
  id?: string;
  title: string;
  note: string;
  /** 子任务截止日；null = 无截止日 */
  endDate: string | null;
  /**
   * 已完成标记，仅编辑既有子任务时灌入（childDoneAt != null）。
   * 后端不消费此字段（applyCompositeSubtasks 只读 id/title/note/endDate），
   * 仅用于表单层把标题与截止日锁定为只读 —— 已勾选的子任务不允许改这两项。
   */
  done?: boolean;
}

/**
 * 复合任务的统一提交值：父任务字段 + 子任务草稿清单（顺序即显示顺序）。
 * 与 TaskEdit 分开是为了让「单条」那条链路一个字都不改。
 */
export interface CompositeEdit {
  title: string;
  note: string;
  /** 恒为 once；endDate 是「整体截止日」，可为 null */
  schedule: Schedule;
  reminder: Reminder;
  subtasks: SubtaskDraft[];
}

/**
 * 右键菜单里「把这条任务加进去」的一个候选任务集。
 * 只带 id 与标题：是否已是当前所属由渲染层拿 task.parentId 比，
 * 这样整个列表页只需构造一份数组，不必每行一份。
 */
export interface CompositeTarget {
  id: string;
  title: string;
}

/** 表单提交值：编辑弹窗对外只发这一个联合类型，由调用方按 kind 分发 */
export type TaskSubmitPayload =
  | { kind: "single"; edit: TaskEdit }
  | { kind: "composite"; edit: CompositeEdit };
