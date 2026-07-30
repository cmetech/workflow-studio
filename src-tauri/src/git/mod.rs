mod mutate;
mod parse;
mod runner;

pub use mutate::{
    create_pair_version, init_repository, is_tracked, move_tracked_path, move_tracked_paths,
    set_local_identity, GitVersionResult,
};
use mutate::{
    create_pair_version_with_guard, init_repository_with_guard, move_tracked_path_with_guard,
    preview_pair_version_authorized_with_binding, set_local_identity_with_guard,
};

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use same_file::Handle;
use serde::{Deserialize, Serialize};
use tauri::State;

use parse::{parse_history_records, parse_status, HistoryRecord};
use runner::{run_read, ReadOperation};

#[derive(Debug, Serialize)]
pub struct GitError {
    pub code: &'static str,
    pub message: String,
}

impl GitError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GitRepositoryMetadata {
    pub(crate) worktree_dir: PathBuf,
    pub(crate) common_dir: PathBuf,
    pub(crate) worktree_identity: Arc<Handle>,
    pub(crate) common_identity: Arc<Handle>,
}

#[derive(Clone, Debug)]
struct GitMetadataBinding {
    metadata: GitRepositoryMetadata,
    indirection: Option<GitIndirectionBinding>,
}

#[derive(Clone, Debug)]
struct GitIndirectionBinding {
    path: PathBuf,
    identity: Arc<Handle>,
    content: Vec<u8>,
}

impl GitMetadataBinding {
    fn capture(repository_root: &Path, probe_root: &Path) -> GitResult<Self> {
        let metadata = detect_repository_metadata(probe_root)?.ok_or_else(|| {
            GitError::new(
                "git_repository_unavailable",
                "Git metadata is no longer available.",
            )
        })?;
        let indirection_path = repository_root.join(".git");
        let indirection = match fs::symlink_metadata(&indirection_path) {
            Ok(metadata) if metadata.file_type().is_file() => {
                let content = read_git_indirection(&indirection_path)?;
                Some(GitIndirectionBinding {
                    path: indirection_path,
                    identity: Arc::new(Handle::from_path(repository_root.join(".git")).map_err(
                        |_| {
                            GitError::new(
                                "git_repository_unavailable",
                                "The linked-worktree Git indirection could not be identified.",
                            )
                        },
                    )?),
                    content,
                })
            }
            Ok(metadata) if metadata.file_type().is_dir() => None,
            Ok(_) => {
                return Err(GitError::new(
                    "git_repository_unavailable",
                    "The repository Git metadata entry has an unsupported type.",
                ))
            }
            Err(_) => {
                return Err(GitError::new(
                    "git_repository_unavailable",
                    "The repository Git metadata entry is unavailable.",
                ))
            }
        };
        Ok(Self {
            metadata,
            indirection,
        })
    }

    fn verify(&self, probe_root: &Path) -> GitResult<()> {
        if Handle::from_path(&self.metadata.worktree_dir).ok().as_ref()
            != Some(self.metadata.worktree_identity.as_ref())
            || Handle::from_path(&self.metadata.common_dir).ok().as_ref()
                != Some(self.metadata.common_identity.as_ref())
        {
            return Err(GitError::new(
                "git_repository_changed",
                "Git metadata was replaced while the operation was running.",
            ));
        }
        if let Some(indirection) = &self.indirection {
            if Handle::from_path(&indirection.path).ok().as_ref()
                != Some(indirection.identity.as_ref())
                || read_git_indirection(&indirection.path).ok().as_deref()
                    != Some(indirection.content.as_slice())
            {
                return Err(GitError::new(
                    "git_repository_changed",
                    "The linked-worktree Git indirection changed while the operation was running.",
                ));
            }
        }
        let current = detect_repository_metadata(probe_root)?.ok_or_else(|| {
            GitError::new(
                "git_repository_changed",
                "Git metadata is no longer available.",
            )
        })?;
        if current.worktree_dir != self.metadata.worktree_dir
            || current.common_dir != self.metadata.common_dir
            || current.worktree_identity.as_ref() != self.metadata.worktree_identity.as_ref()
            || current.common_identity.as_ref() != self.metadata.common_identity.as_ref()
        {
            return Err(GitError::new(
                "git_repository_changed",
                "Git metadata changed while the operation was running.",
            ));
        }
        Ok(())
    }
}

