mod files;
mod paths;
mod watcher;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::RecommendedWatcher;
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
pub struct WorkspaceError {
    pub code: &'static str,
    pub message: String,
}

impl WorkspaceError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

type WorkspaceResult<T> = Result<T, WorkspaceError>;

#[derive(Default)]
pub struct WorkspaceState {
    active: Mutex<Option<ActiveWorkspace>>,
}

struct ActiveWorkspace {
    root: PathBuf,
    _watcher: RecommendedWatcher,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootInfo {
    workspace_id: String,
    root_path: String,
}

#[tauri::command]
pub fn workspace_set_root(
    root_path: String,
    state: State<'_, WorkspaceState>,
    app: AppHandle,
) -> WorkspaceResult<WorkspaceRootInfo> {
    let root = paths::canonical_root(Path::new(&root_path))?;
    let watcher = watcher::start(&root, app)?;
    let root_path = root
        .to_str()
        .ok_or_else(|| {
            WorkspaceError::new(
                "workspace_root_invalid",
                "The selected workspace root is not valid Unicode.",
            )
        })?
        .to_string();
    let workspace_id = files::hash_bytes(root_path.as_bytes());
    let mut active = state.active.lock().map_err(|_| state_error())?;
    *active = Some(ActiveWorkspace {
        root,
        _watcher: watcher,
    });
    Ok(WorkspaceRootInfo {
        workspace_id,
        root_path,
    })
}

#[tauri::command]
pub fn workspace_scan(
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<Vec<files::WorkspaceFileEntry>> {
    files::scan(&active_root(&state)?)
}

#[tauri::command]
pub fn workspace_read(
    relative_path: String,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceReadResult> {
    files::read(&active_root(&state)?, &relative_path, files::MAX_YAML_BYTES)
}

#[tauri::command]
pub fn workspace_write(
    relative_path: String,
    text: String,
    expected_current_hash: Option<String>,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceWriteResult> {
    files::write(
        &active_root(&state)?,
        &relative_path,
        &text,
        expected_current_hash.as_deref(),
    )
}

#[tauri::command]
pub fn workspace_rename_pair(
    source_definition: String,
    destination_definition: String,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceRenameResult> {
    files::rename_pair(
        &active_root(&state)?,
        &source_definition,
        &destination_definition,
    )
}

#[tauri::command]
pub fn workspace_trash_paths(
    relative_paths: Vec<String>,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceTrashResult> {
    files::trash_paths(&active_root(&state)?, &relative_paths)
}

fn active_root(state: &State<'_, WorkspaceState>) -> WorkspaceResult<PathBuf> {
    let active = state.active.lock().map_err(|_| state_error())?;
    let root = active.as_ref().ok_or_else(|| {
        WorkspaceError::new(
            "workspace_not_selected",
            "Select a workspace folder before accessing workflow files.",
        )
    })?;
    // Canonicalization is repeated by each concrete operation immediately before use.
    Ok(root.root.clone())
}

fn state_error() -> WorkspaceError {
    WorkspaceError::new(
        "workspace_state_unavailable",
        "The workspace state is temporarily unavailable.",
    )
}

#[cfg(test)]
mod tests;
