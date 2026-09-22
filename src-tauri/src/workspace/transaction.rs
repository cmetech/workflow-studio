//! Bounded multi-file transactions. Native ownership and identity checks remain authoritative.
use super::{
    artifacts, files,
    package_hash::{canonical, error, io, limit, token},
    PathOperationResult, WorkspaceError, WorkspaceResult, WorkspaceScope, WorkspaceState,
};
use cap_fs_ext::{DirExt, MetadataExt};
use cap_std::fs::Dir;
use same_file::Handle;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use tauri::State;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpectedWorkspaceEntry {
    pub relative_path: String,
    pub expected_current_hash: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteRequest {
    pub relative_path: String,
    pub text: String,
    pub expected_current_hash: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveRequest {
    pub source_path: String,
    pub destination_path: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageMutationPlan {
    pub workspace_id: String,
    pub expected_entries: Vec<ExpectedWorkspaceEntry>,
    pub writes: Vec<WriteRequest>,
    pub moves: Vec<MoveRequest>,
    pub trashes: Vec<files::TrashPathRequest>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransactionResult {
    pub status: String,
    pub results: Vec<PathOperationResult>,
}
struct Existing {
    path: files::BoundPath,
    identity: Handle,
    hash: String,
    permissions: cap_std::fs::Permissions,
}
struct Backup {
    original: String,
    saved: String,
    original_bound: files::BoundPath,
    saved_bound: files::BoundPath,
    identity: Handle,
    hash: String,
    active: bool,
}
struct Staged {
    relative: String,
    bound: files::BoundPath,
    identity: Handle,
    active: bool,
}
struct Installed {
    relative: String,
    bound: files::BoundPath,
    identity: Handle,
    backup: Option<usize>,
}
struct CreatedDirectory {
    relative: String,
    parent: Dir,
    name: String,
    identity: Handle,
}

pub(super) fn workspace_id(scope: &WorkspaceScope) -> WorkspaceResult<String> {
    Ok(files::hash_bytes(
        scope
            .root_path()?
            .to_str()
            .ok_or_else(|| error("workspace_root_invalid"))?
            .as_bytes(),
    ))
}
fn result(
    path: &str,
    destination: Option<&str>,
    status: &str,
    message: Option<String>,
) -> PathOperationResult {
    PathOperationResult {
        relative_path: path.into(),
        destination_path: destination.map(str::to_string),
        status: status.into(),
        error_code: None,
        message,
    }
}
fn clone_bound(bound: &files::BoundPath) -> WorkspaceResult<files::BoundPath> {
    Ok(files::BoundPath {
        parent: bound.parent.try_clone().map_err(io)?,
        name: bound.name.clone(),
        reject_symlinks: true,
    })
}
fn dir_identity(dir: &Dir) -> WorkspaceResult<Handle> {
    Handle::from_file(dir.try_clone().map_err(io)?.into_std_file()).map_err(io)
}

/// Absence is established by traversal through opened no-follow directories, never by swallowing access errors.
fn inspect(scope: &WorkspaceScope, relative: &str) -> WorkspaceResult<Option<Existing>> {
    inspect_excluding(scope, relative, &HashSet::new())
}
fn inspect_excluding(
    scope: &WorkspaceScope,
    relative: &str,
    owned_temporary_paths: &HashSet<String>,
) -> WorkspaceResult<Option<Existing>> {
    artifacts::validate(relative)?;
    let mut parent = scope.directory()?.try_clone().map_err(io)?;
    let parts: Vec<_> = relative.split('/').collect();
    for (index, part) in parts.iter().enumerate() {
        // Detect existing casefold aliases even on case-sensitive hosts.
        let mut seen = 0u64;
        let prefix = if index == 0 {
            String::new()
        } else {
            format!("{}/", parts[..index].join("/"))
        };
        for entry in parent.entries().map_err(io)? {
            let name = entry.map_err(io)?.file_name();
            if name
                .to_str()
                .is_some_and(|name| owned_temporary_paths.contains(&format!("{prefix}{name}")))
            {
                continue;
            }
            seen += 1;
            if seen > limit("max_traversal_entries") {
                return Err(error("package_traversal_limit"));
            }
            if let Some(name) = name.to_str() {
                if name != *part && canonical(name) == canonical(part) {
                    return Err(error("package_path_collision"));
                }
            }
        }
        let metadata = match parent.symlink_metadata(part) {
            Ok(value) => value,
            Err(value) if value.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(value) => return Err(io(value)),
        };
        artifacts::reject_link(&metadata)?;
        if index + 1 < parts.len() {
            if !metadata.is_dir() {
                return Err(error("package_path_collision"));
            }
            parent = parent.open_dir_nofollow(part).map_err(io)?;
        } else {
            if metadata.is_dir() {
                return Err(error("workspace_revision_conflict"));
            }
            let bound = files::BoundPath {
                parent,
                name: part.into(),
                reject_symlinks: true,
            };
            let mut file = artifacts::open(&bound)?;
            if file.metadata().map_err(io)?.nlink() > 1 {
                return Err(error("package_path_collision"));
            }
            let identity =
                Handle::from_file(file.try_clone().map_err(io)?.into_std()).map_err(io)?;
            let hash = files::hash_open_file(&mut file, limit("max_file_bytes"))?;
            return Ok(Some(Existing {
                permissions: file.metadata().map_err(io)?.permissions(),
                path: bound,
                identity,
                hash,
            }));
        }
    }
    Err(error("workspace_transaction_invalid"))
}
fn validate_plan(
    scope: &WorkspaceScope,
    plan: &PackageMutationPlan,
) -> WorkspaceResult<BTreeMap<String, Option<Existing>>> {
    if workspace_id(scope)? != plan.workspace_id {
        return Err(error("workspace_root_changed"));
    }
    if plan.expected_entries.len() as u64 > limit("max_traversal_entries")
        || (plan.writes.len() + plan.moves.len() + plan.trashes.len()) as u64 > limit("max_files")
    {
        return Err(error("package_file_count_limit"));
    }
    let mut expected = BTreeMap::new();
    let mut aliases = HashMap::new();
    let mut expectations = HashMap::new();
    for entry in &plan.expected_entries {
        artifacts::validate(&entry.relative_path)?;
        if expectations
            .insert(
                entry.relative_path.clone(),
                entry.expected_current_hash.clone(),
            )
            .is_some()
        {
            return Err(error("workspace_transaction_invalid"));
        }
        let parts: Vec<_> = entry.relative_path.split('/').collect();
        for end in 1..=parts.len() {
            let prefix = parts[..end].join("/");
            let key = canonical(&prefix);
            if aliases
                .insert(key, prefix.clone())
                .is_some_and(|old| old != prefix)
            {
                return Err(error("package_path_collision"));
            }
        }
        let current = inspect(scope, &entry.relative_path)?;
        if current.as_ref().map(|value| value.hash.as_str())
            != entry.expected_current_hash.as_deref()
        {
            return Err(error("workspace_revision_conflict"));
        }
        expected.insert(entry.relative_path.clone(), current);
    }
    let mut touched = HashSet::new();
    let mut total = 0u64;
    let mut touch = |path: &str, hash: Option<&Option<String>>| -> WorkspaceResult<()> {
        if !touched.insert(path.to_string())
            || !expectations.contains_key(path)
            || hash.is_some_and(|hash| hash != &expectations[path])
        {
            return Err(error("workspace_transaction_invalid"));
        }
        if expected[path]
            .as_ref()
            .is_some_and(|entry| entry.permissions.readonly())
        {
            return Err(error("workspace_readonly_unsupported"));
        }
        Ok(())
    };
    for write in &plan.writes {
        touch(&write.relative_path, Some(&write.expected_current_hash))?;
        if write.text.len() as u64 > limit("max_file_bytes") {
            return Err(error("package_file_size_limit"));
        }
        total += write.text.len() as u64;
    }
    for movement in &plan.moves {
        touch(&movement.source_path, None)?;
        touch(&movement.destination_path, Some(&None))?;
        let source = expected[&movement.source_path]
            .as_ref()
            .ok_or_else(|| error("workspace_transaction_invalid"))?;
        total += source
            .path
            .parent
            .metadata(&source.path.name)
            .map_err(io)?
            .len();
    }
    for trash in &plan.trashes {
        touch(
            &trash.relative_path,
            Some(&Some(trash.expected_current_hash.clone())),
        )?;
    }
    if total > limit("max_total_bytes") {
        return Err(error("package_total_size_limit"));
    }
    for path in &touched {
        if touched
            .iter()
            .any(|other| other != path && other.starts_with(&format!("{path}/")))
        {
            return Err(error("package_path_collision"));
        }
    }
    Ok(expected)
}
fn create_parents(
    scope: &WorkspaceScope,
    path: &str,
    created: &mut Vec<CreatedDirectory>,
) -> WorkspaceResult<()> {
    let parts: Vec<_> = path.split('/').collect();
    let mut parent = scope.directory()?.try_clone().map_err(io)?;
    for (index, part) in parts[..parts.len() - 1].iter().enumerate() {
        match parent.symlink_metadata(part) {
            Ok(metadata) => {
                artifacts::reject_link(&metadata)?;
                if !metadata.is_dir() {
                    return Err(error("package_path_collision"));
                }
            }
            Err(value) if value.kind() == std::io::ErrorKind::NotFound => {
                parent.create_dir(part).map_err(io)?;
                let child = parent.open_dir_nofollow(part).map_err(io)?;
                created.push(CreatedDirectory {
                    relative: parts[..=index].join("/"),
                    parent: parent.try_clone().map_err(io)?,
                    name: part.to_string(),
                    identity: dir_identity(&child)?,
                });
            }
            Err(value) => return Err(io(value)),
        }
        parent = parent.open_dir_nofollow(part).map_err(io)?;
    }
    Ok(())
}
fn sibling(relative: &str, label: &str) -> WorkspaceResult<String> {
    let parent = relative
        .rsplit_once('/')
        .map(|(parent, _)| format!("{parent}/"))
        .unwrap_or_default();
    Ok(format!("{parent}.workflow-studio-{label}-{}", token()?))
}
fn is_created_directory(
    scope: &WorkspaceScope,
    path: &str,
    created: &[CreatedDirectory],
) -> WorkspaceResult<bool> {
    if let Some(value) = created.iter().find(|value| value.relative == path) {
        let current = super::package_hash::directory(scope, path)?;
        if dir_identity(&current)? != value.identity {
            return Err(error("workspace_directory_changed"));
        }
        return Ok(true);
    }
    Ok(false)
}
fn cleanup_directories(created: &mut Vec<CreatedDirectory>) -> Vec<PathOperationResult> {
    let mut failed = Vec::new();
    while let Some(value) = created.pop() {
        let outcome = value
            .parent
            .open_dir_nofollow(&value.name)
            .map_err(io)
            .and_then(|dir| {
                if dir_identity(&dir)? != value.identity {
                    return Err(error("workspace_directory_changed"));
                }
                drop(dir);
                drop(value.identity);
                value.parent.remove_dir(&value.name).map_err(io)
            });
        if let Err(error) = outcome {
            failed.push(result(
                &value.relative,
                None,
                "partial",
                Some(error.message),
            ));
        }
    }
    failed
}
pub fn apply(
    scope: &WorkspaceScope,
    plan: &PackageMutationPlan,
) -> WorkspaceResult<WorkspaceTransactionResult> {
    apply_verified(scope, plan, |_| Ok(()), |_| Ok(()), |_| Ok(()))
}
#[cfg(test)]
pub fn apply_with_hook(
    scope: &WorkspaceScope,
    plan: &PackageMutationPlan,
    hook: impl FnMut(usize) -> WorkspaceResult<()>,
) -> WorkspaceResult<WorkspaceTransactionResult> {
    apply_verified(scope, plan, |_| Ok(()), |_| Ok(()), hook)
}

pub(super) fn apply_verified(
    scope: &WorkspaceScope,
    plan: &PackageMutationPlan,
    verify_before: impl FnOnce(&[String]) -> WorkspaceResult<()>,
    verify_after: impl FnOnce(&[String]) -> WorkspaceResult<()>,
    hook: impl FnMut(usize) -> WorkspaceResult<()>,
) -> WorkspaceResult<WorkspaceTransactionResult> {
    apply_verified_staging(scope, plan, verify_before, verify_after, hook, |_| Ok(()))
}

#[cfg(test)]
pub fn apply_with_staging_hook(
    scope: &WorkspaceScope,
    plan: &PackageMutationPlan,
    stage: impl FnMut(usize) -> WorkspaceResult<()>,
) -> WorkspaceResult<WorkspaceTransactionResult> {
    apply_verified_staging(scope, plan, |_| Ok(()), |_| Ok(()), |_| Ok(()), stage)
}

fn apply_verified_staging(
    scope: &WorkspaceScope,
    plan: &PackageMutationPlan,
    verify_before: impl FnOnce(&[String]) -> WorkspaceResult<()>,
    verify_after: impl FnOnce(&[String]) -> WorkspaceResult<()>,
    mut hook: impl FnMut(usize) -> WorkspaceResult<()>,
    mut stage: impl FnMut(usize) -> WorkspaceResult<()>,
) -> WorkspaceResult<WorkspaceTransactionResult> {
    let expected = validate_plan(scope, plan)?;
    let mut created = Vec::new();
    let mut staged: Vec<Staged> = Vec::new();
    let mut backups: Vec<Backup> = Vec::new();
    let mut installed: Vec<Installed> = Vec::new();
    let mut step = 0;
    let operation = (|| -> WorkspaceResult<()> {
        for path in plan
            .writes
            .iter()
            .map(|value| value.relative_path.as_str())
            .chain(
                plan.moves
                    .iter()
                    .map(|value| value.destination_path.as_str()),
            )
        {
            create_parents(scope, path, &mut created)?;
        }
        for (position, write) in plan.writes.iter().enumerate() {
            stage(position)?;
            let relative = sibling(&write.relative_path, "stage")?;
            artifacts::write_text(scope, &relative, &write.text, None)?;
            let bound = artifacts::bind(scope, &relative)?;
            let identity = files::transaction_identity(&bound)?;
            staged.push(Staged {
                relative,
                bound,
                identity,
                active: true,
            });
            if let Some(original) = &expected[&write.relative_path] {
                let staged_file = staged.last().unwrap();
                files::transaction_permissions(
                    &staged_file.bound,
                    &staged_file.identity,
                    original.permissions.clone(),
                )?;
            }
        }
        // Native-owned temporary entries are not members of the final package tree.
        let mut temporary_paths: HashSet<_> =
            staged.iter().map(|file| file.relative.clone()).collect();
        // Recheck every expected identity/hash after staging and before any original changes.
        for (path, prior) in &expected {
            if prior.is_none() && is_created_directory(scope, path, &created)? {
                continue;
            }
            let current = inspect_excluding(scope, path, &temporary_paths)?;
            if current.as_ref().map(|value| (&value.identity, &value.hash))
                != prior.as_ref().map(|value| (&value.identity, &value.hash))
            {
                return Err(error("workspace_revision_conflict"));
            }
        }
        verify_before(
            &staged
                .iter()
                .map(|file| file.relative.clone())
                .collect::<Vec<_>>(),
        )?;
        hook(step)?;
        step += 1;
        let paths: Vec<_> = plan
            .writes
            .iter()
            .map(|value| &value.relative_path)
            .chain(plan.moves.iter().map(|value| &value.source_path))
            .chain(plan.trashes.iter().map(|value| &value.relative_path))
            .collect();
        for path in paths {
            if let Some(existing) = &expected[path] {
                artifacts::verify_binding(scope, path, &existing.path)?;
                if !files::transaction_matches(&existing.path, &existing.identity, &existing.hash) {
                    return Err(error("workspace_revision_conflict"));
                }
                let saved = sibling(path, "original")?;
                let saved_bound = artifacts::bind(scope, &saved)?;
                let backup = Backup {
                    original: path.clone(),
                    saved,
                    original_bound: clone_bound(&existing.path)?,
                    saved_bound,
                    identity: files::transaction_identity(&existing.path)?,
                    hash: existing.hash.clone(),
                    active: true,
                };
                backups.push(backup);
                let backup = backups.last().unwrap();
                files::transaction_move(
                    &backup.original_bound,
                    &backup.saved_bound,
                    &backup.identity,
                )?;
                if !files::transaction_matches(&backup.saved_bound, &backup.identity, &backup.hash)
                {
                    return Err(error("workspace_revision_conflict"));
                }
                hook(step)?;
                step += 1;
            }
        }
        for (index, write) in plan.writes.iter().enumerate() {
            let destination = artifacts::bind(scope, &write.relative_path)?;
            let source = &mut staged[index];
            let identity = files::transaction_identity(&source.bound)?;
            installed.push(Installed {
                relative: write.relative_path.clone(),
                bound: clone_bound(&destination)?,
                identity,
                backup: None,
            });
            files::transaction_move(&source.bound, &destination, &source.identity)?;
            source.active = false;
            hook(step)?;
            step += 1;
        }
        for movement in &plan.moves {
            let index = backups
                .iter()
                .position(|backup| backup.original == movement.source_path)
                .expect("validated source");
            let backup = &mut backups[index];
            let destination = artifacts::bind(scope, &movement.destination_path)?;
            let identity = files::transaction_identity(&backup.saved_bound)?;
            installed.push(Installed {
                relative: movement.destination_path.clone(),
                bound: clone_bound(&destination)?,
                identity,
                backup: Some(index),
            });
            files::transaction_move(&backup.saved_bound, &destination, &backup.identity)?;
            backup.active = false;
            hook(step)?;
            step += 1;
        }
        for write in &plan.writes {
            if artifacts::read(scope, &write.relative_path)?.sha256
                != files::hash_bytes(write.text.as_bytes())
            {
                return Err(error("workspace_revision_conflict"));
            }
        }
        for movement in &plan.moves {
            let source = expected[&movement.source_path].as_ref().unwrap();
            if artifacts::read(scope, &movement.destination_path)?.sha256 != source.hash {
                return Err(error("workspace_revision_conflict"));
            }
        }
        temporary_paths.extend(backups.iter().map(|file| file.saved.clone()));
        for (path, prior) in &expected {
            let touched = plan.writes.iter().any(|write| &write.relative_path == path)
                || plan.moves.iter().any(|movement| {
                    &movement.source_path == path || &movement.destination_path == path
                })
                || plan
                    .trashes
                    .iter()
                    .any(|trash| &trash.relative_path == path);
            if !touched {
                if prior.is_none() && is_created_directory(scope, path, &created)? {
                    continue;
                }
                let current = inspect_excluding(scope, path, &temporary_paths)?;
                if current.as_ref().map(|value| (&value.identity, &value.hash))
                    != prior.as_ref().map(|value| (&value.identity, &value.hash))
                {
                    return Err(error("workspace_revision_conflict"));
                }
            }
        }
        verify_after(
            &staged
                .iter()
                .map(|file| file.relative.clone())
                .chain(backups.iter().map(|file| file.saved.clone()))
                .collect::<Vec<_>>(),
        )?;
        Ok(())
    })();
    if let Err(cause) = operation {
        let mut recovery = Vec::new();
        for value in installed.iter().rev() {
            let restored = if let Some(index) = value.backup {
                let backup = &mut backups[index];
                let outcome =
                    files::transaction_move(&value.bound, &backup.saved_bound, &value.identity);
                if outcome.is_ok() {
                    backup.active = true;
                }
                outcome
            } else {
                files::transaction_remove(&value.bound, &value.identity)
            };
            if let Err(error) = restored {
                recovery.push(result(
                    &value.relative,
                    None,
                    "partial",
                    Some(error.message),
                ));
            }
        }
        for backup in backups.iter().rev().filter(|backup| backup.active) {
            if let Err(error) = files::transaction_move(
                &backup.saved_bound,
                &backup.original_bound,
                &backup.identity,
            ) {
                recovery.push(result(
                    &backup.original,
                    Some(&backup.saved),
                    "partial",
                    Some(error.message),
                ));
            }
        }
        for file in staged.iter().filter(|value| value.active) {
            if let Err(error) = files::transaction_remove(&file.bound, &file.identity) {
                recovery.push(result(&file.relative, None, "partial", Some(error.message)));
            }
        }
        drop(installed);
        drop(backups);
        drop(staged);
        recovery.extend(cleanup_directories(&mut created));
        if recovery.is_empty() {
            return Err(cause);
        }
        return Err(WorkspaceError::new(
            "workspace_transaction_partial",
            format!("{}; some verified recovery files remain.", cause.message),
        )
        .with_path_results(recovery));
    }
    // All reversible changes have committed and passed verification. Trash handoff cannot be globally rolled back.
    let mut results = Vec::new();
    let trash_paths: HashSet<_> = plan
        .trashes
        .iter()
        .map(|value| value.relative_path.as_str())
        .collect();
    let mut partial = false;
    for backup in backups.iter().filter(|value| value.active) {
        let outcome = if trash_paths.contains(backup.original.as_str()) {
            files::transaction_trash(scope, &backup.saved_bound, &backup.saved, &backup.hash)
        } else {
            files::transaction_remove(&backup.saved_bound, &backup.identity)
        };
        if let Err(error) = outcome {
            partial = true;
            results.extend(error.path_results);
            results.push(result(
                &backup.original,
                Some(&backup.saved),
                "partial",
                Some(error.message),
            ));
        }
    }
    results.extend(
        plan.writes
            .iter()
            .map(|write| result(&write.relative_path, None, "written", None)),
    );
    results.extend(plan.moves.iter().map(|movement| {
        result(
            &movement.source_path,
            Some(&movement.destination_path),
            "moved",
            None,
        )
    }));
    if partial {
        return Err(WorkspaceError::new(
            "workspace_transaction_partial",
            "Reversible changes committed; original recovery or Trash handoff needs attention.",
        )
        .with_path_results(results));
    }
    results.extend(
        plan.trashes
            .iter()
            .map(|trash| result(&trash.relative_path, None, "trashed", None)),
    );
    Ok(WorkspaceTransactionResult {
        status: "committed".into(),
        results,
    })
}
#[tauri::command]
pub fn workspace_apply_transaction(
    plan: PackageMutationPlan,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<WorkspaceTransactionResult> {
    super::with_scope(&state, |scope| apply(scope, &plan))
}
