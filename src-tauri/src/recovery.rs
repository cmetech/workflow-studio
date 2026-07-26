use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const MAGIC: &[u8; 4] = b"WSR1";
const MAX_KEY_BYTES: usize = 8 * 1024;
const MAX_CONTENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_BLOB_BYTES: u64 = (4 + 4 + MAX_KEY_BYTES + MAX_CONTENT_BYTES) as u64;
static NEXT_RECORD: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryError {
    pub code: &'static str,
    pub message: String,
}

type RecoveryResult<T> = Result<T, RecoveryError>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryBlob {
    pub id: String,
    pub key: String,
    pub content: String,
    pub size: u64,
}

#[tauri::command]
pub fn recovery_list(app: AppHandle) -> RecoveryResult<Vec<RecoveryBlob>> {
    let app_data = app.path().app_data_dir().map_err(|error| {
        recovery_error(
            "recovery_path_unavailable",
            format!("The application data directory is unavailable: {error}"),
        )
    })?;
    list_blobs(&app_data)
}

#[tauri::command]
pub fn recovery_write(key: String, content: String, app: AppHandle) -> RecoveryResult<()> {
    let app_data = app.path().app_data_dir().map_err(|error| {
        recovery_error(
            "recovery_path_unavailable",
            format!("The application data directory is unavailable: {error}"),
        )
    })?;
    write_blob(&app_data, &key, &content)
}

#[tauri::command]
pub fn recovery_delete(id: String, app: AppHandle) -> RecoveryResult<()> {
    let app_data = app.path().app_data_dir().map_err(|error| {
        recovery_error(
            "recovery_path_unavailable",
            format!("The application data directory is unavailable: {error}"),
        )
    })?;
    delete_blob(&app_data, &id)
}

