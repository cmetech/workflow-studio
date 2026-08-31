use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::os::windows::process::CommandExt as WindowsCommandExt;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, TerminateJobObject,
};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    OpenThread, ResumeThread, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
};

use same_file::Handle;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_CONTRACT_BYTES: usize = 512 * 1024;
const CLI_TIMEOUT: Duration = Duration::from_secs(10);
const CLI_SPAWN_RETRY_DELAY: Duration = Duration::from_millis(10);
const CACHE_DIRECTORY: &str = "contracts-v1";
const CACHE_INDEX: &str = "index.json";
static NEXT_CACHE_TEMP: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct ContractGrantState {
    files: Mutex<HashMap<PathBuf, GrantedContractFile>>,
    executables: Mutex<HashMap<PathBuf, GrantedExecutable>>,
}

struct GrantedContractFile {
    path: PathBuf,
    parent_path: PathBuf,
    parent_identity: Handle,
    file_identity: Handle,
    file: File,
}

struct GrantedExecutable {
    path: PathBuf,
    parent_path: PathBuf,
    parent_identity: Handle,
    file_identity: Handle,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub enum ContractProfile {
    #[serde(rename = "hermes-legacy")]
    HermesLegacy,
    #[serde(rename = "archon-2026-07")]
    Archon202607,
}

impl ContractProfile {
    fn as_str(self) -> &'static str {
        match self {
            Self::HermesLegacy => "hermes-legacy",
            Self::Archon202607 => "archon-2026-07",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractError {
    pub code: &'static str,
    pub message: String,
}

type ContractResult<T> = Result<T, ContractError>;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractCacheStoredEntry {
    pub digest: String,
    pub profile: String,
    pub schema_version: u32,
    pub normalizer_version: u32,
    pub reader_version: u32,
    pub source: serde_json::Value,
    pub content: String,
    #[serde(default)]
    pub active: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractCacheLoadAdvisory {
    pub code: &'static str,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractCacheLoadResult {
    pub entries: Vec<ContractCacheStoredEntry>,
    pub advisories: Vec<ContractCacheLoadAdvisory>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContractCacheIndexEntry {
    digest: String,
    profile: String,
    schema_version: u32,
    normalizer_version: u32,
    reader_version: u32,
    source: serde_json::Value,
    #[serde(default)]
    active: bool,
}

impl From<&ContractCacheStoredEntry> for ContractCacheIndexEntry {
    fn from(entry: &ContractCacheStoredEntry) -> Self {
        Self {
            digest: entry.digest.clone(),
            profile: entry.profile.clone(),
            schema_version: entry.schema_version,
            normalizer_version: entry.normalizer_version,
            reader_version: entry.reader_version,
            source: entry.source.clone(),
            active: entry.active,
        }
    }
}

#[tauri::command]
pub async fn contract_choose_file(
    app: AppHandle,
    grants: State<'_, ContractGrantState>,
) -> ContractResult<Option<String>> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Authoring contract", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|_| {
        contract_error(
            "invalid_dialog_path",
            "The selected contract path is unavailable.",
        )
    })?;
    let canonical = grant_contract_file(&path, &grants)?;
    unicode_path(&canonical).map(Some)
}

#[tauri::command]
pub async fn contract_choose_hermes_executable(
    app: AppHandle,
    grants: State<'_, ContractGrantState>,
) -> ContractResult<Option<String>> {
    let Some(selected) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|_| {
        contract_error(
            "invalid_dialog_path",
            "The selected Hermes path is unavailable.",
        )
    })?;
    let canonical = grant_executable(&path, &grants)?;
    unicode_path(&canonical).map(Some)
}

#[tauri::command]
pub fn contract_read_file(
    path: String,
    grants: State<'_, ContractGrantState>,
) -> ContractResult<Vec<u8>> {
    read_granted_contract_file(Path::new(&path), &grants)
}

#[tauri::command]
pub fn contract_run_hermes_cli(
    executable_path: String,
    profile: ContractProfile,
    grants: State<'_, ContractGrantState>,
) -> ContractResult<Vec<u8>> {
    run_granted_hermes_cli(Path::new(&executable_path), profile, &grants)
}

#[tauri::command]
pub fn contract_cache_load(app: AppHandle) -> ContractResult<ContractCacheLoadResult> {
    cache_load_at(&app_data_dir(&app)?)
}

fn cache_load_at(app_data: &Path) -> ContractResult<ContractCacheLoadResult> {
    let root = contract_cache_root_at(app_data)?;
    let index_path = root.join(CACHE_INDEX);
    if !index_path.exists() {
        return Ok(ContractCacheLoadResult {
            entries: Vec::new(),
            advisories: Vec::new(),
        });
    }
    let index = match reject_non_regular_file(&index_path, "contract_cache_read_failed")
        .and_then(|_| read_bounded_utf8(&index_path, "contract_cache_read_failed"))
    {
        Ok(index) => index,
        Err(_) => return reset_malformed_cache_index(app_data, &index_path),
    };
    let index_entries: Vec<ContractCacheIndexEntry> = match serde_json::from_str(&index) {
        Ok(entries) => entries,
        Err(_) => return reset_malformed_cache_index(app_data, &index_path),
    };
    let mut entries = Vec::with_capacity(index_entries.len());
    let mut advisories = Vec::new();
    for index_entry in index_entries {
        let file_name = match cache_file_name(&index_entry.digest) {
            Ok(file_name) => file_name,
            Err(_) => {
                advisories.push(ContractCacheLoadAdvisory {
                    code: "contract_cache_blob_invalid",
                });
                continue;
            }
        };
        let path = root.join(file_name);
        if !path.exists() {
            advisories.push(ContractCacheLoadAdvisory {
                code: "contract_cache_blob_missing",
            });
            continue;
        }
        let content = match reject_non_regular_file(&path, "contract_cache_read_failed")
            .and_then(|_| read_bounded_utf8(&path, "contract_cache_read_failed"))
        {
            Ok(content) => content,
            Err(_) => {
                let _ = fs::remove_file(&path);
                advisories.push(ContractCacheLoadAdvisory {
                    code: "contract_cache_blob_invalid",
                });
                continue;
            }
        };
        entries.push(ContractCacheStoredEntry {
            digest: index_entry.digest,
            profile: index_entry.profile,
            schema_version: index_entry.schema_version,
            normalizer_version: index_entry.normalizer_version,
            reader_version: index_entry.reader_version,
            source: index_entry.source,
            content,
            active: index_entry.active,
        });
    }
    if !advisories.is_empty() && cache_write_at(app_data, entries.clone()).is_err() {
        advisories.push(ContractCacheLoadAdvisory {
            code: "contract_cache_cleanup_failed",
        });
    }
    Ok(ContractCacheLoadResult {
        entries,
        advisories,
    })
}

fn reset_malformed_cache_index(
    app_data: &Path,
    index_path: &Path,
) -> ContractResult<ContractCacheLoadResult> {
    let _ = fs::remove_file(index_path);
    let mut advisories = vec![ContractCacheLoadAdvisory {
        code: "contract_cache_index_invalid",
    }];
    if cache_write_at(app_data, Vec::new()).is_err() {
        advisories.push(ContractCacheLoadAdvisory {
            code: "contract_cache_cleanup_failed",
        });
    }
    Ok(ContractCacheLoadResult {
        entries: Vec::new(),
        advisories,
    })
}

#[tauri::command]
pub fn contract_cache_write(
    entries: Vec<ContractCacheStoredEntry>,
    app: AppHandle,
) -> ContractResult<()> {
    cache_write_at(&app_data_dir(&app)?, entries)
}

fn cache_write_at(app_data: &Path, entries: Vec<ContractCacheStoredEntry>) -> ContractResult<()> {
    let root = contract_cache_root_at(app_data)?;
    for entry in &entries {
        let file_name = cache_file_name(&entry.digest)?;
        let path = root.join(file_name);
        if path.exists() {
            reject_non_regular_file(&path, "contract_cache_write_failed")?;
            if read_bounded_utf8(&path, "contract_cache_write_failed")? != entry.content {
                return Err(contract_error(
                    "contract_cache_immutable_conflict",
                    "A cached contract digest already names different content.",
                ));
            }
        } else {
            write_atomic(
                &path,
                entry.content.as_bytes(),
                "contract_cache_write_failed",
            )?;
        }
    }
    let index_entries = entries
        .iter()
        .map(ContractCacheIndexEntry::from)
        .collect::<Vec<_>>();
    let index = serde_json::to_vec_pretty(&index_entries).map_err(|_| {
        contract_error(
            "contract_cache_write_failed",
            "The contract cache index could not be encoded.",
        )
    })?;
    write_atomic(
        &root.join(CACHE_INDEX),
        &index,
        "contract_cache_write_failed",
    )?;
    let retained = entries
        .iter()
        .map(|entry| cache_file_name(&entry.digest))
        .collect::<ContractResult<std::collections::HashSet<_>>>()?;
    for entry in fs::read_dir(&root).map_err(|error| {
        contract_error(
            "contract_cache_prune_failed",
            format!("Could not list cached contracts: {error}"),
        )
    })? {
        let entry = entry.map_err(|error| {
            contract_error(
                "contract_cache_prune_failed",
                format!("Could not inspect cached contracts: {error}"),
            )
        })?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name != CACHE_INDEX && name.ends_with(".json") && !retained.contains(&name) {
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| {
                contract_error(
                    "contract_cache_prune_failed",
                    format!("Could not inspect stale contract data: {error}"),
                )
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(contract_error(
                    "contract_cache_prune_failed",
                    "Stale contract data is not a regular file.",
                ));
            }
            fs::remove_file(entry.path()).map_err(|error| {
                contract_error(
                    "contract_cache_prune_failed",
                    format!("Could not remove stale contract data: {error}"),
                )
            })?;
        }
    }
    Ok(())
}

#[cfg(test)]
fn read_contract_file(path: &Path) -> ContractResult<Vec<u8>> {
    reject_non_regular_file(path, "contract_read_failed")?;
    read_bounded_bytes(path, "contract_read_failed")
}

fn grant_contract_file(path: &Path, grants: &ContractGrantState) -> ContractResult<PathBuf> {
    let bound = bind_regular_file(path)?;
    let canonical = bound.path.clone();
    grants
        .files
        .lock()
        .map_err(|_| grant_state_error())?
        .insert(canonical.clone(), bound);
    Ok(canonical)
}

fn grant_executable(path: &Path, grants: &ContractGrantState) -> ContractResult<PathBuf> {
    let bound = bind_regular_file(path)?;
    let canonical = bound.path.clone();
    grants
        .executables
        .lock()
        .map_err(|_| grant_state_error())?
        .insert(
            canonical.clone(),
            GrantedExecutable {
                path: bound.path,
                parent_path: bound.parent_path,
                parent_identity: bound.parent_identity,
                file_identity: bound.file_identity,
            },
        );
    Ok(canonical)
}

fn bind_regular_file(path: &Path) -> ContractResult<GrantedContractFile> {
    let metadata = fs::symlink_metadata(path).map_err(|_| {
        contract_error(
            "contract_path_not_found",
            "The selected contract path does not exist.",
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(contract_error(
            "contract_path_invalid",
            "Select a regular file, not a symbolic link.",
        ));
    }
    let canonical = path.canonicalize().map_err(|_| {
        contract_error(
            "contract_path_not_found",
            "The selected contract path does not exist.",
        )
    })?;
    let parent_path = canonical
        .parent()
        .ok_or_else(|| {
            contract_error(
                "contract_path_invalid",
                "The selected path has no parent directory.",
            )
        })?
        .to_path_buf();
    let parent_identity = Handle::from_path(&parent_path).map_err(|error| {
        contract_error(
            "contract_grant_failed",
            format!("Could not bind the selected directory: {error}"),
        )
    })?;
    let file = File::open(&canonical).map_err(|error| {
        contract_error(
            "contract_grant_failed",
            format!("Could not bind the selected file: {error}"),
        )
    })?;
    let file_identity = Handle::from_file(file.try_clone().map_err(|error| {
        contract_error(
            "contract_grant_failed",
            format!("Could not bind the selected file: {error}"),
        )
    })?)
    .map_err(|error| {
        contract_error(
            "contract_grant_failed",
            format!("Could not identify the selected file: {error}"),
        )
    })?;
    if Handle::from_path(&canonical).map_err(|error| {
        contract_error(
            "contract_grant_failed",
            format!("Could not identify the selected file: {error}"),
        )
    })? != file_identity
    {
        return Err(contract_error(
            "contract_path_changed",
            "The selected path changed while permission was granted.",
        ));
    }
    Ok(GrantedContractFile {
        path: canonical,
        parent_path,
        parent_identity,
        file_identity,
        file,
    })
}

fn read_granted_contract_file(path: &Path, grants: &ContractGrantState) -> ContractResult<Vec<u8>> {
    let mut granted = grants
        .files
        .lock()
        .map_err(|_| grant_state_error())?
        .remove(path)
        .ok_or_else(|| {
            contract_error(
                "dialog_permission_required",
                "Select this exact contract file before reading it.",
            )
        })?;
    verify_granted(
        &granted.path,
        &granted.parent_path,
        &granted.parent_identity,
        &granted.file_identity,
    )?;
    let metadata = granted.file.metadata().map_err(|error| {
        contract_error(
            "contract_read_failed",
            format!("Could not inspect the selected contract: {error}"),
        )
    })?;
    if metadata.len() as usize > MAX_CONTRACT_BYTES {
        return Err(contract_error(
            "contract_file_too_large",
            "Contract files cannot exceed 512 KiB.",
        ));
    }
    granted.file.seek(SeekFrom::Start(0)).map_err(|error| {
        contract_error(
            "contract_read_failed",
            format!("Could not seek the selected contract: {error}"),
        )
    })?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    (&mut granted.file)
        .take((MAX_CONTRACT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            contract_error(
                "contract_read_failed",
                format!("Could not read the selected contract: {error}"),
            )
        })?;
    if bytes.len() > MAX_CONTRACT_BYTES {
        return Err(contract_error(
            "contract_file_too_large",
            "Contract files cannot exceed 512 KiB.",
        ));
    }
    Ok(bytes)
}

fn run_granted_hermes_cli(
    path: &Path,
    profile: ContractProfile,
    grants: &ContractGrantState,
) -> ContractResult<Vec<u8>> {
    let granted = grants
        .executables
        .lock()
        .map_err(|_| grant_state_error())?
        .remove(path)
        .ok_or_else(|| {
            contract_error(
                "dialog_permission_required",
                "Select this exact Hermes executable before refreshing.",
            )
        })?;
    verify_granted(
        &granted.path,
        &granted.parent_path,
        &granted.parent_identity,
        &granted.file_identity,
    )?;
    run_hermes_cli(&granted.path, profile)
}

fn verify_granted(
    path: &Path,
    parent_path: &Path,
    parent_identity: &Handle,
    file_identity: &Handle,
) -> ContractResult<()> {
    if Handle::from_path(parent_path)
        .map_err(|_| contract_error("contract_parent_changed", "The selected directory changed."))?
        != *parent_identity
    {
        return Err(contract_error(
            "contract_parent_changed",
            "The selected directory changed.",
        ));
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| contract_error("contract_path_changed", "The selected path changed."))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(contract_error(
            "contract_path_changed",
            "The selected path changed.",
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| contract_error("contract_path_changed", "The selected path changed."))?;
    if canonical != path
        || Handle::from_path(&canonical)
            .map_err(|_| contract_error("contract_path_changed", "The selected path changed."))?
            != *file_identity
    {
        return Err(contract_error(
            "contract_path_changed",
            "The selected path changed.",
        ));
    }
    Ok(())
}

fn unicode_path(path: &Path) -> ContractResult<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        contract_error(
            "invalid_dialog_path",
            "The selected path is not valid Unicode.",
        )
    })
}

fn grant_state_error() -> ContractError {
    contract_error(
        "dialog_grant_unavailable",
        "Contract selection grants are unavailable.",
    )
}

fn run_hermes_cli(executable: &Path, profile: ContractProfile) -> ContractResult<Vec<u8>> {
    run_hermes_cli_with_spawn(executable, profile, Command::spawn)
}

fn run_hermes_cli_with_spawn(
    executable: &Path,
    profile: ContractProfile,
    mut spawn: impl FnMut(&mut Command) -> std::io::Result<std::process::Child>,
) -> ContractResult<Vec<u8>> {
    let mut command = Command::new(executable);
    command
        .args([
            "workflow",
            "schema",
            "--profile",
            profile.as_str(),
            "--json",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_SUSPENDED);
    let started = Instant::now();
    let mut child = loop {
        match spawn(&mut command) {
            Ok(child) => break child,
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    && started.elapsed() < CLI_TIMEOUT =>
            {
                thread::sleep(CLI_SPAWN_RETRY_DELAY);
            }
            Err(error) => {
                return Err(contract_error(
                    "contract_cli_spawn_failed",
                    format!("Could not start the selected Hermes executable: {error}"),
                ));
            }
        }
    };
    #[cfg(unix)]
    let process_id = child.id();
    #[cfg(windows)]
    let process_job = match contain_windows_suspended_child(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let (stdout_sender, stdout_receiver) = mpsc::sync_channel(1);
    let (stderr_sender, stderr_receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = stdout_sender.send(read_stream_bounded(stdout));
    });
    thread::spawn(move || {
        let _ = stderr_sender.send(read_stream_bounded(stderr));
    });
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < CLI_TIMEOUT => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                terminate_process_tree(
                    &mut child,
                    #[cfg(unix)]
                    process_id,
                    #[cfg(windows)]
                    &process_job,
                );
                return Err(contract_error(
                    "contract_cli_timeout",
                    "Hermes schema output exceeded the 10-second timeout.",
                ));
            }
            Err(error) => {
                terminate_process_tree(
                    &mut child,
                    #[cfg(unix)]
                    process_id,
                    #[cfg(windows)]
                    &process_job,
                );
                return Err(contract_error(
                    "contract_cli_wait_failed",
                    format!("Could not wait for Hermes: {error}"),
                ));
            }
        }
    };
    let remaining = CLI_TIMEOUT.saturating_sub(started.elapsed());
    let stdout = stdout_receiver.recv_timeout(remaining).map_err(|_| {
        terminate_process_tree(
            &mut child,
            #[cfg(unix)]
            process_id,
            #[cfg(windows)]
            &process_job,
        );
        contract_error(
            "contract_cli_timeout",
            "Hermes schema output exceeded the 10-second timeout.",
        )
    })??;
    let remaining = CLI_TIMEOUT.saturating_sub(started.elapsed());
    let stderr = stderr_receiver.recv_timeout(remaining).map_err(|_| {
        terminate_process_tree(
            &mut child,
            #[cfg(unix)]
            process_id,
            #[cfg(windows)]
            &process_job,
        );
        contract_error(
            "contract_cli_timeout",
            "Hermes schema output exceeded the 10-second timeout.",
        )
    })??;
    if !status.success() {
        return Err(contract_error(
            "contract_cli_nonzero_exit",
            "The selected Hermes executable returned a non-zero exit status.",
        ));
    }
    if stdout.len() > MAX_CONTRACT_BYTES {
        return Err(contract_error(
            "contract_cli_output_too_large",
            "Hermes schema output exceeds the 512 KiB limit.",
        ));
    }
    if stdout.is_empty() && !stderr.is_empty() {
        return Err(contract_error(
            "contract_cli_stderr_only",
            "Hermes wrote diagnostics but no schema JSON.",
        ));
    }
    String::from_utf8(stdout.clone()).map_err(|_| {
        contract_error(
            "contract_cli_invalid_utf8",
            "Hermes schema output is not valid UTF-8.",
        )
    })?;
    Ok(stdout)
}

