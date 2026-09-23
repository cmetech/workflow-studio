//! Package artifact access is separate from the YAML-only workflow commands.
use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::{Cursor, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, Metadata, OpenOptions};
use same_file::Handle;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use unicode_normalization::UnicodeNormalization;

use super::{files, WorkspaceError, WorkspaceResult, WorkspaceScope, WorkspaceState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArtifactMetadata {
    pub relative_path: String,
    pub media_type: String,
    pub size: u64,
    pub sha256: String,
    pub modified_at: String,
    pub read_only: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub recovery_results: Vec<super::PathOperationResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSourceSelection {
    pub source_grant_token: String,
}

#[derive(Default)]
pub struct ArtifactGrantState {
    sources: Mutex<HashMap<String, SourceGrant>>,
    opened: Mutex<Vec<tempfile::TempDir>>,
}

struct SourceGrant {
    scope: WorkspaceScope,
    name: String,
    file: File,
    identity: Handle,
    hash: String,
    generation: u64,
}

pub fn max_bytes() -> u64 {
    static LIMIT: OnceLock<u64> = OnceLock::new();
    *LIMIT.get_or_init(|| {
        let contract: serde_json::Value =
            serde_json::from_str(include_str!("../../../contracts/workflow-package-v1.json"))
                .expect("bundled package contract is valid JSON");
        contract["resource_rules"]["max_file_bytes"]
            .as_u64()
            .expect("pinned contract publishes a per-file limit")
    })
}

fn issue(code: &'static str, message: impl Into<String>) -> WorkspaceError {
    WorkspaceError::new(code, message)
}
fn io(error: std::io::Error) -> WorkspaceError {
    issue("workspace_artifact_io_failed", error.to_string())
}
fn link_error() -> WorkspaceError {
    issue(
        "workspace_symlink_unsupported",
        "Package artifact paths cannot contain symlinks or reparse points.",
    )
}
fn grant_error() -> WorkspaceError {
    issue(
        "artifact_source_grant_invalid",
        "The source grant expired or its file changed; choose the source again.",
    )
}

pub(super) fn validate(relative: &str) -> WorkspaceResult<()> {
    if relative.nfc().collect::<String>() != relative
        || relative.contains(['\\', '\0'])
        || relative.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part.eq_ignore_ascii_case(".git")
                || (part.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
                    && part.as_bytes().get(1) == Some(&b':'))
        })
    {
        return Err(issue(
            "workspace_path_invalid",
            "A canonical relative artifact path outside Git metadata is required.",
        ));
    }
    #[cfg(windows)]
    if relative
        .split('/')
        .any(|part| part.contains(':') || part.ends_with(['.', ' ']))
    {
        return Err(issue(
            "workspace_path_unsupported_platform",
            "This artifact filename aliases another Windows path; use a compatible name.",
        ));
    }
    super::paths::validate_relative(relative)
        .map(|_| ())
        .map_err(|_| {
            issue(
                "workspace_path_invalid",
                "A relative artifact path is required.",
            )
        })
}

pub(super) fn reject_link(metadata: &Metadata) -> WorkspaceResult<()> {
    if metadata.file_type().is_symlink() {
        return Err(link_error());
    }
    #[cfg(windows)]
    {
        use cap_std::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(link_error());
        }
    }
    Ok(())
}

pub(super) fn bind(scope: &WorkspaceScope, relative: &str) -> WorkspaceResult<files::BoundPath> {
    validate(relative)?;
    let mut parent = scope.directory()?.try_clone().map_err(io)?;
    let parts: Vec<_> = relative.split('/').collect();
    for part in &parts[..parts.len() - 1] {
        reject_link(&parent.symlink_metadata(part).map_err(io)?)?;
        parent = parent.open_dir_nofollow(part).map_err(|_| link_error())?;
        reject_link(&parent.dir_metadata().map_err(io)?)?;
    }
    let name = parts.last().expect("nonempty path");
    match parent.symlink_metadata(name) {
        Ok(metadata) => reject_link(&metadata)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io(error)),
    }
    Ok(files::BoundPath {
        reject_symlinks: true,
        parent,
        name: name.into(),
    })
}

