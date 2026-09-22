// 职责：经验页左侧导航。两级结构：月分组 → 日期行 → 该日期下的经验标题行。
// 层级理由：检索记忆是「先想起大概什么时候、再认标题」，日期作锚点保留为可点击的分组，
// 标题挂在其下供扫视。点日期行筛选整日，点标题行定位单条（右侧滚动 + 高亮）。
// 只列「有经验记录的日期」（与贡献墙不同，不做完整月历）；数据已由上层按分类过滤。

import type { Experience } from "@/types";
import styles from "./ExperienceView.module.css";

interface ExperienceDateRailProps {
  /** 已按分类过滤、未经日期过滤的经验全集 */
  experiences: Experience[];
  /** 取分类主题色，缺失时用中性灰 */
  colorOf: (categoryId: string) => string | undefined;
  selectedDate: string | null;
  selectedId: string | null;
  onSelectDate: (date: string | null) => void;
  onSelectExperience: (id: string) => void;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function dayLabel(dateKey: string): string {
  const parts = dateKey.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function weekdayOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return WEEKDAYS[d.getDay()];
}

interface MonthGroup {
  year: number;
  month: number;
  days: string[];
}

/** 按 年-月 分组（月倒序：最新在上；月内日期倒序：最新在上） */
function groupByMonth(entriesOfDate: Map<string, Experience[]>): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const key of [...entriesOfDate.keys()].sort().reverse()) {
    const bucket = key.slice(0, 7); // YYYY-MM
    const [y, m] = bucket.split("-");
    const group = groups.get(bucket) ?? {
      year: Number(y),
      month: Number(m),
      days: [],
    };
    group.days.push(key);
    groups.set(bucket, group);
  }
  return [...groups.values()];
}

export function ExperienceDateRail({
  experiences,
  colorOf,
  selectedDate,
  selectedId,
  onSelectDate,
  onSelectExperience,
}: ExperienceDateRailProps) {
  // 日期 → 该日期下的经验（组内按更新时间倒序），顺带得到计数
  const entriesOfDate = new Map<string, Experience[]>();
  for (const e of experiences) {
    const bucket = entriesOfDate.get(e.date);
    if (bucket) bucket.push(e);
    else entriesOfDate.set(e.date, [e]);
  }
  for (const bucket of entriesOfDate.values()) {
    bucket.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  const total = experiences.length;
  const groups = groupByMonth(entriesOfDate);

  return (
    <nav className={styles.rail} aria-label="经验日期">
      <button
        type="button"
        className={`${styles.railAll} ${selectedDate === null ? styles.railItemActive : ""}`}
        onClick={() => onSelectDate(null)}
      >
        <span>全部</span>
        <span className={styles.railCount}>{total}</span>
      </button>

      {groups.map((g) => (
        <div key={`${g.year}-${g.month}`} className={styles.railGroup}>
          <div className={styles.railGroupTitle}>
            {g.year}年{g.month}月
          </div>
          {g.days.map((day) => {
            const entries = entriesOfDate.get(day) ?? [];
            return (
              <div key={day} className={styles.railDayBlock}>
                <button
                  type="button"
                  className={`${styles.railItem} ${day === selectedDate ? styles.railItemActive : ""}`}
                  onClick={() => onSelectDate(day)}
                >
                  <span className={styles.railDay}>{dayLabel(day)}</span>
                  <span className={styles.railWeek}>周{weekdayOf(day)}</span>
                  <span className={styles.railCount}>{entries.length}</span>
                </button>
                <div className={styles.railEntries}>
                  {entries.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className={`${styles.railEntry} ${e.id === selectedId ? styles.railEntryActive : ""}`}
                      onClick={() => onSelectExperience(e.id)}
                      title={e.title}
                    >
                      <span
                        className={styles.railEntryDot}
                        style={{ background: colorOf(e.category) ?? "var(--dt-text-muted)" }}
                      />
                      <span className={styles.railEntryTitle}>{e.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