fn terminate_process_tree(
    child: &mut std::process::Child,
    #[cfg(unix)] process_id: u32,
    #[cfg(windows)] process_job: &WindowsProcessJob,
) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(process_id as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    unsafe {
        let _ = TerminateJobObject(process_job.0, 1);
    }
    let _ = child.kill();
}

#[cfg(windows)]
struct WindowsProcessJob(HANDLE);

#[cfg(windows)]
impl Drop for WindowsProcessJob {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(windows)]
fn contain_windows_suspended_child(
    child: &std::process::Child,
) -> ContractResult<WindowsProcessJob> {
    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job.is_null() {
        return Err(contract_error(
            "contract_cli_spawn_failed",
            format!(
                "Could not create a Hermes process job: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    let job = WindowsProcessJob(job);
    if unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE) } == 0 {
        return Err(contract_error(
            "contract_cli_spawn_failed",
            format!(
                "Could not assign Hermes to a process job: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    let thread = primary_thread_for(child.id())?;
    if unsafe { ResumeThread(thread) } == u32::MAX {
        unsafe { CloseHandle(thread) };
        unsafe { TerminateJobObject(job.0, 1) };
        return Err(contract_error(
            "contract_cli_spawn_failed",
            format!(
                "Could not resume contained Hermes: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    unsafe { CloseHandle(thread) };
    Ok(job)
}

#[cfg(windows)]
fn primary_thread_for(process_id: u32) -> ContractResult<HANDLE> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot.is_null() || snapshot as isize == -1 {
        return Err(contract_error(
            "contract_cli_spawn_failed",
            format!(
                "Could not enumerate suspended Hermes threads: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
    let mut found = None;
    if unsafe { Thread32First(snapshot, &mut entry) } != 0 {
        loop {
            if entry.th32OwnerProcessID == process_id {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if !thread.is_null() {
                    found = Some(thread);
                    break;
                }
            }
            if unsafe { Thread32Next(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }
    unsafe { CloseHandle(snapshot) };
    found.ok_or_else(|| {
        contract_error(
            "contract_cli_spawn_failed",
            "Could not open the suspended Hermes primary thread.",
        )
    })
}

fn read_stream_bounded(mut stream: impl Read) -> ContractResult<Vec<u8>> {
    let mut bytes = Vec::new();
    stream
        .by_ref()
        .take((MAX_CONTRACT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            contract_error(
                "contract_cli_read_failed",
                format!("Could not read Hermes output: {error}"),
            )
        })?;
    Ok(bytes)
}

fn read_bounded_bytes(path: &Path, code: &'static str) -> ContractResult<Vec<u8>> {
    let metadata = fs::metadata(path).map_err(|error| {
        contract_error(
            code,
            format!("Could not inspect the contract file: {error}"),
        )
    })?;
    if metadata.len() as usize > MAX_CONTRACT_BYTES {
        return Err(contract_error(
            "contract_file_too_large",
            "Contract files cannot exceed 512 KiB.",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .and_then(|file| {
            file.take((MAX_CONTRACT_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
        })
        .map_err(|error| {
            contract_error(code, format!("Could not read the contract file: {error}"))
        })?;
    if bytes.len() > MAX_CONTRACT_BYTES {
        return Err(contract_error(
            "contract_file_too_large",
            "Contract files cannot exceed 512 KiB.",
        ));
    }
    Ok(bytes)
}

fn read_bounded_utf8(path: &Path, code: &'static str) -> ContractResult<String> {
    String::from_utf8(read_bounded_bytes(path, code)?)
        .map_err(|_| contract_error(code, "The cached contract is not valid UTF-8."))
}

fn app_data_dir(app: &AppHandle) -> ContractResult<PathBuf> {
    app.path().app_data_dir().map_err(|error| {
        contract_error(
            "contract_cache_path_unavailable",
            format!("The application data directory is unavailable: {error}"),
        )
    })
}

fn contract_cache_root_at(app_data: &Path) -> ContractResult<PathBuf> {
    fs::create_dir_all(app_data).map_err(|error| {
        contract_error(
            "contract_cache_write_failed",
            format!("Could not create application data: {error}"),
        )
    })?;
    reject_non_directory(&app_data)?;
    let root = app_data.join(CACHE_DIRECTORY);
    if !root.exists() {
        fs::create_dir(&root).map_err(|error| {
            contract_error(
                "contract_cache_write_failed",
                format!("Could not create the contract cache: {error}"),
            )
        })?;
    }
    reject_non_directory(&root)?;
    Ok(root)
}

fn cache_file_name(digest: &str) -> ContractResult<String> {
    let Some(hex) = digest.strip_prefix("sha256:") else {
        return Err(contract_error(
            "contract_cache_invalid_digest",
            "Contract cache digests must use sha256.",
        ));
    };
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(contract_error(
            "contract_cache_invalid_digest",
            "Contract cache digests must contain 64 hexadecimal characters.",
        ));
    }
    Ok(format!("{hex}.json"))
}

fn reject_non_regular_file(path: &Path, code: &'static str) -> ContractResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        contract_error(
            code,
            format!("Could not inspect the contract path: {error}"),
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(contract_error(
            code,
            "Contract data must be a regular file.",
        ));
    }
    Ok(())
}

fn reject_non_directory(path: &Path) -> ContractResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        contract_error(
            "contract_cache_write_failed",
            format!("Could not inspect the cache directory: {error}"),
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(contract_error(
            "contract_cache_write_failed",
            "Contract cache storage must be a regular directory.",
        ));
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8], code: &'static str) -> ContractResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| contract_error(code, "Contract cache has no parent directory."))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("contract"),
        NEXT_CACHE_TEMP.fetch_add(1, Ordering::Relaxed),
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| {
                contract_error(
                    code,
                    format!("Could not create a cache temporary file: {error}"),
                )
            })?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| {
                contract_error(
                    code,
                    format!("Could not write a cache temporary file: {error}"),
                )
            })?;
        drop(file);
        replace_atomically(&temporary, path).map_err(|error| {
            contract_error(code, format!("Could not replace cache data: {error}"))
        })?;
        sync_cache_parent(parent, code)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(unix)]
fn sync_cache_parent(parent: &Path, code: &'static str) -> ContractResult<()> {
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| contract_error(code, format!("Could not sync cache data: {error}")))
}

#[cfg(not(unix))]
fn sync_cache_parent(_parent: &Path, _code: &'static str) -> ContractResult<()> {
    Ok(())
}

#[cfg(not(windows))]
fn replace_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn contract_error(code: &'static str, message: impl Into<String>) -> ContractError {
    ContractError {
        code,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cache_load_at, cache_write_at, grant_contract_file, read_contract_file,
        read_granted_contract_file, run_hermes_cli, run_hermes_cli_with_spawn,
        ContractCacheStoredEntry, ContractGrantState, ContractProfile, MAX_CONTRACT_BYTES,
    };
    use std::fs;
    use std::path::{Path, PathBuf};

    #[cfg(unix)]
    fn fixture(script: &str) -> (tempfile::TempDir, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("hermes-fixture");
        fs::write(&executable, format!("#!/bin/sh\n{script}\n")).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        (directory, executable)
    }

    #[cfg(unix)]
    #[test]
    fn invokes_the_fixed_profile_schema_arguments_without_a_shell_or_renderer_arguments() {
        let directory = tempfile::tempdir().unwrap();
        let argument_log = directory.path().join("arguments");
        let executable = directory.path().join("hermes-fixture");
        let quoted_log = argument_log.to_string_lossy().replace('\'', "'\\''");
        fs::write(&executable, format!("#!/bin/sh\nprintf '%s\\n' \"$#\" \"$1\" \"$2\" \"$3\" \"$4\" \"$5\" > '{quoted_log}'\nprintf '{{}}'\n")).unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();

        assert_eq!(
            run_hermes_cli(&executable, ContractProfile::HermesLegacy).unwrap(),
            b"{}"
        );
        assert_eq!(
            fs::read_to_string(&argument_log).unwrap(),
            "5\nworkflow\nschema\n--profile\nhermes-legacy\n--json\n"
        );
        assert_eq!(
            run_hermes_cli(&executable, ContractProfile::Archon202607).unwrap(),
            b"{}"
        );
        assert_eq!(
            fs::read_to_string(&argument_log).unwrap(),
            "5\nworkflow\nschema\n--profile\narchon-2026-07\n--json\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn returns_typed_errors_for_cli_exit_stderr_output_ceiling_invalid_utf8_and_timeout() {
        for (script, expected) in [
            ("exit 7", "contract_cli_nonzero_exit"),
            ("printf diagnostic >&2", "contract_cli_stderr_only"),
            (
                "dd if=/dev/zero bs=1 count=524289 2>/dev/null",
                "contract_cli_output_too_large",
            ),
            ("printf '\\377'", "contract_cli_invalid_utf8"),
            ("sleep 11", "contract_cli_timeout"),
        ] {
            let (_directory, executable) = fixture(script);
            assert_eq!(
                run_hermes_cli(&executable, ContractProfile::HermesLegacy)
                    .unwrap_err()
                    .code,
                expected
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn timeout_kills_a_descendant_that_keeps_contract_pipes_open() {
        let (_directory, executable) = fixture("sleep 30 & exit 0");
        let started = std::time::Instant::now();
        let error = run_hermes_cli(&executable, ContractProfile::HermesLegacy).unwrap_err();
        assert_eq!(error.code, "contract_cli_timeout", "{}", error.message);
        assert!(started.elapsed() < std::time::Duration::from_secs(12));
    }

    #[cfg(unix)]
    #[test]
    fn retries_a_transient_process_limit_error_before_starting_the_cli() {
        let (_directory, executable) = fixture("printf '{}'");
        let mut attempts = 0;

        let output =
            run_hermes_cli_with_spawn(&executable, ContractProfile::HermesLegacy, |command| {
                attempts += 1;
                if attempts == 1 {
                    Err(std::io::Error::from_raw_os_error(libc::EAGAIN))
                } else {
                    command.spawn()
                }
            })
            .unwrap();

        assert_eq!(output, b"{}");
        assert_eq!(attempts, 2);
    }

    #[test]
    fn reads_only_a_single_bounded_contract_file() {
        let directory = tempfile::tempdir().unwrap();
        let contract = directory.path().join("authoring-contract.json");
        fs::write(&contract, b"{}").unwrap();
        assert_eq!(read_contract_file(&contract).unwrap(), b"{}");
        fs::write(&contract, vec![b'x'; MAX_CONTRACT_BYTES + 1]).unwrap();
        assert_eq!(
            read_contract_file(&contract).unwrap_err().code,
            "contract_file_too_large"
        );
        assert_eq!(
            read_contract_file(Path::new("/not-a-contract-file"))
                .unwrap_err()
                .code,
            "contract_read_failed"
        );
    }

    #[test]
    fn consumes_one_exact_contract_file_grant_and_rejects_unselected_paths() {
        let directory = tempfile::tempdir().unwrap();
        let selected = directory.path().join("selected.json");
        let unrelated = directory.path().join("unrelated.json");
        fs::write(&selected, b"{}").unwrap();
        fs::write(&unrelated, b"{} ").unwrap();
        let grants = ContractGrantState::default();
        let canonical = grant_contract_file(&selected, &grants).unwrap();

        assert_eq!(
            read_granted_contract_file(&canonical, &grants).unwrap(),
            b"{}"
        );
        assert_eq!(
            read_granted_contract_file(&canonical, &grants)
                .unwrap_err()
                .code,
            "dialog_permission_required"
        );
        assert_eq!(
            read_granted_contract_file(&unrelated, &grants)
                .unwrap_err()
                .code,
            "dialog_permission_required"
        );
    }

    #[test]
    fn keeps_contract_content_out_of_the_index_and_prunes_removed_digest_blobs_after_repeated_writes(
    ) {
        let app_data = tempfile::tempdir().unwrap();
        let first = cached_entry('a', "first");
        let second = ContractCacheStoredEntry {
            active: true,
            ..cached_entry('b', "second")
        };
        cache_write_at(app_data.path(), vec![first.clone(), second.clone()]).unwrap();
        cache_write_at(app_data.path(), vec![second.clone()]).unwrap();

        let index = fs::read_to_string(app_data.path().join("contracts-v1/index.json")).unwrap();
        assert!(!index.contains("second"));
        assert!(index.contains("\"active\": true"));
        assert!(!app_data
            .path()
            .join(format!("contracts-v1/{}.json", "a".repeat(64)))
            .exists());
        assert_eq!(
            cache_load_at(app_data.path()).unwrap().entries,
            vec![second]
        );
    }

    #[test]
    fn damaged_cache_restart_fails_open_for_malformed_index_missing_blob_and_invalid_utf8() {
        for damage in ["malformed-index", "missing-blob", "invalid-utf8"] {
            let app_data = tempfile::tempdir().unwrap();
            let good = cached_entry('a', "good");
            cache_write_at(app_data.path(), vec![good.clone()]).unwrap();
            let root = app_data.path().join("contracts-v1");
            match damage {
                "malformed-index" => fs::write(root.join("index.json"), b"{not json").unwrap(),
                "missing-blob" => {
                    fs::remove_file(root.join(format!("{}.json", "a".repeat(64)))).unwrap()
                }
                "invalid-utf8" => {
                    fs::write(root.join(format!("{}.json", "a".repeat(64))), [0xff, 0xfe]).unwrap()
                }
                _ => unreachable!(),
            }

            let restarted = cache_load_at(app_data.path()).unwrap();

            assert!(restarted.entries.is_empty());
            assert_eq!(restarted.advisories.len(), 1);
            assert!(restarted.advisories[0].code.starts_with("contract_cache_"));
        }
    }

    #[test]
    fn damaged_blob_does_not_discard_other_valid_cached_contracts_on_restart() {
        let app_data = tempfile::tempdir().unwrap();
        let good = cached_entry('a', "good");
        let damaged = cached_entry('b', "damaged");
        cache_write_at(app_data.path(), vec![good.clone(), damaged]).unwrap();
        fs::write(
            app_data
                .path()
                .join("contracts-v1")
                .join(format!("{}.json", "b".repeat(64))),
            [0xff],
        )
        .unwrap();

        let restarted = cache_load_at(app_data.path()).unwrap();

        assert_eq!(restarted.entries, vec![good]);
        assert_eq!(restarted.advisories.len(), 1);
    }

    fn cached_entry(hex: char, content: &str) -> ContractCacheStoredEntry {
        ContractCacheStoredEntry {
            digest: format!("sha256:{}", hex.to_string().repeat(64)),
            profile: "hermes-legacy".into(),
            schema_version: 1,
            normalizer_version: 1,
            reader_version: 1,
            source: serde_json::json!({"kind":"user", "identifier":"/selected.json"}),
            content: content.into(),
            active: false,
        }
    }
}
