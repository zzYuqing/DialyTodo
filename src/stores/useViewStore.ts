// 职责：视图状态的单一数据源 —— 当前视图、选中日期、是否隐藏已完成。
// 与业务数据分离：这些数据不需要持久化，仅存在于当前会话。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { todayKey } from "@/lib";

export type ViewName = "day" | "month" | "contribution" | "archive" | "settings";

interface ViewState {
  view: ViewName;
  /** 当前选中的日期，YYYY-MM-DD */
  selectedDate: string;
  /** 日视图中隐藏已完成任务（提示词 5.1），跟随设置但允许会话内临时覆盖 */
  hideCompleted: boolean;
  setView: (view: ViewName) => void;
  setSelectedDate: (dateKey: string) => void;
  setHideCompleted: (hide: boolean) => void;
}

export const useViewStore = create<ViewState>()(
  devtools((set) => ({
    view: "day",
    selectedDate: todayKey(),
    hideCompleted: false,

    setView: (view) => set({ view }),
    setSelectedDate: (selectedDate) => set({ selectedDate }),
    setHideCompleted: (hideCompleted) => set({ hideCompleted }),
  })),
);
