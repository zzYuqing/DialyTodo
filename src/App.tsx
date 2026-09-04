// 职责：主窗口根组件。
// 布局：标题栏 → 左右分栏（Sidebar + 视图区）。
// 视图区按 useViewStore.view 渲染对应视图组件；App 只负责装配与初始化副作用。

import { useEffect, type JSX } from "react";
import { Sidebar, TitleBar } from "@/components";
import { ArchiveView, SettingsView, TodoView } from "@/views";
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
  const view = useViewStore((s) => s.view);

  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([initializeSettings(), initializeTasks()]);
      } catch (err) {
        useTaskStore.setState({
          loaded: true,
          loadError: err instanceof Error ? err.message : String(err),
        });
      }
    };
    void init();
  }, [initializeSettings, initializeTasks]);

  const ViewComponent = VIEW_COMPONENTS[view];

  return (
    <div className={styles.app}>
      <TitleBar />
      <div className={styles.shell}>
        <Sidebar />
        <main className={styles.main}>
          {loadError !== null && <p className={styles.error}>数据加载异常：{loadError}</p>}
          <ViewComponent />
        </main>
      </div>
    </div>
  );
}
