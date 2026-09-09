// 职责：主窗口根组件。
// 布局：标题栏 → 左右分栏（Sidebar + 视图区）。
// 视图区按 useViewStore.view 渲染对应视图组件；App 只负责装配与初始化副作用。

import { useEffect, type JSX } from "react";
import { Sidebar, TitleBar } from "@/components";
import { ArchiveView, SettingsView, SimpleModeView, TodoView } from "@/views";
import { useReminders, useWindowMode } from "@/hooks";
import { useSettingsStore, useTaskStore, useViewStore } from "@/stores";
import type { ViewName } from "@/stores";
import styles from "./App.module.css";

/** 视图名 → 组件，避免每次渲染重建对象 */
const VIEW_COMPONENTS: Record<ViewName, () => JSX.Element> = {
  todo: () => <TodoView />,
  archive: () => <ArchiveView />,
  settings: () => <SettingsView />,
};

export default function App() {
  const initializeSettings = useSettingsStore((s) => s.initialize);
  const initializeTasks = useTaskStore((s) => s.initialize);
  const loadError = useTaskStore((s) => s.loadError);
  const corruptedBackupPath = useTaskStore((s) => s.corruptedBackupPath);
  const view = useViewStore((s) => s.view);
  const layout = useSettingsStore((s) => s.settings.layout);

  // 阶段 5 副作用接线：窗口形态（置顶+布局）、提醒调度（均无 UI）
  useWindowMode();
  useReminders();

  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([initializeSettings(), initializeTasks()]);
      } catch (err) {
        useTaskStore.setState({
          loaded: true,
          loadError: err instanceof Error ? err.message : String(err),
          corruptedBackupPath: null,
        });
      }
    };
    void init();
  }, [initializeSettings, initializeTasks]);

  // 简易模式走独立布局：不渲染侧栏与视图区，只显示当日待办
  if (layout === "simple") {
    return (
      <div className={styles.app}>
        <SimpleModeView />
      </div>
    );
  }

  const ViewComponent = VIEW_COMPONENTS[view];

  return (
    <div className={styles.app}>
      <TitleBar />
      <div className={styles.shell}>
        <Sidebar />
        <main className={styles.main}>
          {loadError !== null && (
            <div className={styles.errorBanner} role="alert">
              <div className={styles.errorBannerTitle}>数据加载异常</div>
              <div className={styles.errorBannerBody}>{loadError}</div>
              {corruptedBackupPath !== null && (
                <div className={styles.errorBannerHint}>
                  原文件已备份到 <code>{corruptedBackupPath}</code>，可手动比对或恢复。
                </div>
              )}
            </div>
          )}
          <ViewComponent />
        </main>
      </div>
    </div>
  );
}
