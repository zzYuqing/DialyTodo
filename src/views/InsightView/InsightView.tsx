// 职责：洞察AI工具页（AI 日报 / 后续行业动态等渠道的统一落地页）。
// 布局（2026-11-02 定版）：顶部返回 + 标题 + 设置齿轮（齿轮下方悬浮配置窗）；渠道多于一个时显示页签；
// 主体分左右两栏 —— 左栏年历（仿主页贡献栏：顶部年份切换 + 全年 12 个月竖排滚动，格子为贡献墙风格），
// 右栏当日详情（报告渲染 / 进度日志 / 实时预览 / 空状态）+ 底部生成/补充按钮。
// 生成语义：月历选哪天就生成/补充哪天。今日 12:00 前禁生成；昨日全天可补（今日限一次）；更早只读。
// 补充 = 合并式：新素材融入已有日报，产出当日完整版；loadHistory 记录每次加载。
// 真实性保障：素材全部来自实时抓取，提示词（constants/insight.ts，写死）禁止模型编造。
// API 设置：服务地址 + Key + 模型名（OpenAI 兼容协议），存 settings.aiProvider。
// 生成任务跑在 useInsightTaskStore（模块级）：切走页面不中断，回来进度/结果原样接上。

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LoopIcon, SettingsIcon, SparkIcon } from "@/components/Icons";
import {
  AI_BASE_URL_PRESETS,
  AI_MODEL_PRESETS,
  CONTRIBUTION_COLORS,
  INSIGHT_CHANNELS,
  type ContributionLevel,
} from "@/constants";
import { fromDateKey, getMonthDays, todayKey, toDateKey, weekdayIndexOf } from "@/lib";
import { getDayAvailability, getReport, listReportStats } from "@/services";
import { isAiProviderReady, listModels } from "@/services/aiService";
import { useInsightTaskStore, useSettingsStore } from "@/stores";
import type { InsightReport } from "@/types";
import styles from "./InsightView.module.css";

const CUSTOM = "__custom__";

/**
 * 当日累计加载条数 → 贡献墙 5 档色阶（复用主页 CONTRIBUTION_COLORS，分档为写死经验值）。
 */
function loadLevel(count: number): ContributionLevel {
  if (count <= 0) return 0;
  if (count <= 9) return 1;
  if (count <= 19) return 2;
  if (count <= 34) return 3;
  return 4;
}

/**
 * 剥掉 Markdown 链接：来源标注不再展示（点击在 webview 里没意义）。
 * 存量报告里模型生成的 [来源](url) 在渲染时移除（连同前导空白），新报告经提示词约束不再产生。
 */
export function stripMarkdownLinks(content: string): string {
  return content.replace(/[ \t]*\[([^\]]*)\]\([^)]*\)/g, "");
}

/**
 * 渲染前把各模块内条目统一重排为有序编号：每个 ## 小标题内的条目段落从 1 起。
 * 先识别并移除段首原有的数字 / 符号列表标记（含 AI 偶发的重复编号），再生成一套连续序号；
 * 「今日观察」是归纳性文字不编号；流式预览同样生效。
 */
export function numberSectionItems(content: string): string {
  const SKIP_SECTION = /今日观察/;
  // 段首连续旧编号（支持全角数字、中文括号、点/顿号/冒号）；整体识别，避免漏掉第二组
  const NUMBER_RUN =
    /^\s*(?:(\*\*|\*)\s*)?(?:(?:[（\(][0-9０-９]{1,3}[）\)]\s*)|(?:[0-9０-９]{1,3}[.、．:：]\s*))+/u;
  // 符号列表必须后面跟空白才是列表项；不能误吞「**加粗**」的第一个星号
  const BULLET_MARKER = /^\s*[-*+](?=\s)/u;
  const lines = content.split("\n");
  const out: string[] = [];
  let section: string | null = null;
  let para: string[] = [];
  let seq = 0;

  const stripLeadingItemMarker = (line: string): string => {
    // 先把 - / * / + 符号列表转成有序编号，再完整移除段首旧数字编号
    const unbulleted = BULLET_MARKER.test(line) ? line.replace(BULLET_MARKER, "") : line;
    const match = NUMBER_RUN.exec(unbulleted);
    if (match === null) return unbulleted.trimStart();
    return `${match[1] ?? ""}${unbulleted.slice(match[0].length).trimStart()}`;
  };

  const flushPara = () => {
    if (para.length === 0) return;
    if (section === null || SKIP_SECTION.test(section)) {
      out.push(para.join("\n"));
      para = [];
      return;
    }
    seq += 1;
    para[0] = stripLeadingItemMarker(para[0]);
    out.push(`${seq}. ${para.join("\n")}`);
    para = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      flushPara();
      section = trimmed.slice(3);
      seq = 0;
      out.push(line);
    } else if (trimmed === "") {
      flushPara();
      out.push(line);
    } else if (section !== null) {
      para.push(line);
    } else {
      out.push(line);
    }
  }
  flushPara();
  return out.join("\n");
}

