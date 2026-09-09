// 职责：完成率计算与贡献墙分档（提示词 5.6）。
// 单日完成率 = 当日已完成数 / 当日应完成数。
// 贡献墙色阶档位基于「近一年窗口内单日完成数量」分档：完成越多颜色越深，
// 最深档对应当前窗口内单日完成数量的最大值。
// 纯函数，不碰 IO。

import type { ContributionLevel } from "@/constants";
import type { Task } from "@/types";
import { occursOn, type WorkdayChecker } from "./schedule";
import { isOverdueDdl } from "./ddl";

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
   * 当天过期的 DDL 任务数。仅在 dateKey === schedule.endDate 且 completedAt === null 时为 1，
   * 贡献墙用此字段决定右下角是否显示过期角标。其他日期恒为 0。
   */
  expiredDdlCount: number;
}

/**
 * 收集某一天应出现的全部任务。
 * 思路：先按 schedule 判定该日期是否应出现，再跳过已归档任务
 * （删除语义为归档，归档任务不计入待办与完成率分母，提示词 5.1）。
 */
export function collectTasksOfDay(
  tasks: Task[],
  dateKey: string,
  isWorkday: WorkdayChecker,
): Task[] {
  return tasks.filter(
    (task) =>
      !task.archived && occursOn(task.schedule, dateKey, isWorkday, task.completedAt),
  );
}

/** 计算某一天的完成情况（不含窗口色阶档位） */
export function calcDayCompletion(
  tasks: Task[],
  dateKey: string,
  isWorkday: WorkdayChecker,
): DayCompletion {
  const dayTasks = collectTasksOfDay(tasks, dateKey, isWorkday);
  const done = dayTasks.filter((task) => task.instances[dateKey]?.done === true).length;
  const ratio = dayTasks.length === 0 ? 0 : done / dayTasks.length;
  // DDL 任务过期：endDate 当天且尚未完成，贡献墙角标用此计数。
  // 判定统一走 ddl.ts 的单一真相源：起止同日的 once 任务不算 DDL，不在此重复实现该规则。
  const expiredDdlCount = dayTasks.filter((task) => isOverdueDdl(task, dateKey)).length;

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
 */
export function calcDaysCompletion(
  tasks: Task[],
  dateKeys: string[],
  isWorkday: WorkdayChecker,
): Record<string, DayCompletion> {
  const result: Record<string, DayCompletion> = {};
  for (const key of dateKeys) {
    result[key] = calcDayCompletion(tasks, key, isWorkday);
  }

  const maxDone = Math.max(0, ...Object.values(result).map((c) => c.done));
  for (const key of dateKeys) {
    result[key].level = countToLevel(result[key].done, maxDone);
  }

  return result;
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
