use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const MAX_CONTRACT_BYTES: usize = 512 * 1024;
const CLI_TIMEOUT: Duration = Duration::from_secs(10);
const CACHE_DIRECTORY: &str = "contracts-v1";
const CACHE_INDEX: &str = "index.json";
static NEXT_CACHE_TEMP: AtomicU64 = AtomicU64::new(1);

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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractCacheStoredEntry {
    pub digest: String,
    pub profile: String,
    pub schema_version: u32,
    pub normalizer_version: u32,
    pub reader_version: u32,
    pub source: serde_json::Value,
    pub content: String,
}

#[tauri::command]
pub fn contract_read_file(path: String) -> ContractResult<Vec<u8>> {
    read_contract_file(Path::new(&path))
}

#[tauri::command]
pub fn contract_run_hermes_cli(
    executable_path: String,
    profile: ContractProfile,
) -> ContractResult<Vec<u8>> {
    run_hermes_cli(Path::new(&executable_path), profile)
}

#[tauri::command]
pub fn contract_cache_load(app: AppHandle) -> ContractResult<Vec<ContractCacheStoredEntry>> {
    let root = contract_cache_root(&app)?;
    let index_path = root.join(CACHE_INDEX);
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    reject_non_regular_file(&index_path, "contract_cache_read_failed")?;
    let index = read_bounded_utf8(&index_path, "contract_cache_read_failed")?;
    let mut entries: Vec<ContractCacheStoredEntry> = serde_json::from_str(&index)
        .map_err(|_| contract_error("contract_cache_read_failed", "The contract cache index is invalid."))?;
    for entry in &mut entries {
        let path = root.join(cache_file_name(&entry.digest)?);
        reject_non_regular_file(&path, "contract_cache_read_failed")?;
        entry.content = read_bounded_utf8(&path, "contract_cache_read_failed")?;
    }
    Ok(entries)
}

#[tauri::command]
pub fn contract_cache_write(entries: Vec<ContractCacheStoredEntry>, app: AppHandle) -> ContractResult<()> {
    let root = contract_cache_root(&app)?;
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
            write_atomic(&path, entry.content.as_bytes(), "contract_cache_write_failed")?;
        }
    }
    let index = serde_json::to_vec_pretty(&entries)
        .map_err(|_| contract_error("contract_cache_write_failed", "The contract cache index could not be encoded."))?;
    write_atomic(&root.join(CACHE_INDEX), &index, "contract_cache_write_failed")
}

fn read_contract_file(path: &Path) -> ContractResult<Vec<u8>> {
    reject_non_regular_file(path, "contract_read_failed")?;
    read_bounded_bytes(path, "contract_read_failed")
}

fn run_hermes_cli(executable: &Path, profile: ContractProfile) -> ContractResult<Vec<u8>> {
    let mut child = Command::new(executable)
        .args(["workflow", "schema", "--profile", profile.as_str(), "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| contract_error("contract_cli_spawn_failed", format!("Could not start the selected Hermes executable: {error}")))?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let stdout_reader = thread::spawn(move || read_stream_bounded(stdout));
    let stderr_reader = thread::spawn(move || read_stream_bounded(stderr));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < CLI_TIMEOUT => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(contract_error("contract_cli_timeout", "Hermes schema output exceeded the 10-second timeout."));
            }
            Err(error) => return Err(contract_error("contract_cli_wait_failed", format!("Could not wait for Hermes: {error}"))),
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| contract_error("contract_cli_read_failed", "Could not read Hermes standard output."))??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| contract_error("contract_cli_read_failed", "Could not read Hermes standard error."))??;
    if !status.success() {
        return Err(contract_error("contract_cli_nonzero_exit", "The selected Hermes executable returned a non-zero exit status."));
    }
    if stdout.len() > MAX_CONTRACT_BYTES {
        return Err(contract_error("contract_cli_output_too_large", "Hermes schema output exceeds the 512 KiB limit."));
    }
    if stdout.is_empty() && !stderr.is_empty() {
        return Err(contract_error("contract_cli_stderr_only", "Hermes wrote diagnostics but no schema JSON."));
    }
    String::from_utf8(stdout.clone())
        .map_err(|_| contract_error("contract_cli_invalid_utf8", "Hermes schema output is not valid UTF-8."))?;
    Ok(stdout)
}

