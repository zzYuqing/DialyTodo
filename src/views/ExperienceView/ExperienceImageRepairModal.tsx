// 职责：上传 md 后，为「解析不到的相对路径图片」集中指定真实文件。
// 单个弹窗列出全部失效路径（按路径去重，同一路径只指定一次），逐条选文件；
// 也可跳过某条（保持原文不动）。返回 raw → 源文件绝对路径 的映射，实际复制由编辑器完成。

import { useEffect, useState } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { UploadIcon } from "@/components/Icons";
import styles from "./ExperienceImageRepairModal.module.css";

export interface RepairItem {
  /** md 里原始的相对路径字符串 */
  raw: string;
  /** 该路径在正文里出现的次数 */
  count: number;
}

interface ExperienceImageRepairModalProps {
  opened: boolean;
  items: RepairItem[];
  onClose: () => void;
  /** raw → 用户选中的源文件绝对路径；未指定的条目为 null（跳过） */
  onConfirm: (picks: Record<string, string | null>) => void;
}

/** 取路径末段文件名（Windows 同时认 / 与 \） */
function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function ExperienceImageRepairModal({
  opened,
  items,
  onClose,
  onConfirm,
}: ExperienceImageRepairModalProps) {
  const [picks, setPicks] = useState<Record<string, string | null>>({});

  // 每次打开都是新一轮修复，清空上次的选择
  useEffect(() => {
    if (opened) setPicks({});
  }, [opened, items]);

  const pickFile = async (raw: string) => {
    const picked = await open({
      multiple: false,
      title: `为「${baseNameOf(raw)}」选择图片`,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
    });
    if (typeof picked !== "string") return;
    setPicks((prev) => ({ ...prev, [raw]: picked }));
  };

  const resolvedCount = items.filter((it) => picks[it.raw]).length;

  return (
    <Modal opened={opened} onClose={onClose} title="修复失效的图片路径" centered size="md">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          以下图片在 md 原目录下找不到（相对路径已失效）。为每条指定真实图片即可自动复制到数据目录并改写正文；
          不指定的条目保持原样。
        </Text>

        <div className={styles.list}>
          {items.map((item) => {
            const picked = picks[item.raw];
            return (
              <div key={item.raw} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.raw} title={item.raw}>
                    {item.raw}
                  </span>
                  <span className={styles.count}>{item.count} 处</span>
                </div>
                {picked ? (
                  <div className={styles.rowMain}>
                    <span className={styles.picked} title={picked}>
                      → {baseNameOf(picked)}
                    </span>
                    <button
                      type="button"
                      className={styles.clearBtn}
                      onClick={() => setPicks((prev) => ({ ...prev, [item.raw]: null }))}
                    >
                      清除
                    </button>
                  </div>
                ) : (
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<UploadIcon size={13} />}
                    onClick={() => void pickFile(item.raw)}
                  >
                    选择图片
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <Group justify="space-between" mt="xs">
          <Text size="xs" c="dimmed">
            已指定 {resolvedCount} / {items.length}
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="default" onClick={onClose}>
              全部跳过
            </Button>
            <Button size="xs" onClick={() => onConfirm(picks)} disabled={resolvedCount === 0}>
              应用修复
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
