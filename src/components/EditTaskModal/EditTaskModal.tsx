// 职责：任务模态 —— 标题、备注、周期类型、起始/结束日期、提醒时间。
// 设计要点：
// - 同一套表单同时承担"新建"与"编辑"，新建时即完整配置周期与提醒，
//   避免"先建后改"的两步操作（提示词 5.1：编辑权重大于新建）；
// - target 为 null 表示关闭；kind=create 表示新建；kind=edit 表示编辑既有任务；
// - 表单状态按 targetKey 重新初始化，切换任务或重开弹窗都不会残留上一次的值。
// - 删除入口在主页行内按钮（TaskItem / LongTermTaskRow 的垃圾桶图标），
//   本模态只管编辑/创建，避免误删。
//
// 表单排布（阶段 6 + 方向 B）：
// - 周期独占一行；weekly（每周指定）时在其下方追加星期多选，至少选一天；
// - 起始日期独立一行（无起始日预设下拉框）；
// - 「是否设置结束日期」开关 + 结束日期同行，开关=否时结束日期不可编辑（视为无 DDL）；
// - 校验：开关=是且结束日期早于起始日期 → 阻止提交并显示错误文本。

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Button,
  Chip,
  Group,
  Modal,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  TextInput,
  Textarea,
} from "@mantine/core";
import type { CompositeEdit, ScheduleType, SubtaskDraft, Task, TaskSubmitPayload } from "@/types";
import { SCHEDULE_TYPES, SCHEDULE_TYPE_LABELS, WEEKDAY_OPTIONS } from "@/constants";
import {
  buildTaskMap,
  childTasksOf,
  clampEndDateWithin,
  findParentOf,
  isComposite,
  sortSubtasksForDisplay,
  todayKey,
  weekdayIndexOf,
} from "@/lib";
import { CloseIcon, NoteIcon, PlusIcon, TrashIcon } from "@/components/Icons";
import styles from "./EditTaskModal.module.css";

/** 模态目标：新建时只需一个默认起始日，编辑时需要完整任务 */
export type TaskModalTarget =
  | { kind: "create"; startDate: string }
  | { kind: "edit"; task: Task };

interface EditTaskModalProps {
  /** null = 关闭 */
  target: TaskModalTarget | null;
  /** 全量任务。用于取复合任务的子任务实体，以及判断当前编辑对象是不是某个任务集的成员 */
  tasks: Task[];
  /** 提交统一的表单值，由父组件按 payload.kind 决定走哪条链路 */
  onSubmit: (payload: TaskSubmitPayload) => void;
  onClose: () => void;
}

/** 表单里的形态取值。任务集不允许再退化成普通任务（详情见本文件的形态切换段） */
type FormKind = "single" | "composite";

function isFormKind(value: string): value is FormKind {
  return value === "single" || value === "composite";
}

/** 一条空的子任务草稿：endDate=null，由行内开关控制是否填日期 */
function emptyDraft(): SubtaskDraft {
  return { title: "", note: "", endDate: null };
}

/**
 * 单条子任务草稿的阻断性问题，null = 通过。
 * 与 lib/composite.ts 的 clampEndDateWithin 共用同一套区间规则：
 * 「超出父 endDate」由表单在改动父日期时即时裁剪，这里只拦必须用户自己确认的两类。
 */
function subtaskIssue(draft: SubtaskDraft, parentStart: string, parentEnd: string | null): string | null {
  if (draft.title.trim().length === 0) return "请填写子任务标题";
  if (draft.endDate === null) {
    return parentEnd === null ? null : "父任务设置了整体截止日，子任务必须设置截止日";
  }
  if (draft.endDate < parentStart) return `子任务截止日不能早于整体起始日（${parentStart}）`;
  if (parentEnd !== null && draft.endDate > parentEnd) {
    return `子任务截止日不能超过整体截止日（${parentEnd}）`;
  }
  return null;
}

