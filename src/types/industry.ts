// 职责：行业资讯的行业档案、RSS 信源与 AI 初审结果类型。
// 行业日报本身复用 InsightReport；此处只描述「用户关注哪些行业、从哪里抓取」。

/** AI 推荐且经实际抓取验证的行业信源 */
export interface IndustrySource {
  /** 信源展示名 */
  name: string;
  /** RSS / Atom 地址 */
  query: string;
  /** 单次抓取最多消费条目数 */
  take: number;
}

/** 已通过 AI 初审、可持续生成日报的行业 */
export interface IndustryProfile {
  /** 本地随机 id；报告渠道键为 industry:<id> */
  id: string;
  /** AI 初审后返回的规范行业名 */
  name: string;
  /** 常见别称，供日报提示词判断素材相关性 */
  aliases: string[];
  /** 并入当前行业的上下游主题；共用本行业的日报与信源 */
  includedTopics: string[];
  /** 该行业专属信源；不再借用洞察AI的固定信源 */
  sources: IndustrySource[];
  /** 初审结论摘要，仅作本地记录 */
  reviewNote: string;
  /** 添加时间 ISO8601 */
  createdAt: string;
}

/** 上下游方向：上游为供应与技术环节，下游为整机、客户与应用环节 */
export type IndustryRelationDirection = "upstream" | "downstream";

/** 并入主行业共用日报，或单独新增行业生成独立日报 */
export type IndustryRelationMode = "merge" | "separate";

/** AI 推荐的上下游条目；信源在用户选中后才进行实际验证 */
export interface IndustryRelationSuggestion {
  name: string;
  aliases: string[];
  direction: IndustryRelationDirection;
  /** 用一句话说明该环节与主行业的关系 */
  reason: string;
  sources: IndustrySource[];
}

/** 用户在上下游建议中勾选并指定处理方式的条目 */
export interface IndustryRelationSelection {
  suggestion: IndustryRelationSuggestion;
  mode: IndustryRelationMode;
}

/** 一次添加流程的完整结果，便于界面选回主行业并提示新增数量 */
export interface IndustryAddResult {
  primary: IndustryProfile;
  separateIndustries: IndustryProfile[];
}

/** AI 对用户输入行业的初审与信源推荐结果 */
export interface IndustryReview {
  /** 是否适合作为持续跟踪的行业 */
  approved: boolean;
  /** 规范后的行业名；不通过时可回显用户输入 */
  name: string;
  /** 有助于识别相关资讯的常见别称 */
  aliases: string[];
  /** 经实际 RSS 抓取验证后可用的信源 */
  sources: IndustrySource[];
  /** 通过 / 不通过的简短理由 */
  reason: string;
}

/** industries.json 顶层结构 */
export interface IndustriesFile {
  version: number;
  industries: IndustryProfile[];
}
