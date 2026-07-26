use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

const LAYOUT_FILE: &str = "layouts-v1.json";
const MAX_LAYOUT_BYTES: u64 = 8 * 1024 * 1024;
static NEXT_TEMPORARY: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct LayoutState {
    queue: Mutex<()>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutError {
    pub code: &'static str,
    pub message: String,
}

type LayoutResult<T> = Result<T, LayoutError>;

#[tauri::command]
pub fn layout_load(app: AppHandle, state: State<'_, LayoutState>) -> LayoutResult<Option<String>> {
    let app_data = app_data_dir(&app)?;
    load_layout_file(&app_data, &state)
}

#[tauri::command]
pub fn layout_save(
    content: String,
    app: AppHandle,
    state: State<'_, LayoutState>,
) -> LayoutResult<()> {
    let app_data = app_data_dir(&app)?;
    save_layout_file(&app_data, &content, &state)
}

fn app_data_dir(app: &AppHandle) -> LayoutResult<PathBuf> {
    app.path().app_data_dir().map_err(|error| {
        layout_error(
            "layout_path_unavailable",
            format!("The application data directory is unavailable: {error}"),
        )
    })
}

fn load_layout_file(app_data: &Path, state: &LayoutState) -> LayoutResult<Option<String>> {
    let _guard = state.queue.lock().map_err(|_| {
        layout_error(
            "layout_queue_failed",
            "The layout command queue is unavailable.",
        )
    })?;
    let root = private_app_data(app_data)?;
    let directory = Dir::open_ambient_dir(&root, ambient_authority())
        .map_err(|error| io_error("layout_read_failed", error))?;
    let mut found = None;
    for entry in directory
        .entries()
        .map_err(|error| io_error("layout_read_failed", error))?
    {
        let entry = entry.map_err(|error| io_error("layout_read_failed", error))?;
        if entry.file_name() != std::ffi::OsStr::new(LAYOUT_FILE) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| io_error("layout_read_failed", error))?;
        if file_type.is_symlink() || !file_type.is_file() {
            return Err(layout_error(
                "layout_scope_invalid",
                "The private layout location is not a regular application-data file.",
            ));
        }
        let file = entry
            .open()
            .map_err(|error| io_error("layout_read_failed", error))?;
        let size = file
            .metadata()
            .map_err(|error| io_error("layout_read_failed", error))?
            .len();
        if size > MAX_LAYOUT_BYTES {
            return Err(layout_error(
                "layout_too_large",
                "The private layout file exceeds the 8 MiB safety limit.",
            ));
        }
        let mut content = String::with_capacity(size as usize);
        file.take(MAX_LAYOUT_BYTES + 1)
            .read_to_string(&mut content)
            .map_err(|error| io_error("layout_read_failed", error))?;
        found = Some(content);
        break;
    }
    Ok(found)
}

fn save_layout_file(app_data: &Path, content: &str, state: &LayoutState) -> LayoutResult<()> {
    if content.len() as u64 > MAX_LAYOUT_BYTES {
        return Err(layout_error(
            "layout_too_large",
            "The private layout file cannot exceed 8 MiB.",
        ));
    }
    let _guard = state.queue.lock().map_err(|_| {
        layout_error(
            "layout_queue_failed",
            "The layout command queue is unavailable.",
        )
    })?;
    let root = private_app_data(app_data)?;
    let destination = root.join(LAYOUT_FILE);
    reject_unsafe_destination(&destination)?;
    let temporary = root.join(temporary_name());
    let result = (|| -> LayoutResult<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| io_error("layout_write_failed", error))?;
        file.write_all(content.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|error| io_error("layout_write_failed", error))?;
        drop(file);
        reject_unsafe_destination(&destination)?;
        atomic_replace(&temporary, &destination)?;
        sync_directory(&root)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn private_app_data(app_data: &Path) -> LayoutResult<PathBuf> {
    match fs::symlink_metadata(app_data) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(layout_error(
                "layout_scope_invalid",
                "The private application-data location is not a regular directory.",
            ))
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(app_data)
                .map_err(|error| io_error("layout_directory_failed", error))?;
        }
        Err(error) => return Err(io_error("layout_directory_failed", error)),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(app_data, fs::Permissions::from_mode(0o700))
            .map_err(|error| io_error("layout_directory_failed", error))?;
    }
    Ok(app_data.to_path_buf())
}

