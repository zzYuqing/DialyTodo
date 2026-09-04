// 职责：设置视图（阶段 5 部分落地）—— 本期仅实现「节假日数据」区块，
// 其余设置（主题、自启、提醒时间窗、备份策略）仍为阶段 5 待办。
// 节假日区块：展示当年/去年加载状态，并提供低调的手动「更新」入口
// （覆盖自动识别失败、或想主动刷新当年数据的场景）。

import { useState } from "react";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useHolidayStore, useSettingsStore } from "@/stores";
import styles from "./SettingsView.module.css";

export function SettingsView() {
  const checkers = useHolidayStore((s) => s.checkers);
  const refresh = useHolidayStore((s) => s.refresh);
  const holidayUrl = useSettingsStore((s) => s.settings.holidayUrlTemplate);

  const [loading, setLoading] = useState(false);

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear];

  const handleRefresh = async () => {
    if (holidayUrl.trim() === "") return;
    setLoading(true);
    try {
      for (const year of years) {
        await refresh(year, holidayUrl);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={2}>
            <Text fw={600}>节假日数据</Text>
            <Text size="xs" className={styles.muted}>
              用于「工作日」周期任务与贡献墙着色；首次用到某年自动识别一次，也可手动更新。
            </Text>
          </Stack>
          <Button
            variant="subtle"
            size="xs"
            loading={loading}
            onClick={handleRefresh}
            disabled={holidayUrl.trim() === ""}
          >
            更新
          </Button>
        </Group>

        <Stack gap={6} mt="sm">
          {years.map((year) => (
            <Group key={year} justify="space-between" wrap="nowrap">
              <Text size="sm">{year} 年</Text>
              {checkers[year] !== undefined ? (
                <Badge color="teal" variant="light" size="sm">
                  已加载
                </Badge>
              ) : (
                <Badge color="gray" variant="light" size="sm">
                  未加载
                </Badge>
              )}
            </Group>
          ))}
        </Stack>
      </Paper>

      <Text size="xs" className={styles.note}>
        其余设置（主题切换、自启动、提醒时间窗、备份策略）将在阶段 5 接入。
      </Text>
    </div>
  );
}
