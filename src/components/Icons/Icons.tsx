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

/** 归档：收纳箱 */
export function ArchiveIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2" y="3" width="12" height="3.5" rx="1" />
      <path d="M3.5 6.5v5a1.5 1.5 0 001.5 1.5h6a1.5 1.5 0 001.5-1.5v-5" />
      <path d="M6.5 9h3" />
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

/** 归档动作：垃圾桶（与侧栏收纳箱区分，操作态用立体的桶） */
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
