// 职责：经验模块的常量集中定义（分类色板、取色规则）。
// 色值集中在常量层而非组件/service 内散落，避免同一颜色在多处各写一遍、
// 后续调色时对不齐（AGENTS.md 五节：组件禁止硬编码颜色）。

/** 分类名称最大长度，与编辑弹窗标题上限错开，避免超长撑破左栏 */
export const CATEGORY_NAME_MAX = 20;

/**
 * 分类色板：低饱和、浅深主题通用的 8 色。
 * 与「墨绿工房」主色故事同源（相同饱和度区间，无荧光色），
 * 保证分类圆点与徽章在白底 / 深底上都能辨认，且各色之间互不撞色。
 * 顺序即 chicklet 展示顺序；前 5 个为预置分类沿用值，改动会影响既有数据外观，谨慎调整。
 */
export const CATEGORY_COLORS = [
  "#c2452d", // 赭红
  "#2c7a53", // 墨绿
  "#b8860b", // 暗金
  "#5b6cc2", // 靛蓝
  "#75806f", // 灰绿
  "#4a8fa8", // 青碧
  "#8c559b", // 紫藤
  "#8a5a44", // 陶棕
] as const;

/**
 * 新建分类时的默认取色规则：按已有数量轮转色板，
 * 使连续新建的几个分类颜色不同（不必让用户每次手动挑）。
 */
export function pickNextCategoryColor(usedCount: number): string {
  return CATEGORY_COLORS[usedCount % CATEGORY_COLORS.length];
}
