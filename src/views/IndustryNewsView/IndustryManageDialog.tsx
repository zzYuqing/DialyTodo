// 职责：行业资讯的统一管理弹窗 —— 单个行业删除、换源与多行业 AI 合并。
// 页签不再堆放删除按钮；合并会新建行业，原行业及历史日报进入回收站，操作可恢复。

import { Button, Modal } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog/ConfirmDialog";
import { CloseIcon, LoopIcon, TrashIcon } from "@/components/Icons";
import { industryChannelId } from "@/constants";
import type { IndustryProfile } from "@/types";
import styles from "../InsightView/InsightView.module.css";
import industryStyles from "./IndustryNewsView.module.css";

interface IndustryManageDialogProps {
  opened: boolean;
  industries: IndustryProfile[];
  aiReady: boolean;
  retentionDays: number;
  runningChannelId: string | null;
  onClose: () => void;
  onDelete: (industry: IndustryProfile) => void;
  onRetarget: (
    industry: IndustryProfile,
    onProgress: (line: string) => void,
    onReasoning: (accumulated: string) => void,
  ) => Promise<IndustryProfile>;
  onMerge: (
    industryIds: string[],
    onProgress: (line: string) => void,
    onReasoning: (accumulated: string) => void,
  ) => Promise<IndustryProfile>;
}