fn identity(file: &File) -> WorkspaceResult<Handle> {
    Handle::from_file(file.try_clone().map_err(io)?.into_std()).map_err(io)
}
fn directory_identity(directory: &Dir) -> WorkspaceResult<Handle> {
    Handle::from_file(directory.try_clone().map_err(io)?.into_std_file()).map_err(io)
}

pub(super) fn verify_binding(
    scope: &WorkspaceScope,
    relative: &str,
    expected: &files::BoundPath,
) -> WorkspaceResult<()> {
    let fresh = bind(scope, relative)?;
    if directory_identity(&fresh.parent)? != directory_identity(&expected.parent)? {
        return Err(issue(
            "workspace_revision_conflict",
            "The artifact parent directory changed.",
        ));
    }
    Ok(())
}

pub(super) fn open(bound: &files::BoundPath) -> WorkspaceResult<File> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_fs_ext::OpenOptionsSyncExt;
        // A leaf can become a FIFO after binding. Open first without waiting,
        // then reject special files using metadata from the opened descriptor.
        options.nonblock(true);
    }
    let file = bound
        .parent
        .open_with(&bound.name, &options)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                issue("path_not_found", "The artifact does not exist.")
            } else {
                io(error)
            }
        })?;
    let metadata = file.metadata().map_err(io)?;
    reject_link(&metadata)?;
    if !metadata.is_file() {
        return Err(issue(
            "not_a_file",
            "Only regular artifact files are supported.",
        ));
    }
    if metadata.len() > max_bytes() {
        return Err(issue(
            "file_too_large",
            "The artifact exceeds the package contract limit.",
        ));
    }
    Ok(file)
}

fn snapshot(
    scope: &WorkspaceScope,
    relative: &str,
    destination: &mut impl std::io::Write,
) -> WorkspaceResult<WorkspaceArtifactMetadata> {
    let bound = bind(scope, relative)?;
    let mut file = open(&bound)?;
    let original = identity(&file)?;
    let metadata = file.metadata().map_err(io)?;
    let (size, hash) = files::stream_bounded(&mut file, destination, max_bytes())?;
    verify_binding(scope, relative, &bound)?;
    let mut current = open(&bound)?;
    if identity(&current)? != original || files::hash_open_file(&mut current, max_bytes())? != hash
    {
        return Err(issue(
            "workspace_revision_conflict",
            "The artifact changed while reading.",
        ));
    }
    Ok(WorkspaceArtifactMetadata {
        relative_path: relative.into(),
        media_type: "application/octet-stream".into(),
        size,
        sha256: hash,
        modified_at: files::modified_timestamp(&metadata),
        read_only: metadata.permissions().readonly(),
        recovery_results: Vec::new(),
    })
}

pub fn read(scope: &WorkspaceScope, relative: &str) -> WorkspaceResult<WorkspaceArtifactMetadata> {
    let mut prefix = Prefix::default();
    let mut metadata = snapshot(scope, relative, &mut prefix)?;
    if relative.to_ascii_lowercase().ends_with(".png")
        && prefix.bytes.starts_with(b"\x89PNG\r\n\x1a\n")
    {
        metadata.media_type = "image/png".into();
    }
    Ok(metadata)
}

