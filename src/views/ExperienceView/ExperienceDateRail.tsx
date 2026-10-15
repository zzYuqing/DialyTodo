// 职责：经验页左侧导航。扁平单级列表：按时间倒序排列的经验标题行。
// 标题是唯一扫视元素（写经验时先想起的是「做了什么」），不显示日期。
// 点标题定位单条（右侧展示该条），不做日期筛选；分类与搜索筛选由上层完成。
// 只列「有经验记录的条目」（与贡献墙不同，不做完整月历）。

import type { Experience } from "@/types";
import styles from "./ExperienceView.module.css";

interface ExperienceDateRailProps {
  /** 已按分类 + 搜索过滤的经验全集 */
  experiences: Experience[];
  /** 取分类主题色，缺失时用中性灰 */
  colorOf: (categoryId: string) => string | undefined;
  selectedId: string | null;
  onSelectExperience: (id: string) => void;
}

export function ExperienceDateRail({
  experiences,
  colorOf,
  selectedId,
  onSelectExperience,
}: ExperienceDateRailProps) {
  // 全量按时间倒序：日期新的在前，同日按更新时间倒序
  const sorted = [...experiences].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : a.updatedAt < b.updatedAt ? 1 : -1,
  );

  return (
    <nav className={styles.rail} aria-label="经验列表">
      <div className={styles.railEntries}>
        {sorted.map((e) => (
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
    </nav>
  );
}
