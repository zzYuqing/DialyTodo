// 职责：前端需要的系统能力命令。
// 硬性约束（提示词 3.5）：单函数不超过 50 行；不含任何业务逻辑；
// 新增 command 前必须先说明 TypeScript 为何做不到。

use tauri::Manager;

/// 从托盘恢复并聚焦主窗口。
/// 为何必须 Rust：WebView 无法 unminimize 自身之外的窗口。
#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) {
    crate::focus_main_window(&app);
}

/// 显示 / 隐藏桌宠窗口（提示词 5.7）。
/// 为何必须 Rust：桌宠窗口由宿主创建并持有 handle，且需保证与主窗口同进程。
#[tauri::command]
pub fn toggle_pet_window(app: tauri::AppHandle) {
    let Some(pet) = app.get_webview_window("pet") else {
        return;
    };

    if pet.is_visible().unwrap_or(false) {
        let _ = pet.hide();
    } else {
        let _ = pet.show();
        let _ = pet.set_focus();
    }
}

/// 桌宠鼠标穿透开关。
/// 为何必须 Rust：set_ignore_cursor_events 作用于原生窗口句柄。
#[tauri::command]
pub fn set_pet_ignore_cursor(app: tauri::AppHandle, ignore: bool) {
    if let Some(pet) = app.get_webview_window("pet") {
        let _ = pet.set_ignore_cursor_events(ignore);
    }
}

/// 退出应用，退出前先销毁桌宠窗口，避免留下孤儿窗口（提示词 5.7）。
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    if let Some(pet) = app.get_webview_window("pet") {
        let _ = pet.destroy();
    }
    app.exit(0);
}

/// 把用户选定的自定义数据目录加入 fs 访问白名单与 asset 协议白名单（运行时动态授权，不持久化）。
/// 为何必须 Rust：plugin-fs 的 scope 与 asset 协议 scope 校验都发生在宿主进程，TS 侧没有扩展 scope 的 API。
/// 同时加入 asset scope 是为了让 convertFileSrc 能加载自定义数据目录下的图片（md 内嵌图片渲染）。
/// 启动时由 TS 在解析到非默认数据目录后调用一次；迁移前也调用一次。
#[tauri::command]
pub fn authorize_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;

    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|err| err.to_string())?;

    // 自定义数据目录不在 assetProtocol 静态 scope（$APPDATA/**）内，
    // 需运行时加入，否则该目录下的附件图片经 convertFileSrc 转成的 asset URL 会静默裂图。
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|err| err.to_string())?;

    Ok(())
}

/// 通过系统网络读取公开资讯文本，不带任何鉴权请求头。
/// 为何必须 Rust：WebView 的 fetch 受 CORS 限制，大量公开 RSS 虽可访问却不允许浏览器读取。
/// 仅接受 HTTP(S) 域名；拒绝 localhost 与 IP 字面量，避免借此访问本机服务。
#[tauri::command]
pub async fn fetch_public_text(url: String, timeout_ms: u64) -> Result<String, String> {
    use tauri_plugin_http::reqwest;

    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "无效的资讯地址".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("仅支持 HTTP(S) 资讯地址".to_string());
    }
    let host = parsed.host_str().ok_or_else(|| "资讯地址缺少主机名".to_string())?;
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".local")
        || host.parse::<std::net::IpAddr>().is_ok()
    {
        return Err("不允许读取本机或 IP 地址".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.max(1000)))
        .user_agent("DailyTodo/0.3")
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?;
    response.text().await.map_err(|err| err.to_string())
}

/// 重启应用：先脱离当前进程树拉起一个新实例，再退出当前实例（托盘菜单「重启」用）。
/// 为何必须 Rust：拉起新进程并终止自身属于宿主进程能力，WebView 做不到。
/// 用 `cmd /c start` 启动使新实例不被父进程 job 一并结束，拉起成功后再退出当前实例。
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    use std::process::Command;

    if let Ok(exe) = std::env::current_exe() {
        let exe_str = exe.to_string_lossy().to_string();
        let args = vec!["/C".to_string(), "start".to_string(), "".to_string(), exe_str];
        if Command::new("cmd").args(args).spawn().is_ok() {
            if let Some(pet) = app.get_webview_window("pet") {
                let _ = pet.destroy();
            }
            app.exit(0);
        }
    }
}
