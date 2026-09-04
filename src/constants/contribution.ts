// 职责：贡献墙完成数量分档常量（提示词 5.6）。
// 色阶必须 5 档递进，0 项为极低透明度底色。具体色值定义在 styles/theme.css，
// 这里只引用 CSS 变量名，组件内不得硬编码颜色。
// 档位含义由 calcDaysCompletion 按窗口内单日完成数量动态划分：0 项为 0 档，
// 其余按近一年窗口内最大单日完成数量等分为 1-4 档。

/** 完成数量分档：0 表示 0 项，1-4 依次对应完成数量由少到多 */
export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

/** 贡献墙展示的滚动窗口月数（近一年，非自然年） */
export const CONTRIBUTION_YEAR_MONTHS = 12;

/** 全部档位，供图例按顺序渲染 */
export const CONTRIBUTION_LEVELS: ContributionLevel[] = [0, 1, 2, 3, 4];

/** 各档对应的 CSS 变量名 */
export const CONTRIBUTION_COLORS: Record<ContributionLevel, string> = {
  0: "var(--dt-contrib-0)",
  1: "var(--dt-contrib-1)",
  2: "var(--dt-contrib-2)",
  3: "var(--dt-contrib-3)",
  4: "var(--dt-contrib-4)",
};
