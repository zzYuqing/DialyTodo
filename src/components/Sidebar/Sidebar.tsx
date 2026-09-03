// 职责：左侧 56px 窄侧栏，承担视图切换职责（DayView / MonthView / ArchiveView / SettingsView）。
// 设计要点：
// - 图标为主、文字为辅（hover 出现 tooltip 与 label）。
// - 当前选中项由 useViewStore.view 决定。
// - 阶段 3 不包含"贡献墙"，留作阶段 4 月视图内的一个子视图。

import { useViewStore } from "@/stores";
import type { ViewName } from "@/stores";
import styles from "./Sidebar.module.css";

interface TabDef {
  view: ViewName;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { view: "day", label: "今日", icon: "📅" },
  { view: "month", label: "月度", icon: "📊" },
  { view: "archive", label: "归档", icon: "🗄️" },
  { view: "settings", label: "设置", icon: "⚙️" },
];

export function Sidebar() {
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);

  return (
    <nav className={styles.sidebar} aria-label="视图切换">
      {TABS.map((tab) => {
        const active = tab.view === view;
        return (
          <button
            key={tab.view}
            type="button"
            className={`${styles.tab} ${active ? styles.active : ''}`}
            onClick={() => setView(tab.view)}
            aria-current={active ? "page" : undefined}
            title={tab.label}
          >
            <span className={styles.icon} aria-hidden="true">
              {tab.icon}
            </span>
            <span className={styles.label}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}