// 职责：设置视图占位 —— 阶段 5 接入（主题、自启、提醒时间窗、节假日降级开关、备份策略）。

import { PlaceholderView } from "./PlaceholderView";

export function SettingsView() {
  return (
    <PlaceholderView
      name="设置"
      phase="5"
      description="主题切换、自启动、提醒时间窗、节假日降级开关、备份保留天数、数据目录跳转。"
    />
  );
}