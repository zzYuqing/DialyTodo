// 职责：洞察AI的网络层 —— 大模型对话请求（OpenAI 兼容 /chat/completions，SSE 流式）与资讯抓取。
// 通道约定：Tauri 内的公开资讯优先走系统网络，避开 WebView 的 CORS 限制；
// 非 Tauri 环境或系统通道失败时才回退前端直连，最后再尝试公共转发。
// 大模型请求仍由本机直连服务商，不使用资讯转发通道。
//
// 安全约定：API Key 仅由本机直连服务商使用，绝不上传到任何第三方；
// 公共转发只用于无鉴权的公开资讯页，Key 与对话内容绝不走转发。
//
// 生成采用流式（stream:true）：推理模型（如 kimi-k3）归纳长素材动辄数分钟，
// 非流式要等全文返回极易超时；流式逐块返回，既不怕慢，界面也能实时预览生成过程。

import { isTauri, tauriBridge } from "@/bridge";
import { CORS_RELAY_RAW_URL, INSIGHT_LLM_IDLE_TIMEOUT_MS, INSIGHT_LLM_TIMEOUT_MS } from "@/constants";
import type { AiProviderConfig } from "@/types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 流式生成的回调：onReasoningStart 在模型开始输出推理内容时触发一次；onContent 携带累计正文 */
export interface StreamHandlers {
  onReasoningStart?: () => void;
  /** 推理内容的实时累计（仅思考型模型有输出；普通模型不会触发） */
  onReasoning?: (accumulatedReasoning: string) => void;
  onContent: (accumulated: string) => void;
}

/** 配置不完整时抛出的错误类型，视图层据此引导用户先填写 API 设置 */
export class AiConfigMissingError extends Error {
  constructor() {
    super("请先完成 API 设置：服务地址、API Key 与模型名均不能为空");
    this.name = "AiConfigMissingError";
  }
}

/**
 * 调用方主动取消（外部 AbortSignal 触发）。
 * 区别于超时 / 断流：调用方应静默吞掉它，不要当失败提示给用户。
 */
export class AiCancelledError extends Error {
  constructor() {
    super("已取消");
    this.name = "AiCancelledError";
  }
}

/** 配置是否齐全（baseUrl / apiKey / model 均非空白） */
export function isAiProviderReady(config: AiProviderConfig): boolean {
  return (
    config.baseUrl.trim() !== "" && config.apiKey.trim() !== "" && config.model.trim() !== ""
  );
}

/**
 * 调用 OpenAI 兼容的对话接口（SSE 流式）。
 * 双超时：整体 INSIGHT_LLM_TIMEOUT_MS（默认 5 分钟）+ 块间空闲 INSIGHT_LLM_IDLE_TIMEOUT_MS
 * （默认 60 秒无数据即断开，区分「慢」与「卡死」）。HTTP 错误尽力解析服务商 error.message。
 * signal：外部取消（如用户关闭编辑器）——触发后整个请求与流读取一并中断，抛 AiCancelledError。
 * 返回累计的完整正文。
 */
export async function streamChatCompletion(
  config: AiProviderConfig,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  timeoutMs: number = INSIGHT_LLM_TIMEOUT_MS,
  idleMs: number = INSIGHT_LLM_IDLE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<string> {
  if (!isAiProviderReady(config)) throw new AiConfigMissingError();

  const base = config.baseUrl.trim().replace(/\/+$/, "");
  const controller = new AbortController();
  // 外部取消透传到内部 controller（fetch 与流读取共用同一 signal）
  if (signal !== undefined) {
    if (signal.aborted) throw new AiCancelledError();
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const startedAt = Date.now();
  // 整体超时（不可取消）；块间空闲超时（每收到一块就重置，判断连接是否卡死）
  const hardTimer = setTimeout(() => controller.abort(), timeoutMs);
  let idleTimer = setTimeout(() => controller.abort(), idleMs);

  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey.trim()}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        // 不传 temperature：部分推理模型（如 kimi-k3）只接受 temperature=1，
        // 传其他值直接 400；省略则由各服务商按模型默认值处理，兼容性最好
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(hardTimer);
    clearTimeout(idleTimer);
    if (signal?.aborted) throw new AiCancelledError();
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        Date.now() - startedAt >= timeoutMs
          ? `生成超时：模型响应超过 ${Math.round(timeoutMs / 60000)} 分钟仍未完成，请稍后重试或换用更快的模型`
          : "连接中断：模型服务长时间没有返回数据，请检查网络后重试",
      );
    }
    throw new Error(
      "网络请求失败：无法连接模型服务（可能是网络问题或该服务商不支持浏览器直连，可稍后换走系统通道重试）",
    );
  }

  if (!response.ok) {
    clearTimeout(hardTimer);
    clearTimeout(idleTimer);
    // 429 = 服务商还有请求在处理（试用接口通常同时只允许一个任务；
    // 刚取消 / 刚结束一个请求就立刻发新的，大概率吃这个）
    if (response.status === 429) {
      throw new Error(
        "接口正忙（HTTP 429）：服务商还在处理上一个请求，请过一会儿再试（试用接口通常同时只允许一个任务）",
      );
    }
    const detail = await extractProviderError(response);
    throw new Error(`模型接口返回 HTTP ${response.status}${detail === null ? "" : `：${detail}`}`);
  }
  if (response.body === null) {
    clearTimeout(hardTimer);
    clearTimeout(idleTimer);
    throw new Error("模型服务未返回流式数据");
  }

  let accumulated = "";
  let accumulatedReasoning = "";
  let sawReasoning = false;
  try {
    await readSseStream(response, (delta) => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), idleMs);
      if (delta.reasoning !== "") {
        if (!sawReasoning) {
          sawReasoning = true;
          handlers.onReasoningStart?.();
        }
        accumulatedReasoning += delta.reasoning;
        handlers.onReasoning?.(accumulatedReasoning);
      }
      if (delta.content !== "") {
        accumulated += delta.content;
        handlers.onContent(accumulated);
      }
    });
  } catch (error) {
    clearTimeout(hardTimer);
    clearTimeout(idleTimer);
    // 外部取消：不要把已收到的半截内容当成功返回，也不当失败提示
    if (signal?.aborted) throw new AiCancelledError();
    if (error instanceof DOMException && error.name === "AbortError") {
      // 已经收到部分内容时按成功截断处理，比整份丢弃更可用
      if (accumulated.trim() !== "") return accumulated;
      throw new Error(
        Date.now() - startedAt >= timeoutMs
          ? `生成超时：模型响应超过 ${Math.round(timeoutMs / 60000)} 分钟未完成，请稍后重试或换用更快的模型`
          : "连接中断：模型服务长时间没有返回数据，请检查网络后重试",
      );
    }
    throw error;
  }
  clearTimeout(hardTimer);
  clearTimeout(idleTimer);

  if (accumulated.trim() === "") {
    throw new Error("模型接口返回了空内容");
  }
  return accumulated;
}

