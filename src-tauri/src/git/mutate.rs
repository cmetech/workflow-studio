use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use same_file::Handle;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::runner::{
    run_mutation, run_mutation_with_index, run_read, MutationOperation, ReadOperation,
};
use super::{
    command_error, detect_repository, detect_repository_metadata, ensure_success, output_text,
    pair_paths, status, validate_path, GitError, GitRepository, GitResult, GitStatus,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitVersionResult {
    pub oid: String,
    pub status: GitStatus,
}

pub fn init_repository(workspace_root: &Path) -> GitResult<GitRepository> {
    init_repository_with_guard(workspace_root, || Ok(()))
}

pub(crate) fn init_repository_with_guard(
    workspace_root: &Path,
    mut before_mutation: impl FnMut() -> GitResult<()>,
) -> GitResult<GitRepository> {
    before_mutation()?;
    let output = run_mutation(workspace_root, MutationOperation::Init { workspace_root })?;
    ensure_success("git_init_failed", &output)?;
    detect_repository(workspace_root)?.ok_or_else(|| {
        GitError::new(
            "git_init_failed",
            "Git initialization completed without creating a repository at the selected root.",
        )
    })
}

pub fn set_local_identity(root: &Path, user_name: &str, user_email: &str) -> GitResult<()> {
    set_local_identity_with_guard(root, user_name, user_email, || Ok(()))
}

pub(crate) fn set_local_identity_with_guard(
    root: &Path,
    user_name: &str,
    user_email: &str,
    mut before_mutation: impl FnMut() -> GitResult<()>,
) -> GitResult<()> {
    let name = required_value(
        user_name,
        "git_identity_invalid",
        "Enter a repository author name.",
    )?;
    let email = required_value(
        user_email,
        "git_identity_invalid",
        "Enter a repository author email.",
    )?;
    before_mutation()?;
    let output = run_mutation(
        root,
        MutationOperation::SetLocalConfig {
            key: "user.name",
            value: name,
        },
    )?;
    ensure_success("git_identity_failed", &output)?;
    before_mutation()?;
    let output = run_mutation(
        root,
        MutationOperation::SetLocalConfig {
            key: "user.email",
            value: email,
        },
    )?;
    ensure_success("git_identity_failed", &output)
}

pub fn create_pair_version(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
    message: &str,
) -> GitResult<GitVersionResult> {
    create_pair_version_with_guard(root, definition_path, companion_path, message, || Ok(()))
}

#[cfg(test)]
pub(crate) fn preview_pair_version(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
) -> GitResult<(String, PairPathBinding)> {
    let (diff, binding, _) =
        preview_pair_version_authorized(root, definition_path, companion_path)?;
    Ok((diff, binding))
}

pub(crate) fn preview_pair_version_authorized(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
) -> GitResult<(String, PairPathBinding, GitBase)> {
    let paths = pair_paths(definition_path, companion_path)?;
    let binding = PairPathBinding::capture(root, &paths)?;
    let base = GitBase::capture(root)?;
    let pair_status = run_read(root, ReadOperation::PairStatus { paths: &paths })?;
    ensure_success("git_status_failed", &pair_status)?;
    if pair_status.stdout.is_empty() {
        binding.verify()?;
        return Ok((String::new(), binding, base));
    }
    let diff_base = match &base {
        GitBase::Head(oid) => oid.clone(),
        GitBase::Unborn => {
            let empty = run_read(root, ReadOperation::EmptyTree)?;
            ensure_success("git_preview_failed", &empty)?;
            output_text(&empty.stdout)?.trim().to_owned()
        }
    };
    let combined = run_read(
        root,
        ReadOperation::HeadDiff {
            base: &diff_base,
            paths: &paths,
        },
    )?;
    let mut diff = if combined.success() {
        output_text(&combined.stdout)?.to_owned()
    } else {
        String::new()
    };
    for path in paths {
        if !is_tracked(root, path)? && root.join(path).is_file() {
            let untracked = run_read(root, ReadOperation::UntrackedDiff { path })?;
            if untracked.stdout.is_empty() {
                return Err(GitError::new(
                    "git_preview_failed",
                    "An untracked workflow path could not be included in the version preview.",
                ));
            }
            diff.push_str(&output_text(&untracked.stdout)?);
        }
    }
    if diff.is_empty() {
        return Err(GitError::new(
            "git_preview_failed",
            "The prospective pair patch could not be generated.",
        ));
    }
    binding.verify()?;
    base.verify(root)?;
    Ok((diff, binding, base))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum GitBase {
    Head(String),
    Unborn,
}

impl GitBase {
    pub(crate) fn capture(root: &Path) -> GitResult<Self> {
        let head = run_read(root, ReadOperation::FullHead)?;
        if head.success() {
            let oid = output_text(&head.stdout)?.trim().to_owned();
            if !(7..=64).contains(&oid.len()) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(GitError::new(
                    "git_head_unavailable",
                    "Git returned an invalid HEAD object ID.",
                ));
            }
            Ok(Self::Head(oid))
        } else {
            let branch = run_read(root, ReadOperation::Branch)?;
            if branch.success() && !output_text(&branch.stdout)?.trim().is_empty() {
                Ok(Self::Unborn)
            } else {
                Err(GitError::new(
                    "git_head_unavailable",
                    "Repository HEAD could not be resolved as a commit or unborn branch.",
                ))
            }
        }
    }

    pub(crate) fn verify(&self, root: &Path) -> GitResult<()> {
        if &Self::capture(root)? == self {
            Ok(())
        } else {
            Err(GitError::new(
                "git_base_changed",
                "Repository HEAD changed after the pair version preview.",
            ))
        }
    }
}

pub(crate) fn create_pair_version_with_guard(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
    message: &str,
    mut before_mutation: impl FnMut() -> GitResult<()>,
) -> GitResult<GitVersionResult> {
    let message = required_value(message, "git_message_required", "Enter a version message.")?;
    let paths = pair_paths(definition_path, companion_path)?;
    let path_binding = PairPathBinding::capture(root, &paths)?;
    before_mutation()?;
    path_binding.verify()?;
    require_identity(root)?;
    let pair_status = run_read(root, ReadOperation::PairStatus { paths: &paths })?;
    ensure_success("git_status_failed", &pair_status)?;
    if pair_status.stdout.is_empty() {
        return Err(GitError::new(
            "git_nothing_to_commit",
            "The selected workflow pair has no changes to version.",
        ));
    }

    let mut untracked = Vec::new();
    for path in &paths {
        let tracked = run_read(root, ReadOperation::IsTracked { path })?;
        if !tracked.success() && root.join(path).is_file() {
            untracked.push(*path);
        }
    }
    if !untracked.is_empty() {
        before_mutation()?;
        path_binding.verify()?;
        let added = run_mutation(root, MutationOperation::IntentToAdd { paths: &untracked })?;
        ensure_success("git_stage_failed", &added)?;
    }

    before_mutation()?;
    path_binding.verify()?;
    let committed = run_mutation(
        root,
        MutationOperation::CommitOnly {
            message,
            paths: &paths,
        },
    )?;
    if !committed.success() {
        return Err(command_error("git_commit_rejected", &committed));
    }
    let oid = run_read(root, ReadOperation::FullHead)?;
    ensure_success("git_head_unavailable", &oid)?;
    Ok(GitVersionResult {
        oid: output_text(&oid.stdout)?.trim().to_owned(),
        status: status(root)?,
    })
}

pub fn is_tracked(root: &Path, path: &str) -> GitResult<bool> {
    validate_path(path)?;
    Ok(run_read(root, ReadOperation::IsTracked { path })?.success())
}

pub fn move_tracked_path(root: &Path, source: &str, destination: &str) -> GitResult<()> {
    move_tracked_path_with_guard(root, source, destination, || Ok(()))
}

pub fn move_tracked_paths(root: &Path, moves: &[(&str, &str)]) -> GitResult<()> {
    let metadata = detect_repository_metadata(root)?.ok_or_else(|| {
        GitError::new(
            "git_repository_unavailable",
            "Git metadata is no longer available.",
        )
    })?;
    move_tracked_paths_in_git_dir_with_guard(root, &metadata.worktree_dir, moves, || Ok(()))
}

#[cfg(test)]
pub(crate) fn move_tracked_paths_with_guard(
    root: &Path,
    moves: &[(&str, &str)],
    before_mutation: impl FnMut() -> GitResult<()>,
) -> GitResult<()> {
    let metadata = detect_repository_metadata(root)?.ok_or_else(|| {
        GitError::new(
            "git_repository_unavailable",
            "Git metadata is no longer available.",
        )
    })?;
    move_tracked_paths_in_git_dir_with_guard(root, &metadata.worktree_dir, moves, before_mutation)
}

pub(crate) fn move_tracked_paths_in_git_dir_with_guard(
    root: &Path,
    git_dir: &Path,
    moves: &[(&str, &str)],
    mut before_mutation: impl FnMut() -> GitResult<()>,
) -> GitResult<()> {
    if moves.is_empty() {
        return Ok(());
    }
    let bindings = moves
        .iter()
        .map(|(source, destination)| MovePathBinding::capture(root, source, destination))
        .collect::<GitResult<Vec<_>>>()?;
    for (source, _) in moves {
        if !is_tracked(root, source)? {
            return Err(GitError::new(
                "git_path_not_tracked",
                "Only tracked workflow paths can be moved through Git.",
            ));
        }
    }

    let index_path = git_dir.join("index");
    let original_index = read_bounded_file(
        &index_path,
        16 * 1024 * 1024,
        "git_index_unavailable",
        "The repository index could not be read.",
        "git_index_too_large",
        "The repository index exceeds the 16 MiB rename safety limit.",
    )?;
    let temporary_index = temporary_index_path(git_dir);
    let mut temporary = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_index)
        .map_err(|_| {
            GitError::new(
                "git_index_unavailable",
                "A temporary Git index could not be created.",
            )
        })?;
    if temporary.write_all(&original_index).is_err() {
        drop(temporary);
        let _ = fs::remove_file(&temporary_index);
        return Err(GitError::new(
            "git_index_unavailable",
            "The temporary Git index could not be initialized.",
        ));
    }
    drop(temporary);

    let mut completed = 0;
    let operation = (|| {
        for (index, (source, destination)) in moves.iter().enumerate() {
            before_mutation()?;
            bindings[index].verify_source_and_destination()?;
            let output = run_mutation_with_index(
                root,
                MutationOperation::Move {
                    source,
                    destination,
                },
                &temporary_index,
            )?;
            ensure_success("git_move_failed", &output)?;
            bindings[index].verify_destination()?;
            completed += 1;
        }
        before_mutation()?;
        publish_temporary_index(&index_path, &temporary_index, &original_index, || {
            before_mutation()
        })
    })();

    if let Err(error) = operation {
        let rollback = rollback_worktree_moves(&bindings[..completed]);
        let _ = fs::remove_file(&temporary_index);
        if rollback.is_err() {
            return Err(GitError::new(
                "git_move_rollback_failed",
                "The pair rename failed and its worktree rollback could not be completed safely.",
            ));
        }
        return Err(error);
    }
    let _ = fs::remove_file(&temporary_index);
    Ok(())
}

