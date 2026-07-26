use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use cap_std::fs::{Dir, File, Metadata, OpenOptions, Permissions};
use same_file::Handle;
use serde::{Deserialize, Serialize};
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrashPathRequest {
    pub relative_path: String,
    pub expected_current_hash: String,
}

struct TrashPathExpectation {
    relative_path: String,
    expected_current_hash: Option<String>,
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

    fn bound_path(&self) -> WorkspaceResult<BoundPath> {
        Ok(BoundPath {
            parent: self
                .parent
                .try_clone()
                .map_err(|error| io_error("workspace_write_failed", error))?,
            name: self.name.clone(),
        })
    }

    fn disarm(&mut self) {
        self.file.take();
        self.active = false;
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
    write_impl(
        scope,
        relative,
        text,
        expected_current_hash,
        WriteHooks::none(),
    )
}

#[cfg(test)]
pub fn write_with_precommit_hook(
    scope: &WorkspaceScope,
    relative: &str,
    text: &str,
    expected_current_hash: Option<&str>,
    hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceWriteResult> {
    write_impl(
        scope,
        relative,
        text,
        expected_current_hash,
        WriteHooks {
            pre_hash: hook,
            post_hash: || {},
            post_quarantine: || {},
            permission: noop_permission_hook,
        },
    )
}

#[cfg(test)]
pub fn write_with_post_hash_hook(
    scope: &WorkspaceScope,
    relative: &str,
    text: &str,
    expected_current_hash: Option<&str>,
    hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceWriteResult> {
    write_impl(
        scope,
        relative,
        text,
        expected_current_hash,
        WriteHooks {
            pre_hash: || {},
            post_hash: hook,
            post_quarantine: || {},
            permission: noop_permission_hook,
        },
    )
}

#[cfg(test)]
pub fn write_with_post_quarantine_hook(
    scope: &WorkspaceScope,
    relative: &str,
    text: &str,
    expected_current_hash: Option<&str>,
    hook: impl FnOnce(),
) -> WorkspaceResult<WorkspaceWriteResult> {
    write_impl(
        scope,
        relative,
        text,
        expected_current_hash,
        WriteHooks {
            pre_hash: || {},
            post_hash: || {},
            post_quarantine: hook,
            permission: noop_permission_hook,
        },
    )
}

#[cfg(test)]
pub fn write_with_permission_order_hook(
    scope: &WorkspaceScope,
    relative: &str,
    text: &str,
    expected_current_hash: Option<&str>,
    permission_hook: impl FnMut(&str, bool),
) -> WorkspaceResult<WorkspaceWriteResult> {
    write_impl(
        scope,
        relative,
        text,
        expected_current_hash,
        WriteHooks {
            pre_hash: || {},
            post_hash: || {},
            post_quarantine: || {},
            permission: permission_hook,
        },
    )
}

struct WriteHooks<PreHash, PostHash, PostQuarantine, Permission> {
    pre_hash: PreHash,
    post_hash: PostHash,
    post_quarantine: PostQuarantine,
    permission: Permission,
}

impl WriteHooks<fn(), fn(), fn(), fn(&str, bool)> {
    fn none() -> Self {
        Self {
            pre_hash: || {},
            post_hash: || {},
            post_quarantine: || {},
            permission: noop_permission_hook,
        }
    }
}

fn noop_permission_hook(_: &str, _: bool) {}

fn write_impl<PreHash, PostHash, PostQuarantine, Permission>(
    scope: &WorkspaceScope,
    relative: &str,
    text: &str,
    expected_current_hash: Option<&str>,
    hooks: WriteHooks<PreHash, PostHash, PostQuarantine, Permission>,
) -> WorkspaceResult<WorkspaceWriteResult>
where
    PreHash: FnOnce(),
    PostHash: FnOnce(),
    PostQuarantine: FnOnce(),
    Permission: FnMut(&str, bool),
{
    let WriteHooks {
        pre_hash: pre_hash_hook,
        post_hash: post_hash_hook,
        post_quarantine: post_quarantine_hook,
        permission: mut permission_hook,
    } = hooks;
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
    pre_hash_hook();
    scope.verify()?;
    let staged = temporary.bound_path()?;
    let staged_identity = named_identity(&staged, "workspace_write_failed")
        .map_err(|issue| WorkspaceError::new(issue.code, issue.message))?;

    if let Some(expected) = expected_current_hash {
        let mut current = bound
            .parent
            .open(&bound.name)
            .map_err(|_| revision_conflict())?;
        let metadata = current.metadata().map_err(|_| revision_conflict())?;
        let original_identity =
            file_identity(&current).map_err(|error| io_error("workspace_write_failed", error))?;
        if !metadata.is_file() || hash_open_file(&mut current, MAX_YAML_BYTES)? != expected {
            return Err(revision_conflict());
        }
        post_hash_hook();
        scope.verify()?;
        if !named_hash_matches(&bound, &original_identity, expected) {
            return Err(revision_conflict());
        }
        let prior_permissions = metadata.permissions();
        #[cfg(windows)]
        make_windows_file_replaceable(&current, &prior_permissions)?;

        let quarantine = unique_sibling(&bound, "original")?;
        match move_noclobber_with_expected(&bound, &quarantine, &original_identity, || {}, || {}) {
            MoveNoClobberOutcome::Moved => {}
            outcome => {
                #[cfg(windows)]
                restore_windows_file_permissions(&current, &prior_permissions)?;
                return Err(write_move_error(
                    "The verified original could not be quarantined",
                    &outcome,
                ));
            }
        }
        if !named_hash_matches(&quarantine, &original_identity, expected) {
            let rollback =
                move_noclobber_with_expected(&quarantine, &bound, &original_identity, || {}, || {});
            #[cfg(windows)]
            restore_windows_file_permissions(&current, &prior_permissions)?;
            return Err(write_commit_recovery_error(
                &MoveNoClobberOutcome::Failed(MoveIssue::new(
                    "source_identity_changed",
                    "The verified original changed while it was being quarantined.",
                )),
                &rollback,
            ));
        }
        post_quarantine_hook();
        permission_hook("beforeCommit", bound_read_only(&staged)?);
        let commit = move_noclobber_with_expected(&staged, &bound, &staged_identity, || {}, || {});
        if !matches!(commit, MoveNoClobberOutcome::Moved) {
            let rollback =
                move_noclobber_with_expected(&quarantine, &bound, &original_identity, || {}, || {});
            #[cfg(windows)]
            restore_windows_file_permissions(&current, &prior_permissions)?;
            return Err(write_commit_recovery_error(&commit, &rollback));
        }
        temporary.disarm();
        permission_hook("afterCommit", bound_read_only(&bound)?);
        if let Err(error) =
            restore_committed_permissions(&bound, &staged_identity, prior_permissions.clone())
        {
            let commit_cleanup = remove_verified_name(&bound, &staged_identity);
            let rollback = if commit_cleanup.is_ok() {
                move_noclobber_with_expected(&quarantine, &bound, &original_identity, || {}, || {})
            } else {
                MoveNoClobberOutcome::Partial {
                    unlink_error: MoveIssue::new(
                        "permission_restore_failed",
                        error.message.clone(),
                    ),
                    cleanup_error: commit_cleanup.expect_err("failed cleanup has an error"),
                }
            };
            #[cfg(windows)]
            restore_windows_file_permissions(&current, &prior_permissions)?;
            return Err(write_permission_recovery_error(error, &rollback));
        }
        permission_hook("afterRestore", bound_read_only(&bound)?);
        if let Err(issue) = remove_verified_name(&quarantine, &original_identity) {
            #[cfg(windows)]
            restore_windows_file_permissions(&current, &prior_permissions)?;
            return Err(WorkspaceError::new(
                "workspace_write_partial",
                format!(
                    "The new file was saved, but verified original recovery cleanup failed: {}",
                    issue.message
                ),
            ));
        }
    } else {
        match bound.parent.symlink_metadata(&bound.name) {
            Ok(_) => return Err(revision_conflict()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(capability_error("workspace_write_failed", error)),
        }
        post_hash_hook();
        permission_hook("beforeCommit", bound_read_only(&staged)?);
        let commit = move_noclobber_with_expected(&staged, &bound, &staged_identity, || {}, || {});
        if !matches!(commit, MoveNoClobberOutcome::Moved) {
            return Err(write_move_error(
                "The new file could not be committed",
                &commit,
            ));
        }
        temporary.disarm();
        permission_hook("afterCommit", bound_read_only(&bound)?);
    }
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

fn bound_read_only(path: &BoundPath) -> WorkspaceResult<bool> {
    path.parent
        .metadata(&path.name)
        .map(|metadata| metadata.permissions().readonly())
        .map_err(|error| capability_error("workspace_write_failed", error))
}

fn restore_committed_permissions(
    committed: &BoundPath,
    expected_identity: &Handle,
    permissions: Permissions,
) -> WorkspaceResult<()> {
    let file = committed
        .parent
        .open(&committed.name)
        .map_err(|error| capability_error("workspace_permission_restore_failed", error))?;
    let identity = file_identity(&file)
        .map_err(|error| io_error("workspace_permission_restore_failed", error))?;
    if identity != *expected_identity {
        return Err(WorkspaceError::new(
            "workspace_permission_restore_failed",
            "The committed target changed before permissions could be restored.",
        ));
    }
    file.set_permissions(permissions)
        .map_err(|error| io_error("workspace_permission_restore_failed", error))
}

fn write_permission_recovery_error(
    permission_error: WorkspaceError,
    rollback: &MoveNoClobberOutcome,
) -> WorkspaceError {
    let (status, rollback_message) = move_failure_details(rollback);
    if status == "moved" {
        WorkspaceError::new(
            "workspace_permission_restore_failed",
            format!(
                "{} The verified original was restored.",
                permission_error.message
            ),
        )
    } else {
        WorkspaceError::new(
            "workspace_write_partial",
            format!(
                "{} Permission recovery rollback failed: {rollback_message}",
                permission_error.message
            ),
        )
    }
}

fn named_hash_matches(path: &BoundPath, identity: &Handle, expected_hash: &str) -> bool {
    let Ok(mut file) = path.parent.open(&path.name) else {
        return false;
    };
    let Ok(current_identity) = file_identity(&file) else {
        return false;
    };
    current_identity == *identity
        && hash_open_file(&mut file, MAX_YAML_BYTES)
            .map(|hash| hash == expected_hash)
            .unwrap_or(false)
}

fn unique_sibling(path: &BoundPath, purpose: &str) -> WorkspaceResult<BoundPath> {
    let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
    Ok(BoundPath {
        parent: path
            .parent
            .try_clone()
            .map_err(|error| io_error("workspace_write_failed", error))?,
        name: OsString::from(format!(
            ".workflow-studio-{purpose}-{}-{sequence}-{}",
            std::process::id(),
            path.name.to_string_lossy()
        )),
    })
}

fn write_move_error(context: &str, outcome: &MoveNoClobberOutcome) -> WorkspaceError {
    let (status, details) = move_failure_details(outcome);
    WorkspaceError::new(
        if status == "partial" {
            "workspace_write_partial"
        } else if matches!(outcome, MoveNoClobberOutcome::Failed(issue) if issue.code == "destination_exists" || issue.code == "source_identity_changed")
        {
            "external_revision_conflict"
        } else {
            "workspace_write_failed"
        },
        format!("{context}: {details}"),
    )
}

fn write_commit_recovery_error(
    commit: &MoveNoClobberOutcome,
    rollback: &MoveNoClobberOutcome,
) -> WorkspaceError {
    let (_, commit_details) = move_failure_details(commit);
    let (rollback_status, rollback_details) = move_failure_details(rollback);
    if rollback_status == "moved" {
        WorkspaceError::new(
            "external_revision_conflict",
            format!("The target changed before commit; the verified original was restored: {commit_details}"),
        )
    } else {
        WorkspaceError::new(
            "workspace_write_partial",
            format!(
                "The target changed before commit ({commit_details}); verified original recovery remains quarantined because rollback failed ({rollback_details})."
            ),
        )
    }
}

fn hash_open_file(file: &mut File, max_bytes: u64) -> WorkspaceResult<String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| io_error("workspace_read_failed", error))?;
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
    let source_identity = named_identity(&source, "path_not_found")
        .map_err(|issue| WorkspaceError::new(issue.code, issue.message))?;
    let source_companion_identity = if has_companion {
        Some(
            named_identity(&source_companion, "path_not_found")
                .map_err(|issue| WorkspaceError::new(issue.code, issue.message))?,
        )
    } else {
        None
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

    let first_move =
        move_noclobber_with_expected(&source, &destination, &source_identity, || {}, || {});
    if !matches!(first_move, MoveNoClobberOutcome::Moved) {
        let (status, message) = move_failure_details(&first_move);
        let result = path_result(
            source_definition,
            Some(destination_definition),
            status,
            Some(move_error_code(&first_move, "workspace_rename_failed")),
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
            .map(|_| {
                move_noclobber_with_expected(
                    &source_companion,
                    &destination_companion,
                    source_companion_identity
                        .as_ref()
                        .expect("companion identity exists when companion exists"),
                    || {},
                    || {},
                )
            });
        let second_move = match second_result {
            Ok(MoveNoClobberOutcome::Moved) => None,
            Ok(outcome) => Some(outcome),
            Err(error) => Some(MoveNoClobberOutcome::Failed(MoveIssue::new(
                error.code,
                error.message,
            ))),
        };
        if let Some(second_move) = second_move {
            let (second_status, second_message) = move_failure_details(&second_move);
            results.push(path_result(
                &source_companion_relative,
                Some(&destination_companion_relative),
                second_status,
                Some(move_error_code(&second_move, "workspace_rename_failed")),
                Some(second_message.clone()),
            ));
            let rollback = if ensure_bound_file(&destination).is_ok()
                && ensure_bound_missing(
                    &source,
                    "The original definition path was recreated before rollback.",
                )
                .is_ok()
            {
                move_noclobber_with_expected(&destination, &source, &source_identity, || {}, || {})
            } else {
                MoveNoClobberOutcome::Failed(MoveIssue::new(
                    "destination_exists",
                    "The original definition path was recreated before rollback.",
                ))
            };
            if matches!(rollback, MoveNoClobberOutcome::Moved) && second_status != "partial" {
                results[0].status = "rolledBack".to_string();
                results[0].error_code = None;
                results[0].message = Some("The definition rollback completed.".to_string());
                return Err(WorkspaceError::new(
                    "workspace_rename_failed",
                    format!("The companion could not be renamed: {second_message}"),
                )
                .with_path_results(results));
            }
            if matches!(rollback, MoveNoClobberOutcome::Moved) {
                results[0].status = "rolledBack".to_string();
                results[0].error_code = None;
                results[0].message = Some("The definition rollback completed.".to_string());
            } else {
                let (_, rollback_message) = move_failure_details(&rollback);
                results[0].status = "partial".to_string();
                results[0].error_code = Some("workspace_rename_partial".to_string());
                results[0].message = Some(format!(
                    "The definition rollback did not complete: {rollback_message}"
                ));
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

fn move_error_code(outcome: &MoveNoClobberOutcome, fallback: &'static str) -> &'static str {
    match outcome {
        MoveNoClobberOutcome::Partial { .. } => "workspace_rename_partial",
        MoveNoClobberOutcome::Failed(issue) => issue.code,
        MoveNoClobberOutcome::RolledBack { unlink_error } => unlink_error.code,
        MoveNoClobberOutcome::Moved => fallback,
    }
}

pub fn trash_paths(
    scope: &WorkspaceScope,
    requests: &[TrashPathRequest],
) -> WorkspaceResult<WorkspaceTrashResult> {
    trash_paths_checked_with(scope, requests, |path| {
        trash::delete(path).map_err(|error| error.to_string())
    })
}

pub fn trash_paths_checked_with(
    scope: &WorkspaceScope,
    requests: &[TrashPathRequest],
    mut delete: impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<WorkspaceTrashResult> {
    let expected = requests
        .iter()
        .map(|request| TrashPathExpectation {
            relative_path: request.relative_path.clone(),
            expected_current_hash: Some(request.expected_current_hash.clone()),
        })
        .collect::<Vec<_>>();
    trash_paths_impl(scope, &expected, || {}, |_| {}, || {}, &mut delete)
}

#[cfg(test)]
pub fn trash_paths_with(
    scope: &WorkspaceScope,
    relative_paths: &[String],
    mut delete: impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<WorkspaceTrashResult> {
    let requests = unchecked_trash_requests(relative_paths);
    trash_paths_impl(scope, &requests, || {}, |_| {}, || {}, &mut delete)
}

#[cfg(test)]
pub fn trash_paths_with_bound_hook(
    scope: &WorkspaceScope,
    relative_paths: &[String],
    hook: impl FnOnce(),
    mut delete: impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<WorkspaceTrashResult> {
    let requests = unchecked_trash_requests(relative_paths);
    trash_paths_impl(scope, &requests, hook, |_| {}, || {}, &mut delete)
}

#[cfg(test)]
pub fn trash_paths_with_handoff_hook(
    scope: &WorkspaceScope,
    relative_paths: &[String],
    mut handoff_hook: impl FnMut(&Path),
    mut delete: impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<WorkspaceTrashResult> {
    let requests = unchecked_trash_requests(relative_paths);
    trash_paths_impl(
        scope,
        &requests,
        || {},
        &mut handoff_hook,
        || {},
        &mut delete,
    )
}

#[cfg(test)]
pub fn trash_paths_with_post_delete_hook(
    scope: &WorkspaceScope,
    relative_paths: &[String],
    mut delete: impl FnMut(&Path) -> Result<(), String>,
    mut post_delete_hook: impl FnMut(),
) -> WorkspaceResult<WorkspaceTrashResult> {
    let requests = unchecked_trash_requests(relative_paths);
    trash_paths_impl(
        scope,
        &requests,
        || {},
        |_| {},
        &mut post_delete_hook,
        &mut delete,
    )
}

fn trash_paths_impl(
    scope: &WorkspaceScope,
    requests: &[TrashPathExpectation],
    bound_hook: impl FnOnce(),
    mut handoff_hook: impl FnMut(&Path),
    mut post_delete_hook: impl FnMut(),
    delete: &mut impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<WorkspaceTrashResult> {
    if requests.is_empty() || requests.len() > 2 {
        return Err(WorkspaceError::new(
            "invalid_trash_request",
            "Move to Trash accepts one or two exact workspace file paths.",
        ));
    }
    let unique: HashSet<&str> = requests
        .iter()
        .map(|request| request.relative_path.as_str())
        .collect();
    if unique.len() != requests.len() {
        return Err(WorkspaceError::new(
            "invalid_trash_request",
            "Move to Trash paths must be unique.",
        ));
    }

    let mut bound = Vec::with_capacity(requests.len());
    for request in requests {
        require_yaml(&request.relative_path)?;
        bound.push(bind_path(scope, &request.relative_path));
    }
    bound_hook();

    let mut results = Vec::with_capacity(requests.len());
    for (request, bound) in requests.iter().zip(bound) {
        let relative = &request.relative_path;
        let result = match bound.and_then(|source| {
            trash_bound_path(
                scope,
                &source,
                relative,
                request.expected_current_hash.as_deref(),
                &mut handoff_hook,
                &mut post_delete_hook,
                delete,
            )
        }) {
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
    expected_current_hash: Option<&str>,
    handoff_hook: &mut impl FnMut(&Path),
    post_delete_hook: &mut impl FnMut(),
    delete: &mut impl FnMut(&Path) -> Result<(), String>,
) -> WorkspaceResult<()> {
    ensure_bound_file(source)?;
    let original_identity = named_identity(source, "path_not_found")
        .map_err(|issue| WorkspaceError::new(issue.code, issue.message))?;
    if expected_current_hash
        .is_some_and(|expected| !named_hash_matches(source, &original_identity, expected))
    {
        return Err(revision_conflict());
    }
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
    match move_noclobber_with_expected(source, &quarantine, &original_identity, || {}, || {}) {
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

    let candidate_path = scope.root.join(&quarantine_name);
    handoff_hook(&candidate_path);
    let ambient_path = match scope.root_path() {
        Ok(root_path) => root_path.join(&quarantine_name),
        Err(error) => {
            return Err(trash_rollback_error(
                &quarantine,
                source,
                &original_identity,
                error,
            ))
        }
    };
    if !named_identity_matches(&quarantine, &original_identity) {
        return Err(trash_rollback_error(
            &quarantine,
            source,
            &original_identity,
            WorkspaceError::new(
                "workspace_trash_partial",
                "The quarantine name changed before OS Trash handoff and was not handed off.",
            ),
        ));
    }
    let ambient_identity = match Handle::from_path(&ambient_path) {
        Ok(identity) => identity,
        Err(error) => {
            return Err(trash_rollback_error(
                &quarantine,
                source,
                &original_identity,
                WorkspaceError::new(
                    "workspace_trash_failed",
                    format!(
                        "The quarantined file could not be bound for OS Trash handoff: {error}"
                    ),
                ),
            ))
        }
    };
    if ambient_identity != original_identity {
        return Err(trash_rollback_error(
            &quarantine,
            source,
            &original_identity,
            WorkspaceError::new(
                "workspace_trash_failed",
                "The ambient quarantine path did not identify the verified original and was not handed off.",
            ),
        ));
    }
    if let Err(error) = scope.verify() {
        return Err(trash_rollback_error(
            &quarantine,
            source,
            &original_identity,
            error,
        ));
    }
    let delete_result = delete(&ambient_path);
    post_delete_hook();
    if let Err(error) = scope.verify() {
        return Err(trash_rollback_error(
            &quarantine,
            source,
            &original_identity,
            error,
        ));
    }
    if let Err(message) = delete_result {
        let rollback =
            move_noclobber_with_expected(&quarantine, source, &original_identity, || {}, || {});
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
    match named_identity(&quarantine, "path_not_found") {
        Err(issue) if issue.code == "path_not_found" => Ok(()),
        Ok(identity) if identity == original_identity => {
            let rollback =
                move_noclobber_with_expected(&quarantine, source, &original_identity, || {}, || {});
            match rollback {
                MoveNoClobberOutcome::Moved => Err(WorkspaceError::new(
                    "workspace_trash_failed",
                    "OS Trash returned success but left the verified original in quarantine; the original was restored.",
                )),
                outcome => {
                    let (_, rollback_message) = move_failure_details(&outcome);
                    Err(WorkspaceError::new(
                        "workspace_trash_partial",
                        format!("OS Trash left the verified original in quarantine and rollback failed: {rollback_message}"),
                    ))
                }
            }
        }
        Ok(_) => Err(trash_rollback_error(
            &quarantine,
            source,
            &original_identity,
            WorkspaceError::new(
                "workspace_trash_partial",
                "OS Trash returned success but the quarantine name now identifies a different file.",
            ),
        )),
        Err(issue) => Err(WorkspaceError::new(issue.code, issue.message)),
    }
}

#[cfg(test)]
fn unchecked_trash_requests(relative_paths: &[String]) -> Vec<TrashPathExpectation> {
    relative_paths
        .iter()
        .map(|relative_path| TrashPathExpectation {
            relative_path: relative_path.clone(),
            expected_current_hash: None,
        })
        .collect()
}

fn trash_rollback_error(
    quarantine: &BoundPath,
    source: &BoundPath,
    original_identity: &Handle,
    error: WorkspaceError,
) -> WorkspaceError {
    match move_noclobber_with_expected(quarantine, source, original_identity, || {}, || {}) {
        MoveNoClobberOutcome::Moved => error,
        outcome => {
            let (_, rollback_message) = move_failure_details(&outcome);
            WorkspaceError::new(
                "workspace_trash_partial",
                format!("{}; rollback failed: {rollback_message}", error.message),
            )
        }
    }
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
        unlink_error: MoveIssue,
    },
    Partial {
        unlink_error: MoveIssue,
        cleanup_error: MoveIssue,
    },
    Failed(MoveIssue),
}

#[derive(Clone, Debug)]
struct MoveIssue {
    code: &'static str,
    message: String,
}

impl MoveIssue {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[cfg(test)]
fn classify_move_noclobber(
    link: Result<(), String>,
    unlink: impl FnOnce() -> Result<(), String>,
    cleanup: impl FnOnce() -> Result<(), String>,
) -> MoveNoClobberOutcome {
    if let Err(error) = link {
        return MoveNoClobberOutcome::Failed(MoveIssue::new("workspace_move_failed", error));
    }
    match unlink() {
        Ok(()) => MoveNoClobberOutcome::Moved,
        Err(unlink_error) => match cleanup() {
            Ok(()) => MoveNoClobberOutcome::RolledBack {
                unlink_error: MoveIssue::new("source_unlink_failed", unlink_error),
            },
            Err(cleanup_error) => MoveNoClobberOutcome::Partial {
                unlink_error: MoveIssue::new("source_unlink_failed", unlink_error),
                cleanup_error: MoveIssue::new("destination_cleanup_failed", cleanup_error),
            },
        },
    }
}

#[cfg(test)]
fn move_noclobber_with_hooks(
    source: &BoundPath,
    destination: &BoundPath,
    before_unlink: impl FnOnce(),
    before_cleanup: impl FnOnce(),
) -> MoveNoClobberOutcome {
    let original = match named_identity(source, "path_not_found") {
        Ok(identity) => identity,
        Err(error) => return MoveNoClobberOutcome::Failed(error),
    };
    move_noclobber_with_expected(
        source,
        destination,
        &original,
        before_unlink,
        before_cleanup,
    )
}

fn move_noclobber_with_expected(
    source: &BoundPath,
    destination: &BoundPath,
    original: &Handle,
    before_unlink: impl FnOnce(),
    before_cleanup: impl FnOnce(),
) -> MoveNoClobberOutcome {
    if !named_identity_matches(source, original) {
        return MoveNoClobberOutcome::Failed(MoveIssue::new(
            "source_identity_changed",
            "The source name changed before the move began.",
        ));
    }
    if let Err(error) =
        source
            .parent
            .hard_link(&source.name, &destination.parent, &destination.name)
    {
        return MoveNoClobberOutcome::Failed(MoveIssue::new(
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "destination_exists"
            } else {
                "workspace_move_failed"
            },
            error.to_string(),
        ));
    }

    before_unlink();
    if !named_identity_matches(destination, original) {
        return MoveNoClobberOutcome::Partial {
            unlink_error: MoveIssue::new(
                "destination_identity_changed",
                "The destination name no longer identifies the linked source.",
            ),
            cleanup_error: MoveIssue::new(
                "destination_identity_changed",
                "The changed destination was preserved instead of being removed.",
            ),
        };
    }
    if !named_identity_matches(source, original) {
        return rollback_link_after_unlink_failure(
            destination,
            original,
            MoveIssue::new(
                "source_identity_changed",
                "The source name changed before unlink and was preserved.",
            ),
            before_cleanup,
        );
    }
    if let Err(error) = source.parent.remove_file(&source.name) {
        return rollback_link_after_unlink_failure(
            destination,
            original,
            MoveIssue::new("source_unlink_failed", error.to_string()),
            before_cleanup,
        );
    }
    if !named_identity_matches(destination, original) {
        return MoveNoClobberOutcome::Partial {
            unlink_error: MoveIssue::new(
                "destination_identity_changed",
                "The destination changed after the source was unlinked.",
            ),
            cleanup_error: MoveIssue::new(
                "original_disposition_unknown",
                "The original file remains open but no verified destination name remains.",
            ),
        };
    }
    MoveNoClobberOutcome::Moved
}

fn rollback_link_after_unlink_failure(
    destination: &BoundPath,
    original: &Handle,
    unlink_error: MoveIssue,
    before_cleanup: impl FnOnce(),
) -> MoveNoClobberOutcome {
    before_cleanup();
    match remove_verified_name(destination, original) {
        Ok(()) => MoveNoClobberOutcome::RolledBack { unlink_error },
        Err(cleanup_error) => MoveNoClobberOutcome::Partial {
            unlink_error,
            cleanup_error,
        },
    }
}

fn named_identity(path: &BoundPath, missing_code: &'static str) -> Result<Handle, MoveIssue> {
    let file = path.parent.open(&path.name).map_err(|error| {
        MoveIssue::new(
            if error.kind() == std::io::ErrorKind::NotFound {
                missing_code
            } else if error.kind() == std::io::ErrorKind::PermissionDenied {
                "path_outside_workspace"
            } else {
                "workspace_identity_failed"
            },
            error.to_string(),
        )
    })?;
    file_identity(&file)
        .map_err(|error| MoveIssue::new("workspace_identity_failed", error.to_string()))
}

fn file_identity(file: &File) -> std::io::Result<Handle> {
    Handle::from_file(file.try_clone()?.into_std())
}

fn named_identity_matches(path: &BoundPath, expected: &Handle) -> bool {
    named_identity(path, "path_not_found")
        .map(|identity| identity == *expected)
        .unwrap_or(false)
}

fn remove_verified_name(path: &BoundPath, expected: &Handle) -> Result<(), MoveIssue> {
    match named_identity(path, "path_not_found") {
        Ok(identity) if identity == *expected => path
            .parent
            .remove_file(&path.name)
            .map_err(|error| MoveIssue::new("destination_cleanup_failed", error.to_string())),
        Ok(_) => Err(MoveIssue::new(
            "destination_identity_changed",
            "The destination changed before cleanup and was preserved.",
        )),
        Err(error) if error.code == "path_not_found" => Err(MoveIssue::new(
            "destination_disposition_unknown",
            "The verified destination name disappeared before cleanup.",
        )),
        Err(error) => Err(error),
    }
}

fn move_failure_details(outcome: &MoveNoClobberOutcome) -> (&'static str, String) {
    match outcome {
        MoveNoClobberOutcome::Moved => ("moved", String::new()),
        MoveNoClobberOutcome::Failed(error) => ("failed", error.message.clone()),
        MoveNoClobberOutcome::RolledBack { unlink_error } => (
            "rolledBack",
            format!(
                "The source could not be removed and the destination was rolled back: {}",
                unlink_error.message
            ),
        ),
        MoveNoClobberOutcome::Partial {
            unlink_error,
            cleanup_error,
        } => (
            "partial",
            format!(
                "The source could not be removed ({}) and destination cleanup also failed ({}).",
                unlink_error.message, cleanup_error.message
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
    pub unlink_error_code: Option<&'static str>,
    pub cleanup_error_code: Option<&'static str>,
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
            unlink_error_code: None,
            cleanup_error_code: None,
        },
        MoveNoClobberOutcome::Failed(_) => TestMoveOutcome {
            status: "failed",
            unlink_error: None,
            cleanup_error: None,
            unlink_error_code: None,
            cleanup_error_code: None,
        },
        MoveNoClobberOutcome::RolledBack { unlink_error } => TestMoveOutcome {
            status: "rolledBack",
            unlink_error: Some(unlink_error.message),
            cleanup_error: None,
            unlink_error_code: Some(unlink_error.code),
            cleanup_error_code: None,
        },
        MoveNoClobberOutcome::Partial {
            unlink_error,
            cleanup_error,
        } => TestMoveOutcome {
            status: "partial",
            unlink_error: Some(unlink_error.message),
            cleanup_error: Some(cleanup_error.message),
            unlink_error_code: Some(unlink_error.code),
            cleanup_error_code: Some(cleanup_error.code),
        },
    }
}

#[cfg(test)]
pub fn move_noclobber_with_hooks_for_test(
    scope: &WorkspaceScope,
    source: &str,
    destination: &str,
    before_unlink: impl FnOnce(),
    before_cleanup: impl FnOnce(),
) -> WorkspaceResult<TestMoveOutcome> {
    let source = bind_path(scope, source)?;
    let destination = bind_path(scope, destination)?;
    let outcome = move_noclobber_with_hooks(&source, &destination, before_unlink, before_cleanup);
    Ok(test_move_outcome(outcome))
}

#[cfg(test)]
fn test_move_outcome(outcome: MoveNoClobberOutcome) -> TestMoveOutcome {
    match outcome {
        MoveNoClobberOutcome::Moved => TestMoveOutcome {
            status: "moved",
            unlink_error: None,
            cleanup_error: None,
            unlink_error_code: None,
            cleanup_error_code: None,
        },
        MoveNoClobberOutcome::Failed(error) => TestMoveOutcome {
            status: "failed",
            unlink_error: Some(error.message),
            cleanup_error: None,
            unlink_error_code: Some(error.code),
            cleanup_error_code: None,
        },
        MoveNoClobberOutcome::RolledBack { unlink_error } => TestMoveOutcome {
            status: "rolledBack",
            unlink_error: Some(unlink_error.message),
            cleanup_error: None,
            unlink_error_code: Some(unlink_error.code),
            cleanup_error_code: None,
        },
        MoveNoClobberOutcome::Partial {
            unlink_error,
            cleanup_error,
        } => TestMoveOutcome {
            status: "partial",
            unlink_error: Some(unlink_error.message),
            cleanup_error: Some(cleanup_error.message),
            unlink_error_code: Some(unlink_error.code),
            cleanup_error_code: Some(cleanup_error.code),
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

#[cfg(all(test, windows))]
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

#[cfg(all(test, windows))]
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
fn make_windows_file_replaceable(
    file: &File,
    prior_permissions: &Permissions,
) -> WorkspaceResult<()> {
    if prior_permissions.readonly() {
        let mut writable = prior_permissions.clone();
        writable.set_readonly(false);
        file.set_permissions(writable)
            .map_err(|error| io_error("workspace_write_failed", error))?;
    }
    Ok(())
}

#[cfg(windows)]
fn restore_windows_file_permissions(
    file: &File,
    prior_permissions: &Permissions,
) -> WorkspaceResult<()> {
    file.set_permissions(prior_permissions.clone())
        .map_err(|error| io_error("workspace_permission_restore_failed", error))
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
