// 职责：归档视图占位 —— 阶段 6 接入（提示词 5.1：删除即归档、按原始周期规则保留历史贡献）。

import { PlaceholderView } from "./PlaceholderView";

export function ArchiveView() {
  return (
    <PlaceholderView
      name="归档视图"
      phase="6"
      description="展示已删除（归档）的任务，instances 历史保留，贡献墙格子不会因归档而留洞。"
    />
  );
}