use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use super::paths;
use super::{PathOperationResult, WorkspaceError, WorkspaceResult, WorkspaceScope};

pub const MAX_YAML_BYTES: u64 = 2 * 1024 * 1024;

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
    let root = scope.verify()?.to_path_buf();
    let mut entries = Vec::new();
    scan_directory(&root, &root, &mut entries)?;
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(entries)
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    entries: &mut Vec<WorkspaceFileEntry>,
) -> WorkspaceResult<()> {
    let children =
        fs::read_dir(directory).map_err(|error| io_error("workspace_scan_failed", error))?;
    for child in children {
        let child = child.map_err(|error| io_error("workspace_scan_failed", error))?;
        let path = child.path();
        let Some(relative_path) = paths::normalize_relative(root, &path) else {
            continue;
        };
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| io_error("workspace_scan_failed", error))?;
        let is_symlink = metadata.file_type().is_symlink();

        if excluded_directory(&child.file_name()) {
            continue;
        }

        if is_symlink {
            let resolved = path.canonicalize();
            let safe = resolved
                .as_ref()
                .is_ok_and(|target| target.starts_with(root));
            let target_metadata = if safe {
                resolved
                    .as_ref()
                    .ok()
                    .and_then(|target| fs::metadata(target).ok())
            } else {
                None
            };
            let kind = if target_metadata.as_ref().is_some_and(|value| value.is_dir()) {
                "directory"
            } else {
                "file"
            };
            let details = target_metadata.as_ref().unwrap_or(&metadata);
            entries.push(entry_from_metadata(
                relative_path,
                kind,
                details,
                if safe { "safe" } else { "unsafe" },
            ));
            continue;
        }

        if metadata.is_dir() {
            entries.push(entry_from_metadata(
                relative_path,
                "directory",
                &metadata,
                "none",
            ));
            let resolved = path
                .canonicalize()
                .map_err(|error| io_error("workspace_scan_failed", error))?;
            paths::ensure_contained(root, &resolved)?;
            if !fs::symlink_metadata(&path)
                .map_err(|error| io_error("workspace_scan_failed", error))?
                .file_type()
                .is_symlink()
            {
                scan_directory(root, &resolved, entries)?;
            }
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
    metadata: &fs::Metadata,
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

pub fn read(
    scope: &WorkspaceScope,
    relative: &str,
    max_bytes: u64,
) -> WorkspaceResult<WorkspaceReadResult> {
    require_yaml(relative)?;
    let root = scope.verify()?;
    let resolved = paths::resolve_existing(root, relative)?;
    let metadata =
        fs::metadata(&resolved).map_err(|error| io_error("workspace_read_failed", error))?;
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
    File::open(&resolved)
        .map_err(|error| io_error("workspace_read_failed", error))?
        .take(ceiling + 1)
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

    let root = scope.verify()?;
    let destination = paths::resolve_destination(root, relative)?;
    let initial_target = if destination.symlink_metadata().is_ok() {
        paths::resolve_existing(root, relative)?
    } else {
        let parent = destination.parent().ok_or_else(|| {
            WorkspaceError::new(
                "invalid_relative_path",
                "The destination has no parent folder.",
            )
        })?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|error| io_error("parent_not_found", error))?;
        paths::ensure_contained(root, &canonical_parent)?;
        canonical_parent.join(destination.file_name().ok_or_else(|| {
            WorkspaceError::new("invalid_relative_path", "The destination has no file name.")
        })?)
    };
    let parent = initial_target.parent().ok_or_else(|| {
        WorkspaceError::new(
            "invalid_relative_path",
            "The destination has no parent folder.",
        )
    })?;
    let staged_parent_identity = same_file::Handle::from_path(parent)
        .map_err(|error| io_error("workspace_write_failed", error))?;
    let mut temporary =
        NamedTempFile::new_in(parent).map_err(|error| io_error("workspace_write_failed", error))?;
    temporary
        .write_all(text.as_bytes())
        .and_then(|_| temporary.flush())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| io_error("workspace_write_failed", error))?;
    precommit_hook();

    // If an ancestor was swapped, dropping by the old lexical temp path could
    // unlink an attacker's replacement. Disarm cleanup rather than touching it.
    let staged_parent_unchanged = same_file::Handle::from_path(parent)
        .map(|current| current == staged_parent_identity)
        .unwrap_or(false);
    if !staged_parent_unchanged {
        temporary.disable_cleanup(true);
    }

    // The disk identity check is intentionally after staging and immediately before commit.
    let root = scope.verify()?;
    let destination = paths::resolve_destination(root, relative)?;
    let target = match expected_current_hash {
        Some(expected) => {
            if destination.symlink_metadata().is_err() {
                return Err(revision_conflict());
            }
            let current = read(scope, relative, MAX_YAML_BYTES)?;
            if current.sha256 != expected {
                return Err(revision_conflict());
            }
            paths::resolve_existing(root, relative)?
        }
        None => {
            if destination.symlink_metadata().is_ok() {
                return Err(revision_conflict());
            }
            let parent = destination.parent().ok_or_else(|| {
                WorkspaceError::new(
                    "invalid_relative_path",
                    "The destination has no parent folder.",
                )
            })?;
            let canonical_parent = parent
                .canonicalize()
                .map_err(|error| io_error("parent_not_found", error))?;
            paths::ensure_contained(root, &canonical_parent)?;
            canonical_parent.join(destination.file_name().ok_or_else(|| {
                WorkspaceError::new("invalid_relative_path", "The destination has no file name.")
            })?)
        }
    };
    let parent = target.parent().expect("validated file target has a parent");
    let prior_permissions = fs::metadata(&target).ok().map(|value| value.permissions());
    if let Some(permissions) = prior_permissions.clone() {
        temporary
            .as_file()
            .set_permissions(permissions)
            .map_err(|error| io_error("workspace_write_failed", error))?;
    }

    #[cfg(windows)]
    make_windows_target_replaceable(&target, prior_permissions.as_ref())?;

    let persist_result = if expected_current_hash.is_none() {
        temporary.persist_noclobber(&target)
    } else {
        temporary.persist(&target)
    };
    if let Err(error) = persist_result {
        #[cfg(windows)]
        restore_windows_permissions_after_failure(&target, prior_permissions.as_ref())?;
        if expected_current_hash.is_none()
            && error.error.kind() == std::io::ErrorKind::AlreadyExists
        {
            return Err(revision_conflict());
        }
        return Err(io_error("workspace_write_failed", error.error));
    }
    #[cfg(windows)]
    restore_windows_permissions_after_success(&target, prior_permissions.as_ref())?;
    sync_parent(parent)?;

    let metadata =
        fs::metadata(&target).map_err(|error| io_error("workspace_write_failed", error))?;
    Ok(WorkspaceWriteResult {
        relative_path: relative.to_string(),
        sha256: hash_bytes(text.as_bytes()),
        size: text.len() as u64,
        modified_at: modified_timestamp(&metadata),
    })
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
    rename_pair_impl(scope, source_definition, destination_definition, || {})
}

