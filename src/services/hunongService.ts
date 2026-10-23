// 职责：糊弄学「用户手动添加」数据的本地持久化。
// 每条糊弄法为结构化条目 { method, example? }，仅持久化用户添加的部分
// （内置条目为代码常量，不落盘）；文件位于 <数据根>/hunong.json。
// 读写全部在 TS 侧完成，复用项目的 fs 模式（dataRoot + atomicWrite），不新写 Rust command。
// 读写失败一律静默降级：不阻塞使用，下次启动按空数据处理。

import { join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { atomicWrite } from "./atomicWrite";
import { dataRoot, ensureDirectories } from "./paths";

const FILE_NAME = "hunong.json";

export interface HunongItem {
  /** 糊弄法（必填） */
  method: string;
  /** 举例（可选） */
  example?: string;
}

export interface HunongData {
  /** 用户手动添加的糊弄法条目（内置条目不在此列） */
  items: HunongItem[];
}

/** 加载用户添加的糊弄法；文件缺失或损坏返回空数组 */
export async function loadHunong(): Promise<HunongData> {
  try {
    const path = await join(await dataRoot(), FILE_NAME);
    if (!(await exists(path))) return { items: [] };
    const parsed: unknown = JSON.parse(await readTextFile(path));
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)) {
      const list = (parsed as { items: unknown[] }).items;
      const items: HunongItem[] = [];
      for (const it of list) {
        if (it && typeof it === "object" && typeof (it as { method?: unknown }).method === "string") {
          const m = (it as { method: string; example?: unknown }).method;
          const ex = (it as { example?: unknown }).example;
          items.push({ method: m, example: typeof ex === "string" && ex.trim() ? ex : undefined });
        }
      }
      return { items };
    }
    return { items: [] };
  } catch {
    return { items: [] };
  }
}

/** 保存用户添加的糊弄法；失败静默降级 */
export async function saveHunong(data: HunongData): Promise<void> {
  try {
    await ensureDirectories();
    const path = await join(await dataRoot(), FILE_NAME);
    await atomicWrite(path, JSON.stringify(data, null, 2));
  } catch {
    // 静默降级：保存失败不影响本次使用
  }
}
