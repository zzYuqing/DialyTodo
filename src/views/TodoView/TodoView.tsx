// 职责：Todo 页容器 —— 左贡献栏 + 右日视图的分栏工作台（阶段 4 布局定版）。
// 设计要点：
// - 页面标题恒为选中日期：‹ › 翻天（改 selectedDate），今天按钮回跳（已在今天时禁用）；
// - 左栏 CalendarRail 承担全部日历职责（月/年两种粒度的「月历化贡献墙」导航），
//   右侧 DayMode 永远展示 selectedDate 的单日清单 —— 没有日/月模式切换；
// - AddTaskFab 在右栏内（DayMode 挂载），新建、编辑、删除等完整交互都在右栏完成。

import { addDaysToKey, calcDayCompletion, formatDateLabel, todayKey } from "@/lib";
import { useTaskStore, useViewStore } from "@/stores";
import { useWorkdayChecker } from "@/hooks";
import { CalendarRail } from "./CalendarRail/CalendarRail";
import { DayMode } from "./DayMode";
import styles from "./TodoView.module.css";

export function TodoView() {
  const tasks = useTaskStore((s) => s.tasks);

  const selectedDate = useViewStore((s) => s.selectedDate);
  const setSelectedDate = useViewStore((s) => s.setSelectedDate);

  const isWorkday = useWorkdayChecker([selectedDate]);

  const isToday = selectedDate === todayKey();
  const completion = calcDayCompletion(tasks, selectedDate, isWorkday);

  const statsLine = `${isToday ? "今日" : "共"} ${completion.total} 项，已完成 ${completion.done}`;

  const goPrev = () => setSelectedDate(addDaysToKey(selectedDate, -1));
  const goNext = () => setSelectedDate(addDaysToKey(selectedDate, 1));
  const goToday = () => setSelectedDate(todayKey());

  return (
    <section className={styles.view}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <button
            type="button"
            className={styles.navButton}
            onClick={goPrev}
            title="前一天"
          >
            ‹
          </button>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{formatDateLabel(selectedDate)}</h1>
            <p className={styles.context}>{statsLine}</p>
          </div>
          <button
            type="button"
            className={styles.navButton}
            onClick={goNext}
            title="后一天"
          >
            ›
          </button>
          <button
            type="button"
            className={styles.textButton}
            onClick={goToday}
            disabled={isToday}
            title={isToday ? "已是今天" : undefined}
          >
            今天
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <CalendarRail />
        <DayMode />
      </div>
    </section>
  );
}
