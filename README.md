# DailyTodo

> Windows 本地轻量待办工具。周期任务 + 一次性任务混合管理，纯本地存储，零账号、零联网依赖（节假日除外）。

采用 Tauri 2 + React 18 + TypeScript 技术栈：业务逻辑全部用 TypeScript 实现，Rust 侧只保留 Tauri 系统能力（托盘、窗口、单实例、磨砂背板），保持轻量与可维护。

技术栈于 2026-09-02 由 Qt 6.8.3 / QML 切换而来。当前处于功能完善阶段（开放迭代）。

---

## 功能特性

### 任务管理

- **六种周期类型**：仅一次（once）、工作日（workday）、非工作日（weekend）、每天（daily）、每周指定几天（weekly）、特殊周期（special：每 N 天 / 每 N 周指定星期 / 每 N 月指定几号、第几个星期几或最后一天）
- **周期任务不展开存储**：用 `schedule`（周期规则）+ `instances`（日期 → 完成记录）映射表达，避免数据膨胀
- **复合任务集（composite）**：一条父任务下挂多条带独立截止日的子任务，仅两级关系
- **DDL 扩展**：跨天一次性任务的 `completedAt` 永久完成日期、长期 DDL 判定、紧迫度色阶与「已过期」徽章
- **日清单拖拽排序**：手动排过序后固化相对顺序，DDL 自动置顶让位于用户顺序
- **提醒**：到点触发系统通知（`plugin-notification`），基于本机 `setTimeout` 调度，仅进程存活时生效
- **按维度排序入口**：任务列表提供按截止维度排序的入口（`DeadlineSortControl`），覆盖日清单与任务集展开区
- **今日截止徽章**：当天到期的任务显示「今日截止」标识，与长期 DDL 紧迫度口径并列
- **备注超长折叠**：任务 / 子任务 / 长期任务的备注超出可配置阈值时自动折叠，阈值在设置中调整

### 视图（侧栏 6 个）

| 视图 | 说明 |
| --- | --- |
| **Todo** | 分栏工作台：左栏月历化贡献墙（月 / 年轨道切换），右栏当日清单 |
| **经验** | Markdown 笔记，含分类管理、日期侧轨、图片附件、CodeMirror 编辑器与实时预览 |
| **长期** | 长期任务预览页，按 待完成 / 已逾期 / 已完成 三组可折叠展示 |
| **工具** | 工具集合页 |
| **回收站** | 删除任务按保留天数暂存，可恢复 |
| **设置** | 分类导航：数据目录、布局模式、节假日源、自启、备注折叠阈值、关闭按钮行为等 |

### 系统能力

- 悬浮窗模式（普通窗口 ↔ 悬浮窗形态切换）与简易模式（仅当日待办）
- 系统托盘 + 原生菜单、开机自启、单实例；**关闭窗口行为可配置**：收进托盘常驻或直接退出（设置项「关闭按钮行为」，统一管住自定义关闭、Alt+F4 与任务栏关闭等所有入口）
- 磨砂背板（Mica / Acrylic，Win10 降级为半透明纯色）
- 无边框自绘标题栏
- 桌宠窗口（已声明独立入口，占位实现中）

### 数据与可靠性

- **本地 JSON 存储**，数据目录 `%APPDATA%/DailyTodo/`，可配置并支持迁移
- **原子写**：写 `.tmp` → `remove` → `rename`，防中途崩溃损坏
- **备份滚动**：保留最近 7 份，源文件内容合法才备份
- **损坏兜底**：加载时校验结构，损坏则自动回退备份并提示用户原文件已另存
- **节假日识别**：缓存优先 → 联网（5s 超时）→ 星期降级三级策略，基于 holiday-cn 数据

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 前端 | React 18 + TypeScript 5 + Vite 6 |
| UI 库 | Mantine 7 |
| 状态管理 | zustand 5 |
| 日期 | date-fns 4 |
| Markdown | react-markdown + remark-gfm + CodeMirror 6 |
| Rust 侧 | tauri 2 + window-vibrancy + 官方插件集 |

---

## 快速开始

### 环境依赖

首次搭建时需准备（AI 不代装，仅说明）：

- **Node.js 18+**（推荐 LTS）
- **Rust stable**（通过 rustup 安装）
- **WebView2 Evergreen Runtime**：Windows 11 内置；Windows 10 1809+ 若未预装需单独安装，Tauri 安装包会自动引导

