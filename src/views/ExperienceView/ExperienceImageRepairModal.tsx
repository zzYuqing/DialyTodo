// 职责：上传 md 后，为「解析不到的相对路径图片」集中指定真实文件。
// 单个弹窗列出全部失效路径（按路径去重，同一路径只指定一次），逐条选文件；
// 也可跳过某条（保持原文不动）。返回 raw → 源文件绝对路径 的映射，实际复制由编辑器完成。
//
// 两种指定方式：
//   1. 选文件夹：递归扫描该目录，按文件名自动匹配所有失效图片（同名即命中，
//      含子目录里的同名文件），一键解决大部分「md 搬家后图片找不到」的场景。
//   2. 选图片：逐条手动指定真实文件，用于文件夹匹配不到的少数情况。

import { useEffect, useState } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";
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

/** 递归扫描目录，返回 basename → 绝对路径 的映射。
 *  同名文件只保留第一个命中（深度优先，子目录优先于同级父目录）。
 *  plugin-fs 2.x 的 readDir 无 recursive 选项、DirEntry 也无 path 字段，
 *  故手动用 join 拼路径 + isDirectory 判断递归。 */
async function buildFileIndex(folder: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const walk = async (dir: string) => {
    let entries: Awaited<ReturnType<typeof readDir>> = [];
    try {
      entries = await readDir(dir);
    } catch {
      return; // 读不到的子目录直接跳过，不中断整体扫描
    }
    for (const entry of entries) {
      const name = entry.name;
      if (typeof name !== "string" || name === "") continue;
      const full = await join(dir, name);
      if (entry.isDirectory) {
        // 子目录：递归深入，让子目录里的文件先入索引（同名时子目录优先）
        await walk(full);
      } else if (!index.has(name)) {
        index.set(name, full);
      }
    }
  };
  await walk(folder);
  return index;
}

export function ExperienceImageRepairModal({
  opened,
  items,
  onClose,
  onConfirm,
}: ExperienceImageRepairModalProps) {
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [folderScanning, setFolderScanning] = useState(false);
  const [folderMatchCount, setFolderMatchCount] = useState<number | null>(null);

  // 每次打开都是新一轮修复，清空上次的选择
  useEffect(() => {
    if (opened) {
      setPicks({});
      setFolderMatchCount(null);
    }
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

  /** 选一个文件夹，递归扫描并按文件名自动匹配所有失效图片。 */
  const pickFolder = async () => {
    const folder = await open({ directory: true, multiple: false, title: "选择图片所在文件夹" });
    if (typeof folder !== "string") return;
    setFolderScanning(true);
    try {
      const index = await buildFileIndex(folder);
      let matched = 0;
      setPicks((prev) => {
        const next = { ...prev };
        for (const item of items) {
          // 已手动指定的不覆盖：手动选择优先级高于文件夹匹配
          if (next[item.raw]) continue;
          const name = baseNameOf(item.raw);
          const found = index.get(name);
          if (found) {
            next[item.raw] = found;
            matched += 1;
          }
        }
        return next;
      });
      setFolderMatchCount(matched);
    } catch (err) {
      console.error("[experience] 扫描图片文件夹失败", err);
      setFolderMatchCount(0);
    } finally {
      setFolderScanning(false);
    }
  };

  const resolvedCount = items.filter((it) => picks[it.raw]).length;

  return (
    <Modal opened={opened} onClose={onClose} title="修复失效的图片路径" centered size="md">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          以下图片在 md 原目录下找不到（相对路径已失效）。可先「选择图片所在文件夹」让系统按文件名自动匹配，
          匹配不到的再逐条手动指定；不指定的条目保持原样。
        </Text>

        <div className={styles.folderBar}>
          <Button
            size="xs"
            variant="default"
            leftSection={<UploadIcon size={13} />}
            onClick={() => void pickFolder()}
            loading={folderScanning}
          >
            选择图片所在文件夹
          </Button>
          {folderMatchCount !== null && (
            <Text size="xs" c="dimmed">
              {folderMatchCount > 0
                ? `已自动匹配 ${folderMatchCount} 张`
                : "该文件夹下未找到匹配的图片"}
            </Text>
          )}
        </div>

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
