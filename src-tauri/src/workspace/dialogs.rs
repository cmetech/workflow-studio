use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};
use same_file::Handle;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use super::{files, PathOperationResult, WorkspaceError, WorkspaceResult};

static NEXT_EXPORT_TEMP: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct DialogGrantState {
    imports: Mutex<HashMap<PathBuf, GrantedImport>>,
    exports: Mutex<HashMap<PathBuf, GrantedExport>>,
}

struct GrantedImport {
    path: PathBuf,
    parent_path: PathBuf,
    parent_identity: Handle,
    file_identity: Handle,
    file: File,
}

struct GrantedExport {
    path: PathBuf,
    identity: Handle,
    directory: Dir,
    pending_collision: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExternalYamlReadResult {
    path: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportYamlFile {
    file_name: String,
    text: String,
}

#[derive(Debug, Serialize)]
pub struct ExternalExportResult {
    paths: Vec<String>,
    results: Vec<PathOperationResult>,
}

#[tauri::command]
pub async fn dialog_choose_workspace(app: AppHandle) -> WorkspaceResult<Option<String>> {
    chosen_directory(&app)
}

#[tauri::command]
pub async fn dialog_choose_import_definition(
    app: AppHandle,
    grants: State<'_, DialogGrantState>,
) -> WorkspaceResult<Option<String>> {
    let selected = app
        .dialog()
        .file()
        .add_filter("YAML workflows", &["yaml", "yml"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|_| invalid_dialog_path())?;
    if is_companion(&path) {
        return Err(WorkspaceError::new(
            "invalid_definition_path",
            "Choose a workflow definition; its canonical companion is imported automatically.",
        ));
    }
    let canonical = grant_import_pair(&path, &grants)?;
    unicode(&canonical).map(Some)
}

#[tauri::command]
pub async fn dialog_choose_export_directory(
    app: AppHandle,
    grants: State<'_, DialogGrantState>,
) -> WorkspaceResult<Option<String>> {
    let Some(path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let canonical = canonical_directory(&path.into_path().map_err(|_| invalid_dialog_path())?)?;
    grant_export_directory(&canonical, &grants)?;
    unicode(&canonical).map(Some)
}

#[tauri::command]
pub fn external_read_yaml(
    path: String,
    grants: State<'_, DialogGrantState>,
) -> WorkspaceResult<ExternalYamlReadResult> {
    read_granted_yaml(Path::new(&path), &grants)
}

#[tauri::command]
pub fn external_export_yaml_pair(
    directory_path: String,
    overwrite: bool,
    files: Vec<ExportYamlFile>,
    grants: State<'_, DialogGrantState>,
) -> WorkspaceResult<ExternalExportResult> {
    export_granted_yaml_pair(Path::new(&directory_path), overwrite, &files, &grants)
}

#[tauri::command]
pub fn external_revoke_export_grant(
    directory_path: String,
    grants: State<'_, DialogGrantState>,
) -> WorkspaceResult<()> {
    revoke_export_grant(Path::new(&directory_path), &grants)
}

fn chosen_directory(app: &AppHandle) -> WorkspaceResult<Option<String>> {
    let Some(selected) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let canonical = canonical_directory(&selected.into_path().map_err(|_| invalid_dialog_path())?)?;
    unicode(&canonical).map(Some)
}

fn grant_import_pair(path: &Path, grants: &DialogGrantState) -> WorkspaceResult<PathBuf> {
    let definition = bind_import_file(path)?;
    let canonical = definition.path.clone();
    let parent_path = definition.parent_path.clone();
    let mut companion_grant = None;
    if !is_companion(&canonical) {
        let companion = companion_for(&canonical);
        match fs::symlink_metadata(&companion) {
            Ok(_) => {
                let bound = bind_import_file(&companion)?;
                if bound.parent_path != parent_path
                    || bound.parent_identity != definition.parent_identity
                {
                    return Err(WorkspaceError::new(
                        "external_parent_changed",
                        "The definition and companion must remain in the same selected directory.",
                    ));
                }
                companion_grant = Some(bound);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("external_read_failed", error)),
        }
    }
    let mut permitted = grants.imports.lock().map_err(|_| grant_state_error())?;
    permitted.insert(canonical.clone(), definition);
    if let Some(bound) = companion_grant {
        permitted.insert(bound.path.clone(), bound);
    }
    Ok(canonical)
}

fn bind_import_file(path: &Path) -> WorkspaceResult<GrantedImport> {
    require_yaml(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|_| path_not_found())?;
    if metadata.file_type().is_symlink() {
        return Err(WorkspaceError::new(
            "external_symlink_rejected",
            "Selected import files must not be symbolic links.",
        ));
    }
    if !metadata.is_file() {
        return Err(path_not_found());
    }
    let canonical = path.canonicalize().map_err(|_| path_not_found())?;
    let parent_path = canonical.parent().ok_or_else(path_not_found)?.to_path_buf();
    let parent_identity =
        Handle::from_path(&parent_path).map_err(|error| io_error("external_read_failed", error))?;
    let file = File::open(&canonical).map_err(|error| io_error("external_read_failed", error))?;
    let file_identity = Handle::from_file(
        file.try_clone()
            .map_err(|error| io_error("external_read_failed", error))?,
    )
    .map_err(|error| io_error("external_read_failed", error))?;
    let named_identity =
        Handle::from_path(&canonical).map_err(|error| io_error("external_read_failed", error))?;
    if file_identity != named_identity {
        return Err(WorkspaceError::new(
            "external_path_changed",
            "The selected import file changed while permission was granted.",
        ));
    }
    Ok(GrantedImport {
        path: canonical,
        parent_path,
        parent_identity,
        file_identity,
        file,
    })
}

fn read_granted_yaml(
    path: &Path,
    grants: &DialogGrantState,
) -> WorkspaceResult<ExternalYamlReadResult> {
    let expected = path.to_path_buf();
    let mut granted = grants
        .imports
        .lock()
        .map_err(|_| grant_state_error())?
        .remove(&expected)
        .ok_or_else(|| {
            WorkspaceError::new(
                "dialog_permission_required",
                "Select this exact YAML file in the import dialog before reading it.",
            )
        })?;
    let current_parent = Handle::from_path(&granted.parent_path).map_err(|_| {
        WorkspaceError::new(
            "external_parent_changed",
            "The selected import directory changed.",
        )
    })?;
    if current_parent != granted.parent_identity {
        return Err(WorkspaceError::new(
            "external_parent_changed",
            "The selected import directory changed before the file was read.",
        ));
    }
    let metadata = fs::symlink_metadata(&granted.path).map_err(|_| path_not_found())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(WorkspaceError::new(
            "external_path_changed",
            "The selected YAML path changed before it was read.",
        ));
    }
    if metadata.len() > files::MAX_YAML_BYTES {
        return Err(WorkspaceError::new(
            "file_too_large",
            "The selected YAML file exceeds 2 MiB.",
        ));
    }
    let canonical = granted.path.canonicalize().map_err(|_| path_not_found())?;
    let named_identity =
        Handle::from_path(&canonical).map_err(|cause| io_error("external_read_failed", cause))?;
    if canonical != expected || granted.file_identity != named_identity {
        return Err(WorkspaceError::new(
            "external_path_changed",
            "The selected YAML path changed before it was read.",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    granted
        .file
        .seek(SeekFrom::Start(0))
        .map_err(|cause| io_error("external_read_failed", cause))?;
    (&mut granted.file)
        .take(files::MAX_YAML_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|cause| io_error("external_read_failed", cause))?;
    if bytes.len() as u64 > files::MAX_YAML_BYTES {
        return Err(WorkspaceError::new(
            "file_too_large",
            "The selected YAML file exceeds 2 MiB.",
        ));
    }
    let text = String::from_utf8(bytes).map_err(|_| {
        WorkspaceError::new(
            "external_read_failed",
            "The selected YAML file is not valid UTF-8.",
        )
    })?;
    Ok(ExternalYamlReadResult {
        path: unicode(&canonical)?,
        text,
    })
}

fn grant_export_directory(path: &Path, grants: &DialogGrantState) -> WorkspaceResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| path_not_found())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "external_path_changed",
            "The selected export folder must be a regular directory.",
        ));
    }
    let canonical = canonical_directory(path)?;
    if canonical != path {
        return Err(WorkspaceError::new(
            "external_path_changed",
            "The selected export folder must already be canonical.",
        ));
    }
    let identity =
        Handle::from_path(&canonical).map_err(|cause| io_error("external_export_failed", cause))?;
    let directory = Dir::open_ambient_dir(&canonical, ambient_authority())
        .map_err(|cause| io_error("external_export_failed", cause))?;
    grants
        .exports
        .lock()
        .map_err(|_| grant_state_error())?
        .insert(
            canonical.clone(),
            GrantedExport {
                path: canonical,
                identity,
                directory,
                pending_collision: None,
            },
        );
    Ok(())
}

fn revoke_export_grant(directory: &Path, grants: &DialogGrantState) -> WorkspaceResult<()> {
    grants
        .exports
        .lock()
        .map_err(|_| grant_state_error())?
        .remove(directory)
        .map(|_| ())
        .ok_or_else(|| {
            WorkspaceError::new(
                "dialog_permission_required",
                "No exact pending export permission exists for this folder.",
            )
        })
}

fn export_granted_yaml_pair(
    directory: &Path,
    overwrite: bool,
    files_to_write: &[ExportYamlFile],
    grants: &DialogGrantState,
) -> WorkspaceResult<ExternalExportResult> {
    export_granted_yaml_pair_with_commit_hook(directory, overwrite, files_to_write, grants, |_| {})
}

fn export_granted_yaml_pair_with_commit_hook(
    directory: &Path,
    overwrite: bool,
    files_to_write: &[ExportYamlFile],
    grants: &DialogGrantState,
    mut before_commit: impl FnMut(usize),
) -> WorkspaceResult<ExternalExportResult> {
    let expected = directory.to_path_buf();
    let mut grant = grants
        .exports
        .lock()
        .map_err(|_| grant_state_error())?
        .remove(&expected)
        .ok_or_else(|| {
            WorkspaceError::new(
                "dialog_permission_required",
                "Select this exact export folder before writing the YAML pair.",
            )
        })?;
    let canonical = canonical_directory(directory).map_err(|_| {
        WorkspaceError::new(
            "external_path_changed",
            "The selected export folder changed.",
        )
    })?;
    let current_identity =
        Handle::from_path(&canonical).map_err(|cause| io_error("external_export_failed", cause))?;
    if canonical != expected || grant.path != expected || current_identity != grant.identity {
        return Err(WorkspaceError::new(
            "external_path_changed",
            "The selected export folder changed.",
        ));
    }
    validate_export_pair(files_to_write)?;
    for file in files_to_write {
        if file.text.len() as u64 > files::MAX_YAML_BYTES {
            return Err(WorkspaceError::new(
                "file_too_large",
                "An exported YAML file exceeds 2 MiB.",
            ));
        }
    }
    let fingerprint = export_fingerprint(files_to_write);
    let confirmed_overwrite = match grant.pending_collision.take() {
        Some(pending) => {
            if !overwrite || pending != fingerprint {
                return Err(WorkspaceError::new(
                    "export_confirmation_mismatch",
                    "The confirmed export no longer matches the exact pending YAML pair.",
                ));
            }
            true
        }
        None => false,
    };

    if !confirmed_overwrite {
        let mut collision = false;
        for file in files_to_write {
            match grant.directory.symlink_metadata(&file.file_name) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                    return Err(WorkspaceError::new(
                        "external_path_changed",
                        "An export destination is not a regular file.",
                    ));
                }
                Ok(_) => collision = true,
                Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
                Err(cause) => return Err(io_error("external_export_failed", cause)),
            }
        }
        if collision {
            grant.pending_collision = Some(fingerprint);
            grants
                .exports
                .lock()
                .map_err(|_| grant_state_error())?
                .insert(expected, grant);
            return Err(WorkspaceError::new(
                "destination_exists",
                "One or more YAML export files already exist.",
            ));
        }
    } else {
        for file in files_to_write {
            match grant.directory.symlink_metadata(&file.file_name) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                    return Err(WorkspaceError::new(
                        "external_path_changed",
                        "An export destination is not a regular file.",
                    ))
                }
                Ok(_) => {}
                Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
                Err(cause) => return Err(io_error("external_export_failed", cause)),
            }
        }
    }

    let mut staged = Vec::with_capacity(files_to_write.len());
    for file in files_to_write {
        let temporary_name = format!(
            ".workflow-studio-export-{}-{}",
            std::process::id(),
            NEXT_EXPORT_TEMP.fetch_add(1, Ordering::Relaxed)
        );
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut temporary = match grant.directory.open_with(&temporary_name, &options) {
            Ok(temporary) => temporary,
            Err(cause) => {
                remove_staged_exports(&grant.directory, &staged);
                return Err(io_error("external_export_failed", cause));
            }
        };
        if let Err(cause) = temporary
            .write_all(file.text.as_bytes())
            .and_then(|_| temporary.sync_all())
        {
            drop(temporary);
            let _ = grant.directory.remove_file(&temporary_name);
            remove_staged_exports(&grant.directory, &staged);
            return Err(io_error("external_export_failed", cause));
        }
        staged.push(temporary_name);
    }
    let mut results = Vec::with_capacity(files_to_write.len());
    for (index, (temporary, file)) in staged.iter().zip(files_to_write).enumerate() {
        before_commit(index);
        let committed = if confirmed_overwrite {
            grant
                .directory
                .rename(temporary, &grant.directory, &file.file_name)
        } else {
            grant
                .directory
                .hard_link(temporary, &grant.directory, &file.file_name)
                .and_then(|_| grant.directory.remove_file(temporary))
        };
        let destination = canonical.join(&file.file_name);
        match committed {
            Ok(()) => results.push(export_path_result(
                &file.file_name,
                &destination,
                "written",
                None,
            )),
            Err(cause) => {
                let code = if cause.kind() == std::io::ErrorKind::AlreadyExists {
                    "destination_exists"
                } else {
                    "external_export_failed"
                };
                results.push(export_path_result(
                    &file.file_name,
                    &destination,
                    "failed",
                    Some((code, cause.to_string())),
                ));
                for remaining in &staged[index..] {
                    let _ = grant.directory.remove_file(remaining);
                }
                return Err(WorkspaceError::new(
                    "external_export_partial",
                    "The YAML export could not commit every staged file.",
                )
                .with_path_results(results));
            }
        }
    }
    let paths = files_to_write
        .iter()
        .map(|file| unicode(&canonical.join(&file.file_name)))
        .collect::<WorkspaceResult<Vec<_>>>()?;
    Ok(ExternalExportResult { paths, results })
}

