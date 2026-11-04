// 职责：模板编辑器现场 + 模板 AI 任务的模块级状态（不持久化，仅存内存）。
//
// 设计（2026-11-04 终版，用户拍板）：
//   草稿（draft）住在本 store —— 编辑器现场跨页存活：切页回来原样恢复
//   （含在途任务、完成提示、失败原因），不存在「列表占位条目」这种兜底形态。
//   点「取消」= 丢弃草稿并真正掐断在途请求（AbortController → AiCancelledError 静默）。
//   软件重启一切归零（用户已确认可接受）。
//
// 任务结果一律回填草稿；编辑模式（targetId 非 null）另同步覆盖库内条目
// （原条目在成功前不动，中途删除目标条目则只回填草稿、不再写库）。
// 试用 API 通常同时只允许一个请求：取消后立刻重试可能吃 429，
// aiService 已把 429 翻译成「过一会儿再试」的提示，经 error 就地显示。
// 同时只允许一个模板 AI 任务在跑；失败态保留原始输入供重试。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { TEMPLATE_NOT_APPLICABLE, TEMPLATE_POLISH_PROMPT, TEMPLATE_RECOGNIZE_PROMPT } from "@/constants";
import { AiCancelledError, checkTemplateTopic, streamChatCompletion } from "@/services";
import { useSettingsStore } from "./useSettingsStore";
import type { AiProviderConfig, ReportTemplateEntry } from "@/types";

export type TemplateAiKind = "polish" | "recognize";

/** 编辑器的任务阶段：先判内容是否跑题，通过后才真正整理 */
export type TemplateAiStage = "review" | "generate";

/**
 * 初审判定「内容跑题」时抛的错误：与网络 / 接口失败区分开 ——
 * 前者重试同一份输入必然再失败，不该给「重试」按钮。
 */
class TemplateRejectedError extends Error {
  constructor(reason: string) {
    super(reason.trim() === "" ? "内容与周报、工作总结都无关" : reason.trim());
    this.name = "TemplateRejectedError";
  }
}

/** 编辑器草稿：id 为 null 表示新建 */
export interface TemplateDraft {
  id: string | null;
  name: string;
  content: string;
  /** 打开 / 导入 / AI 回填时的内容快照：保存时 content 与它一致 → 跳过 AI 初审 */
  originalContent: string;
}

export interface TemplateAiTask {
  id: string;
  kind: TemplateAiKind;
  /** 启动时捕获的名称（编辑模式覆盖写库时使用） */
  name: string;
  /** 原始输入（润色 = 草稿全文，识别 = 粘贴的示例文本），失败重试时原样复用 */
  input: string;
  /** 非 null = 覆盖该条目（编辑模式）；null = 结果只回填草稿 */
  targetId: string | null;
  status: "running" | "failed";
  /** running 时的当前阶段；failed 时标记失败发生在哪一步 */
  stage: TemplateAiStage;
  /** 失败后能否原样重试：内容跑题时重试同一份输入必然再失败，故为 false */
  retryable: boolean;
  /** running 时的流式累计正文（当前仅留存，供将来做生成中预览） */
  liveContent: string;
  /** failed 时的错误原因 */
  message: string;
}

interface TemplateEditorState {
  draft: TemplateDraft | null;
  task: TemplateAiTask | null;
  /** 任务成功后的提示（编辑器就地显示） */
  hint: string | null;
  /** 任务失败的原因（编辑器就地显示） */
  error: string | null;
  /** 打开编辑器（新建草稿，预填默认名） */
  openNew: () => void;
  /** 打开编辑器（编辑既有条目，就地修改） */
  openEntry: (entry: ReportTemplateEntry) => void;
  /** 关闭编辑器：丢弃草稿，掐断在途请求，清空全部反馈 */
  closeEditor: () => void;
  /** 草稿局部更新（名称 / 内容） */
  patchDraft: (patch: Partial<Pick<TemplateDraft, "name" | "content">>) => void;
  /** 「获取模板」导入：整份内容替换草稿（originalContent 一并对齐） */
  importContent: (content: string) => void;
  /** 启动润色（取草稿当前内容与名称；编辑模式覆盖本条目，视图层已确认） */
  startPolish: (config: AiProviderConfig) => void;
  /** 启动识别（粘贴的示例文本，结果回填草稿） */
  startRecognize: (input: string, config: AiProviderConfig) => void;
  /** 失败任务重试：用留存的原始输入原样重跑 */
  retry: (config: AiProviderConfig) => void;
}

