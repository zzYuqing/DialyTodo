// 职责：把设置的窗口置顶与界面模式生效到宿主窗口，并维护 body 的形态标记（提示词 5.5）。
// - 置顶变化时调 windowService.applyAlwaysOnTop（只改 always-on-top）；
// - 界面模式变化时调 windowService.applyLayout（切布局与尺寸）；
// - body 挂 data-layout 供 CSS 做布局差异化样式。
// 置顶与界面模式互相独立，互不依赖。

import { useEffect } from "react";
import { isTauri } from "@/bridge";
import { applyAlwaysOnTop, applyLayout } from "@/services";
import { useSettingsStore } from "@/stores";

export function useWindowMode(): void {
  const alwaysOnTop = useSettingsStore((s) => s.settings.alwaysOnTop);
  const layout = useSettingsStore((s) => s.settings.layout);
  const loaded = useSettingsStore((s) => s.loaded);

  // 置顶生效到宿主窗口。设置加载完成后才应用，避免启动时用默认值覆盖持久化状态。
  useEffect(() => {
    if (!loaded || !isTauri()) return;
    void applyAlwaysOnTop(alwaysOnTop);
  }, [alwaysOnTop, loaded]);

  // 界面模式生效到宿主窗口（布局与尺寸）。纯 Vite（无宿主）下降级跳过。
  useEffect(() => {
    if (!loaded || !isTauri()) return;
    void applyLayout(layout);
  }, [layout, loaded]);

  // body 形态标记，供 CSS 做布局差异化（如简易模式收紧留白）
  useEffect(() => {
    document.body.dataset.layout = layout;
    return () => {
      delete document.body.dataset.layout;
    };
  }, [layout]);
}
