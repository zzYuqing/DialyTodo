// 职责：行业资讯的分步添加面板 —— 主行业初审、上下游建议、逐项选择与批量保存。
// 请求与进度由 useIndustryAddStore 持有，切换页面不中断；本组件只负责展示与操作。

import { useMemo } from "react";
import { isAiProviderReady } from "@/services";
import { useIndustryAddStore, useSettingsStore } from "@/stores";
import type {
  IndustryRelationDirection,
  IndustryRelationSelection,
  IndustryRelationSuggestion,
} from "@/types";
import styles from "../InsightView/InsightView.module.css";
import industryStyles from "./IndustryNewsView.module.css";

interface AddIndustryPanelProps {
  canClose: boolean;
  onClose: () => void;
}

const DIRECTIONS: { direction: IndustryRelationDirection; label: string; hint: string }[] = [
  { direction: "upstream", label: "上游 · 供应侧", hint: "给你们供货的原材料、零部件、技术与设备提供方" },
  { direction: "downstream", label: "下游 · 客户侧", hint: "你们供货的整机厂、客户、渠道与应用方" },
];

function relationKey(relation: IndustryRelationSuggestion): string {
  return `${relation.direction}:${relation.name}`;
}

export function AddIndustryPanel({ canClose, onClose }: AddIndustryPanelProps) {
  const aiProvider = useSettingsStore((state) => state.settings.aiProvider);
  const ready = isAiProviderReady(aiProvider);
  const {
    input,
    primary,
    relations,
    selections,
    operation,
    status,
    error,
    liveReasoning,
    setInput,
    startReview,
    startRelationRecommendation,
    saveSelection,
    updateRelation,
    returnToChoice,
    reset,
  } = useIndustryAddStore();
  const busy = operation !== null;

  const selectedRelations = useMemo<IndustryRelationSelection[]>(
    () =>
      (relations ?? []).flatMap((suggestion) => {
        const selection = selections[relationKey(suggestion)];
        return selection?.checked ? [{ suggestion, mode: selection.mode }] : [];
      }),
    [relations, selections],
  );

  const submitReview = () => {
    if (ready) startReview(aiProvider);
  };

  const loadRelations = () => {
    startRelationRecommendation(aiProvider);
  };

  const save = (selected: IndustryRelationSelection[]) => {
    saveSelection(selected);
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <section className={`${styles.config} ${industryStyles.reviewPanel}`}>
      {primary === null ? (
        <form
          className={industryStyles.reviewForm}
          onSubmit={(event) => {
            event.preventDefault();
            void submitReview();
          }}
        >
          <div>
            <h2 className={styles.configTitle}>添加你关心的行业</h2>
            <p className={industryStyles.reviewHint}>
              第一步：AI 初审行业并推荐相关 RSS 信源，实际验证可用后继续。例如「新能源汽车」「汽车照明」。
            </p>
          </div>
          <div className={industryStyles.reviewRow}>
            <input
              className={`${styles.input} ${industryStyles.reviewInput}`}
              value={input}
              maxLength={40}
              disabled={busy}
              placeholder="输入行业名称"
              autoFocus
              onChange={(event) => setInput(event.target.value)}
            />
            <button
              type="submit"
              className={styles.saveBtn}
              disabled={!ready || busy || input.trim() === ""}
            >
              {busy ? "AI审核中" : "AI 初审"}
            </button>
            {canClose && (
              <button type="button" className={styles.back} disabled={busy} onClick={close}>
                取消
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className={industryStyles.reviewForm}>
          <div className={industryStyles.reviewSuccess}>
            <span className={industryStyles.stepBadge}>主行业初审通过</span>
            <h2 className={styles.configTitle}>「{primary.name}」</h2>
            <p className={industryStyles.reviewHint}>
              {primary.reason} 已验证 {primary.sources.length} 个主行业信源。
            </p>
          </div>

          {relations === null ? (
            <div className={industryStyles.relationChoice}>
              <div>
                <h3 className={industryStyles.relationTitle}>是否同时关注它的上下游？</h3>
                <p className={industryStyles.reviewHint}>
                  你可以只添加当前行业；也可以让 AI 列出一层上下游，再逐项决定并入当前日报或单独添加。
                </p>
              </div>
              <div className={industryStyles.choiceActions}>
                <button
                  type="button"
                  className={styles.back}
                  disabled={busy}
                  onClick={() => void save([])}
                >
                  只添加当前行业
                </button>
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={busy}
                  onClick={() => void loadRelations()}
                >
                  {busy ? "正在梳理上下游…" : "查看上下游建议"}
                </button>
                {canClose && (
                  <button type="button" className={styles.back} disabled={busy} onClick={close}>
                    取消
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className={industryStyles.relationPicker}>
              <div>
                <h3 className={industryStyles.relationTitle}>勾选要关注的条目，再选择日报方式</h3>
                <p className={industryStyles.reviewHint}>
                  默认均未勾选。只验证你选中的信源；「单独添加」不会再查询新行业的上下游。
                </p>
              </div>

              <div className={industryStyles.modeGuide}>
                <div>
                  <strong>并入「{primary.name}」</strong>
                  <span>同一份日报、同一个行业页签，并补充对应信源</span>
                </div>
                <div>
                  <strong>单独添加行业</strong>
                  <span>新增独立行业页签，分别抓取并生成日报</span>
                </div>
              </div>

              {relations.length === 0 ? (
                <p className={industryStyles.noRelations}>
                  AI 没有给出合适的上下游条目，你可以返回并只添加当前行业。
                </p>
              ) : (
                DIRECTIONS.map(({ direction, label, hint }) => {
                  const group = relations.filter((relation) => relation.direction === direction);
                  if (group.length === 0) return null;
                  return (
                    <section key={direction} className={industryStyles.relationGroup}>
                      <header className={industryStyles.relationGroupHead}>
                        <h4>{label}</h4>
                        <span>{hint}</span>
                      </header>
                      <div className={industryStyles.relationList}>
                        {group.map((relation) => {
                          const key = relationKey(relation);
                          const selection = selections[key] ?? { checked: false, mode: "merge" };
                          return (
                            <article
                              key={key}
                              className={
                                selection.checked
                                  ? `${industryStyles.relationCard} ${industryStyles.relationCardChecked}`
                                  : industryStyles.relationCard
                              }
                            >
                              <label className={industryStyles.relationCheck}>
                                <input
                                  type="checkbox"
                                  checked={selection.checked}
                                  disabled={busy}
                                  onChange={(event) =>
                                    updateRelation(key, { checked: event.target.checked })
                                  }
                                />
                                <span className={industryStyles.relationCopy}>
                                  <strong>{relation.name}</strong>
                                  <span>{relation.reason}</span>
                                  <small>
                                    {relation.sources.length} 个候选信源
                                    {relation.aliases.length > 0
                                      ? ` · 别称：${relation.aliases.join("、")}`
                                      : ""}
                                  </small>
                                </span>
                              </label>
                              <div className={industryStyles.modeOptions}>
                                <label className={industryStyles.modeOption}>
                                  <input
                                    type="radio"
                                    name={`mode-${key}`}
                                    checked={selection.mode === "merge"}
                                    disabled={busy || !selection.checked}
                                    onChange={() => updateRelation(key, { mode: "merge" })}
                                  />
                                  <span>并入当前行业 · 同一份日报</span>
                                </label>
                                <label className={industryStyles.modeOption}>
                                  <input
                                    type="radio"
                                    name={`mode-${key}`}
                                    checked={selection.mode === "separate"}
                                    disabled={busy || !selection.checked}
                                    onChange={() => updateRelation(key, { mode: "separate" })}
                                  />
                                  <span>单独添加行业 · 独立日报</span>
                                </label>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                })
              )}

              <div className={industryStyles.pickerActions}>
                <button type="button" className={styles.back} disabled={busy} onClick={returnToChoice}>
                  返回上一步
                </button>
                <button
                  type="button"
                  className={styles.back}
                  disabled={busy}
                  onClick={() => void save([])}
                >
                  只添加当前行业
                </button>
                {canClose && (
                  <button type="button" className={styles.back} disabled={busy} onClick={close}>
                    取消
                  </button>
                )}
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={busy || selectedRelations.length === 0}
                  onClick={() => void save(selectedRelations)}
                >
                  {busy
                    ? "正在验证并保存…"
                    : selectedRelations.length === 0
                      ? "请先勾选条目"
                      : `确认添加（已选 ${selectedRelations.length} 项）`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {busy && liveReasoning !== "" && (
        <div className={styles.reasoningBox}>
          <p className={styles.reasoningTitle}>模型思考过程 · 实时</p>
          <div className={styles.reasoningBody}>{liveReasoning}</div>
        </div>
      )}

      {status !== null && (
        <p className={industryStyles.reviewHint} role="status">
          {status}
        </p>
      )}
      {!ready && primary === null && (
        <p className={industryStyles.reviewHint}>先在右上角完成 API 设置，再进行初审。</p>
      )}
      {error !== null && (
        <p className={industryStyles.reviewError} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
