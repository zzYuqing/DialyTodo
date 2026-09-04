// 职责：Todo 页的日模式 —— 单日任务清单 + 完成/编辑/归档 + 新建入口。
// 设计要点：
// - 任务过滤在纯函数层完成（lib/），本组件只负责按周期判定与展示；
// - 工作日判定由 useWorkdayChecker 注入，缓存未就绪时降级为按星期判定；
// - 新建与编辑共用 EditTaskModal，新建时即配置周期与提醒，不做"先建后改"；
// - 日期导航在 TodoView 容器上，本组件只渲染清单本体；
// - 未来日期（selectedDate > 今天）仍可点开并新建任务，但不可勾选完成（透传 disabledDone）。

import { useMemo, useState } from "react";
import { TaskItem } from "@/components/TaskItem/TaskItem";
import { AddTaskFab } from "@/components/AddTaskFab/AddTaskFab";
import { EditTaskModal, type TaskModalTarget } from "@/components/EditTaskModal/EditTaskModal";
import { collectTasksOfDay, todayKey } from "@/lib";
import { useTaskStore, useViewStore } from "@/stores";
import { useWorkdayChecker } from "@/hooks";
import type { TaskEdit } from "@/types";
import styles from "./DayMode.module.css";

export function DayMode() {
  const tasks = useTaskStore((s) => s.tasks);
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const setDone = useTaskStore((s) => s.setDone);
  const removeTask = useTaskStore((s) => s.removeTask);

  const selectedDate = useViewStore((s) => s.selectedDate);
  const hideCompleted = useViewStore((s) => s.hideCompleted);

  const isWorkday = useWorkdayChecker([selectedDate]);
  const isFuture = selectedDate > todayKey();
  const [target, setTarget] = useState<TaskModalTarget | null>(null);

  // 过滤当日应出现的任务
  const visibleTasks = useMemo(
    () => collectTasksOfDay(tasks, selectedDate, isWorkday),
    [tasks, selectedDate, isWorkday],
  );

  const filtered = hideCompleted
    ? visibleTasks.filter((t) => t.instances[selectedDate]?.done !== true)
    : visibleTasks;

  const handleSubmit = (edit: TaskEdit) => {
    if (target === null) return;
    if (target.kind === "create") {
      void addTask(edit);
      return;
    }
    void updateTask(target.task.id, edit);
  };

  const handleArchive = (id: string) => {
    if (window.confirm("归档后任务将从列表移除，但保留历史完成记录。确定？")) {
      void removeTask(id);
    }
  };

  return (
    <div className={styles.mode}>
      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {visibleTasks.length === 0
            ? (isFuture
                ? "这是未来的日子，现在还不能勾完成，但可以先建好任务。"
                : "这一天还没有任务，点击右下角 ＋ 新建一条吧。")
            : "这一天的任务已全部完成，干得漂亮 🎉"}
        </p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              dateKey={selectedDate}
              disabledDone={isFuture}
              onToggleDone={(id, done) => void setDone(id, selectedDate, done)}
              onEdit={(t) => setTarget({ kind: "edit", task: t })}
              onRemove={handleArchive}
            />
          ))}
        </ul>
      )}

      <AddTaskFab onClick={() => setTarget({ kind: "create", startDate: selectedDate })} />

      <EditTaskModal
        target={target}
        onSubmit={handleSubmit}
        onArchive={handleArchive}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
