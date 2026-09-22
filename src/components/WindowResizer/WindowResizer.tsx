// 职责：无边框窗口（decorations:false）的窗口级缩放手柄。
// Tauri 不接管无边框窗口的鼠标边框缩放，原生 resize 手势缺失，
// 所以自绘 8 向（四边 + 四角）手柄：pointerdown 时委托给宿主的
// startResizeDragging，由 OS 接管缩放（自动处理边缘定位与 min 约束），
// 比手写鼠标位移 + setSize 稳，且不需要自己算窗口新坐标。
// 纯 Vite（npm run dev，无 Rust 宿主）下窗口本就由浏览器原生缩放，不渲染手柄。

import { type PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/bridge";
import styles from "./WindowResizer.module.css";

/** Tauri 缩放方向。库内 `ResizeDirection` 仅本地声明未导出，这里按同款字面值复刻；
 *  传给 startResizeDragging 时字面量集合一致，TS 结构性兼容。 */
type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

/** 八个方向的命中区：Tauri 缩放语义 → 对应样式类（定位与光标） */
const HANDLES: { direction: ResizeDirection; className: string }[] = [
  { direction: "North", className: styles.north },
  { direction: "South", className: styles.south },
  { direction: "East", className: styles.east },
  { direction: "West", className: styles.west },
  { direction: "NorthEast", className: styles.northEast },
  { direction: "NorthWest", className: styles.northWest },
  { direction: "SouthEast", className: styles.southEast },
  { direction: "SouthWest", className: styles.southWest },
];

export function WindowResizer() {
  // 非宿主环境（npm run dev）不渲染：浏览器窗口自带原生缩放，手柄反而碍事
  if (!isTauri()) return null;

  const startResize =
    (direction: ResizeDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
      // 拦住冒泡与默认：手柄压在标题栏（drag-region）与内容之上，
      // 不拦会触发窗口拖动或文本选择，吞掉缩放手势。
      event.preventDefault();
      event.stopPropagation();
      void getCurrentWindow().startResizeDragging(direction);
    };

  return (
    <div className={styles.layer}>
      {HANDLES.map((handle) => (
        <div
          key={handle.direction}
          className={`${styles.handle} ${handle.className}`}
          onPointerDown={startResize(handle.direction)}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
