// 职责：AI 报告生成任务的后台状态（不持久化，仅存内存）。
// 生成过程从视图组件剥离到模块级 store：切走页面（组件卸载）不中断加载，
// 回来后实时预览 / 结果原样接上 —— 与洞察AI 的 useInsightTaskStore 同一模式。
// 同时只允许一个生成任务在跑（报告与日报共用一个模型连接，排队没有收益）。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { generateWeeklyReport } from "@/services";
import type {
  AiProviderConfig,
  ReportMaterial,
  WeeklyReport,
} from "@/types";

/** 运行中任务的实时快照（区间身份 + 流式正文 + 推理内容累计） */
export interface ReportTaskSnapshot {
  key: string;
  start: string;
  end: string;
  liveContent: string;
  liveReasoning: string;
}

/** 任务结束后的结果，视图据此刷新报告或提示 */
export type ReportTaskResult =
  | { kind: "ok"; key: string; report: WeeklyReport }
  | { kind: "error"; key: string; message: string };

export interface ReportTaskStartArgs {
  key: string;
  kind: WeeklyReport["kind"];
  start: string;
  end: string;
  material: ReportMaterial;
  config: AiProviderConfig;
  /** 模板内容（空白串 = 内置默认模板） */
  template: string;
  /** 模板身份（"default" 或模板库条目 id），原样落库供重新生成回查 */
  templateId: string;
}

interface ReportTaskState {
  running: ReportTaskSnapshot | null;
  /** 最近一次结束的任务；seq 自增，视图用它探测新结果 */
  result: (ReportTaskResult & { seq: number }) | null;
  /** 启动生成；已有任务在跑时直接忽略（返回 false） */
  start: (args: ReportTaskStartArgs) => boolean;
  clearResult: () => void;
}

export const useReportTaskStore = create<ReportTaskState>()(
  devtools((set, get) => ({
    running: null,
    result: null,

    start({ key, kind, start, end, material, config, template, templateId }) {
      if (get().running !== null) return false;
      const snapshot: ReportTaskSnapshot = {
        key,
        start,
        end,
        liveContent: "",
        liveReasoning: "",
      };
      set({ running: snapshot, result: null });

      const patch = (part: Partial<ReportTaskSnapshot>) => {
        const current = get().running;
        // 运行期间不应被替换；防御性判断，避免覆盖新任务
        if (current === null || current.key !== key) return;
        set({ running: { ...current, ...part } });
      };

      void (async () => {
        try {
          const report = await generateWeeklyReport(
            material,
            key,
            kind,
            config,
            template,
            templateId,
            {
              onContent: (accumulated) => patch({ liveContent: accumulated }),
              onReasoning: (accumulatedReasoning) =>
                patch({ liveReasoning: accumulatedReasoning }),
            },
          );
          set({
            running: null,
            result: { seq: Date.now(), kind: "ok", key, report },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set({ running: null, result: { seq: Date.now(), kind: "error", key, message } });
        }
      })();
      return true;
    },

    clearResult() {
      set({ result: null });
    },
  })),
);
