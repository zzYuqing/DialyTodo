// 职责：设置视图 —— 数据存储、窗口与托盘、开机自启、节假日数据四个区块。
// 数据存储：展示当前数据目录，支持迁移到其他磁盘；迁移成功后原目录数据会被删除（用户已确认语义）。
// 窗口与托盘：窗口置顶、界面模式、关闭按钮行为（提示词 5.5）。
// 开机自启：仅写 HKCU Run（提示词第八节），开关即时落盘。
// 节假日区块：展示当年/去年加载状态，提供低调的手动「更新」入口。
// 主题切换属阶段 7，提醒时间窗 / 备份导入导出 UI 尚未接入。

import { useEffect, useState, type ChangeEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  enable as enableAutoStart,
  disable as disableAutoStart,
} from "@tauri-apps/plugin-autostart";
import {
  Badge,
  Button,
  Code,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { isTauri } from "@/bridge";
import { useHolidayStore, useSettingsStore } from "@/stores";
import {
  canMigrateTo,
  dataRoot,
  defaultDataRootPath,
  isSamePath,
  migrateDataTo,
  type MigrationResult,
} from "@/services";
import type { LayoutMode } from "@/types";
import styles from "./SettingsView.module.css";

/** 迁移/操作结果提示：错误（红）与成功/警示（中性色）分开呈现 */
interface Feedback {
  kind: "error" | "info" | "warning";
  text: string;
}

export function SettingsView() {
  const checkers = useHolidayStore((s) => s.checkers);
  const refresh = useHolidayStore((s) => s.refresh);
  const holidayUrl = useSettingsStore((s) => s.settings.holidayUrlTemplate);

  // —— 窗口与托盘 / 开机自启 ——
  const alwaysOnTop = useSettingsStore((s) => s.settings.alwaysOnTop);
  const layout = useSettingsStore((s) => s.settings.layout);
  const closeToTray = useSettingsStore((s) => s.settings.closeToTray);
  const autoStart = useSettingsStore((s) => s.settings.autoStart);
  const update = useSettingsStore((s) => s.update);

  const [holidayLoading, setHolidayLoading] = useState(false);
  const [autoStartError, setAutoStartError] = useState<string | null>(null);

  // —— 数据存储区块状态 ——
  const [currentRoot, setCurrentRoot] = useState<string | null>(null);
  const [isDefaultRoot, setIsDefaultRoot] = useState(true);
  const [targetDir, setTargetDir] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  /** 挂载时解析当前数据目录与是否默认位置 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const root = await dataRoot();
      const defaults = await defaultDataRootPath();
      if (cancelled) return;
      setCurrentRoot(root);
      setIsDefaultRoot(isSamePath(root, defaults));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 选择目标目录：预检通过才打开确认弹窗 */
  const handlePickTarget = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, title: "选择数据存放目录" });
      if (typeof picked !== "string" || picked.trim() === "") return;

      const problem = await canMigrateTo(picked);
      if (problem !== null) {
        setFeedback({ kind: "error", text: problem });
        return;
      }
      setTargetDir(picked);
      setFeedback(null);
    } catch (err) {
      setFeedback({
        kind: "error",
        text: `选择目录失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  /** 确认迁移：成功后刷新路径显示；旧目录由迁移服务在全部成功后才删除 */
  const handleMigrate = async () => {
    if (targetDir === null) return;
    setMigrating(true);
    try {
      const result: MigrationResult = await migrateDataTo(targetDir);
      if (result.ok) {
        setCurrentRoot(result.root ?? targetDir);
        setIsDefaultRoot(isSamePath(result.root ?? targetDir, await defaultDataRootPath()));
        setFeedback({
          kind: result.warning ? "warning" : "info",
          text:
            result.warning ??
            `已迁移到 ${result.root ?? targetDir}，原目录数据已删除。`,
        });
        setTargetDir(null);
      } else {
        setFeedback({ kind: "error", text: result.error ?? "迁移失败，源数据未受影响" });
      }
    } catch (err) {
      setFeedback({
        kind: "error",
        text: `迁移过程异常：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setMigrating(false);
    }
  };

  /** 开机自启：先改宿主注册表（HKCU Run），成功后再落盘设置 */
  const handleAutoStart = async (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.currentTarget.checked;
    if (isTauri()) {
      try {
        if (next) await enableAutoStart();
        else await disableAutoStart();
      } catch (err) {
        setAutoStartError(
          `开机自启设置失败：${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }
    setAutoStartError(null);
    await update({ autoStart: next });
  };

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear];

  const handleHolidayRefresh = async () => {
    if (holidayUrl.trim() === "") return;
    setHolidayLoading(true);
    try {
      for (const year of years) {
        await refresh(year, holidayUrl);
      }
    } finally {
      setHolidayLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} className={styles.cardTitle}>数据存储</Text>
        <Text size="xs" className={styles.muted}>
          任务、设置、备份与节假日缓存保存在本机数据目录。不想放 C 盘可迁移到其他磁盘。
        </Text>

        <Stack gap={6} mt="sm">
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text size="sm">当前数据目录</Text>
            {isDefaultRoot ? (
              <Badge color="gray" variant="light" size="sm">
                默认位置
              </Badge>
            ) : (
              <Badge color="teal" variant="light" size="sm">
                自定义位置
              </Badge>
            )}
          </Group>
          <Code className={styles.path} block fz="xs">
            {currentRoot ?? "加载中…"}
          </Code>
        </Stack>

        <Group justify="flex-end" mt="md">
          <Button size="xs" variant="light" onClick={handlePickTarget} disabled={migrating}>
            更改位置…
          </Button>
        </Group>

        {feedback !== null && (
          <Text
            size="xs"
            mt="sm"
            c={feedback.kind === "error" ? "red" : undefined}
            className={feedback.kind === "error" ? styles.feedback : `${styles.muted} ${styles.feedback}`}
          >
            {feedback.text}
          </Text>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Text fw={600} className={styles.cardTitle}>窗口与托盘</Text>
        <Text size="xs" className={styles.muted}>
          置顶让窗口始终浮在其他窗口之上；界面模式决定布局与窗口尺寸，两者互相独立。
        </Text>

        <Stack gap="md" mt="sm">
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Stack gap={2} className={styles.grow}>
              <Text size="sm">窗口置顶</Text>
              <Text size="xs" className={styles.muted}>
                开启后窗口始终悬浮在其他窗口之上；关闭则允许其他窗口覆盖
              </Text>
            </Stack>
            <Switch
              checked={alwaysOnTop}
              onChange={(e) => update({ alwaysOnTop: e.currentTarget.checked })}
            />
          </Group>

          <Stack gap={6}>
            <Text size="sm">界面模式</Text>
            <SegmentedControl
              value={layout}
              onChange={(value) => update({ layout: value as LayoutMode })}
              data={[
                { label: "完整", value: "full" },
                { label: "简易", value: "simple" },
                { label: "迷你", value: "mini", disabled: true },
              ]}
              size="xs"
            />
            <Text size="xs" className={styles.muted}>
              {layout === "simple"
                ? "简易：仅显示当日待办，窗口更小，仍可手动调整尺寸。"
                : "完整：侧栏、贡献墙、长期任务页与设置页齐全。"}
            </Text>
          </Stack>

          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Stack gap={2} className={styles.grow}>
              <Text size="sm">关闭按钮行为</Text>
              <Text size="xs" className={styles.muted}>
                开启：点关闭按钮时隐藏窗口，仅保留托盘图标，进程继续运行；关闭：点关闭按钮时直接退出应用。
              </Text>
            </Stack>
            <Switch
              checked={closeToTray}
              onChange={(e) => update({ closeToTray: e.currentTarget.checked })}
            />
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
          <Stack gap={2} className={styles.grow}>
            <Text fw={600} className={styles.cardTitle}>开机自启</Text>
            <Text size="xs" className={styles.muted}>
              登录 Windows 后自动启动并常驻托盘（仅写入当前用户注册表）
            </Text>
          </Stack>
          <Switch checked={autoStart} onChange={handleAutoStart} />
        </Group>
        {autoStartError !== null && (
          <Text size="xs" c="red" mt="xs" className={styles.feedback}>
            {autoStartError}
          </Text>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" wrap="nowrap" align="center" gap="sm">
          <Text fw={600} className={styles.cardTitle}>节假日数据</Text>
          <Button
            variant="subtle"
            size="xs"
            color="teal"
            loading={holidayLoading}
            onClick={handleHolidayRefresh}
            disabled={holidayUrl.trim() === ""}
          >
            更新
          </Button>
        </Group>
        <Text size="xs" className={styles.muted} mt={6}>
          用于「工作日」周期任务与贡献墙着色；首次用到某年自动识别一次，也可手动更新。
        </Text>

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
        主题切换将在后续阶段接入；提醒时间窗与备份导入导出 UI 尚未开放。
      </Text>

      <Modal
        opened={targetDir !== null}
        onClose={() => !migrating && setTargetDir(null)}
        title="迁移数据目录"
        centered
        size="sm"
      >
        <Stack gap="sm">
          <Text size="sm">
            将把数据从
            <Code className={styles.path}>{currentRoot ?? "…"}</Code>
            迁移到
            <Code className={styles.path}>{targetDir ?? "…"}</Code>
          </Text>
          <Text size="xs" className={styles.muted}>
            迁移内容：tasks.json（任务与完成历史）、settings.json（设置）、backup/（每日备份）、
            holidays_*.json（节假日缓存）。应用无需重启，迁移后读写自动指向新目录。
          </Text>
          <Text size="sm" c="red" fw={500}>
            ⚠ 迁移成功后，原目录中的数据将被删除，此操作不可撤销。
          </Text>
          <Group justify="flex-end" mt="sm">
            <Button size="xs" variant="default" onClick={() => setTargetDir(null)} disabled={migrating}>
              取消
            </Button>
            <Button size="xs" color="red" loading={migrating} onClick={handleMigrate}>
              迁移并删除原数据
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
