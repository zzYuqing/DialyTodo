// 职责：经验页主视图。
// 布局：顶部标题 + 搜索 + 操作按钮；其下分类筛选 chips；主体左为经验标题列表
// （时间倒序，点标题切换右栏展示该条）、右为单条经验卡片（默认展示第一条）。
// 筛选：分类 + 标题搜索，可叠加。
// 录入分两条路径：新增走弹窗（ExperienceEditorModal），编辑走卡片就地编辑
// （ExperienceEditCard）—— 点「编辑」后该卡片原地变为可编辑，保存 / 取消就地完成。

import { useEffect, useMemo, useState } from "react";
import { Button, Text, TextInput } from "@mantine/core";
import { ConfirmDialog } from "@/components/ConfirmDialog/ConfirmDialog";
import {
  CloseIcon,
  DownloadIcon,
  EyeIcon,
  PanelToggleIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UploadIcon,
} from "@/components/Icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useExperienceStore, useSettingsStore, useTrashStore } from "@/stores";
import { attachmentStoredNamesIn, listedAttachments, todayKey } from "@/lib";
import { dataRoot, deleteAttachmentFile } from "@/services";
import { copyPickedAttachments, downloadAttachment, openAttachment } from "./attachmentActions";
import { ExperienceDateRail } from "./ExperienceDateRail";
import { ExperienceEditCard, type ExperienceEditPatch } from "./ExperienceEditCard";
import { ExperienceEditorModal, type ExperienceDraft } from "./ExperienceEditorModal";
import { ExperienceCategoryManager } from "./ExperienceCategoryManager";
import { AttachmentPreviewModal, isPreviewableAttachment } from "./AttachmentPreviewModal";
import { resolveImageSrc } from "./resolveImageSrc";
import type { Experience, ExperienceAttachment } from "@/types";
import styles from "./ExperienceView.module.css";

/**
 * 待确认删除的目标：整条经验，或某条经验下的一个附件。
 * 两者都需要二次确认（均为不可逆操作），共用一个状态以复用同一个确认弹窗。
 */
type PendingDelete =
  | { kind: "experience"; id: string; title: string }
  | { kind: "attachment"; expId: string; att: ExperienceAttachment };

/**
 * 标题模糊匹配：先忽略大小写做子串包含；否则退化为子序列匹配
 * （查询字符按序出现在标题中即为命中，容忍漏字 / 跳字）。
 * 空查询返回 true，交由上层视为「全匹配」。
 */
function fuzzyMatchTitle(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const t = title.toLowerCase();
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return false;
}

