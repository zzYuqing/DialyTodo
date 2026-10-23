// 职责：完成率计算与贡献墙分档（提示词 5.6）。
// 单日完成率 = 当日已完成数 / 当日应完成数。
// 贡献墙色阶档位基于「近一年窗口内单日完成数量」分档：完成越多颜色越深，
// 最深档对应当前窗口内单日完成数量的最大值。
// 纯函数，不碰 IO。

import type { ContributionLevel } from "@/constants";
import type { Task } from "@/types";
import { occursOn, type WorkdayChecker } from "./schedule";
import { isLongDdlTask } from "./ddl";
import { buildTaskMap, isComposite, isRootTask } from "./composite";

export interface DayCompletion {
  /** 当日应完成任务数 */
  total: number;
  /** 当日已完成数 */
  done: number;
  /** 完成率 0 - 1；当日无应完成任务时为 0 */
  ratio: number;
  /** 贡献墙色阶档位；仅在批量窗口计算（calcDaysCompletion）时有效，单日计算无窗口上下文故为 0 */
  level: ContributionLevel;
  /**
   * 「截止日命中当天且尚未完成」的条数，顶层任务与任务集的子任务一并计入。
   * 判定本身与日期先后无关，由渲染端按日期决定读法：
   * - 过去 → 「已过期」条数，贡献墙用它决定右下角是否显示过期角标；
   * - 今天 / 未来 → 「当日截止」条数，贡献墙只用在悬浮文案里，不点亮红点
   *   （口径同 ddl.ts 的 isOverdueDdl：截止日当天还来得及做，越过截止点才算过期）。
   * 未命中截止日的日期恒为 0。
   */
  expiredDdlCount: number;
}

/**
 * 收集某一天应出现的全部任务。
 * 思路：先按 schedule 判定该日期是否应出现，再跳过已删除任务。
 */
export function collectTasksOfDay(
  tasks: Task[],
  dateKey: string,
  isWorkday: WorkdayChecker,
): Task[] {
  // 顶层过滤：子任务不单独出现在日清单顶层 —— 它的展示入口只有父任务的展开区，
  // 放出来会导致同一条任务出现两次。读 task.parentId 是 O(1)（由 syncChildrenIndex 保证准确）。
  return tasks.filter(
    (task) =>
      isRootTask(task) && !task.archived && occursOn(task.schedule, dateKey, isWorkday, task.completedAt),
  );
}

/**
 * 截止日命中该日且尚未完成（贡献墙口径：不区分过去与未来，读法由渲染端决定）。
 * 准入仍走 ddl.ts 的 isLongDdlTask —— 起止同日的 once 不算 DDL，不在此重复实现该规则。
 */
function isDueOnDay(task: Task, dateKey: string): boolean {
  return (
    isLongDdlTask(task.schedule) &&
    task.schedule.endDate === dateKey &&
    task.completedAt == null
  );
}

/**
 * 未完成的子任务按「截止日」分布的计数（贡献墙专用）。
 * 子任务不出现在日清单顶层，但它的截止日与父任务同样是「那天要交」的事实，
 * 逾期了贡献墙必须标得出来，因此与顶层任务同权计入（父与子同日截止计 2 项）。
 * 已完成（childDoneAt != null）、已归档、以及父任务集已归档的子任务一律不计。
 */
function subtaskDueByDay(tasks: Task[]): Map<string, number> {
  const map = buildTaskMap(tasks);
  const out = new Map<string, number>();
  for (const task of tasks) {
    if (isRootTask(task) || task.archived || task.childDoneAt != null) continue;
    const end = task.schedule.endDate;
    if (end == null || !isLongDdlTask(task.schedule)) continue;
    const parentId = task.parentId;
    if (parentId != null && (map.get(parentId)?.archived ?? false)) continue;
    out.set(end, (out.get(end) ?? 0) + 1);
  }
  return out;
}

/** 计算某一天的完成情况（不含窗口色阶档位） */
export function calcDayCompletion(
  tasks: Task[],
  dateKey: string,
  isWorkday: WorkdayChecker,
  /** 子任务截止日分布；批量计算时由调用方建一次传入，避免逐日重建索引 */
  subtaskDue?: Map<string, number>,
): DayCompletion {
  const dayTasks = collectTasksOfDay(tasks, dateKey, isWorkday);
  const done = dayTasks.filter((task) => task.instances[dateKey]?.done === true).length;
  const ratio = dayTasks.length === 0 ? 0 : done / dayTasks.length;
  // 贡献墙角标计数 = 顶层任务命中当天 + 子任务命中当天（后者不进日清单，须单独累加）
  const dueByDay = subtaskDue ?? subtaskDueByDay(tasks);
  const expiredDdlCount =
    dayTasks.filter((task) => isDueOnDay(task, dateKey)).length + (dueByDay.get(dateKey) ?? 0);

  return {
    total: dayTasks.length,
    done,
    ratio,
    level: 0,
    expiredDdlCount,
  };
}