fn read_git_indirection(path: &Path) -> GitResult<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).map_err(|_| {
        GitError::new(
            "git_repository_unavailable",
            "The linked-worktree Git indirection could not be read.",
        )
    })?;
    if !metadata.file_type().is_file() || metadata.len() > 4096 {
        return Err(GitError::new(
            "git_repository_unavailable",
            "The linked-worktree Git indirection exceeds its safety limit.",
        ));
    }
    let file = File::open(path).map_err(|_| {
        GitError::new(
            "git_repository_unavailable",
            "The linked-worktree Git indirection could not be read.",
        )
    })?;
    let mut content = Vec::new();
    file.take(4097).read_to_end(&mut content).map_err(|_| {
        GitError::new(
            "git_repository_unavailable",
            "The linked-worktree Git indirection could not be read.",
        )
    })?;
    if content.len() > 4096 {
        return Err(GitError::new(
            "git_repository_unavailable",
            "The linked-worktree Git indirection exceeds its safety limit.",
        ));
    }
    Ok(content)
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
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub working: String,
    pub index: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_token: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub oid: String,
    pub short_oid: String,
    pub author_name: String,
    pub authored_at: String,
    pub subject: String,
    #[serde(skip)]
    pub(crate) authored_epoch: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryResult {
    pub commits: Vec<GitCommitSummary>,
    pub authorization_token: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitPairSnapshot {
    pub oid: String,
    pub definition: Option<String>,
    pub companion: Option<String>,
}

#[derive(Default)]
struct HistoryAuthorizationState {
    active_controller_epoch: Option<u64>,
    latest_controller_epoch: u64,
    latest_request_generation: u64,
    pending: VecDeque<TokenAuthorization>,
    retained: VecDeque<TokenAuthorization>,
}

#[derive(Default)]
struct VersionAuthorizationState {
    active_controller_epoch: Option<u64>,
    latest_controller_epoch: u64,
    latest_request_generation: u64,
    pending: VecDeque<VersionTokenAuthorization>,
    retained: VecDeque<VersionTokenAuthorization>,
}

#[derive(Default)]
pub struct GitState {
    history: Mutex<HistoryAuthorizationState>,
    version: Mutex<VersionAuthorizationState>,
    context_generation: AtomicU64,
    next_controller_epoch: AtomicU64,
}

const HISTORY_AUTHORIZATION_LIMIT: usize = 16;

impl GitState {
    pub(crate) fn clear(&self) {
        self.context_generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut history) = self.history.lock() {
            history.pending.clear();
            history.retained.clear();
        }
        if let Ok(mut version) = self.version.lock() {
            version.active_controller_epoch = None;
            version.latest_request_generation = 0;
            version.pending.clear();
            version.retained.clear();
        }
    }

    fn begin_version(
        &self,
        controller_epoch: u64,
        request_generation: u64,
    ) -> GitResult<VersionRequest> {
        let mut version = self.version.lock().map_err(|_| state_error())?;
        if version.active_controller_epoch != Some(controller_epoch)
            || request_generation <= version.latest_request_generation
        {
            return Err(context_changed(
                "The selected pair version preview request is no longer current.",
            ));
        }
        version.latest_request_generation = request_generation;
        version.pending.clear();
        version.retained.clear();
        Ok(VersionRequest {
            controller_epoch,
            request_generation,
            context_generation: self.context_generation.load(Ordering::SeqCst),
        })
    }

    fn issue_version(
        &self,
        request: VersionRequest,
        authorization: VersionAuthorization,
    ) -> GitResult<String> {
        let token = history_token()?;
        let mut version = self.version.lock().map_err(|_| state_error())?;
        if !self.version_request_is_current(&version, request) {
            return Err(context_changed(
                "A newer pair version preview completed first.",
            ));
        }
        version.pending.push_back(VersionTokenAuthorization {
            token: token.clone(),
            request,
            authorization,
        });
        while version.pending.len() > HISTORY_AUTHORIZATION_LIMIT {
            version.pending.pop_front();
        }
        Ok(token)
    }

    fn retain_version(
        &self,
        controller_epoch: u64,
        request_generation: u64,
        token: &str,
    ) -> GitResult<()> {
        let mut version = self.version.lock().map_err(|_| state_error())?;
        if version.active_controller_epoch != Some(controller_epoch)
            || version.latest_request_generation != request_generation
        {
            return Err(context_changed(
                "The selected pair version preview is no longer current.",
            ));
        }
        let position = version
            .pending
            .iter()
            .position(|entry| {
                entry.token == token
                    && entry.request.controller_epoch == controller_epoch
                    && entry.request.request_generation == request_generation
            })
            .ok_or_else(pair_not_authorized)?;
        let entry = version
            .pending
            .remove(position)
            .expect("pending version token exists");
        if !self.version_request_is_current(&version, entry.request) {
            return Err(context_changed(
                "The selected pair version preview is no longer current.",
            ));
        }
        version.retained.clear();
        version.retained.push_back(entry);
        Ok(())
    }

    fn revoke_version(&self, token: &str) -> GitResult<()> {
        let mut version = self.version.lock().map_err(|_| state_error())?;
        version.pending.retain(|entry| entry.token != token);
        version.retained.retain(|entry| entry.token != token);
        Ok(())
    }

    fn consume_version(
        &self,
        token: &str,
        context: &AuthorizedGitContext,
        definition_path: &str,
        companion_path: Option<&str>,
    ) -> GitResult<VersionAuthorization> {
        let mut version = self.version.lock().map_err(|_| state_error())?;
        let position = version
            .retained
            .iter()
            .position(|entry| {
                entry.token == token && self.version_request_is_current(&version, entry.request)
            })
            .ok_or_else(pair_not_authorized)?;
        let authorization = version
            .retained
            .remove(position)
            .expect("retained version token exists")
            .authorization;
        if !authorization.matches_context(context, definition_path, companion_path) {
            return Err(pair_not_authorized());
        }
        authorization.binding.verify()?;
        authorization.base.verify(&context.repository_root)?;
        Ok(authorization)
    }

    fn version_request_is_current(
        &self,
        version: &VersionAuthorizationState,
        request: VersionRequest,
    ) -> bool {
        version.active_controller_epoch == Some(request.controller_epoch)
            && version.latest_request_generation == request.request_generation
            && self.context_generation.load(Ordering::SeqCst) == request.context_generation
    }

    fn begin_history_session(&self) -> GitResult<u64> {
        let epoch = self.next_controller_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        self.activate_history_session(epoch)?;
        Ok(epoch)
    }

    fn activate_history_session(&self, epoch: u64) -> GitResult<()> {
        let mut history = self.history.lock().map_err(|_| state_error())?;
        if epoch <= history.latest_controller_epoch {
            return Err(context_changed(
                "A newer Git history controller session is already active.",
            ));
        }
        history.latest_controller_epoch = epoch;
        history.active_controller_epoch = Some(epoch);
        history.latest_request_generation = 0;
        history.pending.clear();
        history.retained.clear();
        drop(history);
        let mut version = self.version.lock().map_err(|_| state_error())?;
        if epoch <= version.latest_controller_epoch {
            return Err(context_changed(
                "A newer pair version preview controller session is already active.",
            ));
        }
        version.latest_controller_epoch = epoch;
        version.active_controller_epoch = Some(epoch);
        version.latest_request_generation = 0;
        version.pending.clear();
        version.retained.clear();
        Ok(())
    }

    fn begin_history(
        &self,
        controller_epoch: u64,
        request_generation: u64,
    ) -> GitResult<HistoryRequest> {
        let mut history = self.history.lock().map_err(|_| state_error())?;
        if history.active_controller_epoch != Some(controller_epoch)
            || request_generation <= history.latest_request_generation
        {
            return Err(context_changed(
                "The selected Git history request is no longer current.",
            ));
        }
        history.latest_request_generation = request_generation;
        history.pending.clear();
        history.retained.clear();
        Ok(HistoryRequest {
            controller_epoch,
            request_generation,
            context_generation: self.context_generation.load(Ordering::SeqCst),
        })
    }

    fn issue_history(
        &self,
        request: HistoryRequest,
        authorization: HistoryAuthorization,
    ) -> GitResult<String> {
        let mut history = self.history.lock().map_err(|_| state_error())?;
        if !self.request_is_current(&history, request) {
            return Err(context_changed(
                "The selected Git context changed before history finished loading.",
            ));
        }
        let token = loop {
            let candidate = history_token()?;
            if !history
                .pending
                .iter()
                .chain(history.retained.iter())
                .any(|entry| entry.token == candidate)
            {
                break candidate;
            }
        };
        history.pending.push_back(TokenAuthorization {
            token: token.clone(),
            request,
            authorization,
        });
        while history.pending.len() > HISTORY_AUTHORIZATION_LIMIT {
            history.pending.pop_front();
        }
        Ok(token)
    }

    fn retain_history(
        &self,
        controller_epoch: u64,
        request_generation: u64,
        token: &str,
    ) -> GitResult<()> {
        let mut history = self.history.lock().map_err(|_| state_error())?;
        if history.active_controller_epoch != Some(controller_epoch)
            || history.latest_request_generation != request_generation
        {
            history.pending.retain(|entry| {
                entry.token != token
                    || entry.request.controller_epoch != controller_epoch
                    || entry.request.request_generation != request_generation
            });
            return Err(context_changed(
                "The selected Git history request changed before authorization was retained.",
            ));
        }
        if let Some(position) = history.retained.iter().position(|entry| {
            entry.token == token
                && entry.request.controller_epoch == controller_epoch
                && entry.request.request_generation == request_generation
                && entry.request.context_generation
                    == self.context_generation.load(Ordering::SeqCst)
        }) {
            let entry = history
                .retained
                .remove(position)
                .expect("retained token exists");
            history.retained.push_back(entry);
            return Ok(());
        }
        let position = history
            .pending
            .iter()
            .position(|entry| {
                entry.token == token
                    && entry.request.controller_epoch == controller_epoch
                    && entry.request.request_generation == request_generation
            })
            .ok_or_else(pair_not_authorized)?;
        let entry = history
            .pending
            .remove(position)
            .expect("pending token exists");
        if !self.request_is_current(&history, entry.request) {
            return Err(context_changed(
                "The selected Git context changed before history was retained.",
            ));
        }
        history.retained.clear();
        history.retained.push_back(entry);
        while history.retained.len() > HISTORY_AUTHORIZATION_LIMIT {
            history.retained.pop_front();
        }
        Ok(())
    }

    fn revoke_history(&self, token: &str) -> GitResult<()> {
        let mut history = self.history.lock().map_err(|_| state_error())?;
        history.pending.retain(|entry| entry.token != token);
        history.retained.retain(|entry| entry.token != token);
        Ok(())
    }

    fn dispose_history_session(&self, controller_epoch: u64) -> GitResult<()> {
        let mut history = self.history.lock().map_err(|_| state_error())?;
        if history.active_controller_epoch == Some(controller_epoch) {
            history.active_controller_epoch = None;
            history.latest_request_generation = 0;
            history.pending.clear();
            history.retained.clear();
        }
        drop(history);
        let mut version = self.version.lock().map_err(|_| state_error())?;
        if version.active_controller_epoch == Some(controller_epoch) {
            version.active_controller_epoch = None;
            version.latest_request_generation = 0;
            version.pending.clear();
            version.retained.clear();
        }
        Ok(())
    }

    fn authorized_history(
        &self,
        token: &str,
        context: &AuthorizedGitContext,
        definition_path: &str,
        companion_path: Option<&str>,
    ) -> GitResult<HistoryAuthorization> {
        let history = self.history.lock().map_err(|_| state_error())?;
        history
            .retained
            .iter()
            .rev()
            .find(|entry| {
                entry.token == token
                    && self.request_is_current(&history, entry.request)
                    && entry
                        .authorization
                        .matches_context(context, definition_path, companion_path)
            })
            .map(|entry| entry.authorization.clone())
            .ok_or_else(pair_not_authorized)
    }

    fn request_is_current(
        &self,
        history: &HistoryAuthorizationState,
        request: HistoryRequest,
    ) -> bool {
        history.active_controller_epoch == Some(request.controller_epoch)
            && history.latest_request_generation == request.request_generation
            && self.context_generation.load(Ordering::SeqCst) == request.context_generation
    }
}