### 安装依赖

```bash
npm install
```

### 开发

```bash
# 日常开发（推荐）：前端走 Vite dev server，改 TSX 保存即见热更新
npm run tauri dev

# 仅调试前端（不启 Rust 侧，系统能力不可用）
npm run dev
```

> 修改 `src-tauri/` 下的 Rust 代码或 `tauri.conf.json` 需重启 dev 进程，热更新不覆盖。

### 打包

```bash
# 产出 NSIS 安装包与免安装版到 src-tauri/target/release/
npm run tauri build
```

> 注意可执行文件名取自 Cargo `[package] name`，是 `daily-todo.exe`，而非 productName 的 `DailyTodo`。

---

## 项目结构

```
.
├── index.html                  主窗口入口
├── vite.config.ts              多入口：index.html + 桌宠入口
├── package.json
├── AGENTS.md                   AI 协作约定（必读）
├── docs/                       设计文档与开发记录
│   ├── 01-架构设计.md
│   ├── 开发记录.md             ★ 阶段推进唯一依据
│   └── ...
├── src/                        前端：React 18 + TypeScript
│   ├── main.tsx                主窗口入口
│   ├── App.tsx                 装配：标题栏 + 侧栏 + 视图区
│   ├── types/                  纯类型定义，零运行时依赖
│   ├── constants/              常量集中（魔法数字归口）
│   ├── lib/                    ★ 纯函数层：业务逻辑核心
│   ├── services/            ★ 副作用层：IO、网络、计时器
│   ├── bridge/                 宿主能力门面（Tauri API 降级封装）
│   ├── stores/                 zustand：单一数据源
│   ├── components/             通用组件（跨视图复用）
│   ├── views/                  页面级视图
│   ├── pet/                    桌宠窗口（独立 Vite 入口）
│   ├── hooks/
│   └── styles/                 CSS 变量主题 + 全局样式
└── src-tauri/                  Rust 侧：仅系统能力
    ├── Cargo.toml
    ├── tauri.conf.json         窗口/打包/权限配置
    ├── capabilities/           最小权限声明
    └── src/                    main.rs / lib.rs / commands.rs（≤3 文件）
```

---

## 架构与设计约束

### 分层依赖方向（自上而下，反向依赖视为缺陷）

```
views / components / pet  →  stores  →  lib（纯） + services（副作用）  →  bridge  →  Rust
```

三条硬规则：

1. **`src/lib/`** 禁止 import `@tauri-apps/*`、`react`、`zustand`，只允许 `date-fns` 与本项目的 `types/` `constants/`——保证业务逻辑可独立单测
2. **`src/services/`** 是唯一碰宿主能力的地方，且必须通过 `bridge/` 调用（例外：`plugin-fs` 读写原语由 `services/storage.ts` 直接使用）
3. **组件**不得直接读写 store 以外的数据源，不发 fetch、不读文件

### Rust 使用边界（硬性）

- Rust 源文件总数不超过 3 个（`main.rs` / `lib.rs` / `commands.rs`）
- 单个 Rust 函数不超过 50 行
- 业务逻辑（周期计算、节假日、完成率、日期处理）一律 TypeScript，禁止下沉 Rust
- 文件读写由 TS 侧 `@tauri-apps/plugin-fs` 完成，不为此写 Rust command

### 主题

所有颜色走 CSS 变量（`src/styles/theme.css`），组件内禁止硬编码色值。深色色板已定义，切换入口待接线。

---

## 开发约定

详见 [`AGENTS.md`](./AGENTS.md)。要点：

- **AI 不代跑构建/运行/测试**，构建与效果验证由本人完成
- 技术选型固定 Tauri 2 + React 18 + TypeScript + Mantine 7，禁止混入其他框架
- 提交格式：`feat(scope): 中文说明` / `fix(scope): 中文说明`
- 分支流：dev → test → release
- 阶段进度以 `docs/开发记录.md` 为准

---

## 发布策略

代码已在 GitHub 开源，但**发布流程仍仅本地自用**：不上 GitHub Release、不接 Tauri 官方更新器。更新方式为 `npm run tauri build` 后用 `src-tauri/target/release/daily-todo.exe` 覆盖本地目录。

---

## 状态

版本 `0.2.5`。当前处于功能完善阶段（开放迭代，需求持续追加），详见 `docs/开发记录.md`。
