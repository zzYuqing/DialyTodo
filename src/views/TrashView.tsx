// 职责：回收站视图。
// 列出被删除的任务 / 经验 / 附件快照，支持单条「还原」「彻底删除」与「清空回收站」。
// 删除操作已改走回收站（见各 store 的 move*ToTrash），此处只做展示与还原 / 彻底删除入口；
// 过期清理在启动时由 useTrashStore.initialize 扫描，进入本视图时再扫一次以刷新已过期项。

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Group, Modal, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import { useExperienceStore, useSettingsStore, useTaskStore, useTrashStore } from "@/stores";
import { trashExpiresAtMs } from "@/services";
import type { TrashEntry, TrashKind } from "@/types";
import styles from "./TrashView.module.css";

const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_LABEL: Record<TrashKind, string> = {
  task: "任务",
  experience: "经验",
  attachment: "附件",
  subtask: "子任务",
  hunong: "糊弄法",
};

const KIND_COLOR: Record<TrashKind, string> = {
  task: "blue",
  experience: "violet",
  attachment: "teal",
  subtask: "orange",
  hunong: "green",
};

function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 距离过期还有多久；已过期提示下次启动清除 */
function remainingLabel(entry: TrashEntry, retention: number): string {
  const remainMs = trashExpiresAtMs(entry, retention) - Date.now();
  if (remainMs <= 0) return "已过期 · 下次启动清除";
  const days = Math.floor(remainMs / DAY_MS);
  if (days >= 1) return `${days} 天后清除`;
  const hours = Math.max(1, Math.ceil(remainMs / 3_600_000));
  return `${hours} 小时后清除`;
}

export function TrashView() {
  const entries = useTrashStore((s) => s.entries);
  const restore = useTrashStore((s) => s.restore);
  const purge = useTrashStore((s) => s.purge);
  const empty = useTrashStore((s) => s.empty);
  const retention = useSettingsStore((s) => s.settings.trashRetentionDays);
  const experiences = useExperienceStore((s) => s.experiences);
  const tasks = useTaskStore((s) => s.tasks);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  // 进入视图再扫一次：清掉已过期条目（同时清盘），并刷新剩余项的「多久后清除」文案
  useEffect(() => {
    void useTrashStore.getState().sweep();
  }, []);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.deletedAt - a.deletedAt),
    [entries],
  );

  // 附件还原要求原经验仍存在；子任务还原要求原任务集仍存在（无处可挂则禁用）；任务 / 经验恒可还原
  const canRestore = (e: TrashEntry): boolean => {
    if (e.kind === "attachment") return experiences.some((exp) => exp.id === e.attachment!.expId);
    if (e.kind === "subtask") return tasks.some((task) => task.id === e.subtask!.parentId);
    return true;
  };

  return (
    <div className={styles.wrap}>
      <Group justify="space-between" className={styles.header} wrap="nowrap">
        <div className={styles.titleBlock}>
          <Text fw={600} className={styles.title}>回收站</Text>
          <Text size="xs" className={styles.muted}>
            删除的任务、经验、附件、糊弄法在此保留 {retention} 天，到期前可随时还原
          </Text>
        </div>
        <Button
          size="xs"
          color="red"
          variant="light"
          disabled={entries.length === 0}
          onClick={() => setConfirmEmpty(true)}
        >
          清空回收站
        </Button>
      </Group>

      {sorted.length === 0 ? (
        <div className={styles.empty}>回收站为空</div>
      ) : (
        <ScrollArea className={styles.list}>
          <Stack gap="xs">
            {sorted.map((e) => (
              <Paper key={e.id} withBorder p="sm" radius="md" className={styles.row}>
                <Group justify="space-between" wrap="nowrap" gap="sm">
                  <Group gap="sm" wrap="nowrap" className={styles.rowMain}>
                    <Badge color={KIND_COLOR[e.kind]} variant="light" size="sm">
                      {KIND_LABEL[e.kind]}
                    </Badge>
                    <div className={styles.rowText}>
                      <Text size="sm" className={styles.rowName} title={e.name}>
                        {e.name}
                      </Text>
                      <Text size="xs" className={styles.muted}>
                        {e.source} · 删除于 {formatDate(e.deletedAt)}
                      </Text>
                    </div>
                  </Group>

                  <Text
                    size="xs"
                    className={
                      trashExpiresAtMs(e, retention) - Date.now() <= 0
                        ? styles.expired
                        : styles.remain
                    }
                  >
                    {remainingLabel(e, retention)}
                  </Text>

                  <Group gap={4} wrap="nowrap">
                    <Button
                      size="xs"
                      variant="light"
                      disabled={!canRestore(e)}
                      onClick={() => void restore(e.id)}
                      title={
                        canRestore(e)
                          ? "还原回原位置"
                          : e.kind === "attachment"
                            ? "原经验已删除，无法还原该附件"
                            : "原任务集已删除，该子任务无处可挂"
                      }
                    >
                      还原
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="subtle"
                      onClick={() => void purge(e.id)}
                    >
                      彻底删除
                    </Button>
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        </ScrollArea>
      )}

      <Modal
        opened={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        title="清空回收站"
        centered
        size="sm"
      >
        <Stack gap="sm">
          <Text size="sm">
            将彻底删除回收站内的全部 {entries.length} 条记录（含其磁盘文件），此操作不可撤销。
          </Text>
          <Group justify="flex-end" mt="sm">
            <Button size="xs" variant="default" onClick={() => setConfirmEmpty(false)}>
              取消
            </Button>
            <Button
              size="xs"
              color="red"
              onClick={async () => {
                await empty();
                setConfirmEmpty(false);
              }}
            >
              清空
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
