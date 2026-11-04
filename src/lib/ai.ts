// 职责：AI 返回值的容错解析（纯函数，无网络依赖）。
// 模型偶尔会把 JSON 包进 ```json 代码块、或在前后加一句解释，这里统一剥掉再取第一个对象。
// 行业初审、模板初审等「让模型只回 JSON」的调用共用这一份实现，不要各写一套。

/**
 * 从模型返回的文本里取出一个 JSON 对象。
 * 取不到对象或 JSON 非法时抛错，operation 用于组装「AI 初审结果无法识别」这类提示文案。
 */
export function parseAiObject(content: string, operation: string): Record<string, unknown> {
  const fenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`AI ${operation}结果无法识别，请重试`);
  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`AI ${operation}结果不是有效 JSON，请重试`);
  }
}
