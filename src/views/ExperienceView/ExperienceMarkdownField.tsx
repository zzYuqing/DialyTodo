// 职责：经验正文编辑区 —— CodeMirror 行内实时渲染编辑器 + 「上传 md」及其图片体检修复。
// 新增弹窗与主页就地编辑卡共用同一份实现，保证两处录入与修复行为完全一致。
//
// 上传 md 时自动体检正文里的图片引用，三种处理：
//   - 绝对路径（盘符 / UNC / file:）与 http(s) —— 按用户要求一律不修，原样保留
//   - 相对路径且能按 md 原目录解析到 —— 静默复制进数据目录并改写
//     （md 入库后不再与图片同目录，不搬进来必然裂图，位置已知故不必弹窗打扰）
//   - 相对路径但解析不到 —— 才进「修复弹窗」让用户指定真实图片

import { useState } from "react";
import { Button, Group } from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { dirname, join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { UploadIcon } from "@/components/Icons";
import {
  attachmentMarkdownPath,
  countOccurrences,
  extractImageRefs,
  relativeRefs,
  replaceImageRef,
} from "@/lib";
import {
  copyAttachmentInto,
  imageExtOfMime,
  saveAttachmentBytes,
} from "@/services";
import { ExperienceImageRepairModal, type RepairItem } from "./ExperienceImageRepairModal";
import { ExperienceMarkdownEditor } from "./ExperienceMarkdownEditor";
import { resolveImageSrc } from "./resolveImageSrc";
import styles from "./ExperienceMarkdownField.module.css";

interface ExperienceMarkdownFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** 经验 id：图片与附件复制到 <数据根>/experiences/attachments/<expId> */
  expId: string;
  /** 数据根目录，用于把正文里的附件相对路径解析成可加载的图片地址 */
  root: string | null;
}

export function ExperienceMarkdownField({
  value,
  onChange,
  expId,
  root,
}: ExperienceMarkdownFieldProps) {
  // 上传 / 复制中避免重复点击
  const [uploading, setUploading] = useState(false);
  // 上传失败的内联提示（项目未启用 notifications，不依赖它）
  const [uploadError, setUploadError] = useState<string | null>(null);
  // 待修复的 md 正文与其失效图片条目
  const [pendingText, setPendingText] = useState("");
  const [repairItems, setRepairItems] = useState<RepairItem[]>([]);
  const [repairOpen, setRepairOpen] = useState(false);

  /**
   * 把 map 里的「相对路径 → 源文件」逐条复制进附件目录，并回写正文里的图片地址。
   * 复制是新增不是搬移，源文件不受影响；任一条失败都不丢已改写部分。
   */
  const applyFixes = async (text: string, map: Record<string, string>): Promise<string> => {
    let next = text;
    for (const raw of Object.keys(map)) {
      const att = await copyAttachmentInto(expId, map[raw]);
      next = replaceImageRef(next, raw, attachmentMarkdownPath(expId, att.storedName));
    }
    return next;
  };

  /**
   * 从本地选一个 .md 文件读入正文，并体检其中的图片引用。
   * Tauri 2 经 dialog 选中的路径会自动进入 fs 可读 scope，故 readTextFile 可读到任意位置的文件。
   */
  const handleUpload = async () => {
    setUploadError(null);
    const picked = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (typeof picked !== "string") return;
    setUploading(true);
    try {
      const text = await readTextFile(picked);
      const dir = await dirname(picked);
      const refs = extractImageRefs(text);
      const auto: Record<string, string> = {};
      const broken: RepairItem[] = [];
      for (const raw of relativeRefs(refs)) {
        const resolved = await join(dir, raw);
        const ok = await exists(resolved).catch(() => false);
        if (ok) auto[raw] = resolved;
        else broken.push({ raw, count: countOccurrences(text, raw) });
      }

      let next = text;
      if (Object.keys(auto).length > 0) next = await applyFixes(next, auto);

      if (broken.length > 0) {
        setPendingText(next);
        setRepairItems(broken);
        setRepairOpen(true);
      } else {
        onChange(next);
      }
    } catch (err) {
      console.error("[experience] 读取 markdown 文件失败", err);
      setUploadError("读取文件失败，或图片复制失败，请确认文件未被占用后重试");
    } finally {
      setUploading(false);
    }
  };

  /** 修复弹窗确认：把用户指定的图片复制进附件目录，并把正文里的相对路径改写成附件路径 */
  const handleRepairConfirm = async (picks: Record<string, string | null>) => {
    setRepairOpen(false);
    setUploading(true);
    let next = pendingText;
    try {
      const chosen: Record<string, string> = {};
      for (const raw of Object.keys(picks)) {
        const src = picks[raw];
        if (src) chosen[raw] = src; // 为 null 表示用户跳过：保持原文不动
      }
      next = await applyFixes(next, chosen);
      onChange(next);
    } catch (err) {
      console.error("[experience] 复制图片失败", err);
      setUploadError("复制图片失败，请重试");
      onChange(next); // 保留已成功改写的部分，不丢正文
    } finally {
      setUploading(false);
    }
  };

  /**
   * 编辑器里直接粘贴截图：剪贴板给的是内存图片（没有磁盘路径），
   * 读成字节后直接写进附件目录，再返回要插入正文的图片语法。
   * 与「上传 md」带入的图片一致：只落盘 + 写正文路径，不登记进附件列表。
   */
  const handlePasteImage = async (blob: Blob): Promise<string | null> => {
    try {
      setUploadError(null);
      const ext = imageExtOfMime(blob.type);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const att = await saveAttachmentBytes(expId, bytes, ext);
      return `![${att.name}](${attachmentMarkdownPath(expId, att.storedName)})`;
    } catch (err) {
      console.error("[experience] 粘贴图片保存失败", err);
      setUploadError("粘贴图片保存失败，请重试");
      return null;
    }
  };

  return (
    <div className={styles.field}>
      <Group justify="space-between" align="center" className={styles.label}>
        <span>经过 / 解决 / 教训（支持 Markdown）</span>
        <Button
          size="xs"
          variant="default"
          leftSection={<UploadIcon size={14} />}
          onClick={handleUpload}
          loading={uploading}
        >
          上传 md
        </Button>
      </Group>

      {/* CodeMirror 行内实时渲染编辑器：文档即纯 Markdown，写完即见渲染效果 */}
      <ExperienceMarkdownEditor
        className={styles.cmHost}
        value={value}
        onChange={onChange}
        onPasteImage={handlePasteImage}
        // resolveImageSrc 仅在 src 为空时返回 undefined，此处回退原值以满足非空契约
        resolveImage={(raw) => resolveImageSrc(raw, root) ?? raw}
        placeholder="可直接写 Markdown：## 标题、**加粗**、`代码`、![图片](路径)，也可直接 Ctrl+V 粘贴截图…"
      />
      {uploadError && <div className={styles.uploadError}>{uploadError}</div>}

      <ExperienceImageRepairModal
        opened={repairOpen}
        items={repairItems}
        onClose={() => setRepairOpen(false)}
        onConfirm={(picks) => void handleRepairConfirm(picks)}
      />
    </div>
  );
}
