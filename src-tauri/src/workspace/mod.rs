pub(crate) mod artifacts;
pub(crate) mod dialogs;
mod files;
pub(crate) mod generated_write;
pub(crate) mod package_hash;
mod paths;
pub(crate) mod transaction;
mod transaction_recovery;
mod watcher;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use same_file::Handle;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

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
    pub(crate) generation: u64,
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
    recovery: Option<transaction_recovery::RecoveryStore>,
    recovery_error: Option<String>,
}

impl WorkspaceScope {
    pub(crate) fn new(root: &Path) -> WorkspaceResult<Self> {
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
            #[cfg(test)]
            recovery: Some(transaction_recovery::RecoveryStore::isolated()?),
            #[cfg(not(test))]
            recovery: None,
            recovery_error: None,
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

    pub(crate) fn root_path(&self) -> WorkspaceResult<&Path> {
        self.verify()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootInfo {
    workspace_id: String,
    root_path: String,
    repository: Option<crate::git::GitRepository>,
}

#[tauri::command]
pub fn workspace_set_root(
    root_path: String,
    state: State<'_, WorkspaceState>,
    git_state: State<'_, crate::git::GitState>,
    app: AppHandle,
) -> WorkspaceResult<WorkspaceRootInfo> {
    let mut scope = WorkspaceScope::new(Path::new(&root_path))?;
    let recovery = app
        .path()
        .app_data_dir()
        .map_err(|error| WorkspaceError::new("workspace_recovery_unavailable", error.to_string()))
        .and_then(|app_data| {
            transaction_recovery::RecoveryStore::open_outside(
                &app_data.join("transaction-recovery"),
                &scope,
            )
        });
    match recovery {
        Ok(store) => scope.recovery = Some(store),
        Err(error) => {
            scope.recovery = None;
            scope.recovery_error = Some(error.message);
        }
    }
    let root = scope.verify()?;
    let (info, git_metadata) = discover_workspace_root(root)?;
    let watcher = watcher::start(root, git_metadata.as_ref(), app)?;
    let mut active = state.active.lock().map_err(|_| state_error())?;
    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed);
    *active = Some(ActiveWorkspace {
        scope,
        _watcher: Some(watcher),
        generation,
    });
    git_state.clear();
    Ok(info)
}

fn discover_workspace_root(
    root: &Path,
) -> WorkspaceResult<(WorkspaceRootInfo, Option<crate::git::GitRepositoryMetadata>)> {
    let detected = crate::git::detect_repository_context(root).ok().flatten();
    match detected {
        Some(detected) => Ok((
            workspace_root_info(root, Some(detected.repository))?,
            Some(detected.metadata),
        )),
        None => Ok((workspace_root_info(root, None)?, None)),
    }
}

fn workspace_root_info(
    root: &Path,
    repository: Option<crate::git::GitRepository>,
) -> WorkspaceResult<WorkspaceRootInfo> {
    let canonical = root.to_str().ok_or_else(|| {
        WorkspaceError::new(
            "workspace_root_invalid",
            "The selected workspace root is not valid Unicode.",
        )
    })?;
    let public = crate::platform_paths::public_path(root).map_err(|error| {
        WorkspaceError::new(
            "workspace_root_invalid",
            format!("The selected workspace root cannot be displayed safely: {error}"),
        )
    })?;
    let root_path = public
        .to_str()
        .ok_or_else(|| {
            WorkspaceError::new(
                "workspace_root_invalid",
                "The selected workspace root is not valid Unicode.",
            )
        })?
        .to_string();
    Ok(WorkspaceRootInfo {
        workspace_id: files::hash_bytes(canonical.as_bytes()),
        root_path,
        repository,
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
pub fn workspace_rename_path(
    source: String,
    destination: String,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceRenameResult> {
    with_scope(&state, |scope| {
        files::rename_path(scope, &source, &destination)
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

#[cfg(all(test, windows))]
mod path_boundary_tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{files, workspace_root_info, WorkspaceScope};

    #[test]
    fn public_root_info_does_not_replace_a_long_canonical_workspace_identity() {
        let parent = tempdir().unwrap();
        let mut selected = parent.path().join("workspace");
        while selected.to_string_lossy().len() <= 280 {
            selected.push("nested-long-path-segment");
        }
        fs::create_dir_all(&selected).unwrap();
        let scope = WorkspaceScope::new(&selected).unwrap();
        let canonical = scope.root_path().unwrap().to_path_buf();

        assert!(canonical.to_string_lossy().starts_with(r"\\?\"));
        assert!(canonical.to_string_lossy().len() > 260);
        let info = workspace_root_info(&canonical, None).unwrap();
        let serialized = serde_json::to_value(&info).unwrap();

        assert!(!info.root_path.starts_with(r"\\?\"));
        assert_eq!(serialized["rootPath"], info.root_path);
        assert_eq!(scope.root_path().unwrap(), canonical);
        assert_eq!(
            info.workspace_id,
            files::hash_bytes(canonical.to_str().unwrap().as_bytes())
        );
    }
}

#[cfg(test)]
mod repository_result_tests {
    use std::process::Command;

    use tempfile::tempdir;

    use super::discover_workspace_root;

    #[test]
    fn root_info_includes_the_repository_discovered_for_watcher_binding() {
        let directory = tempdir().unwrap();
        let root = directory.path();
        assert!(Command::new("git")
            .args(["-C", root.to_str().unwrap(), "init", "-b", "main"])
            .status()
            .unwrap()
            .success());
        crate::git::reset_read_probe_count_for_test();
        let (info, metadata) = discover_workspace_root(root).unwrap();
        let repository = info.repository.clone().unwrap();

        let serialized = serde_json::to_value(info).unwrap();

        assert_eq!(crate::git::read_probe_count_for_test(), 1);
        assert!(metadata.is_some());
        assert_eq!(
            serialized["repository"],
            serde_json::to_value(repository).unwrap()
        );
        #[cfg(windows)]
        assert!(!serialized["repository"]["root"]
            .as_str()
            .unwrap()
            .starts_with(r"\\?\"));
    }
}

#[cfg(test)]
mod package_mutation_tests;
