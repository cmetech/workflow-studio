use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use cap_std::ambient_authority;
#[cfg(unix)]
use cap_std::fs::Permissions;
use cap_std::fs::{Dir, File, OpenOptions};
use same_file::Handle;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

const LAYOUT_FILE: &str = "layouts-v1.json";
const MAX_LAYOUT_BYTES: u64 = 8 * 1024 * 1024;
static NEXT_TEMPORARY: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct LayoutState {
    storage: Mutex<Option<LayoutScope>>,
}

struct LayoutScope {
    requested_root: PathBuf,
    root_identity: Handle,
    parent_path: PathBuf,
    parent_identity: Handle,
    parent: Dir,
    root_name: OsString,
    directory: Dir,
}

struct StagedLayout<'a> {
    directory: &'a Dir,
    name: OsString,
    identity: Handle,
    file: Option<File>,
    active: bool,
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
    with_scope(app_data, state, |scope| load_layout_impl(scope, || {}))
}

#[cfg(test)]
fn load_layout_file_with_metadata_hook(
    app_data: &Path,
    state: &LayoutState,
    hook: impl FnOnce(),
) -> LayoutResult<Option<String>> {
    with_scope(app_data, state, |scope| load_layout_impl(scope, hook))
}

fn load_layout_impl(
    scope: &LayoutScope,
    metadata_hook: impl FnOnce(),
) -> LayoutResult<Option<String>> {
    scope.verify()?;
    match scope.directory.symlink_metadata(LAYOUT_FILE) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(invalid_layout_scope())
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("layout_read_failed", error)),
    }
    let mut file = scope
        .directory
        .open(LAYOUT_FILE)
        .map_err(|error| io_error("layout_read_failed", error))?;
    let metadata = file
        .metadata()
        .map_err(|error| io_error("layout_read_failed", error))?;
    let size = metadata.len();
    if size > MAX_LAYOUT_BYTES {
        return Err(layout_error(
            "layout_too_large",
            "The private layout file exceeds the 8 MiB safety limit.",
        ));
    }
    let modified = metadata.modified().ok();
    let identity = file_identity(&file, "layout_read_failed")?;
    metadata_hook();

    let mut bytes = Vec::with_capacity(size as usize);
    (&mut file)
        .take(MAX_LAYOUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("layout_read_failed", error))?;
    let after = file
        .metadata()
        .map_err(|error| io_error("layout_read_failed", error))?;
    if bytes.len() as u64 > MAX_LAYOUT_BYTES
        || bytes.len() as u64 != size
        || after.len() != size
        || after.modified().ok() != modified
    {
        return Err(layout_changed_during_read());
    }
    scope.verify()?;
    if !named_layout_identity_matches(scope, &identity) {
        return Err(layout_changed_during_read());
    }
    String::from_utf8(bytes).map(Some).map_err(|_| {
        layout_error(
            "layout_read_failed",
            "The private layout file is not valid UTF-8 text.",
        )
    })
}

fn save_layout_file(app_data: &Path, content: &str, state: &LayoutState) -> LayoutResult<()> {
    with_scope(app_data, state, |scope| {
        save_layout_impl(scope, content, || {})
    })
}

#[cfg(test)]
fn save_layout_file_with_bound_hook(
    app_data: &Path,
    content: &str,
    state: &LayoutState,
    hook: impl FnOnce(),
) -> LayoutResult<()> {
    with_scope(app_data, state, |scope| {
        save_layout_impl(scope, content, hook)
    })
}

fn save_layout_impl(
    scope: &LayoutScope,
    content: &str,
    bound_hook: impl FnOnce(),
) -> LayoutResult<()> {
    if content.len() as u64 > MAX_LAYOUT_BYTES {
        return Err(layout_error(
            "layout_too_large",
            "The private layout file cannot exceed 8 MiB.",
        ));
    }
    bound_hook();
    scope.verify()?;
    reject_unsafe_destination(&scope.directory)?;
    let mut temporary = StagedLayout::new(&scope.directory)?;
    temporary
        .file_mut()
        .write_all(content.as_bytes())
        .and_then(|()| temporary.file_mut().flush())
        .and_then(|()| temporary.file_mut().sync_all())
        .map_err(|error| io_error("layout_write_failed", error))?;
    scope.verify()?;
    reject_unsafe_destination(&scope.directory)?;
    if !temporary.named_identity_matches() {
        return Err(layout_error(
            "layout_write_failed",
            "The staged private layout file changed before commit.",
        ));
    }
    scope
        .directory
        .rename(&temporary.name, &scope.directory, LAYOUT_FILE)
        .map_err(|error| io_error("layout_write_failed", error))?;
    temporary.disarm();
    scope.verify()?;
    sync_directory(&scope.directory)?;
    scope.verify()
}

