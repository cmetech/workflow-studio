use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

#[cfg(windows)]
use cap_std::fs::Permissions;
use cap_std::fs::{Dir, File, Metadata, OpenOptions};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::paths;
use super::{PathOperationResult, WorkspaceError, WorkspaceResult, WorkspaceScope};

pub const MAX_YAML_BYTES: u64 = 2 * 1024 * 1024;
static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileEntry {
    pub relative_path: String,
    pub kind: String,
    pub size: u64,
    pub modified_at: String,
    pub symlink: String,
    pub read_only: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReadResult {
    pub relative_path: String,
    pub text: String,
    pub sha256: String,
    pub size: u64,
    pub modified_at: String,
    pub read_only: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWriteResult {
    pub relative_path: String,
    pub sha256: String,
    pub size: u64,
    pub modified_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRenameResult {
    pub paths: Vec<String>,
    pub results: Vec<PathOperationResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTrashResult {
    pub results: Vec<PathOperationResult>,
}

pub fn scan(scope: &WorkspaceScope) -> WorkspaceResult<Vec<WorkspaceFileEntry>> {
    scan_impl(scope, |_| {})
}

#[cfg(test)]
pub fn scan_with_entry_hook(
    scope: &WorkspaceScope,
    hook: impl FnMut(&str),
) -> WorkspaceResult<Vec<WorkspaceFileEntry>> {
    scan_impl(scope, hook)
}

fn scan_impl(
    scope: &WorkspaceScope,
    mut entry_hook: impl FnMut(&str),
) -> WorkspaceResult<Vec<WorkspaceFileEntry>> {
    let root = scope.directory()?;
    let mut entries = Vec::new();
    scan_directory(root, "", &mut entries, &mut entry_hook)?;
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(entries)
}

fn scan_directory(
    directory: &Dir,
    prefix: &str,
    entries: &mut Vec<WorkspaceFileEntry>,
    entry_hook: &mut impl FnMut(&str),
) -> WorkspaceResult<()> {
    let children = directory
        .entries()
        .map_err(|error| capability_error("workspace_scan_failed", error))?;
    for child in children {
        let child = child.map_err(|error| capability_error("workspace_scan_failed", error))?;
        let file_name = child.file_name();
        let Some(file_name_text) = file_name.to_str() else {
            continue;
        };
        let relative_path = if prefix.is_empty() {
            file_name_text.to_string()
        } else {
            format!("{prefix}/{file_name_text}")
        };
        let file_type = child
            .file_type()
            .map_err(|error| capability_error("workspace_scan_failed", error))?;
        entry_hook(&relative_path);

        if excluded_directory(&file_name) {
            continue;
        }

        if file_type.is_symlink() {
            let target_metadata = child.metadata().ok();
            let safe = target_metadata.is_some();
            let kind = if target_metadata.as_ref().is_some_and(|value| value.is_dir()) {
                "directory"
            } else {
                "file"
            };
            if let Some(details) = target_metadata.as_ref() {
                entries.push(entry_from_metadata(
                    relative_path,
                    kind,
                    details,
                    if safe { "safe" } else { "unsafe" },
                ));
            } else {
                entries.push(WorkspaceFileEntry {
                    relative_path,
                    kind: kind.to_string(),
                    size: 0,
                    modified_at: "0".to_string(),
                    symlink: "unsafe".to_string(),
                    read_only: true,
                });
            }
            continue;
        }

        let metadata = match child.metadata() {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                entries.push(WorkspaceFileEntry {
                    relative_path,
                    kind: if file_type.is_dir() {
                        "directory"
                    } else {
                        "file"
                    }
                    .to_string(),
                    size: 0,
                    modified_at: "0".to_string(),
                    symlink: "unsafe".to_string(),
                    read_only: true,
                });
                continue;
            }
            Err(error) => return Err(capability_error("workspace_scan_failed", error)),
        };
        if metadata.is_dir() {
            entries.push(entry_from_metadata(
                relative_path.clone(),
                "directory",
                &metadata,
                "none",
            ));
            let child_directory = child
                .open_dir()
                .map_err(|error| capability_error("workspace_scan_failed", error))?;
            scan_directory(&child_directory, &relative_path, entries, entry_hook)?;
        } else if metadata.is_file() {
            entries.push(entry_from_metadata(
                relative_path,
                "file",
                &metadata,
                "none",
            ));
        }
    }
    Ok(())
}

fn excluded_directory(name: &std::ffi::OsStr) -> bool {
    const EXCLUDED: &[&str] = &[
        ".git",
        ".next",
        ".nuxt",
        ".pnpm",
        ".svelte-kit",
        ".vite",
        ".workflow-studio",
        ".yarn",
        "build",
        "coverage",
        "deps",
        "dist",
        "node_modules",
        "out",
        "target",
        "vendor",
    ];
    name.to_str().is_some_and(|value| EXCLUDED.contains(&value))
}

fn entry_from_metadata(
    relative_path: String,
    kind: &str,
    metadata: &Metadata,
    symlink: &str,
) -> WorkspaceFileEntry {
    WorkspaceFileEntry {
        relative_path,
        kind: kind.to_string(),
        size: if metadata.is_file() {
            metadata.len()
        } else {
            0
        },
        modified_at: modified_timestamp(metadata),
        symlink: symlink.to_string(),
        read_only: metadata.permissions().readonly(),
    }
}

struct BoundPath {
    parent: Dir,
    name: OsString,
}

struct StagedFile<'a> {
    parent: &'a Dir,
    name: OsString,
    file: Option<File>,
    active: bool,
}

impl<'a> StagedFile<'a> {
    fn new(parent: &'a Dir) -> WorkspaceResult<Self> {
        for _ in 0..100 {
            let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
            let name = OsString::from(format!(
                ".workflow-studio-{}-{sequence}.tmp",
                std::process::id()
            ));
            let mut options = OpenOptions::new();
            options.read(true).write(true).create_new(true);
            match parent.open_with(&name, &options) {
                Ok(file) => {
                    return Ok(Self {
                        parent,
                        name,
                        file: Some(file),
                        active: true,
                    })
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(io_error("workspace_write_failed", error)),
            }
        }
        Err(WorkspaceError::new(
            "workspace_write_failed",
            "A unique temporary file could not be created.",
        ))
    }

    fn file_mut(&mut self) -> &mut File {
        self.file.as_mut().expect("staged file remains open")
    }

    fn persist_replace(mut self, target: &OsStr) -> WorkspaceResult<()> {
        self.file.take();
        self.parent
            .rename(&self.name, self.parent, target)
            .map_err(|error| io_error("workspace_write_failed", error))?;
        self.active = false;
        Ok(())
    }

    fn persist_noclobber(mut self, target: &OsStr) -> WorkspaceResult<()> {
        self.file.take();
        self.parent
            .hard_link(&self.name, self.parent, target)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    revision_conflict()
                } else {
                    io_error("workspace_write_failed", error)
                }
            })?;
        self.parent.remove_file(&self.name).map_err(|error| {
            WorkspaceError::new(
                "workspace_write_partial",
                format!("The file was saved, but its temporary link could not be removed: {error}"),
            )
        })?;
        self.active = false;
        Ok(())
    }
}

