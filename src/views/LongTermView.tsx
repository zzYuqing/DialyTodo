// 职责：长期任务预览页 —— 汇总所有跨天的一次性长期任务
// （isLongTermOnce：once 且 endDate ≠ startDate，含 endDate === null 的「未指定截止日」长期任务），
// 按 待完成 / 已逾期 / 已完成 三组展示，支持勾选完成、编辑、归档。
// 设计：三组为可折叠分组卡片，左侧 3px 色条区分状态，组头带图标+计数+提示；
// 行内复用 TaskItem 卡片视觉（见 LongTermTaskRow）。归档（已删除）任务不计入。

import { useMemo, useState, type ComponentType } from "react";
import { AlertIcon, CheckCircleIcon, ClockIcon } from "@/components/Icons";
import {
  EditTaskModal,
  type TaskModalTarget,
} from "@/components/EditTaskModal/EditTaskModal";
import {
  LongTermTaskRow,
  type LongTermTone,
} from "@/components/LongTermTaskRow/LongTermTaskRow";
import {
  isLongTermOnce,
  longTermBucket,
  sortByCompletedAtDesc,
  sortByEndDateAsc,
  todayKey,
} from "@/lib";
import { useTaskStore } from "@/stores";
import type { Task, TaskEdit } from "@/types";
import styles from "./LongTermView.module.css";

interface SectionDef {
  tone: LongTermTone;
  title: string;
  icon: ComponentType<{ size?: number }>;
  hint: string;
}

const SECTIONS: Record<"pending" | "overdue" | "done", SectionDef> = {
  pending: { tone: "pending", title: "待完成", icon: ClockIcon, hint: "按截止日由近到远" },
  overdue: { tone: "overdue", title: "已逾期", icon: AlertIcon, hint: "截止日已过，尽快处理" },
  done: { tone: "done", title: "已完成", icon: CheckCircleIcon, hint: "按完成时间由新到旧" },
};

export function LongTermView() {
  const tasks = useTaskStore((s) => s.tasks);
  const setDone = useTaskStore((s) => s.setDone);
  const removeTask = useTaskStore((s) => s.removeTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const today = todayKey();
  const [target, setTarget] = useState<TaskModalTarget | null>(null);

  const { pending, overdue, done, total } = useMemo(() => {
    const longTerm = tasks.filter((t) => isLongTermOnce(t.schedule) && !t.archived);
    const pick = (bucket: "pending" | "overdue" | "done") =>
      longTerm
        .filter((t) => longTermBucket(t, today) === bucket)
        .sort(bucket === "done" ? sortByCompletedAtDesc : sortByEndDateAsc);
    return {
      pending: pick("pending"),
      overdue: pick("overdue"),
      done: pick("done"),
      total: longTerm.length,
    };
  }, [tasks, today]);

  const handleSubmit = (edit: TaskEdit) => {
    if (target === null) return;
    if (target.kind === "edit") void updateTask(target.task.id, edit);
  };

  const handleArchive = (id: string) => {
    if (window.confirm("归档后任务将从列表移除，但保留历史完成记录。确定？")) {
      void removeTask(id);
    }
  };

  const groups: { def: SectionDef; items: Task[] }[] = [
    { def: SECTIONS.pending, items: pending },
    { def: SECTIONS.overdue, items: overdue },
    { def: SECTIONS.done, items: done },
  ];

  return (
    <section className={styles.view}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>长期任务</h1>
          <p className={styles.context}>起始日开始执行的一次性长期任务（含无截止日）</p>
        </div>
        <div className={styles.summary}>
          <span className={`${styles.stat} ${styles.statAll}`}>全部 {total}</span>
          <span className={`${styles.stat} ${styles.statPending}`}>待完成 {pending.length}</span>
          <span className={`${styles.stat} ${styles.statOverdue}`}>已逾期 {overdue.length}</span>
        </div>
      </header>

      <div className={styles.content}>
        {total === 0 ? (
          <p className={styles.empty}>
            还没有长期任务。在「待办」页新建任务时，把结束日期设得比起始日晚，
            或关掉「指定结束日期」让它每天出现、直到你勾掉为止。
          </p>
        ) : (
          groups.map(({ def, items }) => (
            <LongTermSection
              key={def.tone}
              def={def}
              items={items}
              today={today}
              onToggleDone={(id, d) => void setDone(id, today, d)}
              onEdit={(t) => setTarget({ kind: "edit", task: t })}
              onRemove={handleArchive}
            />
          ))
        )}
      </div>

      <EditTaskModal
        target={target}
        onSubmit={handleSubmit}
        onArchive={handleArchive}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}

interface LongTermSectionProps {
  def: SectionDef;
  items: Task[];
  today: string;
  onToggleDone: (id: string, done: boolean) => void;
  onEdit: (task: Task) => void;
  onRemove: (id: string) => void;
}

function LongTermSection({
  def,
  items,
  today,
  onToggleDone,
  onEdit,
  onRemove,
}: LongTermSectionProps) {
  const [open, setOpen] = useState(true);
  const Icon = def.icon;

  return (
    <section className={`${styles.group} ${styles[`group_${def.tone}`]}`}>
      <button
        type="button"
        className={styles.groupHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} aria-hidden="true">
          <svg
            viewBox="0 0 16 16"
            width={14}
            height={14}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
        <span className={styles.groupIcon} aria-hidden="true">
          <Icon size={16} />
        </span>
        <span className={styles.groupTitle}>{def.title}</span>
        <span className={styles.groupCount}>{items.length}</span>
        <span className={styles.groupHint}>{def.hint}</span>
      </button>

      {open &&
        (items.length === 0 ? (
          <p className={styles.groupEmpty}>暂无{def.title}的长期任务</p>
        ) : (
          <ul className={styles.list}>
            {items.map((task) => (
              <LongTermTaskRow
                key={task.id}
                task={task}
                tone={def.tone}
                today={today}
                onToggleDone={onToggleDone}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}
