// 职责：DayView —— 今日任务 + 完成率 + 新建/编辑/完成/归档入口。
// 设计要点：
// - 任务过滤完全在纯函数层完成（lib/），DayView 只负责按周期判定与展示；
// - 工作日判定从 useHolidayStore 注入，避免在这里直接访问节假日缓存；
// - 新建与编辑共用 EditTaskModal，新建时即配置周期与提醒，不做"先建后改"；
// - 阶段 3 不做"上一日/下一日"日期切换，selectedDate 默认 = 今日。

import { useMemo, useState } from "react";
import { TaskItem } from "@/components/TaskItem/TaskItem";
import { AddTaskFab } from "@/components/AddTaskFab/AddTaskFab";
import { EditTaskModal, type TaskModalTarget } from "@/components/EditTaskModal/EditTaskModal";
import { useHolidayStore, useTaskStore, useViewStore } from "@/stores";
import {
  calcDayCompletion,
  collectTasksOfDay,
  formatDateLabel,
  isWorkdayByWeekday,
} from "@/lib";
import type { TaskEdit } from "@/types";
import { CONTRIBUTION_LABELS } from "@/constants";
import styles from "./DayView.module.css";

export function DayView() {
  const tasks = useTaskStore((s) => s.tasks);
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const setDone = useTaskStore((s) => s.setDone);
  const removeTask = useTaskStore((s) => s.removeTask);

  const selectedDate = useViewStore((s) => s.selectedDate);
  const hideCompleted = useViewStore((s) => s.hideCompleted);

  const ensureYear = useHolidayStore((s) => s.ensureYear);
  const checkerByYear = useHolidayStore((s) => s.checkers);

  // null = 弹窗关闭；create = 新建；edit = 编辑既有任务
  const [target, setTarget] = useState<TaskModalTarget | null>(null);

  // 当前年份的工作日判定：缓存有则用，没有则先按星期粗判（不联网时降级）
  const year = Number(selectedDate.slice(0, 4));
  void ensureYear(year);
  const checker = checkerByYear[year] ?? isWorkdayByWeekday;

  // 过滤今日应出现的任务
  const visibleTasks = useMemo(
    () => collectTasksOfDay(tasks, selectedDate, checker),
    [tasks, selectedDate, checker],
  );

  const filtered = hideCompleted
    ? visibleTasks.filter((t) => t.instances[selectedDate]?.done !== true)
    : visibleTasks;

  const completion = calcDayCompletion(tasks, selectedDate, checker);
  const completionLabel = CONTRIBUTION_LABELS[completion.level];

  const handleSubmit = (edit: TaskEdit) => {
    if (target === null) return;
    if (target.kind === "create") {
      void addTask(edit);
      return;
    }
    void updateTask(target.task.id, edit);
  };

  const handleArchive = (id: string) => {
    if (window.confirm("归档后任务将从今日列表移除，但保留历史完成记录。确定？")) {
      void removeTask(id);
    }
  };

  return (
    <section className={styles.view}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{formatDateLabel(selectedDate)}</h2>
          <p className={styles.subtitle}>
            今日 {completion.total} 项，已完成 {completion.done} · 完成度 {completionLabel}
          </p>
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {visibleTasks.length === 0
            ? "今天还没有任务，点击右下角 ＋ 新建一条吧。"
            : "今日任务已全部完成，干得漂亮 🎉"}
        </p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              dateKey={selectedDate}
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
    </section>
  );
}