fn remove_staged_exports(directory: &Dir, staged: &[String]) {
    for temporary in staged {
        let _ = directory.remove_file(temporary);
    }
}

fn export_fingerprint(files: &[ExportYamlFile]) -> String {
    let mut digest = Sha256::new();
    for file in files {
        digest.update((file.file_name.len() as u64).to_le_bytes());
        digest.update(file.file_name.as_bytes());
        digest.update((file.text.len() as u64).to_le_bytes());
        digest.update(file.text.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

fn export_path_result(
    relative_path: &str,
    destination: &Path,
    status: &str,
    failure: Option<(&str, String)>,
) -> PathOperationResult {
    PathOperationResult {
        relative_path: relative_path.to_string(),
        destination_path: unicode(destination).ok(),
        status: status.to_string(),
        error_code: failure.as_ref().map(|(code, _)| (*code).to_string()),
        message: failure.map(|(_, message)| message),
    }
}

fn validate_export_pair(files: &[ExportYamlFile]) -> WorkspaceResult<()> {
    if files.is_empty() || files.len() > 2 {
        return Err(WorkspaceError::new(
            "invalid_export_pair",
            "Export accepts one definition and one optional companion.",
        ));
    }
    let mut names = HashSet::new();
    for file in files {
        let path = Path::new(&file.file_name);
        if path.file_name().and_then(|name| name.to_str()) != Some(file.file_name.as_str())
            || !is_yaml(path)
            || !names.insert(&file.file_name)
        {
            return Err(WorkspaceError::new(
                "invalid_export_pair",
                "Export file names must be unique YAML basenames.",
            ));
        }
    }
    if is_companion(Path::new(&files[0].file_name)) {
        return Err(WorkspaceError::new(
            "invalid_export_pair",
            "The first export file must be a workflow definition.",
        ));
    }
    if files.len() == 2
        && files[1].file_name != companion_for(Path::new(&files[0].file_name)).to_string_lossy()
    {
        return Err(WorkspaceError::new(
            "invalid_export_pair",
            "The second export file must be the canonical companion.",
        ));
    }
    Ok(())
}

fn canonical_directory(path: &Path) -> WorkspaceResult<PathBuf> {
    let canonical = path.canonicalize().map_err(|_| path_not_found())?;
    if !canonical.is_dir() {
        return Err(WorkspaceError::new(
            "workspace_root_invalid",
            "The selected path is not a directory.",
        ));
    }
    Ok(canonical)
}

fn require_yaml(path: &Path) -> WorkspaceResult<()> {
    if !is_yaml(path) {
        return Err(WorkspaceError::new(
            "unsupported_file_type",
            "Only YAML files may cross this dialog grant.",
        ));
    }
    Ok(())
}

fn is_yaml(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            value.eq_ignore_ascii_case("yaml") || value.eq_ignore_ascii_case("yml")
        })
}

fn is_companion(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".hermes.yaml"))
}

