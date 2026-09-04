// 职责：贡献栏·年粒度 —— 整年色块转置：7 列为周一~周日，每行为一周，
// 从旧到新向下排列（最新在最下面）（阶段 4 布局定版）。
// 设计要点：
// - 数据即 CalendarRail 传入的窗口序列，按 7 天切成周行（窗口起点为周一，天然对齐）；
// - 换月的那一行在行首标注月份（首行必标），行首为固定宽度标签列；
// - 初始滚动到底部（最新一周）；点击格子由 RailCell 统一处理（仅 setSelectedDate）。

import { useEffect, useMemo, useRef } from "react";
import { fromDateKey } from "@/lib";
import { RailCell } from "./RailCell";
import type { RailData } from "./CalendarRail";
import styles from "./YearRail.module.css";

/** 周一起始的星期表头，列顺序与窗口切片一致 */
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function YearRail({ days, completions }: RailData) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 按 7 天切成周行（末行截至今天，可能不足 7 天）
  const weeks = useMemo(() => {
    const result: string[][] = [];
    for (let index = 0; index < days.length; index += 7) {
      result.push(days.slice(index, index + 7));
    }
    return result;
  }, [days]);

  // 行首月份标签：该周首日所在月份与上一行不同（含首行）时标注
  const monthLabels = useMemo(() => {
    return weeks.map((week, index) => {
      const month = fromDateKey(week[0]).getMonth();
      if (index === 0) return `${month + 1}月`;
      const previous = fromDateKey(weeks[index - 1][0]).getMonth();
      return month === previous ? null : `${month + 1}月`;
    });
  }, [weeks]);

  // 最新在最下面：初始滚到底
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }, []);

  return (
    <div ref={scrollRef} className={styles.scroll}>
      <div className={styles.weekdays}>
        <span className={styles.weekday} />
        {WEEKDAY_LABELS.map((weekday) => (
          <span key={weekday} className={styles.weekday}>
            {weekday}
          </span>
        ))}
      </div>

      {weeks.map((week, index) => (
        <div key={week[0]} className={styles.week}>
          <span className={styles.monthLabel}>{monthLabels[index] ?? ""}</span>
          {week.map((dateKey) => (
            <RailCell key={dateKey} dateKey={dateKey} completion={completions[dateKey]} />
          ))}
          {/* 末行不足 7 天时补占位，保持 7 列网格 */}
          {Array.from({ length: 7 - week.length }, (_, padIndex) => (
            <span key={`pad-${padIndex}`} className={styles.pad} aria-hidden="true" />
          ))}
        </div>
      ))}
    </div>
  );
}
