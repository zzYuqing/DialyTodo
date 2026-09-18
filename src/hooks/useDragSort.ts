// 职责：列表拖拽排序的通用状态与手势处理（自绘，不依赖 HTML5 drag & drop）。
//
// 为什么自绘：WebView2 里原生拖拽会被窗口的文件拖放处理吃掉，dragstart 常常起不来。
// 用 Pointer Events 自绘更可靠，也方便限制"不能放进已完成区"。
//
// 用法：调用方负责渲染数组 items（只放**可排序**的那一段），把 listRef 挂到列表容器、
// 每行用 getHandle(index) 取句柄绑到 <li>。松手后本 hook 计算新顺序并回调 orderedIds。

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

/** 小于这个位移（px）视为点击而非拖拽，避免和 tick 交互抢手势 */
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  /** 起始行在可排序区间的序号 */
  from: number;
  /** 当前放置目标序号 */
  to: number;
  /** 起始 y 坐标（clientY） */
  startY: number;
  /** 跟随鼠标的垂直位移 */
  dy: number;
}

export interface DragSortItemHandle {
  /** 本行在可排序区间内的序号 */
  index: number;
  dragging: boolean;
  /** 插入指示线画在本行的上方还是下方，null 表示本行不是当前放置目标 */
  dropHint: "above" | "below" | null;
  /** 拖拽中本行跟随鼠标的垂直位移（px），非拖拽行为 0 */
  offsetY: number;
  /** 只转发按下事件，后续 move / up 由本 hook 在 window 上接管 */
  onPointerDown: (index: number, event: PointerEvent<HTMLElement>) => void;
}

/**
 * @param items 只含可排序元素的当前数组（已完成等不可拖动的不应放进来）
 * @param onCommit 松手后的新顺序（id 数组），已在本 hook 内完成 splice
 */
export function useDragSort<T extends { id: string }>(
  items: readonly T[],
  onCommit: (orderedIds: string[]) => void,
): {
  listRef: RefObject<HTMLUListElement>;
  drag: DragState | null;
  getHandle: (index: number) => DragSortItemHandle;
} {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // 用 ref 持有最新 items：window 上的监听只在 pointerdown 时绑一次，
  // 闭包里捕获的是那时的变量，读 ref 才能拿到松手时刻的正确数据。
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const listRef = useRef<HTMLUListElement>(null);
  const detachRef = useRef<(() => void) | null>(null);

  // 卸载时兜底摘监听，避免拖到一半组件消失导致 window 上残留 handler
  useEffect(() => () => detachRef.current?.(), []);

  const update = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  /** 用各行的实际矩形高度判定插入位置：比按固定行高估算稳，能兼容备注换行导致的行高不一 */
  const resolveDropIndex = (clientY: number, from: number): number => {
    const list = listRef.current;
    if (list === null) return from;
    const children = Array.from(list.children) as HTMLElement[];
    // 只考虑可排序区间内的行：已完成项即便渲染在后面也不参与放置
    const spans = children
      .slice(0, itemsRef.current.length)
      .map((node) => node.getBoundingClientRect());
    if (spans.length === 0) return from;

    // 直接用鼠标 Y 坐标作为放置判定基准。
    // 注意不能用 startRect.top + dy 之类的计算——getBoundingClientRect() 返回的是
    // transform 生效后的矩形，再加 dy 会导致偏移量翻倍（用户拖 2 格，计算以为拖了 4 格）。
    const draggedCenter = clientY;

    let target = from;
    for (let index = 0; index < spans.length; index += 1) {
      const rect = spans[index];
      if (rect === undefined) continue;
      const center = rect.top + rect.height / 2;
      if (draggedCenter < center) return index > from ? index - 1 : index;
      target = index;
    }
    return target;
  };

  const finish = (state: DragState) => {
    detachRef.current?.();
    detachRef.current = null;
    update(null);
    const { from, to } = state;
    if (from === to) return;
    const next = [...itemsRef.current];
    const moved = next.splice(from, 1)[0];
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onCommit(next.map((item) => item.id));
  };

  const handlePointerDown = (index: number, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const initial: DragState = { from: index, to: index, startY: event.clientY, dy: 0 };
    update(initial);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const current = dragRef.current;
      if (current === null) return;
      const dy = moveEvent.clientY - current.startY;
      const dragging = Math.abs(dy) >= DRAG_THRESHOLD_PX;
      update({ ...current, dy, to: dragging ? resolveDropIndex(moveEvent.clientY, current.from) : current.from });
    };

    const onUp = () => {
      const current = dragRef.current;
      if (current === null) return;
      if (Math.abs(current.dy) < DRAG_THRESHOLD_PX) {
        detachRef.current?.();
        detachRef.current = null;
        update(null);
        return;
      }
      finish(current);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    detachRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  };

  const getHandle = (index: number): DragSortItemHandle => {
    const current = drag;
    const dragging = current !== null && current.from === index;
    const isTarget = current !== null && current.to === index && current.from !== index;
    return {
      index,
      dragging,
      dropHint: !isTarget
        ? null
        : current !== null && current.to > current.from
          ? "below"
          : "above",
      offsetY: dragging && current !== null ? current.dy : 0,
      onPointerDown: handlePointerDown,
    };
  };

  return { listRef, drag, getHandle };
}
