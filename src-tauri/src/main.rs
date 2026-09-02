// 职责：进程入口，仅转调 lib。禁止在此写任何业务逻辑（提示词 3.5）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    daily_todo_lib::run()
}
