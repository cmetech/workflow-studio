mod parse;
mod runner;

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::State;

use parse::{parse_history, parse_status};
use runner::{run_read, ReadOperation};

#[derive(Debug, Serialize)]
pub struct GitError {
    pub code: &'static str,
    pub message: String,
}

impl GitError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

type GitResult<T> = Result<T, GitError>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepository {
    pub root: String,
    pub branch: Option<String>,
    pub detached_head: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPathStatus {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    pub index: String,
    pub worktree: String,
    pub untracked: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct GitStatus {
    pub entries: Vec<GitPathStatus>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct GitDiff {
    pub working: String,
    pub index: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub oid: String,
    pub short_oid: String,
    pub author_name: String,
    pub authored_at: String,
    pub subject: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitPairSnapshot {
    pub oid: String,
    pub definition: Option<String>,
    pub companion: Option<String>,
}

pub(crate) fn detect_repository(workspace_root: &Path) -> GitResult<Option<GitRepository>> {
    let root_output = run_read(workspace_root, ReadOperation::RepositoryRoot)?;
    if !root_output.success() {
        if root_output.stderr_text().contains("not a git repository") {
            return Ok(None);
        }
        return Err(command_error("git_detect_failed", &root_output));
    }
    let root_text = output_text(&root_output.stdout)?;
    let root = Path::new(root_text.trim()).canonicalize().map_err(|_| {
        GitError::new(
            "git_repository_unavailable",
            "The detected Git repository root is no longer available.",
        )
    })?;
    let branch_output = run_read(&root, ReadOperation::Branch)?;
    let (branch, detached_head) = if branch_output.success() {
        (
            Some(output_text(&branch_output.stdout)?.trim().to_owned()),
            None,
        )
    } else {
        let head = run_read(&root, ReadOperation::ShortHead)?;
        if !head.success() {
            return Err(command_error("git_head_unavailable", &head));
        }
        (None, Some(output_text(&head.stdout)?.trim().to_owned()))
    };
    Ok(Some(GitRepository {
        root: root.to_string_lossy().into_owned(),
        branch,
        detached_head,
    }))
}

pub(crate) fn status(root: &Path) -> GitResult<GitStatus> {
    let output = run_read(root, ReadOperation::Status)?;
    ensure_success("git_status_failed", &output)?;
    parse_status(&output.stdout)
}

pub(crate) fn diff_pair(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
) -> GitResult<GitDiff> {
    let paths = pair_paths(definition_path, companion_path)?;
    let working = run_read(
        root,
        ReadOperation::Diff {
            cached: false,
            paths: &paths,
        },
    )?;
    ensure_success("git_diff_failed", &working)?;
    let index = run_read(
        root,
        ReadOperation::Diff {
            cached: true,
            paths: &paths,
        },
    )?;
    ensure_success("git_diff_failed", &index)?;
    Ok(GitDiff {
        working: output_text(&working.stdout)?,
        index: output_text(&index.stdout)?,
    })
}

pub(crate) fn history_pair(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
) -> GitResult<Vec<GitCommitSummary>> {
    let paths = pair_paths(definition_path, companion_path)?;
    let mut commits = Vec::<GitCommitSummary>::new();
    let mut seen = HashSet::<String>::new();
    let pair_output = run_read(
        root,
        ReadOperation::History {
            follow: false,
            paths: &paths,
        },
    )?;
    if !pair_output.success()
        && pair_output
            .stderr_text()
            .contains("does not have any commits yet")
    {
        return Ok(Vec::new());
    }
    ensure_success("git_history_failed", &pair_output)?;
    for commit in parse_history(&pair_output.stdout)? {
        if seen.insert(commit.oid.clone()) {
            commits.push(commit);
        }
    }
    for path in &paths {
        let followed = [*path];
        let output = run_read(
            root,
            ReadOperation::History {
                follow: true,
                paths: &followed,
            },
        )?;
        ensure_success("git_history_failed", &output)?;
        for commit in parse_history(&output.stdout)? {
            if seen.insert(commit.oid.clone()) {
                commits.push(commit);
            }
        }
    }
    commits.sort_by(|left, right| right.authored_at.cmp(&left.authored_at));
    Ok(commits)
}

pub(crate) fn show_pair(
    root: &Path,
    oid: &str,
    definition_path: &str,
    companion_path: Option<&str>,
) -> GitResult<GitPairSnapshot> {
    validate_oid(oid)?;
    validate_path(definition_path)?;
    if let Some(path) = companion_path {
        validate_path(path)?;
    }
    Ok(GitPairSnapshot {
        oid: oid.to_owned(),
        definition: show_path(root, oid, definition_path)?,
        companion: companion_path
            .map(|path| show_path(root, oid, path))
            .transpose()?
            .flatten(),
    })
}

fn show_path(root: &Path, oid: &str, path: &str) -> GitResult<Option<String>> {
    let output = run_read(root, ReadOperation::Show { oid, path })?;
    if output.success() {
        return output_text(&output.stdout).map(Some);
    }
    let stderr = output.stderr_text();
    if stderr.contains("does not exist in") || stderr.contains("exists on disk, but not in") {
        return Ok(None);
    }
    Err(command_error("git_show_failed", &output))
}

fn pair_paths<'a>(
    definition_path: &'a str,
    companion_path: Option<&'a str>,
) -> GitResult<Vec<&'a str>> {
    validate_path(definition_path)?;
    let mut paths = vec![definition_path];
    if let Some(path) = companion_path {
        validate_path(path)?;
        if path != definition_path {
            paths.push(path);
        }
    }
    Ok(paths)
}

fn validate_path(path: &str) -> GitResult<()> {
    if path.is_empty()
        || path.contains('\0')
        || Path::new(path).is_absolute()
        || Path::new(path).components().any(|component| {
            matches!(
                component,
                Component::ParentDir
                    | Component::RootDir
                    | Component::Prefix(_)
                    | Component::CurDir
            )
        })
    {
        return Err(GitError::new(
            "git_invalid_path",
            "Git pair paths must be exact relative workspace paths.",
        ));
    }
    Ok(())
}

fn validate_oid(oid: &str) -> GitResult<()> {
    if !(7..=64).contains(&oid.len()) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(GitError::new(
            "git_invalid_oid",
            "Git object IDs must contain 7 to 64 hexadecimal characters.",
        ));
    }
    Ok(())
}

fn output_text(bytes: &[u8]) -> GitResult<String> {
    String::from_utf8(bytes.to_vec()).map_err(|_| {
        GitError::new(
            "git_output_invalid",
            "Git returned text that could not be represented safely.",
        )
    })
}

fn ensure_success(code: &'static str, output: &runner::CommandOutput) -> GitResult<()> {
    if output.success() {
        Ok(())
    } else {
        Err(command_error(code, output))
    }
}

fn command_error(code: &'static str, output: &runner::CommandOutput) -> GitError {
    let detail = output.stderr_text();
    GitError::new(
        code,
        if detail.is_empty() {
            "The local Git command failed.".to_owned()
        } else {
            format!("The local Git command failed: {detail}")
        },
    )
}

fn active_workspace_root(
    state: &State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<PathBuf> {
    state
        .active_root_path()
        .map_err(|error| GitError::new(error.code, error.message))
}

fn authorized_repository_root(
    requested_root: &str,
    state: &State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<PathBuf> {
    let workspace_root = active_workspace_root(state)?;
    authorize_repository_root(Path::new(requested_root), &workspace_root)
}

pub(crate) fn authorize_repository_root(
    requested_root: &Path,
    workspace_root: &Path,
) -> GitResult<PathBuf> {
    let detected = detect_repository(&workspace_root)?.ok_or_else(|| {
        GitError::new(
            "git_not_repository",
            "The selected workspace is not inside a Git repository.",
        )
    })?;
    let requested = requested_root.canonicalize().map_err(|_| {
        GitError::new(
            "git_repository_unavailable",
            "The requested Git repository root is no longer available.",
        )
    })?;
    if requested != Path::new(&detected.root) {
        return Err(GitError::new(
            "git_repository_not_authorized",
            "The Git repository root does not match the selected workspace.",
        ));
    }
    Ok(requested)
}

#[tauri::command]
pub fn git_detect(
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<Option<GitRepository>> {
    detect_repository(&active_workspace_root(&state)?)
}

#[tauri::command]
pub fn git_status(
    root: String,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<GitStatus> {
    status(&authorized_repository_root(&root, &state)?)
}

#[tauri::command]
pub fn git_diff_pair(
    root: String,
    definition_path: String,
    companion_path: Option<String>,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<GitDiff> {
    diff_pair(
        &authorized_repository_root(&root, &state)?,
        &definition_path,
        companion_path.as_deref(),
    )
}

#[tauri::command]
pub fn git_history_pair(
    root: String,
    definition_path: String,
    companion_path: Option<String>,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<Vec<GitCommitSummary>> {
    history_pair(
        &authorized_repository_root(&root, &state)?,
        &definition_path,
        companion_path.as_deref(),
    )
}

#[tauri::command]
pub fn git_show_pair(
    root: String,
    oid: String,
    definition_path: String,
    companion_path: Option<String>,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<GitPairSnapshot> {
    show_pair(
        &authorized_repository_root(&root, &state)?,
        &oid,
        &definition_path,
        companion_path.as_deref(),
    )
}

#[cfg(test)]
mod tests;
