// 职责：全局单色线性图标集 —— 所有图标 stroke 用 currentColor，
// 跟随父级 color 变化（含主题与 active/hover 态），杜绝 emoji 图标（视觉规范六节：低饱和度）。
// 约定：viewBox 统一 16×16、stroke-width 1.5、round 端点；尺寸由调用方通过 size 传或 CSS 控制。

interface IconProps {
  /** 渲染尺寸（px），默认 16 */
  size?: number;
}

function base(size: number | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/** 侧栏 Todo 页：清单打勾 */
export function TodoIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 4.3l1.2 1.2 2-2" />
      <path d="M2.5 11.3l1.2 1.2 2-2" />
      <path d="M8.5 4.5h5M8.5 11.5h5" />
    </svg>
  );
}

/** 长期任务：旗帜（长期目标 / 截止日） */
export function LongTermIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3.5 3v10.5" />
      <path d="M3.5 3.3h7.5l-2 2.6 2 2.6H3.5" />
    </svg>
  );
}

/** 待完成：时钟 */
export function ClockIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  );
}

/** 已逾期：警示三角 */
export function AlertIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 7v3" />
      <path d="M7.7 12h.6" />
    </svg>
  );
}

/** 已完成：带勾的圆 */
export function CheckCircleIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.5 8.2l1.8 1.8L11 6" />
    </svg>
  );
}

/** 设置：滑杆（现代设置语义，比齿轮线条更干净） */
export function SettingsIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 5.5h11M2.5 10.5h11" />
      <circle cx="6" cy="5.5" r="1.8" />
      <circle cx="10" cy="10.5" r="1.8" />
    </svg>
  );
}

/** 编辑：铅笔 */
export function EditIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9.5 2.5l4 4-8 8H1.5v-4z" />
      <path d="M8 4l4 4" />
    </svg>
  );
}

/** 删除动作：垃圾桶（与侧栏收纳箱区分，操作态用立体的桶） */
export function TrashIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 4.5h11" />
      <path d="M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5" />
      <path d="M4 4.5l.7 8.6a1 1 0 001 .9h4.6a1 1 0 001-.9l.7-8.6" />
      <path d="M6.6 7.5v4M9.4 7.5v4" />
    </svg>
  );
}

/** 提醒：铃铛 */
export function BellIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 2a3.8 3.8 0 013.8 3.8v2.9l1.2 1.8H3l1.2-1.8V5.8A3.8 3.8 0 018 2z" />
      <path d="M6.7 13.3a1.4 1.4 0 002.6 0" />
    </svg>
  );
}

/** FAB 新建：加号 */
export function PlusIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 2.5v11M2.5 8h11" />
    </svg>
  );
}

/** 勾选：对勾（TaskItem checkbox 内部） */
export function CheckIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  );
}

/** 备注：对话气泡（子任务备注折叠胶囊用） */
export function NoteIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 3.5h10a1 1 0 011 1V9a1 1 0 01-1 1H7.5L5 12.5V10H3a1 1 0 01-1-1V4.5a1 1 0 011-1z" />
    </svg>
  );
}

/** 展开 / 收起：向右的尖角（展开态由 CSS 旋转 90° 表达） */
export function ChevronRightIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 3.5l5 4.5-5 4.5" />
    </svg>
  );
}

/** 面板切换：方框 + 左侧竖条，用于经验页左栏的展开 / 收起 */
export function PanelToggleIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5.5 2.5v11" />
    </svg>
  );
}

/** 拖拽把手：六个点的点阵 */
export function GripIcon({ size }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={0} fill="currentColor">
      <circle cx="6" cy="4.5" r="1" />
      <circle cx="10" cy="4.5" r="1" />
      <circle cx="6" cy="8" r="1" />
      <circle cx="10" cy="8" r="1" />
      <circle cx="6" cy="11.5" r="1" />
      <circle cx="10" cy="11.5" r="1" />
    </svg>
  );
}

/** 清除 / 关闭：两条交叉线（截止日胶囊里的清除键用） */
export function CloseIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

