// 职责：持久化层的读写结果类型。
// LoadResult 沿用上一版 JsonStore::LoadResult 的三元组设计：
// 把「能否继续启动」「是否来自备份」「需要提示什么」分开表达，避免调用方猜。

import type { Task } from "./task";

/** tasks.json 顶层结构 */
export interface TasksFile {
  version: number;
  tasks: Task[];
}

/** 启动加载结果 */
export interface LoadResult {
  /** 应用是否可以继续启动 */
  ok: boolean;
  /** 数据是否来自备份恢复 */
  usedBackup: boolean;
  /** 需要提示用户的信息，null 表示无异常 */
  error: string | null;
  /**
   * 当主文件 tasks.json 损坏时，被改名保留的备份路径（绝对路径），null 表示未生成。
   * 兜底逻辑保证：损坏时原文件必须先被 rename 为 .bak.{timestamp}，
   * 后续 saveTasks 写入新数据时不会覆盖损坏原文件，事后可手动比对恢复。
   */
  corruptedBackupPath: string | null;
}

/** 导入备份时的冲突处理策略（提示词 5.4） */
export type ImportStrategy = "overwrite" | "merge";

/** 导入前的文件结构校验结果与任务清单 */
export interface ParsedImport {
  valid: boolean;
  tasks: Task[];
  error: string | null;
}
