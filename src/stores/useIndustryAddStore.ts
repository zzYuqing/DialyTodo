// 职责：行业添加流程的模块级后台状态（不持久化到磁盘）。
// 初审、上下游推荐与信源验证均在 store 内执行，页面卸载不中断请求，回来后接上进度和结果。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  addIndustryBundle,
  recommendIndustryRelations,
  reviewIndustry,
} from "@/services";
import type {
  AiProviderConfig,
  IndustryAddResult,
  IndustryRelationMode,
  IndustryRelationSelection,
  IndustryRelationSuggestion,
  IndustryReview,
} from "@/types";

export interface IndustryRelationSelectionState {
  checked: boolean;
  mode: IndustryRelationMode;
}

type IndustryAddOperation = "review" | "relations" | "save" | null;

interface IndustryAddState {
  input: string;
  primary: IndustryReview | null;
  relations: IndustryRelationSuggestion[] | null;
  selections: Record<string, IndustryRelationSelectionState>;
  operation: IndustryAddOperation;
  status: string | null;
  error: string | null;
  /** 当前 AI 请求的累计思考内容；随后台任务保留，切页不丢 */
  liveReasoning: string;
  /** 保存完成结果；页面可能已卸载，因此通过 seq 在下次挂载时继续消费 */
  addedResult: { seq: number; result: IndustryAddResult } | null;
  setInput: (input: string) => void;
  startReview: (config: AiProviderConfig) => boolean;
  startRelationRecommendation: (config: AiProviderConfig) => boolean;
  saveSelection: (selected: IndustryRelationSelection[]) => boolean;
  updateRelation: (
    key: string,
    patch: Partial<IndustryRelationSelectionState>,
  ) => void;
  returnToChoice: () => void;
  reset: () => void;
  clearAddedResult: () => void;
}

function relationKey(relation: IndustryRelationSuggestion): string {
  return `${relation.direction}:${relation.name}`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export const useIndustryAddStore = create<IndustryAddState>()(
  devtools((set, get) => ({
    input: "",
    primary: null,
    relations: null,
    selections: {},
    operation: null,
    status: null,
    error: null,
    liveReasoning: "",
    addedResult: null,

    setInput(input) {
      if (get().operation !== null) return;
      set({ input, error: null });
    },

    startReview(config) {
      const { operation, input } = get();
      if (operation !== null) return false;
      set({
        primary: null,
        relations: null,
        selections: {},
        operation: "review",
        status: null,
        error: null,
        liveReasoning: "",
      });
      void (async () => {
        try {
          const review = await reviewIndustry(
            input,
            config,
            (status) => set({ status }),
            (liveReasoning) => set({ liveReasoning }),
          );
          if (!review.approved) {
            set({ error: review.reason });
            return;
          }
          set({ primary: review, relations: null, selections: {} });
        } catch (reason) {
          set({ error: errorMessage(reason) });
        } finally {
          set({ operation: null, status: null, liveReasoning: "" });
        }
      })();
      return true;
    },

    startRelationRecommendation(config) {
      const { operation, primary } = get();
      if (operation !== null || primary === null) return false;
      set({ operation: "relations", status: null, error: null, liveReasoning: "" });
      void (async () => {
        try {
          const suggestions = await recommendIndustryRelations(
            primary,
            config,
            (status) => set({ status }),
            (liveReasoning) => set({ liveReasoning }),
          );
          // 默认全部不勾选，避免 AI 替用户批量添加并不关心的行业
          const selections = Object.fromEntries(
            suggestions.map((suggestion) => [
              relationKey(suggestion),
              { checked: false, mode: "merge" },
            ]),
          ) as Record<string, IndustryRelationSelectionState>;
          set({ relations: suggestions, selections });
        } catch (reason) {
          set({ error: errorMessage(reason) });
        } finally {
          set({ operation: null, status: null, liveReasoning: "" });
        }
      })();
      return true;
    },

    saveSelection(selected) {
      const { operation, primary } = get();
      if (operation !== null || primary === null) return false;
      set({ operation: "save", status: null, error: null, liveReasoning: "" });
      void (async () => {
        try {
          const result = await addIndustryBundle(primary, selected, (status) => set({ status }));
          set({
            input: "",
            primary: null,
            relations: null,
            selections: {},
            addedResult: { seq: Date.now(), result },
          });
        } catch (reason) {
          set({ error: errorMessage(reason) });
        } finally {
          set({ operation: null, status: null, liveReasoning: "" });
        }
      })();
      return true;
    },

    updateRelation(key, patch) {
      if (get().operation !== null) return;
      set((current) => ({
        selections: {
          ...current.selections,
          [key]: {
            ...(current.selections[key] ?? { checked: false, mode: "merge" }),
            ...patch,
          },
        },
        error: null,
      }));
    },

    returnToChoice() {
      if (get().operation !== null) return;
      set({ relations: null, selections: {}, status: null, error: null, liveReasoning: "" });
    },

    reset() {
      if (get().operation !== null) return;
      set({
        input: "",
        primary: null,
        relations: null,
        selections: {},
        status: null,
        error: null,
        liveReasoning: "",
      });
    },

    clearAddedResult() {
      set({ addedResult: null });
    },
  })),
);
