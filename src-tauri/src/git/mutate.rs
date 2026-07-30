use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use cap_std::ambient_authority;
use cap_std::fs::Dir;
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
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum GitVersionResult {
    Committed {
        oid: String,
        status: Option<GitStatus>,
        warnings: Vec<String>,
    },
    Unknown {
        #[serde(rename = "candidateOid")]
        candidate_oid: String,
        code: &'static str,
        message: String,
    },
}

impl GitVersionResult {
    pub fn committed_oid(&self) -> Option<&str> {
        match self {
            Self::Committed { oid, .. } => Some(oid),
            Self::Unknown { .. } => None,
        }
    }
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
    let metadata = detect_repository_metadata(root)?.ok_or_else(|| {
        GitError::new(
            "git_repository_unavailable",
            "Git metadata is no longer available.",
        )
    })?;
    let base = GitBase::capture(root)?;
    create_pair_version_with_guard(
        root,
        &metadata.worktree_dir,
        &base,
        definition_path,
        companion_path,
        message,
        || Ok(()),
    )
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

#[cfg(test)]
pub(crate) fn preview_pair_version_authorized(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
) -> GitResult<(String, PairPathBinding, GitBase)> {
    let paths = pair_paths(definition_path, companion_path)?;
    let base = GitBase::capture(root)?;
    let binding = PairPathBinding::capture(root, &paths)?;
    preview_pair_version_with_binding(root, &paths, binding, base)
}

pub(crate) fn preview_pair_version_authorized_with_binding(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
    binding: PairPathBinding,
    base: GitBase,
) -> GitResult<(String, PairPathBinding, GitBase)> {
    let paths = pair_paths(definition_path, companion_path)?;
    preview_pair_version_with_binding(root, &paths, binding, base)
}

fn preview_pair_version_with_binding(
    root: &Path,
    paths: &[&str],
    binding: PairPathBinding,
    base: GitBase,
) -> GitResult<(String, PairPathBinding, GitBase)> {
    let pair_status = run_read(root, ReadOperation::PairStatus { paths: &paths })?;
    ensure_success("git_status_failed", &pair_status)?;
    if pair_status.stdout.is_empty() {
        binding.verify()?;
        return Ok((String::new(), binding, base));
    }
    let diff_base = match &base {
        GitBase::Head { oid, .. } => oid.clone(),
        GitBase::Unborn { .. } => {
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
    for (index, path) in paths.iter().copied().enumerate() {
        if !is_tracked(root, path)? && binding.is_present(index) {
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
    Head { oid: String, reference: String },
    Unborn { reference: String },
}

impl GitBase {
    pub(crate) fn capture(root: &Path) -> GitResult<Self> {
        let reference = run_read(root, ReadOperation::HeadReference)?;
        let reference = if reference.success() {
            let value = output_text(&reference.stdout)?.trim().to_owned();
            if !value.starts_with("refs/") || value.contains('\0') {
                return Err(GitError::new(
                    "git_head_unavailable",
                    "Git returned an invalid HEAD reference.",
                ));
            }
            value
        } else {
            "HEAD".to_owned()
        };
        let head = run_read(root, ReadOperation::FullHead)?;
        if head.success() {
            let oid = output_text(&head.stdout)?.trim().to_owned();
            if !(7..=64).contains(&oid.len()) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(GitError::new(
                    "git_head_unavailable",
                    "Git returned an invalid HEAD object ID.",
                ));
            }
            Ok(Self::Head { oid, reference })
        } else {
            let branch = run_read(root, ReadOperation::Branch)?;
            if branch.success()
                && !output_text(&branch.stdout)?.trim().is_empty()
                && reference != "HEAD"
            {
                Ok(Self::Unborn { reference })
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

    fn reference(&self) -> &str {
        match self {
            Self::Head { reference, .. } | Self::Unborn { reference } => reference,
        }
    }

    pub(crate) fn parent(&self) -> Option<&str> {
        match self {
            Self::Head { oid, .. } => Some(oid),
            Self::Unborn { .. } => None,
        }
    }
}

pub(crate) fn create_pair_version_with_guard(
    root: &Path,
    git_dir: &Path,
    base: &GitBase,
    definition_path: &str,
    companion_path: Option<&str>,
    message: &str,
    before_mutation: impl FnMut() -> GitResult<()>,
) -> GitResult<GitVersionResult> {
    create_pair_version_with_interleave(
        root,
        git_dir,
        base,
        definition_path,
        companion_path,
        message,
        before_mutation,
        || Ok(()),
        || Ok(()),
        || Ok(()),
    )
}

#[cfg(test)]
pub(crate) fn create_pair_version_with_index_interleave_for_test(
    root: &Path,
    git_dir: &Path,
    base: &GitBase,
    definition_path: &str,
    companion_path: Option<&str>,
    message: &str,
    before_index_lock: impl FnOnce() -> GitResult<()>,
    after_index_lock: impl FnOnce() -> GitResult<()>,
) -> GitResult<GitVersionResult> {
    create_pair_version_with_interleave(
        root,
        git_dir,
        base,
        definition_path,
        companion_path,
        message,
        || Ok(()),
        || Ok(()),
        before_index_lock,
        after_index_lock,
    )
}

#[cfg(test)]
pub(crate) fn create_pair_version_with_stage_interleave_for_test(
    root: &Path,
    git_dir: &Path,
    base: &GitBase,
    definition_path: &str,
    companion_path: Option<&str>,
    message: &str,
    before_candidate_stage: impl FnOnce() -> GitResult<()>,
) -> GitResult<GitVersionResult> {
    create_pair_version_with_interleave(
        root,
        git_dir,
        base,
        definition_path,
        companion_path,
        message,
        || Ok(()),
        before_candidate_stage,
        || Ok(()),
        || Ok(()),
    )
}

fn create_pair_version_with_interleave(
    root: &Path,
    git_dir: &Path,
    base: &GitBase,
    definition_path: &str,
    companion_path: Option<&str>,
    message: &str,
    mut before_mutation: impl FnMut() -> GitResult<()>,
    before_candidate_stage: impl FnOnce() -> GitResult<()>,
    before_index_lock: impl FnOnce() -> GitResult<()>,
    after_index_lock: impl FnOnce() -> GitResult<()>,
) -> GitResult<GitVersionResult> {
    let message = required_value(message, "git_message_required", "Enter a version message.")?;
    if message.len() > 64 * 1024 {
        return Err(GitError::new(
            "git_message_too_large",
            "The version message exceeds the 64 KiB safety limit.",
        ));
    }
    let paths = pair_paths(definition_path, companion_path)?;
    let path_binding = PairPathBinding::capture(root, &paths)?;
    before_mutation()?;
    path_binding.verify()?;
    base.verify(root)?;
    require_identity(root)?;
    let pair_status = run_read(root, ReadOperation::PairStatus { paths: &paths })?;
    ensure_success("git_status_failed", &pair_status)?;
    if pair_status.stdout.is_empty() {
        return Err(GitError::new(
            "git_nothing_to_commit",
            "The selected workflow pair has no changes to version.",
        ));
    }

    let empty_tree = run_read(root, ReadOperation::EmptyTree)?;
    ensure_success("git_preview_failed", &empty_tree)?;
    let empty_tree = oid_text(&empty_tree.stdout, "git_preview_failed")?;
    let base_treeish = base.parent().unwrap_or(&empty_tree);
    let index_path = git_dir.join("index");
    let original_index = read_optional_bounded_file(
        &index_path,
        16 * 1024 * 1024,
        "git_index_unavailable",
        "The repository index could not be read.",
        "git_index_too_large",
        "The repository index exceeds the 16 MiB commit safety limit.",
    )?;
    let mut artifacts = TemporaryArtifacts::default();
    let candidate_index = artifacts.create(git_dir, "candidate-index")?;
    initialize_index(root, &candidate_index, base_treeish)?;
    before_candidate_stage()?;
    stage_exact_paths(root, &candidate_index, &paths)?;
    let accepted_tree = write_tree(root, &candidate_index)?;
    let accepted_entries = verify_tree_pair_entries(root, &accepted_tree, &paths, &path_binding)?;

    let normalized_index = artifacts.create(git_dir, "normalized-index")?;
    if let Some(bytes) = &original_index {
        write_private_file(&normalized_index, bytes)?;
    } else {
        initialize_index(root, &normalized_index, base_treeish)?;
    }
    stage_exact_paths(root, &normalized_index, &paths)?;

    let message_file = artifacts.create(git_dir, "message")?;
    let mut message_bytes = message.as_bytes().to_vec();
    message_bytes.push(b'\n');
    write_private_file(&message_file, &message_bytes)?;

    run_commit_hook(root, &candidate_index, "pre-commit", None, None)
        .map_err(with_hook_side_effect_warning)?;
    run_commit_hook(
        root,
        &candidate_index,
        "prepare-commit-msg",
        Some(&message_file),
        Some("message"),
    )
    .map_err(with_hook_side_effect_warning)?;
    run_commit_hook(
        root,
        &candidate_index,
        "commit-msg",
        Some(&message_file),
        None,
    )
    .map_err(with_hook_side_effect_warning)?;
    let _ = read_bounded_file(
        &message_file,
        64 * 1024,
        "git_commit_rejected",
        "A commit hook made the version message unavailable.",
        "git_commit_rejected",
        "A commit hook expanded the version message beyond 64 KiB.",
    )
    .map_err(with_hook_side_effect_warning)?;

    before_mutation().map_err(with_hook_side_effect_warning)?;
    path_binding
        .verify()
        .map_err(with_hook_side_effect_warning)?;
    base.verify(root).map_err(with_hook_side_effect_warning)?;
    let final_tree = write_tree(root, &candidate_index).map_err(with_hook_side_effect_warning)?;
    let final_entries =
        pair_tree_entries(root, &final_tree, &paths).map_err(with_hook_side_effect_warning)?;
    if final_tree != accepted_tree || final_entries != accepted_entries {
        return Err(GitError::new(
            "git_commit_candidate_changed",
            "A Git hook changed the accepted pair-only commit candidate. Git hook worktree side effects may remain.",
        ));
    }

    let commit = run_mutation_with_index(
        root,
        MutationOperation::CommitTree {
            tree: &accepted_tree,
            parent: base.parent(),
            message_file: &message_file,
        },
        &candidate_index,
    )
    .map_err(with_hook_side_effect_warning)?;
    ensure_success("git_commit_rejected", &commit).map_err(with_hook_side_effect_warning)?;
    let candidate_oid = oid_text(&commit.stdout, "git_commit_outcome_unknown")
        .map_err(with_hook_side_effect_warning)?;
    before_mutation().map_err(with_hook_side_effect_warning)?;
    path_binding
        .verify()
        .map_err(with_hook_side_effect_warning)?;
    base.verify(root).map_err(with_hook_side_effect_warning)?;

    let normalized_bytes = read_bounded_file(
        &normalized_index,
        16 * 1024 * 1024,
        "git_index_unavailable",
        "The normalized Git index could not be read.",
        "git_index_too_large",
        "The normalized Git index exceeds the 16 MiB safety limit.",
    )
    .map_err(with_hook_side_effect_warning)?;
    let normalized_tree =
        write_tree(root, &normalized_index).map_err(with_hook_side_effect_warning)?;
    let normalized_entries =
        pair_tree_entries(root, &normalized_tree, &paths).map_err(with_hook_side_effect_warning)?;
    if normalized_entries != accepted_entries {
        return Err(with_hook_side_effect_warning(GitError::new(
            "git_commit_candidate_changed",
            "The normalized Git index no longer contains the exact accepted pair entries.",
        )));
    }
    let prepared_index = PreparedIndexLock::prepare_with_interleave(
        &index_path,
        original_index.as_deref(),
        &normalized_bytes,
        before_index_lock,
        after_index_lock,
    )
    .map_err(with_hook_side_effect_warning)?;
    before_mutation().map_err(with_hook_side_effect_warning)?;
    path_binding
        .verify()
        .map_err(with_hook_side_effect_warning)?;
    base.verify(root).map_err(with_hook_side_effect_warning)?;

    let old_oid = base
        .parent()
        .map(str::to_owned)
        .unwrap_or_else(|| "0".repeat(candidate_oid.len()));
    let update = run_mutation(
        root,
        MutationOperation::UpdateRef {
            reference: base.reference(),
            new_oid: &candidate_oid,
            old_oid: &old_oid,
        },
    );
    let update_warning = match classify_ref_update(root, base, &candidate_oid, update)? {
        RefUpdateOutcome::Committed { warning } => warning,
        RefUpdateOutcome::NotCommitted(error) => return Err(error),
        RefUpdateOutcome::Unknown => {
            return Ok(GitVersionResult::Unknown {
                candidate_oid,
                code: "git_commit_outcome_unknown",
                message: "Git could not determine whether the local version ref advanced. Inspect the repository before retrying."
                    .to_owned(),
            })
        }
    };

    let mut warnings = Vec::new();
    if let Some(warning) = update_warning {
        warnings.push(warning);
    }
    if let Err(error) = prepared_index.publish() {
        warnings.push(bounded_warning(format!(
            "The version was committed, but the Git index could not be refreshed: {}",
            error.message
        )));
    }
    if let Some(warning) = post_commit_warning(run_mutation(
        root,
        MutationOperation::RunHook {
            name: "post-commit",
            message_file: None,
            source: None,
        },
    )) {
        warnings.push(warning);
    }
    if let Err(error) = before_mutation() {
        warnings.push(bounded_warning(format!(
            "The version was committed, but the workspace changed during refresh: {}",
            error.message
        )));
    }
    let (refreshed_status, status_warning) = committed_status(status(root));
    if let Some(warning) = status_warning {
        warnings.push(warning);
    }
    Ok(GitVersionResult::Committed {
        oid: candidate_oid,
        status: refreshed_status,
        warnings,
    })
}

pub(crate) fn post_commit_warning(
    result: GitResult<super::runner::CommandOutput>,
) -> Option<String> {
    match result {
        Ok(output) if output.success() => None,
        Ok(output) => Some(bounded_warning(format!(
            "The version was committed, but post-commit reported: {}",
            command_error("git_post_commit_failed", &output).message
        ))),
        Err(error) => Some(bounded_warning(format!(
            "The version was committed, but post-commit could not complete: {}",
            error.message
        ))),
    }
}

pub(crate) fn committed_status(
    result: GitResult<GitStatus>,
) -> (Option<GitStatus>, Option<String>) {
    match result {
        Ok(status) => (Some(status), None),
        Err(error) => (
            None,
            Some(bounded_warning(format!(
                "The version was committed, but Git status could not be refreshed: {}",
                error.message
            ))),
        ),
    }
}

fn initialize_index(root: &Path, index_path: &Path, tree: &str) -> GitResult<()> {
    let output = run_mutation_with_index(root, MutationOperation::ReadTree { tree }, index_path)?;
    ensure_success("git_index_unavailable", &output)
}

fn stage_exact_paths(root: &Path, index_path: &Path, paths: &[&str]) -> GitResult<()> {
    let output = run_mutation_with_index(root, MutationOperation::AddAll { paths }, index_path)?;
    ensure_success("git_stage_failed", &output)
}

fn write_tree(root: &Path, index_path: &Path) -> GitResult<String> {
    let output = run_mutation_with_index(root, MutationOperation::WriteTree, index_path)?;
    ensure_success("git_commit_candidate_changed", &output)?;
    oid_text(&output.stdout, "git_commit_candidate_changed")
}

fn verify_tree_pair_entries(
    root: &Path,
    tree: &str,
    paths: &[&str],
    binding: &PairPathBinding,
) -> GitResult<Vec<Option<GitTreeEntry>>> {
    let mut entries = Vec::with_capacity(paths.len());
    for path in paths {
        let entry = run_read(root, ReadOperation::TreeEntry { tree, path })?;
        ensure_success("git_commit_candidate_changed", &entry)?;
        let tree_entry = parse_tree_entry(&entry.stdout, path)?;
        match binding.state(entries.len())? {
            PairPathState::Regular { digest, .. } => {
                let Some(tree_entry) = tree_entry.as_ref() else {
                    return Err(GitError::new(
                        "git_commit_candidate_changed",
                        "The accepted workflow file is missing from the commit candidate.",
                    ));
                };
                if !matches!(tree_entry.mode.as_str(), "100644" | "100755") {
                    return Err(GitError::new(
                        "git_commit_candidate_changed",
                        "The accepted workflow file has an invalid Git mode.",
                    ));
                }
                let blob = run_read(
                    root,
                    ReadOperation::Blob {
                        oid: &tree_entry.oid,
                    },
                )?;
                ensure_success("git_commit_candidate_changed", &blob)?;
                if <[u8; 32]>::from(Sha256::digest(&blob.stdout)) != *digest {
                    return Err(GitError::new(
                        "git_commit_candidate_changed",
                        "Git attributes or filters changed the accepted workflow bytes.",
                    ));
                }
            }
            PairPathState::SafeSymlink { target_bytes, .. } => {
                let Some(tree_entry) = tree_entry.as_ref() else {
                    return Err(GitError::new(
                        "git_commit_candidate_changed",
                        "The accepted workflow link is missing from the commit candidate.",
                    ));
                };
                if tree_entry.mode != "120000" {
                    return Err(GitError::new(
                        "git_commit_candidate_changed",
                        "The accepted workflow link does not have Git symlink mode 120000.",
                    ));
                }
                let blob = run_read(
                    root,
                    ReadOperation::Blob {
                        oid: &tree_entry.oid,
                    },
                )?;
                ensure_success("git_commit_candidate_changed", &blob)?;
                if blob.stdout != *target_bytes {
                    return Err(GitError::new(
                        "git_commit_candidate_changed",
                        "The accepted workflow link target bytes differ from the commit candidate.",
                    ));
                }
            }
            PairPathState::Missing => {
                if tree_entry.is_some() {
                    return Err(GitError::new(
                        "git_commit_candidate_changed",
                        "The accepted workflow deletion was not preserved in the commit candidate.",
                    ));
                }
            }
        }
        entries.push(tree_entry);
    }
    Ok(entries)
}

fn pair_tree_entries(
    root: &Path,
    tree: &str,
    paths: &[&str],
) -> GitResult<Vec<Option<GitTreeEntry>>> {
    paths
        .iter()
        .map(|path| {
            let output = run_read(root, ReadOperation::TreeEntry { tree, path })?;
            ensure_success("git_commit_candidate_changed", &output)?;
            parse_tree_entry(&output.stdout, path)
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GitTreeEntry {
    pub(crate) mode: String,
    pub(crate) oid: String,
    path: String,
}

pub(crate) fn parse_tree_entry(
    bytes: &[u8],
    expected_path: &str,
) -> GitResult<Option<GitTreeEntry>> {
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes.last() != Some(&0) || bytes[..bytes.len() - 1].contains(&0) {
        return Err(GitError::new(
            "git_commit_candidate_changed",
            "Git returned a malformed tree entry for the selected workflow pair.",
        ));
    }
    let record = &bytes[..bytes.len() - 1];
    let header_end = record
        .iter()
        .position(|byte| *byte == b'\t')
        .ok_or_else(|| {
            GitError::new(
                "git_commit_candidate_changed",
                "Git returned an invalid tree entry for the selected workflow pair.",
            )
        })?;
    let header = std::str::from_utf8(&record[..header_end]).map_err(|_| {
        GitError::new(
            "git_commit_candidate_changed",
            "Git returned a non-UTF-8 tree entry header.",
        )
    })?;
    let fields = header.split_whitespace().collect::<Vec<_>>();
    if fields.len() != 3
        || !matches!(fields[0], "100644" | "100755" | "120000")
        || fields[1] != "blob"
    {
        return Err(GitError::new(
            "git_commit_candidate_changed",
            "Git returned an unsupported workflow tree entry mode or type.",
        ));
    }
    let oid = fields[2];
    if record[header_end + 1..] != *expected_path.as_bytes() {
        return Err(GitError::new(
            "git_commit_candidate_changed",
            "Git returned a tree entry for a different workflow path.",
        ));
    }
    if !((7..=64).contains(&oid.len()) && oid.bytes().all(|byte| byte.is_ascii_hexdigit())) {
        return Err(GitError::new(
            "git_commit_candidate_changed",
            "Git returned an invalid workflow blob ID.",
        ));
    }
    let path = std::str::from_utf8(&record[header_end + 1..]).map_err(|_| {
        GitError::new(
            "git_commit_candidate_changed",
            "Git returned a non-UTF-8 workflow path.",
        )
    })?;
    Ok(Some(GitTreeEntry {
        mode: fields[0].to_owned(),
        oid: oid.to_owned(),
        path: path.to_owned(),
    }))
}

fn run_commit_hook(
    root: &Path,
    index_path: &Path,
    name: &str,
    message_file: Option<&Path>,
    source: Option<&str>,
) -> GitResult<()> {
    let output = run_mutation_with_index(
        root,
        MutationOperation::RunHook {
            name,
            message_file,
            source,
        },
        index_path,
    )?;
    if output.success() {
        Ok(())
    } else {
        Err(command_error("git_commit_rejected", &output))
    }
}

fn with_hook_side_effect_warning(mut error: GitError) -> GitError {
    const ADVISORY: &str = " Git hook worktree side effects may remain.";
    if !error.message.contains("worktree side effects may remain") {
        error.message = bounded_warning(format!("{}{}", error.message, ADVISORY));
    }
    error
}

fn oid_text(bytes: &[u8], code: &'static str) -> GitResult<String> {
    let oid = output_text(bytes)?.trim().to_owned();
    if (7..=64).contains(&oid.len()) && oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(oid)
    } else {
        Err(GitError::new(code, "Git returned an invalid object ID."))
    }
}

#[derive(Default)]
struct TemporaryArtifacts {
    paths: Vec<PathBuf>,
}

impl TemporaryArtifacts {
    fn create(&mut self, git_dir: &Path, kind: &str) -> GitResult<PathBuf> {
        for _ in 0..16 {
            let path = git_dir.join(format!(
                "workflow-studio-{kind}-{}-{}",
                std::process::id(),
                NEXT_TEMP_INDEX.fetch_add(1, Ordering::Relaxed)
            ));
            let mut options = OpenOptions::new();
            options.read(true).write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&path) {
                Ok(file) => {
                    file.sync_all().map_err(|_| {
                        GitError::new(
                            "git_temporary_file_unavailable",
                            "A private Git temporary file could not be synchronized.",
                        )
                    })?;
                    self.paths.push(path.clone());
                    return Ok(path);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(GitError::new(
                        "git_temporary_file_unavailable",
                        "A private Git temporary file could not be created.",
                    ))
                }
            }
        }
        Err(GitError::new(
            "git_temporary_file_unavailable",
            "A unique private Git temporary file could not be allocated.",
        ))
    }
}

impl Drop for TemporaryArtifacts {
    fn drop(&mut self) {
        for path in &self.paths {
            let _ = fs::remove_file(path);
            let mut lock = path.as_os_str().to_os_string();
            lock.push(".lock");
            let _ = fs::remove_file(PathBuf::from(lock));
        }
    }
}

fn write_private_file(path: &Path, bytes: &[u8]) -> GitResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|_| {
            GitError::new(
                "git_temporary_file_unavailable",
                "A private Git temporary file could not be opened.",
            )
        })?;
    file.write_all(bytes).map_err(|_| {
        GitError::new(
            "git_temporary_file_unavailable",
            "A private Git temporary file could not be written.",
        )
    })?;
    file.sync_all().map_err(|_| {
        GitError::new(
            "git_temporary_file_unavailable",
            "A private Git temporary file could not be synchronized.",
        )
    })
}

pub(crate) struct PreparedIndexLock {
    lock_path: PathBuf,
    index_path: PathBuf,
    published: bool,
}

impl PreparedIndexLock {
    pub(crate) fn prepare_with_interleave(
        index_path: &Path,
        original: Option<&[u8]>,
        updated: &[u8],
        before_lock: impl FnOnce() -> GitResult<()>,
        after_lock: impl FnOnce() -> GitResult<()>,
    ) -> GitResult<Self> {
        before_lock()?;
        let lock_path = index_path.with_extension("lock");
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut lock = options
            .open(&lock_path)
            .map_err(|_| GitError::new("git_index_changed", "The repository index is busy."))?;
        let prepared = Self {
            lock_path,
            index_path: index_path.to_owned(),
            published: false,
        };
        after_lock()?;
        let current = read_optional_bounded_file(
            index_path,
            16 * 1024 * 1024,
            "git_index_unavailable",
            "The repository index could not be read again.",
            "git_index_changed",
            "The repository index changed during version creation.",
        )?;
        if current.as_deref() != original {
            return Err(GitError::new(
                "git_index_changed",
                "The repository index changed during version creation.",
            ));
        }
        if let Err(error) = lock.write_all(updated).and_then(|_| lock.sync_all()) {
            drop(lock);
            return Err(GitError::new(
                "git_index_unavailable",
                format!("The updated Git index could not be prepared: {error}"),
            ));
        }
        drop(lock);
        Ok(prepared)
    }

    fn publish(mut self) -> GitResult<()> {
        fs::rename(&self.lock_path, &self.index_path).map_err(|_| {
            GitError::new(
                "git_index_unavailable",
                "The updated Git index could not be published.",
            )
        })?;
        self.published = true;
        Ok(())
    }
}

impl Drop for PreparedIndexLock {
    fn drop(&mut self) {
        if !self.published {
            let _ = fs::remove_file(&self.lock_path);
        }
    }
}

pub(crate) enum RefUpdateOutcome {
    Committed { warning: Option<String> },
    NotCommitted(GitError),
    Unknown,
}

pub(crate) fn classify_ref_update(
    root: &Path,
    base: &GitBase,
    candidate_oid: &str,
    update: GitResult<super::runner::CommandOutput>,
) -> GitResult<RefUpdateOutcome> {
    match update {
        Ok(output) if output.success() => return Ok(RefUpdateOutcome::Committed { warning: None }),
        update => {
            let update_error = match update {
                Ok(output) => command_error("git_ref_update_failed", &output),
                Err(error) => error,
            };
            let current = run_read(
                root,
                ReadOperation::ResolveRef {
                    reference: base.reference(),
                },
            );
            let current = match current {
                Ok(output) if output.success() => {
                    match oid_text(&output.stdout, "git_commit_outcome_unknown") {
                        Ok(oid) => Some(oid),
                        Err(_) => return Ok(RefUpdateOutcome::Unknown),
                    }
                }
                Ok(_) => None,
                Err(_) => return Ok(RefUpdateOutcome::Unknown),
            };
            if current.as_deref() == Some(candidate_oid) {
                return Ok(RefUpdateOutcome::Committed {
                    warning: Some(bounded_warning(format!(
                        "The version was committed, but Git reported an uncertain ref update: {}",
                        update_error.message
                    ))),
                });
            }
            let still_base = match base {
                GitBase::Head { oid, .. } => current.as_deref() == Some(oid),
                GitBase::Unborn { .. } => current.is_none(),
            };
            if still_base {
                Ok(RefUpdateOutcome::NotCommitted(update_error))
            } else {
                Ok(RefUpdateOutcome::Unknown)
            }
        }
    }
}

fn bounded_warning(message: String) -> String {
    const LIMIT: usize = 4096;
    if message.len() <= LIMIT {
        return message;
    }
    let mut end = LIMIT;
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &message[..end])
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
    move_tracked_paths_with_interleave(root, git_dir, moves, |_| before_mutation(), |_| Ok(()))
}

#[cfg(test)]
pub(crate) fn move_tracked_paths_with_interleave_for_test(
    root: &Path,
    moves: &[(&str, &str)],
    before_mutation: impl FnMut(usize) -> GitResult<()>,
    after_move_attempt: impl FnMut(usize) -> GitResult<()>,
) -> GitResult<()> {
    let metadata = detect_repository_metadata(root)?.ok_or_else(|| {
        GitError::new(
            "git_repository_unavailable",
            "Git metadata is no longer available.",
        )
    })?;
    move_tracked_paths_with_interleave(
        root,
        &metadata.worktree_dir,
        moves,
        before_mutation,
        after_move_attempt,
    )
}

fn move_tracked_paths_with_interleave(
    root: &Path,
    git_dir: &Path,
    moves: &[(&str, &str)],
    mut before_mutation: impl FnMut(usize) -> GitResult<()>,
    mut after_move_attempt: impl FnMut(usize) -> GitResult<()>,
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

    let operation = (|| {
        for (index, (source, destination)) in moves.iter().enumerate() {
            before_mutation(index)?;
            bindings[index].verify_source_and_destination()?;
            let output = run_mutation_with_index(
                root,
                MutationOperation::Move {
                    source,
                    destination,
                },
                &temporary_index,
            )?;
            after_move_attempt(index)?;
            ensure_success("git_move_failed", &output)?;
            bindings[index].verify_destination()?;
        }
        before_mutation(moves.len())?;
        publish_temporary_index(&index_path, &temporary_index, &original_index, || {
            before_mutation(moves.len() + 1)
        })
    })();

    if let Err(error) = operation {
        let rollback = rollback_worktree_moves(&bindings);
        let _ = fs::remove_file(&temporary_index);
        if let Err(rollback_error) = rollback {
            return Err(rollback_error);
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

enum MoveLocation {
    Source,
    Destination,
    Ambiguous,
}

impl MovePathBinding {
    fn locate(&self) -> MoveLocation {
        let at_source = Handle::from_path(&self.source).ok().as_ref() == Some(&self.identity);
        let at_destination =
            Handle::from_path(&self.destination).ok().as_ref() == Some(&self.identity);
        match (
            at_source,
            at_destination,
            self.source.exists(),
            self.destination.exists(),
        ) {
            (true, false, true, false) => MoveLocation::Source,
            (false, true, false, true) => MoveLocation::Destination,
            _ => MoveLocation::Ambiguous,
        }
    }
}

fn rollback_worktree_moves(bindings: &[MovePathBinding]) -> GitResult<()> {
    let mut ambiguous = false;
    let mut failed = false;
    for binding in bindings.iter().rev() {
        match binding.locate() {
            MoveLocation::Source => {}
            MoveLocation::Destination => {
                if fs::rename(&binding.destination, &binding.source).is_err()
                    || Handle::from_path(&binding.source).ok().as_ref() != Some(&binding.identity)
                    || binding.destination.exists()
                {
                    failed = true;
                }
            }
            MoveLocation::Ambiguous => ambiguous = true,
        }
    }
    if failed {
        Err(GitError::new(
            "git_move_rollback_failed",
            "One or more moved workflow paths could not be restored.",
        ))
    } else if ambiguous {
        Err(GitError::new(
            "git_move_partial",
            "A workflow path was replaced or became ambiguous while the tracked rename was being rolled back.",
        ))
    } else {
        Ok(())
    }
}

pub(crate) fn move_tracked_path_with_guard(
    root: &Path,
    source: &str,
    destination: &str,
    before_mutation: impl FnMut() -> GitResult<()>,
) -> GitResult<()> {
    let metadata = detect_repository_metadata(root)?.ok_or_else(|| {
        GitError::new(
            "git_repository_unavailable",
            "Git metadata is no longer available.",
        )
    })?;
    move_tracked_paths_in_git_dir_with_guard(
        root,
        &metadata.worktree_dir,
        &[(source, destination)],
        before_mutation,
    )
}

pub(crate) struct PairPathBinding {
    repository_root: PathBuf,
    capability_root: PathBuf,
    capability_root_identity: Handle,
    capability: Dir,
    core_file_mode: Option<bool>,
    paths: Vec<(PathBuf, PairPathState)>,
}

#[derive(Debug, PartialEq, Eq)]
enum PairPathState {
    Missing,
    Regular {
        identity: Handle,
        digest: [u8; 32],
        #[cfg(unix)]
        executable: bool,
    },
    SafeSymlink {
        link_identity: LinkIdentity,
        target_bytes: Vec<u8>,
        resolved_target_identity: Handle,
    },
}

#[derive(Debug, PartialEq, Eq)]
struct LinkIdentity {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl PairPathBinding {
    pub(crate) fn capture(root: &Path, paths: &[&str]) -> GitResult<Self> {
        Self::capture_in_workspace(root, root, paths)
    }

    pub(crate) fn capture_in_workspace(
        repository_root: &Path,
        workspace_root: &Path,
        paths: &[&str],
    ) -> GitResult<Self> {
        let capability_root = workspace_root.canonicalize().map_err(|_| {
            GitError::new(
                "git_pair_unavailable",
                "The selected workspace root is no longer available.",
            )
        })?;
        let capability_root_identity = Handle::from_path(&capability_root).map_err(|_| {
            GitError::new(
                "git_pair_unavailable",
                "The selected workspace root could not be identified.",
            )
        })?;
        let capability =
            Dir::open_ambient_dir(&capability_root, ambient_authority()).map_err(|_| {
                GitError::new(
                    "git_pair_unavailable",
                    "The selected workspace capability could not be retained.",
                )
            })?;
        let core_file_mode = effective_core_file_mode(repository_root)?;
        let paths = paths
            .iter()
            .map(|path| {
                validate_path(path)?;
                let relative = PathBuf::from(path);
                let state = capture_pair_path(&capability, &relative)?;
                Ok((relative, state))
            })
            .collect::<GitResult<Vec<_>>>()?;
        Ok(Self {
            repository_root: repository_root.to_owned(),
            capability_root,
            capability_root_identity,
            capability,
            core_file_mode,
            paths,
        })
    }

    fn is_present(&self, index: usize) -> bool {
        self.paths
            .get(index)
            .is_some_and(|(_, state)| !matches!(state, PairPathState::Missing))
    }

    fn state(&self, index: usize) -> GitResult<&PairPathState> {
        self.paths
            .get(index)
            .map(|(_, state)| state)
            .ok_or_else(|| {
                GitError::new(
                    "git_commit_candidate_changed",
                    "The accepted pair binding no longer matches its Git paths.",
                )
            })
    }

    pub(crate) fn verify(&self) -> GitResult<()> {
        let canonical_root = self.capability_root.canonicalize().map_err(|_| {
            GitError::new(
                "git_pair_changed",
                "The retained workspace capability root is no longer available.",
            )
        })?;
        let current_root_identity = Handle::from_path(&canonical_root).map_err(|_| {
            GitError::new(
                "git_pair_changed",
                "The retained workspace capability root could not be identified again.",
            )
        })?;
        if canonical_root != self.capability_root
            || current_root_identity != self.capability_root_identity
        {
            return Err(GitError::new(
                "git_pair_changed",
                "The retained workspace capability root changed after the pair preview.",
            ));
        }
        if effective_core_file_mode(&self.repository_root).map_err(|_| {
            GitError::new(
                "git_pair_changed",
                "Git file-mode semantics could not be verified again.",
            )
        })? != self.core_file_mode
        {
            return Err(GitError::new(
                "git_pair_changed",
                "Git file-mode semantics changed after the pair preview.",
            ));
        }
        for (path, expected) in &self.paths {
            let current = capture_pair_path(&self.capability, path).map_err(|_| {
                GitError::new(
                    "git_pair_changed",
                    "A selected workflow path is no longer the exact safe file entry from its Git preview.",
                )
            })?;
            if &current != expected {
                return Err(GitError::new(
                    "git_pair_changed",
                    "A selected workflow path identity, type, mode, or content changed after its Git preview.",
                ));
            }
        }
        Ok(())
    }
}

fn effective_core_file_mode(root: &Path) -> GitResult<Option<bool>> {
    let output = run_read(
        root,
        ReadOperation::ConfigBool {
            key: "core.fileMode",
        },
    )?;
    if !output.success() {
        return Ok(None);
    }
    match output_text(&output.stdout)?.trim() {
        "true" => Ok(Some(true)),
        "false" => Ok(Some(false)),
        _ => Err(GitError::new(
            "git_output_invalid",
            "Git returned an invalid core.fileMode value.",
        )),
    }
}

fn capture_pair_path(directory: &Dir, relative: &Path) -> GitResult<PairPathState> {
    let metadata = match directory.symlink_metadata(relative) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PairPathState::Missing)
        }
        Err(_) => {
            return Err(GitError::new(
                "git_pair_unavailable",
                "A selected workflow path type or mode could not be inspected.",
            ))
        }
    };
    if metadata.file_type().is_symlink() {
        return capture_safe_symlink(directory, relative, &metadata);
    }
    if !metadata.file_type().is_file() {
        return Err(GitError::new(
            "git_pair_unavailable",
            "A selected workflow path is not a supported file entry.",
        ));
    }
    let mut file = directory.open(relative).map_err(|_| {
        GitError::new(
            "git_pair_unavailable",
            "A selected workflow file could not be opened safely.",
        )
    })?;
    let identity = Handle::from_file(
        file.try_clone()
            .map_err(|_| {
                GitError::new(
                    "git_pair_unavailable",
                    "A selected workflow file handle could not be retained.",
                )
            })?
            .into_std(),
    )
    .map_err(|_| {
        GitError::new(
            "git_pair_unavailable",
            "A selected workflow file could not be identified.",
        )
    })?;
    let rebound = directory.open(relative).ok().and_then(|file| {
        file.try_clone()
            .ok()
            .and_then(|clone| Handle::from_file(clone.into_std()).ok())
    });
    if rebound.as_ref() != Some(&identity) {
        return Err(GitError::new(
            "git_pair_unavailable",
            "A selected workflow file was replaced while it was being bound.",
        ));
    }
    let bytes = read_bounded(
        &mut file,
        16 * 1024 * 1024,
        "git_pair_unavailable",
        "A selected workflow file could not be read safely.",
        "git_pair_too_large",
        "A selected workflow file exceeds the 16 MiB Git safety limit.",
    )?;
    let file_metadata = file.metadata().map_err(|_| {
        GitError::new(
            "git_pair_unavailable",
            "A selected workflow file mode could not be read.",
        )
    })?;
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        Ok(PairPathState::Regular {
            identity,
            digest: Sha256::digest(bytes).into(),
            executable: file_metadata.mode() & 0o111 != 0,
        })
    }
    #[cfg(not(unix))]
    {
        Ok(PairPathState::Regular {
            identity,
            digest: Sha256::digest(bytes).into(),
        })
    }
}

fn capture_safe_symlink(
    directory: &Dir,
    relative: &Path,
    metadata: &cap_std::fs::Metadata,
) -> GitResult<PairPathState> {
    let expected_link_identity = link_identity(metadata);
    let target = directory.read_link_contents(relative).map_err(|_| {
        GitError::new(
            "git_pair_unavailable",
            "A selected workflow link target could not be read.",
        )
    })?;
    let target_bytes = path_bytes(&target)?;
    if target_bytes.len() > 16 * 1024 * 1024 {
        return Err(GitError::new(
            "git_pair_too_large",
            "A selected workflow link target exceeds the 16 MiB Git safety limit.",
        ));
    }
    let resolved_file = directory.open(relative).map_err(|_| {
        GitError::new(
            "git_pair_unavailable",
            "A selected workflow link is broken, escaping, or unavailable.",
        )
    })?;
    let resolved_metadata = resolved_file.metadata().map_err(|_| {
        GitError::new(
            "git_pair_unavailable",
            "A selected workflow link target could not be inspected.",
        )
    })?;
    if !resolved_metadata.is_file() {
        return Err(GitError::new(
            "git_pair_unavailable",
            "A selected workflow link must resolve to a contained workspace file.",
        ));
    }
    let resolved_target_identity = Handle::from_file(
        resolved_file
            .try_clone()
            .map_err(|_| {
                GitError::new(
                    "git_pair_unavailable",
                    "A selected workflow link target handle could not be retained.",
                )
            })?
            .into_std(),
    )
    .map_err(|_| {
        GitError::new(
            "git_pair_unavailable",
            "A selected workflow link target could not be identified.",
        )
    })?;
    let final_metadata = directory.symlink_metadata(relative).map_err(|_| {
        GitError::new(
            "git_pair_unavailable",
            "A selected workflow link changed while it was being bound.",
        )
    })?;
    if !final_metadata.file_type().is_symlink()
        || link_identity(&final_metadata) != expected_link_identity
        || directory.read_link_contents(relative).ok().as_ref() != Some(&target)
    {
        return Err(GitError::new(
            "git_pair_unavailable",
            "A selected workflow link changed while it was being bound.",
        ));
    }
    Ok(PairPathState::SafeSymlink {
        link_identity: expected_link_identity,
        target_bytes,
        resolved_target_identity,
    })
}

fn link_identity(metadata: &cap_std::fs::Metadata) -> LinkIdentity {
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        LinkIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        }
    }
    #[cfg(not(unix))]
    {
        LinkIdentity {}
    }
}

fn path_bytes(path: &Path) -> GitResult<Vec<u8>> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        Ok(path.as_os_str().as_bytes().to_vec())
    }
    #[cfg(not(unix))]
    {
        path.to_str()
            .map(|value| value.as_bytes().to_vec())
            .ok_or_else(|| {
                GitError::new(
                    "git_pair_unavailable",
                    "A selected workflow link target is not valid Unicode.",
                )
            })
    }
}

fn read_bounded(
    reader: &mut impl Read,
    limit: usize,
    read_code: &'static str,
    read_message: &'static str,
    large_code: &'static str,
    large_message: &'static str,
) -> GitResult<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| GitError::new(read_code, read_message))?;
    if bytes.len() > limit {
        return Err(GitError::new(large_code, large_message));
    }
    Ok(bytes)
}

fn read_bounded_file(
    path: &Path,
    limit: usize,
    read_code: &'static str,
    read_message: &'static str,
    large_code: &'static str,
    large_message: &'static str,
) -> GitResult<Vec<u8>> {
    let mut file = File::open(path).map_err(|_| GitError::new(read_code, read_message))?;
    read_bounded(
        &mut file,
        limit,
        read_code,
        read_message,
        large_code,
        large_message,
    )
}

fn read_optional_bounded_file(
    path: &Path,
    limit: usize,
    read_code: &'static str,
    read_message: &'static str,
    large_code: &'static str,
    large_message: &'static str,
) -> GitResult<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => read_bounded_file(
            path,
            limit,
            read_code,
            read_message,
            large_code,
            large_message,
        )
        .map(Some),
        Ok(_) => Err(GitError::new(read_code, read_message)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(GitError::new(read_code, read_message)),
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