static NEXT_TEMP_INDEX: AtomicU64 = AtomicU64::new(1);

fn temporary_index_path(git_dir: &Path) -> PathBuf {
    git_dir.join(format!(
        "workflow-studio-index-{}-{}",
        std::process::id(),
        NEXT_TEMP_INDEX.fetch_add(1, Ordering::Relaxed)
    ))
}

fn publish_temporary_index(
    index_path: &Path,
    temporary_index: &Path,
    original: &[u8],
    mut before_publish: impl FnMut() -> GitResult<()>,
) -> GitResult<()> {
    let lock_path = index_path.with_extension("lock");
    let result = (|| {
        let mut lock = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(|_| GitError::new("git_index_changed", "The repository index is busy."))?;
        let current = read_bounded_file(
            index_path,
            16 * 1024 * 1024,
            "git_index_unavailable",
            "The repository index could not be read again.",
            "git_index_changed",
            "The repository index changed during the pair rename.",
        )?;
        if current != original {
            return Err(GitError::new(
                "git_index_changed",
                "The repository index changed during the pair rename.",
            ));
        }
        let bytes = read_bounded_file(
            temporary_index,
            16 * 1024 * 1024,
            "git_index_unavailable",
            "The temporary Git index could not be read.",
            "git_index_too_large",
            "The temporary Git index exceeds the 16 MiB rename safety limit.",
        )?;
        lock.write_all(&bytes).map_err(|_| {
            GitError::new(
                "git_index_unavailable",
                "The updated Git index could not be written.",
            )
        })?;
        lock.sync_all().map_err(|_| {
            GitError::new(
                "git_index_unavailable",
                "The updated Git index could not be synchronized.",
            )
        })?;
        before_publish()?;
        drop(lock);
        fs::rename(&lock_path, index_path).map_err(|_| {
            GitError::new(
                "git_index_unavailable",
                "The updated Git index could not be published.",
            )
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&lock_path);
    }
    result
}

struct MovePathBinding {
    source: PathBuf,
    destination: PathBuf,
    identity: Handle,
}

impl MovePathBinding {
    fn capture(root: &Path, source: &str, destination: &str) -> GitResult<Self> {
        validate_path(source)?;
        validate_path(destination)?;
        let source = root.join(source);
        let destination = root.join(destination);
        if destination.exists() {
            return Err(GitError::new(
                "git_move_destination_exists",
                "A tracked rename destination already exists.",
            ));
        }
        let identity = Handle::from_path(&source).map_err(|_| {
            GitError::new(
                "git_pair_unavailable",
                "A tracked workflow path could not be identified.",
            )
        })?;
        Ok(Self {
            source,
            destination,
            identity,
        })
    }

    fn verify_source_and_destination(&self) -> GitResult<()> {
        if Handle::from_path(&self.source).ok().as_ref() != Some(&self.identity)
            || self.destination.exists()
        {
            return Err(GitError::new(
                "git_pair_changed",
                "A workflow rename path changed before Git could move it.",
            ));
        }
        Ok(())
    }

    fn verify_destination(&self) -> GitResult<()> {
        if Handle::from_path(&self.destination).ok().as_ref() != Some(&self.identity)
            || self.source.exists()
        {
            return Err(GitError::new(
                "git_pair_changed",
                "A workflow path changed while Git was moving it.",
            ));
        }
        Ok(())
    }
}

fn rollback_worktree_moves(completed: &[MovePathBinding]) -> GitResult<()> {
    for binding in completed.iter().rev() {
        binding.verify_destination()?;
        fs::rename(&binding.destination, &binding.source).map_err(|_| {
            GitError::new(
                "git_move_rollback_failed",
                "A moved workflow path could not be restored.",
            )
        })?;
        if Handle::from_path(&binding.source).ok().as_ref() != Some(&binding.identity) {
            return Err(GitError::new(
                "git_move_rollback_failed",
                "A restored workflow path no longer has its original identity.",
            ));
        }
    }
    Ok(())
}

pub(crate) fn move_tracked_path_with_guard(
    root: &Path,
    source: &str,
    destination: &str,
    mut before_mutation: impl FnMut() -> GitResult<()>,
) -> GitResult<()> {
    validate_path(source)?;
    validate_path(destination)?;
    let path_binding = PairPathBinding::capture(root, &[source])?;
    let destination_path = root.join(destination);
    if destination_path.exists() {
        return Err(GitError::new(
            "git_move_destination_exists",
            "The tracked rename destination already exists.",
        ));
    }
    if !is_tracked(root, source)? {
        return Err(GitError::new(
            "git_path_not_tracked",
            "Only a tracked workflow path can be moved through Git.",
        ));
    }
    before_mutation()?;
    path_binding.verify()?;
    if destination_path.exists() {
        return Err(GitError::new(
            "git_pair_changed",
            "A workflow rename destination appeared before Git could move the path.",
        ));
    }
    let output = run_mutation(
        root,
        MutationOperation::Move {
            source,
            destination,
        },
    )?;
    ensure_success("git_move_failed", &output)
}

pub(crate) struct PairPathBinding {
    paths: Vec<(PathBuf, Option<Handle>, Option<[u8; 32]>)>,
}

impl PairPathBinding {
    fn capture(root: &Path, paths: &[&str]) -> GitResult<Self> {
        let paths = paths
            .iter()
            .map(|path| {
                let absolute = root.join(path);
                let identity = match Handle::from_path(&absolute) {
                    Ok(identity) => Some(identity),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                    Err(_) => {
                        return Err(GitError::new(
                            "git_pair_unavailable",
                            "A selected workflow path could not be identified.",
                        ))
                    }
                };
                let digest = if identity.is_some() {
                    let bytes = read_bounded_file(
                        &absolute,
                        16 * 1024 * 1024,
                        "git_pair_unavailable",
                        "A selected workflow path could not be read.",
                        "git_pair_too_large",
                        "A selected workflow path exceeds the 16 MiB Git safety limit.",
                    )?;
                    Some(Sha256::digest(bytes).into())
                } else {
                    None
                };
                Ok((absolute, identity, digest))
            })
            .collect::<GitResult<Vec<_>>>()?;
        Ok(Self { paths })
    }

    pub(crate) fn verify(&self) -> GitResult<()> {
        for (path, expected, expected_digest) in &self.paths {
            let current = Handle::from_path(path).ok();
            if current.as_ref() != expected.as_ref() {
                return Err(GitError::new(
                    "git_pair_changed",
                    "A selected workflow path was replaced before Git could mutate it.",
                ));
            }
            let current_digest = if current.is_some() {
                let bytes = read_bounded_file(
                    path,
                    16 * 1024 * 1024,
                    "git_pair_changed",
                    "A selected workflow path could not be read again.",
                    "git_pair_changed",
                    "A selected workflow path grew after its Git preview.",
                )?;
                Some(<[u8; 32]>::from(Sha256::digest(bytes)))
            } else {
                None
            };
            if &current_digest != expected_digest {
                return Err(GitError::new(
                    "git_pair_changed",
                    "A selected workflow path changed after its Git preview.",
                ));
            }
        }
        Ok(())
    }
}

fn read_bounded_file(
    path: &Path,
    limit: usize,
    read_code: &'static str,
    read_message: &'static str,
    large_code: &'static str,
    large_message: &'static str,
) -> GitResult<Vec<u8>> {
    let file = File::open(path).map_err(|_| GitError::new(read_code, read_message))?;
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| GitError::new(read_code, read_message))?;
    if bytes.len() > limit {
        return Err(GitError::new(large_code, large_message));
    }
    Ok(bytes)
}

fn require_identity(root: &Path) -> GitResult<()> {
    for key in ["user.name", "user.email"] {
        let output = run_read(root, ReadOperation::LocalConfig { key })?;
        if !output.success() || output_text(&output.stdout)?.trim().is_empty() {
            return Err(GitError::new(
                "git_identity_missing",
                "Configure a repository-local author name and email before creating a version.",
            ));
        }
    }
    Ok(())
}

fn required_value<'a>(
    value: &'a str,
    code: &'static str,
    message: &'static str,
) -> GitResult<&'a str> {
    let value = value.trim();
    if value.is_empty() || value.contains('\0') {
        Err(GitError::new(code, message))
    } else {
        Ok(value)
    }
}
