// 职责：视图状态的单一数据源 —— 当前视图、选中日期、是否隐藏已完成，以及贡献栏的呈现状态。
// 与业务数据分离：这些数据不需要持久化，仅存在于当前会话。
// view 只有三个值；贡献栏（Todo 页左栏）的粒度与宽度也是会话级 UI 状态，收在这里。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { todayKey } from "@/lib";

export type ViewName = "todo" | "experience" | "longterm" | "tools" | "settings";

/** 贡献栏的时间粒度：月 = 近 12 个月迷你月历，年 = 整年色块转置（行为周） */
export type RailMode = "month" | "year";

/** 贡献栏宽度限制（可拖动右缘调整） */
export const RAIL_WIDTH_MIN = 200;
export const RAIL_WIDTH_MAX = 480;
export const RAIL_WIDTH_DEFAULT = 300;

interface ViewState {
  view: ViewName;
  /** 当前选中的日期，YYYY-MM-DD */
  selectedDate: string;
  /** 日视图中隐藏已完成任务（提示词 5.1），跟随设置但允许会话内临时覆盖 */
  hideCompleted: boolean;
  /** 贡献栏时间粒度（会话级 UI 状态） */
  railMode: RailMode;
  /** 贡献栏像素宽度（会话级 UI 状态，拖动时由 CalendarRail 夹紧到限值内） */
  railWidth: number;
  setView: (view: ViewName) => void;
  setSelectedDate: (dateKey: string) => void;
  setHideCompleted: (hide: boolean) => void;
  setRailMode: (mode: RailMode) => void;
  setRailWidth: (width: number) => void;
}

export const useViewStore = create<ViewState>()(
  devtools((set) => ({
    view: "todo",
    selectedDate: todayKey(),
    hideCompleted: false,
    railMode: "month",
    railWidth: RAIL_WIDTH_DEFAULT,

    setView: (view) => set({ view }),
    setSelectedDate: (selectedDate) => set({ selectedDate }),
    setHideCompleted: (hideCompleted) => set({ hideCompleted }),
    setRailMode: (railMode) => set({ railMode }),
    setRailWidth: (railWidth) => set({ railWidth }),
  })),
);