export function IndustryManageDialog({
  opened,
  industries,
  aiReady,
  retentionDays,
  runningChannelId,
  onClose,
  onDelete,
  onRetarget,
  onMerge,
}: IndustryManageDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingMerge, setPendingMerge] = useState(false);
  const [merging, setMerging] = useState(false);
  const [retargetingId, setRetargetingId] = useState<string | null>(null);
  const [retargetConfirm, setRetargetConfirm] = useState<IndustryProfile | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");

  useEffect(() => {
    if (!opened) return;
    setSelectedIds([]);
    setPendingMerge(false);
    setMerging(false);
    setRetargetingId(null);
    setRetargetConfirm(null);
    setShowHelp(false);
    setStatus(null);
    setError(null);
    setReasoning("");
  }, [opened]);

  const selectedIndustries = useMemo(
    () => industries.filter((industry) => selectedIds.includes(industry.id)),
    [industries, selectedIds],
  );
  const selectedRunning = selectedIndustries.some(
    (industry) => runningChannelId === industryChannelId(industry.id),
  );

  const toggle = (industryId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, industryId] : current.filter((id) => id !== industryId),
    );
    setError(null);
  };

  const close = () => {
    if (!merging && retargetingId === null) onClose();
  };

  // 换源：AI 重新推荐信源并实测，成功后整体替换该行业信源，历史日报不动
  const retarget = async (industry: IndustryProfile) => {
    if (retargetingId !== null || merging) return;
    setRetargetConfirm(null);
    setRetargetingId(industry.id);
    setStatus(null);
    setError(null);
    setReasoning("");
    try {
      const next = await onRetarget(industry, setStatus, setReasoning);
      setStatus(`「${next.name}」信源已更新为：${next.sources.map((source) => source.name).join("、")}。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRetargetingId(null);
    }
  };

  const merge = async () => {
    if (selectedIds.length < 2 || merging || selectedRunning) return;
    setPendingMerge(false);
    setMerging(true);
    setStatus(null);
    setError(null);
    setReasoning("");
    try {
      await onMerge(selectedIds, setStatus, setReasoning);
      setSelectedIds([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMerging(false);
    }
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={close}
        title={
          <div className={industryStyles.manageTitle}>
            <span>管理行业</span>
            <span className={industryStyles.manageHeaderActions}>
              <button
                type="button"
                className={industryStyles.headerIconBtn}
                title="帮助"
                aria-label="帮助"
                aria-expanded={showHelp}
                onClick={() => setShowHelp((value) => !value)}
              >
                ?
              </button>
              <button
                type="button"
                className={industryStyles.headerIconBtn}
                title={merging || retargetingId !== null ? "操作进行中，暂不能关闭" : "关闭"}
                aria-label="关闭管理行业弹窗"
                disabled={merging || retargetingId !== null}
                onClick={close}
              >
                <CloseIcon size={16} />
              </button>
            </span>
          </div>
        }
        centered
        size="lg"
        withCloseButton={false}
        classNames={{ title: industryStyles.modalTitle }}
        closeOnClickOutside={!merging && retargetingId === null}
        closeOnEscape={!merging && retargetingId === null}
      >
        <div className={industryStyles.managePanel}>
          <div className={industryStyles.manageList}>
            {industries.map((industry) => {
              const running = runningChannelId === industryChannelId(industry.id);
              const checked = selectedIds.includes(industry.id);
              return (
                <div
                  key={industry.id}
                  className={
                    checked
                      ? `${industryStyles.manageRow} ${industryStyles.manageRowChecked}`
                      : industryStyles.manageRow
                  }
                >
                  <label className={industryStyles.manageCheck}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={merging || retargetingId !== null}
                      onChange={(event) => toggle(industry.id, event.target.checked)}
                    />
                    <span className={industryStyles.relationCopy}>
                      <strong>{industry.name}</strong>
                      <small>
                        {industry.sources.length} 个信源
                        {industry.includedTopics.length > 0
                          ? ` · 已并入：${industry.includedTopics.join("、")}`
                          : ""}
                        {running ? " · 正在生成日报" : ""}
                      </small>
                    </span>
                  </label>
                  <span className={industryStyles.manageRowActions}>
                    <button
                      type="button"
                      className={industryStyles.manageDeleteBtn}
                      disabled={merging || retargetingId !== null || running || !aiReady}
                      title="换源"
                      aria-label={`换源 ${industry.name}`}
                      onClick={() => setRetargetConfirm(industry)}
                    >
                      {retargetingId === industry.id ? "…" : <LoopIcon size={15} />}
                    </button>
                    <button
                      type="button"
                      className={industryStyles.manageDeleteBtn}
                      disabled={merging || retargetingId !== null || running}
                      title="删除"
                      aria-label={`删除行业 ${industry.name}`}
                      onClick={() => onDelete(industry)}
                    >
                      <TrashIcon size={15} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {showHelp && (
            <div className={industryStyles.helpPanel}>
              <p className={industryStyles.helpEntry}>
                <strong>换源</strong>
                <span>
                  AI 针对该行业重新推荐 RSS / Atom 信源，系统逐个实际抓取验证后整体替换旧信源；行业名称、关注范围与历史日报都不变，从下一次生成开始使用新信源。
                </span>
              </p>
              <p className={industryStyles.helpEntry}>
                <strong>合并</strong>
                <span>
                  勾选至少两个行业后合并为一个新行业：AI 整理新行业名称、关注范围并合并已有信源，系统重新验证；全部历史日报迁入新行业，同一天有多份时由
                  AI 逐日去重整合，历史较多时耗时较长。原行业与原始日报快照仍在回收站保留 {retentionDays} 天。
                </span>
              </p>
              <p className={industryStyles.helpEntry}>
                <strong>删除</strong>
                <span>
                  删除行业及其全部日报与素材归档，作为一个完整快照移入回收站，保留 {retentionDays}{" "}
                  天；期间可随时还原，到期后彻底删除。
                </span>
              </p>
            </div>
          )}

          {(merging || retargetingId !== null) && reasoning !== "" && (
            <div className={styles.reasoningBox}>
              <p className={styles.reasoningTitle}>模型思考过程 · 实时</p>
              <div className={styles.reasoningBody}>{reasoning}</div>
            </div>
          )}
          {status !== null && (
            <p className={industryStyles.reviewHint} role="status">
              {status}
            </p>
          )}
          {error !== null && (
            <p className={industryStyles.reviewError} role="alert">
              {error}
            </p>
          )}
          {!aiReady && <p className={industryStyles.reviewHint}>请先完成 API 设置，再合并行业。</p>}
          {selectedRunning && (
            <p className={industryStyles.reviewError}>所选行业正在生成日报，完成后才能合并。</p>
          )}

          <div className={industryStyles.manageActions}>
            <span className={industryStyles.manageStatus}>
              {retargetingId !== null
                ? "换源中，请勿关闭弹窗"
                : selectedIds.length > 0
                  ? `已选 ${selectedIds.length} 个行业`
                  : "勾选行业以合并"}
            </span>
            <Button variant="default" disabled={merging || retargetingId !== null} onClick={close}>
              完成
            </Button>
            <span title={selectedIds.length < 2 && !merging ? "至少选中两个行业" : undefined}>
              <Button
                loading={merging}
                disabled={
                  !aiReady || selectedIds.length < 2 || selectedRunning || merging || retargetingId !== null
                }
                onClick={() => setPendingMerge(true)}
              >
                {merging ? "AI 合并中" : "合并"}
              </Button>
            </span>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        opened={retargetConfirm !== null}
        title="确认换源"
        confirmLabel="开始换源"
        confirmVariant="primary"
        message={
          retargetConfirm !== null ? (
            <>
              「<strong>{retargetConfirm.name}</strong>」当前信源：
              <br />
              {retargetConfirm.sources.map((source) => source.name).join("、") || "无"}
              <br />
              确认后 AI 将重新推荐信源，系统实测通过后整体替换以上信源；行业名称、关注范围与历史日报不变。
            </>
          ) : (
            ""
          )
        }
        onConfirm={() => {
          const target = retargetConfirm;
          if (target !== null) void retarget(target);
        }}
        onCancel={() => setRetargetConfirm(null)}
      />

      <ConfirmDialog
        opened={pendingMerge}
        title="确认合并行业"
        message={
          <>
            将新建一个合并行业，并迁入「
            <strong>{selectedIndustries.map((industry) => industry.name).join("、")}</strong>
            」的全部历史日报；同一天的多份日报会由 AI 逐日整合。原行业和原始日报快照会保留在回收站，验证或整合失败则不修改现有数据。
          </>
        }
        confirmLabel="开始 AI 合并"
        confirmVariant="primary"
        onConfirm={() => void merge()}
        onCancel={() => setPendingMerge(false)}
      />
    </>
  );
}
