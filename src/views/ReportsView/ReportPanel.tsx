// 职责：AI 报告页右栏 —— 查看态 / 新建报告编辑器 两态。
// 合并原「生成周报」与「自定义范围」两个入口（2026-11-04；同年再砍掉「按周/自定义」切换，
// 自定义区间本就覆盖按周，只留起止日期 + 「本周」快捷按钮）：
// 整周归自然周 key、其余归 custom 区间 key，统一由 resolveReportKey 按区间判定，避免同一周存两份。
// 素材唯一来源 collectDoneItems；生成走模块级任务 store（切页不中断）；
// 流式预览 / Markdown 后处理复用 InsightView 的既有能力，保证排版一致。

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  addDaysToKey,
  collectDoneItems,
  formatDoneAt,
  formatMonthDay,
  isNaturalWeekRange,
  resolveReportKey,
  todayKey,
  weekEndOf,
  weekStartOf,
} from "@/lib";
import { isAiProviderReady } from "@/services";
import { useReportTaskStore, useSettingsStore, useTaskStore } from "@/stores";
import { ConfirmDialog } from "@/components/ConfirmDialog/ConfirmDialog";
import type { WeeklyReport } from "@/types";
// 报告正文按模型原样渲染（只去 Markdown 链接）：模板已要求模型自己输出有序列表，
// 洞察日报的 numberSectionItems 会再叠加一层「1. 2.」编号，套到报告上会与模型编号混排。
import { stripMarkdownLinks } from "../InsightView/InsightView";
import insightStyles from "../InsightView/InsightView.module.css";
import styles from "./ReportsView.module.css";
import { TemplateSection } from "./TemplateSection";

/** 编辑器的区间（受控，容器持有）；自然周 / 自定义由 resolveReportKey 按区间归一 */
export interface ComposeRange {
  start: string;
  end: string;
}

interface ReportPanelProps {
  /** 当前查看的已生成报告；null = 不在查看态 */
  report: WeeklyReport | null;
  /** 是否处于新建报告（编辑器）态 */
  composing: boolean;
  /** 编辑器的区间与取法（受控） */
  compose: ComposeRange;
  onComposeChange: (next: ComposeRange) => void;
  /** 该 key 是否已有报告（决定「生成将覆盖」提示与按钮文案） */
  hasReport: (key: string) => boolean;
  /** 生成成功：容器切到该报告 */
  onGenerated: (key: string) => void;
  reload: () => void;
}

