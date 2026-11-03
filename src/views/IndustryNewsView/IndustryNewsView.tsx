// 职责：行业资讯工具页 —— 行业 AI 初审与多行业日报。
// 复用洞察AI的年历贡献墙、API 配置、报告渲染、后台任务与生成日期规则；
// 行业页签只切换报告渠道，不改变当前选中日期，便于横向比较同一天的多个行业。

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConfirmDialog } from "@/components/ConfirmDialog/ConfirmDialog";
import { EditIcon, HistoryIcon, LoopIcon, PlusIcon, SettingsIcon } from "@/components/Icons";
import { industryChannelId } from "@/constants";
import { fromDateKey, todayKey, toDateKey } from "@/lib";
import {
  getDateAvailability,
  getReport,
  listIndustries,
  listReportStats,
  refreshIndustrySources,
  subscribeIndustries,
} from "@/services";
import { isAiProviderReady } from "@/services/aiService";
import {
  useIndustryAddStore,
  useInsightTaskStore,
  useSettingsStore,
  useTrashStore,
} from "@/stores";
import type { IndustryAddResult, IndustryProfile, InsightReport } from "@/types";
import {
  numberSectionItems,
  ProviderConfigForm,
  stripMarkdownLinks,
  YearCalendar,
} from "../InsightView/InsightView";
import styles from "../InsightView/InsightView.module.css";
import { AddIndustryPanel } from "./AddIndustryPanel";
import { IndustryManageDialog } from "./IndustryManageDialog";
import industryStyles from "./IndustryNewsView.module.css";

