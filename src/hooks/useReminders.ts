// 职责：把提醒调度接到任务数据上（提示词 5.2）。
// 订阅任务列表与当天的工作日判定，变化即重排提醒；跨午夜自动重排次日。
// 提醒依赖进程存活：托盘常驻时正常，完全退出后不再提醒（reminderService 已注明）。

import { useEffect, useState } from "react";
import { todayKey } from "@/lib";
import { clearReminders, scheduleReminders } from "@/services";
import { useTaskStore } from "@/stores";
import { useWorkdayChecker } from "./useWorkdayChecker";

/**
 * 挂载即开始排定当天提醒，并随任务/工作日判定变化重排。
 * 跨日由 reminderService 的午夜计时器回调 setDayKey 触发，进而重排次日。
 */
export function useReminders(): void {
  const tasks = useTaskStore((s) => s.tasks);
  const [dayKey, setDayKey] = useState(() => todayKey());
  const isWorkday = useWorkdayChecker([dayKey]);

  useEffect(() => {
    scheduleReminders(tasks, isWorkday, dayKey, () => setDayKey(todayKey()));
    return () => clearReminders();
  }, [tasks, isWorkday, dayKey]);
}