struct VersionAuthorization {
    workspace_root: PathBuf,
    workspace_identity: Arc<Handle>,
    repository_root: PathBuf,
    repository_identity: Arc<Handle>,
    definition_path: String,
    companion_path: Option<String>,
    binding: mutate::PairPathBinding,
    base: mutate::GitBase,
}

impl VersionAuthorization {
    fn from_preview(
        context: &AuthorizedGitContext,
        definition_path: String,
        companion_path: Option<String>,
        binding: mutate::PairPathBinding,
        base: mutate::GitBase,
    ) -> Self {
        Self {
            workspace_root: context.workspace_root.clone(),
            workspace_identity: context.workspace_identity.clone(),
            repository_root: context.repository_root.clone(),
            repository_identity: context.repository_identity.clone(),
            definition_path,
            companion_path,
            binding,
            base,
        }
    }

    fn matches_context(
        &self,
        context: &AuthorizedGitContext,
        definition_path: &str,
        companion_path: Option<&str>,
    ) -> bool {
        self.workspace_root == context.workspace_root
            && self.workspace_identity.as_ref() == context.workspace_identity.as_ref()
            && self.repository_root == context.repository_root
            && self.repository_identity.as_ref() == context.repository_identity.as_ref()
            && self.definition_path == definition_path
            && self.companion_path.as_deref() == companion_path
    }
}

