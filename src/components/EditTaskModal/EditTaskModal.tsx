// 职责：任务模态 —— 标题、备注、周期类型、起始/结束日期、提醒时间。
// 设计要点：
// - 同一套表单同时承担"新建"与"编辑"，新建时即完整配置周期与提醒，
//   避免"先建后改"的两步操作（提示词 5.1：编辑权重大于新建）；
// - target 为 null 表示关闭；kind=create 表示新建；kind=edit 表示编辑既有任务；
// - 表单状态按 targetKey 重新初始化，切换任务或重开弹窗都不会残留上一次的值；
// - "归档"按钮仅在编辑模式出现，直接调 onArchive（语义对应 store.removeTask）。

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
import {
  SCHEDULE_TYPES,
  SCHEDULE_TYPE_LABELS,
  START_DATE_PRESETS,
  START_DATE_PRESET_LABELS,
  type StartDatePreset,
} from "@/constants";
import { addDaysToKey, todayKey } from "@/lib";
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

/** 根据 startDatePreset 反推起始日（"自定义"时维持当前值） */
function resolveStartDate(preset: StartDatePreset, current: string): string {
  switch (preset) {
    case "today":
      return todayKey();
    case "tomorrow":
      return addDaysToKey(todayKey(), 1);
    case "custom":
      return current;
  }
}

/** 默认值：新建时的表单初值 */
const DEFAULT_REMINDER_TIME = "09:00";

// Mantine Select 的 onChange 回调给的是 string | null，
// 这里用常量表收窄成联合类型，避免用 as 强转绕过检查。
function isScheduleType(value: string): value is ScheduleType {
  return (SCHEDULE_TYPES as readonly string[]).includes(value);
}

function isStartDatePreset(value: string): value is StartDatePreset {
  return (START_DATE_PRESETS as readonly string[]).includes(value);
}

export function EditTaskModal({ target, onSubmit, onArchive, onClose }: EditTaskModalProps) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [scheduleType, setScheduleType] = useState<Task["schedule"]["type"]>("once");
  const [startDatePreset, setStartDatePreset] = useState<StartDatePreset>("today");
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState<string>("");
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
      setEndDate(target.task.schedule.endDate ?? "");
      setReminderEnabled(target.task.reminder.enabled);
      setReminderTime(target.task.reminder.time);
      setStartDatePreset("custom");
      return;
    }

    setTitle("");
    setNote("");
    setScheduleType("once");
    setStartDate(target.startDate);
    setStartDatePreset(target.startDate === todayKey() ? "today" : "custom");
    setEndDate("");
    setReminderEnabled(false);
    setReminderTime(DEFAULT_REMINDER_TIME);
    // targetKey 已完整表达"目标身份"，target 只作为取值来源
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const isEdit = target !== null && target.kind === "edit";

  const handleSubmit = () => {
    if (target === null) return;
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) return;
    onSubmit({
      title: trimmedTitle,
      note,
      schedule: {
        type: scheduleType,
        startDate,
        endDate: endDate.length > 0 ? endDate : null,
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
        <Stack gap="sm">
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

          <Group grow>
            <Select
              label="周期"
              data={SCHEDULE_TYPES.map((v) => ({ value: v, label: SCHEDULE_TYPE_LABELS[v] }))}
              value={scheduleType}
              onChange={(v) => v !== null && isScheduleType(v) && setScheduleType(v)}
              allowDeselect={false}
            />
            <Select
              label="起始日"
              data={START_DATE_PRESETS.map((v) => ({
                value: v,
                label: START_DATE_PRESET_LABELS[v],
              }))}
              value={startDatePreset}
              onChange={(v) => {
                if (v === null || !isStartDatePreset(v)) return;
                setStartDatePreset(v);
                setStartDate(resolveStartDate(v, startDate));
              }}
              allowDeselect={false}
            />
          </Group>

          <Group grow>
            <TextInput
              type="date"
              label="起始日期"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.currentTarget.value);
                setStartDatePreset("custom");
              }}
            />
            <TextInput
              type="date"
              label="结束日期（可选）"
              value={endDate}
              onChange={(e) => setEndDate(e.currentTarget.value)}
              placeholder="不填则不封顶"
            />
          </Group>

          <Group grow align="flex-end">
            <Switch
              label="启用提醒"
              checked={reminderEnabled}
              onChange={(e) => setReminderEnabled(e.currentTarget.checked)}
            />
            <TextInput
              type="time"
              label="提醒时间"
              value={reminderTime}
              disabled={!reminderEnabled}
              onChange={(e) => setReminderTime(e.currentTarget.value)}
            />
          </Group>
        </Stack>

        <Group justify="space-between" mt="lg">
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
            <Button type="submit" disabled={title.trim().length === 0}>
              {isEdit ? "保存" : "创建"}
            </Button>
          </Group>
        </Group>
      </form>
    </Modal>
  );
}
