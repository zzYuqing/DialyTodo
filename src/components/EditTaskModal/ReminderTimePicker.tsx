// 职责：提醒时间的滚轮选择器（小时 00-23、分钟 00-59，各只滚一遍，不循环）。
// 设计要点：
// - 取代原生 <input type="time">：WebView2 的原生时间滚轮会无限循环，无法关闭循环，
//   这里用自绘滚轮把位置 clamp 在 [0, 末尾]，到边界即停；
// - 收起态是一个可直接键盘输入的时间框（支持 "9:30" / "0930" / "9" 等写法），
//   获得焦点或点击后从下方弹出滚轮浮层，两种改法互不冲突；
//   输入在失焦 / 回车时解析提交（解析失败回退原值），Esc 放弃；
// - 滚轮首尾各垫两行空白：选中项始终对齐中间高亮行，滚到尽头不会出现"高亮区空白"；
// - 交互：指针拖动 / 滚轮 / 方向键三种方式，松手（或滚轮停顿）后吸附到最近整行并提交；
// - 提交只在吸附时发生，拖动过程中不触发 onChange，避免父组件反复渲染；
// - 位置用「浮点行号」驱动渲染，拖到边界外会被 clamp 住，天然形成「只有一遍」的手感。

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Input, Popover } from "@mantine/core";
import { ClockIcon } from "@/components/Icons";
import styles from "./ReminderTimePicker.module.css";

/** 单行高度与可见行数：5 行 = 选中行上下各两行 */
const ITEM_H = 28;
const VISIBLE_ROWS = 5;
/** 首尾垫行数：让选中项始终对齐中间高亮行（(VISIBLE_ROWS - 1) / 2） */
const PAD_ROWS = 2;

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

interface ReminderTimePickerProps {
  label: string;
  /** "HH:mm" */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** 单列滚轮。items 只渲染一遍，位置 clamp 在 [0, items.length-1]，不循环。 */
interface WheelColumnProps {
  items: string[];
  index: number;
  /** 鼠标滚轮一格的步进（行数）：小时列 1、分钟列 5 */
  step: number;
  onIndexChange: (index: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}

function WheelColumn({ items, index, step, onIndexChange, disabled, ariaLabel }: WheelColumnProps) {
  const maxIndex = items.length - 1;
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startPos: number } | null>(null);
  /** 本次手势是否移动过：pointerup 先于 click 触发，dragRef 已清空，
      所以「是否误触」要靠这个 ref 在 click 时回读 */
  const movedRef = useRef(false);
  /** 位置（浮点行号）：唯一事实来源放 ref，state 只用于驱动渲染 */
  const [pos, setPosState] = useState(index);
  const posRef = useRef(pos);
  /** 吸附/键盘操作时给位移加过渡，拖动与滚轮过程中不加（否则会拖泥带水） */
  const [smooth, setSmooth] = useState(true);
  /** 滚轮停顿后吸附的定时器 */
  const wheelTimerRef = useRef<number>(0);

  const setPos = (next: number) => {
    posRef.current = next;
    setPosState(next);
  };
  const clamp = (v: number) => Math.min(maxIndex, Math.max(0, v));

  /** 回调过 ref 转发：原生滚轮监听只在 [disabled, maxIndex] 变化时重建，
      若直接捕获 onIndexChange，会拿到父组件渲染早期的旧闭包（闭包里的"另一个下标"已过期，
      提交时会把它覆盖回去） */
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  });

  /** 吸附到最近整行并提交。onChange 总是提交吸附结果（父组件是 setState，
      同值字符串会直接 bail out），避免闭包里捕获到过期的 index 造成漏报 */
  const commit = () => {
    const snapped = clamp(Math.round(posRef.current));
    setSmooth(true);
    setPos(snapped);
    onIndexChangeRef.current(snapped);
  };

  // 外部值变化（新建重置 / 编辑回填）时同步滚轮位置；拖动中不同步，避免抢位置
  useEffect(() => {
    if (!dragRef.current) {
      setSmooth(true);
      setPos(index);
    }
  }, [index]);

  // 滚轮：原生监听 + passive:false 才能 preventDefault（React 的合成 onWheel 是 passive 的，
  // 不拦截的话滚动会穿透给模态层）。deltaY 按 ~100/格归一化后乘以步进（小时 1、分钟 5），
  // 边界 clamp，停顿 140ms 后吸附。
  useEffect(() => {
    const el = rootRef.current;
    if (!el || disabled) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      window.clearTimeout(wheelTimerRef.current);
      setSmooth(false);
      const next = clamp(posRef.current + (e.deltaY / 100) * step);
      setPos(next);
      wheelTimerRef.current = window.setTimeout(commit, 140);
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheelNative);
      window.clearTimeout(wheelTimerRef.current);
    };
  }, [disabled, maxIndex, step]);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    window.clearTimeout(wheelTimerRef.current);
    dragRef.current = { startY: e.clientY, startPos: posRef.current };
    movedRef.current = false;
    setSmooth(false);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaY = e.clientY - drag.startY;
    if (Math.abs(deltaY) > 4) movedRef.current = true;
    // 往上拖 = 往大行号走；clamp 后拖到边界即停（不循环）
    setPos(clamp(drag.startPos - deltaY / ITEM_H));
  };

  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    commit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSmooth(true);
      setPos(clamp(posRef.current + (e.key === "ArrowDown" ? 1 : -1)));
      commit();
    }
  };

  /** 点选某一行；刚拖完的手势不响应 click，避免松手时误选 */
  const handleItemClick = (i: number) => {
    if (disabled || movedRef.current) return;
    setSmooth(true);
    setPos(i);
    onIndexChangeRef.current(i);
  };

  return (
    <div
      ref={rootRef}
      className={styles.wheel}
      style={{ height: ITEM_H * VISIBLE_ROWS }}
      role="listbox"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      <div
        className={styles.wheelTrack}
        style={{
          transform: `translateY(${-pos * ITEM_H}px)`,
          transition: smooth ? "transform 150ms ease" : "none",
        }}
      >
        {/* 首尾垫行：列表只滚一遍，尽头没有更多项可显示，用垫行把窗口填满，
            保证选中项永远落在中间高亮行上（末尾不再是"高亮区空白"） */}
        {Array.from({ length: PAD_ROWS }, (_, i) => (
          <div key={`pad-top-${i}`} style={{ height: ITEM_H }} />
        ))}
        {items.map((text, i) => {
          const d = Math.abs(i - pos);
          return (
            <div
              key={text}
              className={styles.wheelItem}
              style={{
                height: ITEM_H,
                opacity: Math.max(0.25, 1 - d * 0.35),
                color: d < 0.5 ? "var(--dt-text)" : "var(--dt-text-muted)",
                fontWeight: d < 0.5 ? 600 : 400,
                transform: `scale(${1 - Math.min(d * 0.12, 0.25)})`,
              }}
              role="option"
              aria-selected={i === index}
              onClick={() => handleItemClick(i)}
            >
              {text}
            </div>
          );
        })}
        {Array.from({ length: PAD_ROWS }, (_, i) => (
          <div key={`pad-bottom-${i}`} style={{ height: ITEM_H }} />
        ))}
      </div>
      {/* 选中行指示条：压在中间行上，只画上下描边 */}
      <div className={styles.wheelHighlight} style={{ height: ITEM_H, top: ITEM_H * 2 }} />
    </div>
  );
}

