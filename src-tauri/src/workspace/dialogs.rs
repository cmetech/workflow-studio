use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use same_file::Handle;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use super::{files, WorkspaceError, WorkspaceResult};

#[derive(Default)]
pub struct DialogGrantState {
    imports: Mutex<HashSet<PathBuf>>,
    exports: Mutex<HashSet<PathBuf>>,
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
}

#[tauri::command]
pub fn dialog_choose_workspace(app: AppHandle) -> WorkspaceResult<Option<String>> {
    chosen_directory(&app)
}

#[tauri::command]
pub fn dialog_choose_import_definition(
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
pub fn dialog_choose_export_directory(
    app: AppHandle,
    grants: State<'_, DialogGrantState>,
) -> WorkspaceResult<Option<String>> {
    let Some(path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let canonical = canonical_directory(&path.into_path().map_err(|_| invalid_dialog_path())?)?;
    grants
        .exports
        .lock()
        .map_err(|_| grant_state_error())?
        .insert(canonical.clone());
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

fn chosen_directory(app: &AppHandle) -> WorkspaceResult<Option<String>> {
    let Some(selected) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let canonical = canonical_directory(&selected.into_path().map_err(|_| invalid_dialog_path())?)?;
    unicode(&canonical).map(Some)
}

fn grant_import_pair(path: &Path, grants: &DialogGrantState) -> WorkspaceResult<PathBuf> {
    let canonical = canonical_yaml_file(path)?;
    let mut permitted = grants.imports.lock().map_err(|_| grant_state_error())?;
    permitted.insert(canonical.clone());
    if !is_companion(&canonical) {
        let companion = companion_for(&canonical);
        if companion.is_file() {
            permitted.insert(canonical_yaml_file(&companion)?);
        }
    }
    Ok(canonical)
}

fn read_granted_yaml(
    path: &Path,
    grants: &DialogGrantState,
) -> WorkspaceResult<ExternalYamlReadResult> {
    let expected = path.to_path_buf();
    let was_granted = grants
        .imports
        .lock()
        .map_err(|_| grant_state_error())?
        .remove(&expected);
    if !was_granted {
        return Err(WorkspaceError::new(
            "dialog_permission_required",
            "Select this exact YAML file in the import dialog before reading it.",
        ));
    }
    require_yaml(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|_| path_not_found())?;
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
    let mut file = File::open(path).map_err(|cause| io_error("external_read_failed", cause))?;
    let identity = Handle::from_file(
        file.try_clone()
            .map_err(|cause| io_error("external_read_failed", cause))?,
    )
    .map_err(|cause| io_error("external_read_failed", cause))?;
    let canonical = path.canonicalize().map_err(|_| path_not_found())?;
    let named_identity =
        Handle::from_path(&canonical).map_err(|cause| io_error("external_read_failed", cause))?;
    if canonical != expected || identity != named_identity {
        return Err(WorkspaceError::new(
            "external_path_changed",
            "The selected YAML path changed before it was read.",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    (&mut file)
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

fn export_granted_yaml_pair(
    directory: &Path,
    overwrite: bool,
    files_to_write: &[ExportYamlFile],
    grants: &DialogGrantState,
) -> WorkspaceResult<ExternalExportResult> {
    let expected = directory.to_path_buf();
    let was_granted = grants
        .exports
        .lock()
        .map_err(|_| grant_state_error())?
        .contains(&expected);
    if !was_granted {
        return Err(WorkspaceError::new(
            "dialog_permission_required",
            "Select this exact export folder before writing the YAML pair.",
        ));
    }
    let canonical = canonical_directory(directory)?;
    if canonical != expected {
        return Err(WorkspaceError::new(
            "external_path_changed",
            "The selected export folder changed.",
        ));
    }
    validate_export_pair(files_to_write)?;
    let destinations: Vec<PathBuf> = files_to_write
        .iter()
        .map(|file| canonical.join(&file.file_name))
        .collect();
    for destination in &destinations {
        match fs::symlink_metadata(destination) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(WorkspaceError::new(
                    "external_path_changed",
                    "An export destination is not a regular file.",
                ))
            }
            Ok(_) if !overwrite => {
                return Err(WorkspaceError::new(
                    "destination_exists",
                    "One or more YAML export files already exist.",
                ))
            }
            Ok(_) => {}
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
            Err(cause) => return Err(io_error("external_export_failed", cause)),
        }
    }

    grants
        .exports
        .lock()
        .map_err(|_| grant_state_error())?
        .remove(&expected);

    let mut staged = Vec::with_capacity(files_to_write.len());
    for file in files_to_write {
        if file.text.len() as u64 > files::MAX_YAML_BYTES {
            return Err(WorkspaceError::new(
                "file_too_large",
                "An exported YAML file exceeds 2 MiB.",
            ));
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&canonical)
            .map_err(|cause| io_error("external_export_failed", cause))?;
        temporary
            .write_all(file.text.as_bytes())
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|cause| io_error("external_export_failed", cause))?;
        staged.push(temporary);
    }
    for (temporary, destination) in staged.into_iter().zip(&destinations) {
        if overwrite {
            temporary.persist(destination)
        } else {
            temporary.persist_noclobber(destination)
        }
        .map_err(|cause| {
            io_error(
                if cause.error.kind() == std::io::ErrorKind::AlreadyExists {
                    "destination_exists"
                } else {
                    "external_export_failed"
                },
                cause.error,
            )
        })?;
    }
    Ok(ExternalExportResult {
        paths: destinations
            .iter()
            .map(|path| unicode(path))
            .collect::<WorkspaceResult<Vec<_>>>()?,
    })
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

fn canonical_yaml_file(path: &Path) -> WorkspaceResult<PathBuf> {
    require_yaml(path)?;
    let canonical = path.canonicalize().map_err(|_| path_not_found())?;
    if !canonical.is_file() {
        return Err(path_not_found());
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
    use std::fs;

    use tempfile::tempdir;

    use super::{
        export_granted_yaml_pair, grant_import_pair, read_granted_yaml, DialogGrantState,
        ExportYamlFile,
    };

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
        grants.exports.lock().unwrap().insert(canonical.clone());
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
        grants.exports.lock().unwrap().insert(canonical.clone());
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
}
