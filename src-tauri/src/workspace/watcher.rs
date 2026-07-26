use std::collections::BTreeMap;
use std::path::Path;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::paths;
use super::{WorkspaceError, WorkspaceResult};

const DEBOUNCE: Duration = Duration::from_millis(150);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceChangedEvent {
    pub(super) paths: Vec<String>,
    pub(super) kind: String,
}

pub struct WorkspaceWatcher {
    watcher: Option<RecommendedWatcher>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for WorkspaceWatcher {
    fn drop(&mut self) {
        // Dropping the native watcher drops its callback sender and wakes the worker.
        self.watcher.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub fn start(root: &Path, app: AppHandle) -> WorkspaceResult<WorkspaceWatcher> {
    start_with_sink(root, move |event| {
        let _ = app.emit("workspace://changed", event);
    })
}

pub(super) fn start_with_sink(
    root: &Path,
    sink: impl Fn(WorkspaceChangedEvent) + Send + 'static,
) -> WorkspaceResult<WorkspaceWatcher> {
    let root = paths::canonical_root(root)?;
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

    let worker = std::thread::spawn(move || {
        while let Ok(first) = receiver.recv() {
            let mut pending = BTreeMap::new();
            collect_event(&callback_root, first, &mut pending);
            loop {
                match receiver.recv_timeout(DEBOUNCE) {
                    Ok(event) => collect_event(&callback_root, event, &mut pending),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            let mut batches: BTreeMap<&'static str, Vec<String>> = BTreeMap::new();
            for (path, hint) in pending {
                batches.entry(hint).or_default().push(path);
            }
            for (kind, paths) in batches {
                sink(WorkspaceChangedEvent {
                    paths,
                    kind: kind.to_string(),
                });
            }
        }
    });
    Ok(WorkspaceWatcher {
        watcher: Some(watcher),
        worker: Some(worker),
    })
}

fn collect_event(root: &Path, event: Event, pending: &mut BTreeMap<String, &'static str>) {
    let hint = event_hint(&event.kind);
    for path in event.paths {
        if let Some(relative) = paths::normalize_relative(root, &path) {
            pending
                .entry(relative)
                .and_modify(|current| *current = merge_hint(current, hint))
                .or_insert(hint);
        }
    }
}

fn merge_hint(current: &'static str, next: &'static str) -> &'static str {
    match (current, next) {
        ("rename", _) | (_, "rename") => "rename",
        ("create", "modify") => "create",
        ("create", "remove") => "remove",
        ("remove", "create") => "modify",
        ("remove", "modify") => "remove",
        (_, next) => next,
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
