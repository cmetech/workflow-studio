//! Complete package capture, independent from the editor's filtered Explorer scan.
use super::{artifacts, files, WorkspaceError, WorkspaceResult, WorkspaceScope, WorkspaceState};
use cap_fs_ext::{DirExt, MetadataExt};
use cap_std::fs::Dir;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, OnceLock};
use tauri::State;
use unicode_normalization::UnicodeNormalization;

pub(super) fn error(code: &'static str) -> WorkspaceError {
    WorkspaceError::new(code, code.replace('_', " "))
}
pub(super) fn io(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new("workspace_package_io_failed", error.to_string())
}
pub(super) fn limit(name: &str) -> u64 {
    static CONTRACT: OnceLock<serde_json::Value> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(include_str!("../../../contracts/workflow-package-v1.json"))
            .expect("pinned contract")
    })["resource_rules"][name]
        .as_u64()
        .expect("pinned limit")
}
pub(crate) fn token() -> WorkspaceResult<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| error("workspace_random_failed"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Reuse the exact pinned Unicode14 folding table consumed by the renderer.
pub(crate) fn canonical(path: &str) -> String {
    static FOLD: OnceLock<HashMap<char, String>> = OnceLock::new();
    let fold = FOLD.get_or_init(|| {
        let source = include_str!(
            "../../../src/lib/packages/unicode/workflow-marketplace-casefold.generated.ts"
        );
        let section = source
            .split("export const WORKFLOW_MARKETPLACE_CASEFOLD_ENTRIES")
            .nth(1)
            .expect("pinned folding table");
        section
            .split("\n]")
            .next()
            .expect("table end")
            .lines()
            .filter_map(|line| {
                let line = line.trim().trim_end_matches(',');
                if !line.starts_with("[\"") {
                    return None;
                }
                let pair: (String, String) = serde_json::from_str(line).expect("pinned fold row");
                Some((pair.0.chars().next().expect("character"), pair.1))
            })
            .collect()
    });
    path.nfc()
        .flat_map(|character| {
            fold.get(&character)
                .cloned()
                .unwrap_or_else(|| character.to_string())
                .chars()
                .collect::<Vec<_>>()
        })
        .collect::<String>()
        .nfc()
        .collect()
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileIdentity {
    pub sha256: String,
    pub size: u64,
    pub modified_at: String,
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageFileHash {
    pub relative_path: String,
    pub size: u64,
    pub sha256: String,
    pub identity: WorkspaceFileIdentity,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct EntryIdentity {
    device: u64,
    inode: u64,
}
fn entry_identity(metadata: &cap_std::fs::Metadata) -> EntryIdentity {
    EntryIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    }
}

#[derive(Debug)]
struct CapturedEntry {
    kind: bool,
    identity: EntryIdentity,
    hash: Option<String>,
    size: u64,
    modified: String,
    read_only: bool,
}
#[derive(Debug)]
pub struct Capture {
    pub files: Vec<PackageFileHash>,
    pub package_root: String,
    entries: BTreeMap<String, CapturedEntry>,
}
impl Capture {
    pub(crate) fn all_file_paths(&self) -> Vec<String> {
        self.entries
            .iter()
            .filter(|(_, entry)| !entry.kind)
            .map(|(path, _)| workspace_path(&self.package_root, path))
            .collect()
    }
}

pub(crate) fn workspace_id(scope: &WorkspaceScope) -> WorkspaceResult<String> {
    super::transaction::workspace_id(scope)
}

/// A missing component is the only successful absence result. Links, aliases,
/// unreadable directories and non-directory parents fail closed.
pub(crate) fn path_exists(scope: &WorkspaceScope, relative: &str) -> WorkspaceResult<bool> {
    artifacts::validate(relative)?;
    let parts: Vec<_> = relative.split('/').collect();
    let mut dir = scope.directory()?.try_clone().map_err(io)?;
    for (index, part) in parts.iter().enumerate() {
        let metadata = match dir.symlink_metadata(part) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(io(error)),
        };
        artifacts::reject_link(&metadata)?;
        if index + 1 < parts.len() {
            dir = dir.open_dir_nofollow(part).map_err(io)?;
        }
    }
    scope.verify()?;
    Ok(true)
}

pub(crate) fn take_for_git(
    state: &PackageSnapshotState,
    scope: &WorkspaceScope,
    generation: u64,
    token: &str,
) -> WorkspaceResult<Capture> {
    let granted = state
        .snapshots
        .lock()
        .map_err(|_| error("workspace_state_unavailable"))?
        .remove(token)
        .ok_or_else(|| error("package_snapshot_invalid"))?;
    if granted.generation != generation || granted.workspace_id != workspace_id(scope)? {
        return Err(error("package_snapshot_invalid"));
    }
    verify(scope, &granted.capture)?;
    Ok(granted.capture)
}
#[derive(Default)]
pub struct PackageSnapshotState {
    pub(super) snapshots: Mutex<HashMap<String, GrantedSnapshot>>,
}
pub(super) struct GrantedSnapshot {
    pub generation: u64,
    pub workspace_id: String,
    pub capture: Capture,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePackageSnapshot {
    package_root: String,
    workspace_id: String,
    source_snapshot_token: String,
    files: Vec<PackageFileHash>,
    entries: Vec<files::WorkspaceFileEntry>,
    generated_digest_hash: Option<String>,
}

fn check_path(path: &str) -> WorkspaceResult<()> {
    if path.split('/').any(|part| canonical(part) == ".git") {
        return Err(error("package_repository_metadata"));
    }
    if path
        .rsplit_once('/')
        .is_some_and(|(_, name)| canonical(name) == "workflow-package.json")
    {
        return Err(error("package_root_nested"));
    }
    artifacts::validate(path).map_err(|error_value| {
        if error_value.code == "workspace_symlink_unsupported" {
            error("package_symlink_unsupported")
        } else {
            error_value
        }
    })
}
fn workspace_path(root: &str, path: &str) -> String {
    if root.is_empty() {
        path.into()
    } else {
        format!("{root}/{path}")
    }
}
pub(super) fn directory(scope: &WorkspaceScope, relative: &str) -> WorkspaceResult<Dir> {
    if relative.is_empty() {
        return scope.directory()?.try_clone().map_err(io);
    }
    check_path(relative)?;
    let mut dir = scope.directory()?.try_clone().map_err(io)?;
    for part in relative.split('/') {
        artifacts::reject_link(&dir.symlink_metadata(part).map_err(io)?)
            .map_err(|_| error("package_symlink_unsupported"))?;
        dir = dir.open_dir_nofollow(part).map_err(io)?;
        artifacts::reject_link(&dir.dir_metadata().map_err(io)?)
            .map_err(|_| error("package_symlink_unsupported"))?;
    }
    Ok(dir)
}
fn dir_identity(dir: &Dir) -> WorkspaceResult<EntryIdentity> {
    Ok(entry_identity(&dir.dir_metadata().map_err(io)?))
}

pub fn capture(scope: &WorkspaceScope, package_root: &str) -> WorkspaceResult<Capture> {
    capture_impl(scope, package_root, || {})
}
#[cfg(test)]
pub fn capture_with_hook(
    scope: &WorkspaceScope,
    package_root: &str,
    hook: impl FnOnce(),
) -> WorkspaceResult<Capture> {
    capture_impl(scope, package_root, hook)
}
fn capture_impl(
    scope: &WorkspaceScope,
    package_root: &str,
    hook: impl FnOnce(),
) -> WorkspaceResult<Capture> {
    let root = directory(scope, package_root)?;
    let mut captured = Capture {
        files: Vec::new(),
        package_root: package_root.into(),
        entries: BTreeMap::new(),
    };
    captured.entries.insert(
        String::new(),
        CapturedEntry {
            kind: true,
            identity: dir_identity(&root)?,
            hash: None,
            size: 0,
            modified: String::new(),
            read_only: false,
        },
    );
    let mut aliases = HashMap::new();
    let mut total = 0;
    let mut count = 0;
    scan(
        scope,
        &root,
        package_root,
        "",
        &mut captured,
        &mut aliases,
        &mut total,
        &mut count,
    )?;
    captured
        .files
        .sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    // Re-enumerate metadata without rereading bytes to detect membership/identity races during capture.
    hook();
    verify_metadata(scope, &captured)?;
    Ok(captured)
}
fn scan(
    scope: &WorkspaceScope,
    dir: &Dir,
    root: &str,
    prefix: &str,
    captured: &mut Capture,
    aliases: &mut HashMap<String, String>,
    total: &mut u64,
    count: &mut u64,
) -> WorkspaceResult<()> {
    for entry in dir.entries().map_err(io)? {
        let entry = entry.map_err(io)?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| error("package_path_collision"))?;
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        check_path(&path)?;
        if captured.entries.len() as u64 > limit("max_traversal_entries") {
            return Err(error("package_traversal_limit"));
        }
        if aliases.insert(canonical(&path), path.clone()).is_some() {
            return Err(error("package_path_collision"));
        }
        let metadata = dir.symlink_metadata(&name).map_err(io)?;
        artifacts::reject_link(&metadata).map_err(|_| error("package_symlink_unsupported"))?;
        if metadata.is_dir() {
            let child = dir.open_dir_nofollow(&name).map_err(io)?;
            artifacts::reject_link(&child.dir_metadata().map_err(io)?)
                .map_err(|_| error("package_symlink_unsupported"))?;
            captured.entries.insert(
                path.clone(),
                CapturedEntry {
                    kind: true,
                    identity: dir_identity(&child)?,
                    hash: None,
                    size: 0,
                    modified: String::new(),
                    read_only: false,
                },
            );
            scan(scope, &child, root, &path, captured, aliases, total, count)?;
        } else if metadata.is_file() {
            if path != "digests.json" {
                *count += 1;
            }
            if *count > limit("max_files") {
                return Err(error("package_file_count_limit"));
            }
            if metadata.len() > limit("max_file_bytes") {
                return Err(error("package_file_size_limit"));
            }
            if path != "digests.json" {
                *total += metadata.len();
            }
            if *total > limit("max_total_bytes") {
                return Err(error("package_total_size_limit"));
            }
            let relative = workspace_path(root, &path);
            let bound = artifacts::bind(scope, &relative)?;
            let mut file = artifacts::open(&bound)?;
            let opened_metadata = file.metadata().map_err(io)?;
            if opened_metadata.len() != metadata.len() {
                return Err(error("package_source_changed"));
            }
            let metadata = opened_metadata;
            if metadata.nlink() > 1 {
                return Err(error("package_path_collision"));
            }
            let identity = entry_identity(&metadata);
            let sha256 =
                files::hash_open_file(&mut file, limit("max_file_bytes")).map_err(|value| {
                    if value.code == "file_too_large" {
                        error("package_file_size_limit")
                    } else {
                        value
                    }
                })?;
            let after = file.metadata().map_err(io)?;
            if after.len() != metadata.len() || after.modified().ok() != metadata.modified().ok() {
                return Err(error("package_source_changed"));
            }
            let size = metadata.len();
            let modified = files::modified_timestamp(&metadata);
            if path != "digests.json" {
                captured.files.push(PackageFileHash {
                    relative_path: path.clone(),
                    size,
                    sha256: sha256.clone(),
                    identity: WorkspaceFileIdentity {
                        sha256: sha256.clone(),
                        size,
                        modified_at: modified.clone(),
                    },
                });
            }
            captured.entries.insert(
                path,
                CapturedEntry {
                    read_only: metadata.permissions().readonly(),
                    kind: false,
                    identity,
                    hash: Some(sha256),
                    size,
                    modified,
                },
            );
        } else {
            return Err(error("package_file_type_unsupported"));
        }
    }
    Ok(())
}
fn verify_metadata(scope: &WorkspaceScope, captured: &Capture) -> WorkspaceResult<()> {
    let root = directory(scope, &captured.package_root)?;
    if dir_identity(&root)? != captured.entries[""].identity {
        return Err(error("package_source_changed"));
    }
    let mut found = BTreeMap::new();
    metadata_walk(&root, "", &mut found, &std::collections::HashSet::new())?;
    if found.len() + 1 != captured.entries.len() {
        return Err(error("package_source_changed"));
    }
    for (path, (is_dir, identity, size, modified)) in found {
        let Some(expected) = captured.entries.get(&path) else {
            return Err(error("package_source_changed"));
        };
        if expected.kind != is_dir
            || expected.identity != identity
            || expected.size != size
            || expected.modified != modified
        {
            return Err(error("package_source_changed"));
        }
    }
    Ok(())
}
fn metadata_walk(
    dir: &Dir,
    prefix: &str,
    found: &mut BTreeMap<String, (bool, EntryIdentity, u64, String)>,
    ignored: &std::collections::HashSet<&str>,
) -> WorkspaceResult<()> {
    for entry in dir.entries().map_err(io)? {
        let entry = entry.map_err(io)?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| error("package_path_collision"))?;
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if ignored.contains(path.as_str()) {
            continue;
        }
        check_path(&path)?;
        if found.len() as u64 >= limit("max_traversal_entries") {
            return Err(error("package_traversal_limit"));
        }
        let metadata = dir.symlink_metadata(&name).map_err(io)?;
        artifacts::reject_link(&metadata).map_err(|_| error("package_symlink_unsupported"))?;
        if metadata.is_dir() {
            let child = dir.open_dir_nofollow(&name).map_err(io)?;
            found.insert(
                path.clone(),
                (true, dir_identity(&child)?, 0, String::new()),
            );
            metadata_walk(&child, &path, found, ignored)?;
        } else {
            let bound = files::BoundPath {
                parent: dir.try_clone().map_err(io)?,
                name: name.into(),
                reject_symlinks: true,
            };
            let file = artifacts::open(&bound)?;
            let metadata = file.metadata().map_err(io)?;
            found.insert(
                path,
                (
                    false,
                    entry_identity(&metadata),
                    metadata.len(),
                    files::modified_timestamp(&metadata),
                ),
            );
        }
    }
    Ok(())
}
pub(super) fn verify_generated_capacity(captured: &Capture) -> WorkspaceResult<()> {
    let projected = captured.entries.len().saturating_sub(1)
        + usize::from(!captured.entries.contains_key("digests.json"));
    if projected as u64 > limit("max_traversal_entries") {
        return Err(error("package_traversal_limit"));
    }
    Ok(())
}
pub fn verify(scope: &WorkspaceScope, captured: &Capture) -> WorkspaceResult<()> {
    let fresh =
        capture(scope, &captured.package_root).map_err(|_| error("package_source_changed"))?;
    if fresh.entries.len() != captured.entries.len() {
        return Err(error("package_source_changed"));
    }
    for (path, expected) in &captured.entries {
        let Some(actual) = fresh.entries.get(path) else {
            return Err(error("package_source_changed"));
        };
        if actual.kind != expected.kind
            || actual.identity != expected.identity
            || actual.hash != expected.hash
            || actual.size != expected.size
        {
            return Err(error("package_source_changed"));
        }
    }
    Ok(())
}
#[tauri::command]
pub fn workspace_hash_package(
    package_root: String,
    state: State<'_, WorkspaceState>,
    snapshots: State<'_, PackageSnapshotState>,
) -> WorkspaceResult<WorkspacePackageSnapshot> {
    let active = state.active.lock().map_err(|_| super::state_error())?;
    let active = active
        .as_ref()
        .ok_or_else(|| error("workspace_not_selected"))?;
    let captured = capture(&active.scope, &package_root)?;
    let workspace_id = super::transaction::workspace_id(&active.scope)?;
    let source_snapshot_token = token()?;
    let result = WorkspacePackageSnapshot {
        package_root,
        workspace_id: workspace_id.clone(),
        source_snapshot_token: source_snapshot_token.clone(),
        files: captured.files.clone(),
        generated_digest_hash: captured
            .entries
            .get("digests.json")
            .and_then(|entry| entry.hash.clone()),
        entries: workspace_entries(&captured),
    };
    let mut entries = snapshots
        .snapshots
        .lock()
        .map_err(|_| super::state_error())?;
    if entries.len() >= 16 {
        entries.clear();
    }
    entries.insert(
        source_snapshot_token,
        GrantedSnapshot {
            generation: active.generation,
            workspace_id,
            capture: captured,
        },
    );
    Ok(result)
}

pub(super) fn verify_sources(
    scope: &WorkspaceScope,
    captured: &Capture,
    ignored: &[String],
) -> WorkspaceResult<()> {
    let root = directory(scope, &captured.package_root)?;
    if dir_identity(&root)? != captured.entries[""].identity {
        return Err(error("package_source_changed"));
    }
    let ignored: std::collections::HashSet<_> = ignored
        .iter()
        .filter_map(|path| {
            if captured.package_root.is_empty() {
                Some(path.as_str())
            } else {
                path.strip_prefix(&format!("{}/", captured.package_root))
            }
        })
        .collect();
    let mut found = BTreeMap::new();
    metadata_walk(&root, "", &mut found, &ignored)?;
    found.retain(|path, _| !ignored.contains(path.as_str()));
    let expected: Vec<_> = captured
        .entries
        .iter()
        .filter(|(path, _)| !path.is_empty() && !ignored.contains(path.as_str()))
        .collect();
    if found.len() != expected.len() {
        return Err(error("package_source_changed"));
    }
    for (path, prior) in expected {
        let Some((directory, identity, size, _)) = found.get(path) else {
            return Err(error("package_source_changed"));
        };
        if *directory != prior.kind || identity != &prior.identity || *size != prior.size {
            return Err(error("package_source_changed"));
        }
        if !directory {
            let bound = artifacts::bind(scope, &workspace_path(&captured.package_root, path))?;
            let mut file = artifacts::open(&bound)?;
            let before = file.metadata().map_err(io)?;
            if entry_identity(&before) != prior.identity
                || before.len() != prior.size
                || before.nlink() > 1
            {
                return Err(error("package_source_changed"));
            }
            if Some(files::hash_open_file(&mut file, limit("max_file_bytes"))?) != prior.hash {
                return Err(error("package_source_changed"));
            }
            let after = file.metadata().map_err(io)?;
            if after.len() != before.len() || after.modified().ok() != before.modified().ok() {
                return Err(error("package_source_changed"));
            }
        }
    }
    Ok(())
}

pub(super) fn workspace_entries(captured: &Capture) -> Vec<files::WorkspaceFileEntry> {
    captured
        .entries
        .iter()
        .filter(|(path, _)| !path.is_empty())
        .map(|(path, entry)| files::WorkspaceFileEntry {
            relative_path: workspace_path(&captured.package_root, path),
            kind: if entry.kind { "directory" } else { "file" }.into(),
            size: entry.size,
            modified_at: entry.modified.clone(),
            symlink: "none".into(),
            read_only: entry.read_only,
        })
        .collect()
}
