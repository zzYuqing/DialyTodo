// 职责：无边框窗口（decorations:false）的自绘标题栏。
// 通过 data-tauri-drag-region 提供窗口拖动；最小化/最大化走 @tauri-apps/api/window。
// 关闭按钮按设置 closeToTray 决定隐藏到托盘还是整体退出；图钉按钮切换窗口置顶（提示词 5.5）。
// 纯 Vite（npm run dev，无 Rust 宿主）下按钮降级为 no-op，不崩溃。

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconMinus, IconPinned, IconPinnedOff, IconSquare, IconX } from "@tabler/icons-react";
import { isTauri, tauriBridge } from "@/bridge";
import { hideMainWindow } from "@/services";
import { useSettingsStore } from "@/stores";
import styles from "./TitleBar.module.css";

/** 还原按钮图标：两个错位叠放的方框（最大化态显示，表示点击恢复窗口） */
function RestoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {/* 后方方框 */}
      <rect x="4.4" y="1.8" width="9.6" height="9.6" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      {/* 前方方框：填充标题栏底色，盖住后方方框被遮挡的边线，hover 时同步换色 */}
      <rect
        className={styles.restoreFront}
        x="2"
        y="4.6"
        width="9.6"
        height="9.6"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

export function TitleBar() {
  const alwaysOnTop = useSettingsStore((s) => s.settings.alwaysOnTop);
  const closeToTray = useSettingsStore((s) => s.settings.closeToTray);
  const update = useSettingsStore((s) => s.update);
  const [maximized, setMaximized] = useState(false);

  // 跟随窗口的最大化 / 还原状态：初始查一次，之后靠 onResized 同步按钮图标
  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized);
    let unlisten: (() => void) | undefined;
    void win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const minimize = () => {
    if (!isTauri()) return;
    void getCurrentWindow().minimize();
  };

  const toggleMaximize = () => {
    if (!isTauri()) return;
    void getCurrentWindow().toggleMaximize();
  };

  // 关闭按钮：常驻托盘时隐藏到托盘（进程不退出，内存态保留），否则整体退出
  const close = () => {
    if (!isTauri()) return;
    if (closeToTray) void hideMainWindow();
    else void tauriBridge.invoke("quit_app");
  };

  // 图钉按钮：切换窗口置顶，置顶状态由 useWindowMode 生效到宿主窗口
  const toggleAlwaysOnTop = () => {
    void update({ alwaysOnTop: !alwaysOnTop });
  };

  return (
    <header className={styles.bar}>
      <div className={styles.drag} data-tauri-drag-region>
        普通待办小工具
      </div>
      <div className={styles.controls}>
        <button
          className={styles.control}
          onClick={toggleAlwaysOnTop}
          aria-label={alwaysOnTop ? "取消置顶" : "窗口置顶"}
          title={alwaysOnTop ? "取消置顶" : "窗口置顶"}
        >
          {alwaysOnTop ? <IconPinnedOff size={16} /> : <IconPinned size={16} />}
        </button>
        <button className={styles.control} onClick={minimize} aria-label="最小化">
          <IconMinus size={16} />
        </button>
        <button
          className={styles.control}
          onClick={toggleMaximize}
          aria-label={maximized ? "还原" : "最大化"}
          title={maximized ? "还原" : "最大化"}
        >
          {maximized ? <RestoreIcon /> : <IconSquare size={13} />}
        </button>
        <button
          className={`${styles.control} ${styles.controlClose}`}
          onClick={close}
          aria-label="关闭"
        >
          <IconX size={16} />
        </button>
      </div>
    </header>
  );
}
