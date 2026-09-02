// 职责：Vite 构建配置。
// 两个入口：主窗口 index.html，桌宠窗口 src/pet/pet.html（桌宠是独立窗口，提示词 5.7）。
// Tauri 开发模式下固定 1420 端口并打开 strictPort，避免端口漂移导致 Rust 侧连不上前端。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: [{ find: "@", replacement: `${projectRoot}src` }],
  },

  build: {
    // WebView2 为常青 Chromium，可安全锁定较新的语法目标
    target: "es2021",
    rollupOptions: {
      input: {
        main: `${projectRoot}index.html`,
        pet: `${projectRoot}src/pet/pet.html`,
      },
    },
  },

  // Tauri 需要捕获 CLI 输出，不要清屏
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // 排除 src-tauri，避免 Rust 改动触发前端无谓刷新
    watch: { ignored: ["**/src-tauri/**"] },
  },

  envPrefix: ["VITE_", "TAURI_ENV_*"],
});
