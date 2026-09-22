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
        .invoke_handler(tauri::generate_handler![
            commands::show_main_window,
            commands::toggle_pet_window,
            commands::set_pet_ignore_cursor,
            commands::quit_app,
            commands::restart_app,
            commands::authorize_dir,
        ])
        .setup(setup_app)
        .build(tauri::generate_context!())
        .expect("DailyTodo 初始化失败");

    app.run(|_app_handle, _event| {});
}

/// 启动装配：应用窗口背板效果，随后构建托盘菜单。
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // 开发构建：加载 dev 图标，让运行中的 dev 窗口/托盘与已发布的 exe 一眼区分。
    // release 跳过此分支，继续使用 bundle 图标，无需重打包正式 exe。
    #[cfg(debug_assertions)]
    apply_dev_icon(app);

    apply_window_effect(app.app_handle());
    build_tray_menu(app)?;
    Ok(())
}

/// 加载 dev 图标；仅在 debug 构建中可用，release 不参与编译。
#[cfg(debug_assertions)]
fn load_dev_icon() -> Option<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/dev-icon.png")).ok()
}

/// 开发构建：将主窗口图标替换为 dev 图标。
#[cfg(debug_assertions)]
fn apply_dev_icon(app: &tauri::App) {
    if let Some(icon) = load_dev_icon() {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_icon(icon);
        }
    }
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
    let restart_item = MenuItemBuilder::with_id("restart", "重启").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&pet_item)
        .separator()
        .item(&restart_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let mut builder = TrayIconBuilder::with_id("daily-todo-tray")
        .menu(&menu)
        .show_menu_on_left_click(false);

    // 托盘图标：dev 构建用 dev 图标，release 用 bundle 默认图标。
    #[cfg(debug_assertions)]
    let tray_icon = load_dev_icon();
    #[cfg(not(debug_assertions))]
    let tray_icon = app.default_window_icon().cloned();

    if let Some(icon) = tray_icon {
        builder = builder.icon(icon);
    }

    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => focus_main_window(app),
            "pet" => commands::toggle_pet_window(app.clone()),
            "restart" => commands::restart_app(app.clone()),
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