fn companion_for(definition: &Path) -> PathBuf {
    let name = definition
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let stem = name
        .strip_suffix(".yaml")
        .or_else(|| name.strip_suffix(".yml"))
        .unwrap_or(name);
    definition.with_file_name(format!("{stem}.hermes.yaml"))
}

fn unicode(path: &Path) -> WorkspaceResult<String> {
    path.to_str().map(ToOwned::to_owned).ok_or_else(|| {
        WorkspaceError::new(
            "dialog_path_invalid",
            "The selected path is not valid Unicode.",
        )
    })
}

fn invalid_dialog_path() -> WorkspaceError {
    WorkspaceError::new(
        "dialog_path_invalid",
        "The selected dialog item is not a local filesystem path.",
    )
}

fn path_not_found() -> WorkspaceError {
    WorkspaceError::new(
        "path_not_found",
        "The selected path is no longer available.",
    )
}

fn grant_state_error() -> WorkspaceError {
    WorkspaceError::new(
        "dialog_grant_unavailable",
        "The one-time dialog permission state is unavailable.",
    )
}

fn io_error(code: &'static str, cause: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(code, cause.to_string())
}

#[cfg(test)]
mod tests {
    use std::future::Future;
    use std::fs;

    use tauri::AppHandle;
    use tempfile::tempdir;