#[derive(Clone, Copy)]
struct VersionRequest {
    controller_epoch: u64,
    request_generation: u64,
    context_generation: u64,
}

struct VersionTokenAuthorization {
    token: String,
    request: VersionRequest,
    authorization: VersionAuthorization,
}

#[derive(Clone, Copy)]
struct HistoryRequest {
    controller_epoch: u64,
    request_generation: u64,
    context_generation: u64,
}

#[derive(Clone)]
struct TokenAuthorization {
    token: String,
    request: HistoryRequest,
    authorization: HistoryAuthorization,
}

#[derive(Clone)]
struct HistoricalPaths {
    definition: Option<String>,
    companion: Option<String>,
}

#[derive(Clone)]
struct HistoryAuthorization {
    workspace_root: PathBuf,
    workspace_identity: Arc<Handle>,
    repository_root: PathBuf,
    repository_identity: Arc<Handle>,
    definition_path: String,
    companion_path: Option<String>,
    by_oid: HashMap<String, HistoricalPaths>,
}

impl HistoryAuthorization {
    fn matches_context(
        &self,
        context: &AuthorizedGitContext,
        definition_path: &str,
        companion_path: Option<&str>,
    ) -> bool {
        self.workspace_root == context.workspace_root
            && self.workspace_identity.as_ref() == context.workspace_identity.as_ref()
            && self.repository_root == context.repository_root
            && self.repository_identity.as_ref() == context.repository_identity.as_ref()
            && self.definition_path == definition_path
            && self.companion_path.as_deref() == companion_path
    }
}

pub(crate) struct AuthorizedGitContext {
    workspace_root: PathBuf,
    workspace_identity: Arc<Handle>,
    repository_root: PathBuf,
    repository_identity: Arc<Handle>,
    git_metadata: GitMetadataBinding,
    workspace_prefix: String,
    #[cfg(test)]
    history: Mutex<Option<HistoryAuthorization>>,
}

impl AuthorizedGitContext {
    pub(crate) fn bind(workspace_root: &Path, requested_root: &Path) -> GitResult<Self> {
        let workspace_root = workspace_root.canonicalize().map_err(|_| {
            GitError::new(
                "git_workspace_changed",
                "The selected workspace was replaced while Git was running.",
            )
        })?;
        let detected = detect_repository(&workspace_root)?.ok_or_else(|| {
            GitError::new(
                "git_not_repository",
                "The selected workspace is not inside a Git repository.",
            )
        })?;
        let repository_root = PathBuf::from(detected.root).canonicalize().map_err(|_| {
            GitError::new(
                "git_repository_unavailable",
                "The detected Git repository root is no longer available.",
            )
        })?;
        let requested = requested_root.canonicalize().map_err(|_| {
            GitError::new(
                "git_repository_unavailable",
                "The requested Git repository root is no longer available.",
            )
        })?;
        if requested != repository_root {
            return Err(GitError::new(
                "git_repository_not_authorized",
                "The Git repository root does not match the selected workspace.",
            ));
        }
        let workspace_prefix = workspace_root
            .strip_prefix(&repository_root)
            .map_err(|_| {
                GitError::new(
                    "git_workspace_outside_repository",
                    "The selected workspace is outside the detected Git repository.",
                )
            })
            .and_then(git_relative_path)?;
        let git_metadata = GitMetadataBinding::capture(&repository_root, &workspace_root)?;
        Ok(Self {
            workspace_identity: Arc::new(Handle::from_path(&workspace_root).map_err(|_| {
                GitError::new(
                    "git_workspace_changed",
                    "The selected workspace is no longer available.",
                )
            })?),
            repository_identity: Arc::new(Handle::from_path(&repository_root).map_err(|_| {
                GitError::new(
                    "git_repository_changed",
                    "The Git repository is no longer available.",
                )
            })?),
            git_metadata,
            workspace_root,
            repository_root,
            workspace_prefix,
            #[cfg(test)]
            history: Mutex::new(None),
        })
    }

    pub(crate) fn verify(&self) -> GitResult<()> {
        let repository = self.repository_root.canonicalize().ok();
        let repository_identity = Handle::from_path(&self.repository_root).ok();
        if repository.as_deref() != Some(self.repository_root.as_path())
            || repository_identity.as_ref() != Some(self.repository_identity.as_ref())
        {
            return Err(GitError::new(
                "git_repository_changed",
                "The Git repository was replaced while Git was running.",
            ));
        }
        let workspace = self.workspace_root.canonicalize().ok();
        let workspace_identity = Handle::from_path(&self.workspace_root).ok();
        if workspace.as_deref() != Some(self.workspace_root.as_path())
            || workspace_identity.as_ref() != Some(self.workspace_identity.as_ref())
        {
            return Err(GitError::new(
                "git_workspace_changed",
                "The selected workspace was replaced while Git was running.",
            ));
        }
        self.git_metadata.verify(&self.workspace_root)?;
        Ok(())
    }

