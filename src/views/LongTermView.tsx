// 职责：长期任务预览页 —— 汇总所有跨天的一次性长期任务
// （isLongTermOnce：once 且 endDate ≠ startDate，含 endDate === null 的「未指定截止日」长期任务），
// 按 待完成 / 已逾期 / 已完成 三组归类，支持勾选完成、编辑、删除。
// 设计：左侧 168px 竖排状态导航（图标 + 名称 + 计数）一次只选一组，右侧列表区占满剩余高度独立滚动，
// 组内条数再多也能滚到底；行内复用 TaskItem 卡片视觉（见 LongTermTaskRow）。已删除任务不计入。

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { AlertIcon, CheckCircleIcon, ClockIcon } from "@/components/Icons";
import {
  EditTaskModal,
  type TaskModalTarget,
} from "@/components/EditTaskModal/EditTaskModal";
import { ConfirmDialog } from "@/components/ConfirmDialog/ConfirmDialog";
import { LongTermTaskRow } from "@/components/LongTermTaskRow/LongTermTaskRow";
import {
  buildTaskMap,
  isComposite,
  isLongTermOnce,
  isRootTask,
  longTermBucket,
  sortByCompletedAtDesc,
  sortByEndDateAsc,
  todayKey,
} from "@/lib";
import { useSettingsStore, useTaskStore, useTrashStore } from "@/stores";
import type { CompositeTarget, TaskSubmitPayload } from "@/types";
import styles from "./LongTermView.module.css";

type Bucket = "pending" | "overdue" | "done";

interface SectionDef {
  title: string;
  icon: ComponentType<{ size?: number }>;
  hint: string;
  /** 该组为空、但整体有长期任务时的文案 */
  empty: string;
}

/** 导航顺序：关注度高在前 */
const SECTION_ORDER: Bucket[] = ["pending", "overdue", "done"];

const SECTIONS: Record<Bucket, SectionDef> = {
  pending: {
    title: "待完成",
    icon: ClockIcon,
    hint: "按截止日由近到远",
    empty: "没有待完成的长期任务",
  },
  overdue: {
    title: "已逾期",
    icon: AlertIcon,
    hint: "截止日已过，尽快处理",
    empty: "没有已逾期的长期任务",
  },
  done: {
    title: "已完成",
    icon: CheckCircleIcon,
    hint: "按完成时间由新到旧",
    empty: "还没有已完成的长期任务",
  },
};

/** 整体一条长期任务都没有时的说明 */
const NO_TASK_TEXT =
  "还没有长期任务。在「待办」页新建任务时，把结束日期设得比起始日晚，" +
  "或关掉「指定结束日期」让它每天出现、直到你勾掉为止。";

/** 色调 → CSS 类（显式映射，禁止动态拼接类名） */
const TONE_CLASS: Record<Bucket, string> = {
  pending: styles.tone_pending,
  overdue: styles.tone_overdue,
  done: styles.tone_done,
};

