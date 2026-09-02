// 职责：完成率计算与贡献墙分档（提示词 5.6）。
// 完成率 = 当日已完成数 / 当日应完成数，分 5 档色阶递进。
// 纯函数，不碰 IO。

import type { ContributionLevel } from "@/constants";
import type { Task } from "@/types";
import { occursOn, type WorkdayChecker } from "./schedule";

export interface DayCompletion {
  /** 当日应完成任务数 */
  total: number;
  /** 当日已完成数 */
  done: number;
  /** 完成率 0 - 1；当日无应完成任务时为 0 */
  ratio: number;
  /** 贡献墙色阶档位 */
  level: ContributionLevel;
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
  return tasks.filter((task) => !task.archived && occursOn(task.schedule, dateKey, isWorkday));
}

/** 计算某一天的完成情况 */
export function calcDayCompletion(
  tasks: Task[],
  dateKey: string,
  isWorkday: WorkdayChecker,
): DayCompletion {
  const dayTasks = collectTasksOfDay(tasks, dateKey, isWorkday);
  const done = dayTasks.filter((task) => task.instances[dateKey]?.done === true).length;
  const ratio = dayTasks.length === 0 ? 0 : done / dayTasks.length;

  return {
    total: dayTasks.length,
    done,
    ratio,
    level: ratioToLevel(ratio),
  };
}

/**
 * 完成率转档位（提示词 5.6 的五档口径）。
 * 0% → 0；1–25% → 1；26–50% → 2；51–75% → 3；76–100% → 4。
 */
export function ratioToLevel(ratio: number): ContributionLevel {
  if (ratio <= 0) return 0;
  const percent = ratio * 100;
  if (percent <= 25) return 1;
  if (percent <= 50) return 2;
  if (percent <= 75) return 3;
  return 4;
}
