// 职责：简易模式 —— 仅显示当日待办的轻量界面（提示词 5.5）。
// - 左上角「退出简易模式」按钮，点击回到完整布局；
// - 无侧栏 / 贡献墙 / 月年视图 / 设置页；
// - 复用 DayMode 渲染当日任务清单（+ 按钮保留），进入时锁定 selectedDate 为今天。

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconArrowLeft, IconMinus, IconPinned, IconPinnedOff, IconX } from "@tabler/icons-react";
import { isTauri, tauriBridge } from "@/bridge";
import { hideMainWindow } from "@/services";
import { formatDateLabel, todayKey } from "@/lib";
import { useSettingsStore, useViewStore } from "@/stores";
import { DayMode } from "@/views/TodoView/DayMode";
import styles from "./SimpleModeView.module.css";

export function SimpleModeView() {
  const setSelectedDate = useViewStore((s) => s.setSelectedDate);
  const alwaysOnTop = useSettingsStore((s) => s.settings.alwaysOnTop);
  const closeToTray = useSettingsStore((s) => s.settings.closeToTray);
  const update = useSettingsStore((s) => s.update);

  // 简易模式只显示当日待办：进入即锁定今天
  useEffect(() => {
    setSelectedDate(todayKey());
  }, [setSelectedDate]);

  // 退出简易模式 → 回到完整布局（窗口尺寸由 useWindowMode 按 full 恢复）
  const exitSimple = () => {
    void update({ layout: "full" });
  };

  const minimize = () => {
    if (!isTauri()) return;
    void getCurrentWindow().minimize();
  };

  const close = () => {
    if (!isTauri()) return;
    if (closeToTray) void hideMainWindow();
    else void tauriBridge.invoke("quit_app");
  };

  // 置顶开关：与 TitleBar 图钉按钮语义一致，状态由 useWindowMode 生效到宿主窗口
  const toggleAlwaysOnTop = () => {
    void update({ alwaysOnTop: !alwaysOnTop });
  };

  return (
    <div className={styles.simple}>
      <header className={styles.bar}>
        <button className={styles.exit} onClick={exitSimple} title="退出简易模式">
          <IconArrowLeft size={15} />
          <span>退出简易模式</span>
        </button>
        <div className={styles.drag} data-tauri-drag-region />
        <div className={styles.controls}>
          <button
            className={styles.control}
            onClick={toggleAlwaysOnTop}
            aria-label={alwaysOnTop ? "取消置顶" : "窗口置顶"}
            title={alwaysOnTop ? "取消置顶" : "窗口置顶"}
          >
            {alwaysOnTop ? <IconPinned size={16} /> : <IconPinnedOff size={16} />}
          </button>
          <button className={styles.control} onClick={minimize} aria-label="最小化">
            <IconMinus size={16} />
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

      <div className={styles.head}>
        <h1 className={styles.title}>今日待办</h1>
        <p className={styles.date}>{formatDateLabel(todayKey())}</p>
      </div>

      <DayMode />
    </div>
  );
}