export function ReportPanel({
  report,
  composing,
  compose,
  onComposeChange,
  hasReport,
  onGenerated,
  reload,
}: ReportPanelProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const aiProvider = useSettingsStore((s) => s.settings.aiProvider);
  const templates = useSettingsStore((s) => s.settings.reportTemplates);
  const updateSettings = useSettingsStore((s) => s.update);

  const running = useReportTaskStore((s) => s.running);
  const result = useReportTaskStore((s) => s.result);
  const clearResult = useReportTaskStore((s) => s.clearResult);
  const startTask = useReportTaskStore((s) => s.start);

  const ready = isAiProviderReady(aiProvider);
  const today = todayKey();
  const thisWeekStart = weekStartOf(today);

  // 模板库：当前生效模板（"default" = 内置默认模板；其余为库条目 id）
  const [selectedTemplateId, setSelectedTemplateId] = useState("default");
  const [genError, setGenError] = useState<string | null>(null);
  /** 重新生成的二次确认弹窗：覆盖会丢掉旧报告，不可恢复 */
  const [confirmRegen, setConfirmRegen] = useState(false);

  /** 当前生效模板的内容："default" 或条目缺失时回空串（= 内置默认模板口径） */
  const activeTemplateContent =
    selectedTemplateId === "default"
      ? ""
      : (templates.find((t) => t.id === selectedTemplateId)?.content ?? "");
  /** 按模板 id 解析内容（重新生成用）：模板已被删除时回落默认口径 */
  const templateContentById = (id: string) =>
    id === "default" ? "" : (templates.find((t) => t.id === id)?.content ?? "");
  const templateLabelById = (id: string) =>
    id === "default" ? "官方模板" : (templates.find((t) => t.id === id)?.name ?? "自定义模板");

  // 当前区间：编辑态用 compose；查看态用报告的起止
  const rangeStart = composing ? compose.start : (report?.start ?? today);
  const rangeEnd = composing ? compose.end : (report?.end ?? today);
  const material = useMemo(
    () => collectDoneItems(tasks, rangeStart, rangeEnd),
    [tasks, rangeStart, rangeEnd],
  );

  // 当前活动 key：编辑态 = 区间归一的 key；查看态 = 报告 key
  const activeKey = composing
    ? resolveReportKey(rangeStart, rangeEnd, today)
    : (report?.key ?? null);
  const taskForActive =
    running !== null && activeKey !== null && running.key === activeKey ? running : null;
  const anyRunning = running !== null;

  const isNaturalWeek = isNaturalWeekRange(rangeStart, rangeEnd, today);
  const overwrite = composing && activeKey !== null && hasReport(activeKey);
  const canGenerate =
    ready && !anyRunning && material.totalDone > 0 && rangeStart <= rangeEnd && rangeEnd <= today;

  // 生成结果：失败显示错误；成功刷新列表，编辑态则切到该报告
  useEffect(() => {
    if (result === null) return;
    if (result.kind === "error" && result.key === activeKey) {
      setGenError(result.message);
    }
    if (result.kind === "ok" && result.key === activeKey) {
      setGenError(null);
      reload();
      if (composing) onGenerated(result.key);
    }
    clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.seq]);

  const handleGenerate = () => {
    if (!canGenerate || activeKey === null) return;
    setGenError(null);
    startTask({
      key: activeKey,
      kind: isNaturalWeek ? "natural" : "custom",
      start: rangeStart,
      end: rangeEnd,
      material,
      config: aiProvider,
      template: activeTemplateContent,
      templateId: selectedTemplateId,
    });
  };

  const handleRegenerate = () => {
    if (report === null || !ready || anyRunning) return;
    setGenError(null);
    startTask({
      key: report.key,
      kind: report.kind,
      start: report.start,
      end: report.end,
      material: collectDoneItems(tasks, report.start, report.end),
      config: aiProvider,
      // 沿用该报告当初的模板口径：按 templateId 从模板库回查，模板已删除回落默认
      template: templateContentById(report.templateId),
      templateId: report.templateId,
    });
  };

  // ---- 范围控件回调 ----
  const jumpThisWeek = () => {
    // 本周到「今天」为止：生成只允许统计已过去的日子，end 不能超过今天
    const we = weekEndOf(thisWeekStart) > today ? today : weekEndOf(thisWeekStart);
    onComposeChange({ start: thisWeekStart, end: we });
  };

  // 过去 N 天：以今天为终点，往前倒 (N-1) 天，区间共 N 天（含今天）。
  // end 恒为今天，start 必然 <= end 且 <= today，天然满足生成闸门。
  const jumpPastDays = (days: number) => {
    onComposeChange({ start: addDaysToKey(today, -(days - 1)), end: today });
  };

  // ---------- 空态（既不在编辑也没有报告） ----------
  if (!composing && report === null) {
    return (
      <section className={styles.panel}>
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>还没有查看中的报告</p>
          <p className={styles.emptyHint}>从左侧选择一份已生成的报告，或点「＋ 新建报告」开始。</p>
        </div>
      </section>
    );
  }

  // ---------- 查看态 ----------
  if (!composing && report !== null) {
    const templateLabel = templateLabelById(report.templateId);
    return (
      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <h1 className={styles.panelTitle}>
            {formatMonthDay(report.start)} – {formatMonthDay(report.end)}
          </h1>
          <p className={styles.panelMeta}>
            {`已完成 ${report.doneCount} 项 · ${templateLabel} · 生成于 ${
              formatDoneAt(report.generatedAt) ?? ""
            }`}
          </p>
        </header>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnGhost}
            disabled={!ready || anyRunning}
            onClick={() => setConfirmRegen(true)}
            title={ready ? "重新生成并覆盖这份报告" : "请先完成 API 设置"}
          >
            重新生成
          </button>
          {/* 生成中隐藏复制：此时复制到的是旧稿，且思考过程不需要复制入口 */}
          {taskForActive === null && <CopyButton content={report.content} />}
        </div>

        {/* 重新生成 = 覆盖旧报告且不可恢复，走通用二次确认弹窗 */}
        <ConfirmDialog
          opened={confirmRegen}
          title="覆盖这份报告？"
          confirmLabel="重新生成并覆盖"
          confirmVariant="danger"
          message={
            <>
              重新生成会直接替换当前报告，<strong>原报告将被删除且无法恢复</strong>。
            </>
          }
          onConfirm={() => {
            setConfirmRegen(false);
            handleRegenerate();
          }}
          onCancel={() => setConfirmRegen(false)}
        />

        {taskForActive !== null && <ReasoningBox text={taskForActive.liveReasoning} />}

        <div className={styles.reportCard}>
          {taskForActive !== null ? (
            taskForActive.liveContent.trim() === "" ? (
              <GeneratingMeta
                key={taskForActive.key}
                contentChars={taskForActive.liveContent.length}
                reasoningChars={taskForActive.liveReasoning.length}
              />
            ) : (
              <div className={insightStyles.markdown}>
                <ReactMarkdown>{taskForActive.liveContent}</ReactMarkdown>
              </div>
            )
          ) : (
            <div className={insightStyles.markdown}>
              <ReactMarkdown>{stripMarkdownLinks(report.content)}</ReactMarkdown>
            </div>
          )}
        </div>

        {genError !== null && <p className={styles.errorBox}>{genError}</p>}
      </section>
    );
  }

  // ---------- 编辑态：正在生成（流式预览，隐藏表单） ----------
  if (composing && taskForActive !== null) {
    return (
      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <h1 className={styles.panelTitle}>
            {formatMonthDay(rangeStart)} – {formatMonthDay(rangeEnd)}
          </h1>
          <GeneratingMeta
            key={taskForActive.key}
            contentChars={taskForActive.liveContent.length}
            reasoningChars={taskForActive.liveReasoning.length}
          />
        </header>
        <ReasoningBox text={taskForActive.liveReasoning} />
        <div className={styles.reportCard}>
          {taskForActive.liveContent.trim() === "" ? (
            <p className={styles.generating}>正在等待模型返回首个字符…</p>
          ) : (
            <div className={insightStyles.markdown}>
              <ReactMarkdown>{taskForActive.liveContent}</ReactMarkdown>
            </div>
          )}
        </div>
        {genError !== null && <p className={styles.errorBox}>{genError}</p>}
      </section>
    );
  }

  // ---------- 编辑态：新建报告表单（单卡分步 · 版本 C） ----------
  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <h1 className={styles.panelTitle}>新建报告</h1>
        <p className={styles.panelMeta}>基于本机已完成事项生成总结</p>
      </header>

      {/* 单张外卡：用 ①②③ 步骤号串起「选时间 → 选模板 → 生成」 */}
      <div className={styles.composeCard}>
        {/* 步骤 1：时间范围 */}
        <div className={styles.composeStep}>
          <div className={styles.stepHead}>
            <span className={styles.stepNum}>1</span>
            <span className={styles.stepTitle}>选择时间范围</span>
          </div>
          <div className={styles.dateRow}>
            <span className={styles.dateWrap}>
              <CalendarIcon />
              <input
                type="date"
                className={styles.dateInput}
                value={compose.start}
                max={compose.end}
                onChange={(e) => onComposeChange({ ...compose, start: e.target.value })}
                aria-label="开始日期"
              />
            </span>
            <span className={styles.dateSep}>至</span>
            <span className={styles.dateWrap}>
              <CalendarIcon />
              <input
                type="date"
                className={styles.dateInput}
                value={compose.end}
                min={compose.start}
                max={today}
                onChange={(e) => onComposeChange({ ...compose, end: e.target.value })}
                aria-label="结束日期"
              />
            </span>
            {/* 快捷区间：永远可点，重填同区间无副作用 */}
            <button
              type="button"
              className={styles.thisWeekBtn}
              onClick={jumpThisWeek}
              title="填入本周：从周一到今天"
            >
              本周
            </button>
            <button
              type="button"
              className={styles.thisWeekBtn}
              onClick={() => jumpPastDays(7)}
              title="以今天为终点，往前倒 7 天"
            >
              过去7天
            </button>
            <button
              type="button"
              className={styles.thisWeekBtn}
              onClick={() => jumpPastDays(5)}
              title="以今天为终点，往前倒 5 天"
            >
              过去5天
            </button>
          </div>

          <p className={styles.rangeSummary}>
            {material.totalDone > 0
              ? `已完成 ${material.totalDone} 项 · 去重 ${material.itemCount} 个事项 · 有记录 ${material.activeDays} 天`
              : "这一区间没有完成记录"}
          </p>
          {overwrite && <p className={styles.overwriteTip}>该区间已有报告，生成将覆盖旧稿</p>}
        </div>

        {/* 步骤 2：报告模板（标题交给步骤号，隐藏区块自带图例避免重复） */}
        <div className={styles.composeStep}>
          <div className={styles.stepHead}>
            <span className={styles.stepNum}>2</span>
            <span className={styles.stepTitle}>选择报告模板</span>
          </div>
          <TemplateSection
            templates={templates}
            selectedId={selectedTemplateId}
            onSelect={setSelectedTemplateId}
            onChangeLibrary={(next) => updateSettings({ reportTemplates: next })}
            aiProvider={aiProvider}
            aiReady={ready}
            anyRunning={anyRunning}
            hideLegend
          />
        </div>
      </div>

      {/* 步骤 3：生成（强调区，主色浅底把主操作锚定在末尾） */}
      <div className={styles.generateStep}>
        <span className={styles.stepNumAccent}>3</span>
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={!canGenerate}
          onClick={handleGenerate}
        >
          生成
        </button>
        <p className={styles.generateHint}>
          {!ready
            ? "尚未配置 API，请点右上角设置填写服务地址 / Key / 模型"
            : material.totalDone === 0
              ? "该区间没有完成记录，无法生成"
              : "生成基于本机任务数据，只归纳不编造"}
        </p>
      </div>

      {genError !== null && <p className={styles.errorBox}>{genError}</p>}
    </section>
  );
}

