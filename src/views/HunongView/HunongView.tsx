// 职责：糊弄学工具页（B 版锦囊卡片墙：单栏一行一条 + 右下悬浮加号 + 底部抽屉式新增 + 模糊搜索）。
// 顶部返回 + 标题；其下头部带「糊弄锦囊」计数与模糊搜索框（方法和举例一起模糊匹配）；
// 中部单栏可滚动卡片（每条一行，均带删除按钮）；
// 默认隐藏新增区，右下角悬浮加号（复用首页 AddTaskFab），点击展开底部输入抽屉；
// 删除走二次确认 + 回收站（moveHunongToTrash），与任务 / 经验 / 附件同一套逻辑，保留期后彻底清除。
// 用户条目持久化到本地（services/hunongService）；无内置条目，初始为空状态。

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AddTaskFab } from "@/components/AddTaskFab/AddTaskFab";
import { ConfirmDialog } from "@/components/ConfirmDialog/ConfirmDialog";
import { loadHunong, saveHunong, type HunongItem } from "@/services/hunongService";
import { useTrashStore, useSettingsStore } from "@/stores";
import styles from "./HunongView.module.css";

export function HunongView({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<HunongItem[]>([]);
  const [method, setMethod] = useState("");
  const [example, setExample] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<HunongItem | null>(null);

  const moveHunongToTrash = useTrashStore((s) => s.moveHunongToTrash);
  const trashRetentionDays = useSettingsStore((s) => s.settings.trashRetentionDays);

  useEffect(() => {
    void loadHunong().then((d) => setItems(d.items));
  }, []);

  const persist = (next: HunongItem[]) => {
    setItems(next);
    void saveHunong({ items: next });
  };

  // 防重：与已有按糊弄法去重，trim 后空不提交
  const addItem = () => {
    const m = method.trim();
    if (!m) {
      setMethod("");
      return;
    }
    const ex = example.trim();
    if (items.some((x) => x.method === m)) {
      setMethod("");
      setExample("");
      return;
    }
    persist([...items, { method: m, example: ex || undefined }]);
    setMethod("");
    setExample("");
    setShowForm(false);
  };

  // 二次确认删除：先移入回收站（软删 hunong.json），再更新本地列表
  const confirmDelete = () => {
    if (pendingDelete === null) return;
    const target = pendingDelete;
    void moveHunongToTrash([target]);
    setItems((prev) => prev.filter((it) => it !== target));
    setPendingDelete(null);
  };

  const deleteMessage: ReactNode = pendingDelete ? (
    <>
      删除后糊弄法「<strong>{pendingDelete.method}</strong>」将移入回收站，保留 {trashRetentionDays}{" "}
      天后彻底清除，届时可还原或彻底删除。
    </>
  ) : null;

  // 模糊搜索：方法和举例一起匹配（不区分大小写、子串包含）
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? items.filter(
            (it) =>
              it.method.toLowerCase().includes(q) ||
              (it.example ?? "").toLowerCase().includes(q),
          )
        : items,
    [items, q],
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <button className={styles.back} onClick={onBack} title="返回工具">
          ← 工具
        </button>
        <h1 className={styles.title}>糊弄学</h1>
      </div>

      <div className={styles.listHead}>
        <div className={styles.listTitleRow}>
          <h2 className={styles.listTitle}>糊弄锦囊</h2>
          <span className={styles.listCount}>共 {items.length} 张</span>
        </div>
        <input
          className={styles.search}
          value={query}
          placeholder="模糊搜索"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className={styles.scroll}>
        {visible.length === 0 ? (
          <div className={styles.empty}>
            {items.length === 0
              ? "还没有锦囊，点右下角 + 写下你的第一条糊弄法"
              : "没有匹配的锦囊"}
          </div>
        ) : (
          <div className={styles.grid}>
            {visible.map((item, i) => (
              <div key={`u-${i}`} className={styles.card}>
                <button
                  className={styles.del}
                  onClick={() => setPendingDelete(item)}
                  title="删除"
                >
                  ×
                </button>
                <div className={styles.main}>{item.method}</div>
                {item.example && (
                  <div className={styles.exWrap}>
                    <b>举例：</b>
                    {item.example}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className={styles.addForm}>
          <div className={styles.formHead}>
            <span className={styles.formTitle}>新增锦囊</span>
            <button className={styles.close} onClick={() => setShowForm(false)} title="收起">
              ×
            </button>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>
              糊弄法<span className={styles.req}>必填</span>
            </label>
            <textarea
              className={styles.input}
              rows={2}
              value={method}
              placeholder="例如：在忙，稍后回复你"
              onChange={(e) => setMethod(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addItem();
              }}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>
              举例<span className={styles.opt}>可选</span>
            </label>
            <textarea
              className={styles.input}
              rows={2}
              value={example}
              placeholder="例如：同事甩锅时先停球"
              onChange={(e) => setExample(e.target.value)}
            />
          </div>
          <button className={styles.submit} onClick={addItem}>
            收入锦囊
          </button>
        </div>
      )}

      {!showForm && <AddTaskFab onClick={() => setShowForm(true)} />}

      <ConfirmDialog
        opened={pendingDelete !== null}
        title="删除糊弄法"
        message={deleteMessage}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
