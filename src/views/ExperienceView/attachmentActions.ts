// 职责：经验附件的三个通用动作 —— 打开 / 下载 / 选文件复制进附件目录。
// 主页卡片与就地编辑卡共用同一份实现，保证两处行为一致（同一套 scope 授权与错误语义）。
// 约定：失败一律抛错，由调用方决定提示方式（主页用内联红字，编辑卡同理）。

import { dirname, join } from "@tauri-apps/api/path";
import { open as openFileDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  authorizeDirectory,
  copyAttachmentInto,
  experienceAttachmentsDir,
} from "@/services";
import type { ExperienceAttachment } from "@/types";

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
 * 用户在对话框取消时返回 null（与「选中零个文件」区分：后者返回空数组）。
 */
export async function copyPickedAttachments(
  expId: string,
  title: string,
): Promise<ExperienceAttachment[] | null> {
  const picked = await openFileDialog({ multiple: true, title });
  if (picked === null) return null;
  const files = Array.isArray(picked) ? picked : [picked];
  const added: ExperienceAttachment[] = [];
  for (const file of files) {
    added.push(await copyAttachmentInto(expId, file));
  }
  return added;
}
