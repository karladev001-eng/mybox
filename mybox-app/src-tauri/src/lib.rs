mod workspace;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            workspace::current_workspace,
            workspace::open_workspace,
            workspace::read_app_json,
            workspace::write_app_json,
            workspace::delete_app_value,
            workspace::list_app_keys,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MyBox");
}
