use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::setup::{AppDataScope, BoundedSetupLog, SavedSetupLog, SetupError};
use cap_std::fs::{Dir, File as CapabilityFile, OpenOptions as CapabilityOpenOptions};
use same_file::Handle;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const MAX_LOG_LINES: usize = 500;
const MAX_RELEASE_NOTES: usize = 8 * 1024;
const SETTINGS_FILE: &str = "update-settings-v1.json";
const UPDATE_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateError {
    pub code: String,
    pub message: String,
}

type UpdateResult<T> = Result<T, UpdateError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdatePhase {
    Idle,
    Checking,
    Current,
    Available,
    Downloading,
    Verifying,
    Installing,
    RestartRequired,
    Deferred,
    Cancelling,
    RecheckRequired,
    Dismissed,
    Failed,
    Offline,
}

impl UpdatePhase {
    fn active(self) -> bool {
        matches!(
            self,
            Self::Checking | Self::Downloading | Self::Verifying | Self::Installing
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRelease {
    version: String,
    notes: String,
    date: Option<String>,
    size: Option<u64>,
    platform: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFailure {
    code: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    run_id: String,
    sequence: u64,
    started_at: u64,
    pub(crate) phase: UpdatePhase,
    cancellable: bool,
    release: Option<UpdateRelease>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    speed_bytes_per_second: Option<u64>,
    logs: Vec<String>,
    failure: Option<UpdateFailure>,
    saved_log_available: bool,
    message: Option<String>,
}

impl Default for UpdateSnapshot {
    fn default() -> Self {
        Self {
            run_id: "idle".to_owned(),
            sequence: 0,
            started_at: now_ms(),
            phase: UpdatePhase::Idle,
            cancellable: false,
            release: None,
            downloaded_bytes: 0,
            total_bytes: None,
            speed_bytes_per_second: None,
            logs: Vec::new(),
            failure: None,
            saved_log_available: false,
            message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum UpdateEvent {
    Phase {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        phase: UpdatePhase,
        cancellable: bool,
        release: Option<UpdateRelease>,
        message: Option<String>,
    },
    Download {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
        speed_bytes_per_second: Option<u64>,
    },
    Log {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        line: String,
    },
    Offline {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        message: String,
    },
    Failed {
        run_id: String,
        sequence: u64,
        timestamp: u64,
        code: String,
        message: String,
    },
}

struct AvailableUpdate {
    run_id: String,
    update: Update,
}

struct WorkerOwnership {
    run_id: String,
    worker_id: u64,
}

struct UpdateRuntime {
    snapshot: UpdateSnapshot,
    cancellation: Option<Arc<AtomicBool>>,
    available: Option<AvailableUpdate>,
    next_worker_id: u64,
    active_worker: Option<WorkerOwnership>,
}

impl Default for UpdateRuntime {
    fn default() -> Self {
        Self {
            snapshot: UpdateSnapshot::default(),
            cancellation: None,
            available: None,
            next_worker_id: 0,
            active_worker: None,
        }
    }
}

#[derive(Clone, Default)]
pub struct UpdateState {
    inner: Arc<Mutex<UpdateRuntime>>,
    saved_logs: Arc<Mutex<HashMap<String, SavedSetupLog>>>,
}

pub(crate) struct CheckClaim {
    pub(crate) claimed: bool,
    pub(crate) snapshot: UpdateSnapshot,
    worker_id: Option<u64>,
}

impl UpdateState {
    pub(crate) fn claim_check(&self, run_id: String, started_at: u64) -> UpdateResult<CheckClaim> {
        let mut runtime = self.lock()?;
        if runtime.active_worker.is_some() || runtime.snapshot.phase.active() {
            return Ok(CheckClaim {
                claimed: false,
                snapshot: runtime.snapshot.clone(),
                worker_id: None,
            });
        }
        let cancellation = Arc::new(AtomicBool::new(false));
        runtime.snapshot = UpdateSnapshot {
            run_id,
            sequence: 1,
            started_at,
            phase: UpdatePhase::Checking,
            cancellable: true,
            ..UpdateSnapshot::default()
        };
        runtime.cancellation = Some(cancellation.clone());
        runtime.available = None;
        let worker_id = Self::start_worker(&mut runtime);
        Ok(CheckClaim {
            claimed: true,
            snapshot: runtime.snapshot.clone(),
            worker_id: Some(worker_id),
        })
    }

    pub(crate) fn snapshot(&self) -> UpdateResult<UpdateSnapshot> {
        Ok(self.lock()?.snapshot.clone())
    }

    fn start_worker(runtime: &mut UpdateRuntime) -> u64 {
        runtime.next_worker_id = runtime.next_worker_id.wrapping_add(1).max(1);
        let worker_id = runtime.next_worker_id;
        runtime.active_worker = Some(WorkerOwnership {
            run_id: runtime.snapshot.run_id.clone(),
            worker_id,
        });
        worker_id
    }

    fn finish_worker(
        &self,
        run_id: &str,
        worker_id: u64,
    ) -> UpdateResult<(bool, Option<UpdateEvent>)> {
        let mut runtime = self.lock()?;
        let matches = runtime
            .active_worker
            .as_ref()
            .is_some_and(|worker| worker.run_id == run_id && worker.worker_id == worker_id);
        if matches {
            runtime.active_worker = None;
        }
        if !matches {
            return Ok((false, None));
        }
        if runtime.snapshot.run_id != run_id || runtime.snapshot.phase != UpdatePhase::Cancelling {
            return Ok((true, None));
        }

        runtime.snapshot.sequence += 1;
        runtime.snapshot.phase = UpdatePhase::RecheckRequired;
        runtime.snapshot.message =
            Some("Cancellation finished. Run a fresh update check before installing.".to_owned());
        runtime.cancellation = None;
        Ok((
            true,
            Some(UpdateEvent::Phase {
                run_id: run_id.to_owned(),
                sequence: runtime.snapshot.sequence,
                timestamp: now_ms(),
                phase: UpdatePhase::RecheckRequired,
                cancellable: false,
                release: runtime.snapshot.release.clone(),
                message: runtime.snapshot.message.clone(),
            }),
        ))
    }

    fn phase_event(
        &self,
        run_id: &str,
        phase: UpdatePhase,
        cancellable: bool,
        release: Option<UpdateRelease>,
        message: Option<String>,
    ) -> UpdateResult<UpdateEvent> {
        let mut runtime = self.lock()?;
        if runtime.snapshot.run_id != run_id {
            return Err(update_error(
                "update_run_stale",
                "The update run is no longer current.",
            ));
        }
        let transition_allowed = match phase {
            UpdatePhase::Verifying => runtime.snapshot.phase == UpdatePhase::Downloading,
            UpdatePhase::RestartRequired => runtime.snapshot.phase == UpdatePhase::Installing,
            _ => false,
        };
        if !transition_allowed {
            return Err(update_error(
                "update_transition_stale",
                "The update transition is no longer current.",
            ));
        }
        runtime.snapshot.sequence += 1;
        runtime.snapshot.phase = phase;
        runtime.snapshot.cancellable = cancellable;
        if release.is_some() {
            runtime.snapshot.release = release.clone();
        }
        runtime.snapshot.message = message.clone();
        if matches!(
            phase,
            UpdatePhase::Current | UpdatePhase::RestartRequired | UpdatePhase::Deferred
        ) {
            runtime.cancellation = None;
        }
        Ok(UpdateEvent::Phase {
            run_id: run_id.to_owned(),
            sequence: runtime.snapshot.sequence,
            timestamp: now_ms(),
            phase,
            cancellable,
            release,
            message,
        })
    }

    fn download_event(
        &self,
        run_id: &str,
        downloaded: u64,
        total: Option<u64>,
        speed: Option<u64>,
    ) -> UpdateResult<Option<UpdateEvent>> {
        let mut runtime = self.lock()?;
        if runtime.snapshot.run_id != run_id || runtime.snapshot.phase != UpdatePhase::Downloading {
            return Ok(None);
        }
        if downloaded < runtime.snapshot.downloaded_bytes
            || runtime.snapshot.total_bytes.is_some() && runtime.snapshot.total_bytes != total
        {
            return Ok(None);
        }
        runtime.snapshot.sequence += 1;
        runtime.snapshot.downloaded_bytes = downloaded;
        runtime.snapshot.total_bytes = total;
        runtime.snapshot.speed_bytes_per_second = speed;
        Ok(Some(UpdateEvent::Download {
            run_id: run_id.to_owned(),
            sequence: runtime.snapshot.sequence,
            timestamp: now_ms(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            speed_bytes_per_second: speed,
        }))
    }

    fn log_event(&self, run_id: &str, line: String) -> UpdateResult<Option<UpdateEvent>> {
        let mut runtime = self.lock()?;
        if runtime.snapshot.run_id != run_id || runtime.snapshot.phase == UpdatePhase::Failed {
            return Ok(None);
        }
        runtime.snapshot.sequence += 1;
        runtime.snapshot.logs.push(line.clone());
        if runtime.snapshot.logs.len() > MAX_LOG_LINES {
            let excess = runtime.snapshot.logs.len() - MAX_LOG_LINES;
            runtime.snapshot.logs.drain(..excess);
        }
        runtime.snapshot.saved_log_available = true;
        Ok(Some(UpdateEvent::Log {
            run_id: run_id.to_owned(),
            sequence: runtime.snapshot.sequence,
            timestamp: now_ms(),
            line,
        }))
    }

    fn complete_failure_for_phases(
        &self,
        run_id: &str,
        expected_phases: &[UpdatePhase],
        error: UpdateError,
    ) -> UpdateResult<Option<UpdateEvent>> {
        let mut runtime = self.lock()?;
        let cancelled = runtime
            .cancellation
            .as_ref()
            .is_some_and(|cancellation| cancellation.load(Ordering::SeqCst));
        if runtime.snapshot.run_id != run_id
            || !expected_phases.contains(&runtime.snapshot.phase)
            || cancelled
        {
            return Ok(None);
        }
        runtime.snapshot.sequence += 1;
        runtime.snapshot.phase = UpdatePhase::Failed;
        runtime.snapshot.cancellable = false;
        runtime.snapshot.failure = Some(UpdateFailure {
            code: error.code.clone(),
            message: error.message.clone(),
        });
        runtime.cancellation = None;
        Ok(Some(UpdateEvent::Failed {
            run_id: run_id.to_owned(),
            sequence: runtime.snapshot.sequence,
            timestamp: now_ms(),
            code: error.code,
            message: error.message,
        }))
    }

    fn complete_check_failure(
        &self,
        run_id: &str,
        error: UpdateError,
    ) -> UpdateResult<Option<UpdateEvent>> {
        self.complete_failure_for_phases(run_id, &[UpdatePhase::Checking], error)
    }

    fn complete_download_failure(
        &self,
        run_id: &str,
        error: UpdateError,
    ) -> UpdateResult<Option<UpdateEvent>> {
        self.complete_failure_for_phases(
            run_id,
            &[
                UpdatePhase::Downloading,
                UpdatePhase::Verifying,
                UpdatePhase::Installing,
            ],
            error,
        )
    }

    fn complete_check_offline(&self, run_id: &str) -> UpdateResult<Option<UpdateEvent>> {
        let mut runtime = self.lock()?;
        let cancelled = runtime
            .cancellation
            .as_ref()
            .is_some_and(|cancellation| cancellation.load(Ordering::SeqCst));
        if runtime.snapshot.run_id != run_id
            || runtime.snapshot.phase != UpdatePhase::Checking
            || cancelled
        {
            return Ok(None);
        }
        let message = "Update check unavailable while offline.".to_owned();
        runtime.snapshot.sequence += 1;
        runtime.snapshot.phase = UpdatePhase::Offline;
        runtime.snapshot.cancellable = false;
        runtime.snapshot.failure = None;
        runtime.snapshot.message = Some(message.clone());
        runtime.cancellation = None;
        Ok(Some(UpdateEvent::Offline {
            run_id: run_id.to_owned(),
            sequence: runtime.snapshot.sequence,
            timestamp: now_ms(),
            message,
        }))
    }

    fn commit_check_completion(
        &self,
        run_id: &str,
        phase: UpdatePhase,
        cancellable: bool,
        release: Option<UpdateRelease>,
        message: Option<String>,
        store: impl FnOnce(&mut UpdateRuntime),
    ) -> UpdateResult<Option<UpdateEvent>> {
        let mut runtime = self.lock()?;
        let cancelled = runtime
            .cancellation
            .as_ref()
            .is_some_and(|cancellation| cancellation.load(Ordering::SeqCst));
        if runtime.snapshot.run_id != run_id
            || runtime.snapshot.phase != UpdatePhase::Checking
            || cancelled
        {
            return Ok(None);
        }
        if !matches!(phase, UpdatePhase::Current | UpdatePhase::Available) {
            return Err(update_error(
                "update_transition_invalid",
                "The update check completion is invalid.",
            ));
        }

        store(&mut runtime);
        runtime.snapshot.sequence += 1;
        runtime.snapshot.phase = phase;
        runtime.snapshot.cancellable = cancellable;
        runtime.snapshot.release = release.clone();
        runtime.snapshot.message = message.clone();
        if phase == UpdatePhase::Current {
            runtime.cancellation = None;
        }
        Ok(Some(UpdateEvent::Phase {
            run_id: run_id.to_owned(),
            sequence: runtime.snapshot.sequence,
            timestamp: now_ms(),
            phase,
            cancellable,
            release,
            message,
        }))
    }

    fn commit_check_current(&self, run_id: &str) -> UpdateResult<Option<UpdateEvent>> {
        self.commit_check_completion(
            run_id,
            UpdatePhase::Current,
            false,
            None,
            Some("Workflow Studio is current.".to_owned()),
            |_| {},
        )
    }

    fn commit_check_available(
        &self,
        run_id: &str,
        update: Update,
        release: UpdateRelease,
    ) -> UpdateResult<Option<UpdateEvent>> {
        self.commit_check_completion(
            run_id,
            UpdatePhase::Available,
            true,
            Some(release),
            None,
            |runtime| {
                runtime.available = Some(AvailableUpdate {
                    run_id: run_id.to_owned(),
                    update,
                });
            },
        )
    }

    fn commit_installing_impl(
        &self,
        run_id: &str,
        before_commit: impl FnOnce(),
    ) -> UpdateResult<Option<UpdateEvent>> {
        let mut runtime = self.lock()?;
        before_commit();
        let cancelled = runtime
            .cancellation
            .as_ref()
            .is_some_and(|cancellation| cancellation.load(Ordering::SeqCst));
        if runtime.snapshot.run_id != run_id
            || runtime.snapshot.phase != UpdatePhase::Verifying
            || cancelled
        {
            return Ok(None);
        }

        runtime.snapshot.sequence += 1;
        runtime.snapshot.phase = UpdatePhase::Installing;
        runtime.snapshot.cancellable = false;
        runtime.snapshot.message = None;
        Ok(Some(UpdateEvent::Phase {
            run_id: run_id.to_owned(),
            sequence: runtime.snapshot.sequence,
            timestamp: now_ms(),
            phase: UpdatePhase::Installing,
            cancellable: false,
            release: None,
            message: None,
        }))
    }

    fn commit_installing(&self, run_id: &str) -> UpdateResult<Option<UpdateEvent>> {
        self.commit_installing_impl(run_id, || {})
    }

    #[cfg(test)]
    fn commit_installing_with_hook(
        &self,
        run_id: &str,
        before_commit: impl FnOnce(),
    ) -> UpdateResult<Option<UpdateEvent>> {
        self.commit_installing_impl(run_id, before_commit)
    }

    fn begin_download(&self, run_id: &str) -> UpdateResult<(UpdateSnapshot, Update, u64)> {
        let mut runtime = self.lock()?;
        if runtime.snapshot.run_id != run_id
            || !matches!(
                runtime.snapshot.phase,
                UpdatePhase::Available | UpdatePhase::Deferred
            )
        {
            return Err(update_error(
                "update_not_available",
                "No current update is ready to download.",
            ));
        }
        let available = runtime
            .available
            .take()
            .filter(|available| available.run_id == run_id)
            .ok_or_else(|| {
                update_error(
                    "update_not_available",
                    "The checked update is no longer available.",
                )
            })?;
        let cancellation = Arc::new(AtomicBool::new(false));
        runtime.snapshot.sequence += 1;
        runtime.snapshot.phase = UpdatePhase::Downloading;
        runtime.snapshot.cancellable = true;
        runtime.snapshot.downloaded_bytes = 0;
        runtime.snapshot.total_bytes = None;
        runtime.snapshot.speed_bytes_per_second = None;
        runtime.snapshot.failure = None;
        runtime.cancellation = Some(cancellation.clone());
        let worker_id = Self::start_worker(&mut runtime);
        Ok((runtime.snapshot.clone(), available.update, worker_id))
    }

    fn cancel_impl(
        &self,
        run_id: &str,
        before_commit: impl FnOnce(),
    ) -> UpdateResult<(bool, Option<UpdateEvent>)> {
        let mut runtime = self.lock()?;
        before_commit();
        if runtime.snapshot.run_id != run_id || !runtime.snapshot.cancellable {
            return Ok((false, None));
        }
        if let Some(cancellation) = &runtime.cancellation {
            cancellation.store(true, Ordering::SeqCst);
        }
        let cancelled_phase = runtime.snapshot.phase;
        let (phase, message) = match cancelled_phase {
            UpdatePhase::Downloading | UpdatePhase::Verifying => (
                UpdatePhase::Cancelling,
                "Update download is finishing cancellation; Check Again will be available when it is safe.",
            ),
            UpdatePhase::Available => (
                UpdatePhase::Deferred,
                "Update deferred until later; the checked release remains available.",
            ),
            _ => (
                UpdatePhase::Dismissed,
                "Update check cancelled; the current installed version is unchanged.",
            ),
        };
        runtime.snapshot.sequence += 1;
        runtime.snapshot.phase = phase;
        runtime.snapshot.cancellable = false;
        runtime.snapshot.message = Some(message.to_owned());
        if matches!(
            phase,
            UpdatePhase::Cancelling | UpdatePhase::RecheckRequired | UpdatePhase::Dismissed
        ) {
            runtime.available = None;
        }
        let event = UpdateEvent::Phase {
            run_id: run_id.to_owned(),
            sequence: runtime.snapshot.sequence,
            timestamp: now_ms(),
            phase,
            cancellable: false,
            release: runtime.snapshot.release.clone(),
            message: runtime.snapshot.message.clone(),
        };
        Ok((true, Some(event)))
    }

    pub(crate) fn cancel(&self, run_id: &str) -> UpdateResult<(bool, Option<UpdateEvent>)> {
        self.cancel_impl(run_id, || {})
    }

    #[cfg(test)]
    fn cancel_with_hook(
        &self,
        run_id: &str,
        before_commit: impl FnOnce(),
    ) -> UpdateResult<(bool, Option<UpdateEvent>)> {
        self.cancel_impl(run_id, before_commit)
    }

    fn defer(&self, run_id: &str) -> UpdateResult<UpdateSnapshot> {
        let mut runtime = self.lock()?;
        if runtime.snapshot.run_id != run_id
            || !matches!(
                runtime.snapshot.phase,
                UpdatePhase::Available
                    | UpdatePhase::Failed
                    | UpdatePhase::Cancelling
                    | UpdatePhase::RecheckRequired
            )
        {
            return Err(update_error(
                "update_run_stale",
                "Only the current update notification can be dismissed.",
            ));
        }
        let dismiss = matches!(
            runtime.snapshot.phase,
            UpdatePhase::Failed | UpdatePhase::Cancelling | UpdatePhase::RecheckRequired
        );
        runtime.snapshot.sequence += 1;
        runtime.snapshot.phase = if dismiss {
            UpdatePhase::Dismissed
        } else {
            UpdatePhase::Deferred
        };
        runtime.snapshot.cancellable = false;
        runtime.snapshot.message = Some(if dismiss {
            "Update notification dismissed; details remain available in About.".to_owned()
        } else {
            "Update deferred until later.".to_owned()
        });
        if dismiss {
            runtime.available = None;
            runtime.cancellation = None;
        }
        Ok(runtime.snapshot.clone())
    }

    fn register_log(&self, run_id: &str, saved: SavedSetupLog) -> UpdateResult<()> {
        let mut logs = self.saved_logs.lock().map_err(|_| {
            update_error(
                "update_state_unavailable",
                "Update log state is unavailable.",
            )
        })?;
        logs.insert(run_id.to_owned(), saved);
        if logs.len() > 10 {
            if let Some(key) = logs.keys().next().cloned() {
                logs.remove(&key);
            }
        }
        Ok(())
    }

    fn saved_log(&self, run_id: &str) -> UpdateResult<SavedSetupLog> {
        self.saved_logs
            .lock()
            .map_err(|_| {
                update_error(
                    "update_state_unavailable",
                    "Update log state is unavailable.",
                )
            })?
            .get(run_id)
            .cloned()
            .ok_or_else(|| {
                update_error(
                    "update_log_not_found",
                    "No saved update log is available for this run.",
                )
            })
    }

    fn lock(&self) -> UpdateResult<MutexGuard<'_, UpdateRuntime>> {
        self.inner
            .lock()
            .map_err(|_| update_error("update_state_unavailable", "Update state is unavailable."))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InstallOutcome {
    Cancelled,
    Installed,
}

pub(crate) fn install_after_verified_download<T, C, E>(
    verified: Result<T, E>,
    commit_installing: impl FnOnce() -> Result<Option<C>, E>,
    install: impl FnOnce(T) -> Result<(), E>,
) -> Result<InstallOutcome, E> {
    let bytes = verified?;
    if commit_installing()?.is_none() {
        return Ok(InstallOutcome::Cancelled);
    }
    install(bytes)?;
    Ok(InstallOutcome::Installed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdatePreferences {
    schema_version: u8,
    pub(crate) startup_check_enabled: bool,
}

pub(crate) fn load_update_preferences(app_data: &Path) -> UpdateResult<UpdatePreferences> {
    load_update_preferences_impl(app_data, || {})
}

#[cfg(all(test, unix))]
pub(crate) fn load_update_preferences_with_hook(
    app_data: &Path,
    hook: impl FnOnce(),
) -> UpdateResult<UpdatePreferences> {
    load_update_preferences_impl(app_data, hook)
}

fn load_update_preferences_impl(
    app_data: &Path,
    hook: impl FnOnce(),
) -> UpdateResult<UpdatePreferences> {
    let scope = AppDataScope::bind_for_logs(app_data, "update-logs").map_err(map_setup_error)?;
    scope.verify().map_err(map_setup_error)?;
    let root = scope.root_directory();
    let metadata = match root.symlink_metadata(SETTINGS_FILE) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(default_preferences())
        }
        Err(_) => {
            return Err(update_error(
                "update_settings_read_failed",
                "Update settings could not be read.",
            ))
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 4_096 {
        return Ok(default_preferences());
    }
    let mut file = root.open(SETTINGS_FILE).map_err(|_| {
        update_error(
            "update_settings_read_failed",
            "Update settings could not be read.",
        )
    })?;
    let identity = cap_file_identity(&file)?;
    hook();
    let mut bytes = Vec::new();
    (&mut file)
        .take(4_097)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            update_error(
                "update_settings_read_failed",
                "Update settings could not be read.",
            )
        })?;
    scope.verify().map_err(map_setup_error)?;
    if !named_cap_file_matches(root, OsStr::new(SETTINGS_FILE), &identity, 4_096) {
        return Err(update_error(
            "update_settings_changed",
            "Update settings changed while they were read.",
        ));
    }
    let parsed: UpdatePreferences =
        serde_json::from_slice(&bytes).unwrap_or_else(|_| default_preferences());
    Ok(if parsed.schema_version == 1 {
        parsed
    } else {
        default_preferences()
    })
}

pub(crate) fn store_update_preferences(app_data: &Path, enabled: bool) -> UpdateResult<()> {
    store_update_preferences_impl(app_data, enabled, || {})
}

#[cfg(all(test, unix))]
pub(crate) fn store_update_preferences_with_hook(
    app_data: &Path,
    enabled: bool,
    hook: impl FnOnce(),
) -> UpdateResult<()> {
    store_update_preferences_impl(app_data, enabled, hook)
}

fn store_update_preferences_impl(
    app_data: &Path,
    enabled: bool,
    hook: impl FnOnce(),
) -> UpdateResult<()> {
    let scope = AppDataScope::bind_for_logs(app_data, "update-logs").map_err(map_setup_error)?;
    scope.verify().map_err(map_setup_error)?;
    let root = scope.root_directory();
    let destination_identity = regular_cap_destination(root, SETTINGS_FILE)?;
    let temporary = OsString::from(format!(".update-settings-{}.tmp", opaque_id()?));
    let bytes = serde_json::to_vec(&UpdatePreferences {
        schema_version: 1,
        startup_check_enabled: enabled,
    })
    .map_err(|_| {
        update_error(
            "update_settings_write_failed",
            "Update settings could not be encoded.",
        )
    })?;
    let result = (|| -> UpdateResult<()> {
        let mut options = CapabilityOpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(windows)]
        {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
            use windows_sys::Win32::Storage::FileSystem::DELETE;
            options.access_mode(GENERIC_READ | GENERIC_WRITE | DELETE);
        }
        let mut file = root.open_with(&temporary, &options).map_err(|_| {
            update_error(
                "update_settings_write_failed",
                "A private settings file could not be created.",
            )
        })?;
        #[cfg(unix)]
        {
            use cap_std::fs::Permissions;
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(Permissions::from_std(std::fs::Permissions::from_mode(
                0o600,
            )))
            .map_err(|_| {
                update_error(
                    "update_settings_write_failed",
                    "Private settings permissions could not be applied.",
                )
            })?;
        }
        let staged_identity = cap_file_identity(&file)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| {
                update_error(
                    "update_settings_write_failed",
                    "Update settings could not be saved.",
                )
            })?;
        hook();
        scope.verify().map_err(map_setup_error)?;
        if regular_cap_destination(root, SETTINGS_FILE)? != destination_identity
            || !named_cap_file_matches(root, &temporary, &staged_identity, 4_096)
        {
            return Err(update_error(
                "update_settings_changed",
                "Update settings changed before commit.",
            ));
        }
        commit_update_preferences(root, &temporary, &file, destination_identity.is_some())?;
        sync_cap_directory(root)?;
        scope.verify().map_err(map_setup_error)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = root.remove_file(&temporary);
    }
    result
}

fn default_preferences() -> UpdatePreferences {
    UpdatePreferences {
        schema_version: 1,
        startup_check_enabled: true,
    }
}

pub(crate) fn redact_update_log_line(input: &str) -> String {
    let first = input.lines().next().unwrap_or_default();
    let lower = first.to_ascii_lowercase();
    if [
        "prompt:",
        "command:",
        "nodes:",
        "workflow:",
        "artifact contents",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return "[private content redacted]".to_owned();
    }
    let mut value = first.to_owned();
    if let Some(query) = value
        .find('?')
        .filter(|query| value[..*query].contains("://"))
    {
        value.truncate(query);
        value.push_str("?[REDACTED]");
    }
    let lower = value.to_ascii_lowercase();
    if let Some((index, key)) = [
        "authorization",
        "access_token",
        "refresh_token",
        "signature",
        "token",
        "api_key",
        "apikey",
    ]
    .iter()
    .filter_map(|key| lower.find(key).map(|index| (index, *key)))
    .min_by_key(|(index, _)| *index)
    {
        let suffix = &value[index..];
        let end = suffix
            .find([':', '='])
            .map(|offset| index + offset + 1)
            .unwrap_or(index + key.len());
        value.truncate(end);
        value.push_str("[REDACTED]");
    }
    value.chars().take(4_096).collect()
}

struct BoundedUpdateLog {
    inner: BoundedSetupLog,
    saved: SavedSetupLog,
}

struct WorkerFinishGuard {
    app: AppHandle,
    state: UpdateState,
    run_id: String,
    worker_id: u64,
}

impl WorkerFinishGuard {
    fn new(app: AppHandle, state: UpdateState, run_id: String, worker_id: u64) -> Self {
        Self {
            app,
            state,
            run_id,
            worker_id,
        }
    }
}

impl Drop for WorkerFinishGuard {
    fn drop(&mut self) {
        if let Ok((_, Some(event))) = self.state.finish_worker(&self.run_id, self.worker_id) {
            emit(&self.app, event);
        }
    }
}

impl BoundedUpdateLog {
    fn create(app_data: &Path, run_id: &str) -> UpdateResult<Self> {
        let scope =
            AppDataScope::bind_for_logs(app_data, "update-logs").map_err(map_setup_error)?;
        let (inner, saved) = scope
            .create_log(run_id, now_ms())
            .map_err(map_setup_error)?;
        Ok(Self { inner, saved })
    }

    fn push(&mut self, input: &str) -> UpdateResult<String> {
        self.inner
            .push(&redact_update_log_line(input))
            .map_err(map_setup_error)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusResponse {
    snapshot: UpdateSnapshot,
    startup_check_enabled: bool,
}

#[tauri::command]
pub fn update_status(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> UpdateResult<UpdateStatusResponse> {
    let app_data = app_data_path(&app)?;
    AppDataScope::bind_for_logs(&app_data, "update-logs")
        .and_then(|scope| scope.prune_setup_logs(None).map(|_| ()))
        .map_err(map_setup_error)?;
    let preferences = load_update_preferences(&app_data)?;
    Ok(UpdateStatusResponse {
        snapshot: state.snapshot()?,
        startup_check_enabled: preferences.startup_check_enabled,
    })
}

#[tauri::command]
pub fn update_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
    _startup: bool,
) -> UpdateResult<UpdateSnapshot> {
    let run_id = opaque_id()?;
    let claim = state.claim_check(run_id.clone(), now_ms())?;
    if !claim.claimed {
        return Ok(claim.snapshot);
    }
    let worker_state = state.inner().clone();
    let initial = claim.snapshot;
    let worker_id = claim.worker_id.ok_or_else(|| {
        update_error(
            "update_worker_missing",
            "Update worker ownership is unavailable.",
        )
    })?;
    tauri::async_runtime::spawn(async move {
        run_check(app, worker_state, run_id, worker_id).await;
    });
    Ok(initial)
}

async fn run_check(app: AppHandle, state: UpdateState, run_id: String, worker_id: u64) {
    let _worker = WorkerFinishGuard::new(app.clone(), state.clone(), run_id.clone(), worker_id);
    let result = async {
        let app_data = app_data_path(&app)?;
        let log = Arc::new(Mutex::new(BoundedUpdateLog::create(&app_data, &run_id)?));
        state.register_log(
            &run_id,
            log.lock()
                .map_err(|_| update_error("update_log_unavailable", "Update log is unavailable."))?
                .saved
                .clone(),
        )?;
        emit_log(
            &app,
            &state,
            &run_id,
            &log,
            "Checking the signed release channel.",
        )?;
        let updater = app
            .updater_builder()
            .timeout(UPDATE_TIMEOUT)
            .build()
            .map_err(|_| {
                update_error(
                    "update_configuration_invalid",
                    "The signed updater configuration is invalid.",
                )
            })?;
        let available = updater.check().await.map_err(map_plugin_error)?;
        match available {
            None => {
                if let Some(event) = state.commit_check_current(&run_id)? {
                    emit(&app, event);
                }
            }
            Some(update) => {
                let release = release_metadata(&update)?;
                if let Some(event) = state.commit_check_available(&run_id, update, release)? {
                    emit(&app, event);
                }
            }
        }
        Ok::<(), UpdateError>(())
    }
    .await;
    if let Err(error) = result {
        let event = if error.code == "update_offline" {
            state.complete_check_offline(&run_id)
        } else {
            state.complete_check_failure(&run_id, error)
        };
        if let Ok(Some(event)) = event {
            emit(&app, event);
        }
    }
}

#[tauri::command]
pub fn update_download_install(
    app: AppHandle,
    state: State<'_, UpdateState>,
    run_id: String,
) -> UpdateResult<UpdateSnapshot> {
    let (snapshot, update, worker_id) = state.begin_download(&run_id)?;
    let worker_state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        run_download_install(app, worker_state, run_id, update, worker_id).await;
    });
    Ok(snapshot)
}

async fn run_download_install(
    app: AppHandle,
    state: UpdateState,
    run_id: String,
    update: Update,
    worker_id: u64,
) {
    let _worker = WorkerFinishGuard::new(app.clone(), state.clone(), run_id.clone(), worker_id);
    let result = async {
        let app_data = app_data_path(&app)?;
        let log = Arc::new(Mutex::new(BoundedUpdateLog::create(&app_data, &run_id)?));
        state.register_log(
            &run_id,
            log.lock()
                .map_err(|_| update_error("update_log_unavailable", "Update log is unavailable."))?
                .saved
                .clone(),
        )?;
        emit_log(
            &app,
            &state,
            &run_id,
            &log,
            "Downloading the signed update artifact.",
        )?;
        let downloaded = Arc::new(Mutex::new(0_u64));
        let started = Instant::now();
        let app_for_chunk = app.clone();
        let state_for_chunk = state.clone();
        let run_for_chunk = run_id.clone();
        let downloaded_for_chunk = downloaded.clone();
        let app_for_finish = app.clone();
        let state_for_finish = state.clone();
        let run_for_finish = run_id.clone();
        let verified = update
            .download(
                move |chunk, total| {
                    let Ok(mut bytes) = downloaded_for_chunk.lock() else {
                        return;
                    };
                    *bytes = bytes.saturating_add(chunk as u64);
                    let elapsed = started.elapsed().as_secs_f64();
                    let speed = (elapsed > 0.0).then_some((*bytes as f64 / elapsed) as u64);
                    if let Ok(Some(event)) =
                        state_for_chunk.download_event(&run_for_chunk, *bytes, total, speed)
                    {
                        emit(&app_for_chunk, event);
                    }
                },
                move || {
                    if let Ok(event) = state_for_finish.phase_event(
                        &run_for_finish,
                        UpdatePhase::Verifying,
                        true,
                        None,
                        None,
                    ) {
                        emit(&app_for_finish, event);
                    }
                },
            )
            .await
            .map_err(map_plugin_error);

        let app_for_commit = app.clone();
        let state_for_commit = state.clone();
        let run_for_commit = run_id.clone();
        let outcome = install_after_verified_download(
            verified,
            move || {
                let event = state_for_commit.commit_installing(&run_for_commit)?;
                if let Some(event) = event.as_ref() {
                    emit(&app_for_commit, event.clone());
                }
                Ok(event)
            },
            |bytes| update.install(bytes).map_err(map_plugin_error),
        )?;
        if outcome == InstallOutcome::Installed {
            emit(
                &app,
                state.phase_event(
                    &run_id,
                    UpdatePhase::RestartRequired,
                    false,
                    None,
                    Some("Relaunch to finish the update.".to_owned()),
                )?,
            );
        }
        Ok::<(), UpdateError>(())
    }
    .await;
    if let Err(error) = result {
        if let Ok(Some(event)) = state.complete_download_failure(&run_id, error) {
            emit(&app, event);
        }
    }
}

#[tauri::command]
pub fn update_cancel(
    app: AppHandle,
    run_id: String,
    state: State<'_, UpdateState>,
) -> UpdateResult<bool> {
    let (cancelled, event) = state.cancel(&run_id)?;
    if let Some(event) = event {
        emit(&app, event);
    }
    Ok(cancelled)
}

#[tauri::command]
pub fn update_defer(run_id: String, state: State<'_, UpdateState>) -> UpdateResult<UpdateSnapshot> {
    state.defer(&run_id)
}

#[tauri::command]
pub fn update_open_log(
    _app: AppHandle,
    state: State<'_, UpdateState>,
    run_id: String,
) -> UpdateResult<()> {
    let saved = state.saved_log(&run_id)?;
    saved
        .open_with(|path| {
            open::that_detached(path).map_err(|_| crate::setup::SetupError {
                code: "setup_log_open_failed",
                message: "The saved update log could not be opened.".to_owned(),
            })
        })
        .map_err(map_setup_error)
}

#[tauri::command]
pub fn update_set_startup_check(app: AppHandle, enabled: bool) -> UpdateResult<bool> {
    store_update_preferences(&app_data_path(&app)?, enabled)?;
    Ok(enabled)
}

#[tauri::command]
pub fn update_relaunch(app: AppHandle, state: State<'_, UpdateState>) -> UpdateResult<()> {
    if state.snapshot()?.phase != UpdatePhase::RestartRequired {
        return Err(update_error(
            "update_restart_unavailable",
            "Relaunch is available only after a verified installation.",
        ));
    }
    app.request_restart();
    Ok(())
}

fn release_metadata(update: &Update) -> UpdateResult<UpdateRelease> {
    let notes = sanitize_release_notes(update.body.as_deref().unwrap_or_default());
    let size = update
        .raw_json
        .get("size")
        .and_then(serde_json::Value::as_u64)
        .filter(|size| *size <= 4 * 1024 * 1024 * 1024);
    let platform = tauri_plugin_updater::target().ok_or_else(|| {
        update_error(
            "update_platform_unsupported",
            "This operating system and architecture are not supported.",
        )
    })?;
    Ok(UpdateRelease {
        version: update.version.chars().take(128).collect(),
        notes,
        date: update.date.map(|date| date.to_string()),
        size,
        platform,
    })
}

fn sanitize_release_notes(input: &str) -> String {
    let mut output = String::new();
    let mut inside_tag = false;
    for character in input.chars() {
        if output.len() >= MAX_RELEASE_NOTES {
            break;
        }
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag && (!character.is_control() || matches!(character, '\n' | '\t')) => {
                output.push(character)
            }
            _ => {}
        }
    }
    output
}

fn map_plugin_error(error: tauri_plugin_updater::Error) -> UpdateError {
    let text = error.to_string().to_ascii_lowercase();
    if text.contains("signature") || text.contains("minisign") {
        update_error(
            "update_signature_invalid",
            "The update signature could not be verified.",
        )
    } else if text.contains("network")
        || text.contains("request")
        || text.contains("timeout")
        || text.contains("connect")
    {
        update_error(
            "update_offline",
            "The release channel could not be reached.",
        )
    } else {
        update_error(
            "update_failed",
            "The signed update operation could not be completed.",
        )
    }
}

fn emit(app: &AppHandle, event: UpdateEvent) {
    let _ = app.emit("update://event", event);
}

fn emit_log(
    app: &AppHandle,
    state: &UpdateState,
    run_id: &str,
    log: &Arc<Mutex<BoundedUpdateLog>>,
    input: &str,
) -> UpdateResult<()> {
    let line = log
        .lock()
        .map_err(|_| update_error("update_log_unavailable", "Update log is unavailable."))?
        .push(input)?;
    if let Some(event) = state.log_event(run_id, line)? {
        emit(app, event);
    }
    Ok(())
}

fn app_data_path(app: &AppHandle) -> UpdateResult<PathBuf> {
    app.path().app_data_dir().map_err(|_| {
        update_error(
            "update_path_unavailable",
            "Application data is unavailable.",
        )
    })
}

fn cap_file_identity(file: &CapabilityFile) -> UpdateResult<Handle> {
    Handle::from_file(
        file.try_clone()
            .map_err(|_| {
                update_error(
                    "update_settings_changed",
                    "A private settings handle could not be retained.",
                )
            })?
            .into_std(),
    )
    .map_err(|_| {
        update_error(
            "update_settings_changed",
            "A private settings identity could not be read.",
        )
    })
}

fn named_cap_file_matches(
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
        .and_then(|file| cap_file_identity(&file).ok())
        .is_some_and(|identity| identity == *expected)
}

fn regular_cap_destination(directory: &Dir, name: &str) -> UpdateResult<Option<Handle>> {
    let metadata = match directory.symlink_metadata(name) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => {
            return Err(update_error(
                "update_settings_changed",
                "Update settings could not be inspected.",
            ))
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 4_096 {
        return Err(update_error(
            "update_settings_invalid",
            "Update settings are not a safe regular file.",
        ));
    }
    let file = directory.open(name).map_err(|_| {
        update_error(
            "update_settings_changed",
            "Update settings could not be opened.",
        )
    })?;
    let identity = cap_file_identity(&file)?;
    if !named_cap_file_matches(directory, OsStr::new(name), &identity, 4_096) {
        return Err(update_error(
            "update_settings_changed",
            "Update settings changed while inspected.",
        ));
    }
    Ok(Some(identity))
}

#[cfg(not(windows))]
fn commit_update_preferences(
    directory: &Dir,
    temporary: &OsStr,
    _file: &CapabilityFile,
    _exists: bool,
) -> UpdateResult<()> {
    directory
        .rename(temporary, directory, SETTINGS_FILE)
        .map_err(|_| {
            update_error(
                "update_settings_write_failed",
                "Update settings could not be committed.",
            )
        })
}

#[cfg(windows)]
fn commit_update_preferences(
    directory: &Dir,
    temporary: &OsStr,
    file: &CapabilityFile,
    exists: bool,
) -> UpdateResult<()> {
    if !exists {
        return directory
            .rename(temporary, directory, SETTINGS_FILE)
            .map_err(|_| {
                update_error(
                    "update_settings_write_failed",
                    "Update settings could not be committed.",
                )
            });
    }
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileRenameInfo, SetFileInformationByHandle, FILE_RENAME_INFO_0,
    };
    const TARGET_LENGTH: usize = SETTINGS_FILE.len();
    #[repr(C)]
    struct RelativeRenameInfo {
        anonymous: FILE_RENAME_INFO_0,
        root_directory: windows_sys::Win32::Foundation::HANDLE,
        file_name_length: u32,
        file_name: [u16; TARGET_LENGTH],
    }
    let mut file_name = [0_u16; TARGET_LENGTH];
    for (destination, source) in file_name.iter_mut().zip(SETTINGS_FILE.encode_utf16()) {
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
        Err(update_error(
            "update_settings_write_failed",
            "Update settings could not be atomically replaced.",
        ))
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_cap_directory(directory: &Dir) -> UpdateResult<()> {
    directory
        .try_clone()
        .map(Dir::into_std_file)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| {
            update_error(
                "update_settings_write_failed",
                "Update settings could not be synchronized.",
            )
        })
}

#[cfg(not(unix))]
fn sync_cap_directory(_directory: &Dir) -> UpdateResult<()> {
    Ok(())
}

fn opaque_id() -> UpdateResult<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| {
        update_error(
            "update_identity_failed",
            "A private update run could not be created.",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn update_error(code: impl Into<String>, message: impl Into<String>) -> UpdateError {
    UpdateError {
        code: code.into(),
        message: message.into(),
    }
}

fn map_setup_error(error: SetupError) -> UpdateError {
    update_error(error.code.replace("setup", "update"), error.message)
}

#[cfg(test)]
mod atomic_transition_tests {
    use super::*;
    use std::sync::{Barrier, TryLockError};

    fn state_in_phase(run_id: &str, phase: UpdatePhase) -> UpdateState {
        let state = UpdateState::default();
        let cancellation = Arc::new(AtomicBool::new(false));
        {
            let mut runtime = state.lock().unwrap();
            runtime.snapshot.run_id = run_id.to_owned();
            runtime.snapshot.phase = phase;
            runtime.snapshot.cancellable = true;
            runtime.cancellation = Some(cancellation);
        }
        state
    }

    fn assert_acknowledged_cancellation_wins_completion_race(
        phase: UpdatePhase,
        expected_phase: UpdatePhase,
        complete: impl FnOnce(&UpdateState) -> UpdateResult<Option<UpdateEvent>> + Send + 'static,
    ) -> Arc<UpdateState> {
        let state = Arc::new(state_in_phase("race-run", phase));
        let cancellation_entered = Arc::new(Barrier::new(2));
        let completion_checked_lock = Arc::new(Barrier::new(2));

        let cancel_state = state.clone();
        let cancel_started = cancellation_entered.clone();
        let cancel_release = completion_checked_lock.clone();
        let cancel = std::thread::spawn(move || {
            cancel_state
                .cancel_with_hook("race-run", || {
                    cancel_started.wait();
                    cancel_release.wait();
                })
                .unwrap()
                .0
        });

        let completion_state = state.clone();
        let completion_started = cancellation_entered.clone();
        let completion_release = completion_checked_lock.clone();
        let completion = std::thread::spawn(move || {
            completion_started.wait();
            assert!(matches!(
                completion_state.inner.try_lock(),
                Err(TryLockError::WouldBlock)
            ));
            completion_release.wait();
            complete(&completion_state).unwrap()
        });

        assert!(cancel.join().unwrap());
        assert!(completion.join().unwrap().is_none());
        assert_eq!(state.snapshot().unwrap().phase, expected_phase);
        state
    }

    #[test]
    fn cancelled_check_completion_does_not_publish_current_or_available_state() {
        let state = UpdateState::default();
        state.claim_check("check-run".to_owned(), 100).unwrap();
        assert!(state.cancel("check-run").unwrap().0);
        let stored = AtomicBool::new(false);

        let event = state
            .commit_check_completion(
                "check-run",
                UpdatePhase::Available,
                true,
                None,
                None,
                |_| stored.store(true, Ordering::SeqCst),
            )
            .unwrap();

        assert!(event.is_none());
        assert!(!stored.load(Ordering::SeqCst));
        assert_eq!(state.snapshot().unwrap().phase, UpdatePhase::Dismissed);
    }

    #[test]
    fn available_payload_and_phase_publish_atomically_against_observers() {
        let state = Arc::new(UpdateState::default());
        state.claim_check("check-run".to_owned(), 100).unwrap();
        let payload_stored = Arc::new(AtomicBool::new(false));
        let payload_entered = Arc::new(Barrier::new(2));
        let observer_checked_lock = Arc::new(Barrier::new(2));

        let commit_state = state.clone();
        let commit_payload_stored = payload_stored.clone();
        let commit_entered = payload_entered.clone();
        let commit_release = observer_checked_lock.clone();
        let commit = std::thread::spawn(move || {
            commit_state
                .commit_check_completion(
                    "check-run",
                    UpdatePhase::Available,
                    true,
                    None,
                    None,
                    |_| {
                        commit_payload_stored.store(true, Ordering::SeqCst);
                        commit_entered.wait();
                        commit_release.wait();
                    },
                )
                .unwrap()
        });

        let observer_state = state.clone();
        let observer_entered = payload_entered.clone();
        let observer_release = observer_checked_lock.clone();
        let observer = std::thread::spawn(move || {
            observer_entered.wait();
            assert!(matches!(
                observer_state.inner.try_lock(),
                Err(TryLockError::WouldBlock)
            ));
            observer_release.wait();
            observer_state.snapshot().unwrap()
        });

        assert!(commit.join().unwrap().is_some());
        let observed = observer.join().unwrap();
        assert!(payload_stored.load(Ordering::SeqCst));
        assert_eq!(observed.phase, UpdatePhase::Available);
    }

    #[test]
    fn installing_commit_and_cancellation_are_serialized_by_the_runtime_lock() {
        let state = Arc::new(state_in_phase("install-run", UpdatePhase::Verifying));
        let commit_entered = Arc::new(Barrier::new(2));
        let cancellation_checked_lock = Arc::new(Barrier::new(2));

        let commit_state = state.clone();
        let commit_started = commit_entered.clone();
        let commit_release = cancellation_checked_lock.clone();
        let commit = std::thread::spawn(move || {
            commit_state
                .commit_installing_with_hook("install-run", || {
                    commit_started.wait();
                    commit_release.wait();
                })
                .unwrap()
        });

        let cancel_state = state.clone();
        let cancel_started = commit_entered.clone();
        let cancel_release = cancellation_checked_lock.clone();
        let cancel = std::thread::spawn(move || {
            cancel_started.wait();
            assert!(matches!(
                cancel_state.inner.try_lock(),
                Err(TryLockError::WouldBlock)
            ));
            cancel_release.wait();
            cancel_state.cancel("install-run").unwrap().0
        });

        assert!(commit.join().unwrap().is_some());
        assert!(!cancel.join().unwrap());
        assert_eq!(state.snapshot().unwrap().phase, UpdatePhase::Installing);
    }

    #[test]
    fn cancellation_before_the_install_commit_prevents_installing() {
        let state = state_in_phase("install-run", UpdatePhase::Verifying);
        assert!(state.cancel("install-run").unwrap().0);

        assert!(state.commit_installing("install-run").unwrap().is_none());
        assert_eq!(state.snapshot().unwrap().phase, UpdatePhase::Cancelling);
    }

    #[test]
    fn acknowledged_check_cancellation_wins_error_and_offline_completion_races() {
        assert_acknowledged_cancellation_wins_completion_race(
            UpdatePhase::Checking,
            UpdatePhase::Dismissed,
            |state| {
                state.complete_check_failure(
                    "race-run",
                    update_error("update_check_failed", "The update check failed."),
                )
            },
        );
        assert_acknowledged_cancellation_wins_completion_race(
            UpdatePhase::Checking,
            UpdatePhase::Dismissed,
            |state| state.complete_check_offline("race-run"),
        );
    }

    #[test]
    fn acknowledged_download_cancellation_wins_download_and_signature_failure_races() {
        assert_acknowledged_cancellation_wins_completion_race(
            UpdatePhase::Downloading,
            UpdatePhase::Cancelling,
            |state| {
                state.complete_download_failure(
                    "race-run",
                    update_error("update_download_failed", "The update download failed."),
                )
            },
        );
        let state = assert_acknowledged_cancellation_wins_completion_race(
            UpdatePhase::Verifying,
            UpdatePhase::Cancelling,
            |state| {
                state.complete_download_failure(
                    "race-run",
                    update_error(
                        "update_signature_invalid",
                        "The update signature is invalid.",
                    ),
                )
            },
        );
        let installed = AtomicBool::new(false);
        let outcome = install_after_verified_download(
            Ok::<_, UpdateError>(vec![1]),
            || state.commit_installing("race-run"),
            |_| {
                installed.store(true, Ordering::SeqCst);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(outcome, InstallOutcome::Cancelled);
        assert!(!installed.load(Ordering::SeqCst));
    }

    #[test]
    fn cancelled_check_worker_retains_the_one_run_claim_until_worker_exit() {
        let state = Arc::new(UpdateState::default());
        let claim = state
            .claim_check("cancelled-check".to_owned(), 100)
            .unwrap();
        let worker_id = claim.worker_id.unwrap();
        assert!(state.cancel("cancelled-check").unwrap().0);

        let worker_can_exit = Arc::new(Barrier::new(2));
        let worker_state = state.clone();
        let worker_release = worker_can_exit.clone();
        let worker = std::thread::spawn(move || {
            worker_release.wait();
            worker_state
                .finish_worker("cancelled-check", worker_id)
                .unwrap()
        });

        assert!(
            !state
                .claim_check("too-early".to_owned(), 101)
                .unwrap()
                .claimed
        );
        worker_can_exit.wait();
        assert!(worker.join().unwrap().0);
        assert!(
            state
                .claim_check("after-exit".to_owned(), 102)
                .unwrap()
                .claimed
        );
    }

    #[test]
    fn cancelled_download_requires_recheck_and_retains_claim_until_worker_exit() {
        let state = Arc::new(state_in_phase(
            "cancelled-download",
            UpdatePhase::Downloading,
        ));
        let worker_id = 91;
        state.lock().unwrap().active_worker = Some(WorkerOwnership {
            run_id: "cancelled-download".to_owned(),
            worker_id,
        });

        assert!(state.cancel("cancelled-download").unwrap().0);
        let cancelled = state.snapshot().unwrap();
        assert_eq!(cancelled.phase, UpdatePhase::Cancelling);
        assert!(cancelled
            .message
            .as_deref()
            .unwrap()
            .contains("finishing cancellation"));
        assert!(
            !state
                .claim_check("too-early".to_owned(), 101)
                .unwrap()
                .claimed
        );

        let (released, event) = state
            .finish_worker("cancelled-download", worker_id)
            .unwrap();
        assert!(released);
        assert!(matches!(
            event,
            Some(UpdateEvent::Phase {
                run_id,
                sequence,
                phase: UpdatePhase::RecheckRequired,
                ..
            }) if run_id == "cancelled-download" && sequence == cancelled.sequence + 1
        ));
        assert_eq!(
            state.snapshot().unwrap().phase,
            UpdatePhase::RecheckRequired
        );
        assert!(
            state
                .claim_check("after-exit".to_owned(), 102)
                .unwrap()
                .claimed
        );
    }

    #[test]
    fn failed_update_can_be_dismissed_without_losing_failure_or_log_details() {
        let state = state_in_phase("failed-run", UpdatePhase::Failed);
        {
            let mut runtime = state.lock().unwrap();
            runtime.snapshot.cancellable = false;
            runtime.snapshot.failure = Some(UpdateFailure {
                code: "update_signature_invalid".to_owned(),
                message: "The signature is invalid.".to_owned(),
            });
            runtime.snapshot.logs = vec!["Signature verification failed.".to_owned()];
        }

        let dismissed = state.defer("failed-run").unwrap();
        assert_eq!(dismissed.phase, UpdatePhase::Dismissed);
        assert_eq!(dismissed.failure.unwrap().code, "update_signature_invalid");
        assert_eq!(dismissed.logs, ["Signature verification failed."]);
    }
}
