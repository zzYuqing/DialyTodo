// 职责：节假日数据结构的类型定义（提示词 5.3）。
// 数据源为 holiday-cn 静态 JSON（国务院公告口径，全国法定节假日）。

/**
 * holiday-cn 的单日条目。
 * 注意：调休上班日在数据中以 isOffDay = false 出现，必须正确识别为工作日。
 */
export interface HolidayCnDay {
  date: string;
  name: string;
  isOffDay: boolean;
}

/** holiday-cn 的原始响应结构 */
export interface HolidayCnResponse {
  year: number;
  days: HolidayCnDay[];
}

/** 本工程落盘的缓存结构：holidays_YYYY.json */
export interface HolidayCache {
  year: number;
  /** 缓存写入时刻 ISO8601 */
  updatedAt: string;
  days: HolidayCnDay[];
}
