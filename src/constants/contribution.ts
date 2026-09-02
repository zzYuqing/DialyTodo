// 职责：贡献墙完成率分档常量（提示词 5.6）。
// 色阶必须 5 档递进，0% 为极低透明度底色。具体色值定义在 styles/theme.css，
// 这里只引用 CSS 变量名，组件内不得硬编码颜色。

/** 完成率分档：0 表示 0%，1-4 依次对应 1-25% / 26-50% / 51-75% / 76-100% */
export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

/** 各档对应的 CSS 变量名 */
export const CONTRIBUTION_COLORS: Record<ContributionLevel, string> = {
  0: "var(--dt-contrib-0)",
  1: "var(--dt-contrib-1)",
  2: "var(--dt-contrib-2)",
  3: "var(--dt-contrib-3)",
  4: "var(--dt-contrib-4)",
};

/** 各档的中文说明，用于悬浮提示 */
export const CONTRIBUTION_LABELS: Record<ContributionLevel, string> = {
  0: "0%",
  1: "1–25%",
  2: "26–50%",
  3: "51–75%",
  4: "76–100%",
};
