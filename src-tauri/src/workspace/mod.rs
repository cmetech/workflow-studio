mod files;
mod paths;
mod watcher;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use same_file::Handle;
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
pub struct WorkspaceError {
    pub code: &'static str,
    pub message: String,
    #[serde(rename = "pathResults", skip_serializing_if = "Vec::is_empty")]
    pub path_results: Vec<PathOperationResult>,
}

impl WorkspaceError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path_results: Vec::new(),
        }
    }

    fn with_path_results(mut self, path_results: Vec<PathOperationResult>) -> Self {
        self.path_results = path_results;
        self
    }
}

type WorkspaceResult<T> = Result<T, WorkspaceError>;

#[derive(Default)]
pub struct WorkspaceState {
    active: Mutex<Option<ActiveWorkspace>>,
}

struct ActiveWorkspace {
    scope: WorkspaceScope,
    _watcher: watcher::WorkspaceWatcher,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathOperationResult {
    pub relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_path: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug)]
pub struct WorkspaceScope {
    root: PathBuf,
    identity: Handle,
}

impl WorkspaceScope {
    fn new(root: &Path) -> WorkspaceResult<Self> {
        let root = paths::canonical_root(root)?;
        let identity = Handle::from_path(&root).map_err(|_| {
            WorkspaceError::new(
                "workspace_root_missing",
                "The selected workspace root is no longer available.",
            )
        })?;
        Ok(Self { root, identity })
    }

    fn verify(&self) -> WorkspaceResult<&Path> {
        let canonical = paths::canonical_root(&self.root)?;
        let current = Handle::from_path(&canonical).map_err(|_| {
            WorkspaceError::new(
                "workspace_root_missing",
                "The selected workspace root is no longer available.",
            )
        })?;
        if canonical != self.root || current != self.identity {
            return Err(WorkspaceError::new(
                "workspace_root_changed",
                "The selected workspace root was replaced and must be reopened.",
            ));
        }
        Ok(&self.root)
    }
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
    let scope = WorkspaceScope::new(Path::new(&root_path))?;
    let root = scope.verify()?;
    let watcher = watcher::start(root, app)?;
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
        scope,
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
    with_scope(&state, files::scan)
}

#[tauri::command]
pub fn workspace_read(
    relative_path: String,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceReadResult> {
    with_scope(&state, |scope| {
        files::read(scope, &relative_path, files::MAX_YAML_BYTES)
    })
}

#[tauri::command]
pub fn workspace_write(
    relative_path: String,
    text: String,
    expected_current_hash: Option<String>,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceWriteResult> {
    with_scope(&state, |scope| {
        files::write(
            scope,
            &relative_path,
            &text,
            expected_current_hash.as_deref(),
        )
    })
}

#[tauri::command]
pub fn workspace_rename_pair(
    source_definition: String,
    destination_definition: String,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceRenameResult> {
    with_scope(&state, |scope| {
        files::rename_pair(scope, &source_definition, &destination_definition)
    })
}

#[tauri::command]
pub fn workspace_trash_paths(
    relative_paths: Vec<String>,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceTrashResult> {
    with_scope(&state, |scope| files::trash_paths(scope, &relative_paths))
}

fn with_scope<T>(
    state: &State<'_, WorkspaceState>,
    operation: impl FnOnce(&WorkspaceScope) -> WorkspaceResult<T>,
) -> WorkspaceResult<T> {
    let active = state.active.lock().map_err(|_| state_error())?;
    let active = active.as_ref().ok_or_else(|| {
        WorkspaceError::new(
            "workspace_not_selected",
            "Select a workspace folder before accessing workflow files.",
        )
    })?;
    operation(&active.scope)
}

fn state_error() -> WorkspaceError {
    WorkspaceError::new(
        "workspace_state_unavailable",
        "The workspace state is temporarily unavailable.",
    )
}

#[cfg(test)]
mod tests;
