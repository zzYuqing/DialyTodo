// 职责：拦截主窗口的系统级关闭请求（Alt+F4、右键任务栏「关闭窗口」、OS 关闭等），
// 统一收编进 closeToTray 逻辑，避免主窗口被销毁后托盘无法唤起
// （Rust 侧 focus_main_window 依赖 get_webview_window("main") 存在；窗口一旦销毁即永久失联）。
// 仅作用于主窗口 WebView；pet 窗口是独立 WebView，不在此处注册。
// 纯 Vite（无宿主）环境无真实窗口，用 isTauri() 跳过注册。

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri, tauriBridge } from "@/bridge";
import { hideMainWindow } from "@/services";
import { useSettingsStore } from "@/stores";

export function useCloseGuard(): void {
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    // 自定义退出路径（closeToTray=false 时本处理器主动调 quit_app）的极端重入保护；
    // app.exit()/destroy() 不会触发 CloseRequested，故托盘「退出」不受影响。
    let quitting = false;

    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (quitting) return;

        // 先拦下销毁，再按设置决定隐藏到托盘还是整体退出。
        // 不加这层拦截，系统关窗会直接 destroy 主窗口，pet 窗口 + 托盘仍让进程存活，
        // 之后托盘「打开主窗口」/ 双击因找不到 main 窗口而失效。
        event.preventDefault();

        const closeToTray = useSettingsStore.getState().settings.closeToTray;
        if (closeToTray) {
          void hideMainWindow();
        } else {
          quitting = true;
          void tauriBridge.invoke("quit_app");
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
