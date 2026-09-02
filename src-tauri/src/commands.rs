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

/// 普通窗口 ↔ 悬浮窗形态切换（提示词 5.5）。
/// 为何必须 Rust：需改动 alwaysOnTop / skipTaskbar 等宿主窗口标志与窗口尺寸。
#[tauri::command]
pub fn switch_window_mode(app: tauri::AppHandle, floating: bool) {
    use tauri::{LogicalSize, Size};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if floating {
        let _ = window.set_always_on_top(true);
        let _ = window.set_skip_taskbar(true);
        let _ = window.set_size(Size::Logical(LogicalSize {
            width: 380.0,
            height: 560.0,
        }));
    } else {
        let _ = window.set_always_on_top(false);
        let _ = window.set_skip_taskbar(false);
        let _ = window.set_size(Size::Logical(LogicalSize {
            width: 980.0,
            height: 680.0,
        }));
    }
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