/** "HH:mm" 拆成两个下标；解析失败回退 0，越界 clamp */
function parseTime(value: string): { hour: number; minute: number } {
  const [hh, mm] = value.split(":");
  const hour = Number.parseInt(hh ?? "", 10);
  const minute = Number.parseInt(mm ?? "", 10);
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 0,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0,
  };
}

/** 键盘输入的解析：只取数字（冒号/空格/中文冒号都容忍）。
    1-2 位 = 小时（如 "9"），3 位 = 小时+分钟（"930" → 9:30），4 位 = 时分（"0930"）；
    越界 clamp（25 → 23、61 → 59）；完全解析不出返回 null，调用方回退原值 */
function parseTypedTime(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 4) return null;
  let hour: number;
  let minute: number;
  if (digits.length <= 2) {
    hour = Number.parseInt(digits, 10);
    minute = 0;
  } else if (digits.length === 3) {
    hour = Number.parseInt(digits[0], 10);
    minute = Number.parseInt(digits.slice(1), 10);
  } else {
    hour = Number.parseInt(digits.slice(0, 2), 10);
    minute = Number.parseInt(digits.slice(2), 10);
  }
  hour = Math.min(23, Math.max(0, hour));
  minute = Math.min(59, Math.max(0, minute));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function ReminderTimePicker({ label, value, onChange, disabled }: ReminderTimePickerProps) {
  const { hour, minute } = parseTime(value);
  const [opened, setOpened] = useState(false);
  /** 键盘输入中的草稿；null = 未在编辑，直接显示 value */
  const [draft, setDraft] = useState<string | null>(null);

  /** 提交草稿：解析成功才写入，解析失败视为放弃（回退原值）；随后清空草稿 */
  const commitDraft = () => {
    if (draft !== null) {
      const parsed = parseTypedTime(draft);
      if (parsed !== null) onChange(parsed);
    }
    setDraft(null);
  };

  return (
    <Input.Wrapper label={label} className={styles.wrapper}>
      {/* zIndex 高于模态层（200），否则弹层会压在编辑弹窗下面 */}
      <Popover
        opened={opened && !disabled}
        onChange={setOpened}
        position="bottom-start"
        offset={4}
        radius="md"
        shadow="md"
        zIndex={300}
      >
        <Popover.Target>
          {/* 收起态 = 可直接键盘输入的时间框；聚焦即弹出滚轮，两种改法互不冲突。
              失焦 / 回车提交输入（解析失败回退原值），Esc 放弃输入并关闭 */}
          <Input
            type="text"
            inputMode="numeric"
            placeholder="09:00"
            value={draft ?? value}
            disabled={disabled}
            onFocus={() => setOpened(true)}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
                setOpened(false);
              } else if (e.key === "Escape") {
                setDraft(null);
                setOpened(false);
              }
            }}
            rightSection={<ClockIcon size={14} />}
            rightSectionPointerEvents="none"
          />
        </Popover.Target>
        <Popover.Dropdown>
          <div className={styles.picker}>
            <WheelColumn
              items={HOURS}
              index={hour}
              step={1}
              onIndexChange={(i) => onChange(`${HOURS[i]}:${MINUTES[minute]}`)}
              disabled={disabled}
              ariaLabel="小时"
            />
            <span className={styles.colon}>:</span>
            <WheelColumn
              items={MINUTES}
              index={minute}
              step={5}
              onIndexChange={(i) => onChange(`${HOURS[hour]}:${MINUTES[i]}`)}
              disabled={disabled}
              ariaLabel="分钟"
            />
          </div>
        </Popover.Dropdown>
      </Popover>
    </Input.Wrapper>
  );
}