#[derive(Default)]
struct Prefix {
    bytes: Vec<u8>,
}
impl std::io::Write for Prefix {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.bytes.extend_from_slice(
            &buffer[..buffer.len().min(16usize.saturating_sub(self.bytes.len()))],
        );
        Ok(buffer.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub fn read_text(
    scope: &WorkspaceScope,
    relative: &str,
) -> WorkspaceResult<files::WorkspaceReadResult> {
    let mut bytes = Vec::new();
    let metadata = snapshot(scope, relative, &mut bytes)?;
    let text = String::from_utf8(bytes)
        .map_err(|_| issue("invalid_utf8", "The artifact is not valid UTF-8 text."))?;
    Ok(files::WorkspaceReadResult {
        relative_path: relative.into(),
        text,
        sha256: metadata.sha256,
        size: metadata.size,
        modified_at: metadata.modified_at,
        read_only: metadata.read_only,
    })
}

fn map_write_error(mut error: WorkspaceError) -> WorkspaceError {
    if error.code == "external_revision_conflict" {
        error.code = "workspace_revision_conflict";
    }
    error
}

pub fn write_text(
    scope: &WorkspaceScope,
    relative: &str,
    text: &str,
    expected: Option<&str>,
) -> WorkspaceResult<files::WorkspaceWriteResult> {
    files::write_artifact_stream(scope, relative, &mut text.as_bytes(), expected, None)
        .map_err(map_write_error)
}

pub fn grant_source(
    path: &Path,
    generation: u64,
    grants: &ArtifactGrantState,
) -> WorkspaceResult<ArtifactSourceSelection> {
    // The path comes only from the native dialog. Retain an opened capability and identity.
    let parent = path.parent().ok_or_else(grant_error)?;
    reject_ambient_links(parent)?;
    let scope = WorkspaceScope::new(parent)?;
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(grant_error)?
        .to_string();
    let bound = bind(&scope, &name)?;
    let mut file = open(&bound)?;
    let identity = identity(&file)?;
    let hash = files::hash_open_file(&mut file, max_bytes())?;
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| grant_error())?;
    let token = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let mut sources = grants.sources.lock().map_err(|_| grant_error())?;
    // A bounded chooser grant set: only the most recent source remains authorized.
    sources.clear();
    sources.insert(
        token.clone(),
        SourceGrant {
            scope,
            name,
            file,
            identity,
            hash,
            generation,
        },
    );
    Ok(ArtifactSourceSelection {
        source_grant_token: token,
    })
}

pub(super) fn reject_ambient_links(path: &Path) -> WorkspaceResult<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if !matches!(component, std::path::Component::Normal(_)) {
            continue;
        }
        if component
            .as_os_str()
            .to_str()
            .is_some_and(|part| part.eq_ignore_ascii_case(".git"))
        {
            return Err(issue(
                "workspace_path_invalid",
                "Git metadata cannot be imported as a package artifact.",
            ));
        }
        let metadata = std::fs::symlink_metadata(&current).map_err(io)?;
        if metadata.file_type().is_symlink() {
            return Err(link_error());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(link_error());
            }
        }
    }
    Ok(())
}

