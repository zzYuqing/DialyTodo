// 职责：列表行的右键菜单浮层 —— 定位到鼠标点、越界自动翻转、点击外部 / Esc / 滚动即关。
// 为什么不引第三方菜单组件：本仓库不新增依赖，且菜单里有「添加到任务集」这种
// 需要自定义分组与打勾态的内容，自绘反而更短。
//
// 渲染走 createPortal 挂到 document.body：列表行在拖拽时会带 transform，
// 而 transform 会让 position: fixed 的包含块退化成该行本身，菜单会跟着行一起跑偏。

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "@/components/Icons";
import styles from "./RowContextMenu.module.css";

export interface ContextMenuItem {
  id: string;
  label: string;
  /** 行尾补充说明（如「当前所属」），无则省略 */
  hint?: string;
  disabled?: boolean;
  /** 打勾：用于标出「本行当前所属的任务集」 */
  checked?: boolean;
  /** 危险操作（删除）走红色 hover */
  danger?: boolean;
}

export interface ContextMenuGroup {
  title: string;
  items: ContextMenuItem[];
  /** items 为空时显示的占位文案 */
  empty?: string;
}

interface RowContextMenuProps {
  /** 触发点视口坐标（clientX / clientY） */
  x: number;
  y: number;
  groups: ContextMenuGroup[];
  /** 选中项的 id；由调用方按 id 约定分发 */
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** 与视口边缘保持的最小间距（px） */
const EDGE_GAP = 8;

/**
 * 「加入某个任务集」菜单项的 id 前缀，后面接任务集 id。
 * 两处列表行（日清单 / 长期页）共用同一个约定，各写一份迟早会对不上。
 */
export const ATTACH_ITEM_PREFIX = "attach:";

export function RowContextMenu({ x, y, groups, onSelect, onClose }: RowContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 先按鼠标点放一次，量出真实尺寸后再翻转；layout effect 里改不会闪
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const { width, height } = node.getBoundingClientRect();
    const maxX = window.innerWidth - width - EDGE_GAP;
    const maxY = window.innerHeight - height - EDGE_GAP;
    setPos({
      x: x > maxX ? Math.max(EDGE_GAP, maxX) : x,
      y: y > maxY ? Math.max(EDGE_GAP, maxY) : y,
    });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      // 菜单内部的按下不关闭：否则 window 上先把菜单卸掉，click 就永远收不到了
      if (ref.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const close = () => onClose();
    // 菜单自己滚（任务集多到超过 max-height）时不能关，只有外部滚动才关
    const onScroll = (event: Event) => {
      if (ref.current?.contains(event.target as Node) === true) return;
      onClose();
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    // 捕获阶段：列表滚动后菜单会脱离原行，直接关掉比跟着飘更不容易误点
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {groups.map((group) => (
        <div key={group.title} className={styles.group}>
          <div className={styles.groupTitle}>{group.title}</div>
          {group.items.length === 0 ? (
            <p className={styles.empty}>{group.empty ?? "无可用项"}</p>
          ) : (
            group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={[
                  styles.item,
                  item.disabled === true ? styles.disabled : "",
                  item.danger === true ? styles.danger : "",
                ]
                  .filter((name) => name !== "")
                  .join(" ")}
                disabled={item.disabled === true}
                onClick={() => onSelect(item.id)}
              >
                <span className={styles.check} aria-hidden="true">
                  {item.checked === true && <CheckIcon size={12} />}
                </span>
                <span className={styles.label}>{item.label}</span>
                {item.hint !== undefined && <span className={styles.hint}>{item.hint}</span>}
              </button>
            ))
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
