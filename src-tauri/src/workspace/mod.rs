pub(crate) mod dialogs;
mod files;
mod paths;
mod watcher;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use cap_std::ambient_authority;
use cap_std::fs::Dir;
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

pub struct WorkspaceState {
    active: Mutex<Option<ActiveWorkspace>>,
    next_generation: AtomicU64,
}

impl WorkspaceState {
    pub(crate) fn active_binding(&self) -> Result<WorkspaceBinding, WorkspaceError> {
        let active = self.active.lock().map_err(|_| state_error())?;
        let active = active.as_ref().ok_or_else(|| {
            WorkspaceError::new(
                "workspace_not_selected",
                "Select a workspace folder before inspecting local Git.",
            )
        })?;
        Ok(WorkspaceBinding {
            root: active.scope.root_path()?.to_path_buf(),
            generation: active.generation,
        })
    }

    pub(crate) fn binding_is_current(
        &self,
        binding: &WorkspaceBinding,
    ) -> Result<bool, WorkspaceError> {
        let active = self.active.lock().map_err(|_| state_error())?;
        let Some(active) = active.as_ref() else {
            return Ok(false);
        };
        Ok(active.generation == binding.generation && active.scope.root_path()? == binding.root)
    }
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            next_generation: AtomicU64::new(1),
        }
    }
}

pub(crate) struct WorkspaceBinding {
    pub(crate) root: PathBuf,
    generation: u64,
}

struct ActiveWorkspace {
    scope: WorkspaceScope,
    _watcher: Option<watcher::WorkspaceWatcher>,
    generation: u64,
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
    directory: Dir,
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
        let directory = Dir::open_ambient_dir(&root, ambient_authority()).map_err(|error| {
            WorkspaceError::new(
                "workspace_root_missing",
                format!("The selected workspace root could not be opened: {error}"),
            )
        })?;
        Ok(Self {
            root,
            identity,
            directory,
        })
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

    fn directory(&self) -> WorkspaceResult<&Dir> {
        self.verify()?;
        Ok(&self.directory)
    }

    fn root_path(&self) -> WorkspaceResult<&Path> {
        self.verify()
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
    git_state: State<'_, crate::git::GitState>,
    app: AppHandle,
) -> WorkspaceResult<WorkspaceRootInfo> {
    let scope = WorkspaceScope::new(Path::new(&root_path))?;
    let root = scope.verify()?;
    let git_metadata = crate::git::detect_repository_metadata(root).ok().flatten();
    let watcher = watcher::start(root, git_metadata.as_deref(), app)?;
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
    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed);
    *active = Some(ActiveWorkspace {
        scope,
        _watcher: Some(watcher),
        generation,
    });
    git_state.clear();
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
    requests: Vec<files::TrashPathRequest>,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceTrashResult> {
    with_scope(&state, |scope| files::trash_paths(scope, &requests))
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
