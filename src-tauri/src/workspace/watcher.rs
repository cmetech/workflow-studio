use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use same_file::Handle;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::paths;
use super::{WorkspaceError, WorkspaceResult};
use crate::git::GitRepositoryMetadata;

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
    git_metadata: Option<&GitRepositoryMetadata>,
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
    git_metadata: &GitRepositoryMetadata,
    sink: impl Fn(WorkspaceChangedEvent) + Send + 'static,
) -> WorkspaceResult<WorkspaceWatcher> {
    start_with_optional_git_sink(root, Some(git_metadata), sink)
}

fn start_with_optional_git_sink(
    root: &Path,
    git_metadata: Option<&GitRepositoryMetadata>,
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
    git_metadata: &GitRepositoryMetadata,
    registration: impl FnMut(&mut RecommendedWatcher, &Path, RecursiveMode) -> notify::Result<()>,
    sink: impl Fn(WorkspaceChangedEvent) + Send + 'static,
) -> WorkspaceResult<WorkspaceWatcher> {
    start_with_optional_git_sink_and_registration(root, Some(git_metadata), registration, sink)
}

fn start_with_optional_git_sink_and_registration(
    root: &Path,
    git_metadata: Option<&GitRepositoryMetadata>,
    mut registration: impl FnMut(&mut RecommendedWatcher, &Path, RecursiveMode) -> notify::Result<()>,
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
    registration(&mut watcher, &root, RecursiveMode::Recursive).map_err(watch_error)?;
    let mut watched_git_metadata = WatchedGitMetadata::default();
    if let Some(metadata) = git_metadata {
        // Git observation is optional. Watch only per-worktree HEAD/index and
        // common packed refs/refs, and do not duplicate the primary root watch.
        let mut registered = BTreeSet::new();
        for (path, expected, destination) in [
            (
                &metadata.worktree_dir,
                Some(metadata.worktree_identity.as_ref()),
                &mut watched_git_metadata.worktree_dir,
            ),
            (
                &metadata.common_dir,
                Some(metadata.common_identity.as_ref()),
                &mut watched_git_metadata.common_dir,
            ),
        ] {
            let Some(path) = verified_directory(path, expected) else {
                continue;
            };
            let covered_by_workspace = path.starts_with(&root);
            let already_registered = registered.contains(&path);
            let registration_succeeded = !covered_by_workspace
                && !already_registered
                && registration(&mut watcher, &path, RecursiveMode::NonRecursive).is_ok();
            if covered_by_workspace || already_registered || registration_succeeded {
                registered.insert(path.clone());
                *destination = Some(path);
            }
        }
        // Revalidate the exact detected common directory again immediately
        // before registering its recursive refs child.
        if let Some(common_dir) = verified_directory(
            &metadata.common_dir,
            Some(metadata.common_identity.as_ref()),
        )
        .filter(|path| watched_git_metadata.common_dir.as_ref() == Some(path))
        {
            let refs = common_dir.join("refs");
            let refs_is_directory = refs
                .symlink_metadata()
                .is_ok_and(|entry| entry.is_dir() && !entry.file_type().is_symlink());
            if refs_is_directory && !refs.starts_with(&root) && registered.insert(refs.clone()) {
                let _ = registration(&mut watcher, &refs, RecursiveMode::Recursive);
            }
        }
    }
    let git_metadata = Some(watched_git_metadata)
        .filter(|metadata| metadata.worktree_dir.is_some() || metadata.common_dir.is_some());
    let callback_git_metadata = git_metadata.clone();

    let worker = std::thread::spawn(move || {
        while let Ok(first) = receiver.recv() {
            let mut pending = BTreeMap::new();
            collect_event(
                &callback_root,
                callback_git_metadata.as_ref(),
                first,
                &mut pending,
            );
            loop {
                match receiver.recv_timeout(DEBOUNCE) {
                    Ok(event) => collect_event(
                        &callback_root,
                        callback_git_metadata.as_ref(),
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
    git_metadata: Option<&WatchedGitMetadata>,
    event: Event,
    pending: &mut BTreeMap<String, &'static str>,
) {
    let hint = event_hint(&event.kind);
    for path in event.paths {
        let relative = git_metadata
            .and_then(|metadata| git_metadata_relative(metadata, &path))
            .map(|relative| format!("@git/{relative}"))
            .or_else(|| {
                if git_metadata.is_some_and(|metadata| metadata.contains(&path)) {
                    None
                } else {
                    paths::normalize_relative(root, &path)
                }
            });
        if let Some(relative) = relative {
            pending
                .entry(relative)
                .and_modify(|current| *current = merge_hint(current, hint))
                .or_insert(hint);
        }
    }
}

#[derive(Clone, Default)]
struct WatchedGitMetadata {
    worktree_dir: Option<std::path::PathBuf>,
    common_dir: Option<std::path::PathBuf>,
}

impl WatchedGitMetadata {
    fn contains(&self, path: &Path) -> bool {
        self.worktree_dir
            .as_deref()
            .is_some_and(|directory| path.starts_with(directory))
            || self
                .common_dir
                .as_deref()
                .is_some_and(|directory| path.starts_with(directory))
    }
}

fn verified_directory(path: &Path, expected: Option<&Handle>) -> Option<std::path::PathBuf> {
    let expected = expected?;
    let canonical = paths::canonical_root(path).ok()?;
    let current = Handle::from_path(&canonical).ok()?;
    (current == *expected).then_some(canonical)
}

fn git_metadata_relative(metadata: &WatchedGitMetadata, path: &Path) -> Option<String> {
    if let Some(relative) = metadata
        .worktree_dir
        .as_deref()
        .and_then(|directory| paths::normalize_relative(directory, path))
    {
        if matches!(relative.as_str(), "HEAD" | "index") {
            return Some(format!("worktree/{relative}"));
        }
    }
    if let Some(relative) = metadata
        .common_dir
        .as_deref()
        .and_then(|directory| paths::normalize_relative(directory, path))
    {
        if relative == "packed-refs" || relative == "refs" || relative.starts_with("refs/") {
            return Some(format!("common/{relative}"));
        }
    }
    None
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