fn reject_unsafe_destination(destination: &Path) -> LayoutResult<()> {
    match fs::symlink_metadata(destination) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(layout_error(
                "layout_scope_invalid",
                "The private layout location is not a regular application-data file.",
            ))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error("layout_write_failed", error)),
    }
}

fn temporary_name() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = NEXT_TEMPORARY.fetch_add(1, Ordering::Relaxed);
    format!(".layouts-v1-{now:032x}-{sequence:016x}.tmp")
}

#[cfg(not(windows))]
fn atomic_replace(temporary: &Path, destination: &Path) -> LayoutResult<()> {
    fs::rename(temporary, destination).map_err(|error| io_error("layout_write_failed", error))
}

#[cfg(windows)]
fn atomic_replace(temporary: &Path, destination: &Path) -> LayoutResult<()> {
    if !destination.exists() {
        return fs::rename(temporary, destination)
            .map_err(|error| io_error("layout_write_failed", error));
    }
    use std::os::windows::ffi::OsStrExt;
    type Bool = i32;
    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> Bool;
    }
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let temporary_wide = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            destination_wide.as_ptr(),
            temporary_wide.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        Err(io_error(
            "layout_write_failed",
            std::io::Error::last_os_error(),
        ))
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> LayoutResult<()> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| io_error("layout_sync_failed", error))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> LayoutResult<()> {
    Ok(())
}

fn io_error(code: &'static str, error: std::io::Error) -> LayoutError {
    layout_error(code, format!("Layout storage failed: {error}"))
}

fn layout_error(code: &'static str, message: impl Into<String>) -> LayoutError {
    LayoutError {
        code,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{load_layout_file, save_layout_file, LayoutState};

    #[test]
    fn stores_one_fixed_private_layout_file_and_atomically_replaces_it() {
        let app_data = tempfile::tempdir().unwrap();
        let state = LayoutState::default();

        save_layout_file(
            app_data.path(),
            "[{\"schemaVersion\":2,\"opaque\":true}]",
            &state,
        )
        .unwrap();
        save_layout_file(app_data.path(), "[{\"schemaVersion\":1}]", &state).unwrap();

        assert_eq!(
            load_layout_file(app_data.path(), &state)
                .unwrap()
                .as_deref(),
            Some("[{\"schemaVersion\":1}]")
        );
        let names = std::fs::read_dir(app_data.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["layouts-v1.json"]);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_layout_file_symlink_without_touching_its_target() {
        use std::os::unix::fs::symlink;

        let app_data = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(outside.path(), "outside").unwrap();
        symlink(outside.path(), app_data.path().join("layouts-v1.json")).unwrap();
        let state = LayoutState::default();

        let load_error = load_layout_file(app_data.path(), &state).unwrap_err();
        assert_eq!(load_error.code, "layout_scope_invalid");
        let save_error = save_layout_file(app_data.path(), "[]", &state).unwrap_err();
        assert_eq!(save_error.code, "layout_scope_invalid");
        assert_eq!(std::fs::read_to_string(outside.path()).unwrap(), "outside");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_app_data_root() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let app_data = parent.path().join("app-data");
        symlink(outside.path(), &app_data).unwrap();
        let state = LayoutState::default();

        let error = save_layout_file(&app_data, "[]", &state).unwrap_err();
        assert_eq!(error.code, "layout_scope_invalid");
        assert!(!outside.path().join("layouts-v1.json").exists());
    }

    #[test]
    fn bounds_native_layout_content_before_writing() {
        let app_data = tempfile::tempdir().unwrap();
        let state = LayoutState::default();
        let oversized = "x".repeat(8 * 1024 * 1024 + 1);

        let error = save_layout_file(app_data.path(), &oversized, &state).unwrap_err();
        assert_eq!(error.code, "layout_too_large");
        assert!(!app_data.path().join("layouts-v1.json").exists());
    }
}
