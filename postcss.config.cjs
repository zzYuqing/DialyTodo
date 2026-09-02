// 职责：PostCSS 配置。
// postcss-preset-mantine 提供 light-dark() 函数与 rem 换算，
// postcss-simple-vars 提供 Mantine 断点变量，使主题变量能集中在 styles/theme.css。
module.exports = {
  plugins: {
    "postcss-preset-mantine": {},
    "postcss-simple-vars": {
      variables: {
        "mantine-breakpoint-xs": "36em",
        "mantine-breakpoint-sm": "48em",
        "mantine-breakpoint-md": "62em",
        "mantine-breakpoint-lg": "75em",
        "mantine-breakpoint-xl": "88em",
      },
    },
  },
};