    use super::{
        dialog_choose_workspace,
        export_granted_yaml_pair, export_granted_yaml_pair_with_commit_hook,
        grant_export_directory, grant_import_pair, read_granted_yaml, revoke_export_grant,
        DialogGrantState, ExportYamlFile, WorkspaceResult,
    };

    #[test]
    fn workspace_picker_command_is_async_so_cancel_can_return_to_the_webview() {
        fn require_async_command<F, Output>(_command: F)
        where
            F: FnOnce(AppHandle) -> Output,
            Output: Future<Output = WorkspaceResult<Option<String>>>,
        {
        }

        require_async_command(dialog_choose_workspace);
    }

    #[test]
    fn exact_import_grants_are_consumed_and_include_only_the_canonical_pair() {
        let root = tempdir().unwrap();
        let definition = root.path().join("flow.yaml");
        let companion = root.path().join("flow.hermes.yaml");
        let unrelated = root.path().join("other.yaml");
        fs::write(&definition, "name: flow\n").unwrap();
        fs::write(&companion, "language_compatibility: hermes-legacy\n").unwrap();
        fs::write(&unrelated, "secret: true\n").unwrap();
        let grants = DialogGrantState::default();

        let canonical = grant_import_pair(&definition, &grants).unwrap();
        assert_eq!(
            read_granted_yaml(&canonical, &grants).unwrap().text,
            "name: flow\n"
        );
        assert!(
            read_granted_yaml(&canonical, &grants).is_err(),
            "grant must be one-time"
        );
        assert!(
            read_granted_yaml(&unrelated, &grants).is_err(),
            "unselected files must remain denied"
        );
        assert_eq!(
            read_granted_yaml(&companion.canonicalize().unwrap(), &grants)
                .unwrap()
                .text,
            "language_compatibility: hermes-legacy\n"
        );
    }

