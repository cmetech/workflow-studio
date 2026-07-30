use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use cap_std::ambient_authority;
use cap_std::fs::{Dir, File as CapabilityFile, OpenOptions as CapabilityOpenOptions};
use getrandom::fill as random_fill;
use same_file::Handle;
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
const MAX_SAVED_LOG_BYTES: u64 = 2 * 1024 * 1024;
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
type LogRegistry = dyn Fn(Vec<SavedSetupLog>) -> SetupResult<()> + Send + Sync;

pub(crate) struct SetupServices {
    git_probe: Box<GitProbe>,
    log_registry: Box<LogRegistry>,
}

impl SetupServices {
    pub(crate) fn new(probe: impl Fn() -> Result<String, String> + Send + Sync + 'static) -> Self {
        Self {
            git_probe: Box::new(probe),
            log_registry: Box::new(|_| Ok(())),
        }
    }

    pub(crate) fn with_log_registry(
        mut self,
        registry: impl Fn(Vec<SavedSetupLog>) -> SetupResult<()> + Send + Sync + 'static,
    ) -> Self {
        self.log_registry = Box::new(registry);
        self
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
    logs: Arc<Mutex<VecDeque<(String, SavedSetupLog)>>>,
}

pub(crate) struct ActiveRunClaim {
    pub(crate) claimed: bool,
    pub(crate) snapshot: SetupSnapshot,
}

impl SetupState {
    pub(crate) fn claim_active_run(
        &self,
        run_id: &str,
        cancellation: Arc<AtomicBool>,
    ) -> SetupResult<ActiveRunClaim> {
        validate_run_id(run_id)?;
        let mut active = self.lock_active()?;
        if let Some(existing) = active
            .as_ref()
            .filter(|existing| existing.snapshot.status == SetupRunStatus::Running)
        {
            return Ok(ActiveRunClaim {
                claimed: false,
                snapshot: existing.snapshot.clone(),
            });
        }
        let snapshot = initial_snapshot(run_id, now_ms());
        *active = Some(ActiveRun {
            run_id: run_id.to_owned(),
            cancellation,
            snapshot: snapshot.clone(),
        });
        Ok(ActiveRunClaim {
            claimed: true,
            snapshot,
        })
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

    pub(crate) fn replace_logs(&self, saved: Vec<SavedSetupLog>) -> SetupResult<()> {
        let mut logs = self.logs.lock().map_err(|_| {
            setup_error("setup_state_unavailable", "Setup log state is unavailable.")
        })?;
        let mut replacement = VecDeque::new();
        let skip = saved.len().saturating_sub(MAX_SAVED_RUNS);
        for log in saved.into_iter().skip(skip) {
            let run_id = log.run_id()?;
            replacement.retain(|(known, _)| known != &run_id);
            replacement.push_back((run_id, log));
        }
        *logs = replacement;
        Ok(())
    }

    pub(crate) fn saved_log(&self, run_id: &str) -> SetupResult<Option<SavedSetupLog>> {
        validate_run_id(run_id)?;
        let logs = self.logs.lock().map_err(|_| {
            setup_error("setup_state_unavailable", "Setup log state is unavailable.")
        })?;
        Ok(logs
            .iter()
            .find(|(known, _)| known == run_id)
            .map(|(_, saved)| saved.clone()))
    }

    fn lock_active(&self) -> SetupResult<std::sync::MutexGuard<'_, Option<ActiveRun>>> {
        self.active
            .lock()
            .map_err(|_| setup_error("setup_state_unavailable", "Setup state is unavailable."))
    }
}

pub(crate) struct AppDataScope {
    root_path: PathBuf,
    parent_path: PathBuf,
    parent_identity: Handle,
    parent: Dir,
    root_name: OsString,
    root_identity: Handle,
    root: Dir,
    logs_identity: Handle,
    logs: Dir,
}

impl AppDataScope {
    pub(crate) fn bind(app_data: &Path) -> SetupResult<Arc<Self>> {
        ensure_private_directory(app_data)?;
        let root_path = app_data
            .canonicalize()
            .map_err(|error| io_error("setup_app_data_failed", error))?;
        let parent_path = root_path
            .parent()
            .ok_or_else(app_data_changed)?
            .to_path_buf();
        let root_name = root_path
            .file_name()
            .ok_or_else(app_data_changed)?
            .to_os_string();
        let parent = Dir::open_ambient_dir(&parent_path, ambient_authority())
            .map_err(|error| io_error("setup_app_data_failed", error))?;
        let root_metadata = parent
            .symlink_metadata(&root_name)
            .map_err(|error| io_error("setup_app_data_failed", error))?;
        if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
            return Err(app_data_changed());
        }
        let root = parent
            .open_dir(&root_name)
            .map_err(|error| io_error("setup_app_data_failed", error))?;
        let parent_identity = directory_identity(&parent, "setup_app_data_failed")?;
        let root_identity = directory_identity(&root, "setup_app_data_failed")?;
        #[cfg(unix)]
        {
            use cap_std::fs::Permissions;
            use std::os::unix::fs::PermissionsExt;
            parent
                .set_permissions(
                    &root_name,
                    Permissions::from_std(fs::Permissions::from_mode(0o700)),
                )
                .map_err(|error| io_error("setup_app_data_failed", error))?;
        }
        match root.symlink_metadata("setup-logs") {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(app_data_changed())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => root
                .create_dir("setup-logs")
                .map_err(|error| io_error("setup_app_data_failed", error))?,
            Err(error) => return Err(io_error("setup_app_data_failed", error)),
        }
        #[cfg(unix)]
        {
            use cap_std::fs::Permissions;
            use std::os::unix::fs::PermissionsExt;
            root.set_permissions(
                "setup-logs",
                Permissions::from_std(fs::Permissions::from_mode(0o700)),
            )
            .map_err(|error| io_error("setup_app_data_failed", error))?;
        }
        let logs = root
            .open_dir("setup-logs")
            .map_err(|error| io_error("setup_app_data_failed", error))?;
        let logs_identity = directory_identity(&logs, "setup_app_data_failed")?;
        let scope = Arc::new(Self {
            root_path,
            parent_path,
            parent_identity,
            parent,
            root_name,
            root_identity,
            root,
            logs_identity,
            logs,
        });
        scope.verify()?;
        Ok(scope)
    }