export function LongTermView() {
  const tasks = useTaskStore((s) => s.tasks);
  const setDone = useTaskStore((s) => s.setDone);
  const moveTaskToTrash = useTrashStore((s) => s.moveTaskToTrash);
  const moveSubtaskToTrash = useTrashStore((s) => s.moveSubtaskToTrash);
  const updateCompositeWithTrash = useTrashStore((s) => s.updateCompositeWithTrash);
  const trashRetentionDays = useSettingsStore((s) => s.settings.trashRetentionDays);
  const updateTask = useTaskStore((s) => s.updateTask);
  const setSubtaskDone = useTaskStore((s) => s.setSubtaskDone);
  const reorderSubtasks = useTaskStore((s) => s.reorderSubtasks);
  const editSubtask = useTaskStore((s) => s.editSubtask);
  const addSubtask = useTaskStore((s) => s.addSubtask);
  const attachToComposite = useTaskStore((s) => s.attachToComposite);

  const today = todayKey();
  const [target, setTarget] = useState<TaskModalTarget | null>(null);
  // 默认落在「待完成」，逾期数量由左栏红色计数提示，不自动跳转
  const [active, setActive] = useState<Bucket>("pending");
  // 展开的是哪个任务集；用 Set 支持多个同时展开
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set<string>());

  const taskMap = useMemo(() => buildTaskMap(tasks), [tasks]);

  // 右键菜单「添加到任务集」的候选：所有未删除的任务集（整页只建一份，
  // 「本行当前属于哪个」由行内拿 parentId 比）
  const compositeTargets = useMemo<CompositeTarget[]>(
    () =>
      tasks
        .filter((task) => isComposite(task) && !task.archived)
        .map((task) => ({ id: task.id, title: task.title })),
    [tasks],
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buckets = useMemo(() => {
    // 长期页同样要过滤顶层：子任务（含 endDate 为 null 的）在 schedule 上
    // 也满足 isLongTermOnce，不过滤就会既出现在任务集的展开区、又出现在列表里。
    const longTerm = tasks.filter((t) => isRootTask(t) && isLongTermOnce(t.schedule) && !t.archived);
    const pick = (bucket: Bucket) =>
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

  const handleSubmit = (payload: TaskSubmitPayload) => {
    if (target === null || target.kind !== "edit") return;
    if (payload.kind === "composite") void updateCompositeWithTrash(target.task.id, payload.edit);
    else void updateTask(target.task.id, payload.edit);
  };

  /**
   * 待删除对象：用一个状态对象驱动二次确认弹窗，普通任务与子任务共用同一份。
   * null = 弹窗关闭；非 null = 弹窗开启并显示对应文案。
   * 取代原先的 window.confirm：原生对话框在浅/深主题下不可控、不可聚焦、阻断交互线程。
   */
  type PendingDelete =
    | { kind: "task"; id: string }
    | { kind: "subtask"; parentId: string; childId: string }
    | null;
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  const requestArchive = (id: string) => setPendingDelete({ kind: "task", id });
  const requestRemoveSubtask = (parentId: string, childId: string) =>
    setPendingDelete({ kind: "subtask", parentId, childId });

  // 真正执行删除：从 pendingDelete 取出目标，按类型走各自 store 动作，然后收起弹窗
  const confirmDelete = () => {
    if (pendingDelete === null) return;
    if (pendingDelete.kind === "task") void moveTaskToTrash(pendingDelete.id);
    else void moveSubtaskToTrash(pendingDelete.parentId, pendingDelete.childId);
    setPendingDelete(null);
  };

  // 弹窗文案：动态嵌入被删除对象的标题；任务集额外点明「及其全部子任务」
  const deleteMessage = useMemo<ReactNode>(() => {
    if (pendingDelete === null) return null;
    if (pendingDelete.kind === "task") {
      const t = tasks.find((x) => x.id === pendingDelete.id);
      const title = t?.title ?? "未命名任务";
      return t !== undefined && isComposite(t) ? (
        <>删除后任务集「<strong>{title}</strong>」及其全部子任务、历史完成记录将移入回收站，保留 {trashRetentionDays} 天后彻底清除。</>
      ) : (
        <>删除后任务「<strong>{title}</strong>」及其历史完成记录将移入回收站，保留 {trashRetentionDays} 天后彻底清除。</>
      );
    }
    const child = tasks.find((x) => x.id === pendingDelete.childId);
    const parent = tasks.find((x) => x.id === pendingDelete.parentId);
    return (
      <>子任务「<strong>{child?.title ?? "未命名子任务"}</strong>」将从任务集「<strong>{parent?.title ?? "未命名任务集"}</strong>」中移入回收站，保留 {trashRetentionDays} 天后彻底清除。</>
    );
  }, [pendingDelete, tasks, trashRetentionDays]);

  /** 右键「添加到任务集」：收编后它会从长期任务列表移进任务集展开区，先讲清后果 */
  const handleAttachToComposite = (childId: string, parentId: string) => {
    const child = tasks.find((task) => task.id === childId);
    const parent = tasks.find((task) => task.id === parentId);
    if (child === undefined || parent === undefined) return;
    const ok = window.confirm(
      `把「${child.title}」加入任务集「${parent.title}」。\n` +
        "之后它会从长期任务列表移入该任务集的展开区，截止日若超出任务集区间会自动收敛。\n" +
        "确定？",
    );
    if (ok) void attachToComposite(parentId, childId);
  };

  const def = SECTIONS[active];
  const items = buckets[active];
  const PanelIcon = def.icon;

  return (
    <section className={styles.view}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>长期任务</h1>
          <p className={styles.context}>起始日开始执行的一次性长期任务（含无截止日）</p>
        </div>
        <span className={`${styles.stat} ${styles.statAll}`}>全部 {buckets.total}</span>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav} aria-label="长期任务状态切换">
          {SECTION_ORDER.map((key) => {
            const item = SECTIONS[key];
            const Icon = item.icon;
            const isActive = key === active;
            const count = buckets[key].length;
            return (
              <button
                key={key}
                type="button"
                className={[
                  styles.navItem,
                  TONE_CLASS[key],
                  isActive ? styles.navItemActive : "",
                ]
                  .filter((c) => c !== "")
                  .join(" ")}
                onClick={() => setActive(key)}
                aria-current={isActive ? "true" : undefined}
              >
                <span className={styles.navIcon} aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className={styles.navLabel}>{item.title}</span>
                <span
                  className={`${styles.navCount}${
                    key === "overdue" && count > 0 ? ` ${styles.navCountAlert}` : ""
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>

        <section className={styles.panel} aria-label={def.title}>
          <div className={styles.panelHead}>
            <span className={`${styles.panelIcon} ${TONE_CLASS[active]}`} aria-hidden="true">
              <PanelIcon size={16} />
            </span>
            <span className={styles.panelTitle}>{def.title}</span>
            <span className={styles.panelCount}>{items.length}</span>
            <span className={styles.panelHint}>{def.hint}</span>
          </div>

          {items.length === 0 ? (
            <p className={styles.empty}>{buckets.total === 0 ? NO_TASK_TEXT : def.empty}</p>
          ) : (
            <div className={styles.listScroll}>
              <ul className={styles.list}>
                {items.map((task) => (
                  <LongTermTaskRow
                    key={task.id}
                    task={task}
                    tone={active}
                    today={today}
                    taskMap={taskMap}
                    expanded={expandedIds.has(task.id)}
                    onToggleExpand={toggleExpand}
                    onToggleSubtask={(parentId, childId, done) =>
                      void setSubtaskDone(parentId, childId, done)
                    }
                    onRemoveSubtask={requestRemoveSubtask}
                    onReorderSubtasks={(parentId, ids) => void reorderSubtasks(parentId, ids)}
                    onEditSubtask={(parentId, childId, edit) => void editSubtask(parentId, childId, edit)}
                    onAddSubtask={(parentId, title) => void addSubtask(parentId, title)}
                    compositeTargets={compositeTargets}
                    onAttachToComposite={handleAttachToComposite}
                    onToggleDone={(id, d) => void setDone(id, today, d)}
                    onEdit={(t) => setTarget({ kind: "edit", task: t })}
                    onRemove={requestArchive}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <EditTaskModal
        target={target}
        tasks={tasks}
        onSubmit={handleSubmit}
        onClose={() => setTarget(null)}
      />

      <ConfirmDialog
        opened={pendingDelete !== null}
        title={pendingDelete?.kind === "subtask" ? "删除子任务" : "删除任务"}
        message={deleteMessage}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
