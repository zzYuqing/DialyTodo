// 职责：软件配置的单一数据源，含主题、窗口形态与节假日数据源。
// 组件只发 action，变更即时落盘。

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { defaultSettings } from "@/lib";
import { loadSettings, saveSettings } from "@/services";
import type { AppSettings } from "@/types";

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  initialize: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  devtools((set, get) => ({
    settings: defaultSettings(),
    loaded: false,

    async initialize() {
      const settings = await loadSettings();
      set({ settings, loaded: true });
    },

    async update(patch) {
      const next = { ...get().settings, ...patch };
      set({ settings: next });
      await saveSettings(next);
    },
  })),
);
