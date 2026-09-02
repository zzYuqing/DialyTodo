// 职责：持久化相关的常量集中定义，禁止在业务代码里散落魔法数字。

/** 数据根目录名，位于 %APPDATA% 下 */
export const DATA_DIR_NAME = "DailyTodo";

export const TASKS_FILE = "tasks.json";
export const SETTINGS_FILE = "settings.json";
export const BACKUP_DIR = "backup";

/** 备份文件名前缀，完整名为 backup_YYYY-MM-DD.json */
export const BACKUP_FILE_PREFIX = "backup_";

/** tasks.json / settings.json 的当前结构版本，启动校验用（提示词 4.3） */
export const CURRENT_VERSION = 1;

/** 自动备份滚动保留份数（提示词 5.4） */
export const BACKUP_KEEP_COUNT = 7;

/** 原子写入的临时文件后缀 */
export const TMP_FILE_SUFFIX = ".tmp";

/**
 * 节假日数据源 URL 模板，%1 为四位年份（提示词 5.3）。
 * holiday-cn 静态 JSON，国务院公告口径，全国法定节假日，无地区特殊口径。
 */
export const HOLIDAY_URL_TEMPLATE =
  "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/%1.json";

/** 节假日请求的超时时间，超时静默降级（提示词 5.3） */
export const HOLIDAY_FETCH_TIMEOUT_MS = 5000;

/** 节假日缓存文件名前缀，完整名为 holidays_YYYY.json */
export const HOLIDAY_FILE_PREFIX = "holidays_";
export const HOLIDAY_FILE_SUFFIX = ".json";
