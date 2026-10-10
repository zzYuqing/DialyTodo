// 职责：可折叠备注 —— 当备注超过 maxLines 行时，折叠到 maxLines 行并给出「展开 / 收起」开关；
// 未超出的备注直接整段显示，不显示开关（避免无意义的展开按钮）。
//
// 两种视觉变体共用同一套截断 / 测量 / 展开逻辑（满足「同类问题同一套写法」）：
// - block：普通任务整块备注，折叠态按 N 行截断，下方给出「展开 / 收起」文字链接；
// - pill：子任务胶囊，折叠态是 80% 宽胶囊（N 行截断 + 箭头），展开态原地变圆角块。
//
// 截断用 -webkit-line-clamp（WebView2 / Chromium 支持）；溢出判定在挂载与容器宽度变化时
// 用 scrollHeight / clientHeight 实测，不依赖字符宽度启发式，行高 / 字号 / 容器宽度变化都能正确识别。

import { memo, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronRightIcon, NoteIcon } from "@/components/Icons";
import styles from "./CollapsibleNote.module.css";

interface CollapsibleNoteProps {
  /** 备注文本（调用方保证非空） */
  text: string;
  /** 折叠态展示的最大行数，来自设置 noteCollapseLines */
  maxLines: number;
  /** block = 普通任务整块备注；pill = 子任务胶囊。两者共用同一套截断 / 测量逻辑。 */
  variant?: "block" | "pill";
}

export const CollapsibleNote = memo(function CollapsibleNote({
  text,
  maxLines,
  variant = "block",
}: CollapsibleNoteProps) {
  // 同一 ref 在 block 变体挂在 <div>、pill 变体挂在 <span>，故用 HTMLElement 公共基类型，挂接处按需收窄。
  const ref = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  // 备注是否「超过 maxLines 行」：折叠态实测得到，展开态保持不变（保证「收起」开关不至于消失）。
  const [overflowing, setOverflowing] = useState(false);

  // 折叠态实测是否溢出：line-clamp 截断后 scrollHeight（完整内容）> clientHeight（截断高）即溢出。
  // 用 ResizeObserver 监听文本容器宽度变化（窗口缩放 / 展开区宽度变化都会改变换行行数），重新测量，
  // 保证阈值始终按「实际渲染行数」而非字符数判断。
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const apply = () => {
      if (expanded) {
        // 展开态不截断：清掉行数限制，并保持 overflowing 不变（折叠判定仍为真，便于再次显示「收起」）。
        el.style.removeProperty("-webkit-line-clamp");
        return;
      }
      el.style.setProperty("-webkit-line-clamp", String(maxLines));
      // 读一次 clientHeight 触发重排，确保 line-clamp 已生效再量高度。
      void el.clientHeight;
      setOverflowing(el.scrollHeight - el.clientHeight > 1);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, maxLines, expanded]);

  if (variant === "pill") {
    return (
      <button
        type="button"
        className={`${styles.pill} ${expanded ? styles.pillOpen : ""}`}
        aria-expanded={expanded}
        aria-label={expanded ? "收起备注" : "展开备注"}
        disabled={!overflowing}
        onClick={() => overflowing && setExpanded((v) => !v)}
        // 阻止 pointerdown 冒泡到子任务行：否则会连带触发父列表的拖拽手势。
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className={styles.fieldIcon}>
          <NoteIcon size={11} />
        </span>
        <span
          ref={ref as RefObject<HTMLSpanElement>}
          className={`${styles.pillText} ${expanded ? styles.pillTextOpen : styles.pillTextClamped}`}
        >
          {text}
        </span>
        {overflowing && (
          <span className={`${styles.pillChevron} ${expanded ? styles.pillChevronOpen : ""}`}>
            <ChevronRightIcon size={10} />
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={styles.block}>
      <div
        ref={ref as RefObject<HTMLDivElement>}
        className={`${styles.blockText} ${expanded ? styles.blockTextOpen : styles.blockTextClamped}`}
      >
        {text}
      </div>
      {overflowing && (
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setExpanded((v) => !v)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  );
});
