// 职责：宿主能力门面的接口定义。
// 目的：让上层依赖抽象而非具体的 Tauri 运行时，
// 便于在 npm run dev（纯 Vite，无 Rust 侧）下替换为降级实现而不崩溃。

export interface HostBridge {
  /** 当前是否运行在 Tauri 宿主内 */
  isAvailable(): boolean;
  /** 调用 Rust command；非宿主环境下返回 undefined 而不抛异常 */
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}
