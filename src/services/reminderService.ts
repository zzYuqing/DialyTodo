// 职责：本机计时器驱动的提醒调度（提示词 5.2）。
// 不做常驻后台服务、不做分钟级轮询：用 setTimeout 一次性对齐到当天的 HH:mm。
// 已知取舍：进程必须存活才能触发。托盘常驻时正常，完全退出应用后不会提醒。

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  collectTasksOfDay,
  millisecondsUntil,
  millisecondsUntilMidnight,
  todayKey,
  type WorkdayChecker,
} from "@/lib";
import type { Task } from "@/types";

/** 已排定的任务提醒计时器句柄，重排时统一清理 */
const timers = new Set<ReturnType<typeof setTimeout>>();

/** 跨日重排计时器：到下一个午夜触发 onRollover，让调用方按新的一天重新排定 */
let rolloverTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 为某一天的全部待办重排提醒。
 * 思路：遍历当天应出现的任务，对开启提醒且时刻未过的任务各排一个一次性计时器；
 * 到点后发系统通知。当天已完成的任务不再提醒。
 * 传入 onRollover 时额外排一个午夜计时器，跨日后回调以重排次日提醒。
 */
export function scheduleReminders(
  tasks: Task[],
  isWorkday: WorkdayChecker,
  dateKey: string = todayKey(),
  onRollover?: () => void,
): void {
  clearReminders();

  const dayTasks = collectTasksOfDay(tasks, dateKey, isWorkday);

  for (const task of dayTasks) {
    if (!task.reminder.enabled) continue;
    if (task.instances[dateKey]?.done === true) continue;

    const delay = millisecondsUntil(task.reminder.time);
    if (delay <= 0) continue;

    const timer = setTimeout(() => {
      timers.delete(timer);
      void notify(task.title, task.reminder.time);
    }, delay);

    timers.add(timer);
  }

  if (onRollover !== undefined) {
    rolloverTimer = setTimeout(() => {
      rolloverTimer = null;
      onRollover();
    }, millisecondsUntilMidnight());
  }
}

/** 清理全部已排定的提醒（含跨日重排计时器） */
export function clearReminders(): void {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  if (rolloverTimer !== null) {
    clearTimeout(rolloverTimer);
    rolloverTimer = null;
  }
}

/** 发送系统通知。未授权时先申请，申请失败则静默放弃。 */
async function notify(title: string, time: string): Promise<void> {
  try {
    if (!(await isPermissionGranted())) {
      const permission = await requestPermission();
      if (permission !== "granted") return;
    }

    sendNotification({
      title: "待办提醒",
      body: `${time}　${title}`,
    });
  } catch {
    // 通知失败不影响主流程，静默处理
  }
}
