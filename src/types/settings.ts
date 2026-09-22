// 职责：软件配置的类型定义，对应 %APPDATA%/DailyTodo/settings.json。

/** 主题模式（提示词 5.8） */
export type ThemeMode = "light" | "dark";

/**
 * 窗口界面模式（提示词 5.5）。
 * full = 完整布局（侧栏 + 贡献墙 + 长期任务页 + 设置）；simple = 仅当日待办（含新建按钮）；
 * mini = 迷你条（暂未开放，接口保留）。
 */
export type LayoutMode = "full" | "simple" | "mini";

export interface AppSettings {
  version: number;
  theme: ThemeMode;
  /** 窗口是否置顶（永远悬浮在其他窗口之上）。只管置顶，不调尺寸与布局。 */
  alwaysOnTop: boolean;
  /** 窗口界面模式，控制布局与窗口尺寸（提示词 5.5） */
  layout: LayoutMode;
  /** 点击标题栏关闭按钮时的行为：true = 隐藏到托盘常驻，false = 直接退出（提示词 5.5） */
  closeToTray: boolean;
  /** 开机自启，仅写 HKCU Run，默认 false（提示词第八节） */
  autoStart: boolean;
  /** 桌宠开关（提示词 5.7） */
  petEnabled: boolean;
  /** 日模式中隐藏已完成任务（提示词 5.1） */
  hideCompleted: boolean;
  /**
   * 任务集展开区里，已勾选子任务默认展示（不折叠）的条数；超出的较早完成项收进折叠节点。
   * 该字段为阶段 7 新增，存量设置文件没有它，由 loadSettings 的 merge + normalizeSettings 补齐为出厂值。
   * 合法区间见 SUBTASK_DONE_KEEP_MIN / _MAX，UI 与加载时都会夹回区间内。
   */
  subtaskDoneKeep: number;
  /** 节假日数据源 URL 模板，%1 为四位年份；留空即退化为「永不联网」（提示词 5.3） */
  holidayUrlTemplate: string;
  /** 最后一次生成备份的日期，YYYY-MM-DD；每天只备份一次 */
  lastBackupDate: string | null;
}
