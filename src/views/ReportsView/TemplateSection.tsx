// 职责：AI 报告的模板库区块（两态）。
// 选择态：模板库列表（内置默认 + 已保存模板），radio 选中即生效，条目悬浮出「编辑 / 删除」；
// 编辑态按入口分两种语义（2026-11-04 拍板）：
//   卡片「编辑」进入 = 就地修改这一条：没有「获取模板」，润色与保存都直接覆盖本条目，
//     润色前弹覆盖确认（ConfirmDialog）；名称与自身同名合法，但不得与其他条目冲突。
//   「＋ 新建模板」进入 = 产物永远是新条目：保留「获取模板」（库内复制底稿 / 粘贴识别）。
//
// 编辑器现场（draft + 在途任务 + 提示）住 useTemplateAiStore（模块级，2026-11-04 终版）：
// 切页不丢、回页原样恢复（含转圈 / 失败态）；点「取消」= 丢弃草稿并真正掐断在途请求
// （AbortController），不存在「列表占位条目」兜底形态。任务结果一律回填草稿；
// 编辑模式另同步覆盖库内条目。试用 API 同时只允许一个请求：取消后立刻重试可能吃 429，
// aiService 会把 429 翻译成「过一会儿再试」的提示，就地显示。
//
// 保存（2026-11-04 二次修正：不弹命名窗，名称就在编辑器顶部输入框里）：
// 内容与打开时一致 → 直接保存（覆盖 / 入库）；有修改 → 先 AI 初审，三态就地显示，
// 通过即落库；调用失败给「仍然保存」降级出口。
// 初审是组件级快调用：切页丢失可接受（回页重点一次即可），不必搬进 store。

import { useRef, useState } from "react";
import { Modal } from "@mantine/core";
import { reviewTemplate } from "@/services";
import { DEFAULT_REPORT_TEMPLATE } from "@/constants";
import { nowIso } from "@/lib";
import { useTemplateAiStore } from "@/stores";
import type { AiProviderConfig, ReportTemplateEntry, TemplateReview } from "@/types";
import { ConfirmDialog } from "@/components/ConfirmDialog/ConfirmDialog";
import styles from "./ReportsView.module.css";

/** 保存弹窗的初审状态：进行中 / 被驳回 / 调用失败（后者才允许降级保存） */
type ReviewPhase =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "rejected"; review: TemplateReview }
  | { phase: "failed"; message: string };

interface TemplateSectionProps {
  templates: ReportTemplateEntry[];
  /** 当前生效模板："default" 或条目 id */
  selectedId: string;
  onSelect: (id: string) => void;
  /** 模板库整体变更（新增 / 更新 / 删除），父层负责落 settings */
  onChangeLibrary: (next: ReportTemplateEntry[]) => void;
  aiProvider: AiProviderConfig;
  aiReady: boolean;
  /** 报告生成中：模板相关的 AI 调用一并禁用 */
  anyRunning: boolean;
  /**
   * 嵌入「单卡分步」布局时传 true：隐藏自带 <legend> 并去掉外框，
   * 让步骤号 + 步骤标题接管分区标题，避免「报告模板」重复出现。
   * 默认 false，保持独立使用时的带框卡片外观。
   */
  hideLegend?: boolean;
}

/** 生成模板库条目 id（时间 + 随机段，无需引入 uuid 依赖） */
function newTemplateId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 模板卡片的副标题：取正文首个有效行（跳过纯标题行）作为摘要 + 更新日期。
 * 目的是让用户不必打开压缩包般的条目就能分辨模板，而不是精确预览。
 */
