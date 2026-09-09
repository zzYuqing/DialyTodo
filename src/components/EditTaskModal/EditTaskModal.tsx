// 职责：任务模态 —— 标题、备注、周期类型、起始/结束日期、提醒时间。
// 设计要点：
// - 同一套表单同时承担"新建"与"编辑"，新建时即完整配置周期与提醒，
//   避免"先建后改"的两步操作（提示词 5.1：编辑权重大于新建）；
// - target 为 null 表示关闭；kind=create 表示新建；kind=edit 表示编辑既有任务；
// - 表单状态按 targetKey 重新初始化，切换任务或重开弹窗都不会残留上一次的值；
// - "归档"按钮仅在编辑模式出现，直接调 onArchive（语义对应 store.removeTask）。
//
// 表单排布（阶段 6 + 方向 B）：
// - 周期独占一行；
// - 起始日期独立一行（无起始日预设下拉框）；
// - 「是否设置结束日期」开关 + 结束日期同行，开关=否时结束日期不可编辑（视为无 DDL）；
// - 校验：开关=是且结束日期早于起始日期 → 阻止提交并显示错误文本。

import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  TextInput,
  Textarea,
} from "@mantine/core";
import type { ScheduleType, Task, TaskEdit } from "@/types";
import { SCHEDULE_TYPES, SCHEDULE_TYPE_LABELS } from "@/constants";
import { todayKey } from "@/lib";
import styles from "./EditTaskModal.module.css";

/** 模态目标：新建时只需一个默认起始日，编辑时需要完整任务 */
export type TaskModalTarget =
  | { kind: "create"; startDate: string }
  | { kind: "edit"; task: Task };

interface EditTaskModalProps {
  /** null = 关闭 */
  target: TaskModalTarget | null;
  /** 提交统一的表单值，由父组件按 target.kind 决定新建还是更新 */
  onSubmit: (edit: TaskEdit) => void;
  onArchive: (id: string) => void;
  onClose: () => void;
}

/** 默认值：新建时的表单初值 */
const DEFAULT_REMINDER_TIME = "09:00";

// Mantine Select 的 onChange 回调给的是 string | null，
// 这里用常量表收窄成联合类型，避免用 as 强转绕过检查。
function isScheduleType(value: string): value is ScheduleType {
  return (SCHEDULE_TYPES as readonly string[]).includes(value);
}

export function EditTaskModal({ target, onSubmit, onArchive, onClose }: EditTaskModalProps) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [scheduleType, setScheduleType] = useState<Task["schedule"]["type"]>("once");
  const [startDate, setStartDate] = useState(todayKey());
  const [endDateEnabled, setEndDateEnabled] = useState(true);
  const [endDate, setEndDate] = useState(todayKey());
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState(DEFAULT_REMINDER_TIME);

  // 用 key 而非 target 本身做依赖：编辑模式下 store 刷新 task 引用时不会重置用户输入，
  // 只有真正切换了目标（换任务 / 重开新建）才重新灌值。
  const targetKey =
    target === null ? "" : target.kind === "edit" ? `edit:${target.task.id}` : `create:${target.startDate}`;

  useEffect(() => {
    if (target === null) return;

    if (target.kind === "edit") {
      setTitle(target.task.title);
      setNote(target.task.note);
      setScheduleType(target.task.schedule.type);
      setStartDate(target.task.schedule.startDate);
      // 编辑模式按 endDate 是否存在还原开关：有结束日 → 开，无 → 关
      setEndDateEnabled(target.task.schedule.endDate !== null);
      setEndDate(target.task.schedule.endDate ?? target.task.schedule.startDate);
      setReminderEnabled(target.task.reminder.enabled);
      setReminderTime(target.task.reminder.time);
      return;
    }

    setTitle("");
    setNote("");
    setScheduleType("once");
    setStartDate(target.startDate);
    // 新建默认「是」，结束日期 = 起始日期（DDL 当天）
    setEndDateEnabled(true);
    setEndDate(target.startDate);
    setReminderEnabled(false);
    setReminderTime(DEFAULT_REMINDER_TIME);
    // targetKey 已完整表达"目标身份"，target 只作为取值来源
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const isEdit = target !== null && target.kind === "edit";

  // 日期校验：仅当启用结束日期时才校验；结束日期早于起始日期视为不合法
  const endDateInvalid = endDateEnabled && endDate < startDate;

  const handleSubmit = () => {
    if (target === null) return;
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) return;
    if (endDateInvalid) return;
    onSubmit({
      title: trimmedTitle,
      note,
      schedule: {
        type: scheduleType,
        startDate,
        endDate: endDateEnabled ? endDate : null,
      },
      reminder: { enabled: reminderEnabled, time: reminderTime },
    });
    onClose();
  };

  const handleArchive = () => {
    if (target === null || target.kind !== "edit") return;
    onArchive(target.task.id);
    onClose();
  };

  return (
    <Modal
      opened={target !== null}
      onClose={onClose}
      title={isEdit ? "编辑任务" : "新建任务"}
      centered
      size="md"
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

          {/* 周期独占一行：起始日预设已去掉，永远走「自定义起始日期」 */}
          <Select
            label="周期"
            data={SCHEDULE_TYPES.map((v) => ({ value: v, label: SCHEDULE_TYPE_LABELS[v] }))}
            value={scheduleType}
            onChange={(v) => v !== null && isScheduleType(v) && setScheduleType(v)}
            allowDeselect={false}
          />

          {/* 起始日期独立一行 */}
          <TextInput
            type="date"
            label="起始日期"
            value={startDate}
            onChange={(e) => setStartDate(e.currentTarget.value)}
          />

          {/* 是否设置结束日期开关 + 结束日期同行：
              - 开关 = 否：结束日期禁用，等价于无 DDL（endDate=null）；
              - 开关 = 是：结束日期可编辑，默认值 = 起始日期；
              - 校验：结束日期早于起始日期时阻止提交并显示错误文本。 */}
          <Group grow align="flex-end">
            <div className={styles.switchRow}>
              <Switch
                label="是否设置结束日期"
                checked={endDateEnabled}
                onChange={(e) => {
                  const enabled = e.currentTarget.checked;
                  setEndDateEnabled(enabled);
                  // 关闭时清掉校验残留；打开时若 endDate 还停在禁用前的不合法状态，自动回退到 startDate
                  if (enabled && endDate < startDate) setEndDate(startDate);
                }}
              />
            </div>
            <TextInput
              type="date"
              label="结束日期"
              value={endDate}
              disabled={!endDateEnabled}
              error={endDateInvalid ? "结束日期不能早于起始日期" : undefined}
              onChange={(e) => setEndDate(e.currentTarget.value)}
            />
          </Group>

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
        </Stack>

        <Group justify="space-between" mt="md">
          {isEdit ? (
            <Button variant="subtle" color="red" onClick={handleArchive}>
              归档
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={title.trim().length === 0 || endDateInvalid}
            >
              {isEdit ? "保存" : "创建"}
            </Button>
          </Group>
        </Group>
      </form>
    </Modal>
  );
}