pub fn import(
    scope: &WorkspaceScope,
    generation: u64,
    grants: &ArtifactGrantState,
    relative: &str,
    token: &str,
    expected: Option<&str>,
) -> WorkspaceResult<WorkspaceArtifactMetadata> {
    import_captured(scope, generation, grants, relative, token, expected, None)
}
pub(super) fn import_captured(
    scope: &WorkspaceScope,
    generation: u64,
    grants: &ArtifactGrantState,
    relative: &str,
    token: &str,
    expected: Option<&str>,
    captured: Option<&super::package_hash::Capture>,
) -> WorkspaceResult<WorkspaceArtifactMetadata> {
    let mut grant = grants
        .sources
        .lock()
        .map_err(|_| grant_error())?
        .remove(token)
        .ok_or_else(grant_error)?;
    if grant.generation != generation {
        return Err(grant_error());
    }
    let bound = bind(&grant.scope, &grant.name).map_err(|_| grant_error())?;
    let mut current = open(&bound).map_err(|_| grant_error())?;
    if identity(&current)? != grant.identity
        || files::hash_open_file(&mut current, max_bytes())? != grant.hash
    {
        return Err(grant_error());
    }
    grant.file.seek(SeekFrom::Start(0)).map_err(io)?;
    if let Some(captured) = captured {
        use super::transaction::{ExpectedWorkspaceEntry, PackageMutationPlan, WriteRequest};
        let plan = PackageMutationPlan {
            package_snapshot_token: None,
            workspace_id: super::transaction::workspace_id(scope)?,
            expected_entries: vec![ExpectedWorkspaceEntry {
                relative_path: relative.into(),
                expected_current_hash: expected.map(str::to_owned),
            }],
            writes: vec![WriteRequest {
                relative_path: relative.into(),
                text: String::new(),
                expected_current_hash: expected.map(str::to_owned),
            }],
            moves: vec![],
            trashes: vec![],
        };
        let size = grant.file.metadata().map_err(io)?.len();
        let transaction = super::transaction::apply_captured_stream(
            scope,
            &plan,
            captured,
            &grant.hash,
            size,
            &mut grant.file,
            || {
                let rebound = bind(&grant.scope, &grant.name).map_err(|_| grant_error())?;
                let mut current = open(&rebound).map_err(|_| grant_error())?;
                if identity(&current)? != grant.identity
                    || files::hash_open_file(&mut current, max_bytes())? != grant.hash
                {
                    return Err(grant_error());
                }
                Ok(())
            },
        )?;
        let mut metadata = read(scope, relative).map_err(|mut error| {
            error.path_results.extend(
                transaction
                    .results
                    .iter()
                    .filter(|entry| entry.status == "recoveryRetained")
                    .cloned(),
            );
            error
        })?;
        metadata.recovery_results = transaction
            .results
            .into_iter()
            .filter(|entry| entry.status == "recoveryRetained")
            .collect();
        return Ok(metadata);
    }
    let result = files::write_artifact_stream_verified(
        scope,
        relative,
        &mut grant.file,
        expected,
        Some(&grant.hash),
        || {
            let rebound = bind(&grant.scope, &grant.name).map_err(|_| grant_error())?;
            let mut current = open(&rebound).map_err(|_| grant_error())?;
            if identity(&current)? != grant.identity
                || files::hash_open_file(&mut current, max_bytes())? != grant.hash
            {
                return Err(grant_error());
            }
            Ok(())
        },
    )
    .map_err(map_write_error)?;
    let mut metadata = read(scope, relative).map_err(|mut error| {
        error
            .path_results
            .extend(result.recovery_results.iter().cloned());
        error
    })?;
    metadata.recovery_results = result.recovery_results;
    Ok(metadata)
}

pub fn passive_png(scope: &WorkspaceScope, relative: &str) -> WorkspaceResult<Vec<u8>> {
    let unsupported = || {
        issue(
            "artifact_open_unsupported",
            "Only verified passive PNG images can be opened externally; reveal other artifacts.",
        )
    };
    if !relative.to_ascii_lowercase().ends_with(".png") {
        return Err(unsupported());
    }
    let mut bytes = Vec::new();
    snapshot(scope, relative, &mut bytes)?;
    let mut decoder = png::Decoder::new_with_limits(
        Cursor::new(bytes),
        png::Limits {
            bytes: max_bytes() as usize,
        },
    );
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|_| unsupported())?;
    let size = reader
        .output_buffer_size()
        .filter(|size| *size <= max_bytes() as usize)
        .ok_or_else(unsupported)?;
    let mut decoded = vec![0; size];
    let info = reader.next_frame(&mut decoded).map_err(|_| unsupported())?;
    reader.finish().map_err(|_| unsupported())?;
    // Re-encode only image pixels. No scripts, ancillary chunks, or trailing polyglot data reach the opener.
    let mut passive = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut passive, info.width, info.height);
        encoder.set_color(info.color_type);
        encoder.set_depth(info.bit_depth);
        let mut writer = encoder.write_header().map_err(|_| unsupported())?;
        writer
            .write_image_data(&decoded[..info.buffer_size()])
            .map_err(|_| unsupported())?;
        writer.finish().map_err(|_| unsupported())?;
    }
    Ok(passive)
}

#[tauri::command]
pub async fn dialog_choose_import_artifact(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    grants: State<'_, ArtifactGrantState>,
) -> WorkspaceResult<Option<ArtifactSourceSelection>> {
    let binding = state.active_binding()?;
    let Some(selected) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    if !state.binding_is_current(&binding)? {
        return Err(grant_error());
    }
    let path = selected.into_path().map_err(|_| grant_error())?;
    grant_source(&path, binding.generation, &grants).map(Some)
}