/** 经验：打开的书本（知识沉淀语义） */
export function ExperienceIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 4.2c0-1 1-1.7 2.2-1.7h3.8v10.5H5.2C4 13 3 12.3 3 11.3z" />
      <path d="M13 4.2c0-1-1-1.7-2.2-1.7H7v10.5h3.8c1.2 0 2.2-.7 2.2-1.7z" />
    </svg>
  );
}

/** 工具：扳手（上班好用工具集合语义） */
export function ToolsIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M11.5 4.2a2.7 2.7 0 00-3.6 3.6l-3.4 3.4a1.5 1.5 0 102.1 2.1l3.4-3.4a2.7 2.7 0 003.6-3.6l-1.5 1.5-1.6-1.6z" />
    </svg>
  );
}

/** 上传：向上箭头 + 底横（选择本地 .md 文件灌入文档） */
export function UploadIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 11V3" />
      <path d="M5 6l3-3 3 3" />
      <path d="M3.5 12.5h9" />
    </svg>
  );
}

/** 下载：向下箭头 + 底横（把附件另存到用户指定位置） */
export function DownloadIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 3v8" />
      <path d="M5 8l3 3 3-3" />
      <path d="M3.5 12.5h9" />
    </svg>
  );
}

/** 健康：心形（左栏「健康」分类与防疲劳类工具语义） */
export function HealthIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 12.8S3.8 9.8 3.8 6.9A2.2 2.2 0 0 1 8 5.8a2.2 2.2 0 0 1 4.2 1.1C12.2 9.8 8 12.8 8 12.8z" />
    </svg>
  );
}

/** 咖啡杯：带蒸汽（防困小妙招工具语义） */
export function CoffeeIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 6.5h7.5v2.2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
      <path d="M10.5 7h1.3a1.5 1.5 0 0 1 0 3H10.5" />
      <path d="M5 5.2c0-.8.9-.8.9-1.6M7.6 5.2c0-.8.9-.8.9-1.6" />
    </svg>
  );
}

/** 火花：四角星 + 小闪点（科技分类与洞察AI 工具语义） */
export function SparkIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 2.3l1.2 3.1 3.1 1.2-3.1 1.2L8 11l-1.2-3.1L3.7 6.6l3.1-1.2z" />
      <path d="M12.4 11.4l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" />
    </svg>
  );
}

/** 闪电：效率分类语义 */
export function BoltIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 2L4 9h3l-1 5 5-7H8z" />
    </svg>
  );
}

/** 叶子：养身小技巧工具语义（与 HealthIcon 区分） */
export function LeafIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 12.5C4 7 7.5 4 12.5 4c0 5.5-3.5 8.5-8.5 8.5z" />
      <path d="M5.2 11.3C7 9 9.6 7.5 12 6.6" />
    </svg>
  );
}

/** 循环箭头：切换 / 换一批语义 */
export function LoopIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 6.5A5.5 5.5 0 0 1 13 6" />
      <path d="M13.5 9.5A5.5 5.5 0 0 1 3 10" />
      <path d="M10.5 3.5l2.5-1.5v3M5.5 12.5l-2.5 1.5v-3" />
    </svg>
  );
}

/** 搜索：放大镜（经验页标题模糊搜索入口） */
export function SearchIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4L14 14" />
    </svg>
  );
}

/** 按截止日排序：列表 + 双向箭头，表达「可指定顺序重排」 */
export function SortIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 4.5h5M2.5 8h5M2.5 11.5h5" />
      <path d="M11 4.5v7" />
      <path d="M9.5 6l1.5-1.5 1.5 1.5" />
      <path d="M9.5 10l1.5 1.5 1.5-1.5" />
    </svg>
  );
}

/** 预览：眼睛（附件在线预览入口） */
export function EyeIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  );
}

/** 更新日志：带折角的文档（版本发布记录语义） */
export function HistoryIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 2.5h7.5L13.5 5.5v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
      <path d="M10.5 2.5v3h3" />
      <path d="M5 8.5h6M5 11h6M5 13.5h4" />
    </svg>
  );
}

/** 对话气泡：糊弄学工具语义（社交话术 / 锦囊） */
export function ChatIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H7l-2.5 2v-2H3A1.5 1.5 0 0 1 1.5 9V5A1.5 1.5 0 0 1 3 3.5z" />
      <path d="M5 7h.01M8 7h.01M11 7h.01" />
    </svg>
  );
}