function newTaskId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useTemplateAiStore = create<TemplateEditorState>()(
  devtools((set, get) => {
    /** 在途请求的中断控制器（组件卸载 / 取消编辑时 abort；非渲染状态，不放 store） */
    let activeController: AbortController | null = null;

    /** 任务主体：running → 回填草稿（+ 覆盖写库）/ 失败就地挂原因；id 守卫防止旧任务覆盖新任务 */
    const run = (
      kind: TemplateAiKind,
      input: string,
      name: string,
      targetId: string | null,
      config: AiProviderConfig,
    ) => {
      const id = newTaskId();
      const controller = new AbortController();
      activeController = controller;
      const verb = kind === "polish" ? "润色" : "识别";
      set({
        task: {
          id,
          kind,
          name,
          input,
          targetId,
          status: "running",
          stage: "review",
          retryable: true,
          liveContent: "",
          message: "",
        },
        hint: null,
        error: null,
      });

      void (async () => {
        try {
          // 阶段一：主题守门（宽松）——只拦「跟报告模板完全无关」的内容。
          // 描述模板结构、委托生成（如「给我个程序员周报模板」）、粘贴示例文本都必须放行；
          // 保存闸门（reviewTemplate）才管「能不能入库」，两道闸标准刻意不同。
          const topic = await checkTemplateTopic(input, config, controller.signal);
          if (!topic.related) {
            throw new TemplateRejectedError(topic.reason);
          }
          const reviewed = get().task;
          if (reviewed === null || reviewed.id !== id) return;
          set({ task: { ...reviewed, stage: "generate" } });

          // 阶段二：整理成模板
          const content = await streamChatCompletion(
            config,
            [
              {
                role: "system",
                content: kind === "polish" ? TEMPLATE_POLISH_PROMPT : TEMPLATE_RECOGNIZE_PROMPT,
              },
              { role: "user", content: input },
            ],
            {
              onContent: (accumulated) => {
                const current = get().task;
                if (current !== null && current.id === id && current.status === "running") {
                  set({ task: { ...current, liveContent: accumulated } });
                }
              },
            },
            undefined,
            undefined,
            controller.signal,
          );
          const trimmed = content.trim();
          // 编辑器已关（任务被取消后完成）：id 已不在，结果作废
          const current = get().task;
          if (current === null || current.id !== id) return;
          // 模型读完自报「这不是模板相关的内容」：与初审同一结论，按跑题处理
          if (trimmed.startsWith(TEMPLATE_NOT_APPLICABLE)) {
            throw new TemplateRejectedError("这份内容看起来不是周报模板相关的要求");
          }
          if (trimmed === "") throw new Error("AI 返回了空内容，请重试");

          const draft = get().draft;
          set({
            task: null,
            // originalContent 一并对齐：刚回填就点保存不必再等一轮初审
            draft: draft === null ? null : { ...draft, content: trimmed, originalContent: trimmed },
            hint:
              targetId === null
                ? `${verb}完成，已填入编辑框；确认无误后点「保存模板」`
                : `${verb}完成，已覆盖「${name}」并同步到编辑框`,
          });

          // 编辑模式：另同步覆盖库内条目（用户已删除目标 → 只回填草稿，不再写库）
          if (targetId !== null) {
            const { settings, update } = useSettingsStore.getState();
            const library = settings.reportTemplates;
            if (library.some((t) => t.id === targetId)) {
              await update({
                reportTemplates: library.map((t) =>
                  t.id === targetId ? { ...t, name, content: trimmed } : t,
                ),
              });
            }
          }
        } catch (error) {
          // 用户主动取消：静默丢弃（草稿已随 closeEditor 清空）
          if (error instanceof AiCancelledError) return;
          const current = get().task;
          if (current === null || current.id !== id || current.status !== "running") return;

          // 内容跑题：不算「失败」，而是「这份内容不该拿来润色」，且不给重试入口
          if (error instanceof TemplateRejectedError) {
            set({
              task: {
                ...current,
                status: "failed",
                retryable: false,
                message: error.message,
              },
              error: `初审未通过：${error.message}`,
            });
            return;
          }

          const message = error instanceof Error ? error.message : String(error);
          set({
            task: { ...current, status: "failed", retryable: true, message },
            error: `${verb}没能完成：${message}`,
          });
        }
      })();
    };

    return {
      draft: null,
      task: null,
      hint: null,
      error: null,

      openNew() {
        set({
          draft: { id: null, name: "我的模板", content: "", originalContent: "" },
          task: null,
          hint: null,
          error: null,
        });
      },

      openEntry(entry) {
        set({
          draft: {
            id: entry.id,
            name: entry.name,
            content: entry.content,
            originalContent: entry.content,
          },
          task: null,
          hint: null,
          error: null,
        });
      },

      closeEditor() {
        if (activeController !== null) {
          activeController.abort();
          activeController = null;
        }
        set({ draft: null, task: null, hint: null, error: null });
      },

      patchDraft(patch) {
        const draft = get().draft;
        if (draft === null) return;
        // 用户改动内容 → 上一次的失败结论针对的是旧内容，就地作废，
        // 免得红字挂在已经改过的文本下面继续误导
        const task = get().task;
        const stale = patch.content !== undefined && task !== null && task.status === "failed";
        set({
          draft: { ...draft, ...patch },
          ...(stale ? { task: null, error: null } : {}),
        });
      },

      importContent(content) {
        const draft = get().draft;
        if (draft === null || content === "") return;
        set({
          draft: { ...draft, content, originalContent: content },
          task: null,
          hint: null,
          error: null,
        });
      },

      startPolish(config) {
        const { draft, task } = get();
        if (draft === null || draft.content.trim() === "") return;
        if (task !== null && task.status === "running") return;
        run("polish", draft.content, draft.name.trim(), draft.id, config);
      },

      startRecognize(input, config) {
        const { draft, task } = get();
        if (draft === null || input.trim() === "") return;
        if (task !== null && task.status === "running") return;
        run("recognize", input, draft.name.trim(), null, config);
      },

      retry(config) {
        const current = get().task;
        if (current === null || current.status !== "failed" || !current.retryable) return;
        run(current.kind, current.input, current.name, current.targetId, config);
      },
    };
  }),
);
