// 职责：Tauri 宿主的 invoke 封装与能力检测。
// 在 npm run dev（只起 Vite、不启 Rust 侧）下 isAvailable() 为 false，
// 所有 command 调用降级为 no-op 并打印告警，避免前端直接崩溃。

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { HostBridge } from "./types";

/** Tauri 2 注入到 window 的全局标记 */
function detectTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const tauriBridge: HostBridge = {
  isAvailable: detectTauri,

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!detectTauri()) {
      console.warn(`[bridge] 非宿主环境，已跳过 command：${command}`);
      return undefined as T;
    }
    return await tauriInvoke<T>(command, args);
  },
};

/** 便捷判断：当前是否运行在 Tauri 宿主内 */
export function isTauri(): boolean {
  return detectTauri();
}