#[tauri::command]
pub fn workspace_read_artifact(
    relative_path: String,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<WorkspaceArtifactMetadata> {
    super::with_scope(&state, |scope| read(scope, &relative_path))
}
#[tauri::command]
pub fn workspace_read_text_artifact(
    relative_path: String,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceReadResult> {
    super::with_scope(&state, |scope| read_text(scope, &relative_path))
}
#[tauri::command]
pub fn workspace_write_text_artifact(
    relative_path: String,
    text: String,
    expected_current_hash: Option<String>,
    state: State<'_, WorkspaceState>,
) -> WorkspaceResult<files::WorkspaceWriteResult> {
    super::with_scope(&state, |scope| {
        write_text(
            scope,
            &relative_path,
            &text,
            expected_current_hash.as_deref(),
        )
    })
}
#[tauri::command]
pub fn workspace_import_artifact(
    relative_path: String,
    source_grant_token: String,
    package_snapshot_token: Option<String>,
    state: State<'_, WorkspaceState>,
    grants: State<'_, ArtifactGrantState>,
    snapshots: State<'_, super::package_hash::PackageSnapshotState>,
) -> WorkspaceResult<WorkspaceArtifactMetadata> {
    workspace_replace_artifact(
        relative_path,
        source_grant_token,
        None,
        package_snapshot_token,
        state,
        grants,
        snapshots,
    )
}
#[tauri::command]
pub fn workspace_replace_artifact(
    relative_path: String,
    source_grant_token: String,
    expected_current_hash: Option<String>,
    package_snapshot_token: Option<String>,
    state: State<'_, WorkspaceState>,
    grants: State<'_, ArtifactGrantState>,
    snapshots: State<'_, super::package_hash::PackageSnapshotState>,
) -> WorkspaceResult<WorkspaceArtifactMetadata> {
    let active = state.active.lock().map_err(|_| super::state_error())?;
    let active = active
        .as_ref()
        .ok_or_else(|| issue("workspace_not_selected", "Select a workspace first."))?;
    let captured = package_snapshot_token
        .as_deref()
        .map(|token| {
            super::package_hash::take_for_git(&snapshots, &active.scope, active.generation, token)
        })
        .transpose()?;
    if captured.is_none() {
        return import(
            &active.scope,
            active.generation,
            &grants,
            &relative_path,
            &source_grant_token,
            expected_current_hash.as_deref(),
        );
    }
    import_captured(
        &active.scope,
        active.generation,
        &grants,
        &relative_path,
        &source_grant_token,
        expected_current_hash.as_deref(),
        captured.as_ref(),
    )
}
#[tauri::command]
pub fn workspace_reveal_artifact(
    relative_path: String,
    state: State<'_, WorkspaceState>,
    app: AppHandle,
) -> WorkspaceResult<()> {
    super::with_scope(&state, |scope| {
        read(scope, &relative_path)?;
        let path = crate::platform_paths::public_path(&scope.root_path()?.join(&relative_path))
            .map_err(|error| issue("artifact_reveal_failed", error.to_string()))?;
        app.opener()
            .reveal_item_in_dir(path)
            .map_err(|error| issue("artifact_reveal_failed", error.to_string()))
    })
}
#[tauri::command]
pub fn workspace_open_artifact(
    relative_path: String,
    state: State<'_, WorkspaceState>,
    grants: State<'_, ArtifactGrantState>,
    app: AppHandle,
) -> WorkspaceResult<()> {
    super::with_scope(&state, |scope| {
        let bytes = passive_png(scope, &relative_path)?;
        let temporary = tempfile::tempdir().map_err(io)?;
        let path = temporary.path().join("artifact.png");
        std::fs::write(&path, bytes).map_err(io)?;
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|error| issue("artifact_open_failed", error.to_string()))?;
        grants
            .opened
            .lock()
            .map_err(|_| super::state_error())?
            .push(temporary);
        Ok(())
    })
}
