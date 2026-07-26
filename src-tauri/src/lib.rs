mod commands;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(workspace::WorkspaceState::default())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::health::host_health,
            workspace::workspace_set_root,
            workspace::workspace_scan,
            workspace::workspace_read,
            workspace::workspace_write,
            workspace::workspace_rename_pair,
            workspace::workspace_trash_paths,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Workflow Studio");
}
