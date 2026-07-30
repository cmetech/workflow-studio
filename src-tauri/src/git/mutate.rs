use std::path::{Path, PathBuf};

use same_file::Handle;
use serde::Serialize;

use super::runner::{run_mutation, run_read, MutationOperation, ReadOperation};
use super::{
    command_error, detect_repository, ensure_success, output_text, pair_paths, status,
    validate_path, GitError, GitRepository, GitResult, GitStatus,
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

struct PairPathBinding {
    paths: Vec<(PathBuf, Option<Handle>)>,
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
                Ok((absolute, identity))
            })
            .collect::<GitResult<Vec<_>>>()?;
        Ok(Self { paths })
    }

    fn verify(&self) -> GitResult<()> {
        for (path, expected) in &self.paths {
            let current = Handle::from_path(path).ok();
            if current.as_ref() != expected.as_ref() {
                return Err(GitError::new(
                    "git_pair_changed",
                    "A selected workflow path was replaced before Git could mutate it.",
                ));
            }
        }
        Ok(())
    }
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