    fn translate(&self, path: &str) -> GitResult<String> {
        validate_path(path)?;
        Ok(if self.workspace_prefix.is_empty() {
            path.to_owned()
        } else {
            format!("{}/{path}", self.workspace_prefix)
        })
    }

    pub(crate) fn status(&self) -> GitResult<GitStatus> {
        let raw = status(&self.repository_root)?;
        self.verify()?;
        Ok(GitStatus {
            entries: raw
                .entries
                .into_iter()
                .filter_map(|entry| rebase_status_entry(entry, &self.workspace_prefix))
                .collect(),
        })
    }

    #[cfg(test)]
    pub(crate) fn diff_pair(
        &self,
        definition_path: &str,
        companion_path: Option<&str>,
    ) -> GitResult<GitDiff> {
        let definition = self.translate(definition_path)?;
        let companion = companion_path
            .map(|path| self.translate(path))
            .transpose()?;
        let result = diff_pair(&self.repository_root, &definition, companion.as_deref())?;
        self.verify()?;
        Ok(result)
    }

    #[cfg(test)]
    pub(crate) fn history_pair(
        &self,
        definition_path: &str,
        companion_path: Option<&str>,
    ) -> GitResult<Vec<GitCommitSummary>> {
        let (commits, authorization) =
            self.history_pair_authorized(definition_path, companion_path)?;
        *self.history.lock().map_err(|_| state_error())? = Some(authorization);
        Ok(commits)
    }

    fn history_pair_authorized(
        &self,
        definition_path: &str,
        companion_path: Option<&str>,
    ) -> GitResult<(Vec<GitCommitSummary>, HistoryAuthorization)> {
        let definition = self.translate(definition_path)?;
        let companion = companion_path
            .map(|path| self.translate(path))
            .transpose()?;
        let (commits, by_oid) = history_pair_with_paths(
            &self.repository_root,
            &definition,
            companion.as_deref(),
            Some(&self.workspace_prefix),
        )?;
        self.verify()?;
        Ok((
            commits,
            HistoryAuthorization {
                workspace_root: self.workspace_root.clone(),
                workspace_identity: self.workspace_identity.clone(),
                repository_root: self.repository_root.clone(),
                repository_identity: self.repository_identity.clone(),
                definition_path: definition_path.to_owned(),
                companion_path: companion_path.map(str::to_owned),
                by_oid,
            },
        ))
    }

    #[cfg(test)]
    pub(crate) fn show_authorized_pair(
        &self,
        oid: &str,
        definition_path: &str,
        companion_path: Option<&str>,
    ) -> GitResult<GitPairSnapshot> {
        let history = self.history.lock().map_err(|_| state_error())?;
        let authorization = history.as_ref().ok_or_else(pair_not_authorized)?;
        show_from_authorization(self, authorization, oid, definition_path, companion_path)
    }
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

#[cfg(test)]
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
        authorization_token: None,
    })
}

#[cfg(test)]
pub(crate) fn history_pair(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
) -> GitResult<Vec<GitCommitSummary>> {
    Ok(history_pair_with_paths(root, definition_path, companion_path, None)?.0)
}

fn history_pair_with_paths(
    root: &Path,
    definition_path: &str,
    companion_path: Option<&str>,
    workspace_prefix: Option<&str>,
) -> GitResult<(Vec<GitCommitSummary>, HashMap<String, HistoricalPaths>)> {
    validate_path(definition_path)?;
    if let Some(path) = companion_path {
        validate_path(path)?;
    }
    let definition =
        restrict_history_to_workspace(history_trace(root, definition_path)?, workspace_prefix);
    let companion = companion_path
        .map(|path| history_trace(root, path))
        .transpose()?
        .map(|records| restrict_history_to_workspace(records, workspace_prefix));
    let definition_by_oid = definition
        .iter()
        .map(|record| (record.summary.oid.clone(), record.clone()))
        .collect::<HashMap<_, _>>();
    let companion_by_oid = companion
        .as_ref()
        .into_iter()
        .flatten()
        .map(|record| (record.summary.oid.clone(), record.clone()))
        .collect::<HashMap<_, _>>();
    let mut summaries = HashMap::new();
    for record in definition
        .iter()
        .chain(companion.as_ref().into_iter().flatten())
    {
        summaries
            .entry(record.summary.oid.clone())
            .or_insert_with(|| record.summary.clone());
    }
    let mut commits = summaries.into_values().collect::<Vec<_>>();
    commits.sort_by(|left, right| {
        right
            .authored_epoch
            .cmp(&left.authored_epoch)
            .then_with(|| left.oid.cmp(&right.oid))
    });

    let mut lineage = BTreeSet::new();
    lineage.insert(definition_path.to_owned());
    if let Some(path) = companion_path {
        lineage.insert(path.to_owned());
    }
    for record in definition
        .iter()
        .chain(companion.as_ref().into_iter().flatten())
    {
        lineage.extend(record.snapshot_path.iter().cloned());
        lineage.extend(record.prior_path.iter().cloned());
    }
    let lineage = lineage.into_iter().collect::<Vec<_>>();
    let lineage_refs = lineage.iter().map(String::as_str).collect::<Vec<_>>();
    let topology = history_records(root, false, &lineage_refs)?;
    let mut definition_cursor = Some(definition_path.to_owned());
    let mut companion_cursor = companion_path.map(str::to_owned);
    let mut by_oid = HashMap::new();
    for topological in topology {
        let definition_record = definition_by_oid.get(&topological.summary.oid);
        let companion_record = companion_by_oid.get(&topological.summary.oid);
        let definition_snapshot = definition_record
            .map(|record| record.snapshot_path.clone())
            .unwrap_or_else(|| definition_cursor.clone());
        let companion_snapshot = companion_record
            .map(|record| record.snapshot_path.clone())
            .unwrap_or_else(|| companion_cursor.clone());
        by_oid.insert(
            topological.summary.oid,
            HistoricalPaths {
                definition: definition_snapshot,
                companion: companion_snapshot,
            },
        );
        if let Some(record) = definition_record {
            definition_cursor = record.prior_path.clone();
        }
        if let Some(record) = companion_record {
            companion_cursor = record.prior_path.clone();
        }
    }
    Ok((commits, by_oid))
}

