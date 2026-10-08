// 职责：主窗口根组件。
// 布局：标题栏 → 左右分栏（Sidebar + 视图区）。
// 视图区按 useViewStore.view 渲染对应视图组件；App 只负责装配与初始化副作用。

import { useEffect, type JSX } from "react";
import { Sidebar, TitleBar, WindowResizer } from "@/components";
import {
  ExperienceView,
  LongTermView,
  SettingsView,
  SimpleModeView,
  TodoView,
  ToolsView,
  TrashView,
} from "@/views";
import { useReminders, useWindowMode } from "@/hooks";
import {
  useExperienceStore,
  useSettingsStore,
  useTaskStore,
  useTrashStore,
  useViewStore,
} from "@/stores";
import type { ViewName } from "@/stores";
import styles from "./App.module.css";

/** 视图名 → 组件，避免每次渲染重建对象 */
const VIEW_COMPONENTS: Record<ViewName, () => JSX.Element> = {
  todo: () => <TodoView />,
  experience: () => <ExperienceView />,
  longterm: () => <LongTermView />,
  tools: () => <ToolsView />,
  trash: () => <TrashView />,
  settings: () => <SettingsView />,
};

export default function App() {
  const initializeSettings = useSettingsStore((s) => s.initialize);
  const initializeTasks = useTaskStore((s) => s.initialize);
  const initializeExperiences = useExperienceStore((s) => s.initialize);
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
        // 先读设置：回收站启动扫描依赖保留天数（trashRetentionDays）
        await initializeSettings();
        await Promise.all([
          initializeTasks(),
          initializeExperiences(),
          useTrashStore.getState().initialize(),
        ]);
      } catch (err) {
        useTaskStore.setState({
          loaded: true,
          loadError: err instanceof Error ? err.message : String(err),
          corruptedBackupPath: null,
        });
      }
    };
    void init();
  }, [initializeSettings, initializeTasks, initializeExperiences]);

  // 简易模式走独立布局：不渲染侧栏与视图区，只显示当日待办
  if (layout === "simple") {
    return (
      <div className={styles.app}>
        <WindowResizer />
        <SimpleModeView />
      </div>
    );
  }

  const ViewComponent = VIEW_COMPONENTS[view];

  return (
    <div className={styles.app}>
      <WindowResizer />
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
