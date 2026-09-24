// 职责：经验记录（危机 / 重大 bug 等知识沉淀）与分类的数据模型。
// 「经验」用于沉淀踩过的坑，避免以后再遇到同类情况不知所措；分类用于横切检索。

/** 经验分类（预置 + 可自定义） */
export interface ExperienceCategory {
  id: string;
  name: string;
  /** 主题色（CSS 颜色字符串），用于分类徽章与圆点 */
  color: string;
}

/** 挂在经验上的附件（直接上传的文件，非 md 内嵌图片） */
export interface ExperienceAttachment {
  id: string;
  /** 原始文件名，界面展示用 */
  name: string;
  /** 数据目录内的实际文件名（含扩展名），由系统生成以避冲突 */
  storedName: string;
  /** 文件类型（按扩展名推断），供图标与打开方式判断 */
  mime: string;
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
  /** 直接上传的附件；md 正文引用的图片不在此列（它们只存在于 content 里） */
  attachments: ExperienceAttachment[];
  createdAt: string;
  updatedAt: string;
}

/** experiences.json 落地结构（与 tasks.json 同构：version + 数据） */
export interface ExperienceFile {
  version: number;
  categories: ExperienceCategory[];
  experiences: Experience[];
}
