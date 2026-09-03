// 职责：主窗口根组件。
// 阶段 3 接入视图路由 —— 左侧 Sidebar 切换视图，右侧按 useViewStore.view 渲染对应视图组件。
// DayView / 占位视图的具体内容各自维护；App 只负责装配与初始化副作用。

import { useEffect, type JSX } from "react";
import { Sidebar, TitleBar } from "@/components";
import { ArchiveView, DayView, MonthView, SettingsView } from "@/views";
import { useSettingsStore, useTaskStore, useViewStore } from "@/stores";
import type { ViewName } from "@/stores";
import styles from "./App.module.css";

/** 视图名 → 组件，避免每次渲染重建对象 */
const VIEW_COMPONENTS: Record<ViewName, () => JSX.Element> = {
  day: () => <DayView />,
  month: () => <MonthView />,
  archive: () => <ArchiveView />,
  settings: () => <SettingsView />,
  contribution: () => <MonthView />, // 阶段 3 未单独建，暂用月视图占位
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