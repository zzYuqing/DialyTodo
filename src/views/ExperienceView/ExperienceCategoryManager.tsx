// 职责：经验「类型」管理弹窗 —— 改名、换色、排序、删除、新建。
// 删除约束（用户 2026-09-21 拍板）：仍有经验引用的类型禁止删除，须先在经验里改到其它类型，
// 避免记录退化成游离的「未分类」；另外至少保留一个类型，否则新增经验时无分类可选。

import { useEffect, useState } from "react";
import { Button, Group, Modal, Stack } from "@mantine/core";
import { ChevronRightIcon, TrashIcon } from "@/components/Icons";
import { CATEGORY_COLORS, CATEGORY_NAME_MAX, pickNextCategoryColor } from "@/constants";
import { useExperienceStore } from "@/stores";
import type { ExperienceCategory } from "@/types";
import styles from "./ExperienceCategoryManager.module.css";

interface CategoryRowProps {
  category: ExperienceCategory;
  /** 该类型下的经验条数，> 0 时禁止删除 */
  count: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

/** 单行编辑器：名称走本地草稿，失焦 / 回车提交，Esc 还原 */
function CategoryRow({
  category,
  count,
  canMoveUp,
  canMoveDown,
  canRemove,
  onRename,
  onRecolor,
  onMove,
  onRemove,
}: CategoryRowProps) {
  const [draft, setDraft] = useState(category.name);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // 外部改名成功落地后把草稿对齐，避免两者长期不一致
  useEffect(() => {
    setDraft(category.name);
  }, [category.name]);

  const commitName = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === category.name) {
      setDraft(category.name);
      return;
    }
    onRename(trimmed);
  };

  const removeHint =
    count > 0
      ? `该类型下还有 ${count} 条经验，请先在经验里改到其它类型`
      : "至少保留一个类型";

  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <button
          type="button"
          className={styles.colorDot}
          style={{ background: category.color }}
          onClick={() => setPaletteOpen((v) => !v)}
          title="更换颜色"
          aria-label="更换颜色"
          aria-expanded={paletteOpen}
        />
        <input
          className={styles.nameInput}
          value={draft}
          maxLength={CATEGORY_NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(category.name);
              e.currentTarget.blur();
            }
          }}
        />
        <span className={styles.count}>{count} 条</span>
        <Group gap={2} wrap="nowrap">
          <button
            type="button"
            className={styles.iconBtn}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
            title="上移"
            aria-label="上移"
          >
            <span className={styles.arrowUp}>
              <ChevronRightIcon size={14} />
            </span>
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            title="下移"
            aria-label="下移"
          >
            <span className={styles.arrowDown}>
              <ChevronRightIcon size={14} />
            </span>
          </button>
          <button
            type="button"
            className={styles.iconBtnDanger}
            disabled={!canRemove}
            onClick={onRemove}
            title={canRemove ? "删除类型" : removeHint}
            aria-label="删除类型"
          >
            <TrashIcon size={14} />
          </button>
        </Group>
      </div>
      {paletteOpen && (
        <div className={styles.palette}>
          {CATEGORY_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`${styles.swatch} ${color === category.color ? styles.swatchActive : ""}`}
              style={{ background: color }}
              onClick={() => {
                onRecolor(color);
                setPaletteOpen(false);
              }}
              title={color}
              aria-label={`使用颜色 ${color}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ExperienceCategoryManagerProps {
  opened: boolean;
  onClose: () => void;
  categories: ExperienceCategory[];
  /** 每个类型的经验条数，key 为分类 id */
  counts: Record<string, number>;
}

export function ExperienceCategoryManager({
  opened,
  onClose,
  categories,
  counts,
}: ExperienceCategoryManagerProps) {
  const addCategory = useExperienceStore((s) => s.addCategory);
  const updateCategory = useExperienceStore((s) => s.updateCategory);
  const removeCategory = useExperienceStore((s) => s.removeCategory);
  const moveCategory = useExperienceStore((s) => s.moveCategory);

  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (opened) setNewName("");
  }, [opened]);

  const canAdd = newName.trim().length > 0;

  const handleAdd = () => {
    if (!canAdd) return;
    void addCategory(newName, pickNextCategoryColor(categories.length));
    setNewName("");
  };

  return (
    <Modal opened={opened} onClose={onClose} title="类型管理" centered size="md">
      <Stack gap="xs">
        <div className={styles.hint}>
          删除仅限没有任何经验引用的类型；有记录的类型请先在经验里改到其它类型再删。
        </div>
        <div className={styles.list}>
          {categories.map((c, index) => {
            const count = counts[c.id] ?? 0;
            return (
              <CategoryRow
                key={c.id}
                category={c}
                count={count}
                canMoveUp={index > 0}
                canMoveDown={index < categories.length - 1}
                canRemove={count === 0 && categories.length > 1}
                onRename={(name) => void updateCategory(c.id, { name })}
                onRecolor={(color) => void updateCategory(c.id, { color })}
                onMove={(direction) => void moveCategory(c.id, direction)}
                onRemove={() => void removeCategory(c.id)}
              />
            );
          })}
        </div>

        <div className={styles.addRow}>
          <span
            className={styles.addDot}
            style={{ background: pickNextCategoryColor(categories.length) }}
            title="新建后取此色，可在列表行内点色点更换"
          />
          <input
            className={styles.nameInput}
            value={newName}
            maxLength={CATEGORY_NAME_MAX}
            placeholder="新类型名称"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
          <Button size="xs" variant="default" onClick={handleAdd} disabled={!canAdd}>
            添加
          </Button>
        </div>

        <Group justify="flex-end" mt="xs">
          <Button size="xs" onClick={onClose}>
            完成
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