export function ExperienceView() {
  const experiences = useExperienceStore((s) => s.experiences);
  const categories = useExperienceStore((s) => s.categories);
  const addExperience = useExperienceStore((s) => s.addExperience);
  const updateExperience = useExperienceStore((s) => s.updateExperience);
  // 删除改走回收站：整条经验 / 单附件先移入回收站，磁盘文件保留到彻底清除时
  const moveExperienceToTrash = useTrashStore((s) => s.moveExperienceToTrash);
  const moveAttachmentToTrash = useTrashStore((s) => s.moveAttachmentToTrash);
  const trashRetentionDays = useSettingsStore((s) => s.settings.trashRetentionDays);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // 新增弹窗（编辑不再走弹窗，改由卡片就地编辑）
  const [editorOpen, setEditorOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  // 正在就地编辑的经验 id：该条渲染为编辑卡片，同一时刻只编辑一条
  const [editingId, setEditingId] = useState<string | null>(null);
  // 左栏是否收起：收起后只剩一条竖条（VS Code 侧栏折叠同类交互），点它再展开
  const [railCollapsed, setRailCollapsed] = useState(false);
  // 数据根目录：把 md 里的附件相对路径解析成本地文件地址（渲染图片 / 打开附件）
  const [root, setRoot] = useState<string | null>(null);
  // 正在就地上传统附件的经验 id：期间禁用该条目的上传入口，避免连点重复复制
  const [uploadingIds, setUploadingIds] = useState<ReadonlySet<string>>(new Set());
  // 附件操作的失败提示，内联显示在对应卡片下（项目未启用 notifications，不依赖它）
  const [attachError, setAttachError] = useState<{ id: string; message: string } | null>(null);
  // 附件操作的警告提示（如 .md 含本地图片），内联显示在对应卡片下，非阻断
  const [attachWarn, setAttachWarn] = useState<{ id: string; message: string } | null>(null);
  // 正在预览的附件：弹窗级状态，同一时刻只预览一个
  const [preview, setPreview] = useState<{ expId: string; att: ExperienceAttachment } | null>(null);
  // 待确认删除的目标。存 id 而非对象引用，避免数据刷新后拿到过期快照；
  // 整条与附件共用一个状态，保证同一时刻只有一个确认弹窗
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  useEffect(() => {
    void dataRoot().then(setRoot);
  }, []);

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

  /** 标题模糊搜索（子串 + 子序列），空查询视为全匹配 */
  const searchFiltered = useMemo(
    () =>
      query.trim() === ""
        ? experiences
        : experiences.filter((e) => fuzzyMatchTitle(e.title, query)),
    [experiences, query],
  );

  /** 左栏数据：搜索 + 分类叠加，不过日期，保证切换日期时导航不塌缩 */
  const categoryFiltered = useMemo(
    () =>
      activeCategory === null
        ? searchFiltered
        : searchFiltered.filter((e) => e.category === activeCategory),
    [searchFiltered, activeCategory],
  );

  // 结果列表：分类 + 搜索叠加筛选，按日期倒序、同日按更新时间倒序
  const filtered = useMemo(
    () =>
      [...categoryFiltered].sort((a, b) =>
        a.date < b.date
          ? 1
          : a.date > b.date
            ? -1
            : a.updatedAt < b.updatedAt
              ? 1
              : -1,
      ),
    [categoryFiltered],
  );

  // 选中条目被后续筛选排除时自动切到第一条；空列表时置 null
  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId === null || !filtered.some((e) => e.id === selectedId)) {
      setSelectedId(filtered[0]!.id);
    }
  }, [filtered, selectedId]);

  // 分类被删除后，若正选中它则回到「全部」
  useEffect(() => {
    if (activeCategory !== null && !categories.some((c) => c.id === activeCategory)) {
      setActiveCategory(null);
    }
  }, [categories, activeCategory]);

  // 点左栏标题：切换右栏展示该条经验
  const handleSelectExperience = (id: string) => {
    setSelectedId(id);
  };

  const openAdd = () => {
    setEditorOpen(true);
  };

  /** 新增：走弹窗。编辑不再用弹窗，改由卡片就地编辑 */
  const handleCreate = (data: ExperienceDraft) => {
    void addExperience(data);
  };

  /** 就地编辑保存：patch 落到该条；正文里删掉引用的图片直接删盘，手动移除的附件进回收站 */
  const handleSaveEdit = async (id: string, patch: ExperienceEditPatch) => {
    const current = experiences.find((e) => e.id === id);

    // 正文引用差集：旧正文引用、新正文不再引用的附件图片 → 直接删磁盘文件（不进回收站）。
    // 必须按正文路径对比——上传 md 自动修复的图片只落盘 + 写正文路径，并不登记在
    // attachments 元数据里，只看附件列表会漏掉它们。
    const purgedStoredNames = new Set<string>();
    const newRefs = attachmentStoredNamesIn(patch.content);
    if (current !== undefined) {
      const oldRefs = attachmentStoredNamesIn(current.content);
      for (const storedName of oldRefs) {
        if (!newRefs.has(storedName)) purgedStoredNames.add(storedName);
      }
      for (const storedName of purgedStoredNames) {
        await deleteAttachmentFile(id, storedName);
      }
      // 内嵌图片（正文引用的图片）一律不进附件元数据列表：
      // 既剔除本次删掉引用的，也顺带清掉历史版本误登记进列表的内嵌图片（文件保留）
      patch.attachments = patch.attachments.filter(
        (a) =>
          !purgedStoredNames.has(a.storedName) &&
          !(a.mime.startsWith("image/") && newRefs.has(a.storedName)),
      );
    }

    // 手动从附件列表点 X 移除的附件才进回收站；内嵌图片的元数据清理排除在外（不进回收站）
    const embeddedOrPurged = (a: ExperienceAttachment) =>
      purgedStoredNames.has(a.storedName) ||
      (a.mime.startsWith("image/") && newRefs.has(a.storedName));
    const removed =
      current !== undefined
        ? current.attachments.filter(
            (a) => !patch.attachments.some((p) => p.id === a.id) && !embeddedOrPurged(a),
          )
        : [];
    await updateExperience(id, patch);
    for (const a of removed) {
      await moveAttachmentToTrash(id, a);
    }
    setEditingId(null);
  };

  /** 附件操作失败的统一提示入口（打开 / 下载 / 添加共用一条内联红字） */
  const failAttachment = (expId: string, message: string) => {
    setAttachError({ id: expId, message });
  };

  /**
   * 在已有条目上就地追加附件：选文件 → 复制进该条目的附件目录 → 立即落库。
   * 非编辑态没有 draft 概念，所以改完直接写盘；编辑态由编辑卡自己攒 draft，保存时才提交。
   */
  const handleAddAttachments = async (exp: Experience) => {
    setAttachError(null);
    setAttachWarn(null);
    setUploadingIds((prev) => new Set(prev).add(exp.id));
    try {
      const result = await copyPickedAttachments(exp.id, `为「${exp.title}」添加附件`);
      if (result.added !== null && result.added.length > 0) {
        await updateExperience(exp.id, {
          attachments: [...exp.attachments, ...result.added],
        });
      }
      if (result.mdImageWarning !== undefined) {
        setAttachWarn({ id: exp.id, message: result.mdImageWarning });
      }
    } catch (err) {
      console.error("[experience] 就地添加附件失败", err);
      failAttachment(exp.id, "附件复制失败，请重试");
    } finally {
      setUploadingIds((prev) => {
        const next = new Set(prev);
        next.delete(exp.id);
        return next;
      });
    }
  };

  /**
   * 确认删除：整条经验直接移除；附件则从所属经验的列表里摘掉后落库。
   * 两者都不删磁盘文件（既定策略：正文可能仍引用该附件，删了会裂图）。
   */
  const handleConfirmDelete = async () => {
    const target = pendingDelete;
    if (target === null) return;
    setPendingDelete(null);
    if (target.kind === "experience") {
      if (editingId === target.id) setEditingId(null);
      // 整条经验移入回收站：软删经验数组（保留磁盘附件），快照写入 trash.json
      await moveExperienceToTrash(target.id);
      return;
    }
    const exp = experiences.find((e) => e.id === target.expId);
    if (exp === undefined) return;
    const removed = exp.attachments.find((a) => a.id === target.att.id);
    if (removed === undefined) return;
    const kept = exp.attachments.filter((a) => a.id !== target.att.id);
    await updateExperience(exp.id, { attachments: kept });
    // 被删附件移入回收站（磁盘文件保留到回收站彻底清除时）；传入附件对象本身，避免删后再反查找不到
    await moveAttachmentToTrash(exp.id, removed);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <button
            type="button"
            className={styles.railSwitch}
            onClick={() => setRailCollapsed((v) => !v)}
            title={railCollapsed ? "展开左栏" : "隐藏左栏"}
            aria-label={railCollapsed ? "展开左栏" : "隐藏左栏"}
          >
            <PanelToggleIcon size={16} />
          </button>
          <span className={styles.titleIcon}>经验</span>
          <Text size="xs" className={styles.muted}>
            记录踩过的坑，以后遇到同类情况不慌
          </Text>
        </div>
        <div className={styles.headerActions}>
          <TextInput
            size="xs"
            className={styles.searchBox}
            placeholder="搜索经验标题…"
            leftSection={<SearchIcon size={14} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            rightSection={
              query ? (
                <button
                  type="button"
                  className={styles.searchClear}
                  onClick={() => setQuery("")}
                  aria-label="清除搜索"
                >
                  ×
                </button>
              ) : null
            }
          />
          <Button size="xs" leftSection={<PlusIcon size={14} />} onClick={openAdd}>
            新增经验
          </Button>
        </div>
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

      <div className={`${styles.body} ${railCollapsed ? styles.bodyCollapsed : ""}`}>
        {!railCollapsed && (
          <div className={styles.railWrap}>
            <ExperienceDateRail
              experiences={categoryFiltered}
              colorOf={(id) => categoryMap.get(id)?.color}
              selectedId={selectedId}
              onSelectExperience={handleSelectExperience}
            />
          </div>
        )}
        <div className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              {experiences.length === 0
                ? "还没有经验记录，点右上角「新增经验」沉淀第一条。"
                : query.trim() !== ""
                  ? `没有匹配「${query.trim()}」的经验标题。`
                  : "当前筛选下没有经验记录。"}
            </div>
          ) : (
            (() => {
              // 右栏只展示左栏选中的那条（默认第一条），不再铺满全部卡片
              const e = filtered.find((x) => x.id === selectedId) ?? filtered[0]!;
              // 就地编辑：这一条换成编辑卡片，保存 / 取消都在卡片上完成
              if (e.id === editingId) {
                return (
                  <ExperienceEditCard
                    key={e.id}
                    experience={e}
                    categories={categories}
                    root={root}
                    onSave={(patch) => void handleSaveEdit(e.id, patch)}
                    onCancel={() => setEditingId(null)}
                  />
                );
              }
              const cat = categoryMap.get(e.category);
              // 正文里内嵌引用的图片不占附件列表位，只展示独立附件
              const cardAttachments = listedAttachments(e.attachments, e.content);
              return (
                <div key={e.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <span
                      className={styles.cardDot}
                      style={{ background: cat?.color ?? "var(--dt-text-muted)" }}
                    />
                    <span className={styles.cardCat}>{cat?.name ?? "未分类"}</span>
                    <span className={styles.cardDate}>{e.date}</span>
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={() => setEditingId(e.id)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className={styles.linkBtnDanger}
                        onClick={() =>
                          setPendingDelete({ kind: "experience", id: e.id, title: e.title })
                        }
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className={styles.cardTitle}>{e.title}</div>
                  {e.content.trim().length > 0 && (
                    <div className={styles.cardContent}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          img: ({ src, alt }) => (
                            <img src={resolveImageSrc(src, root)} alt={alt ?? ""} />
                          ),
                        }}
                      >
                        {e.content}
                      </ReactMarkdown>
                    </div>
                  )}
                  {/* 附件区常驻：即使没有附件也保留上传入口，便于事后补传 */}
                  <div
                    className={`${styles.cardAttach} ${
                      cardAttachments.length === 0 ? styles.cardAttachEmpty : ""
                    }`}
                  >
                    {cardAttachments.map((a) => (
                      <div key={a.id} className={styles.attachChip}>
                        <button
                          type="button"
                          className={styles.attachName}
                          onClick={() =>
                            void openAttachment(e.id, a.storedName).catch(() =>
                              failAttachment(e.id, "打开附件失败，文件可能已被移动"),
                            )
                          }
                          title={`打开 ${a.name}`}
                        >
                          {a.name}
                        </button>
                        {isPreviewableAttachment(a) && (
                          <button
                            type="button"
                            className={styles.attachPreview}
                            onClick={() => setPreview({ expId: e.id, att: a })}
                            title={`预览 ${a.name}`}
                            aria-label={`预览 ${a.name}`}
                          >
                            <EyeIcon size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.attachAction}
                          onClick={() =>
                            void downloadAttachment(e.id, a).catch(() =>
                              failAttachment(e.id, "下载失败，请确认目标位置可写"),
                            )
                          }
                          title={`下载 ${a.name}`}
                          aria-label={`下载 ${a.name}`}
                        >
                          <DownloadIcon size={12} />
                        </button>
                        <button
                          type="button"
                          className={styles.attachRemove}
                          onClick={() =>
                            setPendingDelete({ kind: "attachment", expId: e.id, att: a })
                          }
                          title={`删除 ${a.name}`}
                          aria-label={`删除 ${a.name}`}
                        >
                          <CloseIcon size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className={styles.attachAdd}
                      onClick={() => void handleAddAttachments(e)}
                      disabled={uploadingIds.has(e.id)}
                      title="为该经验添加附件"
                    >
                      <UploadIcon size={13} />
                      {uploadingIds.has(e.id) ? "上传中…" : "添加附件"}
                    </button>
                  </div>
                  {attachError?.id === e.id && (
                    <div className={styles.attachError}>{attachError.message}</div>
                  )}
                  {attachWarn?.id === e.id && (
                    <div className={styles.attachWarn}>{attachWarn.message}</div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      </div>

      {/* 新增走弹窗；编辑在卡片上就地完成，不再弹窗 */}
      <ExperienceEditorModal
        opened={editorOpen}
        onClose={() => setEditorOpen(false)}
        categories={categories}
        defaultDate={todayKey()}
        onSubmit={handleCreate}
      />

      <ExperienceCategoryManager
        opened={managerOpen}
        onClose={() => setManagerOpen(false)}
        categories={categories}
        counts={categoryCounts}
      />

      {/* 整条删除与附件删除共用这一个确认弹窗：同一时刻只会有一个待确认目标 */}
      <ConfirmDialog
        opened={pendingDelete !== null}
        title={pendingDelete?.kind === "attachment" ? "删除附件" : "删除经验"}
        message={
          pendingDelete?.kind === "attachment" ? (
            <>
              确定要从这条经验移除附件 <strong>{pendingDelete.att.name}</strong> 吗？移除后可在回收站保留 {trashRetentionDays} 天，期间可还原。
            </>
          ) : (
            <>
              确定要删除经验 <strong>{pendingDelete?.title ?? ""}</strong> 吗？删除后将移入回收站，保留 {trashRetentionDays} 天后彻底清除。
            </>
          )
        }
        confirmLabel="删除"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      {/* 附件在线预览：视图级单例，点任意附件的「预览」按钮时挂载对应附件 */}
      <AttachmentPreviewModal
        opened={preview !== null}
        att={preview?.att ?? null}
        expId={preview?.expId ?? ""}
        root={root}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
