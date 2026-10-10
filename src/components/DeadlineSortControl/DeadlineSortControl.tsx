// 职责：通用的「排序」入口控件（主页头部 + 任务集展开区两处共用）。
// 单击按钮 → 浮出 6 个扁平选项（3 维度 × 2 方向），由用户显式选择、不自动翻转：
//   按截止日期：近→远 / 按截止日期：远→近 / 按名称：A→Z / 按名称：Z→A /
//   按创建时间：早→晚 / 按创建时间：晚→早。
// 「按截止」维度若存在无截止期的条目，选完方向后再追问「置顶 / 置底」；
// 带截止期条目不足两条时，「按截止」两项单独置灰（该维度排不了），其余维度不受影响。
// 整颗按钮的禁用（范围内未完成项不足两条）由父组件按 disabled 传入。
//
// 排序本身不在此完成 —— 只把用户确定的 (dimension, direction, noDatePolicy) 回调给父组件，
// 由父组件调用既有的 reorderTasks / reorderSubtasks 落盘，保证顺序只有一套来源。
//
// 两种变体：
// - header：头部胶囊，与「今天」按钮同款描边胶囊，浮层向下、右对齐；
// - inline：展开区透明轻量，与「添加子任务」同款，浮层向上展开（避免盖住下方任务卡）。

import { useEffect, useRef, useState } from "react";
import { Button, Modal, Stack } from "@mantine/core";
import { SortIcon } from "@/components/Icons";
import type { NoDatePolicy, SortDimension, SortDirection } from "@/lib";
import styles from "./DeadlineSortControl.module.css";

interface DeadlineSortControlProps {
  /** 头部胶囊样式（与「今天」同款）或展开区透明轻量样式（与「添加子任务」同款） */
  variant?: "header" | "inline";
  /** 整颗按钮置灰：范围内未完成项不足两条（没得排）时由父组件传入 */
  disabled?: boolean;
  /** 「按截止」维度是否可用：带截止期的条目 ≥ 2 时为 true；false 时该维度两项置灰 */
  canSortByDeadline: boolean;
  /** 范围内是否存在无截止期的条目；为 true 时选「按截止」会追问置顶 / 置底 */
  hasUndated: boolean;
  /** 无截止期条目数量，仅用于追问弹窗的文案 */
  undatedCount: number;
  /** 用户确定维度 / 方向（及无截止期归位策略）后回调，由父组件落盘 */
  onSort: (dimension: SortDimension, direction: SortDirection, noDatePolicy: NoDatePolicy) => void;
}

/** 扁平 6 项：3 维度 × 2 方向；label 用完整句式「按 X：方向」，不加分组标题 */
const SORT_OPTIONS: { dimension: SortDimension; direction: SortDirection; label: string }[] = [
  { dimension: "deadline", direction: "asc", label: "按截止日期：近→远" },
  { dimension: "deadline", direction: "desc", label: "按截止日期：远→近" },
  { dimension: "name", direction: "asc", label: "按名称：A→Z" },
  { dimension: "name", direction: "desc", label: "按名称：Z→A" },
  { dimension: "created", direction: "asc", label: "按创建时间：早→晚" },
  { dimension: "created", direction: "desc", label: "按创建时间：晚→早" },
];

const ASC_ARROW = "M8 12V4M5 7l3-3 3 3";
const DESC_ARROW = "M8 4v8M5 9l3 3 3-3";

export function DeadlineSortControl({
  variant = "header",
  disabled = false,
  canSortByDeadline,
  hasUndated,
  undatedCount,
  onSort,
}: DeadlineSortControlProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{
    dimension: SortDimension;
    direction: SortDirection;
  } | null>(null);
  const [askNoDate, setAskNoDate] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击浮层外部关闭；浮层关闭后监听自动卸载，不影响弹窗
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const chooseOption = (dimension: SortDimension, direction: SortDirection) => {
    setOpen(false);
    // 仅「按截止」维度且存在无截止期条目时，才追问归位策略
    if (dimension === "deadline" && hasUndated) {
      setPending({ dimension, direction });
      setAskNoDate(true);
    } else {
      onSort(dimension, direction, "bottom");
    }
  };

  const chooseNoDate = (policy: NoDatePolicy) => {
    setAskNoDate(false);
    if (pending !== null) onSort(pending.dimension, pending.direction, policy);
    setPending(null);
  };

  const cancelNoDate = () => {
    setAskNoDate(false);
    setPending(null);
  };

  const triggerClass = variant === "header" ? styles.headerBtn : styles.inlineBtn;
  const triggerState = open && !disabled ? styles.active : "";
  const popoverClass = variant === "header" ? styles.popoverRight : styles.popoverUp;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${triggerClass} ${triggerState}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title="排序"
      >
        <SortIcon size={14} />
        <span>排序</span>
      </button>

      {open && !disabled && (
        <div className={`${styles.popover} ${popoverClass}`} role="menu">
          {SORT_OPTIONS.map((option) => {
            const blocked = option.dimension === "deadline" && !canSortByDeadline;
            return (
              <button
                key={`${option.dimension}-${option.direction}`}
                type="button"
                className={styles.item}
                role="menuitem"
                disabled={blocked}
                onClick={() => chooseOption(option.dimension, option.direction)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={option.direction === "asc" ? ASC_ARROW : DESC_ARROW} />
                </svg>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <Modal
        opened={askNoDate}
        onClose={cancelNoDate}
        title="无截止期条目"
        centered
        size="sm"
        padding="md"
        radius="md"
        closeOnEscape
        overlayProps={{ backgroundOpacity: 0.45, blur: 2 }}
        className={styles.modal}
      >
        <Stack gap="lg">
          <p className={styles.message}>
            {undatedCount} 项未设置截止期，按截止排序时你想把它们排在…
          </p>
          <div className={styles.actions}>
            <Button variant="default" onClick={() => chooseNoDate("bottom")} className={styles.actionBtn}>
              置底
            </Button>
            <Button variant="default" onClick={() => chooseNoDate("top")} className={styles.actionBtn}>
              置顶
            </Button>
          </div>
        </Stack>
      </Modal>
    </div>
  );
}
