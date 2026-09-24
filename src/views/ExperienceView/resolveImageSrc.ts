// 职责：把 md 里的图片地址解析成 WebView 能加载的 URL。
// Tauri 2 里本地文件必须经 convertFileSrc 转成 asset 协议 URL 才能显示，直接用磁盘路径不加载。
// 本项目 ACL schema 中没有 asset 权限项，说明该协议无需额外授权即可使用。
// 编辑器预览与经验卡片共用同一套解析，保证「预览所见 = 卡片所得」。

import { convertFileSrc } from "@tauri-apps/api/core";
import { isAttachmentMarkdownPath } from "@/lib";

/**
 * @param src md 里的图片地址
 * @param root 数据根目录；为 null（首次解析未完成）时附件相对路径原样返回
 */
export function resolveImageSrc(src: string | undefined, root: string | null): string | undefined {
  if (!src) return src;
  // 网络资源与内嵌数据直接放行
  if (/^(?:https?:|data:|blob:|file:)/i.test(src)) return src;
  // 附件目录内的相对路径 → 拼数据根目录后转 asset URL
  if (isAttachmentMarkdownPath(src) && root) {
    return convertFileSrc(`${root}/${src}`);
  }
  // 绝对路径（Windows 盘符 / UNC）→ 直接转 asset URL
  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(src)) {
    return convertFileSrc(src);
  }
  // 其余（未修复的相对路径）原样返回，浏览器会显示为裂图
  return src;
}