function templateSummary(entry: ReportTemplateEntry): string {
  const line = entry.content
    .split("\n")
    .map((raw) => raw.replace(/^#+\s*/, "").trim())
    .find((text) => text !== "");
  const date =
    entry.createdAt !== "" ? `${entry.createdAt.slice(5, 10).replace("-", "/")} 更新` : "";
  if (line === undefined) return date;
  const short = line.length > 20 ? `${line.slice(0, 20)}…` : line;
  return date === "" ? short : `${short} · ${date}`;
}

export function TemplateSection({
  templates,
  selectedId,
  onSelect,
  onChangeLibrary,
  aiProvider,
  aiReady,
  anyRunning,
  hideLegend = false,
}: TemplateSectionProps) {
  // ---- 编辑器现场（store 级：切页不丢，回页原样恢复，含在途任务与提示） ----
  const draft = useTemplateAiStore((s) => s.draft);
  const aiTask = useTemplateAiStore((s) => s.task);
  const aiDoneHint = useTemplateAiStore((s) => s.hint);
  const aiError = useTemplateAiStore((s) => s.error);

  // ---- 弹窗开合 ----
  const [defaultHintOpen, setDefaultHintOpen] = useState(false);
  const [fetchOpen, setFetchOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReportTemplateEntry | null>(null);
  /** 编辑模式的润色覆盖确认（新建模式产物是新条目，无需确认） */
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);

  // ---- 获取模板弹窗内部状态 ----
  // 两个来源用「模式开关」区分，而不是让用户理解「勾选 / 再点一次取消」：
  // library = 从模板库选一份导入；paste = 粘贴文本让 AI 识别成模板
  const [fetchMode, setFetchMode] = useState<"library" | "paste">("library");
  const [fetchChoice, setFetchChoice] = useState<string>("default");
  const [pasteDraft, setPasteDraft] = useState("");

  // ---- 保存初审的就地状态（不再用弹窗承载）----
  const [review, setReview] = useState<ReviewPhase>({ phase: "idle" });
  const [nameError, setNameError] = useState<string | null>(null);
  /** 初审请求序号：关编辑器 / 重新提交时自增，在途的旧结果回来后直接丢弃 */
  const reviewSeq = useRef(0);

  const draftEmpty = draft !== null && draft.content.trim() === "";
  const trimmedName = draft?.name.trim() ?? "";
  /** 在途任务是否在跑（失败态不阻塞：重试 / 再润色都允许） */
  const aiBusy = aiTask !== null && aiTask.status === "running";
  /**
   * 名称查重（输入后即时反馈）：新建模式不得与库内条目同名；
   * 编辑模式与自身同名合法（覆盖自己），但不得与其他条目冲突。
   */
  const nameConflict =
    draft !== null &&
    trimmedName !== "" &&
    templates.some((t) => t.name === trimmedName && t.id !== draft.id);
  const nameOkForAi = trimmedName !== "" && !nameConflict;
  /** 保存初审进行中：暂时别再发起任何 AI 调用，守住单模型连接 */
  const reviewChecking = review.phase === "checking";

  const canPolish =
    draft !== null &&
    !draftEmpty &&
    nameOkForAi &&
    aiReady &&
    !anyRunning &&
    !aiBusy &&
    !reviewChecking;
  // 该条目正被在途任务处理时不允许手动保存——任务成功会盖掉手改，先等它结束
  const canSave =
    draft !== null &&
    !draftEmpty &&
    !reviewChecking &&
    !(aiTask !== null && aiTask.status === "running" && aiTask.targetId === draft.id);
  const canFetch =
    draft !== null && draft.id === null && draftEmpty && !aiBusy && !reviewChecking;
  const canRecognize =
    draft !== null &&
    pasteDraft.trim() !== "" &&
    nameOkForAi &&
    aiReady &&
    !anyRunning &&
    !aiBusy &&
    !reviewChecking;

  /** 展示用的库列表：创建时间倒序（最新的在上） */
  const sorted = [...templates].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // ---- 名称输入的即时提示（AI 名称前置的可发现性靠它，不靠 disabled 按钮的悬停） ----
  /** 编辑模式（卡片「编辑」进入）：润色 / 保存都直接覆盖这一条 */
  const isEditEntry = draft !== null && draft.id !== null;

  const nameHint: { tone: "error" | "muted"; text: string } | null = (() => {
    if (draft === null || draftEmpty) return null;
    if (nameConflict) {
      return { tone: "error", text: "已存在同名模板，请换一个名称" };
    }
    if (trimmedName === "") {
      return {
        tone: "muted",
        text: isEditEntry
          ? "填写模板名称后，可使用「AI 润色」"
          : "填写模板名称后，可使用「AI 润色」与「AI 识别」",
      };
    }
    return null;
  })();

  const polishTitle = !aiReady
    ? "请先完成 API 设置"
    : anyRunning
      ? "报告生成中，请稍后再试"
      : aiBusy
        ? "模板 AI 处理中，请等它完成"
        : trimmedName === ""
          ? "先填写模板名称"
          : nameConflict
            ? "名称与现有条目同名，请先改名"
            : isEditEntry
              ? "AI 将直接覆盖这份模板的当前内容"
              : "把内容整理成模板（写草稿或直接提需求都行），结果填入编辑框";

  // ---------- AI 任务（润色 / 识别）：现场在 store，结果回填草稿，取消即真取消 ----------

  /** 润色按钮入口：编辑模式先确认覆盖，新建模式直接启动 */
  const handlePolishClick = () => {
    if (draft === null || !canPolish) return;
    if (draft.id !== null) {
      setOverwriteConfirmOpen(true);
      return;
    }
    useTemplateAiStore.getState().startPolish(aiProvider);
  };

  /** 识别：粘贴的示例文本 → AI 归纳成模板，结果回填编辑框（识别只在新建模式可达） */
  const handleRecognize = () => {
    if (draft === null || !canRecognize) return;
    useTemplateAiStore.getState().startRecognize(pasteDraft, aiProvider);
    setPasteDraft("");
    setFetchOpen(false);
  };

  /** 失败任务重试：用任务留存的原始输入原样重跑 */
  const handleTaskRetry = () => useTemplateAiStore.getState().retry(aiProvider);

  // ---------- 保存（就地初审闸门，无弹窗；名称在编辑器顶部输入框） ----------

  /** 关闭编辑器：本地初审反馈复位 + store 清现场（草稿丢弃、在途请求真取消） */
  const closeEditor = () => {
    reviewSeq.current += 1;
    setReview({ phase: "idle" });
    setNameError(null);
    useTemplateAiStore.getState().closeEditor();
  };

  /** 真正落库：新建入库或更新既有条目，完成后关闭编辑器回列表 */
  const commitSave = (name: string) => {
    if (draft === null) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("模板名称不能为空");
      return;
    }
    if (templates.some((t) => t.name === trimmed && t.id !== draft.id)) {
      setNameError("已存在同名模板，换一个名称吧");
      return;
    }
    if (draft.id === null) {
      const entry: ReportTemplateEntry = {
        id: newTemplateId(),
        name: trimmed,
        content: draft.content,
        createdAt: nowIso(),
      };
      onChangeLibrary([entry, ...templates]);
      onSelect(entry.id);
    } else {
      onChangeLibrary(
        templates.map((t) =>
          t.id === draft.id ? { ...t, name: trimmed, content: draft.content } : t,
        ),
      );
    }
    closeEditor();
  };

  /**
   * 点「保存模板」：先本地查名；内容与打开时一致 → 直接落库（不为改个名字等一轮模型）；
   * 有修改 → AI 初审，三态就地显示，通过才落库。
   */
  const handleSaveClick = () => {
    if (draft === null || !canSave) return;
    const name = draft.name.trim();
    if (name === "") {
      setNameError("模板名称不能为空");
      return;
    }
    if (templates.some((t) => t.name === name && t.id !== draft.id)) {
      setNameError("已存在同名模板，换一个名称吧");
      return;
    }
    setNameError(null);

    if (draft.content === draft.originalContent) {
      commitSave(name);
      return;
    }

    const seq = ++reviewSeq.current;
    setReview({ phase: "checking" });
    void reviewTemplate(draft.content, aiProvider)
      .then((result) => {
        if (seq !== reviewSeq.current) return;
        if (result.approved) {
          commitSave(name);
          return;
        }
        setReview({ phase: "rejected", review: result });
      })
      .catch((error: unknown) => {
        if (seq !== reviewSeq.current) return;
        setReview({
          phase: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  /** 初审判「格式不对」时的出口：去润色 —— 编辑模式同样先确认覆盖，新建模式直接启动 */
  const handleGoPolish = () => {
    if (draft === null) return;
    reviewSeq.current += 1;
    setReview({ phase: "idle" });
    handlePolishClick();
  };

  const openEdit = (entry: ReportTemplateEntry) => {
    useTemplateAiStore.getState().openEntry(entry);
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget === null) return;
    const next = templates.filter((t) => t.id !== deleteTarget.id);
    onChangeLibrary(next);
    // 删除的是当前生效模板时回落默认
    if (selectedId === deleteTarget.id) onSelect("default");
    setDeleteTarget(null);
  };

  // ---------- 编辑态 ----------
  if (draft !== null) {
    return (
      <fieldset className={styles.templateBox}>
        <legend className={styles.templateLegend}>模板编辑</legend>
        <div className={styles.tplEditStatus}>
          <span>
            正在编辑：<strong>{draft.name.trim() === "" ? "未命名模板" : draft.name.trim()}</strong>
          </span>
          <button
            type="button"
            className={styles.tplEditCancel}
            onClick={closeEditor}
            title="放弃编辑，返回模板列表"
          >
            取消
          </button>
        </div>
        <input
          type="text"
          className={styles.tplNameInput}
          value={draft.name}
          maxLength={30}
          // 初审进行中锁住名称与内容：落库用的是提交那一刻的快照，
          // 中途改动会造成「审的是旧内容、存的是新内容」的错位
          disabled={reviewChecking}
          placeholder={
            draft.id === null
              ? "模板名称（AI 润色 / 识别前必填，且不与现有模板同名）"
              : "模板名称（保存与润色将覆盖这份模板）"
          }
          onChange={(e) => useTemplateAiStore.getState().patchDraft({ name: e.target.value })}
          aria-label="模板名称"
        />
        {nameHint !== null && (
          <p className={nameHint.tone === "error" ? styles.tplError : styles.tplHint}>
            {nameHint.text}
          </p>
        )}
        <textarea
          className={styles.templateTextarea}
          value={draft.content}
          disabled={reviewChecking}
          onChange={(e) => useTemplateAiStore.getState().patchDraft({ content: e.target.value })}
          rows={6}
          placeholder={
            draft.id === null
              ? "支持任意写法：直接写想分几节、每节写什么，或者直接提需求（如「给我个程序员周报模板」）。填写后可用「AI 润色」生成模板；想基于已有模板修改，请点「获取模板」。"
              : "支持任意写法。填写后可用「AI 润色」整理成模板格式（会直接覆盖这份模板），或点「保存模板」原样覆盖保存。"
          }
        />
        <div className={styles.tplActionsRow}>
          {/* 获取模板只在新建模式出现：编辑已有模板就是就地修改，不需要再从库里拉底稿 */}
          {draft.id === null && (
            <button
              type="button"
              className={styles.tplBtnGhost}
              disabled={!canFetch}
              onClick={() => {
                setFetchMode("library");
                setFetchChoice("default");
                setPasteDraft("");
                setFetchOpen(true);
              }}
              title={
                aiBusy
                  ? "模板 AI 处理中，请等它完成"
                  : draftEmpty
                    ? "从模板库导入，或粘贴示例文本让 AI 识别生成"
                    : "编辑框有内容时不可导入，先清空或另存为新模板"
              }
            >
              获取模板
            </button>
          )}
          <button
            type="button"
            className={styles.tplBtnAccent}
            disabled={!canPolish}
            onClick={handlePolishClick}
            title={polishTitle}
          >
            AI 润色
          </button>
          <button
            type="button"
            className={styles.tplBtnPrimary}
            disabled={!canSave}
            onClick={handleSaveClick}
            title={
              aiTask !== null && aiTask.status === "running" && aiTask.targetId === draft.id
                ? "AI 正在处理，等它完成再保存"
                : draftEmpty
                  ? "模板内容为空，无法保存"
                  : reviewChecking
                    ? "AI 初审中…"
                    : draft.content === draft.originalContent
                      ? isEditEntry
                        ? "内容未修改，直接保存覆盖"
                        : "内容与导入时一致，直接保存"
                      : isEditEntry
                        ? "先由 AI 初审格式，通过后覆盖保存"
                        : "先由 AI 初审格式，通过后存入模板库"
            }
          >
            保存模板
          </button>
        </div>
        {!aiReady && <p className={styles.tplHint}>尚未配置 API，润色与识别不可用</p>}

        {/* 就地状态区：AI 任务进行中 / 失败重试 / 完成提示 / 保存初审三态 —— 全部不用弹窗承载 */}
        {aiTask !== null && aiTask.status === "running" && draft.id === aiTask.targetId && (
          <p className={styles.tplChecking}>
            <span className={styles.tplSpinner} aria-hidden="true" />
            {aiTask.stage === "review" ? (
              <>
                「{aiTask.name}」正在检查内容…
              </>
            ) : (
              <>
                「{aiTask.name}」{aiTask.kind === "polish" ? "AI 润色中…" : "AI 识别中…"}
                {aiTask.targetId !== null ? "，完成后将覆盖这份模板" : "，完成后将填入编辑框"}
              </>
            )}
          </p>
        )}
        {aiTask !== null && aiTask.status === "failed" && (
          <div className={styles.tplReviewRow}>
            <p className={styles.tplError}>{aiError ?? aiTask.message}</p>
            {/* 内容跑题不给重试：同一份输入重跑一次结论必然相同，先改内容 */}
            {aiTask.retryable ? (
              <button
                type="button"
                className={styles.tplBtnAccent}
                onClick={handleTaskRetry}
                title="用原始输入重试"
              >
                重试
              </button>
            ) : (
              <span className={styles.tplHint}>改好内容后再点一次</span>
            )}
          </div>
        )}
        {aiDoneHint !== null && <p className={styles.tplHint}>{aiDoneHint}</p>}
        {nameError !== null && <p className={styles.tplError}>{nameError}</p>}
        {review.phase === "checking" && (
          <p className={styles.tplChecking}>
            <span className={styles.tplSpinner} aria-hidden="true" />
            AI 正在初审内容…
          </p>
        )}
        {review.phase === "rejected" && (
          <div className={styles.tplReviewRow}>
            <p className={styles.tplError}>{review.review.reason}</p>
            {review.review.kind === "unformatted" && (
              <button
                type="button"
                className={styles.tplBtnAccent}
                onClick={handleGoPolish}
                title="让 AI 把你的意思整理成模板格式"
              >
                去润色
              </button>
            )}
          </div>
        )}
        {review.phase === "failed" && (
          <div className={styles.tplReviewRow}>
            <p className={styles.tplError}>
              {aiReady ? `初审没能完成：${review.message}` : "尚未配置 API，无法初审"}
            </p>
            {aiReady && (
              <button
                type="button"
                className={styles.tplBtnGhost}
                onClick={handleSaveClick}
                title="重新初审"
              >
                重试
              </button>
            )}
            <button
              type="button"
              className={styles.tplBtnGhost}
              onClick={() => commitSave(draft.name)}
              title="跳过初审直接保存"
            >
              仍然保存
            </button>
          </div>
        )}

        {/* 获取模板弹窗：模式开关区分「库导入 / 粘贴识别」，一个模式只做一件事 */}
        <Modal
          opened={fetchOpen}
          onClose={() => setFetchOpen(false)}
          title="获取模板"
          centered
          size="md"
          radius="md"
          closeOnEscape
          overlayProps={{ backgroundOpacity: 0.45, blur: 2 }}
        >
          <div className={styles.fetchSeg} role="tablist" aria-label="模板来源">
            <button
              type="button"
              role="tab"
              aria-selected={fetchMode === "library"}
              className={`${styles.fetchSegBtn} ${fetchMode === "library" ? styles.fetchSegOn : ""}`}
              onClick={() => setFetchMode("library")}
            >
              从模板库选择
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={fetchMode === "paste"}
              className={`${styles.fetchSegBtn} ${fetchMode === "paste" ? styles.fetchSegOn : ""}`}
              onClick={() => setFetchMode("paste")}
            >
              粘贴文本识别
            </button>
          </div>

          {fetchMode === "library" ? (
            <div className={styles.fetchCards}>
              <label
                className={`${styles.fetchCard} ${fetchChoice === "default" ? styles.fetchCardOn : ""}`}
              >
                <input
                  type="radio"
                  name="fetch-template"
                  checked={fetchChoice === "default"}
                  onChange={() => setFetchChoice("default")}
                />
                <span className={styles.fetchCardName}>官方模板</span>
                <span className={styles.fetchCardTail}>内置</span>
              </label>
              {sorted.map((t) => (
                <label
                  key={t.id}
                  className={`${styles.fetchCard} ${fetchChoice === t.id ? styles.fetchCardOn : ""}`}
                >
                  <input
                    type="radio"
                    name="fetch-template"
                    checked={fetchChoice === t.id}
                    onChange={() => setFetchChoice(t.id)}
                  />
                  <span className={styles.fetchCardName}>{t.name}</span>
                  <span className={styles.fetchCardTail}>
                    {t.createdAt !== "" ? t.createdAt.slice(5, 10).replace("-", "/") : ""}
                  </span>
                </label>
              ))}
              {sorted.length === 0 && (
                <p className={styles.fetchTip}>
                  库内暂无自建模板；想沿用别的周报格式，可切到「粘贴文本识别」。
                </p>
              )}
            </div>
          ) : (
            <>
              <textarea
                className={styles.templateTextarea}
                value={pasteDraft}
                onChange={(e) => setPasteDraft(e.target.value)}
                rows={5}
                placeholder="粘贴一段你过去写过的周报，或一段格式说明。AI 会提取章节结构与语气，生成可继续编辑的模板。"
              />
              <p className={styles.fetchTip}>AI 只提取格式，不会把示例里的具体内容写进报告。</p>
              {!nameOkForAi && (
                <p className={styles.tplError}>
                  {trimmedName === ""
                    ? "先在编辑器填写模板名称，识别结果会填入编辑框"
                    : "模板名称与现有条目同名，请先改名再识别"}
                </p>
              )}
            </>
          )}

          <div className={styles.hintModalActions}>
            <button
              type="button"
              className={styles.tplBtnGhost}
              onClick={() => setFetchOpen(false)}
            >
              取消
            </button>
            {fetchMode === "library" ? (
              <button
                type="button"
                className={styles.tplBtnPrimary}
                onClick={() => {
                  const content =
                    fetchChoice === "default"
                      ? DEFAULT_REPORT_TEMPLATE
                      : (templates.find((t) => t.id === fetchChoice)?.content ?? "");
                  // 导入的是库里已有模板的复制：作为新草稿进编辑器，源模板不动
                  if (content !== "") useTemplateAiStore.getState().importContent(content);
                  setFetchOpen(false);
                }}
                title="把所选的模板复制到编辑器，改成你自己的再保存"
              >
                导入所选
              </button>
            ) : (
              <button
                type="button"
                className={styles.tplBtnPrimary}
                disabled={!canRecognize}
                onClick={handleRecognize}
                title={
                  !aiReady
                    ? "请先完成 API 设置"
                    : anyRunning
                      ? "报告生成中，请稍后再试"
                      : aiBusy
                        ? "模板 AI 处理中，请等它完成"
                        : trimmedName === ""
                          ? "先在编辑器填写模板名称（识别结果会填入编辑框）"
                          : nameConflict
                            ? "模板名称与现有条目同名，请先改名"
                            : "识别结果将填入编辑框"
                }
              >
                AI 识别并生成模板
              </button>
            )}
          </div>
        </Modal>

        {/* 编辑模式的润色覆盖确认：AI 结果将直接替换这份模板的当前内容（新建模式不弹，产物是新条目） */}
        <ConfirmDialog
          opened={overwriteConfirmOpen}
          title="AI 润色将覆盖原模板？"
          confirmLabel="润色并覆盖"
          message={
            <>
              润色结果会直接覆盖「
              <strong>{draft.name.trim() === "" ? "未命名模板" : draft.name.trim()}</strong>
              」的当前内容，原内容不会保留。
            </>
          }
          onConfirm={() => {
            setOverwriteConfirmOpen(false);
            useTemplateAiStore.getState().startPolish(aiProvider);
          }}
          onCancel={() => setOverwriteConfirmOpen(false)}
        />
      </fieldset>
    );
  }

  // ---------- 选择态 ----------
  return (
    <fieldset
      className={`${styles.templateBox}${hideLegend ? ` ${styles.templateBoxEmbedded}` : ""}`}
    >
      {!hideLegend && <legend className={styles.templateLegend}>报告模板</legend>}
      <div className={styles.tplCards}>
        <label
          className={`${styles.tplCard} ${selectedId === "default" ? styles.tplCardOn : ""}`}
        >
          <input
            type="radio"
            name="active-template"
            checked={selectedId === "default"}
            onChange={() => onSelect("default")}
          />
          <span className={styles.tplCardBody}>
            <span className={styles.tplCardName}>
              官方模板
              <button
                type="button"
                className={styles.hintMark}
                onClick={(e) => {
                  e.preventDefault();
                  setDefaultHintOpen(true);
                }}
                aria-label="查看官方模板详情"
                title="点击查看模板全文"
              >
                ?
              </button>
            </span>
            <span className={styles.tplCardDesc}>概览 · 关键进展 · AI 解读，三节结构</span>
          </span>
          <span className={styles.tplCardTail}>
            {selectedId === "default" ? (
              <span className={styles.tplBadgeOn}>使用中</span>
            ) : (
              <span className={styles.tplBadge}>内置</span>
            )}
          </span>
        </label>

        {sorted.map((t) => (
          <label
            key={t.id}
            className={`${styles.tplCard} ${selectedId === t.id ? styles.tplCardOn : ""}`}
          >
            <input
              type="radio"
              name="active-template"
              checked={selectedId === t.id}
              onChange={() => onSelect(t.id)}
            />
            <span className={styles.tplCardBody}>
              <span className={styles.tplCardName}>{t.name}</span>
              <span className={styles.tplCardDesc}>{templateSummary(t)}</span>
            </span>
            <span className={styles.tplCardTail}>
              {selectedId === t.id && <span className={styles.tplBadgeOn}>使用中</span>}
              <span className={styles.tplCardActions}>
                <button
                  type="button"
                  className={styles.tplMini}
                  onClick={(e) => {
                    e.preventDefault();
                    openEdit(t);
                  }}
                  title="编辑这份模板"
                >
                  编辑
                </button>
                <button
                  type="button"
                  className={styles.tplMini}
                  onClick={(e) => {
                    e.preventDefault();
                    setDeleteTarget(t);
                  }}
                  title="删除这份模板"
                >
                  删除
                </button>
              </span>
              <span className={styles.tplCardDate}>
                {t.createdAt !== "" ? t.createdAt.slice(5, 10).replace("-", "/") : ""}
              </span>
            </span>
          </label>
        ))}
        <button
          type="button"
          className={styles.tplNewCard}
          onClick={() => useTemplateAiStore.getState().openNew()}
          title="新建一份模板草稿"
        >
          ＋ 新建模板
        </button>
      </div>

      {/* 官方模板详情弹窗：全文展示 + 可复制（可作「我的模板」的底稿） */}
      <Modal
        opened={defaultHintOpen}
        onClose={() => setDefaultHintOpen(false)}
        title="官方模板"
        centered
        size="md"
        radius="md"
        closeOnEscape
        overlayProps={{ backgroundOpacity: 0.45, blur: 2 }}
      >
        <pre className={styles.hintModalBody}>{DEFAULT_REPORT_TEMPLATE}</pre>
        <div className={styles.hintModalActions}>
          <CopyTemplateButton content={DEFAULT_REPORT_TEMPLATE} />
        </div>
      </Modal>

      {/* 删除确认：模板删除不可恢复 */}
      <ConfirmDialog
        opened={deleteTarget !== null}
        title="删除模板？"
        confirmLabel="删除"
        confirmVariant="danger"
        message={
          <>
            模板「<strong>{deleteTarget?.name ?? ""}</strong>」将被删除且无法恢复。
            已用它生成的报告不受影响。
          </>
        }
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </fieldset>
  );
}

/** 复制按钮：点击后短暂显示「已复制」（模板文本用，与报告正文复制同款交互） */
function CopyTemplateButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.tplBtnGhost}
      onClick={() => {
        void navigator.clipboard
          .writeText(content)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}
