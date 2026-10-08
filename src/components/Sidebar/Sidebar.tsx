// 职责：左侧 56px 窄侧栏，承担视图切换职责（TodoView / 长期任务 / SettingsView）。
// 设计要点：
// - 图标为主、文字为辅（hover 出现 tooltip 与 label）。
// - 当前选中项由 useViewStore.view 决定。
// - 日历导航由 Todo 页左栏的「月历化贡献墙」承担（views/TodoView/CalendarRail）。

import type { ComponentType } from "react";
import { useViewStore } from "@/stores";
import type { ViewName } from "@/stores";
import {
  ExperienceIcon,
  LongTermIcon,
  SettingsIcon,
  TodoIcon,
  ToolsIcon,
  TrashIcon,
} from "@/components/Icons";
import styles from "./Sidebar.module.css";

interface TabDef {
  view: ViewName;
  label: string;
  /** 单色线性图标组件，颜色跟 currentColor 走 */
  icon: ComponentType<{ size?: number }>;
}

const TABS: TabDef[] = [
  { view: "todo", label: "Todo", icon: TodoIcon },
  { view: "experience", label: "经验", icon: ExperienceIcon },
  { view: "longterm", label: "长期", icon: LongTermIcon },
  { view: "tools", label: "工具", icon: ToolsIcon },
  { view: "trash", label: "回收站", icon: TrashIcon },
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