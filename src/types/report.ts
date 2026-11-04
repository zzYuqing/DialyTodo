// 职责：AI 报告（周报）的类型定义。
// 存储模型：reports.json 以报告 key 为键平铺存报告；key 即区间身份 ——
// 自然周用「周一的 YYYY-MM-DD」，自定义区间用 "custom:<start>_<end>"。
// 同一 key 重新生成直接覆盖（2026-11-03 拍板：一周只保留最新一份）。

/** 聚合后的一条完成事项（喂给大模型的最小单元） */
export interface DoneItem {
  /** 任务 id（子任务也用自身 id） */
  taskId: string;
  title: string;
  /** 所属任务集标题；顶层任务为 null。周报用它标注「某任务集里的子项」 */
  parentTitle: string | null;
  /** 区间内的完成日期（升序去重，YYYY-MM-DD） */
  dates: string[];
  /** 区间内完成次数 = dates.length（周期任务多次打卡聚合成一条，不逐日罗列） */
  times: number;
  /** 任务备注原文（喂给模型让解读更有据）；无备注为空串 */
  note: string;
}

/** 区间完成素材：周报生成的唯一事实来源 */
export interface ReportMaterial {
  start: string;
  end: string;
  /** 区间内勾选完成总次数 */
  totalDone: number;
  /** 去重后的事项数 */
  itemCount: number;
  /** 有完成记录的天数 */
  activeDays: number;
  items: DoneItem[];
  /** 日期 -> 当日完成次数 */
  byDay: Record<string, number>;
}

/** 一份已生成的报告（reports.json 的存储单元） */
export interface WeeklyReport {
  key: string;
  /** natural = 自然周（左栏月分组里）；custom = 自定义范围（左栏自定义分区里） */
  kind: "natural" | "custom";
  start: string;
  end: string;
  /** 生成的 Markdown 正文 */
  content: string;
  /** 最近一次生成完成时间 ISO8601 */
  generatedAt: string;
  /** 使用的模型名 */
  model: string;
  /** 参与总结的完成总次数 */
  doneCount: number;
  /** 生成时所用模板："default" = 内置默认模板；其余为模板库条目 id（模板删除后回落默认口径渲染标签） */
  templateId: string;
}

/**
 * 模板库条目（settings.reportTemplates 的元素）。
 * 用户可保存多个具名模板；content 只描述「报告怎么写」，
 * 结构指令句（REPORT_TEMPLATE_PREAMBLE）由生成管线自动拼接，不入库。
 */
export interface ReportTemplateEntry {
  id: string;
  name: string;
  content: string;
  /** 创建时间 ISO8601（列表按它倒序展示） */
  createdAt: string;
}

/** 模板入库前 AI 初审的结论 */
export interface TemplateReview {
  /** 通过才允许入库 */
  approved: boolean;
  /**
   * 不通过的两类原因，决定给用户的引导（approved=true 时为 null）：
   * off-topic = 内容跟「怎么写总结」无关；unformatted = 方向对但还不是模板形态。
   */
  kind: "off-topic" | "unformatted" | null;
  /** 一句话原因，直接展示给用户；通过时为空串 */
  reason: string;
}

/** reports.json 的顶层结构 */
export interface ReportsFile {
  version: number;
  reports: Record<string, WeeklyReport>;
}