    #[test]
    fn exact_export_grant_writes_only_a_canonical_yaml_pair_and_is_consumed() {
        let root = tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        let grants = DialogGrantState::default();
        grant_export_directory(&canonical, &grants).unwrap();
        let pair = [
            ExportYamlFile {
                file_name: "flow.yaml".into(),
                text: "name: flow\n".into(),
            },
            ExportYamlFile {
                file_name: "flow.hermes.yaml".into(),
                text: "language_compatibility: hermes-legacy\n".into(),
            },
        ];

        let result = export_granted_yaml_pair(&canonical, false, &pair, &grants).unwrap();
        assert_eq!(result.paths.len(), 2);
        assert_eq!(
            fs::read_to_string(root.path().join("flow.yaml")).unwrap(),
            "name: flow\n"
        );
        assert!(export_granted_yaml_pair(&canonical, true, &pair, &grants).is_err());
        assert!(!root.path().join("layouts-v1.json").exists());
    }

    #[test]
    fn export_collision_confirmation_reuses_only_the_same_pending_exact_grant() {
        let root = tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        fs::write(root.path().join("flow.yaml"), "old: true\n").unwrap();
        let grants = DialogGrantState::default();
        grant_export_directory(&canonical, &grants).unwrap();
        let pair = [ExportYamlFile {
            file_name: "flow.yaml".into(),
            text: "name: flow\n".into(),
        }];

        let collision = export_granted_yaml_pair(&canonical, false, &pair, &grants).unwrap_err();
        assert_eq!(collision.code, "destination_exists");
        export_granted_yaml_pair(&canonical, true, &pair, &grants).unwrap();
        assert_eq!(
            fs::read_to_string(root.path().join("flow.yaml")).unwrap(),
            "name: flow\n"
        );
        assert!(export_granted_yaml_pair(&canonical, true, &pair, &grants).is_err());
    }