impl Drop for StagedFile<'_> {
    fn drop(&mut self) {
        if self.active {
            self.file.take();
            let _ = self.parent.remove_file(&self.name);
        }
    }
}

fn bind_path(scope: &WorkspaceScope, relative: &str) -> WorkspaceResult<BoundPath> {
    let relative_path = paths::validate_relative(relative)?;
    let root = scope.directory()?;
    let parent_path = relative_path.parent().unwrap_or_else(|| Path::new(""));
    let parent = if parent_path.as_os_str().is_empty() {
        root.try_clone()
    } else {
        root.open_dir(parent_path)
    }
    .map_err(|error| capability_error("path_outside_workspace", error))?;
    let name = relative_path
        .file_name()
        .ok_or_else(|| {
            WorkspaceError::new(
                "invalid_relative_path",
                "The workspace path has no file name.",
            )
        })?
        .to_os_string();
    Ok(BoundPath { parent, name })
}

pub fn read(
    scope: &WorkspaceScope,
    relative: &str,
    max_bytes: u64,
) -> WorkspaceResult<WorkspaceReadResult> {
    read_impl(scope, relative, max_bytes, || {})
}

#[cfg(test)]
pub fn read_with_bound_hook(
    scope: &WorkspaceScope,
    relative: &str,
    max_bytes: u64,
    hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceReadResult> {
    read_impl(scope, relative, max_bytes, hook)
}

fn read_impl(
    scope: &WorkspaceScope,
    relative: &str,
    max_bytes: u64,
    bound_hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceReadResult> {
    require_yaml(relative)?;
    let bound = bind_path(scope, relative)?;
    bound_hook();
    let file = bound
        .parent
        .open(&bound.name)
        .map_err(|error| capability_error("workspace_read_failed", error))?;
    let metadata = file
        .metadata()
        .map_err(|error| capability_error("workspace_read_failed", error))?;
    if !metadata.is_file() {
        return Err(WorkspaceError::new(
            "not_a_file",
            "The requested workspace path is not a file.",
        ));
    }
    let ceiling = max_bytes.min(MAX_YAML_BYTES);
    if metadata.len() > ceiling {
        return Err(WorkspaceError::new(
            "file_too_large",
            "The YAML file exceeds the supported size limit.",
        ));
    }

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(ceiling + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("workspace_read_failed", error))?;
    if bytes.len() as u64 > ceiling {
        return Err(WorkspaceError::new(
            "file_too_large",
            "The YAML file exceeds the supported size limit.",
        ));
    }
    let text = String::from_utf8(bytes.clone()).map_err(|_| {
        WorkspaceError::new("invalid_utf8", "Workflow YAML must be valid UTF-8 text.")
    })?;
    Ok(WorkspaceReadResult {
        relative_path: relative.to_string(),
        text,
        sha256: hash_bytes(&bytes),
        size: bytes.len() as u64,
        modified_at: modified_timestamp(&metadata),
        read_only: metadata.permissions().readonly(),
    })
}

pub fn write(
    scope: &WorkspaceScope,
    relative: &str,
    text: &str,
    expected_current_hash: Option<&str>,
) -> WorkspaceResult<WorkspaceWriteResult> {
    write_impl(scope, relative, text, expected_current_hash, || {})
}

#[cfg(test)]
pub fn write_with_precommit_hook(
    scope: &WorkspaceScope,
    relative: &str,
    text: &str,
    expected_current_hash: Option<&str>,
    hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceWriteResult> {
    write_impl(scope, relative, text, expected_current_hash, hook)
}

fn write_impl(
    scope: &WorkspaceScope,
    relative: &str,
    text: &str,
    expected_current_hash: Option<&str>,
    precommit_hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceWriteResult> {
    require_yaml(relative)?;
    if text.len() as u64 > MAX_YAML_BYTES {
        return Err(WorkspaceError::new(
            "file_too_large",
            "The YAML file exceeds the supported size limit.",
        ));
    }

    let bound = bind_path(scope, relative)?;
    let mut temporary = StagedFile::new(&bound.parent)?;
    temporary
        .file_mut()
        .write_all(text.as_bytes())
        .and_then(|_| temporary.file_mut().flush())
        .and_then(|_| temporary.file_mut().sync_all())
        .map_err(|error| io_error("workspace_write_failed", error))?;
    precommit_hook();
    scope.verify()?;

    let prior_permissions = match expected_current_hash {
        Some(expected) => {
            let mut current = bound
                .parent
                .open(&bound.name)
                .map_err(|_| revision_conflict())?;
            let metadata = current.metadata().map_err(|_| revision_conflict())?;
            if !metadata.is_file() || hash_open_file(&mut current, MAX_YAML_BYTES)? != expected {
                return Err(revision_conflict());
            }
            Some(metadata.permissions())
        }
        None => match bound.parent.symlink_metadata(&bound.name) {
            Ok(_) => return Err(revision_conflict()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(capability_error("workspace_write_failed", error)),
        },
    };
    if let Some(permissions) = prior_permissions.as_ref() {
        temporary
            .file_mut()
            .set_permissions(permissions.clone())
            .map_err(|error| io_error("workspace_write_failed", error))?;
    }

    #[cfg(windows)]
    make_windows_target_replaceable(&bound.parent, &bound.name, prior_permissions.as_ref())?;

    let persist_result = if expected_current_hash.is_none() {
        temporary.persist_noclobber(&bound.name)
    } else {
        temporary.persist_replace(&bound.name)
    };
    #[cfg(windows)]
    if let Err(error) = persist_result {
        restore_windows_permissions_after_failure(
            &bound.parent,
            &bound.name,
            prior_permissions.as_ref(),
        )?;
        return Err(error);
    }
    #[cfg(not(windows))]
    persist_result?;
    #[cfg(windows)]
    restore_windows_permissions_after_success(
        &bound.parent,
        &bound.name,
        prior_permissions.as_ref(),
    )?;
    sync_parent(&bound.parent)?;

    let metadata = bound
        .parent
        .metadata(&bound.name)
        .map_err(|error| capability_error("workspace_write_failed", error))?;
    Ok(WorkspaceWriteResult {
        relative_path: relative.to_string(),
        sha256: hash_bytes(text.as_bytes()),
        size: text.len() as u64,
        modified_at: modified_timestamp(&metadata),
    })
}

fn hash_open_file(file: &mut File, max_bytes: u64) -> WorkspaceResult<String> {
    let mut bytes = Vec::new();
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("workspace_read_failed", error))?;
    if bytes.len() as u64 > max_bytes {
        return Err(WorkspaceError::new(
            "file_too_large",
            "The YAML file exceeds the supported size limit.",
        ));
    }
    Ok(hash_bytes(&bytes))
}

fn revision_conflict() -> WorkspaceError {
    WorkspaceError::new(
        "external_revision_conflict",
        "The file changed on disk before it could be saved.",
    )
}

pub fn rename_pair(
    scope: &WorkspaceScope,
    source_definition: &str,
    destination_definition: &str,
) -> WorkspaceResult<WorkspaceRenameResult> {
    rename_pair_impl(
        scope,
        source_definition,
        destination_definition,
        || {},
        || {},
    )
}

#[cfg(test)]
pub fn rename_pair_with_second_step_hook(
    scope: &WorkspaceScope,
    source_definition: &str,
    destination_definition: &str,
    hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceRenameResult> {
    rename_pair_impl(
        scope,
        source_definition,
        destination_definition,
        || {},
        hook,
    )
}

#[cfg(test)]
pub fn rename_pair_with_bound_hook(
    scope: &WorkspaceScope,
    source_definition: &str,
    destination_definition: &str,
    hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceRenameResult> {
    rename_pair_impl(
        scope,
        source_definition,
        destination_definition,
        hook,
        || {},
    )
}

fn rename_pair_impl(
    scope: &WorkspaceScope,
    source_definition: &str,
    destination_definition: &str,
    bound_hook: impl FnOnce(),
    second_step_hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceRenameResult> {
    require_definition(source_definition)?;
    require_definition(destination_definition)?;
    let source_companion_relative = companion_for(source_definition)?;
    let destination_companion_relative = companion_for(destination_definition)?;
    let source = bind_path(scope, source_definition)?;
    let destination = bind_path(scope, destination_definition)?;
    let source_companion = bind_path(scope, &source_companion_relative)?;
    let destination_companion = bind_path(scope, &destination_companion_relative)?;
    let has_companion = match source_companion
        .parent
        .symlink_metadata(&source_companion.name)
    {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(capability_error("workspace_rename_failed", error)),
    };
    bound_hook();
    scope.verify()?;

    ensure_bound_file(&source)?;
    ensure_bound_missing(&destination, "The rename destination already exists.")?;
    if has_companion {
        ensure_bound_file(&source_companion)?;
        ensure_bound_missing(
            &destination_companion,
            "The companion rename destination already exists.",
        )?;
    }

    let first_move = move_noclobber(&source, &destination);
    if !matches!(first_move, MoveNoClobberOutcome::Moved) {
        let (status, message) = move_failure_details(&first_move);
        let result = path_result(
            source_definition,
            Some(destination_definition),
            status,
            Some("workspace_rename_failed"),
            Some(message.clone()),
        );
        let code = if status == "partial" {
            "workspace_rename_partial"
        } else {
            "workspace_rename_failed"
        };
        return Err(WorkspaceError::new(code, message).with_path_results(vec![result]));
    }
    let mut paths = vec![destination_definition.to_string()];
    let mut results = vec![path_result(
        source_definition,
        Some(destination_definition),
        "moved",
        None,
        None,
    )];
    if has_companion {
        second_step_hook();
        let second_result = ensure_bound_file(&source_companion)
            .and_then(|_| {
                ensure_bound_missing(
                    &destination_companion,
                    "The companion rename destination already exists.",
                )
            })
            .map(|_| move_noclobber(&source_companion, &destination_companion));
        let second_move = match second_result {
            Ok(MoveNoClobberOutcome::Moved) => None,
            Ok(outcome) => Some(outcome),
            Err(error) => Some(MoveNoClobberOutcome::Failed(error.message)),
        };
        if let Some(second_move) = second_move {
            let (second_status, second_message) = move_failure_details(&second_move);
            results.push(path_result(
                &source_companion_relative,
                Some(&destination_companion_relative),
                second_status,
                Some("workspace_rename_failed"),
                Some(second_message.clone()),
            ));
            let rollback = if ensure_bound_file(&destination).is_ok()
                && ensure_bound_missing(
                    &source,
                    "The original definition path was recreated before rollback.",
                )
                .is_ok()
            {
                move_noclobber(&destination, &source)
            } else {
                MoveNoClobberOutcome::Failed(
                    "The original definition path was recreated before rollback.".to_string(),
                )
            };
            if matches!(rollback, MoveNoClobberOutcome::Moved) && second_status != "partial" {
                results[0].status = "rolledBack".to_string();
                return Err(WorkspaceError::new(
                    "workspace_rename_failed",
                    format!("The companion could not be renamed: {second_message}"),
                )
                .with_path_results(results));
            }
            if matches!(rollback, MoveNoClobberOutcome::Moved) {
                results[0].status = "rolledBack".to_string();
            }
            return Err(WorkspaceError::new(
                "workspace_rename_partial",
                format!(
                    "The companion rename failed and the operation could not be fully restored: {second_message}"
                ),
            )
            .with_path_results(results));
        }
        paths.push(destination_companion_relative);
        results.push(path_result(
            &source_companion_relative,
            paths.last().map(String::as_str),
            "moved",
            None,
            None,
        ));
    }
    Ok(WorkspaceRenameResult { paths, results })
}

pub fn trash_paths(
    scope: &WorkspaceScope,
    relative_paths: &[String],
) -> WorkspaceResult<WorkspaceTrashResult> {
    trash_paths_with(scope, relative_paths, |path| {
        trash::delete(path).map_err(|error| error.to_string())
    })
}

pub fn trash_paths_with(
    scope: &WorkspaceScope,
    relative_paths: &[String],
    mut delete: impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<WorkspaceTrashResult> {
    trash_paths_impl(scope, relative_paths, || {}, &mut delete)
}

#[cfg(test)]
pub fn trash_paths_with_bound_hook(
    scope: &WorkspaceScope,
    relative_paths: &[String],
    hook: impl FnOnce(),
    mut delete: impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<WorkspaceTrashResult> {
    trash_paths_impl(scope, relative_paths, hook, &mut delete)
}

fn trash_paths_impl(
    scope: &WorkspaceScope,
    relative_paths: &[String],
    bound_hook: impl FnOnce(),
    delete: &mut impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<WorkspaceTrashResult> {
    if relative_paths.is_empty() || relative_paths.len() > 2 {
        return Err(WorkspaceError::new(
            "invalid_trash_request",
            "Move to Trash accepts one or two exact workspace file paths.",
        ));
    }
    let unique: HashSet<&String> = relative_paths.iter().collect();
    if unique.len() != relative_paths.len() {
        return Err(WorkspaceError::new(
            "invalid_trash_request",
            "Move to Trash paths must be unique.",
        ));
    }

    let mut bound = Vec::with_capacity(relative_paths.len());
    for relative in relative_paths {
        require_yaml(relative)?;
        bound.push(bind_path(scope, relative));
    }
    bound_hook();

    let mut results = Vec::with_capacity(relative_paths.len());
    for (relative, bound) in relative_paths.iter().zip(bound) {
        let result =
            match bound.and_then(|source| trash_bound_path(scope, &source, relative, delete)) {
                Ok(()) => path_result(relative, None, "trashed", None, None),
                Err(error) => path_result(
                    relative,
                    None,
                    if error.code == "workspace_trash_partial" {
                        "partial"
                    } else {
                        "failed"
                    },
                    Some(error.code),
                    Some(error.message),
                ),
            };
        results.push(result);
    }
    Ok(WorkspaceTrashResult { results })
}

fn trash_bound_path(
    scope: &WorkspaceScope,
    source: &BoundPath,
    relative: &str,
    delete: &mut impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<()> {
    ensure_bound_file(source)?;
    let root = scope.directory()?;
    let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
    let file_name = Path::new(relative)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("workflow.yaml");
    let quarantine_name = OsString::from(format!(
        ".workflow-studio-trash-{}-{sequence}-{file_name}",
        std::process::id()
    ));
    let quarantine = BoundPath {
        parent: root
            .try_clone()
            .map_err(|error| capability_error("workspace_trash_failed", error))?,
        name: quarantine_name.clone(),
    };
    match move_noclobber(source, &quarantine) {
        MoveNoClobberOutcome::Moved => {}
        outcome => {
            let (status, message) = move_failure_details(&outcome);
            return Err(WorkspaceError::new(
                if status == "partial" {
                    "workspace_trash_partial"
                } else {
                    "workspace_trash_failed"
                },
                message,
            ));
        }
    }

    let ambient_path = match scope.root_path() {
        Ok(root_path) => root_path.join(&quarantine_name),
        Err(error) => {
            return match move_noclobber(&quarantine, source) {
                MoveNoClobberOutcome::Moved => Err(error),
                outcome => {
                    let (_, rollback_message) = move_failure_details(&outcome);
                    Err(WorkspaceError::new(
                        "workspace_trash_partial",
                        format!("{}; rollback failed: {rollback_message}", error.message),
                    ))
                }
            }
        }
    };
    if let Err(message) = delete(&ambient_path) {
        let rollback = move_noclobber(&quarantine, source);
        return match rollback {
            MoveNoClobberOutcome::Moved => {
                Err(WorkspaceError::new("workspace_trash_failed", message))
            }
            outcome => {
                let (_, rollback_message) = move_failure_details(&outcome);
                Err(WorkspaceError::new(
                    "workspace_trash_partial",
                    format!("{message}; rollback failed: {rollback_message}"),
                ))
            }
        };
    }
    Ok(())
}

fn ensure_bound_file(path: &BoundPath) -> WorkspaceResult<()> {
    let metadata = path
        .parent
        .metadata(&path.name)
        .map_err(|error| capability_error("path_not_found", error))?;
    if !metadata.is_file() {
        return Err(WorkspaceError::new(
            "not_a_file",
            "Only exact workspace files can be changed.",
        ));
    }
    Ok(())
}

fn ensure_bound_missing(path: &BoundPath, message: &str) -> WorkspaceResult<()> {
    match path.parent.symlink_metadata(&path.name) {
        Ok(_) => Err(WorkspaceError::new("destination_exists", message)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(capability_error("workspace_rename_failed", error)),
    }
}

#[derive(Debug)]
enum MoveNoClobberOutcome {
    Moved,
    RolledBack {
        unlink_error: String,
    },
    Partial {
        unlink_error: String,
        cleanup_error: String,
    },
    Failed(String),
}

fn classify_move_noclobber(
    link: Result<(), String>,
    unlink: impl FnOnce() -> Result<(), String>,
    cleanup: impl FnOnce() -> Result<(), String>,
) -> MoveNoClobberOutcome {
    if let Err(error) = link {
        return MoveNoClobberOutcome::Failed(error);
    }
    match unlink() {
        Ok(()) => MoveNoClobberOutcome::Moved,
        Err(unlink_error) => match cleanup() {
            Ok(()) => MoveNoClobberOutcome::RolledBack { unlink_error },
            Err(cleanup_error) => MoveNoClobberOutcome::Partial {
                unlink_error,
                cleanup_error,
            },
        },
    }
}

fn move_noclobber(source: &BoundPath, destination: &BoundPath) -> MoveNoClobberOutcome {
    classify_move_noclobber(
        source
            .parent
            .hard_link(&source.name, &destination.parent, &destination.name)
            .map_err(|error| error.to_string()),
        || {
            source
                .parent
                .remove_file(&source.name)
                .map_err(|error| error.to_string())
        },
        || {
            destination
                .parent
                .remove_file(&destination.name)
                .map_err(|error| error.to_string())
        },
    )
}

fn move_failure_details(outcome: &MoveNoClobberOutcome) -> (&'static str, String) {
    match outcome {
        MoveNoClobberOutcome::Moved => ("moved", String::new()),
        MoveNoClobberOutcome::Failed(error) => ("failed", error.clone()),
        MoveNoClobberOutcome::RolledBack { unlink_error } => (
            "rolledBack",
            format!("The source could not be removed and the destination was rolled back: {unlink_error}"),
        ),
        MoveNoClobberOutcome::Partial {
            unlink_error,
            cleanup_error,
        } => (
            "partial",
            format!(
                "The source could not be removed ({unlink_error}) and destination cleanup also failed ({cleanup_error})."
            ),
        ),
    }
}

fn path_result(
    relative: &str,
    destination: Option<&str>,
    status: &str,
    error_code: Option<&str>,
    message: Option<String>,
) -> PathOperationResult {
    PathOperationResult {
        relative_path: relative.to_string(),
        destination_path: destination.map(str::to_string),
        status: status.to_string(),
        error_code: error_code.map(str::to_string),
        message,
    }
}

#[cfg(test)]
pub struct TestMoveOutcome {
    pub status: &'static str,
    pub unlink_error: Option<String>,
    pub cleanup_error: Option<String>,
}

#[cfg(test)]
pub fn move_noclobber_outcome_for_test(
    link: Result<(), String>,
    unlink: Result<(), String>,
    cleanup: Result<(), String>,
) -> TestMoveOutcome {
    match classify_move_noclobber(link, || unlink, || cleanup) {
        MoveNoClobberOutcome::Moved => TestMoveOutcome {
            status: "moved",
            unlink_error: None,
            cleanup_error: None,
        },
        MoveNoClobberOutcome::Failed(_) => TestMoveOutcome {
            status: "failed",
            unlink_error: None,
            cleanup_error: None,
        },
        MoveNoClobberOutcome::RolledBack { unlink_error } => TestMoveOutcome {
            status: "rolledBack",
            unlink_error: Some(unlink_error),
            cleanup_error: None,
        },
        MoveNoClobberOutcome::Partial {
            unlink_error,
            cleanup_error,
        } => TestMoveOutcome {
            status: "partial",
            unlink_error: Some(unlink_error),
            cleanup_error: Some(cleanup_error),
        },
    }
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn companion_for(definition: &str) -> WorkspaceResult<String> {
    let extension = if definition.ends_with(".yaml") {
        ".yaml"
    } else if definition.ends_with(".yml") {
        ".yml"
    } else {
        return Err(WorkspaceError::new(
            "unsupported_file_type",
            "Workflow definitions must use .yaml or .yml.",
        ));
    };
    Ok(format!(
        "{}.hermes.yaml",
        definition.strip_suffix(extension).expect("suffix checked")
    ))
}

fn require_definition(relative: &str) -> WorkspaceResult<()> {
    require_yaml(relative)?;
    if relative.ends_with(".hermes.yaml") {
        return Err(WorkspaceError::new(
            "invalid_definition_path",
            "Pair rename requires a workflow definition path.",
        ));
    }
    Ok(())
}

fn require_yaml(relative: &str) -> WorkspaceResult<()> {
    paths::validate_relative(relative)?;
    if !(relative.ends_with(".yaml") || relative.ends_with(".yml")) {
        return Err(WorkspaceError::new(
            "unsupported_file_type",
            "Only .yaml and .yml workflow files can be accessed.",
        ));
    }
    Ok(())
}

fn modified_timestamp(metadata: &Metadata) -> String {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.into_std().duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().to_string())
        .unwrap_or_else(|| "0".to_string())
}

fn sync_parent(parent: &Dir) -> WorkspaceResult<()> {
    #[cfg(unix)]
    parent
        .try_clone()
        .map(Dir::into_std_file)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| io_error("workspace_write_failed", error))?;
    Ok(())
}

#[cfg(windows)]
pub(super) fn make_windows_target_replaceable(
    parent: &Dir,
    target: &OsStr,
    prior_permissions: Option<&Permissions>,
) -> WorkspaceResult<()> {
    if let Some(permissions) = prior_permissions.filter(|value| value.readonly()) {
        let mut writable = permissions.clone();
        writable.set_readonly(false);
        parent
            .set_permissions(target, writable)
            .map_err(|error| io_error("workspace_write_failed", error))?;
    }
    Ok(())
}

#[cfg(windows)]
pub(super) fn restore_windows_permissions_after_failure(
    parent: &Dir,
    target: &OsStr,
    prior_permissions: Option<&Permissions>,
) -> WorkspaceResult<()> {
    if parent.symlink_metadata(target).is_ok() {
        if let Some(permissions) = prior_permissions {
            parent
                .set_permissions(target, permissions.clone())
                .map_err(|error| io_error("workspace_permission_restore_failed", error))?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn restore_windows_permissions_after_success(
    parent: &Dir,
    target: &OsStr,
    prior_permissions: Option<&Permissions>,
) -> WorkspaceResult<()> {
    if let Some(permissions) = prior_permissions {
        parent
            .set_permissions(target, permissions.clone())
            .map_err(|error| io_error("workspace_permission_restore_failed", error))?;
    }
    Ok(())
}

fn capability_error(code: &'static str, error: std::io::Error) -> WorkspaceError {
    let code = if error.kind() == std::io::ErrorKind::PermissionDenied {
        "path_outside_workspace"
    } else {
        code
    };
    WorkspaceError::new(code, format!("The workspace operation failed: {error}"))
}

fn io_error(code: &'static str, error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(code, format!("The workspace operation failed: {error}"))
}
