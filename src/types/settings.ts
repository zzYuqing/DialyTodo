// 职责：软件配置的类型定义，对应 %APPDATA%/DailyTodo/settings.json。

/** 主题模式（提示词 5.8） */
export type ThemeMode = "light" | "dark";

/** 主窗口形态（提示词 5.5） */
export type WindowMode = "normal" | "floating";

/** 失焦行为：自动隐藏 / 切换迷你模式 / 不处理 */
export type BlurBehavior = "hide" | "mini" | "off";

export interface AppSettings {
  version: number;
  theme: ThemeMode;
  windowMode: WindowMode;
  /** 失焦时的行为，可关闭 */
  onBlur: BlurBehavior;
  /** 开机自启，仅写 HKCU Run，默认 false（提示词第八节） */
  autoStart: boolean;
  /** 桌宠开关（提示词 5.7） */
  petEnabled: boolean;
  /** 日视图中隐藏已完成任务（提示词 5.1） */
  hideCompleted: boolean;
  /** 节假日数据源 URL 模板，%1 为四位年份；留空即退化为「永不联网」（提示词 5.3） */
  holidayUrlTemplate: string;
  /** 最后一次生成备份的日期，YYYY-MM-DD；每天只备份一次 */
  lastBackupDate: string | null;
}
