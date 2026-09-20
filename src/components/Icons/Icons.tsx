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