export function InsightView({ onBack }: { onBack: () => void }) {
  const [channelId, setChannelId] = useState<string>(INSIGHT_CHANNELS[0].id);
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());
  const [viewYear, setViewYear] = useState<number>(() => new Date().getFullYear());
  const [reportStats, setReportStats] = useState<Record<string, number>>({});
  const [report, setReport] = useState<InsightReport | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // 生成任务状态来自模块级 store：切走页面不中断，回来原样接上
  const taskRunning = useInsightTaskStore((s) => s.running);
  const taskResult = useInsightTaskStore((s) => s.result);
  const startTask = useInsightTaskStore((s) => s.start);
  const clearResult = useInsightTaskStore((s) => s.clearResult);
  /** 当前选中渠道+日期是否有任务在跑 */
  const taskForSelection =
    taskRunning !== null && taskRunning.channelId === channelId && taskRunning.dateKey === selectedDate
      ? taskRunning
      : null;
  /** 有任务在跑（含其他日期/渠道的后台任务） */
  const anyTaskRunning = taskRunning !== null;

  const aiProvider = useSettingsStore((s) => s.settings.aiProvider);
  const ready = isAiProviderReady(aiProvider);

  const channel = useMemo(
    () => INSIGHT_CHANNELS.find((c) => c.id === channelId) ?? INSIGHT_CHANNELS[0],
    [channelId],
  );
  /** 该日期的报告是否已在今天加载/补充过（UTC ISO 时间先转本地再比日期键） */
  const loadedToday = useMemo(
    () =>
      (report?.loadHistory ?? []).some((r) => toDateKey(new Date(r.at)) === todayKey()),
    [report],
  );
  const availability = useMemo(
    () => getDayAvailability(channelId, selectedDate, new Date(), loadedToday),
    [channelId, selectedDate, loadedToday],
  );
  const selectedLabel = format(fromDateKey(selectedDate), "M月d日");

  // 各日期累计加载条数（月历格子数字与色阶）：渠道切换与生成完成后各刷一次
  const reloadDates = () => {
    void listReportStats(channelId).then(setReportStats);
  };
  useEffect(() => {
    reloadDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // 选中日期 / 渠道变化时载入对应报告
  useEffect(() => {
    void getReport(channelId, selectedDate).then(setReport);
  }, [channelId, selectedDate]);

  // 未配置时直接展开设置面板
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

  // 任务结果落地：成功则刷新报告与月历打标；失败/无需补充转为本地提示。
  // 结果属于其他日期时，只更新月历打标并提示一句，不干扰当前查看。
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
        `后台已生成 ${format(fromDateKey(resultDate), "M月d日")} ${channelLabel}，切换到对应渠道即可查看。`,
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
    setInfoMsg(null);
    setGenError(null);
    startTask(channelId, aiProvider, selectedDate, report);
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={onBack}>
          ← 返回
        </button>
        <h1 className={styles.title}>洞察AI</h1>
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

      {INSIGHT_CHANNELS.length > 1 && (
        <nav className={styles.tabs} aria-label="洞察渠道">
          {INSIGHT_CHANNELS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={c.id === channelId ? styles.tabActive : styles.tab}
              onClick={() => {
                setChannelId(c.id);
                setSelectedDate(todayKey());
                setInfoMsg(null);
              }}
            >
              <SparkIcon size={14} />
              {c.label}
            </button>
          ))}
        </nav>
      )}

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
            }}
          />
          <p className={styles.railHint}>格子数字为当日报告成文的资讯条数；今日 12:00 前可补昨日。</p>
        </aside>

        <section className={styles.detail}>
          <p className={styles.detailTitle}>
            {selectedLabel}
            {selectedDate === todayKey() ? "（今天）" : ""} · {channel.label}
          </p>

          {/* 生成进度：抓取了哪些信源、每条抓到多少、模型是否开始输出 */}
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

          {/* 后台任务在跑但不属于当前选中日期时，给一句提示避免误以为没反应 */}
          {taskRunning !== null && taskForSelection === null && (
            <div className={styles.infoBox}>
              正在后台生成 {format(fromDateKey(taskRunning.dateKey), "M月d日")} {taskRunning.channelLabel}
              ，可切去其他页面，完成后对应年历自动打标。
            </div>
          )}

          {/* 模型推理过程：仅思考型模型（如 kimi-k3）有输出，实时滚动 */}
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
              <SparkIcon size={28} />
              <p>{selectedLabel}还没有{channel.label}。</p>
              <p className={styles.emptyHint}>
                {availability.allowed
                  ? "点击下方按钮，实时抓取资讯并生成。"
                  : "该日期暂不可生成，请在月历中选择其他日期。"}
              </p>
            </div>
          )}

          {/* 底部操作区：今日始终显示（12:00 前禁用）；昨日仅未被今日补充过时显示；更早日期不显示 */}
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
    </div>
  );
}

