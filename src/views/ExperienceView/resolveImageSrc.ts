// 职责：把 md 里的图片地址解析成 WebView 能加载的 URL。
// Tauri 2 里本地文件必须经 convertFileSrc 转成 asset 协议 URL 才能显示，直接用磁盘路径不加载。
// asset 协议 scope 已在 tauri.conf.json 配置（$APPDATA/** + **），自定义数据目录由
// authorize_dir 运行时加入，故本地路径均可正常转成 asset URL。
// 编辑器预览与经验卡片共用同一套解析，保证「预览所见 = 卡片所得」。

import { convertFileSrc } from "@tauri-apps/api/core";
import { isAttachmentMarkdownPath } from "@/lib";

/** 把 file:// URL 还原成磁盘路径（Windows 盘符 / POSIX 根路径） */
function fileUrlToPath(url: string): string | null {
  // file:///C:/path → C:/path；file:///path → /path
  const match = /^file:\/\/(?:\/)?([a-zA-Z]:\/.*)$/.exec(url);
  if (match) return match[1]!;
  const posix = /^file:\/\/(\/.*)$/.exec(url);
  if (posix) return posix[1]!;
  return null;
}

/**
 * @param src md 里的图片地址
 * @param root 数据根目录；为 null（首次解析未完成）时附件相对路径原样返回
 */
export function resolveImageSrc(src: string | undefined, root: string | null): string | undefined {
  if (!src) return src;
  // 网络资源与内嵌数据直接放行
  if (/^(?:https?:|data:|blob:)/i.test(src)) return src;
  // file:// URL：WebView 不直接加载，还原成磁盘路径后走 asset 协议
  if (/^file:/i.test(src)) {
    const path = fileUrlToPath(src);
    if (path) return convertFileSrc(path.replace(/\\/g, "/"));
    return src;
  }
  // 附件目录内的相对路径 → 拼数据根目录后转 asset URL
  if (isAttachmentMarkdownPath(src) && root) {
    // root 在 Windows 下含反斜杠，与 src 拼接会产生混合格式，统一归一化
    return convertFileSrc(`${root.replace(/\\/g, "/")}/${src.replace(/\\/g, "/")}`);
  }
  // 绝对路径（Windows 盘符 / UNC / POSIX 根）→ 直接转 asset URL
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(src)) {
    return convertFileSrc(src.replace(/\\/g, "/"));
  }
  // 其余（未修复的相对路径）原样返回，浏览器会显示为裂图
  return src;
}
