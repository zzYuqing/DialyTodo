// 职责：洞察AI / 行业资讯生成任务的后台状态（不持久化，仅存内存）。
// 生成过程从视图组件剥离到模块级 store：切走页面（组件卸载）不中断加载，
// 回来后进度/实时预览/结果原样接上。两类日报共用同一任务队列，同时只允许一个在跑。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  generateIndustryReport,
  generateInsightReport,
  getInsightChannel,
  NoNewItemsError,
  type GenerateOptions,
} from "@/services";
import type { AiProviderConfig, IndustryProfile, InsightReport } from "@/types";

/** 运行中任务的实时快照（进度行 + 流式正文 + 推理内容累计） */
export interface InsightTaskSnapshot {
  channelId: string;
  channelLabel: string;
  dateKey: string;
  progLines: string[];
  liveContent: string;
  liveReasoning: string;
}

/** 任务结束后的结果，视图据此刷新报告或提示 */
export type InsightTaskResult =
  | { kind: "ok"; channelId: string; channelLabel: string; dateKey: string; report: InsightReport }
  | { kind: "info"; channelId: string; channelLabel: string; dateKey: string; message: string }
  | { kind: "error"; channelId: string; channelLabel: string; dateKey: string; message: string };

interface InsightTaskState {
  running: InsightTaskSnapshot | null;
  /** 最近一次结束的任务；seq 自增，视图用它探测新结果 */
  result: (InsightTaskResult & { seq: number }) | null;
  /** 启动洞察AI生成；已有任务在跑时直接忽略（返回 false） */
  start: (
    channelId: string,
    config: AiProviderConfig,
    dateKey: string,
    existing: InsightReport | null,
  ) => boolean;
  /** 启动某行业日报生成，复用同一后台任务与实时预览 */
  startIndustry: (
    industry: IndustryProfile,
    config: AiProviderConfig,
    dateKey: string,
    existing: InsightReport | null,
  ) => boolean;
  clearResult: () => void;
}

export const useInsightTaskStore = create<InsightTaskState>()(
  devtools((set, get) => {
    const launch = (
      channelId: string,
      channelLabel: string,
      dateKey: string,
      generate: (opts: GenerateOptions) => Promise<InsightReport>,
    ): boolean => {
      if (get().running !== null) return false;
      const snapshot: InsightTaskSnapshot = {
        channelId,
        channelLabel,
        dateKey,
        progLines: [],
        liveContent: "",
        liveReasoning: "",
      };
      set({ running: snapshot, result: null });

      const patch = (part: Partial<InsightTaskSnapshot>) => {
        const current = get().running;
        // 运行期间不应被替换；防御性判断，避免覆盖新任务
        if (current === null || current.channelId !== channelId || current.dateKey !== dateKey) {
          return;
        }
        set({ running: { ...current, ...part } });
      };

      void (async () => {
        try {
          const report = await generate({
            onProgress: (line) =>
              patch({ progLines: [...(get().running?.progLines ?? []), line] }),
            onToken: (accumulated) => patch({ liveContent: accumulated }),
            onReasoning: (accumulatedReasoning) => patch({ liveReasoning: accumulatedReasoning }),
          });
          set({
            running: null,
            result: { seq: Date.now(), kind: "ok", channelId, channelLabel, dateKey, report },
          });
        } catch (error) {
          const kind = error instanceof NoNewItemsError ? "info" : "error";
          const message = error instanceof Error ? error.message : String(error);
          set({
            running: null,
            result: { seq: Date.now(), kind, channelId, channelLabel, dateKey, message },
          });
        }
      })();
      return true;
    };

    return {
      running: null,
      result: null,

      start(channelId, config, dateKey, existing) {
        const label = getInsightChannel(channelId)?.label ?? channelId;
        return launch(channelId, label, dateKey, (opts) =>
          generateInsightReport(channelId, config, dateKey, opts, existing),
        );
      },

      startIndustry(industry, config, dateKey, existing) {
        const channelId = `industry:${industry.id}`;
        return launch(channelId, `${industry.name}日报`, dateKey, (opts) =>
          generateIndustryReport(industry, config, dateKey, opts, existing),
        );
      },

      clearResult() {
        set({ result: null });
      },
    };
  }),
);
