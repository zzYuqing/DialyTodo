// 职责：窗口形态的副作用封装（提示词 5.5）。
// 仅封装宿主窗口调用：隐藏到托盘、置顶切换、界面模式（布局 + 尺寸）、边缘吸附、迷你模式缩窗。
// 不含业务判定；何时调用由 hooks/useWindowMode 决定。
// 置顶与界面模式互相独立：置顶只改 always-on-top，界面模式只改布局与尺寸。

import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import {
  EDGE_SNAP_THRESHOLD,
  FULL_HEIGHT,
  FULL_MIN_HEIGHT,
  FULL_MIN_WIDTH,
  FULL_WIDTH,
  MINI_HEIGHT,
  MINI_WIDTH,
  SIMPLE_HEIGHT,
  SIMPLE_MIN_HEIGHT,
  SIMPLE_MIN_WIDTH,
  SIMPLE_WIDTH,
} from "@/constants";
import type { LayoutMode } from "@/types";

/** 隐藏主窗口到托盘（进程常驻，内存态不丢）。托盘双击或菜单「打开主窗口」负责唤起。 */
export async function hideMainWindow(): Promise<void> {
  await getCurrentWindow().hide();
}

/** 窗口置顶开关（提示词 5.5）：只管 setAlwaysOnTop，不调尺寸与布局。 */
export async function applyAlwaysOnTop(on: boolean): Promise<void> {
  await getCurrentWindow().setAlwaysOnTop(on);
}

/**
 * 界面模式：按模式设置窗口最小尺寸与当前尺寸（提示词 5.5）。
 * full / simple 各有预设；mini 暂未开放，落入 full 分支兜底（保留接口不删）。
 * 先收紧 min 约束再 setSize，确保窗口回到 ≥ min 的预设尺寸。
 */
export async function applyLayout(layout: LayoutMode): Promise<void> {
  const win = getCurrentWindow();

  if (layout === "simple") {
    await win.setSizeConstraints({
      minWidth: SIMPLE_MIN_WIDTH,
      minHeight: SIMPLE_MIN_HEIGHT,
    });
    await win.setSize(new LogicalSize(SIMPLE_WIDTH, SIMPLE_HEIGHT));
  } else {
    await win.setSizeConstraints({
      minWidth: FULL_MIN_WIDTH,
      minHeight: FULL_MIN_HEIGHT,
    });
    await win.setSize(new LogicalSize(FULL_WIDTH, FULL_HEIGHT));
  }
}

/**
 * 边缘吸附：窗口拖动靠近屏幕边缘时自动贴边（提示词 5.5）。
 * 当前置顶开关不再触发吸附，接口保留未接线。
 * 落位前先置 snapping 标志，吸收 setPosition 引发的 onMoved 回弹，避免抖动。
 */
export async function enableEdgeSnap(register: (unlisten: () => void) => void): Promise<void> {
  const win = getCurrentWindow();
  let snapping = false;

  const unlisten = await win.onMoved(async ({ payload: pos }) => {
    if (snapping) return;

    const monitor = await currentMonitor();
    if (monitor === null) return;
    const size = await win.outerSize();

    // 统一换算到逻辑像素做比较，阈值视觉一致，不受 DPI 缩放影响
    const mPos = monitor.position.toLogical(monitor.scaleFactor);
    const mSize = monitor.size.toLogical(monitor.scaleFactor);
    const wPos = pos.toLogical(monitor.scaleFactor);
    const wSize = size.toLogical(monitor.scaleFactor);

    const leftDist = wPos.x - mPos.x;
    const topDist = wPos.y - mPos.y;
    const rightDist = mPos.x + mSize.width - (wPos.x + wSize.width);
    const bottomDist = mPos.y + mSize.height - (wPos.y + wSize.height);

    let nx = wPos.x;
    let ny = wPos.y;
    if (Math.abs(leftDist) <= EDGE_SNAP_THRESHOLD) {
      nx = mPos.x;
    } else if (Math.abs(rightDist) <= EDGE_SNAP_THRESHOLD) {
      nx = mPos.x + mSize.width - wSize.width;
    }
    if (Math.abs(topDist) <= EDGE_SNAP_THRESHOLD) {
      ny = mPos.y;
    } else if (Math.abs(bottomDist) <= EDGE_SNAP_THRESHOLD) {
      ny = mPos.y + mSize.height - wSize.height;
    }

    if (nx !== wPos.x || ny !== wPos.y) {
      snapping = true;
      await win.setPosition(new LogicalPosition(nx, ny));
      setTimeout(() => {
        snapping = false;
      }, 120);
    }
  });

  register(unlisten);
}

/**
 * 迷你模式：缩成小条 / 恢复完整尺寸（提示词 5.5，暂未开放，接口保留）。
 * 缩窗前先移除 min 约束（否则 min 会挡住缩小），恢复时还原完整模式约束与尺寸。
 */
export async function setMiniMode(on: boolean): Promise<void> {
  const win = getCurrentWindow();
  if (on) {
    await win.setSizeConstraints(null);
    await win.setSize(new LogicalSize(MINI_WIDTH, MINI_HEIGHT));
  } else {
    await win.setSizeConstraints({
      minWidth: FULL_MIN_WIDTH,
      minHeight: FULL_MIN_HEIGHT,
    });
    await win.setSize(new LogicalSize(FULL_WIDTH, FULL_HEIGHT));
  }
}
