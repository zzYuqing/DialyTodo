// 职责：主页就地编辑卡片 —— 点「编辑」后这张卡片原地变成可编辑形态，取代旧的弹窗编辑路径。
// 可改：分类 / 日期 / 标题 / Markdown 正文；附件可增删；底部「保存 / 取消」。
// 所有改动先进本地 draft，保存时才提交，取消则整体回滚（附件变更同样回滚）。
// 正文录入复用 ExperienceMarkdownField，与新增弹窗同一套实时渲染与图片修复行为。

import { useEffect, useRef, useState } from "react";
import { Button, Group, NativeSelect, TextInput } from "@mantine/core";
import { ConfirmDialog } from "@/components/ConfirmDialog/ConfirmDialog";
import { CloseIcon, DownloadIcon, EyeIcon, UploadIcon } from "@/components/Icons";
import type { Experience, ExperienceAttachment, ExperienceCategory } from "@/types";
import { copyPickedAttachments, downloadAttachment, openAttachment } from "./attachmentActions";
import { ExperienceMarkdownField } from "./ExperienceMarkdownField";
import { AttachmentPreviewModal, isPreviewableAttachment } from "./AttachmentPreviewModal";
import styles from "./ExperienceView.module.css";

/** 就地编辑提交的字段集 */
export interface ExperienceEditPatch {
  date: string;
  category: string;
  title: string;
  content: string;
  attachments: ExperienceAttachment[];
}

interface ExperienceEditCardProps {
  experience: Experience;
  categories: ExperienceCategory[];
  /** 数据根目录，供正文编辑器解析附件图片地址 */
  root: string | null;
  onSave: (patch: ExperienceEditPatch) => void;
  onCancel: () => void;
}

export function ExperienceEditCard({
  experience,
  categories,
  root,
  onSave,
  onCancel,
}: ExperienceEditCardProps) {
  const [date, setDate] = useState(experience.date);
  const [category, setCategory] = useState(experience.category);
  const [title, setTitle] = useState(experience.title);
  const [content, setContent] = useState(experience.content);
  const [attachments, setAttachments] = useState<ExperienceAttachment[]>(experience.attachments);
  // 附件复制中禁用入口，避免连点
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  // .md 含本地图片的非阻断警告
  const [attachWarn, setAttachWarn] = useState<string | null>(null);
  // 正在预览的附件（编辑态单卡片，局部管理）
  const [preview, setPreview] = useState<ExperienceAttachment | null>(null);
  // 待确认删除的附件：非空即弹出二次确认
  const [pendingDelete, setPendingDelete] = useState<ExperienceAttachment | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // 进入编辑态时把这张卡片滚进视野（长列表里点编辑不至于找不到编辑框）
  useEffect(() => {
    cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const canSave = title.trim().length > 0 && category.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ date, category, title: title.trim(), content, attachments });
  };

  /** 添加附件：文件立即复制进附件目录，条目进 draft（取消可回滚列表，磁盘文件按既定策略保留） */
  const handleAddAttachments = async () => {
    setAttachError(null);
    setAttachWarn(null);
    setUploading(true);
    try {
      const result = await copyPickedAttachments(
        experience.id,
        `为「${experience.title}」添加附件`,
      );
      if (result.added !== null) setAttachments((prev) => [...prev, ...result.added!]);
      if (result.mdImageWarning !== undefined) setAttachWarn(result.mdImageWarning);
    } catch (err) {
      console.error("[experience] 编辑态添加附件失败", err);
      setAttachError("附件复制失败，请重试");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div ref={cardRef} className={`${styles.card} ${styles.cardEditing}`}>
      <Group grow wrap="nowrap" align="flex-end">
        <NativeSelect
          label="分类"
          data={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={category}
          onChange={(e) => setCategory(e.currentTarget.value)}
        />
        <TextInput
          type="date"
          label="日期"
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
      </Group>

      <TextInput
        label="标题"
        placeholder="一句话概括这次危机 / 经验"
        value={title}
        maxLength={120}
        mt="xs"
        onChange={(e) => setTitle(e.currentTarget.value)}
      />

      <div className={styles.editBody}>
        <ExperienceMarkdownField
          value={content}
          onChange={setContent}
          expId={experience.id}
          root={root}
        />
      </div>

      <div
        className={`${styles.cardAttach} ${
          attachments.length === 0 ? styles.cardAttachEmpty : ""
        }`}
      >
        {attachments.map((a) => (
          <div key={a.id} className={styles.attachChip}>
            <button
              type="button"
              className={styles.attachName}
              onClick={() =>
                void openAttachment(experience.id, a.storedName).catch(() => {
                  setAttachError("打开附件失败，文件可能已被移动");
                })
              }
              title={`打开 ${a.name}`}
            >
              {a.name}
            </button>
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
              className={styles.attachAction}
              onClick={() => void downloadAttachment(experience.id, a).catch(() => {
                setAttachError("下载失败，请确认目标位置可写");
              })}
              title={`下载 ${a.name}`}
              aria-label={`下载 ${a.name}`}
            >
              <DownloadIcon size={12} />
            </button>
            <button
              type="button"
              className={styles.attachRemove}
              onClick={() => setPendingDelete(a)}
              title={`删除 ${a.name}`}
              aria-label={`删除 ${a.name}`}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.attachAdd}
          onClick={() => void handleAddAttachments()}
          disabled={uploading}
          title="为该经验添加附件"
        >
          <UploadIcon size={13} />
          {uploading ? "上传中…" : "添加附件"}
        </button>
      </div>
      {attachError && <div className={styles.attachError}>{attachError}</div>}
      {attachWarn && <div className={styles.attachWarn}>{attachWarn}</div>}

      <div className={styles.editActions}>
        <Button size="xs" variant="default" onClick={onCancel}>
          取消
        </Button>
        <Button size="xs" onClick={handleSave} disabled={!canSave}>
          保存
        </Button>
      </div>

      <ConfirmDialog
        opened={pendingDelete !== null}
        title="删除附件"
        message={
          <>
            确定要从这条经验移除附件 <strong>{pendingDelete?.name ?? ""}</strong> 吗？
          </>
        }
        confirmLabel="删除"
        onConfirm={() => {
          if (pendingDelete !== null) {
            setAttachments((prev) => prev.filter((a) => a.id !== pendingDelete.id));
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <AttachmentPreviewModal
        opened={preview !== null}
        att={preview}
        expId={experience.id}
        root={root}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