/**
 * 左栏年历：仿主页贡献栏 —— 顶部年份切换器选中的年份内 12 个月竖排滚动。
 * 当年默认滚动到本月；切到其他年份回到顶部（1 月）。不越过今年往后翻。
 */
export function YearCalendar({
  year,
  stats,
  selectedDate,
  onSelect,
}: {
  year: number;
  /** 各日期报告成文条数（无报告的日子缺省 0 档） */
  stats: Record<string, number>;
  selectedDate: string;
  onSelect: (dateKey: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLElement>(null);
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  // 初始/切年定位：当年滚到本月，其他年份回顶部
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (year === currentYear && currentRef.current) {
      scroll.scrollTop = currentRef.current.offsetTop;
    } else {
      scroll.scrollTop = 0;
    }
  }, [year, currentYear]);

  return (
    <div ref={scrollRef} className={styles.calScroll}>
      {Array.from({ length: 12 }, (_, month) => (
        <MonthBlock
          key={month}
          year={year}
          month={month}
          stats={stats}
          selectedDate={selectedDate}
          onSelect={onSelect}
          blockRef={year === currentYear && month === currentMonth ? currentRef : undefined}
        />
      ))}
    </div>
  );
}

/** 单个月块：月标签 + 周表头 + 贡献墙风格格子（数字 = 当日报告条数，悬浮提示） */
function MonthBlock({
  year,
  month,
  stats,
  selectedDate,
  onSelect,
  blockRef,
}: {
  year: number;
  month: number;
  stats: Record<string, number>;
  selectedDate: string;
  onSelect: (dateKey: string) => void;
  blockRef?: Ref<HTMLElement>;
}) {
  const days = getMonthDays(year, month);
  const leadingBlanks = weekdayIndexOf(days[0]); // 0 = 周一
  const today = todayKey();
  const label = month === 0 ? `${year}年1月` : `${month + 1}月`;

  return (
    <section ref={blockRef} className={styles.monthBlock}>
      <h3 className={styles.monthLabel}>{label}</h3>
      <div className={styles.calWeek}>
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
          <span key={w} className={styles.calWeekDay}>
            {w}
          </span>
        ))}
      </div>
      <div className={styles.calGrid}>
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} className={styles.calCellEmpty} aria-hidden="true" />
        ))}
        {days.map((key) => {
          const isFuture = key > today;
          const hasReport = stats[key] !== undefined;
          const count = stats[key] ?? 0;
          // 已生成报告即算查过：0 条也显示 1 档绿色，与从未生成的空白日期区分
          const loadedLevel = loadLevel(count);
          const level: ContributionLevel = hasReport && loadedLevel === 0 ? 1 : loadedLevel;
          const cellClass = [
            styles.calCell,
            key === selectedDate ? styles.calCellSelected : "",
            isFuture ? styles.calCellFuture : "",
            level >= 3 ? styles.calCellInkStrong : "",
          ]
            .filter(Boolean)
            .join(" ");
          const cellTitle = `${format(fromDateKey(key), "M月d日")} · ${
            hasReport ? `报告 ${count} 条` : "未加载"
          }`;
          return (
            <button
              key={key}
              type="button"
              className={cellClass}
              style={{ background: isFuture ? undefined : CONTRIBUTION_COLORS[level] }}
              title={cellTitle}
              aria-label={cellTitle}
              disabled={isFuture}
              onClick={() => onSelect(key)}
            >
              {hasReport ? count : ""}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * API 设置表单：服务地址 / Key / 模型。
 * 模型跟随服务地址：每个服务商的模型列表经 GET /models 拉取后按 baseUrl 缓存进
 * settings.aiModelCache（settings.json），下拉优先显示缓存；无缓存时退回内置预设。
 * 「刷新」按钮重新拉取当前服务商的模型列表并更新缓存（需已填 API Key）。
 */
export function ProviderConfigForm({
  onSaved,
  embedded = false,
}: {
  onSaved?: () => void;
  /** 嵌入设置页卡片时去掉表单自身的边框、背景与内边距 */
  embedded?: boolean;
}) {
  const aiProvider = useSettingsStore((s) => s.settings.aiProvider);
  const aiModelCache = useSettingsStore((s) => s.settings.aiModelCache);
  const updateSettings = useSettingsStore((s) => s.update);

  const isPresetBase = AI_BASE_URL_PRESETS.some((p) => p.baseUrl === aiProvider.baseUrl);
  const knownModels = new Set([
    ...AI_MODEL_PRESETS.map((p) => p.model),
    ...(aiModelCache[aiProvider.baseUrl]?.models ?? []),
  ]);

  const [baseChoice, setBaseChoice] = useState(
    aiProvider.baseUrl === "" ? "" : isPresetBase ? aiProvider.baseUrl : CUSTOM,
  );
  const [customBase, setCustomBase] = useState(isPresetBase ? "" : aiProvider.baseUrl);
  const [apiKey, setApiKey] = useState(aiProvider.apiKey);
  const [modelChoice, setModelChoice] = useState(
    aiProvider.model === "" ? "" : knownModels.has(aiProvider.model) ? aiProvider.model : CUSTOM,
  );
  const [customModel, setCustomModel] = useState(
    knownModels.has(aiProvider.model) ? "" : aiProvider.model,
  );
  const [savedTip, setSavedTip] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // 当前选中的服务地址（自定义时取输入框）；模型当前值
  const resolvedBase = baseChoice === CUSTOM ? customBase.trim() : baseChoice.trim();
  const currentModel = modelChoice === CUSTOM ? customModel.trim() : modelChoice;

  // 模型下拉的数据源：该服务商已缓存的真实模型列表优先，没有则退回内置预设
  const cacheEntry = resolvedBase !== "" ? aiModelCache[resolvedBase] : undefined;
  const modelOptions =
    cacheEntry !== undefined && cacheEntry.models.length > 0
      ? cacheEntry.models
      : AI_MODEL_PRESETS.map((p) => p.model);

  // 设置可能晚于页面加载完成（initialize 异步）：aiProvider 变化时同步表单，
  // 保证已保存的配置正确回显。缓存从 getState 现取且不进依赖——
  // 否则「刷新模型」写入缓存会触发本 effect，把刚自动选中的模型覆盖回旧值。
  useEffect(() => {
    const { aiProvider: prov, aiModelCache: cache } = useSettingsStore.getState().settings;
    const presetBase = AI_BASE_URL_PRESETS.some((p) => p.baseUrl === prov.baseUrl);
    const known = new Set([
      ...AI_MODEL_PRESETS.map((p) => p.model),
      ...(cache[prov.baseUrl]?.models ?? []),
    ]);
    setBaseChoice(prov.baseUrl === "" ? "" : presetBase ? prov.baseUrl : CUSTOM);
    setCustomBase(presetBase ? "" : prov.baseUrl);
    setApiKey(prov.apiKey);
    setModelChoice(prov.model === "" ? "" : known.has(prov.model) ? prov.model : CUSTOM);
    setCustomModel(known.has(prov.model) ? "" : prov.model);
  }, [aiProvider]);

  // 换服务商：该服务商有缓存模型且当前模型不在其中时，自动切到它的第一个模型
  const handleBaseChange = (next: string) => {
    setBaseChoice(next);
    setFetchError(null);
    const nextBase = next === CUSTOM ? customBase.trim() : next.trim();
    const cached = nextBase !== "" ? (aiModelCache[nextBase]?.models ?? []) : [];
    if (cached.length > 0 && !cached.includes(currentModel)) {
      setModelChoice(cached[0]);
    }
  };

  // 拉取当前服务商的模型列表（OpenAI 兼容 GET /models），结果按 baseUrl 写入缓存
  const refreshModels = async () => {
    if (resolvedBase === "" || apiKey.trim() === "") return;
    setFetchingModels(true);
    setFetchError(null);
    try {
      const models = await listModels({ baseUrl: resolvedBase, apiKey: apiKey.trim(), model: "" });
      await updateSettings({
        aiModelCache: {
          ...aiModelCache,
          [resolvedBase]: { models, fetchedAt: new Date().toISOString() },
        },
      });
      if (!models.includes(currentModel)) setModelChoice(models[0]);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : String(error));
    } finally {
      setFetchingModels(false);
    }
  };

  const save = async () => {
    await updateSettings({
      aiProvider: { baseUrl: resolvedBase, apiKey: apiKey.trim(), model: currentModel },
    });
    setSavedTip(true);
    window.setTimeout(() => {
      setSavedTip(false);
      onSaved?.();
    }, 800);
  };

  return (
    <section className={`${styles.config} ${embedded ? styles.configEmbedded : ""}`}>
      {!embedded && <h2 className={styles.configTitle}>API 设置（OpenAI 兼容协议）</h2>}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>服务地址</span>
        <select
          className={styles.select}
          value={baseChoice}
          onChange={(e) => handleBaseChange(e.target.value)}
        >
          <option value="" disabled>
            选择服务商…
          </option>
          {AI_BASE_URL_PRESETS.map((p) => (
            <option key={p.baseUrl} value={p.baseUrl}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM}>自定义…</option>
        </select>
        {baseChoice === CUSTOM && (
          <input
            className={styles.input}
            placeholder="https://api.example.com/v1"
            value={customBase}
            onChange={(e) => {
              setCustomBase(e.target.value);
              setFetchError(null);
            }}
          />
        )}
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>API Key</span>
        <input
          className={styles.input}
          type="password"
          placeholder="sk-…"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>模型</span>
        <div className={styles.modelRow}>
          <select
            className={styles.select}
            value={modelChoice}
            onChange={(e) => setModelChoice(e.target.value)}
          >
            <option value="" disabled>
              选择模型…
            </option>
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={CUSTOM}>自定义…</option>
          </select>
          <button
            type="button"
            className={styles.refreshModelsBtn}
            disabled={resolvedBase === "" || apiKey.trim() === "" || fetchingModels}
            title="获取该服务商的模型列表"
            onClick={() => void refreshModels()}
          >
            <LoopIcon size={14} />
            {fetchingModels ? "获取中…" : "刷新模型"}
          </button>
        </div>
        {modelChoice === CUSTOM && (
          <input
            className={styles.input}
            placeholder="模型名"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
          />
        )}
        <span className={styles.modelHint}>
          {fetchError !== null
            ? fetchError
            : cacheEntry !== undefined && cacheEntry.models.length > 0
              ? `已加载该服务商 ${cacheEntry.models.length} 个模型（${format(
                  new Date(cacheEntry.fetchedAt),
                  "M月d日 HH:mm",
                )} 获取）`
              : "尚未获取该服务商模型列表，当前显示内置预设，点「刷新模型」拉取真实列表"}
        </span>
      </div>
      <div className={styles.configActions}>
        <button type="button" className={styles.saveBtn} onClick={() => void save()}>
          {savedTip ? "已保存 ✓" : "保存"}
        </button>
      </div>
    </section>
  );
}
