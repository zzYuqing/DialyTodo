// 职责：防困小妙招的内置妙招常量（代码侧维护，不落盘）。
// 用户手动添加的妙招单独走本地持久化（见 services/antiDrowsyService.ts）。

export interface Tip {
  text: string;
  /** 是否为内置妙招（内置不可删，用户添加的才可删） */
  builtin: boolean;
  /** 是否带「可展开」标记（后续支持展开内容） */
  expand?: boolean;
}

/** 内置妙招初始池（含用户指定的薄荷糖 / 冷水拍后颈 / 听小说） */
export const BUILTIN_TIPS: Tip[] = [
  { text: "去洗个脸", builtin: true },
  { text: "喝咖啡", builtin: true },
  { text: "喝汽水", builtin: true },
  { text: "听八卦吗", builtin: true, expand: true },
  { text: "薄荷糖", builtin: true },
  { text: "冷水拍后颈", builtin: true },
  { text: "听小说", builtin: true },
];