/**
 * 无数据时的占位完成情况。
 * 渲染端用它可以免去 undefined 判断 —— 批量计算的结果必然覆盖传入的每个日期键，
 * 但 TS 的索引访问类型仍可能给出 undefined，这里统一兜底为空。
 */
export const EMPTY_COMPLETION: DayCompletion = {
  total: 0,
  done: 0,
  ratio: 0,
  level: 0,
  expiredDdlCount: 0,
};

/**
 * 批量计算多天的完成情况，返回「日期键 -> 完成情况」映射（月历与贡献墙共用）。
 * 思路：先逐日计算 total/done/ratio，再在窗口内按「单日完成数量」分档色阶：
 * 0 项为 0 档，其余按 maxDone 等分为 1-4 档，完成越多档位越高。
 *
 * 贡献墙口径修正（需求：任务集只有子任务完成才算完成数，父任务不算）：
 * 父任务的完成是 deriveCompositeCompletion 派生的聚合值（写入父 instances 的「最后完成日」），
 * 等于其子任务完成的汇总，不能和子任务各按实际完成日的计数重复相加。
 * 因此每格 done 在分档前做「减去父聚合 + 加上子任务按日完成」的修正，
 * 让贡献墙如实反映「当天实际勾掉了几项子任务」。
 * 该修正只作用在批量版（贡献墙），calcDayCompletion（日清单 statsLine）保持原口径，
 * 以免与日清单里看不到子任务勾选的视觉脱节。
 */
export function calcDaysCompletion(
  tasks: Task[],
  dateKeys: string[],
  isWorkday: WorkdayChecker,
  scaleKeys: string[] = dateKeys,
): Record<string, DayCompletion> {
  const result: Record<string, DayCompletion> = {};
  // 子任务截止日分布只建一次：批量计算覆盖近一年，逐日重建索引是 O(天数 × 任务数)
  const subtaskDue = subtaskDueByDay(tasks);
  for (const key of dateKeys) {
    result[key] = calcDayCompletion(tasks, key, isWorkday, subtaskDue);
  }

  const subtaskByDay = subtaskDoneByDay(tasks);
  const compositeByDay = compositeDoneByDay(tasks);
  for (const key of dateKeys) {
    const base = result[key];
    const adjusted = base.done - (compositeByDay.get(key) ?? 0) + (subtaskByDay.get(key) ?? 0);
    result[key] = { ...base, done: Math.max(0, adjusted) };
  }

  // 分档基准窗口：默认与 dateKeys 一致（向后兼容）；贡献墙月视图传入「近一年」窗口，
  // 使无论切到哪一年，色阶都锁定在近一年口径，不被所选年份的实际完成数带偏（completion.ts 硬定义）。
  const maxDone = Math.max(0, ...scaleKeys.map((k) => result[k]?.done ?? 0));
  for (const key of dateKeys) {
    result[key].level = countToLevel(result[key].done, maxDone);
  }

  return result;
}

/**
 * 每位子任务按「完成日」分布的计数（贡献墙专用）。
 * 子任务不出现在日清单顶层，但完成事件写在 childDoneAt；
 * childDoneAt 一律是 new Date().toISOString()（UTC Z 结尾），切片取日期，
 * 与 deriveCompositeCompletion 写入父 instances 的日期口径完全一致，父子不串日。
 */
function subtaskDoneByDay(tasks: Task[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const task of tasks) {
    if (isRootTask(task)) continue; // 仅子任务参与，跳过顶层任务与任务集父
    const at = task.childDoneAt;
    if (at == null) continue;
    const day = at.slice(0, 10);
    if (day.length !== 10) continue;
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  return map;
}

/**
 * 每位任务集父任务的聚合完成按「完成日」分布的计数（贡献墙专用，用于剔除重复计）。
 * 父 instances 里 done 的格子，就是它当初被推导写入「整体完成」的那天。
 */
function compositeDoneByDay(tasks: Task[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const task of tasks) {
    if (!isComposite(task)) continue;
    for (const [day, inst] of Object.entries(task.instances)) {
      if (inst.done) map.set(day, (map.get(day) ?? 0) + 1);
    }
  }
  return map;
}

/**
 * 单日完成数量转档位。
 * - 0 项 → 0 档（无色）；
 * - 其余按 maxDone 线性均分为 1-4 档，完成越多档位越高；
 * - maxDone 即当前窗口内单日完成数量的最大值，最深档对应该值。
 */
function countToLevel(done: number, maxDone: number): ContributionLevel {
  if (done <= 0 || maxDone <= 0) return 0;
  const bucket = Math.ceil((done / maxDone) * 4);
  return Math.min(4, Math.max(1, bucket)) as ContributionLevel;
}
