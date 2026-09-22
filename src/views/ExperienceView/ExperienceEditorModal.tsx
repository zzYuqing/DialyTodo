// 职责：经验新增 / 编辑共用弹窗。新增时 editing=null，编辑时传入既有记录回填。
// 字段：日期（原生 date，与子任务截止日同风格）、分类、标题、整篇 Markdown 正文。
// 正文支持两种录入：直接写 Markdown，或「上传 md」从本地选 .md 文件灌入；下方实时预览渲染效果。

import { useEffect, useState } from "react";
import { Button, Group, Modal, NativeSelect, Stack, Textarea, TextInput } from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { UploadIcon } from "@/components/Icons";
import type { Experience, ExperienceCategory } from "@/types";
import styles from "./ExperienceEditorModal.module.css";

export interface ExperienceDraft {
  date: string;
  category: string;
  title: string;
  content: string;
}

interface ExperienceEditorModalProps {
  opened: boolean;
  onClose: () => void;
  categories: ExperienceCategory[];
  defaultDate: string;
  /** 传入则为编辑模式，否则新增 */
  editing: Experience | null;
  onSubmit: (data: ExperienceDraft) => void;
}

export function ExperienceEditorModal({
  opened,
  onClose,
  categories,
  defaultDate,
  editing,
  onSubmit,
}: ExperienceEditorModalProps) {
  const [date, setDate] = useState(defaultDate);
  const [category, setCategory] = useState(categories[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  // 上传失败的内联提示（项目未启用 notifications，不依赖它）
  const [uploadError, setUploadError] = useState<string | null>(null);
  // 上传中避免重复点击
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setDate(editing?.date ?? defaultDate);
    setCategory(editing?.category ?? categories[0]?.id ?? "");
    setTitle(editing?.title ?? "");
    setContent(editing?.content ?? "");
    setUploadError(null);
  }, [opened, editing, defaultDate, categories]);

  const canSave = title.trim().length > 0 && category.length > 0;

  // 从本地选一个 .md 文件，把内容读入正文输入框。
  // Tauri 2 经 dialog 选中的路径会自动进入 fs 可读 scope，故 readTextFile 可读到任意位置的文件。
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
      setContent(text);
    } catch (err) {
      console.error("[experience] 读取 markdown 文件失败", err);
      setUploadError("读取文件失败，请确认文件未被占用或重试");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    onSubmit({ date, category, title: title.trim(), content });
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? "编辑经验" : "新增经验"}
      centered
      size="lg"
    >
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

        <div className={styles.editorBody}>
          <Group justify="space-between" align="center" className={styles.editorLabel}>
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
          <Textarea
            placeholder={"可直接写 Markdown，或点「上传 md」灌入整篇文档：\n\n## 经过\n...\n\n## 解决\n...\n\n## 教训\n..."}
            autosize
            minRows={6}
            maxRows={16}
            value={content}
            onChange={(e) => setContent(e.currentTarget.value)}
          />
          {uploadError && <div className={styles.uploadError}>{uploadError}</div>}
          {content.trim().length > 0 && (
            <div className={styles.preview}>
              <div className={styles.previewTitle}>预览</div>
              <div className={styles.previewBody}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        <Group justify="flex-end" mt="xs">
          <Button size="xs" variant="default" onClick={onClose}>
            取消
          </Button>
          <Button size="xs" onClick={handleSave} disabled={!canSave}>
            {editing ? "保存" : "添加"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
