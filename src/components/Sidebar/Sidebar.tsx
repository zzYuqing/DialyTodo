// 职责：左侧 56px 窄侧栏，承担视图切换职责（TodoView / ArchiveView / SettingsView）。
// 设计要点：
// - 图标为主、文字为辅（hover 出现 tooltip 与 label）。
// - 当前选中项由 useViewStore.view 决定。
// - 日视与月视已合并为 Todo 单页，日历导航由该页左栏的「月历化贡献墙」承担，侧栏不再分两个 Tab。
// - 贡献墙已并入 Todo 页左栏（views/TodoView/CalendarRail），不再作为独立常驻组件。

import type { ComponentType } from "react";
import { useViewStore } from "@/stores";
import type { ViewName } from "@/stores";
import { ArchiveIcon, SettingsIcon, TodoIcon } from "@/components/Icons";
import styles from "./Sidebar.module.css";

interface TabDef {
  view: ViewName;
  label: string;
  /** 单色线性图标组件，颜色跟 currentColor 走 */
  icon: ComponentType<{ size?: number }>;
}

const TABS: TabDef[] = [
  { view: "todo", label: "Todo", icon: TodoIcon },
  { view: "archive", label: "归档", icon: ArchiveIcon },
  { view: "settings", label: "设置", icon: SettingsIcon },
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
              <tab.icon size={18} />
            </span>
            <span className={styles.label}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}