// 职责：AI 报告页容器 —— 左栏已生成报告导航 + 右栏「查看 / 新建」面板的分栏工作台。
// 交互模型对齐 Todo 页：左栏选中一份报告查看，右栏展示正文；「＋ 新建报告」打开编辑器。
// 状态显式区分「查看某份报告」与「编辑一个新报告」，不再用 selectedKey 三态复用。
// reports.json 的加载与生成结果落地都收在容器层，子组件保持自治。

import { useCallback, useEffect, useRef, useState } from "react";
import { isAiProviderReady, loadReports } from "@/services";
import { useReportTaskStore, useSettingsStore, useTaskStore } from "@/stores";
import { addDaysToKey, defaultGenerateWeek, todayKey, weekEndOf, weekStartOf } from "@/lib";
import type { ReportsFile } from "@/types";
import { SettingsIcon } from "@/components/Icons";
import { ProviderConfigForm } from "../InsightView/InsightView";
import { ReportRail } from "./ReportRail";
import { ReportPanel, type ComposeRange } from "./ReportPanel";
import styles from "./ReportsView.module.css";

export function ReportsView() {
  const [reportsFile, setReportsFile] = useState<ReportsFile>({ version: 1, reports: {} });
  /** 查看中的报告 key；null = 不在查看态 */
  const [viewKey, setViewKey] = useState<string | null>(null);
  /** 是否处于新建报告编辑器（首次挂载时若有后台生成任务在跑，直接回到生成态） */
  const [composing, setComposing] = useState(() => useReportTaskStore.getState().running !== null);
  /** 编辑器的区间与取法（受控；打开编辑器时按默认目标周重置，占位值为上一周） */
  const [compose, setCompose] = useState<ComposeRange>(() => {
    // 切页离开再回来：正在跑的任务就是编辑态本身，按它的区间恢复，
    // 这样流式正文能原地接上（生成本身在模块级 store 里从未中断）。
    const running = useReportTaskStore.getState().running;
    if (running !== null) {
      return { start: running.start, end: running.end };
    }
    const today = todayKey();
    const ws = weekStartOf(addDaysToKey(today, -7));
    const we = weekEndOf(ws) > today ? today : weekEndOf(ws);
    return { start: ws, end: we };
  });
  const [showConfig, setShowConfig] = useState(false);

  const reload = useCallback(() => {
    void loadReports().then(setReportsFile);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // 生成完成（含后台任务）时刷新报告列表
  const taskResult = useReportTaskStore((s) => s.result);
  useEffect(() => {
    if (taskResult !== null) reload();
  }, [taskResult?.seq, reload, taskResult]);

  // 首次加载完成后：未在编辑、也未选中时，自动选中「最近生成」的一份报告
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    const keys = Object.keys(reportsFile.reports);
    if (keys.length === 0) return;
    didInit.current = true;
    if (!composing && viewKey === null) {
      const latest = Object.values(reportsFile.reports).reduce((a, b) =>
        a.generatedAt >= b.generatedAt ? a : b,
      );
      setViewKey(latest.key);
    }
  }, [reportsFile.reports, composing, viewKey]);

  // 「＋ 新建报告」：默认落在最近一个未生成且有完成记录的周（本周截到今天）
  const tasks = useTaskStore((s) => s.tasks);
  const handleCompose = useCallback(() => {
    const today = todayKey();
    const ws = defaultGenerateWeek(tasks, reportsFile.reports, today);
    const we = weekEndOf(ws) > today ? today : weekEndOf(ws);
    setCompose({ start: ws, end: we });
    setComposing(true);
    setViewKey(null);
  }, [tasks, reportsFile.reports]);

  const handleSelect = useCallback((key: string) => {
    setViewKey(key);
    setComposing(false);
  }, []);

  const handleGenerated = useCallback((key: string) => {
    setViewKey(key);
    setComposing(false);
  }, []);

  const hasReport = useCallback(
    (key: string) => reportsFile.reports[key] !== undefined,
    [reportsFile.reports],
  );

  // 未配置 API 时自动展开设置悬浮窗（与洞察AI 一致）
  useEffect(() => {
    if (!isAiProviderReady(useSettingsStore.getState().settings.aiProvider)) setShowConfig(true);
  }, []);

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

  const report = viewKey !== null ? (reportsFile.reports[viewKey] ?? null) : null;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1 className={styles.headTitle}>AI 报告</h1>
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

      <div className={styles.body}>
        <ReportRail
          reports={reportsFile.reports}
          selectedKey={viewKey}
          onSelect={handleSelect}
          onCompose={handleCompose}
        />
        <ReportPanel
          report={report}
          composing={composing}
          compose={compose}
          onComposeChange={setCompose}
          hasReport={hasReport}
          onGenerated={handleGenerated}
          reload={reload}
        />
      </div>
    </div>
  );
}
