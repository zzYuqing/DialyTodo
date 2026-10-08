// 职责：附件在线预览弹窗。仅对四类格式渲染内容 —— 图片、纯文本(txt/log)、pdf、markdown；
// 其余格式（含压缩包）不在本弹窗支持之列，由 isPreviewableAttachment 决定入口是否显示。
// 渲染策略：图片与 pdf 读二进制转 base64 内联成 data: URL（故意绕开 asset 协议 ——
//   Tauri 2 下 asset 协议默认不启用、且静态 scope 无法覆盖自定义数据目录，转 asset URL 会静默裂图）；
// 文本与 markdown 读原文后在 WebView 内渲染（md 复用经验卡片的 resolveImageSrc 解析内嵌图片）。

import { useEffect, useState } from "react";
import { Modal, Text } from "@mantine/core";
import { join } from "@tauri-apps/api/path";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { experienceAttachmentsDir } from "@/services";
import { resolveImageSrc } from "./resolveImageSrc";
import type { ExperienceAttachment } from "@/types";
import styles from "./AttachmentPreviewModal.module.css";

/** Uint8Array → base64（WebView 内无 Node Buffer，手写实现） */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 预览类型：图片 / 文本 / pdf / markdown / 不支持(null) */
export type PreviewKind = "image" | "text" | "pdf" | "markdown" | null;

/** 由 mime 推断预览类型；压缩包(application/zip)、json、未知二进制等均返回 null */
export function previewKindOf(att: ExperienceAttachment): PreviewKind {
  const mime = att.mime;
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/markdown") return "markdown";
  if (mime === "text/plain") return "text";
  return null;
}

/** 是否支持在线预览（调用方据此决定是否显示「预览」按钮） */
export function isPreviewableAttachment(att: ExperienceAttachment): boolean {
  return previewKindOf(att) !== null;
}

interface AttachmentPreviewModalProps {
  opened: boolean;
  /** 待预览附件；为 null 时不渲染内容（弹窗标题退化为「预览」） */
  att: ExperienceAttachment | null;
  /** 所属经验 id，用于定位附件目录 */
  expId: string;
  /** 数据根目录，供 markdown 内嵌图片解析 */
  root: string | null;
  onClose: () => void;
}

export function AttachmentPreviewModal({
  opened,
  att,
  expId,
  root,
  onClose,
}: AttachmentPreviewModalProps) {
  const [text, setText] = useState<string | null>(null);
  const [assetSrc, setAssetSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const kind = att ? previewKindOf(att) : null;

  // 每次打开或切换附件时重新加载内容；依赖变更即重新拉取，关闭时取消挂起的读取
  useEffect(() => {
    if (!opened || att === null || kind === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);
    setAssetSrc(null);
    void (async () => {
      try {
        const dir = await experienceAttachmentsDir(expId);
        const full = await join(dir, att.storedName);
        if (kind === "image" || kind === "pdf") {
          // 读二进制 → base64 内联 data URL，彻底绕开 asset 协议（不依赖 scope/csp/路径格式）
          const bytes = await readFile(full);
          const dataUrl = `data:${att.mime || "application/octet-stream"};base64,${uint8ToBase64(
            bytes,
          )}`;
          if (!cancelled) setAssetSrc(dataUrl);
        } else {
          const content = await readTextFile(full);
          if (!cancelled) setText(content);
        }
      } catch (err) {
        console.error("[experience] 预览附件失败", err);
        if (!cancelled) setError("预览失败，文件可能已被移动或删除");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, att, expId, kind]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={att ? `预览 ${att.name}` : "预览"}
      centered
      size="xl"
    >
      <div className={styles.body}>
        {loading && (
          <Text size="sm" c="dimmed">
            加载中…
          </Text>
        )}
        {error && <div className={styles.error}>{error}</div>}
        {!loading && !error && kind === "image" && assetSrc && (
          <img src={assetSrc} alt={att?.name} className={styles.image} />
        )}
        {!loading && !error && kind === "pdf" && assetSrc && (
          <iframe src={assetSrc} title={att?.name} className={styles.frame} />
        )}
        {!loading && !error && kind === "text" && (
          <pre className={styles.text}>{text}</pre>
        )}
        {!loading && !error && kind === "markdown" && (
          <div className={styles.markdown}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, alt }) => (
                  <img src={resolveImageSrc(src, root)} alt={alt ?? ""} />
                ),
              }}
            >
              {text ?? ""}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </Modal>
  );
}
