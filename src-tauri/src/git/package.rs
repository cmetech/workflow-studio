//! Package-scoped local Git authorization. Renderer inputs never supply a repository path.
use super::mutate::GitBase;
use super::runner::{run_read, ReadOperation};
use super::{AuthorizedGitContext, GitError, GitRepository, GitResult};
use crate::workspace::{artifacts, package_hash, WorkspaceError, WorkspaceScope};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::Mutex;

const INDEX: &str = ".well-known/hermes-workflows/index.json";
fn error(code: &'static str) -> GitError {
    GitError::new(code, code.replace('_', " "))
}
fn workspace(error: WorkspaceError) -> GitError {
    GitError::new(error.code, error.message)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommittedPackageFile {
    pub relative_path: String,
    pub sha256: String,
    pub size: u64,
    pub git_mode: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPackageContext {
    pub workspace_id: String,
    pub package_root: String,
    pub repository: GitRepository,
    pub base: GitBase,
    pub context_token: String,
    pub committed_manifest_text: Option<String>,
    pub baseline_manifest_text: Option<String>,
    pub committed_files: Vec<GitCommittedPackageFile>,
    pub committed_index_text: Option<String>,
    pub working_index_text: Option<String>,
    pub working_index_hash: Option<String>,
}
struct ContextGrant {
    generation: u64,
    context: AuthorizedGitContext,
    value: GitPackageContext,
}
#[derive(Default)]
pub struct PackageGitState {
    contexts: Mutex<HashMap<String, ContextGrant>>,
    versions: Mutex<HashMap<String, VersionGrant>>,
}

struct TreeFile {
    path: String,
    mode: String,
    oid: String,
}
fn tree(root: &Path, oid: &str, path: &str) -> GitResult<Vec<TreeFile>> {
    let result = run_read(root, ReadOperation::PackageTree { tree: oid, path })?;
    super::ensure_success("git_package_baseline_unavailable", &result)?;
    let mut found = Vec::new();
    let mut aliases = BTreeSet::new();
    for record in result
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let record =
            std::str::from_utf8(record).map_err(|_| error("git_package_path_unsupported"))?;
        let (metadata, name) = record
            .split_once('\t')
            .ok_or_else(|| error("git_package_baseline_unavailable"))?;
        let parts: Vec<_> = metadata.split(' ').collect();
        if parts.len() != 3
            || parts[1] != "blob"
            || !matches!(parts[0], "100644" | "100755")
            || !aliases.insert(package_hash::canonical(name))
        {
            return Err(error("git_package_path_unsupported"));
        }
        if found.len() >= 513 {
            return Err(error("git_package_baseline_too_large"));
        }
        super::validate_path(name)?;
        found.push(TreeFile {
            path: name.into(),
            mode: parts[0].into(),
            oid: parts[2].into(),
        });
    }
    Ok(found)
}
fn blob(root: &Path, oid: &str) -> GitResult<Vec<u8>> {
    let output = run_read(root, ReadOperation::RawBlob { oid })?;
    super::ensure_success("git_package_baseline_unavailable", &output)?;
    if output.stdout.len() > 1024 * 1024 {
        return Err(error("git_package_baseline_too_large"));
    }
    Ok(output.stdout)
}
fn text(bytes: Vec<u8>) -> GitResult<String> {
    String::from_utf8(bytes).map_err(|_| error("git_package_invalid_utf8"))
}
fn committed_text(root: &Path, base: &str, path: &str) -> GitResult<Option<String>> {
    let files = tree(root, base, path)?;
    match files.as_slice() {
        [] => Ok(None),
        [entry] if entry.path == path => Ok(Some(text(blob(root, &entry.oid)?)?)),
        _ => Err(error("git_package_path_unsupported")),
    }
}
fn working_index(scope: &WorkspaceScope) -> GitResult<Option<String>> {
    if !package_hash::path_exists(scope, INDEX).map_err(workspace)? {
        return Ok(None);
    }
    Ok(Some(
        artifacts::read_text(scope, INDEX).map_err(workspace)?.text,
    ))
}
impl PackageGitState {
    pub(crate) fn context(
        &self,
        scope: &WorkspaceScope,
        generation: u64,
        package_root: &str,
    ) -> GitResult<GitPackageContext> {
        if package_root.is_empty() {
            return Err(error("package_root_required"));
        }
        package_hash::path_exists(scope, package_root).map_err(workspace)?;
        let root = scope.root_path().map_err(workspace)?;
        let repository =
            super::detect_repository(root)?.ok_or_else(|| error("git_not_repository"))?;
        if Path::new(&repository.root)
            .canonicalize()
            .map_err(|_| error("git_repository_unavailable"))?
            != root
        {
            return Err(GitError::new(
                "git_package_workspace_root_required",
                "Open the Git repository root as the workspace to prepare or version packages.",
            ));
        }
        let context = AuthorizedGitContext::bind(root, root)?;
        let base = GitBase::capture(root)?;
        let mut committed_files = Vec::new();
        let mut committed_manifest_text = None;
        let mut baseline_manifest_text = None;
        let mut committed_index_text = None;
        if let Some(oid) = base.parent() {
            let manifest = format!("{package_root}/workflow-package.json");
            let mut total = 0usize;
            for entry in tree(root, oid, package_root)? {
                let relative = entry
                    .path
                    .strip_prefix(&format!("{package_root}/"))
                    .ok_or_else(|| error("git_package_path_unsupported"))?;
                let bytes = blob(root, &entry.oid)?;
                total += bytes.len();
                if total > 9 * 1024 * 1024 {
                    return Err(error("git_package_baseline_too_large"));
                }
                if entry.path == manifest {
                    committed_manifest_text = Some(text(bytes.clone())?);
                }
                committed_files.push(GitCommittedPackageFile {
                    relative_path: relative.into(),
                    size: bytes.len() as u64,
                    sha256: hash(&bytes),
                    git_mode: entry.mode,
                });
            }
            committed_index_text = committed_text(root, oid, INDEX)?;
            baseline_manifest_text = committed_manifest_text.clone();
            if baseline_manifest_text.is_none() {
                let history = run_read(
                    root,
                    ReadOperation::PackageHistory {
                        base: oid,
                        path: &manifest,
                    },
                )?;
                super::ensure_success("git_package_baseline_unavailable", &history)?;
                let history = super::output_text(&history.stdout)?;
                for (count, historical) in history.lines().enumerate() {
                    if count >= 256 {
                        return Err(error("git_package_history_too_large"));
                    }
                    if let Some(value) = committed_text(root, historical, &manifest)? {
                        baseline_manifest_text = Some(value);
                        break;
                    }
                }
            }
        }
        let working_index_text = working_index(scope)?;
        base.verify(root)?;
        context.verify()?;
        let context_token = package_hash::token().map_err(workspace)?;
        let value = GitPackageContext {
            workspace_id: package_hash::workspace_id(scope).map_err(workspace)?,
            package_root: package_root.into(),
            repository,
            base,
            context_token: context_token.clone(),
            committed_manifest_text,
            baseline_manifest_text,
            committed_files,
            committed_index_text,
            working_index_hash: working_index_text
                .as_ref()
                .map(|value| hash(value.as_bytes())),
            working_index_text,
        };
        let mut grants = self
            .contexts
            .lock()
            .map_err(|_| error("git_state_unavailable"))?;
        if grants.len() >= 16 {
            grants.clear();
        }
        grants.insert(
            context_token,
            ContextGrant {
                generation,
                context,
                value: value.clone(),
            },
        );
        Ok(value)
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitPackageVersionRequest {
    pub context_token: String,
    pub source_snapshot_token: Option<String>,
    pub expected_index_hash: String,
    pub version: Option<String>,
    pub message: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPackageVersionPreview {
    pub authorization_token: String,
    pub package_root: String,
    pub base: GitBase,
    pub version: Option<String>,
    pub message: String,
    pub changed_paths: Vec<String>,
    pub diff: String,
}
struct VersionGrant {
    context: ContextGrant,
    captured: Option<package_hash::Capture>,
    index_hash: String,
    paths: Vec<String>,
    binding: super::mutate::PairPathBinding,
    message: String,
}
impl ContextGrant {
    fn verify(&self, scope: &WorkspaceScope, generation: u64) -> GitResult<()> {
        if self.generation != generation
            || self.value.workspace_id != package_hash::workspace_id(scope).map_err(workspace)?
        {
            return Err(error("git_package_authorization_invalid"));
        }
        self.context.verify()?;
        Ok(())
    }
}
fn verify_source(
    scope: &WorkspaceScope,
    root: &str,
    captured: Option<&package_hash::Capture>,
) -> GitResult<()> {
    match captured {
        Some(capture) if capture.package_root == root => {
            package_hash::verify(scope, capture).map_err(workspace)
        }
        Some(_) => Err(error("git_package_snapshot_mismatch")),
        None if !package_hash::path_exists(scope, root).map_err(workspace)? => Ok(()),
        None => Err(error("git_package_deletion_incomplete")),
    }
}
impl PackageGitState {
    pub(crate) fn preview(
        &self,
        scope: &WorkspaceScope,
        generation: u64,
        request: GitPackageVersionRequest,
        captured: Option<package_hash::Capture>,
    ) -> GitResult<GitPackageVersionPreview> {
        let grant = self
            .contexts
            .lock()
            .map_err(|_| error("git_state_unavailable"))?
            .remove(&request.context_token)
            .ok_or_else(|| error("git_package_authorization_invalid"))?;
        grant.verify(scope, generation)?;
        grant
            .value
            .base
            .verify(scope.root_path().map_err(workspace)?)?;
        if request.message.trim().is_empty() {
            return Err(error("git_message_required"));
        }
        if request.message.len() > 64 * 1024 {
            return Err(error("git_message_too_large"));
        }
        if request.source_snapshot_token.is_some() != captured.is_some()
            || request.version.is_some() != captured.is_some()
        {
            return Err(error("git_package_snapshot_mismatch"));
        }
        if captured.is_none() && grant.value.committed_files.is_empty() {
            return Err(error("git_package_deletion_missing"));
        }
        verify_source(scope, &grant.value.package_root, captured.as_ref())?;
        let index = working_index(scope)?.ok_or_else(|| error("git_package_index_missing"))?;
        if hash(index.as_bytes()) != request.expected_index_hash {
            return Err(error("git_package_index_changed"));
        }
        super::package_index::verify(
            grant.value.committed_index_text.as_deref(),
            &index,
            &grant.value.package_root,
            request.version.as_deref(),
        )?;
        let mut paths: BTreeSet<String> = grant
            .value
            .committed_files
            .iter()
            .map(|file| format!("{}/{}", grant.value.package_root, file.relative_path))
            .collect();
        if let Some(capture) = &captured {
            paths.extend(capture.all_file_paths());
        }
        paths.insert(INDEX.into());
        let paths: Vec<_> = paths.into_iter().collect();
        let refs: Vec<_> = paths.iter().map(String::as_str).collect();
        let root = scope.root_path().map_err(workspace)?;
        let (diff, changed_paths, binding) = super::mutate::preview_package_candidate(
            root,
            &grant.context.git_metadata.metadata.worktree_dir,
            &grant.value.base,
            &refs,
        )?;
        verify_source(scope, &grant.value.package_root, captured.as_ref())?;
        grant.verify(scope, generation)?;
        grant
            .value
            .base
            .verify(scope.root_path().map_err(workspace)?)?;
        if working_index(scope)?
            .as_ref()
            .map(|value| hash(value.as_bytes()))
            .as_deref()
            != Some(&request.expected_index_hash)
        {
            return Err(error("git_package_index_changed"));
        }
        let token = package_hash::token().map_err(workspace)?;
        let value = GitPackageVersionPreview {
            authorization_token: token.clone(),
            package_root: grant.value.package_root.clone(),
            base: grant.value.base.clone(),
            version: request.version,
            message: request.message.trim().into(),
            changed_paths,
            diff,
        };
        let mut versions = self
            .versions
            .lock()
            .map_err(|_| error("git_state_unavailable"))?;
        if versions.len() >= 16 {
            versions.clear();
        }
        versions.insert(
            token,
            VersionGrant {
                context: grant,
                captured,
                index_hash: request.expected_index_hash,
                paths,
                binding,
                message: value.message.clone(),
            },
        );
        Ok(value)
    }
    pub(crate) fn commit(
        &self,
        scope: &WorkspaceScope,
        generation: u64,
        token: &str,
        mut guard: impl FnMut() -> GitResult<()>,
    ) -> GitResult<super::GitVersionResult> {
        let grant = self
            .versions
            .lock()
            .map_err(|_| error("git_state_unavailable"))?
            .remove(token)
            .ok_or_else(|| error("git_package_authorization_invalid"))?;
        let verify = || -> GitResult<()> {
            guard()?;
            grant.context.verify(scope, generation)?;
            verify_source(
                scope,
                &grant.context.value.package_root,
                grant.captured.as_ref(),
            )?;
            if working_index(scope)?
                .as_ref()
                .map(|value| hash(value.as_bytes()))
                .as_deref()
                != Some(&grant.index_hash)
            {
                return Err(error("git_package_index_changed"));
            }
            grant.binding.verify()
        };
        let root = scope.root_path().map_err(workspace)?;
        let paths: Vec<_> = grant.paths.iter().map(String::as_str).collect();
        super::mutate::create_package_version(
            root,
            &grant.context.context.git_metadata.metadata.worktree_dir,
            &grant.context.value.base,
            &grant.binding,
            &paths,
            &grant.message,
            verify,
        )
    }
}

#[tauri::command(async)]
pub fn git_read_package_context(
    package_root: String,
    workspace_state: tauri::State<'_, crate::workspace::WorkspaceState>,
    state: tauri::State<'_, PackageGitState>,
) -> GitResult<GitPackageContext> {
    let binding = super::active_workspace_binding(&workspace_state)?;
    let scope = WorkspaceScope::new(&binding.root).map_err(workspace)?;
    let result = state.context(&scope, binding.generation, &package_root)?;
    super::verify_workspace_binding(&workspace_state, &binding)?;
    Ok(result)
}
#[tauri::command(async)]
pub fn git_preview_package_version(
    request: GitPackageVersionRequest,
    workspace_state: tauri::State<'_, crate::workspace::WorkspaceState>,
    snapshots: tauri::State<'_, package_hash::PackageSnapshotState>,
    state: tauri::State<'_, PackageGitState>,
) -> GitResult<GitPackageVersionPreview> {
    let binding = super::active_workspace_binding(&workspace_state)?;
    let scope = WorkspaceScope::new(&binding.root).map_err(workspace)?;
    let capture = request
        .source_snapshot_token
        .as_ref()
        .map(|token| {
            package_hash::take_for_git(&snapshots, &scope, binding.generation, token)
                .map_err(workspace)
        })
        .transpose()?;
    let result = state.preview(&scope, binding.generation, request, capture)?;
    super::verify_workspace_binding(&workspace_state, &binding)?;
    Ok(result)
}
#[tauri::command(async)]
pub fn git_commit_package_version(
    authorization_token: String,
    workspace_state: tauri::State<'_, crate::workspace::WorkspaceState>,
    state: tauri::State<'_, PackageGitState>,
) -> GitResult<super::GitVersionResult> {
    let binding = super::active_workspace_binding(&workspace_state)?;
    let scope = WorkspaceScope::new(&binding.root).map_err(workspace)?;
    state.commit(&scope, binding.generation, &authorization_token, || {
        super::verify_workspace_binding(&workspace_state, &binding)
    })
}
