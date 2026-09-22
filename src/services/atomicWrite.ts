// 职责：原子写入共享工具（与 storage.ts 原实现同源）。
// 先写 .tmp 再 rename 原地原子替换，避免写入中途进程崩溃留下半截文件。
// Windows 上 rename 走 MoveFileEx MOVEFILE_REPLACE_EXISTING，属原子替换。

import { rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { TMP_FILE_SUFFIX } from "@/constants";

export async function atomicWrite(path: string, content: string): Promise<void> {
  const tmpPath = `${path}${TMP_FILE_SUFFIX}`;
  await writeTextFile(tmpPath, content);
  await rename(tmpPath, path);
}
