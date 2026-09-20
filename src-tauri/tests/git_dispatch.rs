use std::sync::mpsc;
use std::time::Duration;
use tauri::Manager;
use workflow_studio_lib::git;

// Infer the command's managed state without exposing the private workspace module.
fn workspace_state_for<T: Default + Send + Sync + 'static, R>(
    _: fn(tauri::State<'_, T>) -> R,
) -> T {
    T::default()
}

#[test]
fn blocking_git_commands_execute_outside_the_window_ipc_thread() {
    let app = tauri::test::mock_builder()
        .manage(workspace_state_for(git::git_detect))
        .manage(git::GitState::default())
        .invoke_handler(tauri::generate_handler![
            git::git_detect,
            git::git_status,
            git::git_diff_pair,
            git::git_history_pair,
            git::git_show_pair,
            git::git_init,
            git::git_set_local_identity,
            git::git_create_pair_version,
            git::git_is_tracked,
            git::git_move_path,
            git::git_move_paths,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let epoch = git::git_begin_history_session(app.state()).unwrap();
    let mut inline_commands = Vec::new();
    for (request, command) in [
        "git_detect",
        "git_status",
        "git_diff_pair",
        "git_history_pair",
        "git_show_pair",
        "git_init",
        "git_set_local_identity",
        "git_create_pair_version",
        "git_is_tracked",
        "git_move_path",
        "git_move_paths",
    ]
    .into_iter()
    .enumerate()
    {
        let (responded, response_result) = mpsc::channel();
        let view = window.as_ref().clone();
        let dispatch =
            std::thread::spawn(move || {
                let window_thread = std::thread::current().id();
                view.on_message(tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                    "root": "unused", "definitionPath": "flow.yaml", "companionPath": null,
                    "controllerEpoch": epoch, "requestGeneration": request + 1,
                    "oid": "unused", "authorizationToken": "unused", "message": "test",
                    "userName": "Test", "userEmail": "test@example.test", "path": "flow.yaml",
                    "source": "flow.yaml", "destination": "moved.yaml", "moves": []
                })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            }, Box::new(move |_, _, response, _, _| {
                responded.send((std::thread::current().id(), response)).unwrap();
            }));
                window_thread
            });
        let window_thread = dispatch.join().unwrap();
        let (response_thread, response) = response_result
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        match response {
            tauri::ipc::InvokeResponse::Err(error) => {
                assert_eq!(error.0["code"], "workspace_not_selected", "{command}")
            }
            _ => panic!("{command} did not enforce workspace selection"),
        }
        if response_thread == window_thread {
            inline_commands.push(command);
        }
    }
    assert!(
        inline_commands.is_empty(),
        "Git commands executed inline: {inline_commands:?}"
    );
}
