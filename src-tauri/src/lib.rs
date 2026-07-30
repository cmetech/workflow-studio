mod commands;
mod contracts;
pub mod git;
mod layout;
mod recovery;
mod startup;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(workspace::WorkspaceState::default())
        .manage(git::GitState::default())
        .manage(workspace::dialogs::DialogGrantState::default())
        .manage(contracts::ContractGrantState::default())
        .manage(layout::LayoutState::default())
        .manage(startup::RecentWorkspaceState::default())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::health::host_health,
            workspace::workspace_set_root,
            workspace::workspace_scan,
            workspace::workspace_read,
            workspace::workspace_write,
            workspace::workspace_rename_pair,
            workspace::workspace_rename_path,
            workspace::workspace_trash_paths,
            workspace::dialogs::dialog_choose_workspace,
            workspace::dialogs::dialog_choose_import_definition,
            workspace::dialogs::dialog_choose_export_directory,
            workspace::dialogs::external_read_yaml,
            workspace::dialogs::external_export_yaml_pair,
            workspace::dialogs::external_revoke_export_grant,
            startup::startup_paths,
            startup::recent_workspaces_load,
            startup::recent_workspaces_save,
            startup::recent_workspace_available,
            layout::layout_load,
            layout::layout_save,
            recovery::recovery_list,
            recovery::recovery_write,
            recovery::recovery_delete,
            contracts::contract_read_file,
            contracts::contract_run_hermes_cli,
            contracts::contract_choose_file,
            contracts::contract_choose_hermes_executable,
            contracts::contract_cache_load,
            contracts::contract_cache_write,
            git::git_detect,
            git::git_begin_history_session,
            git::git_status,
            git::git_diff_pair,
            git::git_retain_version_authorization,
            git::git_revoke_version_authorization,
            git::git_history_pair,
            git::git_retain_history_authorization,
            git::git_revoke_history_authorization,
            git::git_dispose_history_session,
            git::git_show_pair,
            git::git_init,
            git::git_set_local_identity,
            git::git_create_pair_version,
            git::git_is_tracked,
            git::git_move_path,
            git::git_move_paths,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Workflow Studio");
}