/** 生成中的状态行：秒表 + 已输出字数。
 *  非推理模型不返回思考流，靠这个持续跳动的计数证明连接仍在推进，避免界面像卡死。 */
function GeneratingMeta({
  contentChars,
  reasoningChars,
}: {
  contentChars: number;
  reasoningChars: number;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const parts = [`正在生成… 已用时 ${seconds}s`];
  if (reasoningChars > 0) parts.push(`思考 ${reasoningChars} 字`);
  if (contentChars > 0) parts.push(`输出 ${contentChars} 字`);
  return <p className={styles.generating}>{parts.join(" · ")}</p>;
}

/** 模型思考过程：流式实时展示（推理模型才有内容，为空则不渲染）。
 *  自动滚到底部，让思考随生成推进持续可见 —— 长素材归纳时界面不会像卡住。 */
function ReasoningBox({ text }: { text: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [text]);
  if (text.trim() === "") return null;
  return (
    <div className={insightStyles.reasoningBox}>
      <p className={insightStyles.reasoningTitle}>模型思考过程 · 实时</p>
      <div ref={bodyRef} className={insightStyles.reasoningBody}>
        {text}
      </div>
    </div>
  );
}

/** 日期控件左侧的日历图标：纯装饰（原生日期选择器仍由点击输入框唤起） */
function CalendarIcon() {
  return (
    <svg
      className={styles.dateCal}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/** 复制按钮：点击后短暂显示「已复制」 */
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默失败（本地 WebView 场景极少发生）
    }
  };
  return (
    <button type="button" className={styles.btnGhost} onClick={handleCopy}>
      {copied ? "已复制" : "复制"}
    </button>
  );
}