    #[test]
    fn first_export_attempt_is_no_clobber_even_if_renderer_claims_overwrite() {
        let root = tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        fs::write(root.path().join("flow.yaml"), "old: true\n").unwrap();
        let grants = DialogGrantState::default();
        grant_export_directory(&canonical, &grants).unwrap();
        let pair = [ExportYamlFile {
            file_name: "flow.yaml".into(),
            text: "name: flow\n".into(),
        }];

        let first = export_granted_yaml_pair(&canonical, true, &pair, &grants).unwrap_err();
        assert_eq!(first.code, "destination_exists");
        assert_eq!(
            fs::read_to_string(root.path().join("flow.yaml")).unwrap(),
            "old: true\n"
        );
        export_granted_yaml_pair(&canonical, true, &pair, &grants).unwrap();
    }

    #[test]
    fn collision_confirmation_rejects_changed_content_and_consumes_the_grant() {
        let root = tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        fs::write(root.path().join("flow.yaml"), "old: true\n").unwrap();
        let grants = DialogGrantState::default();
        grant_export_directory(&canonical, &grants).unwrap();
        let first = [ExportYamlFile {
            file_name: "flow.yaml".into(),
            text: "name: first\n".into(),
        }];
        let changed = [ExportYamlFile {
            file_name: "flow.yaml".into(),
            text: "name: changed\n".into(),
        }];

        assert_eq!(
            export_granted_yaml_pair(&canonical, false, &first, &grants)
                .unwrap_err()
                .code,
            "destination_exists"
        );
        assert_eq!(
            export_granted_yaml_pair(&canonical, true, &changed, &grants)
                .unwrap_err()
                .code,
            "export_confirmation_mismatch"
        );
        assert_eq!(
            export_granted_yaml_pair(&canonical, true, &first, &grants)
                .unwrap_err()
                .code,
            "dialog_permission_required"
        );
    }

