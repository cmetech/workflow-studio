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

pub fn start(
    root: &Path,
    git_metadata: Option<&Path>,
    app: AppHandle,
) -> WorkspaceResult<WorkspaceWatcher> {
    start_with_optional_git_sink(root, git_metadata, move |event| {
        let mut workspace_paths = Vec::new();
        let mut git_paths = Vec::new();
        for path in event.paths {
            if let Some(path) = path.strip_prefix("@git/") {
                git_paths.push(path.to_owned());
            } else {
                workspace_paths.push(path);
            }
        }
        if !workspace_paths.is_empty() {
            let _ = app.emit(
                "workspace://changed",
                WorkspaceChangedEvent {
                    paths: workspace_paths,
                    kind: event.kind.clone(),
                },
            );
        }
        if !git_paths.is_empty() {
            let _ = app.emit(
                "git://changed",
                WorkspaceChangedEvent {
                    paths: git_paths,
                    kind: event.kind,
                },
            );
        }
    })
}

#[cfg(test)]
pub(super) fn start_with_sink(
    root: &Path,
    sink: impl Fn(WorkspaceChangedEvent) + Send + 'static,
) -> WorkspaceResult<WorkspaceWatcher> {
    start_with_optional_git_sink(root, None, sink)
}

#[cfg(test)]
pub(super) fn start_with_git_metadata_sink(
    root: &Path,
    git_metadata: &Path,
    sink: impl Fn(WorkspaceChangedEvent) + Send + 'static,
) -> WorkspaceResult<WorkspaceWatcher> {
    start_with_optional_git_sink(root, Some(git_metadata), sink)
}

fn start_with_optional_git_sink(
    root: &Path,
    git_metadata: Option<&Path>,
    sink: impl Fn(WorkspaceChangedEvent) + Send + 'static,
) -> WorkspaceResult<WorkspaceWatcher> {
    start_with_optional_git_sink_and_registration(
        root,
        git_metadata,
        |watcher, path, mode| watcher.watch(path, mode),
        sink,
    )
}

#[cfg(test)]
pub(super) fn start_with_git_metadata_sink_and_registration(
    root: &Path,
    git_metadata: &Path,
    registration: impl FnMut(&mut RecommendedWatcher, &Path, RecursiveMode) -> notify::Result<()>,
    sink: impl Fn(WorkspaceChangedEvent) + Send + 'static,
) -> WorkspaceResult<WorkspaceWatcher> {
    start_with_optional_git_sink_and_registration(root, Some(git_metadata), registration, sink)
}

fn start_with_optional_git_sink_and_registration(
    root: &Path,
    git_metadata: Option<&Path>,
    mut registration: impl FnMut(&mut RecommendedWatcher, &Path, RecursiveMode) -> notify::Result<()>,
    sink: impl Fn(WorkspaceChangedEvent) + Send + 'static,
) -> WorkspaceResult<WorkspaceWatcher> {
    let root = paths::canonical_root(root)?;
    let callback_root = root.clone();
    let git_metadata = git_metadata
        .and_then(|path| paths::canonical_root(path).ok())
        .filter(|path| !path.starts_with(&root));
    let callback_git_metadata = git_metadata.clone();
    let (sender, receiver) = mpsc::channel::<Event>();
    let mut watcher = notify::recommended_watcher(move |result| {
        if let Ok(event) = result {
            let _ = sender.send(event);
        }
    })
    .map_err(watch_error)?;
    registration(&mut watcher, &root, RecursiveMode::Recursive).map_err(watch_error)?;
    if let Some(path) = &git_metadata {
        // Parent-repository observation is optional. Watching the metadata root
        // non-recursively covers HEAD, index, and packed-refs replacements; refs
        // is the only metadata subtree that needs recursive observation.
        let _ = registration(&mut watcher, path, RecursiveMode::NonRecursive);
        let refs = path.join("refs");
        if refs.is_dir() {
            let _ = registration(&mut watcher, &refs, RecursiveMode::Recursive);
        }
    }

    let worker = std::thread::spawn(move || {
        while let Ok(first) = receiver.recv() {
            let mut pending = BTreeMap::new();
            collect_event(
                &callback_root,
                callback_git_metadata.as_deref(),
                first,
                &mut pending,
            );
            loop {
                match receiver.recv_timeout(DEBOUNCE) {
                    Ok(event) => collect_event(
                        &callback_root,
                        callback_git_metadata.as_deref(),
                        event,
                        &mut pending,
                    ),
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

fn collect_event(
    root: &Path,
    git_metadata: Option<&Path>,
    event: Event,
    pending: &mut BTreeMap<String, &'static str>,
) {
    let hint = event_hint(&event.kind);
    for path in event.paths {
        let relative = paths::normalize_relative(root, &path).or_else(|| {
            git_metadata
                .and_then(|metadata| git_metadata_relative(metadata, &path))
                .map(|relative| format!("@git/{relative}"))
        });
        if let Some(relative) = relative {
            pending
                .entry(relative)
                .and_modify(|current| *current = merge_hint(current, hint))
                .or_insert(hint);
        }
    }
}

fn git_metadata_relative(metadata: &Path, path: &Path) -> Option<String> {
    let relative = paths::normalize_relative(metadata, path)?;
    if matches!(relative.as_str(), "HEAD" | "index" | "packed-refs")
        || relative == "refs"
        || relative.starts_with("refs/")
    {
        Some(relative)
    } else {
        None
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