fn write_blob(app_data: &Path, key: &str, content: &str) -> RecoveryResult<()> {
    if key.is_empty() || key.len() > MAX_KEY_BYTES {
        return Err(recovery_error(
            "invalid_recovery_key",
            "Recovery keys must be non-empty and no larger than 8 KiB.",
        ));
    }
    if content.len() > MAX_CONTENT_BYTES {
        return Err(recovery_error(
            "recovery_too_large",
            "A recovery draft cannot exceed 8 MiB.",
        ));
    }

    let root = recovery_root(app_data)?;
    let id = record_id(key);
    let destination = root.join(&id);
    let temporary = root.join(format!(".{id}.tmp"));
    let result = (|| -> RecoveryResult<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| io_error("recovery_write_failed", error))?;
        file.write_all(MAGIC)
            .and_then(|()| file.write_all(&(key.len() as u32).to_be_bytes()))
            .and_then(|()| file.write_all(key.as_bytes()))
            .and_then(|()| file.write_all(content.as_bytes()))
            .and_then(|()| file.sync_all())
            .map_err(|error| io_error("recovery_write_failed", error))?;
        drop(file);
        fs::rename(&temporary, &destination)
            .map_err(|error| io_error("recovery_write_failed", error))?;
        sync_directory(&root)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn list_blobs(app_data: &Path) -> RecoveryResult<Vec<RecoveryBlob>> {
    let root = recovery_root(app_data)?;
    let mut blobs = Vec::new();
    let mut removed_junk = false;
    let mut unexpected_entry = false;
    for entry in fs::read_dir(&root).map_err(|error| io_error("recovery_list_failed", error))? {
        let entry = entry.map_err(|error| io_error("recovery_list_failed", error))?;
        let file_type = entry
            .file_type()
            .map_err(|error| io_error("recovery_list_failed", error))?;
        if file_type.is_symlink() {
            remove_junk_file(&entry.path())?;
            removed_junk = true;
            continue;
        }
        if !file_type.is_file() {
            unexpected_entry = true;
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            remove_junk_file(&entry.path())?;
            removed_junk = true;
            continue;
        };
        if !valid_record_id(&id) {
            remove_junk_file(&entry.path())?;
            removed_junk = true;
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| io_error("recovery_list_failed", error))?;
        if metadata.len() > MAX_BLOB_BYTES {
            remove_junk_file(&entry.path())?;
            removed_junk = true;
            continue;
        }
        match read_blob(&entry.path(), id)? {
            Some(blob) => blobs.push(blob),
            None => {
                remove_junk_file(&entry.path())?;
                removed_junk = true;
            }
        }
    }
    if removed_junk {
        sync_directory(&root)?;
    }
    if unexpected_entry {
        return Err(recovery_error(
            "recovery_unexpected_entry",
            "The private recovery directory contains an unexpected non-file entry.",
        ));
    }
    blobs.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(blobs)
}

fn read_blob(path: &Path, id: String) -> RecoveryResult<Option<RecoveryBlob>> {
    let file = File::open(path).map_err(|error| io_error("recovery_read_failed", error))?;
    let size = file
        .metadata()
        .map_err(|error| io_error("recovery_read_failed", error))?
        .len();
    if size > MAX_BLOB_BYTES {
        return Ok(None);
    }
    let mut bytes = Vec::with_capacity(size as usize);
    file.take(MAX_BLOB_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("recovery_read_failed", error))?;
    if bytes.len() as u64 != size {
        return Ok(None);
    }
    if bytes.len() < 8 || &bytes[..4] != MAGIC {
        return Ok(None);
    }
    let key_len = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    if key_len == 0 || key_len > MAX_KEY_BYTES || 8 + key_len > bytes.len() {
        return Ok(None);
    }
    let Ok(key) = String::from_utf8(bytes[8..8 + key_len].to_vec()) else {
        return Ok(None);
    };
    let Ok(content) = String::from_utf8(bytes[8 + key_len..].to_vec()) else {
        return Ok(None);
    };
    Ok(Some(RecoveryBlob {
        id,
        key,
        content,
        size,
    }))
}

fn remove_junk_file(path: &Path) -> RecoveryResult<()> {
    fs::remove_file(path).map_err(|error| io_error("recovery_cleanup_failed", error))
}

fn delete_blob(app_data: &Path, id: &str) -> RecoveryResult<()> {
    if !valid_record_id(id) {
        return Err(recovery_error(
            "invalid_recovery_id",
            "Recovery record IDs must be native-issued hexadecimal file names.",
        ));
    }
    let root = recovery_root(app_data)?;
    let target = root.join(id);
    match fs::remove_file(target) {
        Ok(()) => sync_directory(&root),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error("recovery_delete_failed", error)),
    }
}

fn recovery_root(app_data: &Path) -> RecoveryResult<PathBuf> {
    fs::create_dir_all(app_data).map_err(|error| io_error("recovery_directory_failed", error))?;
    let root = app_data.join("recovery");
    match fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(recovery_error(
                "recovery_scope_invalid",
                "The private recovery location is not a regular application-data directory.",
            ))
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&root).map_err(|error| io_error("recovery_directory_failed", error))?;
        }
        Err(error) => return Err(io_error("recovery_directory_failed", error)),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .map_err(|error| io_error("recovery_directory_failed", error))?;
    }
    Ok(root)
}

fn record_id(key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    let digest = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = NEXT_RECORD.fetch_add(1, Ordering::Relaxed);
    format!("{digest}-{now:032x}-{sequence:016x}.wsr")
}

fn valid_record_id(id: &str) -> bool {
    id.ends_with(".wsr")
        && id.len() <= 128
        && id.strip_suffix(".wsr").is_some_and(|stem| {
            !stem.is_empty()
                && stem
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        })
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> RecoveryResult<()> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| io_error("recovery_sync_failed", error))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> RecoveryResult<()> {
    Ok(())
}

fn io_error(code: &'static str, error: std::io::Error) -> RecoveryError {
    recovery_error(code, format!("Recovery storage failed: {error}"))
}