/** 从 SSE 响应流中逐块解析 OpenAI 兼容的 delta（content / reasoning_content），[DONE] 结束 */
async function readSseStream(
  response: Response,
  onDelta: (delta: { content: string; reasoning: string }) => void,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice("data:".length).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string; reasoning_content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta;
          onDelta({
            content: typeof delta?.content === "string" ? delta.content : "",
            reasoning:
              typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "",
          });
        } catch {
          // 忽略解析失败的碎块（多行 JSON 被切分等），不影响后续块
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/** OpenAI 兼容 GET /models 的最小响应结构 */
interface ModelsResponse {
  data?: { id?: string }[];
}

/**
 * 拉取服务商的模型列表（OpenAI 兼容 GET /models）。
 * 需要有效的 baseUrl 与 apiKey；返回去重排序后的模型 id 数组。
 */
export async function listModels(
  config: AiProviderConfig,
  timeoutMs: number = 15000,
): Promise<string[]> {
  // 拉取模型列表只依赖服务地址和 Key；模型名为空正是需要刷新列表的常见场景
  if (config.baseUrl.trim() === "" || config.apiKey.trim() === "") {
    throw new Error("刷新模型前请填写服务地址与 API Key");
  }

  const base = config.baseUrl.trim().replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("获取模型列表超时，请稍后重试");
    }
    throw new Error("网络请求失败：无法连接模型服务");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await extractProviderError(response);
    throw new Error(
      `获取模型列表失败：HTTP ${response.status}${detail === null ? "" : `：${detail}`}`,
    );
  }

  const parsed = (await response.json()) as ModelsResponse;
  const ids = (Array.isArray(parsed.data) ? parsed.data : [])
    .map((entry) => (typeof entry?.id === "string" ? entry.id : ""))
    .filter((id) => id.trim() !== "");
  if (ids.length === 0) {
    throw new Error("服务商返回的模型列表为空");
  }
  return [...new Set(ids)].sort();
}

/** 尽力从错误响应里解析服务商的 error.message（OpenAI 兼容错误结构） */
async function extractProviderError(response: Response): Promise<string | null> {
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed !== "object" || parsed === null) return null;
    const error = (parsed as Record<string, unknown>).error;
    if (typeof error !== "object" || error === null) return null;
    const message = (error as Record<string, unknown>).message;
    return typeof message === "string" && message.trim() !== "" ? message : null;
  } catch {
    return null;
  }
}

/**
 * 抓取文本（JSON / XML 通用），带超时。
 * 仅供公开资讯页使用；带鉴权的请求禁止走此函数。
 */
export async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 抓取公开资讯文本：Tauri 内优先走系统网络，不受 RSS 站点 CORS 限制；
 * 前端单独调试时仍用浏览器直连，最后才尝试公共转发。此通道不携带任何鉴权信息。
 */
export async function fetchPublicText(url: string, timeoutMs: number): Promise<string> {
  if (isTauri()) {
    try {
      return await tauriBridge.invoke<string>("fetch_public_text", { url, timeoutMs });
    } catch {
      // 系统通道失败时继续尝试浏览器直连，避免单一路径故障阻断资讯
    }
  }
  try {
    return await fetchText(url, timeoutMs);
  } catch {
    return await fetchText(`${CORS_RELAY_RAW_URL}${encodeURIComponent(url)}`, timeoutMs);
  }
}
