// 职责：回收站条目的领域模型。
// 五类被「删除」的数据（任务 / 经验 / 附件 / 子任务 / 糊弄法）在用户点击删除时并不立即销毁，
// 而是整份快照移入回收站，保留 trashRetentionDays 天后由启动扫描彻底清除。
// 磁盘文件在回收站内始终保留，只有彻底删除（手动或过期）时才真正删盘。

import type { Experience, ExperienceAttachment, Task } from "@/types";
import type { HunongItem } from "@/services/hunongService";

/** 回收站条目种类 */
export type TrashKind = "task" | "experience" | "attachment" | "subtask" | "hunong";

/** 附件类条目的还原 payload：还原时需要原经验仍存在 */
export interface TrashAttachmentPayload {
  /** 附件原本所属的经验 id */
  expId: string;
  /** 附件原本所属的经验标题（展示用，便于用户判断还原到哪条经验） */
  expTitle: string;
  attachment: ExperienceAttachment;
}

/** 子任务类条目的还原 payload：还原时需要原任务集仍存在 */
export interface TrashSubtaskPayload {
  /** 子任务原本所属的任务集 id */
  parentId: string;
  /** 任务集标题（展示用，便于用户判断还原到哪个任务集） */
  parentTitle: string;
  /** 子任务在父任务集 children 里的原始下标，用于还原回原位（父已删则无法还原） */
  index: number;
  /** 被删子任务的完整快照（含原 parentId 与 childDoneAt） */
  task: Task;
}

/** 一条回收站条目。payload 按 kind 二选一非空 */
export interface TrashEntry {
  /** 回收站条目唯一 id（与业务 id 区分，避免还原后撞键） */
  id: string;
  kind: TrashKind;
  /** 移入回收站的时间戳（epoch ms），用于计算保留期限 */
  deletedAt: number;
  /** 展示名：任务标题 / 经验标题 / 附件原始文件名 */
  name: string;
  /** 来源说明（人话），如「经验 · 2026-10-08」「任务 · 一次性」 */
  source: string;
  /** 任务类：被删的整组任务（单任务长度 1；任务集含父 + 子任务） */
  tasks?: Task[];
  /** 经验类：被删的整条经验（含其附件数组） */
  experience?: Experience;
  /** 附件类：被摘下的单条附件 */
  attachment?: TrashAttachmentPayload;
  /** 子任务类：从任务集里删掉的单条子任务（含父任务集引用与原始位置） */
  subtask?: TrashSubtaskPayload;
  /** 糊弄法类：被删的整组糊弄法条目（无磁盘文件，还原时写回 hunong.json） */
  hunong?: HunongItem[];
}
