// 职责：窗口形态相关常量集中定义（提示词 5.5）。
// 尺寸均为逻辑像素。FULL_* / SIMPLE_* 与窗口界面模式一一对应；
// MINI_* 保留给迷你模式（暂未开放，接口不删）。

/** 完整模式：侧栏 + 贡献墙 + 设置/归档的完整布局 */
export const FULL_WIDTH = 980;
export const FULL_HEIGHT = 680;
export const FULL_MIN_WIDTH = 760;
export const FULL_MIN_HEIGHT = 520;

/** 简易模式：仅当日待办，窗口更小，仍允许手动调整尺寸 */
export const SIMPLE_WIDTH = 420;
export const SIMPLE_HEIGHT = 620;
export const SIMPLE_MIN_WIDTH = 320;
export const SIMPLE_MIN_HEIGHT = 420;

/** 迷你模式：缩成小条（暂未开放，接口保留） */
export const MINI_WIDTH = 360;
export const MINI_HEIGHT = 180;

/** 边缘吸附阈值（逻辑像素）：窗口边距小于该值即吸附到屏幕边缘（当前未接线，接口保留） */
export const EDGE_SNAP_THRESHOLD = 16;
