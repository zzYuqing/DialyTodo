// 职责：新增经验的弹窗。编辑已改为在主页卡片上就地完成（ExperienceEditCard），
// 本弹窗只服务新增，不再承担编辑回填。
// 字段：日期（原生 date，与子任务截止日同风格）、分类、标题、整篇 Markdown 正文、直接附件。
// 正文录入与图片修复复用 ExperienceMarkdownField，与就地编辑卡行为一致。

import { useEffect, useState } from "react";
import { Button, Group, Modal, NativeSelect, Stack, TextInput } from "@mantine/core";
import { CloseIcon, EyeIcon, UploadIcon } from "@/components/Icons";
import { generateTaskId } from "@/lib";
import { dataRoot } from "@/services/paths";
import { copyPickedAttachments } from "./attachmentActions";
import { ExperienceMarkdownField } from "./ExperienceMarkdownField";
import { AttachmentPreviewModal, isPreviewableAttachment } from "./AttachmentPreviewModal";
import styles from "./ExperienceEditorModal.module.css";
import type { ExperienceAttachment, ExperienceCategory } from "@/types";

export interface ExperienceDraft {
  /** 由本弹窗预先生成：附件在落库前就已复制到 <数据根>/experiences/attachments/<id>，
   *  落库必须沿用同一个 id，否则会出现「文件在但记录指不到」的错位 */
  id: string;
  date: string;
  category: string;
  title: string;
  content: string;
  attachments: ExperienceAttachment[];
}

interface ExperienceEditorModalProps {
  opened: boolean;
  onClose: () => void;
  categories: ExperienceCategory[];
  defaultDate: string;
  onSubmit: (data: ExperienceDraft) => void;
}

export function ExperienceEditorModal({
  opened,
  onClose,
  categories,
  defaultDate,
  onSubmit,
}: ExperienceEditorModalProps) {
  const [expId, setExpId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<ExperienceAttachment[]>([]);
  // 附件复制失败的内联提示（项目未启用 notifications，不依赖它）
  const [attachError, setAttachError] = useState<string | null>(null);
  // .md 含本地图片的非阻断警告
  const [attachWarn, setAttachWarn] = useState<string | null>(null);
  // 正在预览的附件（弹窗内局部管理）
  const [preview, setPreview] = useState<ExperienceAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  // 数据根目录，供正文编辑器解析附件图片地址
  const [root, setRoot] = useState<string | null>(null);

  // 依赖取首个分类 id 而非 categories 数组：数组每次渲染都是新引用，
  // 放进依赖会让 effect 反复触发、把已填内容重置掉
  const fallbackCategory = categories[0]?.id ?? "";

  useEffect(() => {
    if (!opened) return;
    // 新增时先定 id：附件要复制到 <数据根>/experiences/attachments/<id>
    setExpId(generateTaskId());
    setDate(defaultDate);
    setCategory(fallbackCategory);
    setTitle("");
    setContent("");
    setAttachments([]);
    setAttachError(null);
    void dataRoot().then(setRoot);
  }, [opened, defaultDate, fallbackCategory]);

  const canSave = title.trim().length > 0 && category.length > 0;

  /** 直接上传附件：多选，逐个复制进该经验的附件目录 */
  const handleAddAttachments = async () => {
    setAttachError(null);
    setAttachWarn(null);
    setUploading(true);
    try {
      const result = await copyPickedAttachments(expId, "选择要附加的文件");
      if (result.added !== null) setAttachments((prev) => [...prev, ...result.added!]);
      if (result.mdImageWarning !== undefined) setAttachWarn(result.mdImageWarning);
    } catch (err) {
      console.error("[experience] 复制附件失败", err);
      setAttachError("复制附件失败，请重试");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    onSubmit({
      id: expId,
      date,
      category,
      title: title.trim(),
      content,
      attachments,
    });
    onClose();
  };

  return (
    <>
    <Modal opened={opened} onClose={onClose} title="新增经验" centered size="lg">
      <Stack gap="sm">
        <Group grow wrap="nowrap">
          <TextInput
            type="date"
            label="日期"
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <NativeSelect
            label="分类"
            data={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={category}
            onChange={(e) => setCategory(e.currentTarget.value)}
          />
        </Group>
        <TextInput
          label="标题"
          placeholder="一句话概括这次危机 / 经验"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />

        <ExperienceMarkdownField
          value={content}
          onChange={setContent}
          expId={expId}
          root={root}
        />

        <div className={styles.editorBody}>
          <Group justify="space-between" align="center" className={styles.editorLabel}>
            <span>附件</span>
            <Button
              size="xs"
              variant="default"
              leftSection={<UploadIcon size={14} />}
              onClick={handleAddAttachments}
              loading={uploading}
            >
              添加附件
            </Button>
          </Group>
          {attachments.length === 0 ? (
            <div className={styles.uploadHint}>还没有附件，可添加日志、截图、补丁等文件。</div>
          ) : (
            <div className={styles.attachList}>
          {attachments.map((a) => (
            <div key={a.id} className={styles.attachChip} title={a.name}>
              <span className={styles.attachName}>{a.name}</span>
              {isPreviewableAttachment(a) && (
                <button
                  type="button"
                  className={styles.attachPreview}
                  onClick={() => setPreview(a)}
                  title={`预览 ${a.name}`}
                  aria-label={`预览 ${a.name}`}
                >
                  <EyeIcon size={12} />
                </button>
              )}
              <button
                type="button"
                className={styles.attachRemove}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                aria-label={`移除附件 ${a.name}`}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
            </div>
          )}
          {/* 草稿态移除附件不落库、不删磁盘文件，无数据损失风险，故不设二次确认 */}
          {attachError && <div className={styles.uploadError}>{attachError}</div>}
          {attachWarn && <div className={styles.uploadWarn}>{attachWarn}</div>}
        </div>

        <Group justify="flex-end" mt="xs">
          <Button size="xs" variant="default" onClick={onClose}>
            取消
          </Button>
          <Button size="xs" onClick={handleSave} disabled={!canSave}>
            添加
          </Button>
        </Group>
      </Stack>
    </Modal>

    <AttachmentPreviewModal
      opened={preview !== null}
      att={preview}
      expId={expId}
      root={root}
      onClose={() => setPreview(null)}
    />
    </>
  );
}