fn with_scope<T>(
    app_data: &Path,
    state: &LayoutState,
    operation: impl FnOnce(&LayoutScope) -> LayoutResult<T>,
) -> LayoutResult<T> {
    let mut storage = state.storage.lock().map_err(|_| {
        layout_error(
            "layout_queue_failed",
            "The layout command queue is unavailable.",
        )
    })?;
    if storage.is_none() {
        *storage = Some(LayoutScope::bind(app_data)?);
    }
    let scope = storage.as_ref().expect("layout scope was initialized");
    if scope.requested_root != app_data {
        return Err(layout_error(
            "layout_path_changed",
            "The application-data layout path changed during this session.",
        ));
    }
    scope.verify()?;
    operation(scope)
}

impl LayoutScope {
    fn bind(app_data: &Path) -> LayoutResult<Self> {
        prepare_private_app_data(app_data)?;
        let root = app_data
            .canonicalize()
            .map_err(|error| io_error("layout_directory_failed", error))?;
        let parent_path = root.parent().ok_or_else(|| {
            layout_error(
                "layout_scope_invalid",
                "The application-data directory must have a regular parent.",
            )
        })?;
        let root_name = root
            .file_name()
            .ok_or_else(invalid_layout_scope)?
            .to_os_string();
        let parent = Dir::open_ambient_dir(parent_path, ambient_authority())
            .map_err(|error| io_error("layout_directory_failed", error))?;
        let directory = parent
            .open_dir(&root_name)
            .map_err(|error| io_error("layout_directory_failed", error))?;
        let parent_identity = directory_identity(&parent, "layout_directory_failed")?;
        let root_identity = directory_identity(&directory, "layout_directory_failed")?;
        Ok(Self {
            requested_root: app_data.to_path_buf(),
            root_identity,
            parent_path: parent_path.to_path_buf(),
            parent_identity,
            parent,
            root_name,
            directory,
        })
    }

    fn verify(&self) -> LayoutResult<()> {
        let current_parent = Handle::from_path(&self.parent_path).map_err(|_| root_changed())?;
        if current_parent != self.parent_identity {
            return Err(root_changed());
        }
        let current_root = self
            .parent
            .open_dir(&self.root_name)
            .map_err(|_| root_changed())?;
        let current_identity =
            directory_identity(&current_root, "layout_root_changed").map_err(|_| root_changed())?;
        if current_identity != self.root_identity {
            return Err(root_changed());
        }
        Ok(())
    }
}

impl<'a> StagedLayout<'a> {
    fn new(directory: &'a Dir) -> LayoutResult<Self> {
        for _ in 0..100 {
            let sequence = NEXT_TEMPORARY.fetch_add(1, Ordering::Relaxed);
            let name = OsString::from(format!(".layouts-v1-{}-{sequence}.tmp", std::process::id()));
            let mut options = OpenOptions::new();
            options.read(true).write(true).create_new(true);
            match directory.open_with(&name, &options) {
                Ok(file) => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        file.set_permissions(Permissions::from_std(fs::Permissions::from_mode(
                            0o600,
                        )))
                        .map_err(|error| io_error("layout_write_failed", error))?;
                    }
                    let identity = file_identity(&file, "layout_write_failed")?;
                    return Ok(Self {
                        directory,
                        name,
                        identity,
                        file: Some(file),
                        active: true,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(io_error("layout_write_failed", error)),
            }
        }
        Err(layout_error(
            "layout_write_failed",
            "A unique private layout temporary file could not be created.",
        ))
    }

    fn file_mut(&mut self) -> &mut File {
        self.file.as_mut().expect("staged layout file remains open")
    }

    fn named_identity_matches(&self) -> bool {
        let Ok(metadata) = self.directory.symlink_metadata(&self.name) else {
            return false;
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return false;
        }
        self.directory
            .open(&self.name)
            .ok()
            .and_then(|file| file_identity(&file, "layout_write_failed").ok())
            .is_some_and(|identity| identity == self.identity)
    }

    fn disarm(&mut self) {
        self.file.take();
        self.active = false;
    }
}

impl Drop for StagedLayout<'_> {
    fn drop(&mut self) {
        if self.active {
            self.file.take();
            let _ = self.directory.remove_file(&self.name);
        }
    }
}

fn prepare_private_app_data(app_data: &Path) -> LayoutResult<()> {
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
    Ok(())
}

fn reject_unsafe_destination(directory: &Dir) -> LayoutResult<()> {
    match directory.symlink_metadata(LAYOUT_FILE) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(invalid_layout_scope())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error("layout_write_failed", error)),
    }
}

