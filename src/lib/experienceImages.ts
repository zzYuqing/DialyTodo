// 职责：解析经验正文（Markdown）里的图片引用，供「上传 md」时自动修复失效路径。
// 只做纯字符串处理，不碰文件系统——是否存在由调用方（编辑器）去查，本模块不负责任何 IO。
//
// 引用分类（决定是否需要修复）：
// - external：http(s) / data / ftp / mailto，交给浏览器按网络资源处理
// - absolute：Windows 盘符路径、/ 开头的 POSIX 路径、\\ 共享、file://
//   —— 用户明确要求：绝对路径不修（原样保留，信任其指向）
// - relative：其余一律视为相对路径，需按 md 所在目录解析；解析不到才算失效
//
// 去重口径：同一相对路径字符串在正文里出现多次时，只让用户指定一次，
// 命中后全文替换——这是「相同相对路径只需指定一次」的实现依据。

import { EXPERIENCE_ATTACHMENTS_DIR } from "@/constants";

export type ImageRefKind = "external" | "absolute" | "relative";

export interface ImageRef {
  /** md 里原始的图片地址字符串（用于替换） */
  raw: string;
  kind: ImageRefKind;
}

/** 行内图片 ![alt](src "title") —— 括号里可能带 <> 包裹与可选标题 */
const INLINE_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;

/** 引用式定义行 [id]: src（行首最多 3 空格缩进） */
const REF_DEFINITION = /^[ ]{0,3}\[([^\]]+)\]:\s*(\S+)/gm;

/** 引用式图片使用 ![alt][id] */
const REF_IMAGE_USE = /!\[[^\]]*\]\[([^\]]+)\]/g;

/** 简写引用式图片 ![id][] */
const REF_IMAGE_SHORTCUT = /!\[([^\]]+)\]\[\]/g;

function classify(raw: string): ImageRefKind {
  if (/^(?:https?:|data:|ftp:|mailto:)/i.test(raw)) return "external";
  // Windows 盘符 C:\ 或 C:/、POSIX 根 /、UNC \\、file:// —— 都算绝对路径，不修
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/|file:)/i.test(raw)) return "absolute";
  return "relative";
}

/**
 * 提取正文里所有图片引用（行内 + 引用式定义）。
 * 引用式只收录「确实被图片语法使用」的定义，避免把普通链接定义也当图片改掉。
 */
export function extractImageRefs(md: string): ImageRef[] {
  const raws: string[] = [];

  for (const match of md.matchAll(INLINE_IMAGE)) {
    const src = match[1];
    if (src) raws.push(src);
  }

  // 引用式：先收集被图片使用的 id，再取其定义里的地址
  const usedIds = new Set<string>();
  for (const match of md.matchAll(REF_IMAGE_USE)) {
    if (match[1]) usedIds.add(match[1].toLowerCase());
  }
  for (const match of md.matchAll(REF_IMAGE_SHORTCUT)) {
    if (match[1]) usedIds.add(match[1].toLowerCase());
  }
  if (usedIds.size > 0) {
    for (const match of md.matchAll(REF_DEFINITION)) {
      const id = match[1];
      const src = match[2];
      if (id && src && usedIds.has(id.toLowerCase())) raws.push(src);
    }
  }

  return raws.map((raw) => ({ raw, kind: classify(raw) }));
}

/** 只取相对路径引用，并按 raw 去重（同一路径只修一次） */
export function relativeRefs(refs: ImageRef[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of refs) {
    if (ref.kind !== "relative") continue;
    if (seen.has(ref.raw)) continue;
    seen.add(ref.raw);
    out.push(ref.raw);
  }
  return out;
}

/** 统计每个相对路径在正文里出现的次数（弹窗里提示「影响 N 处」） */
export function countOccurrences(md: string, raw: string): number {
  return md.split(raw).length - 1;
}

/**
 * 把正文里所有等于 from 的图片地址替换为 to。
 * 直接按整串替换：同一相对路径的多处引用一次改全，也顺带覆盖引用式定义行。
 */
export function replaceImageRef(md: string, from: string, to: string): string {
  return md.split(from).join(to);
}

/** 附件在 md 里的相对路径（相对数据根目录，数据目录迁移后仍可解析） */
export function attachmentMarkdownPath(expId: string, storedName: string): string {
  return `${EXPERIENCE_ATTACHMENTS_DIR}/${expId}/${storedName}`;
}

/** 该地址是否是本应用附件目录内的相对路径（渲染时据此解析成本地文件） */
export function isAttachmentMarkdownPath(src: string): boolean {
  return src.startsWith(`${EXPERIENCE_ATTACHMENTS_DIR}/`);
}