fn recovery_error(code: &'static str, message: impl Into<String>) -> RecoveryError {
    RecoveryError {
        code,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{delete_blob, list_blobs, write_blob};

    #[test]
    fn recovery_blobs_are_private_atomic_and_scoped_to_app_data() {
        let app_data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();

        write_blob(
            app_data.path(),
            "workflow:flows/release.yaml",
            "{\"draft\":1}",
        )
        .unwrap();
        write_blob(
            app_data.path(),
            "workflow:flows/release.yaml",
            "{\"draft\":2}",
        )
        .unwrap();

        let records = list_blobs(app_data.path()).unwrap();
        assert_eq!(records.len(), 2);
        assert!(records
            .iter()
            .all(|record| record.key == "workflow:flows/release.yaml"));
        assert!(records
            .iter()
            .any(|record| record.content == "{\"draft\":2}"));
        assert!(records.iter().all(|record| {
            record.size
                == std::fs::metadata(app_data.path().join("recovery").join(&record.id))
                    .unwrap()
                    .len()
        }));
        assert!(workspace.path().read_dir().unwrap().next().is_none());
        assert!(std::fs::read_dir(app_data.path().join("recovery"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let recovery = app_data.path().join("recovery");
            assert_eq!(
                std::fs::metadata(&recovery).unwrap().permissions().mode() & 0o777,
                0o700
            );
            for entry in std::fs::read_dir(recovery).unwrap() {
                assert_eq!(
                    entry.unwrap().metadata().unwrap().permissions().mode() & 0o777,
                    0o600
                );
            }
        }

        let first = &records[0];
        delete_blob(app_data.path(), &first.id).unwrap();
        assert_eq!(list_blobs(app_data.path()).unwrap().len(), 1);
    }

    #[test]
    fn rejects_untrusted_record_ids_and_oversized_content() {
        let app_data = tempfile::tempdir().unwrap();
        let traversal = delete_blob(app_data.path(), "../outside.wsr").unwrap_err();
        assert_eq!(traversal.code, "invalid_recovery_id");

        let oversized = "x".repeat(8 * 1024 * 1024 + 1);
        let error = write_blob(app_data.path(), "workflow", &oversized).unwrap_err();
        assert_eq!(error.code, "recovery_too_large");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_recovery_directory_symlink_instead_of_following_it() {
        use std::os::unix::fs::symlink;

        let app_data = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), app_data.path().join("recovery")).unwrap();

        let error = write_blob(app_data.path(), "workflow", "draft").unwrap_err();
        assert_eq!(error.code, "recovery_scope_invalid");
        assert!(outside.path().read_dir().unwrap().next().is_none());
    }

    #[test]
    fn listing_deletes_every_malformed_or_unaddressable_regular_blob() {
        let app_data = tempfile::tempdir().unwrap();
        let recovery = super::recovery_root(app_data.path()).unwrap();
        let valid_name = |suffix: &str| format!("{}-{suffix}.wsr", "a".repeat(64));

        std::fs::write(recovery.join(valid_name("01")), b"wrong-magic").unwrap();
        std::fs::write(recovery.join(valid_name("02")), b"WSR1\0\0").unwrap();
        std::fs::write(
            recovery.join(valid_name("03")),
            b"WSR1\xff\xff\xff\xffshort",
        )
        .unwrap();
        std::fs::write(recovery.join(valid_name("04")), b"WSR1\0\0\0\x01k\xff").unwrap();
        std::fs::write(recovery.join("not-a-recovery-id.txt"), b"junk").unwrap();
        std::fs::write(
            recovery.join(valid_name("05")),
            vec![0_u8; super::MAX_BLOB_BYTES as usize + 1],
        )
        .unwrap();

        assert!(list_blobs(app_data.path()).unwrap().is_empty());
        assert!(std::fs::read_dir(&recovery).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn listing_never_follows_junk_symlinks_and_surfaces_unexpected_directories() {
        use std::os::unix::fs::symlink;

        let app_data = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let recovery = super::recovery_root(app_data.path()).unwrap();
        std::fs::write(outside.path().join("keep.txt"), "outside").unwrap();
        symlink(outside.path().join("keep.txt"), recovery.join("a.wsr")).unwrap();

        assert!(list_blobs(app_data.path()).unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("keep.txt")).unwrap(),
            "outside"
        );

        std::fs::create_dir(recovery.join("unexpected-directory")).unwrap();
        let error = list_blobs(app_data.path()).unwrap_err();
        assert_eq!(error.code, "recovery_unexpected_entry");
    }
}
