// 职责：贡献栏·月粒度 —— 选中年份（1-12 月）迷你月历竖排滚动。
// 设计要点：
// - 显示范围由顶部年份切换器（在 CalendarRail 顶栏）选定的年份决定，默认当前年；
// - 颜色仍来自父级传入的「近一年」完成数据（completions），窗口内当月有数据才上色，
//   未来月份（如今年 10-12 月）按未来日期透明占位；
// - 每个月只渲染当月日期（getMonthDays），周首尾用空白占位补齐，不补邻月溢出日；
// - 初始滚动到「今天所在月」；点击格子由 RailCell 统一处理（仅 setSelectedDate）。

import { useEffect, useMemo, useRef } from "react";
import { getMonthDays, toMonthKey, weekdayIndexOf } from "@/lib";
import { CONTRIBUTION_YEAR_MONTHS } from "@/constants";
import { RailCell } from "./RailCell";
import type { RailData } from "./CalendarRail";
import styles from "./MonthRail.module.css";

/** 周一起始的星期表头，列顺序与周一起始网格一致 */
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function MonthRail({
  completions,
  selectedYear,
}: RailData & {
  /** 年份切换器选中的年份（会话级 UI 状态，由 CalendarRail 持有；切换器 UI 也在 CalendarRail 顶栏） */
  selectedYear: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLElement>(null);

  // 今天所在自然月与年份（用于初始滚动定位与高亮），仅算一次
  const currentMonthKey = useMemo(() => toMonthKey(new Date()), []);
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  // 月份列表：选中年份的全部 12 个月（年份切换器控制 selectedYear）
  const months = useMemo(() => {
    const list: Date[] = [];
    for (let m = 0; m < CONTRIBUTION_YEAR_MONTHS; m += 1) {
      list.push(new Date(selectedYear, m, 1));
    }
    return list;
  }, [selectedYear]);

  // 初始定位：选中当年时把「今天所在月」滚进可视区顶部；切到其它年份则回到 1 月顶部。
  // scroll 自身 position:relative，section.offsetTop 即相对滚动容器的偏移。
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (selectedYear === currentYear && currentRef.current) {
      scroll.scrollTop = currentRef.current.offsetTop;
    } else {
      scroll.scrollTop = 0;
    }
  }, [selectedYear, currentYear]);

  const firstMonth = toMonthKey(months[0]);

  return (
    <div ref={scrollRef} className={styles.scroll}>
      {months.map((month) => {
        const year = month.getFullYear();
        const monthIndex = month.getMonth();
        const monthKey = toMonthKey(month);
        const monthDays = getMonthDays(year, monthIndex);
        const leading = weekdayIndexOf(monthDays[0]);
        // 1 月带年份，其余只标月份
        const label =
          monthIndex === 0 || monthKey === firstMonth
            ? `${year}年${monthIndex + 1}月`
            : `${monthIndex + 1}月`;

        return (
          <section
            key={monthKey}
            ref={monthKey === currentMonthKey ? currentRef : undefined}
            className={styles.monthBlock}
          >
            <h3 className={styles.monthLabel}>{label}</h3>
            <div className={styles.weekdays}>
              {WEEKDAY_LABELS.map((weekday) => (
                <span key={weekday} className={styles.weekday}>
                  {weekday}
                </span>
              ))}
            </div>
            <div className={styles.grid}>
              {/* 周首空白占位：仅占位对齐，不渲染邻月日期；末行不补，保持不完整 */}
              {Array.from({ length: leading }, (_, index) => (
                <span key={`lead-${index}`} className={styles.empty} aria-hidden="true" />
              ))}
              {monthDays.map((dateKey) => (
                <RailCell
                  key={dateKey}
                  dateKey={dateKey}
                  completion={completions[dateKey]}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
