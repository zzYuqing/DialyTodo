// 职责：月视图占位 —— 阶段 4 接入月历网格 + 月度完成率。

import { PlaceholderView } from "./PlaceholderView";

export function MonthView() {
  return (
    <PlaceholderView
      name="月度视图"
      phase="4"
      description="月历网格展示当月每天的完成率，支持跳转任意日期。"
    />
  );
}