export function IndustryNewsView({ onBack }: { onBack: () => void }) {
  const [industries, setIndustries] = useState<IndustryProfile[]>([]);
  const [industriesLoaded, setIndustriesLoaded] = useState(false);
  const [selectedIndustryId, setSelectedIndustryId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());
  const [viewYear, setViewYear] = useState<number>(() => new Date().getFullYear());
  const [reportStats, setReportStats] = useState<Record<string, number>>({});
  const [report, setReport] = useState<InsightReport | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const [showAddIndustry, setShowAddIndustry] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<IndustryProfile | null>(null);

  const taskRunning = useInsightTaskStore((s) => s.running);
  const taskResult = useInsightTaskStore((s) => s.result);
  const startIndustry = useInsightTaskStore((s) => s.startIndustry);
  const clearResult = useInsightTaskStore((s) => s.clearResult);
  const addedResult = useIndustryAddStore((s) => s.addedResult);
  const clearAddedResult = useIndustryAddStore((s) => s.clearAddedResult);
  const addFlowActive = useIndustryAddStore(
    (s) =>
      s.operation !== null ||
      s.primary !== null ||
      s.relations !== null ||
      s.error !== null ||
      s.input.trim() !== "",
  );

  const aiProvider = useSettingsStore((s) => s.settings.aiProvider);
  const trashRetentionDays = useSettingsStore((s) => s.settings.trashRetentionDays);
  const moveIndustryToTrash = useTrashStore((s) => s.moveIndustryToTrash);
  const mergeIndustries = useTrashStore((s) => s.mergeIndustries);
  const ready = isAiProviderReady(aiProvider);
  const selectedIndustry = useMemo(
    () => industries.find((item) => item.id === selectedIndustryId) ?? null,
    [industries, selectedIndustryId],
  );
  const channelId = selectedIndustry === null ? null : industryChannelId(selectedIndustry.id);
  const taskForSelection =
    taskRunning !== null && taskRunning.channelId === channelId && taskRunning.dateKey === selectedDate
      ? taskRunning
      : null;
  const anyTaskRunning = taskRunning !== null;

  // 首次打开读取行业清单，默认选中最早添加的行业
  useEffect(() => {
    let active = true;
    void listIndustries().then((items) => {
      if (!active) return;
      setIndustries(items);
      // 后台添加结果可能先于本次磁盘读取落地，不覆盖它已经选中的主行业
      setSelectedIndustryId((current) => current ?? items[0]?.id ?? null);
      setIndustriesLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // 后台补源 / 换源等保存后刷新行业清单（当前选中行业 id 不变，自动命中新数据）
  useEffect(
    () =>
      subscribeIndustries(() => {
        void listIndustries().then(setIndustries);
      }),
    [],
  );

  const loadedToday = useMemo(
    () => (report?.loadHistory ?? []).some((r) => toDateKey(new Date(r.at)) === todayKey()),
    [report],
  );
  const availability = useMemo(
    () =>
      selectedIndustry === null
        ? { allowed: false, reason: "先添加一个行业" }
        : getDateAvailability(selectedDate, new Date(), loadedToday),
    [selectedIndustry, selectedDate, loadedToday],
  );
  const selectedLabel = format(fromDateKey(selectedDate), "M月d日");

  const reloadDates = () => {
    if (channelId === null) {
      setReportStats({});
      return;
    }
    void listReportStats(channelId).then(setReportStats);
  };

  // 行业切换后刷新该行业的贡献墙；日期保持不变
  useEffect(() => {
    setReportStats({});
    reloadDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // 选中日期 / 行业变化时载入对应报告，加载期间不展示上一份报告
  useEffect(() => {
    setReport(null);
    setGenError(null);
    if (channelId === null) return;
    let active = true;
    void getReport(channelId, selectedDate).then((next) => {
      if (active) setReport(next);
    });
    return () => {
      active = false;
    };
  }, [channelId, selectedDate]);

  useEffect(() => {
    if (!ready) setShowConfig(true);
  }, [ready]);

  // 配置悬浮窗：点外部任意处关闭
  const gearWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showConfig) return;
    const onPointerDown = (event: MouseEvent) => {
      if (gearWrapRef.current !== null && !gearWrapRef.current.contains(event.target as Node)) {
        setShowConfig(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showConfig]);

  // 后台任务落地：当前行业+日期直接替换报告；其他行业仅提示，切回时会重新读取
  useEffect(() => {
    if (taskResult === null) return;
    const { kind, channelId: resultChannel, channelLabel, dateKey: resultDate } = taskResult;
    if (resultChannel === channelId) reloadDates();
    if (resultChannel === channelId && resultDate === selectedDate) {
      if (kind === "ok") {
        setReport(taskResult.report);
        setInfoMsg(null);
        setGenError(null);
      } else if (kind === "info") {
        setInfoMsg(taskResult.message);
        setGenError(null);
      } else {
        setGenError(taskResult.message);
      }
    } else if (kind === "ok") {
      setInfoMsg(
        `后台已生成 ${format(fromDateKey(resultDate), "M月d日")} ${channelLabel}，切换到对应行业即可查看。`,
      );
    } else if (kind === "error") {
      setInfoMsg(
        `后台生成 ${format(fromDateKey(resultDate), "M月d日")} ${channelLabel}失败：${taskResult.message}`,
      );
    }
    clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskResult?.seq]);

  const generate = () => {
    if (selectedIndustry === null) return;
    setInfoMsg(null);
    setGenError(null);
    startIndustry(selectedIndustry, aiProvider, selectedDate, report);
  };

  const handleIndustryAdded = (result: IndustryAddResult) => {
    const { primary, separateIndustries } = result;
    setIndustries((current) => {
      const knownIds = new Set(current.map((item) => item.id));
      const added = [primary, ...separateIndustries].filter((item) => !knownIds.has(item.id));
      return [...current, ...added];
    });
    setSelectedIndustryId(primary.id);
    setShowAddIndustry(false);
    const messages = [`已添加「${primary.name}」`];
    if (primary.includedTopics.length > 0) {
      messages.push(`并入 ${primary.includedTopics.length} 个上下游主题，共用主行业日报`);
    }
    if (separateIndustries.length > 0) {
      messages.push(`另新增 ${separateIndustries.length} 个独立行业`);
    }
    setInfoMsg(`${messages.join("；")}。`);
    setGenError(null);
  };

  // 添加流程在后台完成时，即使页面刚重新挂载也能消费结果并选回主行业
  useEffect(() => {
    if (addedResult === null) return;
    handleIndustryAdded(addedResult.result);
    clearAddedResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addedResult?.seq]);

  // 二次确认后，行业、全部日报与素材归档作为一个快照移入回收站
  const confirmDelete = async () => {
    if (pendingDelete === null) return;
    const target = pendingDelete;
    if (taskRunning?.channelId === industryChannelId(target.id)) {
      setPendingDelete(null);
      setGenError("该行业正在生成日报，完成后再删除");
      return;
    }
    try {
      await moveIndustryToTrash(target.id);
      const next = industries.filter((item) => item.id !== target.id);
      setIndustries(next);
      if (selectedIndustryId === target.id) {
        setSelectedIndustryId(next[0]?.id ?? null);
        setReport(null);
        setReportStats({});
      }
      setGenError(null);
      setInfoMsg(`「${target.name}」及其日报已移入回收站。`);
      setPendingDelete(null);
    } catch (error) {
      setPendingDelete(null);
      setGenError(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleMerge = async (
    industryIds: string[],
    onProgress: (line: string) => void,
    onReasoning: (accumulated: string) => void,
  ): Promise<IndustryProfile> => {
    const merged = await mergeIndustries(industryIds, aiProvider, onProgress, onReasoning);
    const mergedIds = new Set(industryIds);
    setIndustries((current) => [
      ...current.filter((industry) => !mergedIds.has(industry.id)),
      merged,
    ]);
    setSelectedIndustryId(merged.id);
    setReport(null);
    setReportStats({});
    setGenError(null);
    setInfoMsg(`已创建合并行业「${merged.name}」；全部历史日报已迁入，原始行业快照已分别保留在回收站。`);
    setShowManage(false);
    return merged;
  };

  // 管理弹窗换源：替换该行业信源并刷新本地清单，历史日报不动
  const handleRetarget = async (
    industry: IndustryProfile,
    onProgress: (line: string) => void,
    onReasoning: (accumulated: string) => void,
  ): Promise<IndustryProfile> => {
    const next = await refreshIndustrySources(industry.id, aiProvider, onProgress, onReasoning);
    setIndustries((current) => current.map((item) => (item.id === next.id ? next : item)));
    setInfoMsg(null);
    return next;
  };

  // 页面重新挂载时自动展开尚未结束的添加流程，直接接上后台进度或初审结果
  const addPanelVisible =
    showAddIndustry || addFlowActive || (industriesLoaded && industries.length === 0);

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={onBack}>
          ← 返回
        </button>
        <h1 className={styles.title}>行业资讯</h1>
        <div className={styles.gearWrap} ref={gearWrapRef}>
          <button
            type="button"
            className={showConfig ? styles.gearActive : styles.gear}
            onClick={() => setShowConfig((v) => !v)}
            aria-label="API 设置"
            title="配置 AI 接口（服务地址 / Key / 模型）"
          >
            <SettingsIcon size={16} />
          </button>
          {showConfig && (
            <div className={styles.popover}>
              <ProviderConfigForm onSaved={() => setShowConfig(false)} />
            </div>
          )}
        </div>
      </header>

      {industries.length > 0 && (
        <nav className={`${styles.tabs} ${industryStyles.industryTabs}`} aria-label="已添加行业">
          {industries.map((industry) => (
            <button
              key={industry.id}
              type="button"
              className={industry.id === selectedIndustryId ? styles.tabActive : styles.tab}
              title={`${industry.reviewNote}${industry.includedTopics.length > 0 ? `\n并入：${industry.includedTopics.join("、")}` : ""}\n信源：${industry.sources.map((source) => source.name).join("、") || "未配置"}`}
              onClick={() => {
                setSelectedIndustryId(industry.id);
                setInfoMsg(null);
                setGenError(null);
              }}
            >
              <HistoryIcon size={14} />
              {industry.name}
            </button>
          ))}
          <button
            type="button"
            className={industryStyles.addIndustryBtn}
            onClick={() => setShowAddIndustry((value) => !value)}
          >
            <PlusIcon size={14} />
            添加行业
          </button>
          <button
            type="button"
            className={industryStyles.addIndustryBtn}
            onClick={() => setShowManage(true)}
          >
            <EditIcon size={14} />
            编辑
          </button>
        </nav>
      )}

      {addPanelVisible && (
        <AddIndustryPanel
          canClose={industries.length > 0}
          onClose={() => setShowAddIndustry(false)}
        />
      )}

      {selectedIndustry === null ? (
        industriesLoaded && !addPanelVisible ? (
          <div className={industryStyles.emptyIndustry}>
            <HistoryIcon size={28} />
            <p>先添加一个你关心的行业</p>
            <button type="button" className={styles.saveBtn} onClick={() => setShowAddIndustry(true)}>
              <PlusIcon size={14} />
              添加行业
            </button>
          </div>
        ) : null
      ) : addPanelVisible ? null : (
        <div className={styles.frame}>
          <aside className={styles.rail}>
            <div className={styles.yearNav}>
              <button
                type="button"
                className={styles.yearNavBtn}
                onClick={() => setViewYear(viewYear - 1)}
                aria-label="上一年"
              >
                ‹
              </button>
              <span className={styles.yearLabel}>{viewYear}年</span>
              <button
                type="button"
                className={styles.yearNavBtn}
                disabled={viewYear >= new Date().getFullYear()}
                onClick={() => setViewYear(viewYear + 1)}
                aria-label="下一年"
              >
                ›
              </button>
            </div>
            <YearCalendar
              year={viewYear}
              stats={reportStats}
              selectedDate={selectedDate}
              onSelect={(key) => {
                setSelectedDate(key);
                setInfoMsg(null);
                setGenError(null);
              }}
            />
            <p className={styles.railHint}>格子数字为当日报告成文的资讯条数；今日 12:00 前可补昨日。</p>
          </aside>

          <section className={styles.detail}>
            <p className={styles.detailTitle}>
              {selectedLabel}
              {selectedDate === todayKey() ? "（今天）" : ""} · {selectedIndustry.name}日报
            </p>

            {taskForSelection !== null && taskForSelection.progLines.length > 0 && (
              <ul className={styles.progList}>
                {taskForSelection.progLines.map((line, i) => (
                  <li
                    key={i}
                    className={i === taskForSelection.progLines.length - 1 ? styles.progActive : undefined}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}

            {taskRunning !== null && taskForSelection === null && (
              <div className={styles.infoBox}>
                正在后台生成 {format(fromDateKey(taskRunning.dateKey), "M月d日")} {taskRunning.channelLabel}
                ，可切去其他页面，完成后对应行业的年历自动打标。
              </div>
            )}

            {taskForSelection !== null && taskForSelection.liveReasoning !== "" && (
              <div className={styles.reasoningBox}>
                <p className={styles.reasoningTitle}>模型思考过程 · 实时</p>
                <div className={styles.reasoningBody}>{taskForSelection.liveReasoning}</div>
              </div>
            )}

            {taskForSelection !== null && taskForSelection.liveContent !== "" && (
              <article className={`${styles.reportCard} ${styles.reportLive}`}>
                <div className={styles.reportMeta}>
                  <span>生成中 · 实时预览</span>
                </div>
                <div className={styles.markdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {stripMarkdownLinks(numberSectionItems(taskForSelection.liveContent))}
                  </ReactMarkdown>
                </div>
              </article>
            )}

            {infoMsg !== null && <div className={styles.infoBox}>{infoMsg}</div>}

            {genError !== null && (
              <div className={styles.errorBox}>
                <p className={styles.errorTitle}>生成失败</p>
                <p className={styles.errorMsg}>{genError}</p>
              </div>
            )}

            {taskForSelection === null && report !== null && (
              <article className={styles.reportCard}>
                <div className={styles.reportMeta}>
                  <span>{format(fromDateKey(report.date), "yyyy年M月d日")}</span>
                  <span>{report.model}</span>
                  <span>本批素材 {report.sourceCount} 条</span>
                  <span>已加载 {report.loadHistory.length} 次</span>
                  <span>最近更新 {format(new Date(report.generatedAt), "HH:mm")}</span>
                </div>
                <div className={styles.markdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {stripMarkdownLinks(numberSectionItems(report.content))}
                  </ReactMarkdown>
                </div>
              </article>
            )}

            {taskForSelection === null && report === null && (
              <div className={styles.empty}>
                <HistoryIcon size={28} />
                <p>{selectedLabel}还没有{selectedIndustry.name}日报。</p>
                <p className={styles.emptyHint}>
                  {availability.allowed
                    ? "点击下方按钮，实时抓取资讯并生成。"
                    : "该日期暂不可生成，请在年历中选择其他日期。"}
                </p>
              </div>
            )}

            {(selectedDate === todayKey() || availability.allowed) && (
              <footer className={styles.actions}>
                {ready && !availability.allowed && (
                  <span className={styles.staleHint}>{availability.reason}</span>
                )}
                {!ready && <span className={styles.staleHint}>先在右上角完成 API 设置</span>}
                <button
                  type="button"
                  className={styles.refreshBtn}
                  disabled={!ready || !availability.allowed || anyTaskRunning}
                  onClick={generate}
                >
                  <LoopIcon size={15} />
                  {selectedDate === todayKey() && report !== null
                    ? "更新今日日报"
                    : report === null
                      ? `生成 ${selectedLabel} 日报`
                      : `补充 ${selectedLabel} 日报`}
                </button>
              </footer>
            )}
          </section>
        </div>
      )}

      <IndustryManageDialog
        opened={showManage}
        industries={industries}
        aiReady={ready}
        retentionDays={trashRetentionDays}
        runningChannelId={taskRunning?.channelId ?? null}
        onClose={() => setShowManage(false)}
        onDelete={setPendingDelete}
        onRetarget={handleRetarget}
        onMerge={handleMerge}
      />

      <ConfirmDialog
        opened={pendingDelete !== null}
        title="删除行业"
        message={
          pendingDelete !== null ? (
            <>
              行业「<strong>{pendingDelete.name}</strong>」及其全部日报将一起移入回收站，
              保留 {trashRetentionDays} 天。到期前可在回收站还原或彻底删除。
            </>
          ) : (
            ""
          )
        }
        confirmLabel="移入回收站"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