fn restrict_history_to_workspace(
    records: Vec<HistoryRecord>,
    workspace_prefix: Option<&str>,
) -> Vec<HistoryRecord> {
    let Some(prefix) = workspace_prefix.filter(|prefix| !prefix.is_empty()) else {
        return records;
    };
    let mut restricted = Vec::new();
    for mut record in records {
        if record
            .snapshot_path
            .as_deref()
            .is_some_and(|path| strip_git_prefix(path, prefix).is_none())
        {
            break;
        }
        let crosses_boundary = record
            .prior_path
            .as_deref()
            .is_some_and(|path| strip_git_prefix(path, prefix).is_none());
        if crosses_boundary {
            record.prior_path = None;
        }
        restricted.push(record);
        if crosses_boundary {
            break;
        }
    }
    restricted
}

fn history_trace(root: &Path, path: &str) -> GitResult<Vec<HistoryRecord>> {
    let followed = [path];
    history_records(root, true, &followed)
}

fn history_records(root: &Path, follow: bool, paths: &[&str]) -> GitResult<Vec<HistoryRecord>> {
    let output = run_read(root, ReadOperation::History { follow, paths })?;
    if !output.success()
        && output
            .stderr_text()
            .contains("does not have any commits yet")
    {
        return Ok(Vec::new());
    }
    ensure_success("git_history_failed", &output)?;
    parse_history_records(&output.stdout)
}

#[cfg(test)]
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

fn show_from_authorization(
    context: &AuthorizedGitContext,
    authorization: &HistoryAuthorization,
    oid: &str,
    definition_path: &str,
    companion_path: Option<&str>,
) -> GitResult<GitPairSnapshot> {
    validate_oid(oid)?;
    if authorization.workspace_root != context.workspace_root
        || authorization.repository_root != context.repository_root
        || authorization.definition_path != definition_path
        || authorization.companion_path.as_deref() != companion_path
    {
        return Err(pair_not_authorized());
    }
    let paths = authorization
        .by_oid
        .get(oid)
        .ok_or_else(pair_not_authorized)?;
    let snapshot = GitPairSnapshot {
        oid: oid.to_owned(),
        definition: paths
            .definition
            .as_deref()
            .map(|path| show_path(&context.repository_root, oid, path))
            .transpose()?
            .flatten(),
        companion: paths
            .companion
            .as_deref()
            .map(|path| show_path(&context.repository_root, oid, path))
            .transpose()?
            .flatten(),
    };
    context.verify()?;
    Ok(snapshot)
}

fn show_authorized_pair(
    state: &GitState,
    context: &AuthorizedGitContext,
    authorization_token: &str,
    oid: &str,
    definition_path: &str,
    companion_path: Option<&str>,
) -> GitResult<GitPairSnapshot> {
    let authorization = state.authorized_history(
        authorization_token,
        context,
        definition_path,
        companion_path,
    )?;
    show_from_authorization(
        context,
        &authorization,
        oid,
        definition_path,
        companion_path,
    )
}

fn pair_not_authorized() -> GitError {
    GitError::new(
        "git_pair_not_authorized",
        "The requested historical pair is not the currently authorized workflow pair.",
    )
}

fn state_error() -> GitError {
    GitError::new(
        "git_state_unavailable",
        "The local Git authorization state is temporarily unavailable.",
    )
}

fn context_changed(message: &'static str) -> GitError {
    GitError::new("git_context_changed", message)
}

fn history_token() -> GitResult<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| state_error())?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        token.push(HEX[(byte >> 4) as usize] as char);
        token.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(token)
}

fn git_relative_path(path: &Path) -> GitResult<String> {
    path.components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str().map(str::to_owned).ok_or_else(|| {
                GitError::new("git_invalid_path", "Git paths must be valid Unicode.")
            }),
            _ => Err(GitError::new(
                "git_invalid_path",
                "Git paths must be exact relative paths.",
            )),
        })
        .collect::<GitResult<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

fn rebase_status_entry(mut entry: GitPathStatus, prefix: &str) -> Option<GitPathStatus> {
    let path = strip_git_prefix(&entry.path, prefix)?.to_owned();
    entry.path = path;
    entry.original_path = entry
        .original_path
        .as_deref()
        .and_then(|original| strip_git_prefix(original, prefix))
        .map(str::to_owned);
    Some(entry)
}

fn strip_git_prefix<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    if prefix.is_empty() {
        return Some(path);
    }
    path.strip_prefix(prefix)?.strip_prefix('/')
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

