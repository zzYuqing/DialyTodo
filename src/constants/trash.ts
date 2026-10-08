// 职责：回收站保留天数的常量（默认值与上下限）。
// 与 subtask.ts 的 SUBTASK_DONE_KEEP_* 同构：默认值 + 区间，UI 与加载时都夹回区间内。

/** 回收站保留天数出厂默认值：一个月 */
export const DEFAULT_TRASH_RETENTION_DAYS = 30;

/** 最短保留 1 天，避免误设 0 导致删除即清空 */
export const TRASH_RETENTION_MIN = 1;

/** 最长保留一年 */
export const TRASH_RETENTION_MAX = 365;
