// 职责：无边框窗口（decorations:false）的自绘标题栏。
// 通过 data-tauri-drag-region 提供窗口拖动；最小化/最大化/关闭分别走
// @tauri-apps/api/window 与桥接层的 quit_app 命令。
// 纯 Vite（npm run dev，无 Rust 宿主）下按钮降级为 no-op，不崩溃。

import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconMinus, IconSquare, IconX } from "@tabler/icons-react";
import { isTauri, tauriBridge } from "@/bridge";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  const minimize = () => {
    if (!isTauri()) return;
    void getCurrentWindow().minimize();
  };

  const toggleMaximize = () => {
    if (!isTauri()) return;
    void getCurrentWindow().toggleMaximize();
  };

  // 关闭即整体退出（quit_app 会先销毁桌宠窗口，避免孤儿窗口，提示词 5.7）。
  // 阶段 5 引入托盘常驻后，此处将改为「关闭到托盘」，届时再调整。
  const close = () => {
    if (!isTauri()) return;
    void tauriBridge.invoke("quit_app");
  };

  return (
    <header className={styles.bar}>
      <div className={styles.drag} data-tauri-drag-region>
        DailyTodo
      </div>
      <div className={styles.controls}>
        <button className={styles.control} onClick={minimize} aria-label="最小化">
          <IconMinus size={16} />
        </button>
        <button className={styles.control} onClick={toggleMaximize} aria-label="最大化">
          <IconSquare size={13} />
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