#[cfg(test)]
pub fn rename_pair_with_second_step_hook(
    scope: &WorkspaceScope,
    source_definition: &str,
    destination_definition: &str,
    hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceRenameResult> {
    rename_pair_impl(scope, source_definition, destination_definition, hook)
}

fn rename_pair_impl(
    scope: &WorkspaceScope,
    source_definition: &str,
    destination_definition: &str,
    second_step_hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceRenameResult> {
    require_definition(source_definition)?;
    require_definition(destination_definition)?;
    let root = scope.verify()?;
    let destination = paths::resolve_destination(root, destination_definition)?;
    if destination.symlink_metadata().is_ok() {
        return Err(WorkspaceError::new(
            "destination_exists",
            "The rename destination already exists.",
        ));
    }

    let source_companion_relative = companion_for(source_definition)?;
    let destination_companion_relative = companion_for(destination_definition)?;
    let source_companion = paths::resolve_destination(root, &source_companion_relative)?;
    let has_companion = source_companion.symlink_metadata().is_ok();
    if has_companion {
        // Recheck source containment and reject a colliding destination before any move.
        resolve_exact_file(root, &source_companion_relative)?;
        let destination_companion =
            paths::resolve_destination(root, &destination_companion_relative)?;
        if destination_companion.symlink_metadata().is_ok() {
            return Err(WorkspaceError::new(
                "destination_exists",
                "The companion rename destination already exists.",
            ));
        }
    }

    let root = scope.verify()?;
    let source = resolve_exact_file(root, source_definition)?;
    let destination = canonical_destination(root, destination_definition)?;
    if destination.symlink_metadata().is_ok() {
        return Err(WorkspaceError::new(
            "destination_exists",
            "The rename destination already exists.",
        ));
    }
    move_noclobber(&source, &destination)
        .map_err(|error| io_error("workspace_rename_failed", error))?;
    let mut paths = vec![destination_definition.to_string()];
    let mut results = vec![PathOperationResult {
        relative_path: source_definition.to_string(),
        destination_path: Some(destination_definition.to_string()),
        status: "moved".to_string(),
        error_code: None,
        message: None,
    }];
    if has_companion {
        second_step_hook();
        let second_result = (|| -> WorkspaceResult<()> {
            let root = scope.verify()?;
            let source_companion = resolve_exact_file(root, &source_companion_relative)?;
            let destination_companion =
                canonical_destination(root, &destination_companion_relative)?;
            if destination_companion.symlink_metadata().is_ok() {
                return Err(WorkspaceError::new(
                    "destination_exists",
                    "The companion rename destination already exists.",
                ));
            }
            move_noclobber(&source_companion, &destination_companion)
                .map_err(|error| io_error("workspace_rename_failed", error))
        })();
        if let Err(error) = second_result {
            results.push(PathOperationResult {
                relative_path: source_companion_relative.clone(),
                destination_path: Some(destination_companion_relative.clone()),
                status: "failed".to_string(),
                error_code: Some(error.code.to_string()),
                message: Some(error.message.clone()),
            });
            let rollback = (|| -> WorkspaceResult<()> {
                let root = scope.verify()?;
                let moved_definition = resolve_exact_file(root, destination_definition)?;
                let original_definition = canonical_destination(root, source_definition)?;
                if original_definition.symlink_metadata().is_ok() {
                    return Err(WorkspaceError::new(
                        "destination_exists",
                        "The original definition path was recreated before rollback.",
                    ));
                }
                move_noclobber(&moved_definition, &original_definition)
                    .map_err(|error| io_error("workspace_rename_failed", error))
            })();
            if rollback.is_ok() {
                results[0].status = "rolledBack".to_string();
                return Err(WorkspaceError::new(
                    "workspace_rename_failed",
                    format!("The companion could not be renamed: {}", error.message),
                )
                .with_path_results(results));
            }
            return Err(WorkspaceError::new(
                "workspace_rename_partial",
                format!(
                    "The companion rename failed and the definition rollback was blocked: {}",
                    error.message
                ),
            )
            .with_path_results(results));
        }
        paths.push(destination_companion_relative);
        results.push(PathOperationResult {
            relative_path: source_companion_relative,
            destination_path: paths.last().cloned(),
            status: "moved".to_string(),
            error_code: None,
            message: None,
        });
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

    let mut resolved = Vec::with_capacity(relative_paths.len());
    for relative in relative_paths {
        require_yaml(relative)?;
        let root = scope.verify()?;
        let path = resolve_exact_file(root, relative)?;
        resolved.push(path);
    }

    let mut results = Vec::with_capacity(relative_paths.len());
    for (relative, _) in relative_paths.iter().zip(resolved) {
        let operation = scope
            .verify()
            .and_then(|root| resolve_exact_file(root, relative))
            .map_err(|error| error.message)
            .and_then(|path| delete(&path));
        results.push(match operation {
            Ok(()) => PathOperationResult {
                relative_path: relative.clone(),
                destination_path: None,
                status: "trashed".to_string(),
                error_code: None,
                message: None,
            },
            Err(message) => PathOperationResult {
                relative_path: relative.clone(),
                destination_path: None,
                status: "failed".to_string(),
                error_code: Some("workspace_trash_failed".to_string()),
                message: Some(message),
            },
        });
    }
    Ok(WorkspaceTrashResult { results })
}

fn canonical_destination(root: &Path, relative: &str) -> WorkspaceResult<std::path::PathBuf> {
    let destination = paths::resolve_destination(root, relative)?;
    let parent = destination.parent().ok_or_else(|| {
        WorkspaceError::new(
            "invalid_relative_path",
            "The destination has no parent folder.",
        )
    })?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| io_error("parent_not_found", error))?;
    paths::ensure_contained(root, &canonical_parent)?;
    Ok(
        canonical_parent.join(destination.file_name().ok_or_else(|| {
            WorkspaceError::new("invalid_relative_path", "The destination has no file name.")
        })?),
    )
}

fn move_noclobber(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::hard_link(source, destination)?;
    if let Err(error) = fs::remove_file(source) {
        let same_link = match (
            same_file::Handle::from_path(source),
            same_file::Handle::from_path(destination),
        ) {
            (Ok(source_handle), Ok(destination_handle)) => source_handle == destination_handle,
            _ => false,
        };
        if same_link {
            let _ = fs::remove_file(destination);
        }
        return Err(error);
    }
    Ok(())
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

fn resolve_exact_file(root: &Path, relative: &str) -> WorkspaceResult<std::path::PathBuf> {
    let path = paths::resolve_existing_lexical(root, relative)?;
    if !fs::metadata(&path)
        .map_err(|error| io_error("path_not_found", error))?
        .is_file()
    {
        return Err(WorkspaceError::new(
            "not_a_file",
            "Only exact workspace files can be changed.",
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        WorkspaceError::new(
            "invalid_relative_path",
            "The workspace file has no parent folder.",
        )
    })?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| io_error("path_not_found", error))?;
    paths::ensure_contained(root, &canonical_parent)?;
    Ok(canonical_parent.join(path.file_name().ok_or_else(|| {
        WorkspaceError::new(
            "invalid_relative_path",
            "The workspace file has no file name.",
        )
    })?))
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

fn modified_timestamp(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().to_string())
        .unwrap_or_else(|| "0".to_string())
}

fn sync_parent(parent: &Path) -> WorkspaceResult<()> {
    #[cfg(unix)]
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| io_error("workspace_write_failed", error))?;
    Ok(())
}

#[cfg(windows)]
pub(super) fn make_windows_target_replaceable(
    target: &Path,
    prior_permissions: Option<&fs::Permissions>,
) -> WorkspaceResult<()> {
    if let Some(permissions) = prior_permissions.filter(|value| value.readonly()) {
        let mut writable = permissions.clone();
        writable.set_readonly(false);
        fs::set_permissions(target, writable)
            .map_err(|error| io_error("workspace_write_failed", error))?;
    }
    Ok(())
}

#[cfg(windows)]
pub(super) fn restore_windows_permissions_after_failure(
    target: &Path,
    prior_permissions: Option<&fs::Permissions>,
) -> WorkspaceResult<()> {
    if target.exists() {
        if let Some(permissions) = prior_permissions {
            fs::set_permissions(target, permissions.clone())
                .map_err(|error| io_error("workspace_permission_restore_failed", error))?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn restore_windows_permissions_after_success(
    target: &Path,
    prior_permissions: Option<&fs::Permissions>,
) -> WorkspaceResult<()> {
    if let Some(permissions) = prior_permissions {
        fs::set_permissions(target, permissions.clone())
            .map_err(|error| io_error("workspace_permission_restore_failed", error))?;
    }
    Ok(())
}

fn io_error(code: &'static str, error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(code, format!("The workspace operation failed: {error}"))
}
