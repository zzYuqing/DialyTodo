// 职责：备注折叠行数的常量（默认值与上下限）。
// 与 subtask.ts / trash.ts 同构：默认值 + 区间，UI 与加载时都夹回区间内。

/** 备注折叠前的展示行数出厂默认值：超出该行的备注才显示「展开」，默认 3 行 */
export const DEFAULT_NOTE_COLLAPSE_LINES = 3;

/** 至少展示 1 行，避免设为 0 时所有备注都被折叠（无意义） */
export const NOTE_COLLAPSE_LINES_MIN = 1;

/** 最多展示 10 行，防止折叠阈值过大失去「折叠」意义、把列表撑长 */
export const NOTE_COLLAPSE_LINES_MAX = 10;