fn read_stream_bounded(mut stream: impl Read) -> ContractResult<Vec<u8>> {
    let mut bytes = Vec::new();
    stream
        .by_ref()
        .take((MAX_CONTRACT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| contract_error("contract_cli_read_failed", format!("Could not read Hermes output: {error}")))?;
    Ok(bytes)
}

fn read_bounded_bytes(path: &Path, code: &'static str) -> ContractResult<Vec<u8>> {
    let metadata = fs::metadata(path).map_err(|error| contract_error(code, format!("Could not inspect the contract file: {error}")))?;
    if metadata.len() as usize > MAX_CONTRACT_BYTES {
        return Err(contract_error("contract_file_too_large", "Contract files cannot exceed 512 KiB."));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .and_then(|file| file.take((MAX_CONTRACT_BYTES + 1) as u64).read_to_end(&mut bytes))
        .map_err(|error| contract_error(code, format!("Could not read the contract file: {error}")))?;
    if bytes.len() > MAX_CONTRACT_BYTES {
        return Err(contract_error("contract_file_too_large", "Contract files cannot exceed 512 KiB."));
    }
    Ok(bytes)
}

fn read_bounded_utf8(path: &Path, code: &'static str) -> ContractResult<String> {
    String::from_utf8(read_bounded_bytes(path, code)?)
        .map_err(|_| contract_error(code, "The cached contract is not valid UTF-8."))
}

fn contract_cache_root(app: &AppHandle) -> ContractResult<PathBuf> {
    let app_data = app.path().app_data_dir().map_err(|error| {
        contract_error("contract_cache_path_unavailable", format!("The application data directory is unavailable: {error}"))
    })?;
    fs::create_dir_all(&app_data).map_err(|error| contract_error("contract_cache_write_failed", format!("Could not create application data: {error}")))?;
    reject_non_directory(&app_data)?;
    let root = app_data.join(CACHE_DIRECTORY);
    if !root.exists() {
        fs::create_dir(&root).map_err(|error| contract_error("contract_cache_write_failed", format!("Could not create the contract cache: {error}")))?;
    }
    reject_non_directory(&root)?;
    Ok(root)
}

fn cache_file_name(digest: &str) -> ContractResult<String> {
    let Some(hex) = digest.strip_prefix("sha256:") else {
        return Err(contract_error("contract_cache_invalid_digest", "Contract cache digests must use sha256."));
    };
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(contract_error("contract_cache_invalid_digest", "Contract cache digests must contain 64 hexadecimal characters."));
    }
    Ok(format!("{hex}.json"))
}

fn reject_non_regular_file(path: &Path, code: &'static str) -> ContractResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| contract_error(code, format!("Could not inspect the contract path: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(contract_error(code, "Contract data must be a regular file."));
    }
    Ok(())
}

fn reject_non_directory(path: &Path) -> ContractResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| contract_error("contract_cache_write_failed", format!("Could not inspect the cache directory: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(contract_error("contract_cache_write_failed", "Contract cache storage must be a regular directory."));
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8], code: &'static str) -> ContractResult<()> {
    let parent = path.parent().ok_or_else(|| contract_error(code, "Contract cache has no parent directory."))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|name| name.to_str()).unwrap_or("contract"),
        NEXT_CACHE_TEMP.fetch_add(1, Ordering::Relaxed),
    ));
    let result = (|| {
        let mut file = OpenOptions::new().create_new(true).write(true).open(&temporary)
            .map_err(|error| contract_error(code, format!("Could not create a cache temporary file: {error}")))?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| contract_error(code, format!("Could not write a cache temporary file: {error}")))?;
        drop(file);
        fs::rename(&temporary, path).map_err(|error| contract_error(code, format!("Could not replace cache data: {error}")))?;
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| contract_error(code, format!("Could not sync cache data: {error}")))
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

fn contract_error(code: &'static str, message: impl Into<String>) -> ContractError {
    ContractError { code, message: message.into() }
}

#[cfg(test)]
mod tests {
    use super::{read_contract_file, run_hermes_cli, ContractProfile, MAX_CONTRACT_BYTES};
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

        assert_eq!(run_hermes_cli(&executable, ContractProfile::HermesLegacy).unwrap(), b"{}");
        assert_eq!(fs::read_to_string(&argument_log).unwrap(), "5\nworkflow\nschema\n--profile\nhermes-legacy\n--json\n");
        assert_eq!(run_hermes_cli(&executable, ContractProfile::Archon202607).unwrap(), b"{}");
        assert_eq!(fs::read_to_string(&argument_log).unwrap(), "5\nworkflow\nschema\n--profile\narchon-2026-07\n--json\n");
    }

    #[cfg(unix)]
    #[test]
    fn returns_typed_errors_for_cli_exit_stderr_output_ceiling_invalid_utf8_and_timeout() {
        for (script, expected) in [
            ("exit 7", "contract_cli_nonzero_exit"),
            ("printf diagnostic >&2", "contract_cli_stderr_only"),
            ("dd if=/dev/zero bs=1 count=524289 2>/dev/null", "contract_cli_output_too_large"),
            ("printf '\\377'", "contract_cli_invalid_utf8"),
            ("sleep 11", "contract_cli_timeout"),
        ] {
            let (_directory, executable) = fixture(script);
            assert_eq!(run_hermes_cli(&executable, ContractProfile::HermesLegacy).unwrap_err().code, expected);
        }
    }

    #[test]
    fn reads_only_a_single_bounded_contract_file() {
        let directory = tempfile::tempdir().unwrap();
        let contract = directory.path().join("authoring-contract.json");
        fs::write(&contract, b"{}").unwrap();
        assert_eq!(read_contract_file(&contract).unwrap(), b"{}");
        fs::write(&contract, vec![b'x'; MAX_CONTRACT_BYTES + 1]).unwrap();
        assert_eq!(read_contract_file(&contract).unwrap_err().code, "contract_file_too_large");
        assert_eq!(read_contract_file(Path::new("/not-a-contract-file")).unwrap_err().code, "contract_read_failed");
    }
}
