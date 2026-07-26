use std::collections::BTreeMap;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::paths;
use super::{WorkspaceError, WorkspaceResult};

const DEBOUNCE: Duration = Duration::from_millis(150);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceChangedEvent {
    paths: Vec<String>,
    kind: String,
}

pub fn start(root: &Path, app: AppHandle) -> WorkspaceResult<RecommendedWatcher> {
    let root = root.to_path_buf();
    let callback_root = root.clone();
    let (sender, receiver) = mpsc::channel::<Event>();
    let mut watcher = notify::recommended_watcher(move |result| {
        if let Ok(event) = result {
            let _ = sender.send(event);
        }
    })
    .map_err(watch_error)?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(watch_error)?;

    std::thread::spawn(move || {
        while let Ok(first) = receiver.recv() {
            let mut pending = BTreeMap::new();
            collect_event(&callback_root, first, &mut pending);
            loop {
                match receiver.recv_timeout(DEBOUNCE) {
                    Ok(event) => collect_event(&callback_root, event, &mut pending),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            if pending.is_empty() {
                continue;
            }
            let kind = if pending.values().all(|value| *value == "create") {
                "create"
            } else if pending.values().all(|value| *value == "remove") {
                "remove"
            } else if pending.values().any(|value| *value == "rename") {
                "rename"
            } else {
                "modify"
            };
            let _ = app.emit(
                "workspace://changed",
                WorkspaceChangedEvent {
                    paths: pending.into_keys().collect(),
                    kind: kind.to_string(),
                },
            );
        }
    });
    Ok(watcher)
}

fn collect_event(root: &Path, event: Event, pending: &mut BTreeMap<String, &'static str>) {
    let hint = event_hint(&event.kind);
    for path in event.paths {
        if let Some(relative) = paths::normalize_relative(root, &path) {
            pending.insert(relative, hint);
        }
    }
}

pub(super) fn event_hint(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Remove(_) => "remove",
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => "rename",
        _ => "modify",
    }
}

fn watch_error(error: notify::Error) -> WorkspaceError {
    WorkspaceError::new(
        "workspace_watch_failed",
        format!("The workspace could not be watched: {error}"),
    )
}