    #[test]
    fn cancelling_a_collision_revokes_the_pending_exact_export_grant() {
        let root = tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        fs::write(root.path().join("flow.yaml"), "old: true\n").unwrap();
        let grants = DialogGrantState::default();
        grant_export_directory(&canonical, &grants).unwrap();
        let pair = [ExportYamlFile {
            file_name: "flow.yaml".into(),
            text: "name: flow\n".into(),
        }];

        assert_eq!(
            export_granted_yaml_pair(&canonical, false, &pair, &grants)
                .unwrap_err()
                .code,
            "destination_exists"
        );
        revoke_export_grant(&canonical, &grants).unwrap();
        assert_eq!(
            export_granted_yaml_pair(&canonical, true, &pair, &grants)
                .unwrap_err()
                .code,
            "dialog_permission_required"
        );
    }

    #[test]
    fn export_rejects_a_selected_directory_replaced_after_the_grant() {
        let root = tempdir().unwrap();
        let selected = root.path().join("selected");
        fs::create_dir(&selected).unwrap();
        let canonical = selected.canonicalize().unwrap();
        let grants = DialogGrantState::default();
        grant_export_directory(&canonical, &grants).unwrap();
        fs::rename(&selected, root.path().join("original")).unwrap();
        fs::create_dir(&selected).unwrap();
        let pair = [ExportYamlFile {
            file_name: "flow.yaml".into(),
            text: "name: flow\n".into(),
        }];

        assert_eq!(
            export_granted_yaml_pair(&canonical, false, &pair, &grants)
                .unwrap_err()
                .code,
            "external_path_changed"
        );
        assert!(!selected.join("flow.yaml").exists());
    }

    #[test]
    fn export_reports_exact_per_file_state_when_the_second_commit_fails() {
        let root = tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        let grants = DialogGrantState::default();
        grant_export_directory(&canonical, &grants).unwrap();
        let pair = [
            ExportYamlFile {
                file_name: "flow.yaml".into(),
                text: "name: flow\n".into(),
            },
            ExportYamlFile {
                file_name: "flow.hermes.yaml".into(),
                text: "language_compatibility: hermes-legacy\n".into(),
            },
        ];

        let result =
            export_granted_yaml_pair_with_commit_hook(&canonical, false, &pair, &grants, |index| {
                if index == 1 {
                    fs::write(canonical.join("flow.hermes.yaml"), "raced: true\n").unwrap();
                }
            })
            .unwrap_err();

        assert_eq!(result.code, "external_export_partial");
        assert_eq!(result.path_results.len(), 2);
        assert_eq!(result.path_results[0].relative_path, "flow.yaml");
        assert_eq!(result.path_results[0].status, "written");
        assert_eq!(result.path_results[1].relative_path, "flow.hermes.yaml");
        assert_eq!(result.path_results[1].status, "failed");
    }

    #[test]
    fn import_rejects_a_parent_directory_replaced_after_the_grant() {
        let root = tempdir().unwrap();
        let selected = root.path().join("selected");
        fs::create_dir(&selected).unwrap();
        let definition = selected.join("flow.yaml");
        fs::write(&definition, "name: flow\n").unwrap();
        let grants = DialogGrantState::default();
        let canonical = grant_import_pair(&definition, &grants).unwrap();
        fs::rename(&selected, root.path().join("original")).unwrap();
        fs::create_dir(&selected).unwrap();
        fs::write(selected.join("flow.yaml"), "name: attacker\n").unwrap();

        assert_eq!(
            read_granted_yaml(&canonical, &grants).unwrap_err().code,
            "external_parent_changed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn import_rejects_selected_symlinks_and_companions_outside_the_bound_parent() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("outside.yaml"), "name: outside\n").unwrap();
        symlink(
            outside.path().join("outside.yaml"),
            root.path().join("flow.yaml"),
        )
        .unwrap();
        let grants = DialogGrantState::default();
        assert_eq!(
            grant_import_pair(&root.path().join("flow.yaml"), &grants)
                .unwrap_err()
                .code,
            "external_symlink_rejected"
        );

        fs::remove_file(root.path().join("flow.yaml")).unwrap();
        fs::write(root.path().join("flow.yaml"), "name: flow\n").unwrap();
        symlink(
            outside.path().join("outside.yaml"),
            root.path().join("flow.hermes.yaml"),
        )
        .unwrap();
        assert_eq!(
            grant_import_pair(&root.path().join("flow.yaml"), &grants)
                .unwrap_err()
                .code,
            "external_symlink_rejected"
        );
    }
}
