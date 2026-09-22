// 职责：经验记录（危机 / 重大 bug 等知识沉淀）与分类的数据模型。
// 「经验」用于沉淀踩过的坑，避免以后再遇到同类情况不知所措；分类用于横切检索。

/** 经验分类（预置 + 可自定义） */
export interface ExperienceCategory {
  id: string;
  name: string;
  /** 主题色（CSS 颜色字符串），用于分类徽章与圆点 */
  color: string;
}

/** 一条经验记录 */
export interface Experience {
  id: string;
  /** 经验发生 / 记录日期，YYYY-MM-DD，用于左侧日期导航 */
  date: string;
  /** 分类 id，关联 ExperienceCategory.id */
  category: string;
  /** 一句话标题 */
  title: string;
  /** 详细经过 / 解决 / 教训 */
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** experiences.json 落地结构（与 tasks.json 同构：version + 数据） */
export interface ExperienceFile {
  version: number;
  categories: ExperienceCategory[];
  experiences: Experience[];
}
