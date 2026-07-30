use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use getrandom::fill as random_fill;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

const SETUP_SCHEMA_VERSION: u32 = 1;
const READY_FILE: &str = "setup-ready-v1.json";
const RECENT_FILE: &str = "recent-workspaces-v1.json";
const MAX_RECENT_BYTES: u64 = 64 * 1024;
const MAX_RESOURCE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LOG_LINE_BYTES: usize = 4 * 1024;
const MAX_LOG_BYTES: usize = 256 * 1024;
const MAX_RENDERER_LINES: usize = 500;
const MAX_SAVED_RUNS: usize = 20;
static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupError {
    pub code: &'static str,
    pub message: String,
}

type SetupResult<T> = Result<T, SetupError>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IntegrityEntry {
    pub(crate) path: String,
    pub(crate) sha256: String,
    pub(crate) max_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IntegrityManifest {
    pub(crate) schema_version: u32,
    pub(crate) files: Vec<IntegrityEntry>,
}

#[derive(Clone, Debug)]
pub(crate) struct SetupPaths {
    pub(crate) app_data: PathBuf,
    pub(crate) resource_root: PathBuf,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SetupStageStatus {
    Pending,
    Running,
    Succeeded,
    Skipped,
    Failed,
}

impl SetupStageStatus {
    #[cfg(test)]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Skipped => "skipped",
            Self::Failed => "failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SetupRunStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStage {
    pub id: &'static str,
    pub label: &'static str,
    pub status: SetupStageStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupFailure {
    code: &'static str,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupSnapshot {
    pub run_id: String,
    pub sequence: u64,
    pub started_at: u64,
    pub status: SetupRunStatus,
    pub cancellable: bool,
    pub current_stage_id: Option<&'static str>,
    pub stages: Vec<SetupStage>,
    pub logs: Vec<String>,
    pub failure: Option<SetupFailure>,
    pub saved_log_available: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SetupEvent {
    Manifest {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        started_at: u64,
        cancellable: bool,
        stages: Vec<SetupStageDefinition>,
    },
    Stage {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        stage_id: &'static str,
        status: SetupStageStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Log {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        line: String,
    },
    Complete {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        duration_ms: u64,
    },
    Failed {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        duration_ms: u64,
        code: &'static str,
        message: String,
    },
    Cancelled {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        duration_ms: u64,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStageDefinition {
    id: &'static str,
    label: &'static str,
}

const STAGES: [(&str, &str); 5] = [
    ("app-data", "Prepare application data"),
    ("resources", "Verify bundled resources"),
    ("git", "Detect Git"),
    ("workspace", "Restore workspace"),
    ("ready", "Verify readiness"),
];

type GitProbe = dyn Fn() -> Result<String, String> + Send + Sync;

pub(crate) struct SetupServices {
    git_probe: Box<GitProbe>,
}

impl SetupServices {
    pub(crate) fn new(probe: impl Fn() -> Result<String, String> + Send + Sync + 'static) -> Self {
        Self {
            git_probe: Box::new(probe),
        }
    }
}

#[derive(Clone)]
struct ActiveRun {
    run_id: String,
    cancellation: Arc<AtomicBool>,
    snapshot: SetupSnapshot,
}

#[derive(Default, Clone)]
pub struct SetupState {
    active: Arc<Mutex<Option<ActiveRun>>>,
    logs: Arc<Mutex<VecDeque<(String, PathBuf)>>>,
}

impl SetupState {
    pub(crate) fn install_active_run(
        &self,
        run_id: &str,
        cancellation: Arc<AtomicBool>,
    ) -> SetupResult<()> {
        validate_run_id(run_id)?;
        let mut active = self.lock_active()?;
        *active = Some(ActiveRun {
            run_id: run_id.to_owned(),
            cancellation,
            snapshot: initial_snapshot(run_id, now_ms()),
        });
        Ok(())
    }

    pub(crate) fn cancel(&self, run_id: &str) -> SetupResult<bool> {
        validate_run_id(run_id)?;
        let active = self.lock_active()?;
        let Some(active) = active.as_ref().filter(|active| active.run_id == run_id) else {
            return Ok(false);
        };
        if active.snapshot.status != SetupRunStatus::Running || !active.snapshot.cancellable {
            return Ok(false);
        }
        active.cancellation.store(true, Ordering::SeqCst);
        Ok(true)
    }

    fn snapshot(&self) -> SetupResult<Option<SetupSnapshot>> {
        Ok(self
            .lock_active()?
            .as_ref()
            .map(|active| active.snapshot.clone()))
    }

    fn record(&self, event: &SetupEvent) -> SetupResult<()> {
        let mut active = self.lock_active()?;
        let Some(active) = active.as_mut() else {
            return Ok(());
        };
        apply_event_to_snapshot(&mut active.snapshot, event);
        Ok(())
    }

    fn remember_log(&self, run_id: &str, path: PathBuf) -> SetupResult<()> {
        let mut logs = self.logs.lock().map_err(|_| {
            setup_error("setup_state_unavailable", "Setup log state is unavailable.")
        })?;
        logs.retain(|(known, _)| known != run_id);
        logs.push_back((run_id.to_owned(), path));
        while logs.len() > MAX_SAVED_RUNS {
            logs.pop_front();
        }
        Ok(())
    }

    fn log_for(&self, run_id: &str) -> SetupResult<Option<PathBuf>> {
        validate_run_id(run_id)?;
        let logs = self.logs.lock().map_err(|_| {
            setup_error("setup_state_unavailable", "Setup log state is unavailable.")
        })?;
        Ok(logs
            .iter()
            .find(|(known, _)| known == run_id)
            .map(|(_, path)| path.clone()))
    }

    fn lock_active(&self) -> SetupResult<std::sync::MutexGuard<'_, Option<ActiveRun>>> {
        self.active
            .lock()
            .map_err(|_| setup_error("setup_state_unavailable", "Setup state is unavailable."))
    }
}

pub(crate) struct BoundedSetupLog {
    #[cfg(test)]
    path: PathBuf,
    file: File,
    lines: VecDeque<String>,
    persisted_bytes: usize,
    full: bool,
}

impl BoundedSetupLog {
    pub(crate) fn create(app_data: &Path, run_id: &str, timestamp: u64) -> SetupResult<Self> {
        validate_run_id(run_id)?;
        ensure_private_directory(app_data)?;
        let root = app_data.join("setup-logs");
        ensure_private_directory(&root)?;
        let path = root.join(format!("{timestamp}-{run_id}.log"));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(&path)
            .map_err(|error| io_error("setup_log_create_failed", error))?;
        Ok(Self {
            #[cfg(test)]
            path,
            file,
            lines: VecDeque::new(),
            persisted_bytes: 0,
            full: false,
        })
    }

    pub(crate) fn push(&mut self, input: &str) -> String {
        let line = redact_log_line(input);
        if !self.full {
            let required = line.len().saturating_add(1);
            if self.persisted_bytes.saturating_add(required) <= MAX_LOG_BYTES
                && self.file.write_all(line.as_bytes()).is_ok()
                && self.file.write_all(b"\n").is_ok()
            {
                self.persisted_bytes += required;
                let _ = self.file.flush();
            } else {
                self.full = true;
            }
        }
        self.lines.push_back(line.clone());
        while self.lines.len() > MAX_RENDERER_LINES {
            self.lines.pop_front();
        }
        line
    }

    #[cfg(test)]
    pub(crate) fn lines(&self) -> Vec<String> {
        self.lines.iter().cloned().collect()
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

pub(crate) fn redact_log_line(input: &str) -> String {
    let one_line = input.lines().next().unwrap_or_default();
    let lower = one_line.to_ascii_lowercase();
    if ["prompt:", "command:", "nodes:", "workflow:"]
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return "[workflow content redacted]".to_owned();
    }

    let mut value = one_line.to_owned();
    if let Some(query) = value.find('?') {
        let prefix = &value[..query];
        if prefix.contains("://") {
            value = format!("{prefix}?[REDACTED]");
        }
    }
    let lower = value.to_ascii_lowercase();
    for key in [
        "authorization",
        "access_token",
        "refresh_token",
        "token",
        "api_key",
        "apikey",
    ] {
        if let Some(index) = lower.find(key) {
            let end = value[index..]
                .find([':', '='])
                .map(|offset| index + offset)
                .unwrap_or(index + key.len());
            value.truncate(end + usize::from(end < value.len()));
            value.push_str("[REDACTED]");
            break;
        }
    }
    truncate_utf8(value, MAX_LOG_LINE_BYTES)
}

pub(crate) fn verify_resource_tree(root: &Path, manifest: &IntegrityManifest) -> SetupResult<()> {
    if manifest.schema_version != 1 || manifest.files.is_empty() {
        return Err(setup_error(
            "setup_integrity_manifest_invalid",
            "The bundled resource integrity manifest is invalid.",
        ));
    }
    let mut expected = HashMap::new();
    for entry in &manifest.files {
        if !safe_resource_path(&entry.path)
            || entry.max_bytes == 0
            || entry.max_bytes > MAX_RESOURCE_BYTES
            || !is_sha256(&entry.sha256)
            || expected.insert(entry.path.as_str(), entry).is_some()
        {
            return Err(setup_error(
                "setup_integrity_manifest_invalid",
                "The bundled resource integrity manifest is invalid.",
            ));
        }
    }

    let mut found = HashSet::new();
    for top in ["contracts", "examples", "brands"] {
        let directory = root.join(top);
        walk_resources(root, &directory, &expected, &mut found)?;
    }
    if found.len() != expected.len() {
        return Err(setup_error(
            "setup_resource_missing",
            "A required bundled resource is missing.",
        ));
    }
    Ok(())
}

fn walk_resources<'a>(
    root: &Path,
    directory: &Path,
    expected: &HashMap<&'a str, &'a IntegrityEntry>,
    found: &mut HashSet<&'a str>,
) -> SetupResult<()> {
    let metadata = fs::symlink_metadata(directory).map_err(|_| {
        setup_error(
            "setup_resource_missing",
            "A bundled resource directory is missing.",
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(setup_error(
            "setup_resource_invalid_type",
            "Bundled resource directories must be regular directories.",
        ));
    }
    for entry in
        fs::read_dir(directory).map_err(|error| io_error("setup_resource_read_failed", error))?
    {
        let entry = entry.map_err(|error| io_error("setup_resource_read_failed", error))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| io_error("setup_resource_read_failed", error))?;
        if metadata.file_type().is_symlink() {
            return Err(setup_error(
                "setup_resource_invalid_type",
                "Bundled resources cannot contain symbolic links.",
            ));
        }
        if metadata.is_dir() {
            walk_resources(root, &path, expected, found)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(setup_error(
                "setup_resource_invalid_type",
                "Bundled resources must be regular files.",
            ));
        }
        let relative = path.strip_prefix(root).map_err(|_| {
            setup_error(
                "setup_resource_scope_invalid",
                "Bundled resources escaped their resource root.",
            )
        })?;
        let relative = relative
            .to_str()
            .ok_or_else(|| {
                setup_error(
                    "setup_resource_path_invalid",
                    "Bundled resource paths must be Unicode.",
                )
            })?
            .replace('\\', "/");
        let Some(expected_entry) = expected.get(relative.as_str()).copied() else {
            return Err(setup_error(
                "setup_resource_unexpected",
                "An unexpected bundled resource was found.",
            ));
        };
        if metadata.len() > expected_entry.max_bytes {
            return Err(setup_error(
                "setup_resource_too_large",
                "A bundled resource exceeds its committed size limit.",
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        File::open(&path)
            .and_then(|file| {
                file.take(expected_entry.max_bytes + 1)
                    .read_to_end(&mut bytes)
            })
            .map_err(|error| io_error("setup_resource_read_failed", error))?;
        if bytes.len() as u64 > expected_entry.max_bytes {
            return Err(setup_error(
                "setup_resource_too_large",
                "A bundled resource exceeds its committed size limit.",
            ));
        }
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if actual != expected_entry.sha256 {
            return Err(setup_error(
                "setup_resource_digest_mismatch",
                "A bundled resource did not match its committed digest.",
            ));
        }
        found.insert(expected_entry.path.as_str());
    }
    Ok(())
}

pub(crate) fn load_remembered_workspace(app_data: &Path) -> SetupResult<Option<PathBuf>> {
    let path = app_data.join(RECENT_FILE);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("setup_workspace_record_failed", error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_RECENT_BYTES
    {
        return Ok(None);
    }
    let mut text = String::new();
    File::open(path)
        .and_then(|file| file.take(MAX_RECENT_BYTES + 1).read_to_string(&mut text))
        .map_err(|error| io_error("setup_workspace_record_failed", error))?;
    let records: Vec<RecentWorkspace> = match serde_json::from_str(&text) {
        Ok(records) => records,
        Err(_) => return Ok(None),
    };
    for record in records {
        let requested = PathBuf::from(record.root_path);
        let Ok(canonical) = requested.canonicalize() else {
            continue;
        };
        if canonical == requested && canonical.is_dir() {
            return Ok(Some(canonical));
        }
    }
    Ok(None)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentWorkspace {
    root_path: String,
    #[allow(dead_code)]
    last_opened_at: String,
}

pub(crate) fn atomic_persist_readiness(
    app_data: &Path,
    schema_version: u32,
    app_version: &str,
) -> SetupResult<()> {
    ensure_private_directory(app_data)?;
    let destination = app_data.join(READY_FILE);
    reject_non_regular_destination(&destination)?;
    let temporary = app_data.join(format!(
        ".setup-ready-{}-{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let bytes = serde_json::to_vec(&ReadinessRecord {
        schema_version,
        app_version,
    })
    .map_err(|_| {
        setup_error(
            "setup_ready_write_failed",
            "Setup readiness could not be encoded.",
        )
    })?;
    let result = (|| -> SetupResult<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| io_error("setup_ready_write_failed", error))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| io_error("setup_ready_write_failed", error))?;
        drop(file);
        fs::rename(&temporary, &destination)
            .map_err(|error| io_error("setup_ready_write_failed", error))?;
        sync_directory(app_data)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadinessRecord<'a> {
    schema_version: u32,
    #[serde(borrow)]
    app_version: &'a str,
}

fn is_ready(app_data: &Path, app_version: &str) -> bool {
    let path = app_data.join(READY_FILE);
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return false;
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 4_096 {
        return false;
    }
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    let Ok(record) = serde_json::from_slice::<ReadinessRecord<'_>>(&bytes) else {
        return false;
    };
    record.schema_version == SETUP_SCHEMA_VERSION && record.app_version == app_version
}

pub(crate) fn run_setup(
    paths: &SetupPaths,
    run_id: &str,
    app_version: &str,
    manifest: &IntegrityManifest,
    cancelled: &AtomicBool,
    services: &SetupServices,
    sink: &(dyn Fn(&SetupEvent) + Sync),
) -> SetupResult<SetupSnapshot> {
    validate_run_id(run_id)?;
    let started_at = now_ms();
    let started = Instant::now();
    let mut snapshot = initial_snapshot(run_id, started_at);
    let mut sequence = 1;
    emit_and_apply(
        &mut snapshot,
        manifest_event(run_id, sequence, started_at),
        sink,
    );
    let mut log: Option<BoundedSetupLog> = None;

    for (index, (stage_id, _)) in STAGES.iter().enumerate() {
        if cancelled.load(Ordering::SeqCst) {
            sequence += 1;
            emit_and_apply(
                &mut snapshot,
                SetupEvent::Cancelled {
                    run_id: run_id.to_owned(),
                    sequence,
                    timestamp: now_ms(),
                    duration_ms: elapsed_ms(started),
                },
                sink,
            );
            return Ok(snapshot);
        }
        sequence += 1;
        emit_and_apply(
            &mut snapshot,
            stage_event(
                run_id,
                sequence,
                stage_id,
                SetupStageStatus::Running,
                None,
                None,
            ),
            sink,
        );
        let stage_started = Instant::now();
        let outcome: SetupResult<(SetupStageStatus, String)> = match *stage_id {
            "app-data" => (|| {
                ensure_private_directory(&paths.app_data)?;
                let created = BoundedSetupLog::create(&paths.app_data, run_id, started_at)?;
                log = Some(created);
                Ok((
                    SetupStageStatus::Succeeded,
                    "Private application data is ready.".to_owned(),
                ))
            })(),
            "resources" => verify_resource_tree(&paths.resource_root, manifest).map(|_| {
                (
                    SetupStageStatus::Succeeded,
                    "Bundled resources match their committed digests.".to_owned(),
                )
            }),
            "git" => match (services.git_probe)() {
                Ok(version) => Ok((
                    SetupStageStatus::Succeeded,
                    format!("Git is available ({version})."),
                )),
                Err(_) => Ok((
                    SetupStageStatus::Skipped,
                    "Git is unavailable; local version control remains optional.".to_owned(),
                )),
            },
            "workspace" => {
                load_remembered_workspace(&paths.app_data).map(|workspace| match workspace {
                    Some(_) => (
                        SetupStageStatus::Succeeded,
                        "A valid app-owned remembered workspace is available.".to_owned(),
                    ),
                    None => (
                        SetupStageStatus::Skipped,
                        "Workspace selection is required after setup.".to_owned(),
                    ),
                })
            }
            "ready" => atomic_persist_readiness(&paths.app_data, SETUP_SCHEMA_VERSION, app_version)
                .map(|_| {
                    (
                        SetupStageStatus::Succeeded,
                        "Setup readiness was persisted atomically.".to_owned(),
                    )
                }),
            _ => unreachable!(),
        };
        let (status, message) = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                sequence += 1;
                emit_and_apply(
                    &mut snapshot,
                    stage_event(
                        run_id,
                        sequence,
                        stage_id,
                        SetupStageStatus::Failed,
                        Some(elapsed_ms(stage_started)),
                        Some(error.message.clone()),
                    ),
                    sink,
                );
                if let Some(log) = log.as_mut() {
                    sequence += 1;
                    emit_log(
                        &mut snapshot,
                        log,
                        run_id,
                        &mut sequence,
                        &error.message,
                        sink,
                    );
                }
                sequence += 1;
                emit_and_apply(
                    &mut snapshot,
                    SetupEvent::Failed {
                        run_id: run_id.to_owned(),
                        sequence,
                        timestamp: now_ms(),
                        duration_ms: elapsed_ms(started),
                        code: error.code,
                        message: error.message.clone(),
                    },
                    sink,
                );
                return Err(error);
            }
        };
        sequence += 1;
        emit_and_apply(
            &mut snapshot,
            stage_event(
                run_id,
                sequence,
                stage_id,
                status,
                Some(elapsed_ms(stage_started)),
                Some(message.clone()),
            ),
            sink,
        );
        if let Some(log) = log.as_mut() {
            sequence += 1;
            emit_log(&mut snapshot, log, run_id, &mut sequence, &message, sink);
        }
        if index == STAGES.len() - 1 && cancelled.load(Ordering::SeqCst) {
            sequence += 1;
            emit_and_apply(
                &mut snapshot,
                SetupEvent::Cancelled {
                    run_id: run_id.to_owned(),
                    sequence,
                    timestamp: now_ms(),
                    duration_ms: elapsed_ms(started),
                },
                sink,
            );
            return Ok(snapshot);
        }
    }

    sequence += 1;
    emit_and_apply(
        &mut snapshot,
        SetupEvent::Complete {
            run_id: run_id.to_owned(),
            sequence,
            timestamp: now_ms(),
            duration_ms: elapsed_ms(started),
        },
        sink,
    );
    Ok(snapshot)
}

fn emit_log(
    snapshot: &mut SetupSnapshot,
    log: &mut BoundedSetupLog,
    run_id: &str,
    sequence: &mut u64,
    message: &str,
    sink: &(dyn Fn(&SetupEvent) + Sync),
) {
    let line = log.push(message);
    emit_and_apply(
        snapshot,
        SetupEvent::Log {
            run_id: run_id.to_owned(),
            sequence: *sequence,
            timestamp: now_ms(),
            line,
        },
        sink,
    );
}

fn emit_and_apply(
    snapshot: &mut SetupSnapshot,
    event: SetupEvent,
    sink: &(dyn Fn(&SetupEvent) + Sync),
) {
    apply_event_to_snapshot(snapshot, &event);
    sink(&event);
}

fn apply_event_to_snapshot(snapshot: &mut SetupSnapshot, event: &SetupEvent) {
    let (run_id, sequence) = event_identity(event);
    if snapshot.run_id != run_id || *sequence < snapshot.sequence {
        return;
    }
    snapshot.sequence = *sequence;
    match event {
        SetupEvent::Manifest { .. } => {}
        SetupEvent::Stage {
            stage_id,
            status,
            duration_ms,
            message,
            ..
        } => {
            if let Some(stage) = snapshot
                .stages
                .iter_mut()
                .find(|stage| stage.id == *stage_id)
            {
                stage.status = *status;
                stage.duration_ms = *duration_ms;
                stage.message.clone_from(message);
            }
            snapshot.current_stage_id = (*status == SetupStageStatus::Running).then_some(*stage_id);
        }
        SetupEvent::Log { line, .. } => {
            snapshot.logs.push(line.clone());
            if snapshot.logs.len() > MAX_RENDERER_LINES {
                snapshot.logs.remove(0);
            }
            snapshot.saved_log_available = true;
        }
        SetupEvent::Complete { .. } => {
            snapshot.status = SetupRunStatus::Succeeded;
            snapshot.cancellable = false;
            snapshot.current_stage_id = None;
        }
        SetupEvent::Failed { code, message, .. } => {
            snapshot.status = SetupRunStatus::Failed;
            snapshot.cancellable = false;
            snapshot.current_stage_id = None;
            snapshot.failure = Some(SetupFailure {
                code,
                message: message.clone(),
            });
        }
        SetupEvent::Cancelled { .. } => {
            snapshot.status = SetupRunStatus::Cancelled;
            snapshot.cancellable = false;
            snapshot.current_stage_id = None;
        }
    }
}

fn event_identity(event: &SetupEvent) -> (&str, &u64) {
    match event {
        SetupEvent::Manifest {
            run_id, sequence, ..
        }
        | SetupEvent::Stage {
            run_id, sequence, ..
        }
        | SetupEvent::Log {
            run_id, sequence, ..
        }
        | SetupEvent::Complete {
            run_id, sequence, ..
        }
        | SetupEvent::Failed {
            run_id, sequence, ..
        }
        | SetupEvent::Cancelled {
            run_id, sequence, ..
        } => (run_id, sequence),
    }
}

fn initial_snapshot(run_id: &str, started_at: u64) -> SetupSnapshot {
    SetupSnapshot {
        run_id: run_id.to_owned(),
        sequence: 0,
        started_at,
        status: SetupRunStatus::Running,
        cancellable: true,
        current_stage_id: None,
        stages: STAGES
            .iter()
            .map(|(id, label)| SetupStage {
                id,
                label,
                status: SetupStageStatus::Pending,
                duration_ms: None,
                message: None,
            })
            .collect(),
        logs: Vec::new(),
        failure: None,
        saved_log_available: false,
    }
}

fn manifest_event(run_id: &str, sequence: u64, started_at: u64) -> SetupEvent {
    SetupEvent::Manifest {
        run_id: run_id.to_owned(),
        sequence,
        timestamp: now_ms(),
        started_at,
        cancellable: true,
        stages: STAGES
            .iter()
            .map(|(id, label)| SetupStageDefinition { id, label })
            .collect(),
    }
}

fn stage_event(
    run_id: &str,
    sequence: u64,
    stage_id: &'static str,
    status: SetupStageStatus,
    duration_ms: Option<u64>,
    message: Option<String>,
) -> SetupEvent {
    SetupEvent::Stage {
        run_id: run_id.to_owned(),
        sequence,
        timestamp: now_ms(),
        stage_id,
        status,
        duration_ms,
        message,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatusResponse {
    ready: bool,
    snapshot: Option<SetupSnapshot>,
}

#[tauri::command]
pub fn setup_status(
    app: AppHandle,
    state: State<'_, SetupState>,
) -> SetupResult<SetupStatusResponse> {
    let app_data = app.path().app_data_dir().map_err(|error| {
        setup_error(
            "setup_path_unavailable",
            format!("Application data is unavailable: {error}"),
        )
    })?;
    Ok(SetupStatusResponse {
        ready: is_ready(&app_data, app.package_info().version.to_string().as_str()),
        snapshot: state.snapshot()?,
    })
}

#[tauri::command]
pub fn setup_start(app: AppHandle, state: State<'_, SetupState>) -> SetupResult<SetupSnapshot> {
    if let Some(snapshot) = state
        .snapshot()?
        .filter(|snapshot| snapshot.status == SetupRunStatus::Running)
    {
        return Ok(snapshot);
    }
    let paths = resolve_setup_paths(&app)?;
    let manifest: IntegrityManifest = serde_json::from_str(include_str!(
        "../resources/setup-integrity-v1.json"
    ))
    .map_err(|_| {
        setup_error(
            "setup_integrity_manifest_invalid",
            "The committed setup integrity manifest is invalid.",
        )
    })?;
    let version = app.package_info().version.to_string();
    let run_id = opaque_run_id()?;
    let cancellation = Arc::new(AtomicBool::new(false));
    let owned_state = state.inner().clone();
    owned_state.install_active_run(&run_id, cancellation.clone())?;
    let initial = owned_state.snapshot()?.expect("active run installed");
    let app_for_run = app.clone();
    let run_id_for_run = run_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let git_root = paths.app_data.clone();
        let services = SetupServices::new(move || crate::git::probe_version(&git_root));
        let sink = |event: &SetupEvent| {
            let _ = owned_state.record(event);
            let _ = app_for_run.emit("setup://event", event);
        };
        let result = run_setup(
            &paths,
            &run_id_for_run,
            &version,
            &manifest,
            &cancellation,
            &services,
            &sink,
        );
        if let Ok(log_path) = setup_log_path(&paths.app_data, &run_id_for_run) {
            let _ = owned_state.remember_log(&run_id_for_run, log_path);
        }
        if let Err(error) = result {
            let _ = app_for_run.emit("setup://error", error);
        }
    });
    Ok(initial)
}

#[tauri::command]
pub fn setup_cancel(run_id: String, state: State<'_, SetupState>) -> SetupResult<bool> {
    state.cancel(&run_id)
}

#[tauri::command]
pub fn setup_open_log(run_id: String, state: State<'_, SetupState>) -> SetupResult<()> {
    let path = state.log_for(&run_id)?.ok_or_else(|| {
        setup_error(
            "setup_log_not_found",
            "No saved setup log is available for this run.",
        )
    })?;
    let metadata =
        fs::symlink_metadata(&path).map_err(|error| io_error("setup_log_read_failed", error))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_LOG_BYTES as u64
    {
        return Err(setup_error(
            "setup_log_invalid",
            "The saved setup log is invalid.",
        ));
    }
    path.to_str().ok_or_else(|| {
        setup_error(
            "setup_log_path_invalid",
            "The saved setup log path is not Unicode.",
        )
    })?;
    open::that_detached(&path).map_err(|error| {
        setup_error(
            "setup_log_open_failed",
            format!("The saved setup log could not be opened: {error}"),
        )
    })
}

fn resolve_setup_paths(app: &AppHandle) -> SetupResult<SetupPaths> {
    let app_data = app.path().app_data_dir().map_err(|error| {
        setup_error(
            "setup_path_unavailable",
            format!("Application data is unavailable: {error}"),
        )
    })?;
    let resource_dir = app.path().resource_dir().map_err(|error| {
        setup_error(
            "setup_resource_root_unavailable",
            format!("Installed resources are unavailable: {error}"),
        )
    })?;
    let resource_root = [resource_dir.clone(), resource_dir.join("_up_")]
        .into_iter()
        .find(|candidate| {
            candidate.join("contracts").is_dir()
                && candidate.join("examples").is_dir()
                && candidate.join("brands").is_dir()
        })
        .ok_or_else(|| {
            setup_error(
                "setup_resource_root_unavailable",
                "The installed Tauri resource root is unavailable.",
            )
        })?;
    Ok(SetupPaths {
        app_data,
        resource_root,
    })
}

fn setup_log_path(app_data: &Path, run_id: &str) -> SetupResult<PathBuf> {
    validate_run_id(run_id)?;
    let root = app_data.join("setup-logs");
    let suffix = format!("-{run_id}.log");
    let mut found = None;
    for entry in fs::read_dir(&root).map_err(|error| io_error("setup_log_read_failed", error))? {
        let entry = entry.map_err(|error| io_error("setup_log_read_failed", error))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.ends_with(&suffix) {
            if found.is_some() {
                return Err(setup_error(
                    "setup_log_invalid",
                    "Multiple setup logs matched one run.",
                ));
            }
            found = Some(entry.path());
        }
    }
    found.ok_or_else(|| setup_error("setup_log_not_found", "The setup log was not found."))
}

fn ensure_private_directory(path: &Path) -> SetupResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(setup_error(
                "setup_app_data_invalid",
                "Application data must be a regular private directory.",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path).map_err(|error| io_error("setup_app_data_failed", error))?;
        }
        Err(error) => return Err(io_error("setup_app_data_failed", error)),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| io_error("setup_app_data_failed", error))?;
    }
    Ok(())
}

fn reject_non_regular_destination(path: &Path) -> SetupResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(setup_error(
                "setup_ready_destination_invalid",
                "Setup readiness cannot replace a non-regular file.",
            ))
        }
        Ok(_) | Err(_) if !path.exists() => Ok(()),
        Ok(_) => Ok(()),
        Err(error) => Err(io_error("setup_ready_write_failed", error)),
    }
}

fn safe_resource_path(value: &str) -> bool {
    !value.is_empty()
        && !value.contains('\\')
        && matches!(
            value.split('/').next(),
            Some("contracts" | "examples" | "brands")
        )
        && Path::new(value)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn validate_run_id(run_id: &str) -> SetupResult<()> {
    if run_id.is_empty()
        || run_id.len() > 64
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(setup_error(
            "setup_run_id_invalid",
            "Setup run IDs must be opaque native-issued identifiers.",
        ));
    }
    Ok(())
}

fn opaque_run_id() -> SetupResult<String> {
    let mut bytes = [0_u8; 16];
    random_fill(&mut bytes).map_err(|error| {
        setup_error(
            "setup_run_id_failed",
            format!("A secure setup run ID could not be created: {error}"),
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn truncate_utf8(mut value: String, max: usize) -> String {
    if value.len() <= max {
        return value;
    }
    let mut boundary = max.saturating_sub(3);
    while !value.is_char_boundary(boundary) {
        boundary = boundary.saturating_sub(1);
    }
    value.truncate(boundary);
    value.push_str("...");
    value
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> SetupResult<()> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| io_error("setup_ready_write_failed", error))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> SetupResult<()> {
    Ok(())
}

fn setup_error(code: &'static str, message: impl Into<String>) -> SetupError {
    SetupError {
        code,
        message: message.into(),
    }
}

fn io_error(code: &'static str, error: std::io::Error) -> SetupError {
    setup_error(code, format!("Setup operation failed: {error}"))
}
