// 职责：工具页主页 —— 左栏分类导航 + 右栏图标宫格（B 分类 + C 宫格 混合布局）。
//
// 设计要点：
// - 布局定版（2026-09-24）：左栏沿用 B 的「分类导航」，右栏改用 C 的「大圆角图标宫格」，
//   点左栏分类，右边出该分类下的工具宫格（主从导航）。
// - 工具仅由开发在下方 TOOLS 登记，界面不暴露任何添加入口（用户无法手动添加工具）。
// - 宫格列数随右栏宽度自适应：auto-fill + minmax，窗口/容器变窄时自动减少列数。
// - 卡片点击暂留空（具体工具页面尚未设计），仅保留 TODO 接入点。

import { useMemo, useState, type ComponentType } from "react";
import {
  BoltIcon,
  CoffeeIcon,
  HealthIcon,
  LeafIcon,
  SparkIcon,
} from "@/components/Icons";
import { AntiDrowsyView } from "./AntiDrowsy/AntiDrowsyView";
import styles from "./ToolsView.module.css";

interface CategoryDef {
  key: string;
  label: string;
  desc: string;
  Icon: ComponentType<{ size?: number }>;
}

interface ToolDef {
  key: string;
  label: string;
  desc: string;
  category: string;
  Icon: ComponentType<{ size?: number }>;
}

// 分类：仅开发侧维护。新增分类在此追加一项即可。
const CATEGORIES: CategoryDef[] = [
  { key: "health", label: "健康", desc: "缓解疲劳、保持状态的小工具。", Icon: HealthIcon },
  { key: "tech", label: "科技", desc: "借助 AI 与工具帮你理清思路、做判断。", Icon: SparkIcon },
  { key: "eff", label: "效率", desc: "提升日常执行效率的工具（敬请期待）。", Icon: BoltIcon },
];

// 工具：仅开发侧维护。新增工具在此追加一项并指定所属 category 即可。
const TOOLS: ToolDef[] = [
  {
    key: "anti-drowsy",
    label: "防困小妙招",
    desc: "提神 · 微运动 · 呼吸法",
    category: "health",
    Icon: CoffeeIcon,
  },
  {
    key: "wellness-tips",
    label: "养身小技巧",
    desc: "日常养生 · 健康小习惯",
    category: "health",
    Icon: LeafIcon,
  },
  {
    key: "insight-ai",
    label: "洞察AI",
    desc: "分析 · 追问 · 给建议",
    category: "tech",
    Icon: SparkIcon,
  },
];

export function ToolsView() {
  const [activeCat, setActiveCat] = useState<string>(CATEGORIES[0].key);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const activeCategory = useMemo(
    () => CATEGORIES.find((c) => c.key === activeCat) ?? CATEGORIES[0],
    [activeCat],
  );
  const visibleTools = useMemo(
    () => TOOLS.filter((t) => t.category === activeCat),
    [activeCat],
  );

  // 卡片点击：已设计的工具（防困小妙招）进入其独立页面；其余暂留空。
  const handleToolClick = (key: string) => {
    if (key === "anti-drowsy") {
      setActiveTool(key);
      return;
    }
    /* TODO: 接入具体工具页面（洞察AI / 养身小技巧 等尚未设计） */
  };

  if (activeTool === "anti-drowsy") {
    return <AntiDrowsyView onBack={() => setActiveTool(null)} />;
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>工具</h1>
        <p className={styles.subtitle}>
          上班好用工具的集合。点击左侧分类查看，具体工具由开发接入。
        </p>
      </header>

      <div className={styles.frame}>
        <nav className={styles.nav} aria-label="工具分类">
          <span className={styles.navTitle}>分类</span>
          {CATEGORIES.map((cat) => {
            const count = TOOLS.filter((t) => t.category === cat.key).length;
            const isActive = cat.key === activeCat;
            return (
              <button
                key={cat.key}
                type="button"
                className={isActive ? styles.navBtnActive : styles.navBtn}
                onClick={() => setActiveCat(cat.key)}
                aria-current={isActive}
              >
                <cat.Icon size={16} />
                <span className={styles.navLabel}>{cat.label}</span>
                <span className={styles.navCount}>{count}</span>
              </button>
            );
          })}
        </nav>

        <section className={styles.main}>
          <div className={styles.mainHead}>
            <h2 className={styles.mainTitle}>{activeCategory.label}</h2>
            <span className={styles.mainCount}>共 {visibleTools.length} 个工具</span>
          </div>
          <p className={styles.mainDesc}>{activeCategory.desc}</p>

          {visibleTools.length === 0 ? (
            <div className={styles.empty}>
              该分类下暂无工具，<b>敬请期待</b>
            </div>
          ) : (
            <div className={styles.grid}>
              {visibleTools.map((tool) => (
                <button
                  key={tool.key}
                  type="button"
                  className={styles.tile}
                  onClick={() => handleToolClick(tool.key)}
                >
                  <span className={styles.tileGlyph}>
                    <tool.Icon size={30} />
                  </span>
                  <span className={styles.tileTitle}>{tool.label}</span>
                  <span className={styles.tileDesc}>{tool.desc}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
