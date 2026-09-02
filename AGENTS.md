# AGENTS.md

本文件是 AI 协作者在本仓库中的行为约定。开工前先读完，默认始终生效。

项目：DailyTodo —— Windows 本地轻量待办工具（Tauri 2 + React 18 + TypeScript + Mantine 7）。

技术栈于 2026-09-02 下午由 Qt 6.8.3 / QML 切换而来，理由见 `开发提示词草稿.txt` 3.3 节。

---

## 一、最重要的一条：不要自己编译

**AI 不得在本仓库执行任何构建、运行、测试命令。构建与效果验证由用户本人完成。**

明确禁止：

- 执行 `npm` / `npx` / `pnpm` / `yarn` / `cargo` / `tauri` 的任何构建或安装子命令
  （含 `npm install`、`npm run dev`、`npm run build`、`npm run tauri dev`、`cargo build`、`cargo check` 等）
- 启动 `DailyTodo.exe` 或任何子进程来"看看效果对不对"
- 为了确认代码能编过而偷偷跑一次构建
- 自动安装依赖、自动修改环境变量、自动创建目录以外的系统级改动

原因：用户的工作流是「AI 出代码 → 用户自己构建 → 用户看效果 → 反馈给 AI 改」。
AI 代跑构建会抢走这一步，而且构建报错本该由用户亲眼看到。

**AI 每个阶段交付时，用文字说明三件事：**

1. 新增 / 修改了哪些文件的完整路径
2. 用户接下来要做什么（要执行哪条命令；新增依赖要装哪个包）
3. 已知问题、待确认点、以及可能踩的坑

---

## 二、构建方式（供用户参考，AI 不执行）

- IDE：VS Code 或 Cursor（装 `rust-analyzer` 与 Tauri 官方扩展）
- 开发：`npm run tauri dev` —— 前端走 Vite dev server，**有热更新**，改 TSX 保存即可见
- 打包：`npm run tauri build` —— 产出 NSIS 安装包与免安装版
- 前端单独调试：`npm run dev`（不启 Rust 侧，系统能力不可用）

环境依赖（用户首次搭建时需要，AI 只说明不代装）：

- Node.js 18+（推荐 LTS）
- Rust stable（通过 rustup 安装）
- WebView2 Evergreen Runtime：Windows 11 内置；Windows 10 1809+ 若未装需单独安装，
  Tauri 的安装包会自动引导

> 与上一版 Qt 工程不同：前端改代码有热更新，不必每次重新构建整个应用。
> 但修改 `src-tauri/` 下的 Rust 代码或 `tauri.conf.json` 仍需重启 dev 进程。

---

## 三、扩展约定

- 新增前端文件：无需登记，Vite 按目录自动解析
- 新增依赖：先说明理由并征得用户同意，再写入 `package.json` 或 `src-tauri/Cargo.toml`
  ——依赖白名单见 `开发提示词草稿.txt` 3.2 节
- 新增 Tauri 插件：需同时改 `Cargo.toml` 依赖、`lib.rs` 的注册，
  以及 `src-tauri/capabilities/default.json` 的权限声明（按最小权限原则）
- 新增 Rust command：先在 `lib.rs` 注册，再说明为什么 TypeScript 做不到（见 3.5 节边界）

---

## 四、禁止改动清单

- 技术选型：Tauri 2 + React 18 + TypeScript + Mantine 7，不得改回或混入其他框架
- `src-tauri/tauri.conf.json`：窗口尺寸、productName、identifier、bundle 配置
- `src-tauri/capabilities/default.json`：不得为图省事放宽为全权限
- 禁止引入：CMake、Qt、Electron、任何其他构建系统或 GUI 框架
- 禁止引入：包管理器 vcpkg / Conan

**Rust 使用边界（硬性，详见提示词 3.5 节）：**

- Rust 源文件总数不超过 3 个
- 业务逻辑（周期计算、节假日、完成率、日期处理）一律写 TypeScript，禁止下沉到 Rust
- 单个 Rust 函数不超过 50 行
- 文件读写在 TS 侧用 `@tauri-apps/plugin-fs` 完成，不得为此新写 Rust command

本仓库中的 `开发提示词草稿.txt` 属于工程文件，不得删除或改写。

---

## 五、代码规范

- TypeScript：`strict` 模式；组件 PascalCase，函数与变量 camelCase，类型与接口 PascalCase，
  常量 UPPER_SNAKE；文件顶部写职责说明
- Rust：`snake_case` 函数与变量、PascalCase 类型；仅在允许的边界内出现
- 关键算法（周期展开、节假日判定、完成率计算）写清思路注释
- 注释用简体中文
- 组件中禁止硬编码颜色与尺寸，一律引用 CSS 变量（`src/styles/theme.css`）
- 不使用实验性 / 技术预览版依赖
- 不写旧版本兼容回退代码（不为旧系统、旧框架版本做降级分支）
- 字段、键值重命名时，直接改所有生产端与消费端，不留旧名做回退

---

## 六、PowerShell 写文件

从 PowerShell 写文本文件时，用 .NET UTF-8 无 BOM 写入器：

```powershell
$enc = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($path, $content, $enc)
```

不要用 `Set-Content` / `Out-File` / 重定向运算符而不显式指定编码。

注意：PowerShell 5.1 读取**无 BOM 的 UTF-8 脚本文件会按 GBK 解码，中文会破坏语法**。
写 `.ps1` 脚本时一律使用纯 ASCII 内容。

---

## 七、Git 规范

- 提交格式沿用 `feat(scope): 中文说明` / `fix(scope): 中文说明`，正文用列表说明改了什么
- 分支流：dev → test → release，经 PR 合并
- **用户要求"写 commit"时，只返回提交信息文本，不执行 git add / commit 等写操作**，除非用户明确要求执行
- 写 commit 前先自行 `git diff` / `git status` 查看改动；确认当前在 dev 分支且没有 merge 残留（检查 `MERGE_HEAD`）
- 除用户明确说"重写"外，每次都按一次全新提交处理，不合并上一次的内容

---

## 八、删除文件

删除任何文件前先向用户说明清单并取得确认。不要执行递归删除、通配符批量删除，或 `rm -rf` / `del /S /Q` 这类命令。

**当前有一批待清理的遗留文件**（上一版 Qt / QML 产物，已作废）：
根目录 `CMakeLists.txt`、`CMakePresets.json`、`CMakeUserPresets.json`、`build.ps1`，
以及 `src/` 下的 C++ 文件、`qml/` 目录、`out/` 目录。

阶段 1 时先列出完整清单给用户确认，确认后再删除。清理前可先阅读旧代码提取业务逻辑设计要点
（任务模型、四种周期规则、JSON 存储、备份、节假日判定），但不要逐行翻译 C++。
