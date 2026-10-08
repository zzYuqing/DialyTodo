// 职责：经验附件的三个通用动作 —— 打开 / 下载 / 选文件复制进附件目录。
// 主页卡片与就地编辑卡共用同一份实现，保证两处行为一致（同一套 scope 授权与错误语义）。
// 约定：失败一律抛错，由调用方决定提示方式（主页用内联红字，编辑卡同理）。

import { dirname, join } from "@tauri-apps/api/path";
import { open as openFileDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { copyFile, readTextFile } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  authorizeDirectory,
  copyAttachmentInto,
  experienceAttachmentsDir,
} from "@/services";
import { countLocalImages } from "@/lib";
import type { ExperienceAttachment } from "@/types";

/** copyPickedAttachments 的返回：added 为 null 表示用户取消选择；mdImageWarning 非空表示有 .md 含本地图片 */
export interface AddAttachmentsResult {
  /** null = 用户取消；否则为新增的附件条目（可能为空数组，即选中零个文件） */
  added: ExperienceAttachment[] | null;
  /** 非空：所选 .md 附件内含本地图片引用，需提示用户图片不会随附件一起上传 */
  mdImageWarning?: string;
}

/** 用系统默认程序打开附件（附件目录在数据根目录内，已在 opener 白名单里） */
export async function openAttachment(expId: string, storedName: string): Promise<void> {
  const dir = await experienceAttachmentsDir(expId);
  await openPath(await join(dir, storedName));
}

/**
 * 下载附件：弹「另存为」让用户选目标位置，再把附件从数据目录复制过去。
 * 目标目录基本都在静态 scope（$APPDATA）之外，所以复制前必须先 authorizeDirectory
 * 动态授权它 —— fs 插件的 scope 校验发生在宿主进程，TS 侧没有别的放行途径。
 */
export async function downloadAttachment(
  expId: string,
  att: ExperienceAttachment,
): Promise<void> {
  const target = await saveDialog({ defaultPath: att.name, title: `下载「${att.name}」` });
  if (target === null) return; // 用户取消「另存为」：不算失败
  const dir = await experienceAttachmentsDir(expId);
  await authorizeDirectory(await dirname(target));
  await copyFile(await join(dir, att.storedName), target);
}

/**
 * 选文件 → 逐个复制进 <数据根>/experiences/attachments/<expId>，返回新增的附件条目。
 * 用户在对话框取消时 added 为 null（与「选中零个文件」区分：后者返回空数组）。
 * 若所选文件中有 .md 且内含本地图片引用，会在 mdImageWarning 里给出提示——
 * 这些图片不会随附件一起复制上传，应改用「md + 图片打包压缩包」并写相对路径。
 */
export async function copyPickedAttachments(
  expId: string,
  title: string,
): Promise<AddAttachmentsResult> {
  const picked = await openFileDialog({ multiple: true, title });
  if (picked === null) return { added: null };
  const files = Array.isArray(picked) ? picked : [picked];
  const added: ExperienceAttachment[] = [];
  let mdLocalImageCount = 0;
  for (const file of files) {
    const att = await copyAttachmentInto(expId, file);
    added.push(att);
    // 仅对 Markdown 附件做图片体检：读取原文（仍位于用户原路径，未移动）统计本地图片引用
    if (att.mime === "text/markdown") {
      try {
        const text = await readTextFile(file);
        mdLocalImageCount += countLocalImages(text);
      } catch {
        // 读不到原文不阻塞上传，仅跳过该文件的图片统计
      }
    }
  }
  const mdImageWarning =
    mdLocalImageCount > 0
      ? `所选 .md 附件内含 ${mdLocalImageCount} 处本地图片引用，这些图片不会随附件一起复制上传，打开时图片会缺失。如需保留图片，请将 .md 与相关图片一起打包为压缩包上传，并在 md 内改用相对路径引用。`
      : undefined;
  return { added, mdImageWarning };
}