    fn verify(&self) -> SetupResult<()> {
        let current_parent =
            Handle::from_path(&self.parent_path).map_err(|_| app_data_changed())?;
        if current_parent != self.parent_identity {
            return Err(app_data_changed());
        }
        let current_root = self
            .parent
            .open_dir(&self.root_name)
            .map_err(|_| app_data_changed())?;
        if directory_identity(&current_root, "setup_app_data_changed")? != self.root_identity {
            return Err(app_data_changed());
        }
        let current_logs = self
            .root
            .open_dir("setup-logs")
            .map_err(|_| app_data_changed())?;
        if directory_identity(&current_logs, "setup_app_data_changed")? != self.logs_identity {
            return Err(app_data_changed());
        }
        Ok(())
    }

    pub(crate) fn create_log(
        self: &Arc<Self>,
        run_id: &str,
        timestamp: u64,
    ) -> SetupResult<(BoundedSetupLog, SavedSetupLog)> {
        validate_run_id(run_id)?;
        self.verify()?;
        self.prune_setup_logs(None)?;
        let name = OsString::from(format!("{timestamp}-{run_id}.log"));
        let mut options = CapabilityOpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(windows)]
        {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
            use windows_sys::Win32::Storage::FileSystem::DELETE;
            options.access_mode(GENERIC_READ | GENERIC_WRITE | DELETE);
        }
        let file = self
            .logs
            .open_with(&name, &options)
            .map_err(|error| io_error("setup_log_create_failed", error))?;
        #[cfg(unix)]
        {
            use cap_std::fs::Permissions;
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(Permissions::from_std(fs::Permissions::from_mode(0o600)))
                .map_err(|error| io_error("setup_log_create_failed", error))?;
        }
        let identity = Arc::new(file_identity(&file, "setup_log_create_failed")?);
        let saved = SavedSetupLog {
            scope: self.clone(),
            name: name.clone(),
            identity: identity.clone(),
        };
        let log = BoundedSetupLog {
            #[cfg(test)]
            path: self.root_path.join("setup-logs").join(&name),
            file,
            saved: saved.clone(),
            lines: VecDeque::new(),
            persisted_bytes: 0,
            full: false,
        };
        if let Err(error) = self.prune_setup_logs(Some(&name)) {
            drop(log);
            let _ = self.logs.remove_file(&name);
            return Err(error);
        }
        self.verify()?;
        Ok((log, saved))
    }

    pub(crate) fn load_remembered_workspace(&self) -> SetupResult<Option<PathBuf>> {
        self.load_remembered_workspace_impl(|| {})
    }

    #[cfg(all(test, unix))]
    pub(crate) fn load_remembered_workspace_with_open_hook(
        &self,
        hook: impl FnOnce(),
    ) -> SetupResult<Option<PathBuf>> {
        self.load_remembered_workspace_impl(hook)
    }

    fn load_remembered_workspace_impl(&self, hook: impl FnOnce()) -> SetupResult<Option<PathBuf>> {
        self.verify()?;
        let metadata = match self.root.symlink_metadata(RECENT_FILE) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(io_error("setup_workspace_record_failed", error)),
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > MAX_RECENT_BYTES
        {
            return Ok(None);
        }
        let file = self
            .root
            .open(RECENT_FILE)
            .map_err(|error| io_error("setup_workspace_record_failed", error))?;
        let identity = file_identity(&file, "setup_workspace_record_failed")?;
        hook();
        if !named_file_identity_matches(
            &self.root,
            OsStr::new(RECENT_FILE),
            &identity,
            MAX_RECENT_BYTES,
        ) {
            return Err(setup_error(
                "setup_workspace_record_changed",
                "The app-owned remembered workspace record changed while it was read.",
            ));
        }
        let mut text = String::new();
        file.take(MAX_RECENT_BYTES + 1)
            .read_to_string(&mut text)
            .map_err(|error| io_error("setup_workspace_record_failed", error))?;
        self.verify()?;
        if !named_file_identity_matches(
            &self.root,
            OsStr::new(RECENT_FILE),
            &identity,
            MAX_RECENT_BYTES,
        ) {
            return Err(setup_error(
                "setup_workspace_record_changed",
                "The app-owned remembered workspace record changed while it was read.",
            ));
        }
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

    pub(crate) fn persist_readiness(
        &self,
        schema_version: u32,
        app_version: &str,
    ) -> SetupResult<()> {
        self.persist_readiness_impl(schema_version, app_version, || {})
    }

    #[cfg(all(test, unix))]
    pub(crate) fn persist_readiness_with_commit_hook(
        &self,
        schema_version: u32,
        app_version: &str,
        hook: impl FnOnce(),
    ) -> SetupResult<()> {
        self.persist_readiness_impl(schema_version, app_version, hook)
    }

    fn persist_readiness_impl(
        &self,
        schema_version: u32,
        app_version: &str,
        hook: impl FnOnce(),
    ) -> SetupResult<()> {
        self.verify()?;
        let destination_identity = regular_destination_identity(&self.root, READY_FILE)?;
        let temporary = OsString::from(format!(
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
        let mut options = CapabilityOpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(windows)]
        {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
            use windows_sys::Win32::Storage::FileSystem::DELETE;
            options.access_mode(GENERIC_READ | GENERIC_WRITE | DELETE);
        }
        let result = (|| -> SetupResult<()> {
            let mut file = self
                .root
                .open_with(&temporary, &options)
                .map_err(|error| io_error("setup_ready_write_failed", error))?;
            #[cfg(unix)]
            {
                use cap_std::fs::Permissions;
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(Permissions::from_std(fs::Permissions::from_mode(0o600)))
                    .map_err(|error| io_error("setup_ready_write_failed", error))?;
            }
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|error| io_error("setup_ready_write_failed", error))?;
            hook();
            self.verify()?;
            let current_destination = regular_destination_identity(&self.root, READY_FILE)
                .map_err(|_| readiness_destination_changed())?;
            if current_destination != destination_identity {
                return Err(setup_error(
                    "setup_ready_destination_changed",
                    "Setup readiness changed before the atomic commit.",
                ));
            }
            commit_readiness(
                &self.root,
                &temporary,
                &file,
                destination_identity.is_some(),
            )?;
            sync_cap_directory(&self.root, "setup_ready_write_failed")?;
            self.verify()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = self.root.remove_file(&temporary);
        }
        result
    }

    fn readiness_matches(&self, app_version: &str) -> bool {
        if self.verify().is_err() {
            return false;
        }
        let Ok(metadata) = self.root.symlink_metadata(READY_FILE) else {
            return false;
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 4_096 {
            return false;
        }
        let Ok(file) = self.root.open(READY_FILE) else {
            return false;
        };
        let Ok(identity) = file_identity(&file, "setup_ready_read_failed") else {
            return false;
        };
        let mut bytes = Vec::new();
        if file.take(4_097).read_to_end(&mut bytes).is_err()
            || bytes.len() > 4_096
            || !named_file_identity_matches(&self.root, OsStr::new(READY_FILE), &identity, 4_096)
            || self.verify().is_err()
        {
            return false;
        }
        let Ok(record) = serde_json::from_slice::<ReadinessRecord<'_>>(&bytes) else {
            return false;
        };
        record.schema_version == SETUP_SCHEMA_VERSION && record.app_version == app_version
    }

    pub(crate) fn prune_setup_logs(
        self: &Arc<Self>,
        current: Option<&OsStr>,
    ) -> SetupResult<Vec<SavedSetupLog>> {
        self.verify()?;
        let mut logs = Vec::new();
        let mut removed = false;
        for entry in self
            .logs
            .entries()
            .map_err(|error| io_error("setup_log_prune_failed", error))?
        {
            let entry = entry.map_err(|error| io_error("setup_log_prune_failed", error))?;
            let name = entry.file_name();
            let file_type = entry
                .file_type()
                .map_err(|error| io_error("setup_log_prune_failed", error))?;
            let valid_name = parse_log_run_id(&name).is_some();
            if file_type.is_symlink() || (file_type.is_file() && !valid_name) {
                entry
                    .remove_file()
                    .map_err(|error| io_error("setup_log_prune_failed", error))?;
                removed = true;
                continue;
            }
            if !file_type.is_file() {
                return Err(setup_error(
                    "setup_log_invalid",
                    "The private setup log directory contains an unexpected entry.",
                ));
            }
            let metadata = entry
                .metadata()
                .map_err(|error| io_error("setup_log_prune_failed", error))?;
            if metadata.len() > MAX_LOG_BYTES as u64 {
                entry
                    .remove_file()
                    .map_err(|error| io_error("setup_log_prune_failed", error))?;
                removed = true;
                continue;
            }
            let file = entry
                .open()
                .map_err(|error| io_error("setup_log_prune_failed", error))?;
            let identity = Arc::new(file_identity(&file, "setup_log_prune_failed")?);
            if !named_file_identity_matches(&self.logs, &name, &identity, MAX_LOG_BYTES as u64) {
                return Err(setup_error(
                    "setup_log_changed",
                    "A private setup log changed while it was inspected.",
                ));
            }
            logs.push((
                name.clone(),
                metadata.len(),
                SavedSetupLog {
                    scope: self.clone(),
                    name,
                    identity,
                },
            ));
        }
        logs.sort_by(|left, right| left.0.cmp(&right.0));
        let mut total = logs.iter().map(|(_, bytes, _)| *bytes).sum::<u64>();
        while logs.len() > MAX_SAVED_RUNS || total > MAX_SAVED_LOG_BYTES {
            let Some(index) = logs
                .iter()
                .position(|(name, _, _)| current.map_or(true, |current| name != current))
            else {
                break;
            };
            let (name, bytes, _) = logs.remove(index);
            self.logs
                .remove_file(name)
                .map_err(|error| io_error("setup_log_prune_failed", error))?;
            total = total.saturating_sub(bytes);
            removed = true;
        }
        if removed {
            sync_cap_directory(&self.logs, "setup_log_prune_failed")?;
        }
        self.verify()?;
        Ok(logs.into_iter().map(|(_, _, saved)| saved).collect())
    }
}

#[derive(Clone)]
pub(crate) struct SavedSetupLog {
    scope: Arc<AppDataScope>,
    name: OsString,
    identity: Arc<Handle>,
}

impl SavedSetupLog {
    #[cfg(all(test, unix))]
    pub(crate) fn file_name(&self) -> &OsStr {
        &self.name
    }

    pub(crate) fn validate_for_open(&self) -> SetupResult<PathBuf> {
        let (_file, path) = self.verified_file()?;
        Ok(path)
    }

    pub(crate) fn open_with(
        &self,
        opener: impl FnOnce(&Path) -> SetupResult<()>,
    ) -> SetupResult<()> {
        let (_file, path) = self.verified_file()?;
        opener(&path)?;
        self.verified_file().map(|_| ())
    }

    fn verified_file(&self) -> SetupResult<(CapabilityFile, PathBuf)> {
        self.scope.verify()?;
        let metadata = self
            .scope
            .logs
            .symlink_metadata(&self.name)
            .map_err(|_| app_data_changed())?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > MAX_LOG_BYTES as u64
        {
            return Err(app_data_changed());
        }
        let file = self
            .scope
            .logs
            .open(&self.name)
            .map_err(|_| app_data_changed())?;
        if file_identity(&file, "setup_log_changed")? != *self.identity
            || !named_file_identity_matches(
                &self.scope.logs,
                &self.name,
                &self.identity,
                MAX_LOG_BYTES as u64,
            )
        {
            return Err(app_data_changed());
        }
        Ok((
            file,
            self.scope.root_path.join("setup-logs").join(&self.name),
        ))
    }

    fn run_id(&self) -> SetupResult<String> {
        parse_log_run_id(&self.name)
            .map(str::to_owned)
            .ok_or_else(|| setup_error("setup_log_invalid", "The saved setup log name is invalid."))
    }
}

pub(crate) struct BoundedSetupLog {
    #[cfg(test)]
    path: PathBuf,
    file: CapabilityFile,
    saved: SavedSetupLog,
    lines: VecDeque<String>,
    persisted_bytes: usize,
    full: bool,
}

impl BoundedSetupLog {
    #[cfg(test)]
    pub(crate) fn create(app_data: &Path, run_id: &str, timestamp: u64) -> SetupResult<Self> {
        AppDataScope::bind(app_data)?
            .create_log(run_id, timestamp)
            .map(|(log, _)| log)
    }

    pub(crate) fn push(&mut self, input: &str) -> SetupResult<String> {
        self.saved.validate_for_open()?;
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
        self.saved.scope.prune_setup_logs(Some(&self.saved.name))?;
        self.saved.validate_for_open()?;
        Ok(line)
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

pub(crate) struct ResourceScope {
    requested_root: PathBuf,
    parent_path: PathBuf,
    parent_identity: Handle,
    parent: Dir,
    root_name: OsString,
    root_identity: Handle,
    root: Dir,
}

impl ResourceScope {
    pub(crate) fn bind(root: &Path) -> SetupResult<Self> {
        let requested_metadata = fs::symlink_metadata(root)
            .map_err(|error| io_error("setup_resource_root_unavailable", error))?;
        if requested_metadata.file_type().is_symlink() || !requested_metadata.is_dir() {
            return Err(resource_root_changed());
        }
        let root_path = root
            .canonicalize()
            .map_err(|error| io_error("setup_resource_root_unavailable", error))?;
        let parent_path = root_path.parent().ok_or_else(resource_root_changed)?;
        let root_name = root_path
            .file_name()
            .ok_or_else(resource_root_changed)?
            .to_os_string();
        let parent = Dir::open_ambient_dir(parent_path, ambient_authority())
            .map_err(|error| io_error("setup_resource_root_unavailable", error))?;
        let metadata = parent
            .symlink_metadata(&root_name)
            .map_err(|error| io_error("setup_resource_root_unavailable", error))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(resource_root_changed());
        }
        let directory = parent
            .open_dir(&root_name)
            .map_err(|error| io_error("setup_resource_root_unavailable", error))?;
        let parent_identity = directory_identity(&parent, "setup_resource_root_unavailable")?;
        let root_identity = directory_identity(&directory, "setup_resource_root_unavailable")?;
        let scope = Self {
            requested_root: root.to_path_buf(),
            parent_path: parent_path.to_path_buf(),
            parent_identity,
            parent,
            root_name,
            root_identity,
            root: directory,
        };
        scope.verify_root()?;
        Ok(scope)
    }

    fn verify_root(&self) -> SetupResult<()> {
        let requested_metadata =
            fs::symlink_metadata(&self.requested_root).map_err(|_| resource_root_changed())?;
        if requested_metadata.file_type().is_symlink() || !requested_metadata.is_dir() {
            return Err(resource_root_changed());
        }
        let requested_identity =
            Handle::from_path(&self.requested_root).map_err(|_| resource_root_changed())?;
        if requested_identity != self.root_identity {
            return Err(resource_root_changed());
        }
        let current_parent =
            Handle::from_path(&self.parent_path).map_err(|_| resource_root_changed())?;
        if current_parent != self.parent_identity {
            return Err(resource_root_changed());
        }
        let current = self
            .parent
            .open_dir(&self.root_name)
            .map_err(|_| resource_root_changed())?;
        if directory_identity(&current, "setup_resource_root_changed")? != self.root_identity {
            return Err(resource_root_changed());
        }
        Ok(())
    }

    pub(crate) fn verify(&self, manifest: &IntegrityManifest) -> SetupResult<()> {
        self.verify_impl(manifest, &mut |_| {})
    }

    #[cfg(all(test, unix))]
    pub(crate) fn verify_with_entry_hook(
        &self,
        manifest: &IntegrityManifest,
        mut hook: impl FnMut(&str),
    ) -> SetupResult<()> {
        self.verify_impl(manifest, &mut hook)
    }

    fn verify_impl(
        &self,
        manifest: &IntegrityManifest,
        hook: &mut dyn FnMut(&str),
    ) -> SetupResult<()> {
        self.verify_root()?;
        if manifest.schema_version != 1 || manifest.files.is_empty() {
            return Err(invalid_integrity_manifest());
        }
        let mut expected = HashMap::new();
        for entry in &manifest.files {
            if !safe_resource_path(&entry.path)
                || entry.max_bytes == 0
                || entry.max_bytes > MAX_RESOURCE_BYTES
                || !is_sha256(&entry.sha256)
                || expected.insert(entry.path.as_str(), entry).is_some()
            {
                return Err(invalid_integrity_manifest());
            }
        }
        let mut found = HashSet::new();
        for top in ["contracts", "examples", "brands"] {
            let metadata = self.root.symlink_metadata(top).map_err(|_| {
                setup_error(
                    "setup_resource_missing",
                    "A bundled resource directory is missing.",
                )
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(invalid_resource_type());
            }
            let directory = self
                .root
                .open_dir(top)
                .map_err(|error| io_error("setup_resource_read_failed", error))?;
            let identity = directory_identity(&directory, "setup_resource_read_failed")?;
            walk_cap_resources(&directory, top, &expected, &mut found, hook)?;
            if !named_directory_identity_matches(&self.root, OsStr::new(top), &identity) {
                return Err(setup_error(
                    "setup_resource_changed",
                    "A bundled resource directory changed during verification.",
                ));
            }
        }
        self.verify_root()?;
        if found.len() != expected.len() {
            return Err(setup_error(
                "setup_resource_missing",
                "A required bundled resource is missing.",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn verify_resource_tree(root: &Path, manifest: &IntegrityManifest) -> SetupResult<()> {
    ResourceScope::bind(root)?.verify(manifest)
}

fn walk_cap_resources<'a>(
    directory: &Dir,
    relative_directory: &str,
    expected: &HashMap<&'a str, &'a IntegrityEntry>,
    found: &mut HashSet<&'a str>,
    hook: &mut dyn FnMut(&str),
) -> SetupResult<()> {
    for entry in directory
        .entries()
        .map_err(|error| io_error("setup_resource_read_failed", error))?
    {
        let entry = entry.map_err(|error| io_error("setup_resource_read_failed", error))?;
        let name = entry.file_name();
        let name_text = name.to_str().ok_or_else(|| {
            setup_error(
                "setup_resource_path_invalid",
                "Bundled resource paths must be Unicode.",
            )
        })?;
        let relative = format!("{relative_directory}/{name_text}");
        let file_type = entry
            .file_type()
            .map_err(|error| io_error("setup_resource_read_failed", error))?;
        if file_type.is_symlink() {
            return Err(invalid_resource_type());
        }
        if file_type.is_dir() {
            let child = entry
                .open_dir()
                .map_err(|error| io_error("setup_resource_read_failed", error))?;
            let identity = directory_identity(&child, "setup_resource_read_failed")?;
            walk_cap_resources(&child, &relative, expected, found, hook)?;
            if !named_directory_identity_matches(directory, &name, &identity) {
                return Err(setup_error(
                    "setup_resource_changed",
                    "A bundled resource directory changed during verification.",
                ));
            }
            continue;
        }
        if !file_type.is_file() {
            return Err(invalid_resource_type());
        }
        let Some(expected_entry) = expected.get(relative.as_str()).copied() else {
            return Err(setup_error(
                "setup_resource_unexpected",
                "An unexpected bundled resource was found.",
            ));
        };
        let file = entry
            .open()
            .map_err(|error| io_error("setup_resource_read_failed", error))?;
        let identity = file_identity(&file, "setup_resource_read_failed")?;
        hook(&relative);
        let named_metadata = directory
            .symlink_metadata(&name)
            .map_err(|error| io_error("setup_resource_read_failed", error))?;
        if named_metadata.file_type().is_symlink() || !named_metadata.is_file() {
            return Err(invalid_resource_type());
        }
        if !named_file_identity_matches(directory, &name, &identity, MAX_RESOURCE_BYTES) {
            return Err(setup_error(
                "setup_resource_changed",
                "A bundled resource changed during verification.",
            ));
        }
        let metadata = file
            .metadata()
            .map_err(|error| io_error("setup_resource_read_failed", error))?;
        if metadata.len() > expected_entry.max_bytes {
            return Err(setup_error(
                "setup_resource_too_large",
                "A bundled resource exceeds its committed size limit.",
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(expected_entry.max_bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| io_error("setup_resource_read_failed", error))?;
        if bytes.len() as u64 > expected_entry.max_bytes {
            return Err(setup_error(
                "setup_resource_too_large",
                "A bundled resource exceeds its committed size limit.",
            ));
        }
        if format!("{:x}", Sha256::digest(&bytes)) != expected_entry.sha256 {
            return Err(setup_error(
                "setup_resource_digest_mismatch",
                "A bundled resource did not match its committed digest.",
            ));
        }
        if !named_file_identity_matches(directory, &name, &identity, MAX_RESOURCE_BYTES) {
            return Err(setup_error(
                "setup_resource_changed",
                "A bundled resource changed during verification.",
            ));
        }
        found.insert(expected_entry.path.as_str());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn load_remembered_workspace(app_data: &Path) -> SetupResult<Option<PathBuf>> {
    AppDataScope::bind(app_data)?.load_remembered_workspace()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentWorkspace {
    root_path: String,
    #[allow(dead_code)]
    last_opened_at: String,
}

#[cfg(test)]
pub(crate) fn atomic_persist_readiness(
    app_data: &Path,
    schema_version: u32,
    app_version: &str,
) -> SetupResult<()> {
    AppDataScope::bind(app_data)?.persist_readiness(schema_version, app_version)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadinessRecord<'a> {
    schema_version: u32,
    #[serde(borrow)]
    app_version: &'a str,
}

#[cfg(test)]
pub(crate) fn is_ready(app_data: &Path, app_version: &str) -> bool {
    AppDataScope::bind(app_data).is_ok_and(|scope| scope.readiness_matches(app_version))
}

pub(crate) fn initialize_setup_status(
    app_data: &Path,
    state: &SetupState,
    app_version: &str,
) -> SetupResult<bool> {
    let scope = AppDataScope::bind(app_data)?;
    state.replace_logs(scope.prune_setup_logs(None)?)?;
    Ok(scope.readiness_matches(app_version))
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
    let mut app_scope: Option<Arc<AppDataScope>> = None;

    for (stage_id, _) in &STAGES {
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
                let scope = AppDataScope::bind(&paths.app_data)?;
                let (created, saved) = scope.create_log(run_id, started_at)?;
                let retained = scope.prune_setup_logs(Some(&saved.name))?;
                (services.log_registry)(retained)?;
                log = Some(created);
                app_scope = Some(scope);
                Ok((
                    SetupStageStatus::Succeeded,
                    "Private application data is ready.".to_owned(),
                ))
            })(),
            "resources" => (|| {
                ResourceScope::bind(&paths.resource_root)?.verify(manifest)?;
                Ok((
                    SetupStageStatus::Succeeded,
                    "Bundled resources match their committed digests.".to_owned(),
                ))
            })(),
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
            "workspace" => (|| {
                let workspace = app_scope
                    .as_ref()
                    .ok_or_else(app_data_changed)?
                    .load_remembered_workspace()?;
                Ok(match workspace {
                    Some(_) => (
                        SetupStageStatus::Succeeded,
                        "A valid app-owned remembered workspace is available.".to_owned(),
                    ),
                    None => (
                        SetupStageStatus::Skipped,
                        "Workspace selection is required after setup.".to_owned(),
                    ),
                })
            })(),
            "ready" => (|| {
                app_scope
                    .as_ref()
                    .ok_or_else(app_data_changed)?
                    .persist_readiness(SETUP_SCHEMA_VERSION, app_version)?;
                Ok((
                    SetupStageStatus::Succeeded,
                    "Setup readiness was persisted atomically.".to_owned(),
                ))
            })(),
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
    let Ok(line) = log.push(message) else {
        return;
    };
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
        ready: initialize_setup_status(
            &app_data,
            state.inner(),
            app.package_info().version.to_string().as_str(),
        )?,
        snapshot: state.snapshot()?,
    })
}

#[tauri::command]
pub fn setup_start(app: AppHandle, state: State<'_, SetupState>) -> SetupResult<SetupSnapshot> {
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
    let claim = owned_state.claim_active_run(&run_id, cancellation.clone())?;
    if !claim.claimed {
        return Ok(claim.snapshot);
    }
    let initial = claim.snapshot;
    let app_for_run = app.clone();
    let run_id_for_run = run_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let git_root = paths.app_data.clone();
        let registry_state = owned_state.clone();
        let services = SetupServices::new(move || crate::git::probe_version(&git_root))
            .with_log_registry(move |logs| registry_state.replace_logs(logs));
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
    let saved = state.saved_log(&run_id)?.ok_or_else(|| {
        setup_error(
            "setup_log_not_found",
            "No saved setup log is available for this run.",
        )
    })?;
    saved.open_with(|path| {
        open::that_detached(path).map_err(|error| {
            setup_error(
                "setup_log_open_failed",
                format!("The saved setup log could not be opened: {error}"),
            )
        })
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

fn regular_destination_identity(directory: &Dir, name: &str) -> SetupResult<Option<Handle>> {
    let metadata = match directory.symlink_metadata(name) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("setup_ready_write_failed", error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 4_096 {
        return Err(setup_error(
            "setup_ready_destination_invalid",
            "Setup readiness cannot replace an unsafe file.",
        ));
    }
    let file = directory
        .open(name)
        .map_err(|error| io_error("setup_ready_write_failed", error))?;
    let identity = file_identity(&file, "setup_ready_write_failed")?;
    if !named_file_identity_matches(directory, OsStr::new(name), &identity, 4_096) {
        return Err(setup_error(
            "setup_ready_destination_changed",
            "Setup readiness changed while it was inspected.",
        ));
    }
    Ok(Some(identity))
}

#[cfg(not(windows))]
fn commit_readiness(
    directory: &Dir,
    temporary: &OsStr,
    _file: &CapabilityFile,
    _destination_exists: bool,
) -> SetupResult<()> {
    directory
        .rename(temporary, directory, READY_FILE)
        .map_err(|error| io_error("setup_ready_write_failed", error))
}

#[cfg(windows)]
fn commit_readiness(
    directory: &Dir,
    temporary: &OsStr,
    file: &CapabilityFile,
    destination_exists: bool,
) -> SetupResult<()> {
    if !destination_exists {
        return directory
            .rename(temporary, directory, READY_FILE)
            .map_err(|error| io_error("setup_ready_write_failed", error));
    }
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileRenameInfo, SetFileInformationByHandle, FILE_RENAME_INFO_0,
    };

    const TARGET_LENGTH: usize = READY_FILE.len();
    #[repr(C)]
    struct RelativeRenameInfo {
        anonymous: FILE_RENAME_INFO_0,
        root_directory: windows_sys::Win32::Foundation::HANDLE,
        file_name_length: u32,
        file_name: [u16; TARGET_LENGTH],
    }
    let mut file_name = [0_u16; TARGET_LENGTH];
    for (destination, source) in file_name.iter_mut().zip(READY_FILE.encode_utf16()) {
        *destination = source;
    }
    let rename = RelativeRenameInfo {
        anonymous: FILE_RENAME_INFO_0 { ReplaceIfExists: 1 },
        root_directory: directory.as_raw_handle(),
        file_name_length: (file_name.len() * std::mem::size_of::<u16>()) as u32,
        file_name,
    };
    let replaced = unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileRenameInfo,
            std::ptr::addr_of!(rename).cast(),
            std::mem::size_of_val(&rename) as u32,
        )
    };
    if replaced == 0 {
        Err(io_error(
            "setup_ready_write_failed",
            std::io::Error::last_os_error(),
        ))
    } else {
        Ok(())
    }
}

fn file_identity(file: &CapabilityFile, code: &'static str) -> SetupResult<Handle> {
    Handle::from_file(
        file.try_clone()
            .map_err(|error| io_error(code, error))?
            .into_std(),
    )
    .map_err(|error| io_error(code, error))
}

fn directory_identity(directory: &Dir, code: &'static str) -> SetupResult<Handle> {
    Handle::from_file(
        directory
            .try_clone()
            .map_err(|error| io_error(code, error))?
            .into_std_file(),
    )
    .map_err(|error| io_error(code, error))
}

fn named_file_identity_matches(
    directory: &Dir,
    name: &OsStr,
    expected: &Handle,
    max_bytes: u64,
) -> bool {
    let Ok(metadata) = directory.symlink_metadata(name) else {
        return false;
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > max_bytes {
        return false;
    }
    directory
        .open(name)
        .ok()
        .and_then(|file| file_identity(&file, "setup_file_changed").ok())
        .is_some_and(|identity| identity == *expected)
}

fn named_directory_identity_matches(directory: &Dir, name: &OsStr, expected: &Handle) -> bool {
    let Ok(metadata) = directory.symlink_metadata(name) else {
        return false;
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return false;
    }
    directory
        .open_dir(name)
        .ok()
        .and_then(|child| directory_identity(&child, "setup_directory_changed").ok())
        .is_some_and(|identity| identity == *expected)
}

fn parse_log_run_id(name: &OsStr) -> Option<&str> {
    let text = name.to_str()?.strip_suffix(".log")?;
    let (timestamp, run_id) = text.split_once('-')?;
    if timestamp.is_empty()
        || !timestamp.bytes().all(|byte| byte.is_ascii_digit())
        || validate_run_id(run_id).is_err()
    {
        return None;
    }
    Some(run_id)
}

fn invalid_integrity_manifest() -> SetupError {
    setup_error(
        "setup_integrity_manifest_invalid",
        "The bundled resource integrity manifest is invalid.",
    )
}

fn invalid_resource_type() -> SetupError {
    setup_error(
        "setup_resource_invalid_type",
        "Bundled resources must contain only regular directories and files.",
    )
}

fn resource_root_changed() -> SetupError {
    setup_error(
        "setup_resource_root_changed",
        "The installed resource root changed during setup.",
    )
}

fn app_data_changed() -> SetupError {
    setup_error(
        "setup_app_data_changed",
        "The private application-data capability changed during setup.",
    )
}

fn readiness_destination_changed() -> SetupError {
    setup_error(
        "setup_ready_destination_changed",
        "Setup readiness changed before the atomic commit.",
    )
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
fn sync_cap_directory(directory: &Dir, code: &'static str) -> SetupResult<()> {
    directory
        .try_clone()
        .map(Dir::into_std_file)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| io_error(code, error))
}

#[cfg(not(unix))]
fn sync_cap_directory(_directory: &Dir, _code: &'static str) -> SetupResult<()> {
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
