// 职责：工具页占位 —— 上班好用工具的容器。本期仅放一块白板占位，具体工具后续接入。

import { Paper, Stack, Text } from "@mantine/core";
import styles from "./ToolsView.module.css";

export function ToolsView() {
  return (
    <div className={styles.wrap}>
      <Stack gap={2}>
        <Text fw={600} className={styles.title}>工具</Text>
        <Text size="xs" className={styles.muted}>
          上班好用工具的集合，这里先留一块白板，具体工具后续接入。
        </Text>
      </Stack>

      <Paper withBorder radius="md" p="xl" className={styles.board}>
        <Text className={styles.placeholder}>白板占位 · 工具陆续接入</Text>
      </Paper>
    </div>
  );
}