/** 默认值：新建时的表单初值 */
const DEFAULT_REMINDER_TIME = "09:00";

// Mantine Select 的 onChange 回调给的是 string | null，
// 这里用常量表收窄成联合类型，避免用 as 强转绕过检查。
function isScheduleType(value: string): value is ScheduleType {
  return (SCHEDULE_TYPES as readonly string[]).includes(value);
}

/** Chip.Group 的选中值（string | string[]）→ 升序去重的星期序号数组 */
function toWeekdays(value: string | string[]): number[] {
  const list = Array.isArray(value) ? value : [value];
  const parsed = list.map((item) => Number(item)).filter((day) => day >= 0 && day <= 6);
  return [...new Set(parsed)].sort((a, b) => a - b);
}

export function EditTaskModal({ target, tasks, onSubmit, onClose }: EditTaskModalProps) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [scheduleType, setScheduleType] = useState<Task["schedule"]["type"]>("once");
  /** 每周指定哪几天，0 = 周一 … 6 = 周日；仅 weekly 使用 */
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startDate, setStartDate] = useState(todayKey());
  const [endDateEnabled, setEndDateEnabled] = useState(true);
  const [endDate, setEndDate] = useState(todayKey());
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState(DEFAULT_REMINDER_TIME);
  /** 复合任务形态：新建时可切换，编辑任务集后不可再退化回普通任务 */
  const [formKind, setFormKind] = useState<FormKind>("single");
  /** 子任务草稿，数组顺序即显示顺序 */
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
  /** 上一次自动裁剪的提示文案，null = 无 */
  const [clampNotice, setClampNotice] = useState<string | null>(null);

  // 用 key 而非 target 本身做依赖：编辑模式下 store 刷新 task 引用时不会重置用户输入，
  // 只有真正切换了目标（换任务 / 重开新建）才重新灌值。
  const targetKey =
    target === null ? "" : target.kind === "edit" ? `edit:${target.task.id}` : `create:${target.startDate}`;

  const map = useMemo(() => buildTaskMap(tasks), [tasks]);
  const isEdit = target !== null && target.kind === "edit";
  /** 当前编辑对象是不是某个任务集的成员 —— 是则日期由父任务集统一管理，表单里只读 */
  const recordedParent = target !== null && target.kind === "edit" ? findParentOf(map, target.task) : null;
  const datesLocked = recordedParent !== null;

  useEffect(() => {
    if (target === null) return;
    setClampNotice(null);

    if (target.kind === "edit") {
      setTitle(target.task.title);
      setNote(target.task.note);
      setScheduleType(target.task.schedule.type);
      setWeekdays(target.task.schedule.weekdays ?? []);
      setStartDate(target.task.schedule.startDate);
      // 编辑模式按 endDate 是否存在还原开关：有结束日 → 开，无 → 关
      setEndDateEnabled(target.task.schedule.endDate !== null);
      setEndDate(target.task.schedule.endDate ?? target.task.schedule.startDate);
      setReminderEnabled(target.task.reminder.enabled);
      setReminderTime(target.task.reminder.time);
      // 复合任务：把现存子任务灌成草稿，顺序与 todo 页展开区一致
      // （未完成在前保持 children 原序，已完成的恒沉底） —— sortSubtasksForDisplay
      // 与 SubtaskPanel 走同一函数，保证两个入口看到的顺序完全一致。
      if (isComposite(target.task)) {
        setFormKind("composite");
        setSubtasks(
          sortSubtasksForDisplay(childTasksOf(map, target.task)).map((child) => ({
            id: child.id,
            title: child.title,
            note: child.note,
            endDate: child.schedule.endDate,
            // 已完成的子任务灌入 done=true，表单层据此把标题与截止日锁定只读
            done: child.childDoneAt != null,
          })),
        );
        return;
      }
      setFormKind("single");
      setSubtasks([]);
      return;
    }

    setTitle("");
    setNote("");
    setScheduleType("once");
    // 默认预选起始日所在的星期，避免新建 weekly 时留空
    setWeekdays([weekdayIndexOf(target.startDate)]);
    setStartDate(target.startDate);
    // 新建默认「是」，结束日期 = 起始日期（DDL 当天）
    setEndDateEnabled(true);
    setEndDate(target.startDate);
    setReminderEnabled(false);
    setReminderTime(DEFAULT_REMINDER_TIME);
    setFormKind("single");
    setSubtasks([]);
    // targetKey 已完整表达"目标身份"，target 只作为取值来源；map 同理（只作为取子任务实体的索引）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const isCompositeForm = formKind === "composite";
  /** 父 task 的整体截止日；null = 无 */
  const parentEnd = endDateEnabled ? endDate : null;

  // 日期校验：仅当启用结束日期时才校验；结束日期早于起始日期视为不合法
  const endDateInvalid = endDateEnabled && endDate < startDate;
  // 每周指定：至少选一天，否则任务永远不会出现在任何日期。复合任务恒为 once，不会触发
  const weekdaysInvalid = !isCompositeForm && scheduleType === "weekly" && weekdays.length === 0;

  const issues = isCompositeForm ? subtasks.map((draft) => subtaskIssue(draft, startDate, parentEnd)) : [];
  const subtasksInvalid = isCompositeForm && issues.some((issue) => issue !== null);
  const subtasksEmpty = isCompositeForm && subtasks.length === 0;
  const submitDisabled =
    title.trim().length === 0 ||
    endDateInvalid ||
    weekdaysInvalid ||
    subtasksInvalid ||
    subtasksEmpty;

  /**
   * 父日期改动后的即时收敛：把越界的子任务截止日裁剪回新的父区间，
   * 并给出一次性提示。小于整体起始日的不在这里偷偷改 —— 那是用户明确看到的行内错误，由他自己改。
   */
  const autoClampSubtasks = (drafts: SubtaskDraft[], nextStart: string, nextEnd: string | null) => {
    if (!isCompositeForm || drafts.length === 0) return drafts;
    let count = 0;
    const next = drafts.map((draft) => {
      const clamped = clampEndDateWithin(draft.endDate, nextStart, nextEnd);
      if (clamped === draft.endDate) return draft;
      count += 1;
      return { ...draft, endDate: clamped };
    });
    setClampNotice(
      count === 0
        ? null
        : `已将 ${count} 个子任务的截止日同步调整为 ${nextEnd === null ? "无截止日" : nextEnd}（跟随整体截止日）`,
    );
    return next;
  };

  /** 就地改一条子任务草稿：标题 / 截止日 / 备注三个字段共用这一个入口，
      否则同一段 setSubtasks(map) 要在下面重复四遍。 */
  const patchSubtask = (index: number, patch: Partial<SubtaskDraft>) => {
    setSubtasks((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleEndDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setEndDate(value);
    setSubtasks((current) => autoClampSubtasks(current, startDate, endDateEnabled ? value : null));
  };

  const handleStartDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setStartDate(value);
    // 起始日后移时同步把结束日顶上去，避免立刻出现「结束早于起始」的报错态
    const nextEnd = endDateEnabled ? (endDate < value ? value : endDate) : null;
    if (nextEnd !== null) setEndDate(nextEnd);
    setSubtasks((current) => autoClampSubtasks(current, value, nextEnd));
  };

  const handleKindChange = (value: string) => {
    if (!isFormKind(value)) return;
    setFormKind(value);
    if (value === "composite") {
      // 周期性任务不能进集，形态切换时一并归位到 once
      setScheduleType("once");
      // 任务集默认不设整体截止日：截止日交给子任务各自的开关控制
      setEndDateEnabled(false);
      setSubtasks((current) => (current.length === 0 ? [emptyDraft()] : current));
    }
  };

  const handleSubmit = () => {
    if (target === null || submitDisabled) return;
    const trimmedTitle = title.trim();

    if (isCompositeForm) {
      // 复合任务恒为 once；weekdays 恒写 []
      const edit: CompositeEdit = {
        title: trimmedTitle,
        note,
        schedule: { type: "once", startDate, endDate: parentEnd, weekdays: [] },
        reminder: { enabled: reminderEnabled, time: reminderTime },
        subtasks: subtasks.map((draft) => ({
          ...draft,
          title: draft.title.trim(),
          endDate: clampEndDateWithin(draft.endDate, startDate, parentEnd),
        })),
      };
      onSubmit({ kind: "composite", edit });
      onClose();
      return;
    }

    onSubmit({
      kind: "single",
      edit: {
        title: trimmedTitle,
        note,
        schedule: {
          type: scheduleType,
          startDate,
          endDate: endDateEnabled ? endDate : null,
          // 非 weekly 恒写空数组，与 normalizeTask 的补齐口径一致，避免 undefined 落盘
          weekdays: scheduleType === "weekly" ? weekdays : [],
        },
        reminder: { enabled: reminderEnabled, time: reminderTime },
      },
    });
    onClose();
  };

  return (
    <Modal
      opened={target !== null}
      onClose={onClose}
      title={
        isCompositeForm
          ? isEdit
            ? "编辑任务集"
            : "新建任务集"
          : isEdit
            ? "编辑任务"
            : "新建任务"
      }
      centered
      size={isCompositeForm ? "lg" : "md"}
      overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
      classNames={{ content: styles.modal, header: styles.header }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <Stack gap="xs">
          <TextInput
            label="标题"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            maxLength={120}
            required
            data-autofocus
          />
          <Textarea
            label="备注"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={5}
          />

          {/*
            形态切换：普通任务 ↔ 任务集。
            - 编辑任务集时不可再切回普通任务：这条路没有设计过降级逻辑（子任务该解散还是保留没定义），
              所以直接锁死并给出说明，而不是留一个会丢数据的开关；
            - 编辑对象本身是某个任务集的成员时，整个切换控件也不出现（它的形态由父决定）。
          */}
          {!datesLocked && (
            <div>
              <SegmentedControl
                fullWidth
                size="sm"
                value={formKind}
                onChange={handleKindChange}
                // 编辑任务集时锁死：没设计过「任务集降级回普通任务」的路径（子任务是解散还是保留？）
                // 留一个能点但会丢数据的开关不如直接禁用 + 说明。
                disabled={isEdit && isCompositeForm}
                data={[
                  { value: "single", label: "普通任务" },
                  { value: "composite", label: "任务集" },
                ]}
              />
              {isEdit && isCompositeForm && (
                <div className={styles.hint}>任务集不能再改回普通任务</div>
              )}
            </div>
          )}

          {/* 周期独占一行：起始日预设已去掉，永远走「自定义起始日期」。
              复合任务不出现这一行 —— 它恒为 once，周期性任务禁止进任务集（规则 16）。 */}
          {!isCompositeForm && (
            <Select
              label="周期"
              data={SCHEDULE_TYPES.map((v) => ({ value: v, label: SCHEDULE_TYPE_LABELS[v] }))}
              value={scheduleType}
              onChange={(v) => v !== null && isScheduleType(v) && setScheduleType(v)}
              allowDeselect={false}
            />
          )}

          {/* 每周指定：周期选 weekly 时才出现，多选星期（0 = 周一 … 6 = 周日）。
              与日历/节假日无关，用户显式点哪天就哪天；未选任何一天时阻止提交。 */}
          {scheduleType === "weekly" && (
            <div className={styles.weekdayBlock}>
              <div className={styles.weekdayLabel}>执行日（可多选）</div>
              <Chip.Group
                multiple
                value={weekdays.map((day) => String(day))}
                onChange={(value) => setWeekdays(toWeekdays(value))}
              >
                <Group gap={6}>
                  {WEEKDAY_OPTIONS.map((option) => (
                    <Chip
                      key={option.value}
                      value={String(option.value)}
                      size="xs"
                      radius="sm"
                      variant="outline"
                    >
                      {option.label}
                    </Chip>
                  ))}
                </Group>
              </Chip.Group>
              {weekdaysInvalid && <div className={styles.weekdayError}>请至少选择一天</div>}
            </div>
          )}

          {/* 起始日期独立一行。
              复合任务里它同时是所有子任务截止日的下界：改动后会即时收敛子任务的越界日期。
              当前编辑对象本身是子任务时，日期整体只读 —— 它的日期由所属任务集统一管理。 */}
          <TextInput
            type="date"
            label={isCompositeForm ? "整体起始日期" : "起始日期"}
            value={startDate}
            disabled={datesLocked}
            onChange={handleStartDateChange}
          />

          {/* 是否设置结束日期开关 + 结束日期同行：
              - 开关 = 否：结束日期禁用，等价于无 DDL（endDate=null）；
              - 开关 = 是：结束日期可编辑，默认值 = 起始日期；
              - 校验：结束日期早于起始日期时阻止提交并显示错误文本；
              - 复合任务下这个「结束日期」是整体截止日，同时是所有子任务截止日的上界。 */}
          <Group grow align="flex-end">
            <div className={styles.switchRow}>
              <Switch
                label={isCompositeForm ? "是否设置整体截止日" : "是否设置结束日期"}
                checked={endDateEnabled}
                disabled={datesLocked}
                onChange={(e) => {
                  const enabled = e.currentTarget.checked;
                  setEndDateEnabled(enabled);
                  // 关闭时清掉校验残留；打开时若 endDate 还停在禁用前的不合法状态，自动回退到 startDate
                  if (enabled && endDate < startDate) setEndDate(startDate);
                  setSubtasks((current) =>
                    autoClampSubtasks(current, startDate, enabled ? endDate : null),
                  );
                }}
              />
            </div>
            <TextInput
              type="date"
              label={isCompositeForm ? "整体截止日" : "结束日期"}
              value={endDate}
              disabled={!endDateEnabled || datesLocked}
              error={endDateInvalid ? "结束日期不能早于起始日期" : undefined}
              onChange={handleEndDateChange}
            />
          </Group>

          {datesLocked && (
            <div className={styles.hint}>
              该任务属于任务集「{recordedParent?.title ?? ""}」，起始日与截止日请在任务集里统一修改
            </div>
          )}

          <Group grow align="flex-end">
            <div className={styles.switchRow}>
              <Switch
                label="启用提醒"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.currentTarget.checked)}
              />
            </div>
            <TextInput
              type="time"
              label="提醒时间"
              value={reminderTime}
              disabled={!reminderEnabled}
              onChange={(e) => setReminderTime(e.currentTarget.value)}
            />
          </Group>

          {/* 子任务编辑区：只有任务集才有。
              每条子任务 = 序号 + 标题 + 截止日 + 备注，顺序即显示顺序（拖动在列表页做）。
              父的整体截止日开启时子任务必填截止日，这里逐行给出具体问题。
              层级：标题输入保留描边（主），备注退成无边框浅底条（次），
              截止日收成一枚胶囊，删除收成图标 —— 一行里不再有四个同权重的控件。 */}
          {isCompositeForm && (
            <div className={styles.subtaskBlock}>
              <Group justify="space-between" align="center" gap={6}>
                <Group gap={6} align="baseline">
                  <span className={styles.subtaskTitle}>子任务</span>
                  <span className={styles.subtaskCount}>{subtasks.length} 条</span>
                </Group>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<PlusIcon size={12} />}
                  onClick={() => setSubtasks((current) => [...current, emptyDraft()])}
                >
                  添加子任务
                </Button>
              </Group>

              {subtasks.length === 0 && (
                <div className={styles.subtaskError}>任务集至少需要 1 个子任务</div>
              )}

              <Stack gap={6}>
                {subtasks.map((draft, index) => {
                  // 父有截止日时子任务必填截止日（subtaskIssue 强制），
                  // 这时不给「清除截止日」，避免清掉后立刻出现校验错误。
                  const endDateLocked = parentEnd !== null;
                  // 已勾选完成的子任务：标题与截止日锁定只读，仅备注可编辑。
                  // 防止「已完成」状态被改标题/截止日造成历史完成态对不上的语义漂移。
                  const doneLocked = draft.done === true;
                  return (
                    <div
                      key={draft.id ?? `new-${index}`}
                      className={`${styles.subtaskRow}${doneLocked ? ` ${styles.subtaskRowDone}` : ""}`}
                    >
                      <div className={styles.subtaskHead}>
                        {/* 序号常驻：placeholder 输入后就消失，靠它才能一眼认出这是第几条 */}
                        <span className={styles.subtaskIndex}>
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <TextInput
                          className={styles.subtaskName}
                          placeholder={`子任务 ${index + 1}`}
                          value={draft.title}
                          maxLength={120}
                          readOnly={doneLocked}
                          onChange={(e) => patchSubtask(index, { title: e.currentTarget.value })}
                        />
                        {/* 截止日：未设置 = 虚线胶囊，点一下设为整体起始日；
                            已设置 = 浅绿胶囊内嵌无边框日期输入 + 清除键。
                            父任务有整体截止日时不允许清除（endDateLocked），
                            已勾选完成的行整体只读（doneLocked）。 */}
                        {draft.endDate === null ? (
                          <button
                            type="button"
                            className={styles.dueAdd}
                            disabled={doneLocked}
                            onClick={() => patchSubtask(index, { endDate: startDate })}
                          >
                            <PlusIcon size={11} />
                            截止
                          </button>
                        ) : (
                          <div className={styles.dueSet}>
                            <TextInput
                              type="date"
                              size="xs"
                              variant="unstyled"
                              className={styles.dueInput}
                              value={draft.endDate}
                              readOnly={doneLocked}
                              onChange={(e) =>
                                patchSubtask(index, { endDate: e.currentTarget.value || null })
                              }
                            />
                            {!endDateLocked && !doneLocked && (
                              <button
                                type="button"
                                className={styles.dueClear}
                                aria-label="清除截止日"
                                title="清除截止日"
                                onClick={() => patchSubtask(index, { endDate: null })}
                              >
                                <CloseIcon size={11} />
                              </button>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          className={styles.subtaskRemove}
                          aria-label="删除这条子任务"
                          title="删除这条子任务"
                          onClick={() =>
                            setSubtasks((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          <TrashIcon size={13} />
                        </button>
                      </div>
                      {/* 备注条：不描边、不加 label，退成卡片里的第二行补充说明。
                          始终渲染，不做「有内容才出现」的条件分支。 */}
                      <div className={styles.subtaskNote}>
                        <span className={styles.subtaskNoteIcon}>
                          <NoteIcon size={11} />
                        </span>
                        <TextInput
                          variant="unstyled"
                          size="xs"
                          className={styles.subtaskNoteInput}
                          placeholder="备注（可选）"
                          value={draft.note}
                          onChange={(e) => patchSubtask(index, { note: e.currentTarget.value })}
                        />
                      </div>
                      {doneLocked && (
                        <div className={styles.subtaskDoneHint}>已勾选完成，标题与截止日不可改</div>
                      )}
                    </div>
                  );
                })}
              </Stack>

              {clampNotice !== null && <div className={styles.subtaskNotice}>{clampNotice}</div>}
            </div>
          )}
        </Stack>

        <Group justify="flex-end" mt="md" gap="xs">
          <Button variant="default" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={submitDisabled}>
            {isEdit ? "保存" : "创建"}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
