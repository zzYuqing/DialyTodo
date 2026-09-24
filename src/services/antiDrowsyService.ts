// 职责：防困小妙招「用户手动添加」数据的本地持久化。
// 仅持久化用户添加的妙招（内置妙招为代码常量，不落盘）；文件位于 <数据根>/anti-drowsy.json。
// 读写全部在 TS 侧完成，复用项目的 fs 模式（dataRoot + atomicWrite），不新写 Rust command。
// 读写失败一律静默降级：不阻塞使用，下次启动按空数据处理。

import { join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { atomicWrite } from "./atomicWrite";
import { dataRoot, ensureDirectories } from "./paths";

const FILE_NAME = "anti-drowsy.json";

export interface AntiDrowsyData {
  /** 用户手动添加的妙招文本（内置妙招不在此列） */
  userTips: string[];
}

/** 加载用户添加的妙招；文件缺失或损坏返回空数组 */
export async function loadAntiDrowsy(): Promise<AntiDrowsyData> {
  try {
    const path = await join(await dataRoot(), FILE_NAME);
    if (!(await exists(path))) return { userTips: [] };
    const parsed: unknown = JSON.parse(await readTextFile(path));
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { userTips?: unknown }).userTips)) {
      const list = (parsed as { userTips: unknown[] }).userTips;
      return { userTips: list.filter((t): t is string => typeof t === "string") };
    }
    return { userTips: [] };
  } catch {
    return { userTips: [] };
  }
}

/** 保存用户添加的妙招；失败静默降级 */
export async function saveAntiDrowsy(data: AntiDrowsyData): Promise<void> {
  try {
    await ensureDirectories();
    const path = await join(await dataRoot(), FILE_NAME);
    await atomicWrite(path, JSON.stringify(data, null, 2));
  } catch {
    // 静默降级：保存失败不影响本次使用
  }
}
