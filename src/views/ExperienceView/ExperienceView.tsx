// 职责：经验页主视图。
// 布局：顶部标题 + 操作按钮；其下分类筛选 chips；主体左为两级日期导航（日期 → 标题）、
// 右为经验卡片列表。筛选三态可叠加：日期（含单条定位）+ 分类。新增 / 编辑复用同一弹窗。

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Text } from "@mantine/core";
import { PlusIcon, SettingsIcon } from "@/components/Icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useExperienceStore } from "@/stores";
import { todayKey } from "@/lib";
import { ExperienceDateRail } from "./ExperienceDateRail";
import { ExperienceEditorModal, type ExperienceDraft } from "./ExperienceEditorModal";
import { ExperienceCategoryManager } from "./ExperienceCategoryManager";
import type { Experience } from "@/types";
import styles from "./ExperienceView.module.css";

export function ExperienceView() {
  const experiences = useExperienceStore((s) => s.experiences);
  const categories = useExperienceStore((s) => s.categories);
  const addExperience = useExperienceStore((s) => s.addExperience);
  const updateExperience = useExperienceStore((s) => s.updateExperience);
  const removeExperience = useExperienceStore((s) => s.removeExperience);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [editing, setEditing] = useState<Experience | null>(null);

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  /** 每个分类下的经验总条数（不受筛选影响），供管理弹窗判断能否删除 */
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of categories) counts[c.id] = 0;
    for (const e of experiences) counts[e.category] = (counts[e.category] ?? 0) + 1;
    return counts;
  }, [categories, experiences]);

  /** 左栏数据：只过分类，不过日期，保证切换日期时导航不塌缩 */
  const categoryFiltered = useMemo(
    () =>
      activeCategory === null
        ? experiences
        : experiences.filter((e) => e.category === activeCategory),
    [experiences, activeCategory],
  );

  // 结果列表：日期 + 分类叠加筛选，按日期倒序、同日按更新时间倒序
  const filtered = useMemo(() => {
    const base =
      selectedDate === null
        ? categoryFiltered
        : categoryFiltered.filter((e) => e.date === selectedDate);
    return [...base].sort((a, b) =>
      a.date < b.date
        ? 1
        : a.date > b.date
          ? -1
          : a.updatedAt < b.updatedAt
            ? 1
            : -1,
    );
  }, [categoryFiltered, selectedDate]);

  // 选中条目被后续筛选排除时自动落回 null，避免残留一个看不见的高亮
  useEffect(() => {
    if (selectedId !== null && !categoryFiltered.some((e) => e.id === selectedId)) {
      setSelectedId(null);
    }
  }, [categoryFiltered, selectedId]);

  // 分类被删除后，若正选中它则回到「全部」
  useEffect(() => {
    if (activeCategory !== null && !categories.some((c) => c.id === activeCategory)) {
      setActiveCategory(null);
    }
  }, [categories, activeCategory]);

  // 点左栏标题：筛到该条所在日期并滚动到它
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (selectedId === null) return;
    cardRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId, filtered]);

  const openAdd = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (exp: Experience) => {
    setEditing(exp);
    setEditorOpen(true);
  };
  const handleSubmit = (data: ExperienceDraft) => {
    if (editing) updateExperience(editing.id, data);
    else void addExperience(data);
  };

  const handleSelectDate = (date: string | null) => {
    setSelectedDate(date);
    setSelectedId(null);
  };
  const handleSelectExperience = (id: string) => {
    const target = categoryFiltered.find((e) => e.id === id);
    if (target === undefined) return;
    setSelectedDate(target.date);
    setSelectedId(id);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.titleIcon}>经验</span>
          <Text size="xs" className={styles.muted}>
            记录踩过的坑，以后遇到同类情况不慌
          </Text>
        </div>
        <Button size="xs" leftSection={<PlusIcon size={14} />} onClick={openAdd}>
          新增经验
        </Button>
      </div>

      {/* 分类筛选 chips + 类型管理入口 */}
      <div className={styles.filters}>
        <button
          type="button"
          className={`${styles.chip} ${activeCategory === null ? styles.chipActive : ""}`}
          onClick={() => setActiveCategory(null)}
        >
          全部
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${styles.chip} ${activeCategory === c.id ? styles.chipActive : ""}`}
            onClick={() => setActiveCategory(c.id)}
          >
            <span className={styles.chipDot} style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.chip} ${styles.chipManage}`}
          onClick={() => setManagerOpen(true)}
          title="管理类型"
        >
          <SettingsIcon size={13} />
          管理
        </button>
      </div>

      <div className={styles.body}>
        <ExperienceDateRail
          experiences={categoryFiltered}
          colorOf={(id) => categoryMap.get(id)?.color}
          selectedDate={selectedDate}
          selectedId={selectedId}
          onSelectDate={handleSelectDate}
          onSelectExperience={handleSelectExperience}
        />
        <div className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              {experiences.length === 0
                ? "还没有经验记录，点右上角「新增经验」沉淀第一条。"
                : "当前筛选下没有经验记录。"}
            </div>
          ) : (
            filtered.map((e) => {
              const cat = categoryMap.get(e.category);
              return (
                <div
                  key={e.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(e.id, el);
                    else cardRefs.current.delete(e.id);
                  }}
                  className={`${styles.card} ${e.id === selectedId ? styles.cardFocused : ""}`}
                >
                  <div className={styles.cardTop}>
                    <span
                      className={styles.cardDot}
                      style={{ background: cat?.color ?? "var(--dt-text-muted)" }}
                    />
                    <span className={styles.cardCat}>{cat?.name ?? "未分类"}</span>
                    <span className={styles.cardDate}>{e.date}</span>
                    <div className={styles.cardActions}>
                      <button type="button" className={styles.linkBtn} onClick={() => openEdit(e)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className={styles.linkBtnDanger}
                        onClick={() => removeExperience(e.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className={styles.cardTitle}>{e.title}</div>
                  {e.content.trim().length > 0 && (
                    <div className={styles.cardContent}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <ExperienceEditorModal
        opened={editorOpen}
        onClose={() => setEditorOpen(false)}
        categories={categories}
        defaultDate={selectedDate ?? todayKey()}
        editing={editing}
        onSubmit={handleSubmit}
      />

      <ExperienceCategoryManager
        opened={managerOpen}
        onClose={() => setManagerOpen(false)}
        categories={categories}
        counts={categoryCounts}
      />
    </div>
  );
}
