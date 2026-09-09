// 职责：应用装配 —— 插件注册、托盘菜单、单实例回调、窗口磨砂背板。
// 硬性约束（提示词 3.5）：本文件只做系统能力，不得承载任何业务逻辑；单函数不超过 50 行。
// 提示词十五节已拍板：托盘菜单用 Tauri 原生菜单，此处是唯一允许集中写菜单逻辑的地方。

mod commands;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// 应用入口装配。
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        // 单实例：二次启动直接唤起已有窗口，不开第二个进程
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            commands::show_main_window,
            commands::toggle_pet_window,
            commands::set_pet_ignore_cursor,
            commands::quit_app,
            commands::authorize_dir,
        ])
        .setup(setup_app)
        .build(tauri::generate_context!())
        .expect("DailyTodo 初始化失败");

    app.run(|_app_handle, _event| {});
}

/// 启动装配：应用窗口背板效果，随后构建托盘菜单。
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    apply_window_effect(app.app_handle());
    build_tray_menu(app)?;
    Ok(())
}

/// 按系统版本应用窗口背板：Windows 11 用 Mica，失败（Windows 10）降级为 Acrylic 半透明纯色。
fn apply_window_effect(app: &tauri::AppHandle) {
    use window_vibrancy::{apply_acrylic, apply_mica};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if apply_mica(&window, Some(true)).is_err() {
        // 提示词六节：Windows 10 降级为半透明纯色 + 细边框
        let _ = apply_acrylic(&window, Some((245, 246, 248, 220)));
    }
}

/// 构建托盘图标与原生菜单。
fn build_tray_menu(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItemBuilder::with_id("show", "打开主窗口").build(app)?;
    let pet_item = MenuItemBuilder::with_id("pet", "显示 / 隐藏桌宠").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&pet_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let mut builder = TrayIconBuilder::with_id("daily-todo-tray")
        .menu(&menu)
        .show_menu_on_left_click(false);

    // 托盘图标统一由代码构建（config 静态 trayIcon 已移除，避免双图标）；
    // 显式复用应用默认窗口图标，确保托盘有图。
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => focus_main_window(app),
            "pet" => commands::toggle_pet_window(app.clone()),
            "quit" => commands::quit_app(app.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键双击托盘图标唤起主窗口（提示词 5.5「最小化到托盘后台常驻」，
            // 常驻后需能从托盘恢复；此前未监听左键事件导致双击无响应）
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                focus_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// 唤起并聚焦主窗口（托盘菜单与单实例回调共用）。
pub fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
