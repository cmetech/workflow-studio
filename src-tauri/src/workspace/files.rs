use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use super::paths;
use super::{WorkspaceError, WorkspaceResult};

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
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTrashResult {
    pub paths: Vec<String>,
}

pub fn scan(root: &Path) -> WorkspaceResult<Vec<WorkspaceFileEntry>> {
    let root = paths::canonical_root(root)?;
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

pub fn read(root: &Path, relative: &str, max_bytes: u64) -> WorkspaceResult<WorkspaceReadResult> {
    require_yaml(relative)?;
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
    root: &Path,
    relative: &str,
    text: &str,
    expected_current_hash: Option<&str>,
) -> WorkspaceResult<WorkspaceWriteResult> {
    require_yaml(relative)?;
    if text.len() as u64 > MAX_YAML_BYTES {
        return Err(WorkspaceError::new(
            "file_too_large",
            "The YAML file exceeds the supported size limit.",
        ));
    }

    let destination = paths::resolve_destination(root, relative)?;
    let exists = destination.symlink_metadata().is_ok();
    let current = if exists {
        Some(read(root, relative, MAX_YAML_BYTES)?.sha256)
    } else {
        None
    };
    if current.as_deref() != expected_current_hash {
        return Err(WorkspaceError::new(
            "external_revision_conflict",
            "The file changed on disk before it could be saved.",
        ));
    }

    // For an in-root file symlink, replace its contained target rather than the link.
    let target = if exists {
        paths::resolve_existing(root, relative)?
    } else {
        destination
    };
    let parent = target.parent().ok_or_else(|| {
        WorkspaceError::new(
            "invalid_relative_path",
            "The destination has no parent folder.",
        )
    })?;
    let prior_permissions = fs::metadata(&target)
        .ok()
        .map(|metadata| metadata.permissions());
    let mut temporary =
        NamedTempFile::new_in(parent).map_err(|error| io_error("workspace_write_failed", error))?;
    temporary
        .write_all(text.as_bytes())
        .and_then(|_| temporary.flush())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| io_error("workspace_write_failed", error))?;
    if let Some(permissions) = prior_permissions {
        temporary
            .as_file()
            .set_permissions(permissions)
            .map_err(|error| io_error("workspace_write_failed", error))?;
    }
    temporary
        .persist(&target)
        .map_err(|error| io_error("workspace_write_failed", error.error))?;
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

pub fn rename_pair(
    root: &Path,
    source_definition: &str,
    destination_definition: &str,
) -> WorkspaceResult<WorkspaceRenameResult> {
    require_definition(source_definition)?;
    require_definition(destination_definition)?;
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

    let source = resolve_exact_file(root, source_definition)?;
    let destination = paths::resolve_destination(root, destination_definition)?;
    if destination.symlink_metadata().is_ok() {
        return Err(WorkspaceError::new(
            "destination_exists",
            "The rename destination already exists.",
        ));
    }
    fs::rename(&source, &destination)
        .map_err(|error| io_error("workspace_rename_failed", error))?;
    let mut paths = vec![destination_definition.to_string()];
    if has_companion {
        let source_companion = resolve_exact_file(root, &source_companion_relative)?;
        let destination_companion =
            paths::resolve_destination(root, &destination_companion_relative)?;
        if destination_companion.symlink_metadata().is_ok() {
            let _ = fs::rename(&destination, &source);
            return Err(WorkspaceError::new(
                "destination_exists",
                "The companion rename destination already exists.",
            ));
        }
        if let Err(error) = fs::rename(&source_companion, &destination_companion) {
            let _ = fs::rename(&destination, &source);
            return Err(io_error("workspace_rename_failed", error));
        }
        paths.push(destination_companion_relative);
    }
    Ok(WorkspaceRenameResult { paths })
}

pub fn trash_paths(
    root: &Path,
    relative_paths: &[String],
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
        let path = resolve_exact_file(root, relative)?;
        resolved.push(path);
    }

    for (relative, _) in relative_paths.iter().zip(resolved) {
        let path = resolve_exact_file(root, relative)?;
        trash::delete(path).map_err(|error| {
            WorkspaceError::new(
                "workspace_trash_failed",
                format!("The operating system could not move the file to Trash: {error}"),
            )
        })?;
    }
    Ok(WorkspaceTrashResult {
        paths: relative_paths.to_vec(),
    })
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
    Ok(path)
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

fn io_error(code: &'static str, error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(code, format!("The workspace operation failed: {error}"))
}