fn active_workspace_binding(
    state: &State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<crate::workspace::WorkspaceBinding> {
    state
        .active_binding()
        .map_err(|error| GitError::new(error.code, error.message))
}

fn verify_workspace_binding(
    state: &State<'_, crate::workspace::WorkspaceState>,
    binding: &crate::workspace::WorkspaceBinding,
) -> GitResult<()> {
    match state.binding_is_current(binding) {
        Ok(true) => Ok(()),
        Ok(false) => Err(GitError::new(
            "git_workspace_changed",
            "The selected workspace changed while Git was running.",
        )),
        Err(error) => Err(GitError::new(error.code, error.message)),
    }
}

#[cfg(test)]
pub(crate) fn authorize_repository_root(
    requested_root: &Path,
    workspace_root: &Path,
) -> GitResult<PathBuf> {
    Ok(AuthorizedGitContext::bind(workspace_root, requested_root)?.repository_root)
}

pub(crate) fn detect_repository_metadata(
    workspace_root: &Path,
) -> GitResult<Option<GitRepositoryMetadata>> {
    if detect_repository(workspace_root)?.is_none() {
        return Ok(None);
    }
    let worktree_output = run_read(workspace_root, ReadOperation::GitDirectory)?;
    ensure_success("git_detect_failed", &worktree_output)?;
    let common_output = run_read(workspace_root, ReadOperation::GitCommonDirectory)?;
    ensure_success("git_detect_failed", &common_output)?;
    let canonical = |bytes: &[u8]| {
        PathBuf::from(output_text(bytes)?.trim())
            .canonicalize()
            .map_err(|_| {
                GitError::new(
                    "git_repository_unavailable",
                    "Git metadata is no longer available.",
                )
            })
    };
    let worktree_dir = canonical(&worktree_output.stdout)?;
    let common_dir = canonical(&common_output.stdout)?;
    let worktree_identity = Arc::new(Handle::from_path(&worktree_dir).map_err(|_| {
        GitError::new(
            "git_repository_unavailable",
            "Git worktree metadata is no longer available.",
        )
    })?);
    let common_identity = if worktree_dir == common_dir {
        Arc::clone(&worktree_identity)
    } else {
        Arc::new(Handle::from_path(&common_dir).map_err(|_| {
            GitError::new(
                "git_repository_unavailable",
                "Git common metadata is no longer available.",
            )
        })?)
    };
    Ok(Some(GitRepositoryMetadata {
        worktree_dir,
        common_dir,
        worktree_identity,
        common_identity,
    }))
}

#[tauri::command]
pub fn git_detect(
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<Option<GitRepository>> {
    let binding = active_workspace_binding(&state)?;
    let result = detect_repository(&binding.root)?;
    verify_workspace_binding(&state, &binding)?;
    Ok(result)
}

#[tauri::command]
pub fn git_status(
    root: String,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<GitStatus> {
    let binding = active_workspace_binding(&state)?;
    let result = AuthorizedGitContext::bind(&binding.root, Path::new(&root))?.status()?;
    verify_workspace_binding(&state, &binding)?;
    Ok(result)
}

#[tauri::command]
pub fn git_diff_pair(
    root: String,
    definition_path: String,
    companion_path: Option<String>,
    controller_epoch: u64,
    request_generation: u64,
    state: State<'_, crate::workspace::WorkspaceState>,
    git_state: State<'_, GitState>,
) -> GitResult<GitDiff> {
    let version_request = git_state.begin_version(controller_epoch, request_generation)?;
    let binding = active_workspace_binding(&state)?;
    let context = AuthorizedGitContext::bind(&binding.root, Path::new(&root))?;
    let definition = context.translate(&definition_path)?;
    let companion = companion_path
        .as_deref()
        .map(|path| context.translate(path))
        .transpose()?;
    let workspace_paths = pair_paths(&definition_path, companion_path.as_deref())?;
    let base = mutate::GitBase::capture(&context.repository_root)?;
    let pair_binding = mutate::PairPathBinding::capture_in_workspace(
        &context.repository_root,
        &context.workspace_root,
        &workspace_paths,
    )?;
    let (prospective, pair_binding, base) = preview_pair_version_authorized_with_binding(
        &context.repository_root,
        &definition,
        companion.as_deref(),
        pair_binding,
        base,
    )?;
    verify_workspace_binding(&state, &binding)?;
    context.verify()?;
    pair_binding.verify()?;
    let authorization_token = git_state.issue_version(
        version_request,
        VersionAuthorization::from_preview(&context, definition, companion, pair_binding, base),
    )?;
    Ok(GitDiff {
        working: prospective,
        index: String::new(),
        authorization_token: Some(authorization_token),
    })
}

#[tauri::command]
pub fn git_retain_version_authorization(
    authorization_token: String,
    controller_epoch: u64,
    request_generation: u64,
    git_state: State<'_, GitState>,
) -> GitResult<()> {
    git_state.retain_version(controller_epoch, request_generation, &authorization_token)
}

#[tauri::command]
pub fn git_revoke_version_authorization(
    authorization_token: String,
    git_state: State<'_, GitState>,
) -> GitResult<()> {
    git_state.revoke_version(&authorization_token)
}

#[tauri::command]
pub fn git_begin_history_session(git_state: State<'_, GitState>) -> GitResult<u64> {
    git_state.begin_history_session()
}

#[tauri::command]
pub fn git_history_pair(
    root: String,
    definition_path: String,
    companion_path: Option<String>,
    controller_epoch: u64,
    request_generation: u64,
    state: State<'_, crate::workspace::WorkspaceState>,
    git_state: State<'_, GitState>,
) -> GitResult<GitHistoryResult> {
    let history_request = git_state.begin_history(controller_epoch, request_generation)?;
    let binding = active_workspace_binding(&state)?;
    let context = AuthorizedGitContext::bind(&binding.root, Path::new(&root))?;
    let (commits, authorization) =
        context.history_pair_authorized(&definition_path, companion_path.as_deref())?;
    verify_workspace_binding(&state, &binding)?;
    let authorization_token = git_state.issue_history(history_request, authorization)?;
    Ok(GitHistoryResult {
        commits,
        authorization_token,
    })
}

#[tauri::command]
pub fn git_retain_history_authorization(
    authorization_token: String,
    controller_epoch: u64,
    request_generation: u64,
    git_state: State<'_, GitState>,
) -> GitResult<()> {
    git_state.retain_history(controller_epoch, request_generation, &authorization_token)
}

#[tauri::command]
pub fn git_revoke_history_authorization(
    authorization_token: String,
    git_state: State<'_, GitState>,
) -> GitResult<()> {
    git_state.revoke_history(&authorization_token)
}

#[tauri::command]
pub fn git_dispose_history_session(
    controller_epoch: u64,
    git_state: State<'_, GitState>,
) -> GitResult<()> {
    git_state.dispose_history_session(controller_epoch)
}

#[tauri::command]
pub fn git_show_pair(
    root: String,
    oid: String,
    authorization_token: String,
    definition_path: String,
    companion_path: Option<String>,
    state: State<'_, crate::workspace::WorkspaceState>,
    git_state: State<'_, GitState>,
) -> GitResult<GitPairSnapshot> {
    let binding = active_workspace_binding(&state)?;
    let context = AuthorizedGitContext::bind(&binding.root, Path::new(&root))?;
    let snapshot = show_authorized_pair(
        &git_state,
        &context,
        &authorization_token,
        &oid,
        &definition_path,
        companion_path.as_deref(),
    )?;
    verify_workspace_binding(&state, &binding)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn git_init(
    root: String,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<GitRepository> {
    let binding = active_workspace_binding(&state)?;
    let requested = Path::new(&root).canonicalize().map_err(|_| {
        GitError::new(
            "git_workspace_changed",
            "The confirmed workspace root is no longer available.",
        )
    })?;
    if requested != binding.root {
        return Err(GitError::new(
            "git_repository_not_authorized",
            "Repository initialization is limited to the selected workspace root.",
        ));
    }
    let result =
        init_repository_with_guard(&binding.root, || verify_workspace_binding(&state, &binding))?;
    verify_workspace_binding(&state, &binding)?;
    Ok(result)
}

#[tauri::command]
pub fn git_set_local_identity(
    root: String,
    user_name: String,
    user_email: String,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<()> {
    let binding = active_workspace_binding(&state)?;
    let context = AuthorizedGitContext::bind(&binding.root, Path::new(&root))?;
    set_local_identity_with_guard(&context.repository_root, &user_name, &user_email, || {
        verify_workspace_binding(&state, &binding)?;
        context.verify()
    })?;
    verify_workspace_binding(&state, &binding)?;
    context.verify()
}

#[tauri::command]
pub fn git_create_pair_version(
    root: String,
    definition_path: String,
    companion_path: Option<String>,
    message: String,
    authorization_token: String,
    state: State<'_, crate::workspace::WorkspaceState>,
    git_state: State<'_, GitState>,
) -> GitResult<GitVersionResult> {
    let binding = active_workspace_binding(&state)?;
    let context = AuthorizedGitContext::bind(&binding.root, Path::new(&root))?;
    let definition = context.translate(&definition_path)?;
    let companion = companion_path
        .as_deref()
        .map(|path| context.translate(path))
        .transpose()?;
    let authorization = git_state.consume_version(
        &authorization_token,
        &context,
        &definition,
        companion.as_deref(),
    )?;
    create_pair_version_with_guard(
        &context.repository_root,
        &context.git_metadata.metadata.worktree_dir,
        &authorization.base,
        &definition,
        companion.as_deref(),
        &message,
        || {
            verify_workspace_binding(&state, &binding)?;
            context.verify()?;
            authorization.binding.verify()?;
            authorization.base.verify(&context.repository_root)
        },
    )
}

#[tauri::command]
pub fn git_is_tracked(
    root: String,
    path: String,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<bool> {
    let binding = active_workspace_binding(&state)?;
    let context = AuthorizedGitContext::bind(&binding.root, Path::new(&root))?;
    let path = context.translate(&path)?;
    let result = is_tracked(&context.repository_root, &path)?;
    verify_workspace_binding(&state, &binding)?;
    context.verify()?;
    Ok(result)
}

#[tauri::command]
pub fn git_move_path(
    root: String,
    source: String,
    destination: String,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<()> {
    let binding = active_workspace_binding(&state)?;
    let context = AuthorizedGitContext::bind(&binding.root, Path::new(&root))?;
    let source = context.translate(&source)?;
    let destination = context.translate(&destination)?;
    move_tracked_path_with_guard(&context.repository_root, &source, &destination, || {
        verify_workspace_binding(&state, &binding)?;
        context.verify()
    })?;
    verify_workspace_binding(&state, &binding)?;
    context.verify()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMoveRequest {
    source: String,
    destination: String,
}

#[tauri::command]
pub fn git_move_paths(
    root: String,
    moves: Vec<GitMoveRequest>,
    state: State<'_, crate::workspace::WorkspaceState>,
) -> GitResult<()> {
    let binding = active_workspace_binding(&state)?;
    let context = AuthorizedGitContext::bind(&binding.root, Path::new(&root))?;
    let translated = moves
        .iter()
        .map(|request| {
            Ok((
                context.translate(&request.source)?,
                context.translate(&request.destination)?,
            ))
        })
        .collect::<GitResult<Vec<_>>>()?;
    let borrowed = translated
        .iter()
        .map(|(source, destination)| (source.as_str(), destination.as_str()))
        .collect::<Vec<_>>();
    mutate::move_tracked_paths_in_git_dir_with_guard(
        &context.repository_root,
        &context.git_metadata.metadata.worktree_dir,
        &borrowed,
        || {
            verify_workspace_binding(&state, &binding)?;
            context.verify()
        },
    )?;
    verify_workspace_binding(&state, &binding)?;
    context.verify()
}

#[cfg(test)]
mod tests;