fn named_layout_identity_matches(scope: &LayoutScope, expected: &Handle) -> bool {
    let Ok(metadata) = scope.directory.symlink_metadata(LAYOUT_FILE) else {
        return false;
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return false;
    }
    scope
        .directory
        .open(LAYOUT_FILE)
        .ok()
        .and_then(|file| file_identity(&file, "layout_read_failed").ok())
        .is_some_and(|identity| identity == *expected)
}

fn file_identity(file: &File, code: &'static str) -> LayoutResult<Handle> {
    Handle::from_file(
        file.try_clone()
            .map_err(|error| io_error(code, error))?
            .into_std(),
    )
    .map_err(|error| io_error(code, error))
}

fn directory_identity(directory: &Dir, code: &'static str) -> LayoutResult<Handle> {
    Handle::from_file(
        directory
            .try_clone()
            .map_err(|error| io_error(code, error))?
            .into_std_file(),
    )
    .map_err(|error| io_error(code, error))
}

#[cfg(unix)]
fn sync_directory(directory: &Dir) -> LayoutResult<()> {
    directory
        .try_clone()
        .map(Dir::into_std_file)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| io_error("layout_sync_failed", error))
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Dir) -> LayoutResult<()> {
    Ok(())
}

fn invalid_layout_scope() -> LayoutError {
    layout_error(
        "layout_scope_invalid",
        "The private layout location is not a regular application-data file.",
    )
}

fn root_changed() -> LayoutError {
    layout_error(
        "layout_root_changed",
        "The application-data layout directory was replaced and must be reopened.",
    )
}

fn layout_changed_during_read() -> LayoutError {
    layout_error(
        "layout_changed_during_read",
        "The private layout file changed while it was being read.",
    )
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
    use super::{
        load_layout_file, load_layout_file_with_metadata_hook, save_layout_file,
        save_layout_file_with_bound_hook, LayoutState,
    };

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

    #[test]
    fn rejects_a_regular_app_data_root_replaced_after_capability_binding() {
        let parent = tempfile::tempdir().unwrap();
        let app_data = parent.path().join("app-data");
        let parked = parent.path().join("parked");
        std::fs::create_dir(&app_data).unwrap();
        let state = LayoutState::default();

        let error = save_layout_file_with_bound_hook(&app_data, "[]", &state, || {
            std::fs::rename(&app_data, &parked).unwrap();
            std::fs::create_dir(&app_data).unwrap();
        })
        .unwrap_err();

        assert_eq!(error.code, "layout_root_changed");
        assert!(!app_data.join("layouts-v1.json").exists());
        assert!(!parked.join("layouts-v1.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_an_app_data_root_swapped_to_a_symlink_after_capability_binding() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let app_data = parent.path().join("app-data");
        let parked = parent.path().join("parked");
        std::fs::create_dir(&app_data).unwrap();
        let state = LayoutState::default();

        let error = save_layout_file_with_bound_hook(&app_data, "[]", &state, || {
            std::fs::rename(&app_data, &parked).unwrap();
            symlink(outside.path(), &app_data).unwrap();
        })
        .unwrap_err();

        assert_eq!(error.code, "layout_root_changed");
        assert!(!outside.path().join("layouts-v1.json").exists());
        assert!(!parked.join("layouts-v1.json").exists());
    }

    #[test]
    fn rejects_layout_content_that_grows_or_shrinks_after_bound_metadata() {
        use std::io::Write;

        let app_data = tempfile::tempdir().unwrap();
        let state = LayoutState::default();
        save_layout_file(app_data.path(), "[1,2,3]", &state).unwrap();
        let path = app_data.path().join("layouts-v1.json");

        let grown = load_layout_file_with_metadata_hook(app_data.path(), &state, || {
            std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(b"more")
                .unwrap();
        })
        .unwrap_err();
        assert_eq!(grown.code, "layout_changed_during_read");

        save_layout_file(app_data.path(), "[1,2,3]", &state).unwrap();
        let shrunk = load_layout_file_with_metadata_hook(app_data.path(), &state, || {
            std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .unwrap()
                .set_len(2)
                .unwrap();
        })
        .unwrap_err();
        assert_eq!(shrunk.code, "layout_changed_during_read");
    }

    #[test]
    fn rejects_a_same_length_layout_name_replacement_after_metadata_binding() {
        let app_data = tempfile::tempdir().unwrap();
        let state = LayoutState::default();
        save_layout_file(app_data.path(), "original", &state).unwrap();
        let path = app_data.path().join("layouts-v1.json");

        let error = load_layout_file_with_metadata_hook(app_data.path(), &state, || {
            std::fs::remove_file(&path).unwrap();
            std::fs::write(&path, "replaced").unwrap();
        })
        .unwrap_err();

        assert_eq!(error.code, "layout_changed_during_read");
    }
}
