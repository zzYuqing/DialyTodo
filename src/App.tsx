// 职责：主窗口根组件（阶段 2 最小可跑骨架）。
// 后续阶段 3+ 在此接入路由式视图切换（日 / 月 / 贡献墙 / 归档 / 设置）。

import { useEffect } from "react";
import { TitleBar } from "@/components";
import { useSettingsStore, useTaskStore, useViewStore } from "@/stores";
import { formatDateLabel } from "@/lib";
import styles from "./App.module.css";

export default function App() {
  const tasks = useTaskStore((s) => s.tasks);
  const loaded = useTaskStore((s) => s.loaded);
  const loadError = useTaskStore((s) => s.loadError);
  const initializeTasks = useTaskStore((s) => s.initialize);
  const initializeSettings = useSettingsStore((s) => s.initialize);
  const selectedDate = useViewStore((s) => s.selectedDate);

  useEffect(() => {
    void initializeSettings();
    void initializeTasks();
  }, [initializeSettings, initializeTasks]);

  return (
    <div className={styles.app}>
      <TitleBar />
      <main className={styles.body}>
        <h1 className={styles.title}>DailyTodo</h1>
        <p className={styles.date}>{formatDateLabel(selectedDate)}</p>
        {loadError !== null && <p className={styles.error}>数据加载异常：{loadError}</p>}
        <p className={styles.hint}>
          {loaded
            ? `已加载 ${tasks.length} 个任务（含归档）。日/月/贡献墙等视图将在阶段 3 起逐步接入。`
            : "正在加载任务数据…"}
        </p>
      </main>
    </div>
  );
}
