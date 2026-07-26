use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};
use same_file::Handle;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const RECENT_FILE: &str = "recent-workspaces-v1.json";
const MAX_RECENT_BYTES: u64 = 64 * 1024;
static NEXT_RECENT_TEMP: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct RecentWorkspaceState {
    storage: Mutex<Option<RecentStorage>>,
}

struct RecentStorage {
    root: PathBuf,
    identity: Handle,
    directory: Dir,
}

impl std::fmt::Debug for RecentStorage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RecentStorage")
            .field("root", &self.root)
            .finish()
    }
}

impl RecentStorage {
    fn open(path: &Path) -> StartupResult<Self> {
        let metadata = fs::symlink_metadata(path)
            .map_err(|cause| io_error("recent_workspace_root_invalid", cause))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(error(
                "recent_workspace_root_invalid",
                "Application data must be a regular directory, not a symbolic link.",
            ));
        }
        let root = path
            .canonicalize()
            .map_err(|cause| io_error("recent_workspace_root_invalid", cause))?;
        let identity = Handle::from_path(&root)
            .map_err(|cause| io_error("recent_workspace_root_invalid", cause))?;
        let directory = Dir::open_ambient_dir(&root, ambient_authority())
            .map_err(|cause| io_error("recent_workspace_root_invalid", cause))?;
        Ok(Self {
            root,
            identity,
            directory,
        })
    }

    fn verify(&self) -> StartupResult<()> {
        let current = self
            .root
            .canonicalize()
            .ok()
            .and_then(|path| Handle::from_path(path).ok());
        if current.as_ref() != Some(&self.identity) {
            return Err(error(
                "recent_workspace_root_changed",
                "Application data was replaced and must be rebound before recent workspaces are accessed.",
            ));
        }
        Ok(())
    }

    fn load(&self) -> StartupResult<String> {
        self.verify()?;
        match self.directory.symlink_metadata(RECENT_FILE) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => Err(error(
                "recent_workspace_invalid",
                "The recent workspace file is not a regular file.",
            )),
            Ok(metadata) if metadata.len() > MAX_RECENT_BYTES => Err(error(
                "recent_workspace_too_large",
                "The recent workspace file exceeds 64 KiB.",
            )),
            Ok(_) => {
                let mut text = String::new();
                self.directory
                    .open(RECENT_FILE)
                    .and_then(|mut file| file.read_to_string(&mut text))
                    .map_err(|cause| io_error("recent_workspace_read_failed", cause))?;
                Ok(text)
            }
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(cause) => Err(io_error("recent_workspace_read_failed", cause)),
        }
    }

    fn save(&self, content: &[u8]) -> StartupResult<()> {
        self.verify()?;
        if self
            .directory
            .symlink_metadata(RECENT_FILE)
            .is_ok_and(|metadata| metadata.file_type().is_symlink() || !metadata.is_file())
        {
            return Err(error(
                "recent_workspace_invalid",
                "Refusing to replace a non-regular recent workspace file.",
            ));
        }
        let temporary = format!(
            ".recent-workspaces-{}-{}",
            std::process::id(),
            NEXT_RECENT_TEMP.fetch_add(1, Ordering::Relaxed)
        );
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = self
            .directory
            .open_with(&temporary, &options)
            .map_err(|cause| io_error("recent_workspace_write_failed", cause))?;
        file.write_all(content)
            .and_then(|_| file.sync_all())
            .map_err(|cause| io_error("recent_workspace_write_failed", cause))?;
        drop(file);
        self.directory
            .rename(&temporary, &self.directory, RECENT_FILE)
            .map_err(|cause| io_error("recent_workspace_write_failed", cause))?;
        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct StartupPath {
    kind: &'static str,
    path: String,
    #[serde(rename = "rootPath", skip_serializing_if = "Option::is_none")]
    root_path: Option<String>,
    #[serde(rename = "relativePath", skip_serializing_if = "Option::is_none")]
    relative_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StartupError {
    pub code: &'static str,
    pub message: String,
}

type StartupResult<T> = Result<T, StartupError>;

#[derive(Deserialize)]
struct RecentRecord {
    #[serde(rename = "rootPath")]
    root_path: String,
    #[serde(rename = "lastOpenedAt")]
    last_opened_at: String,
}

#[tauri::command]
pub fn startup_paths() -> Vec<StartupPath> {
    collect_startup_paths(std::env::args_os().skip(1))
}

#[tauri::command]
pub fn recent_workspaces_load(
    app: AppHandle,
    state: State<'_, RecentWorkspaceState>,
) -> StartupResult<String> {
    with_recent_storage(&app, &state, RecentStorage::load)
}

#[tauri::command]
pub fn recent_workspaces_save(
    content: String,
    app: AppHandle,
    state: State<'_, RecentWorkspaceState>,
) -> StartupResult<()> {
    if content.len() as u64 > MAX_RECENT_BYTES {
        return Err(error(
            "recent_workspace_too_large",
            "Recent workspace data exceeds 64 KiB.",
        ));
    }
    let records: Vec<RecentRecord> = serde_json::from_str(&content).map_err(|_| {
        error(
            "recent_workspace_invalid",
            "Recent workspace data must be a JSON array of roots.",
        )
    })?;
    let unique: HashSet<&str> = records
        .iter()
        .map(|record| record.root_path.as_str())
        .collect();
    if records.len() > 20
        || unique.len() != records.len()
        || records
            .iter()
            .any(|record| record.root_path.is_empty() || record.last_opened_at.is_empty())
    {
        return Err(error(
            "recent_workspace_invalid",
            "Recent workspace data must contain at most 20 unique roots with timestamps.",
        ));
    }
    with_recent_storage(&app, &state, |storage| storage.save(content.as_bytes()))
}

#[tauri::command]
pub fn recent_workspace_available(
    path: String,
    app: AppHandle,
    state: State<'_, RecentWorkspaceState>,
) -> StartupResult<bool> {
    let content = with_recent_storage(&app, &state, RecentStorage::load)?;
    let records: Vec<RecentRecord> = match serde_json::from_str(&content) {
        Ok(records) => records,
        Err(_) => return Ok(false),
    };
    if !records.iter().any(|record| record.root_path == path) {
        return Ok(false);
    }
    let requested = Path::new(&path);
    let canonical = match requested.canonicalize() {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    Ok(canonical == requested && canonical.is_dir())
}

fn collect_startup_paths(args: impl IntoIterator<Item = OsString>) -> Vec<StartupPath> {
    args.into_iter().filter_map(classify_startup_path).collect()
}

fn classify_startup_path(value: OsString) -> Option<StartupPath> {
    let requested = PathBuf::from(value);
    let canonical = requested.canonicalize().ok()?;
    if canonical.is_dir() {
        return Some(StartupPath {
            kind: "directory",
            path: unicode(&canonical)?,
            root_path: None,
            relative_path: None,
        });
    }
    if !canonical.is_file() || !is_yaml(&canonical) {
        return None;
    }
    let root = canonical.parent()?.to_path_buf();
    Some(StartupPath {
        kind: "yaml",
        path: unicode(&canonical)?,
        root_path: Some(unicode(&root)?),
        relative_path: Some(canonical.file_name()?.to_str()?.to_string()),
    })
}

fn with_recent_storage<T>(
    app: &AppHandle,
    state: &State<'_, RecentWorkspaceState>,
    operation: impl FnOnce(&RecentStorage) -> StartupResult<T>,
) -> StartupResult<T> {
    let root = app.path().app_data_dir().map_err(|cause| {
        error(
            "recent_workspace_path_unavailable",
            format!("Application data is unavailable: {cause}"),
        )
    })?;
    fs::create_dir_all(&root).map_err(|cause| io_error("recent_workspace_write_failed", cause))?;
    let mut storage = state.storage.lock().map_err(|_| {
        error(
            "recent_workspace_state_unavailable",
            "Recent workspace state is unavailable.",
        )
    })?;
    if storage.is_none() {
        *storage = Some(RecentStorage::open(&root)?);
    }
    operation(storage.as_ref().expect("recent storage initialized"))
}

fn is_yaml(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("yaml") || extension.eq_ignore_ascii_case("yml")
        })
}

fn unicode(path: &Path) -> Option<String> {
    path.to_str().map(ToOwned::to_owned)
}

fn error(code: &'static str, message: impl Into<String>) -> StartupError {
    StartupError {
        code,
        message: message.into(),
    }
}

fn io_error(code: &'static str, cause: std::io::Error) -> StartupError {
    error(code, cause.to_string())
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::fs;

    use tempfile::tempdir;

    use super::{collect_startup_paths, is_yaml, RecentStorage};

    #[test]
    fn startup_accepts_only_existing_directories_and_yaml_files() {
        let root = tempdir().unwrap();
        let yaml = root.path().join("flow.yaml");
        let text = root.path().join("notes.txt");
        fs::write(&yaml, "name: flow\n").unwrap();
        fs::write(&text, "do not execute").unwrap();

        let paths = collect_startup_paths([
            root.path().as_os_str().to_owned(),
            yaml.as_os_str().to_owned(),
            text.as_os_str().to_owned(),
            OsString::from("--delete-everything"),
        ]);

        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0].kind, "directory");
        assert_eq!(paths[1].kind, "yaml");
        assert_eq!(paths[1].relative_path.as_deref(), Some("flow.yaml"));
    }

    #[test]
    fn yaml_extensions_are_case_insensitive_but_not_substrings() {
        assert!(is_yaml(std::path::Path::new("flow.YML")));
        assert!(!is_yaml(std::path::Path::new("flow.yaml.exe")));
    }

    #[cfg(unix)]
    #[test]
    fn recent_storage_rejects_an_app_data_symlink() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let linked = root.path().join("app-data");
        symlink(outside.path(), &linked).unwrap();

        assert_eq!(
            RecentStorage::open(&linked).unwrap_err().code,
            "recent_workspace_root_invalid"
        );
    }

    #[test]
    fn recent_storage_rejects_app_data_replacement_after_binding() {
        let root = tempdir().unwrap();
        let app_data = root.path().join("app-data");
        fs::create_dir(&app_data).unwrap();
        let storage = RecentStorage::open(&app_data).unwrap();
        fs::rename(&app_data, root.path().join("original")).unwrap();
        fs::create_dir(&app_data).unwrap();

        assert_eq!(
            storage.save(b"[]").unwrap_err().code,
            "recent_workspace_root_changed"
        );
        assert!(!app_data.join("recent-workspaces-v1.json").exists());
    }
}
