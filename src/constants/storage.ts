// 职责：持久化相关的常量集中定义，禁止在业务代码里散落魔法数字。

/** 数据根目录名（默认值），位于 %APPDATA% 下 */
export const DATA_DIR_NAME = "DailyTodo";

/**
 * 数据目录指针文件名，位于 appDataDir() 根（数据目录之外）。
 * 内容为当前数据目录的绝对路径。数据目录可自定义（设置页迁移），
 * 因此指针必须住在数据目录外面，否则迁移删除旧目录时会把自己删掉。
 * 注意：dev 构建使用同名加 -dev 后缀的指针（data-dir-dev），
 * 见 src/services/paths.ts 的构建模式区分逻辑，使 dev 与 release 数据独立。
 */
export const DATA_DIR_POINTER_FILE = "data-dir";

export const TASKS_FILE = "tasks.json";
export const SETTINGS_FILE = "settings.json";
export const BACKUP_DIR = "backup";

/** 备份文件名前缀，完整名为 backup_YYYY-MM-DD.json */
export const BACKUP_FILE_PREFIX = "backup_";

/** tasks.json / settings.json 的当前结构版本，启动校验用（提示词 4.3） */
export const CURRENT_VERSION = 1;

/**
 * 最低可兼容版本（向下兼容地板）。低于此版本视为无法迁移、直接拒绝；
 * 等于或高于此版本都允许加载（再经 migrateTasksFile 升级到 CURRENT_VERSION）。
 * 取代原先「version 必须精确等于 CURRENT_VERSION」的严格闸门，
 * 避免 bump 版本号时把所有旧文件与备份一并判废。
 */
export const MIN_SUPPORTED_VERSION = 1;

/** dev 构建：每种任务类型独立存放的子目录名（位于数据根目录下） */
export const TASKS_DIR = "tasks";

/** dev 构建：单类型任务文件的扩展名 */
export const TASK_TYPE_FILE_SUFFIX = ".json";

/** dev 构建：无法校验、被隔离保留的任务文件后缀（不丢弃，便于事后人工恢复） */
export const QUARANTINE_SUFFIX = ".quarantine.json";

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
