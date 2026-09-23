//! Native-only, durable inode retention. Never copy/unlink or automatically purge.
use super::{files, PathOperationResult, WorkspaceError, WorkspaceResult, WorkspaceScope};
use cap_std::{ambient_authority, fs::Dir};
use same_file::Handle;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

static ADMISSION: Mutex<()> = Mutex::new(());
const MAX_ENTRIES: usize = 4096;
const MAX_BYTES: u64 = 256 * 1024 * 1024;
const MAX_METADATA_BYTES: usize = 64 * 1024;

#[derive(Debug)]
pub(super) struct RecoveryStore {
    root: PathBuf,
    directory: Dir,
    identity: Handle,
    #[cfg(test)]
    fixture: Option<tempfile::TempDir>,
}

impl RecoveryStore {
    pub(super) fn open_outside(root: &Path, scope: &WorkspaceScope) -> WorkspaceResult<Self> {
        for ancestor in root.ancestors() {
            if let Ok(canonical) = ancestor.canonicalize() {
                if canonical.starts_with(scope.root_path()?) {
                    return Err(failure(format!("Native recovery location {} lies inside the selected workspace; transaction disposal is unavailable.", root.display())));
                }
                break;
            }
        }
        Self::open(root).map_err(|error| {
            failure(format!(
                "Native recovery location {} is unavailable: {}",
                root.display(),
                error.message
            ))
        })
    }

    pub(super) fn open(root: &Path) -> WorkspaceResult<Self> {
        // Reject existing linked ancestors before creating any native directory.
        for ancestor in root.ancestors() {
            match std::fs::symlink_metadata(ancestor) {
                Ok(metadata) => {
                    #[cfg(windows)]
                    {
                        use std::os::windows::fs::MetadataExt;
                        if metadata.file_attributes() & 0x400 != 0 {
                            return Err(failure("Recovery storage contains a reparse point."));
                        }
                    }
                    if metadata.file_type().is_symlink() {
                        return Err(failure("Recovery storage contains a symbolic link."));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(failure(error.to_string())),
            }
        }
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(root)
            .map_err(|error| failure(error.to_string()))?;
        super::artifacts::reject_ambient_links(root)?;
        let root = root
            .canonicalize()
            .map_err(|error| failure(error.to_string()))?;
        let directory = Dir::open_ambient_dir(&root, ambient_authority())
            .map_err(|error| failure(error.to_string()))?;
        let identity = Handle::from_file(
            directory
                .try_clone()
                .map_err(|error| failure(error.to_string()))?
                .into_std_file(),
        )
        .map_err(|error| failure(error.to_string()))?;
        Ok(Self {
            root,
            directory,
            identity,
            #[cfg(test)]
            fixture: None,
        })
    }

    #[cfg(test)]
    pub(super) fn isolated() -> WorkspaceResult<Self> {
        let fixture = tempfile::tempdir().map_err(|error| failure(error.to_string()))?;
        let mut store = Self::open(fixture.path())?;
        store.fixture = Some(fixture);
        Ok(store)
    }

    fn verify(&self, scope: &WorkspaceScope) -> WorkspaceResult<()> {
        super::artifacts::reject_ambient_links(&self.root)?;
        let current = Handle::from_path(&self.root).map_err(|error| failure(error.to_string()))?;
        if current != self.identity || self.root.starts_with(scope.root_path()?) {
            return Err(failure(
                "Recovery storage changed or lies inside the selected workspace.",
            ));
        }
        Ok(())
    }
}

fn failure(message: impl Into<String>) -> WorkspaceError {
    WorkspaceError::new("workspace_recovery_unavailable", message)
}

pub(super) fn retain(
    scope: &WorkspaceScope,
    source: &files::BoundPath,
    identity: &Handle,
    relative: &str,
) -> WorkspaceResult<PathOperationResult> {
    retain_with_link(
        scope,
        source,
        identity,
        relative,
        |source, directory, name| source.parent.hard_link(&source.name, directory, name),
    )
}

fn retain_with_link(
    scope: &WorkspaceScope,
    source: &files::BoundPath,
    identity: &Handle,
    relative: &str,
    link: impl FnOnce(&files::BoundPath, &Dir, &str) -> std::io::Result<()>,
) -> WorkspaceResult<PathOperationResult> {
    let _guard = ADMISSION
        .lock()
        .map_err(|_| failure("Recovery admission is unavailable."))?;
    let store = scope.recovery.as_ref().ok_or_else(|| {
        failure(format!(
            "Native recovery storage is unavailable; the workspace file was preserved. {}",
            scope
                .recovery_error
                .as_deref()
                .unwrap_or("No native recovery capability is bound.")
        ))
    })?;
    store.verify(scope)?;
    let mut count = 0usize;
    let mut bytes = 0u64;
    for entry in store
        .directory
        .entries()
        .map_err(|error| failure(error.to_string()))?
    {
        let entry = entry.map_err(|error| failure(error.to_string()))?;
        let metadata = store
            .directory
            .symlink_metadata(entry.file_name())
            .map_err(|error| failure(error.to_string()))?;
        super::artifacts::reject_link(&metadata)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(failure(
                "Unexpected recovery storage entry; inspect the recovery directory.",
            ));
        }
        count += 1;
        bytes = bytes.saturating_add(metadata.len());
        if count >= MAX_ENTRIES || bytes >= MAX_BYTES {
            return Err(failure(format!("Recovery storage is full. Inspect retained files at {} before retrying; no files were purged.", store.root.display())));
        }
    }
    let name = format!("{}.retained", super::package_hash::token()?);
    let metadata_name = Path::new(&name).with_extension("json");
    let provenance = serde_json::to_vec_pretty(&serde_json::json!({
        "version": 1,
        "workspaceRoot": scope.root_path()?,
        "relativePath": relative,
        "retainedFile": name,
    }))
    .map_err(|error| failure(format!("Recovery metadata could not be encoded: {error}")))?;
    if provenance.len() > MAX_METADATA_BYTES {
        return Err(failure(
            "Recovery metadata exceeds 64 KiB; the source was preserved.",
        ));
    }
    let size = source
        .parent
        .symlink_metadata(&source.name)
        .map_err(|error| failure(error.to_string()))?
        .len();
    if count.saturating_add(2) > MAX_ENTRIES
        || bytes
            .saturating_add(size)
            .saturating_add(provenance.len() as u64)
            > MAX_BYTES
    {
        return Err(failure(format!(
            "Recovery storage entry or byte budget is full at {}; inspect retained files manually before retrying. The source was preserved and no files were purged.",
            store.root.display()
        )));
    }
    let destination = store.root.join(&name);
    link(source, &store.directory, &name).map_err(|error| failure(format!("Could not retain the same file in native recovery storage at {} (cross-volume copying is not allowed): {error}. The workspace file was preserved.", store.root.display())))?;
    let receipt = PathOperationResult {
        relative_path: relative.into(), destination_path: Some(destination.to_string_lossy().into_owned()),
        status: "recoveryRetained".into(), error_code: None,
        message: Some(format!("Retained file for manual recovery; original workspace/path metadata is at {}. This is the same file, so writes through an already-open handle remain recoverable here. Stop external editors before manually removing recovery files. No automatic purge is performed.", store.root.join(&metadata_name).display())),
    };
    let verified = (|| {
        let retained = files::BoundPath {
            parent: store
                .directory
                .try_clone()
                .map_err(|error| failure(error.to_string()))?,
            name: name.into(),
            reject_symlinks: true,
        };
        if files::transaction_identity(&retained)? != *identity
            || files::transaction_identity(source)? != *identity
        {
            return Err(failure(
                "Recovery link identity changed; both locations were preserved.",
            ));
        }
        use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
        let mut options = cap_std::fs::OpenOptions::new();
        // Windows FlushFileBuffers requires write access; never truncate.
        options.read(true).write(true).follow(FollowSymlinks::No);
        let file = store
            .directory
            .open_with(&retained.name, &options)
            .map_err(|error| failure(error.to_string()))?;
        let opened = Handle::from_file(
            file.try_clone()
                .map_err(|error| failure(error.to_string()))?
                .into_std(),
        )
        .map_err(|error| failure(error.to_string()))?;
        if opened != *identity {
            return Err(failure(
                "The retained file changed before synchronization; both locations were preserved.",
            ));
        }
        file.sync_all()
            .map_err(|error| failure(error.to_string()))?;
        // Persist provenance before authorizing removal of the workspace name.
        // A partial metadata write is kept for diagnosis; never purge its inode.
        use std::io::Write;
        let mut options = cap_std::fs::OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut metadata_file = store.directory.open_with(&metadata_name, &options).map_err(|error| failure(format!("Recovery metadata could not be created at {}: {error}; both file locations were preserved.", store.root.join(&metadata_name).display())))?;
        metadata_file.write_all(&provenance).and_then(|()| metadata_file.sync_all()).map_err(|error| failure(format!("Recovery metadata could not be persisted at {}: {error}; both file locations were preserved.", store.root.join(&metadata_name).display())))?;
        #[cfg(unix)]
        crate::native_fs::sync_capability_directory(&store.directory)
            .map_err(|error| failure(error.to_string()))?;
        store.verify(scope)
    })();
    if let Err(mut error) = verified {
        error.path_results.push(receipt);
        return Err(error);
    }
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_metadata_identifies_original_after_scope_is_closed() {
        let root = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("source"), "C").unwrap();
        let mut scope = WorkspaceScope::new(root.path()).unwrap();
        scope.recovery = Some(RecoveryStore::open(vault.path()).unwrap());
        let workspace = scope.root_path().unwrap().to_path_buf();
        let source = super::super::artifacts::bind(&scope, "source").unwrap();
        let identity = files::transaction_identity(&source).unwrap();
        let receipt = files::transaction_remove(
            &scope,
            "source",
            &source,
            &identity,
            &files::hash_bytes(b"C"),
        )
        .unwrap();
        drop(scope);
        let retained = PathBuf::from(receipt.destination_path.unwrap());
        let metadata: serde_json::Value = serde_json::from_slice(
            &std::fs::read(retained.with_extension("json")).expect("durable recovery metadata"),
        )
        .unwrap();
        assert_eq!(metadata["version"], 1);
        assert_eq!(metadata["workspaceRoot"], workspace.to_str().unwrap());
        assert_eq!(metadata["relativePath"], "source");
        assert_eq!(
            metadata["retainedFile"],
            retained.file_name().unwrap().to_str().unwrap()
        );
        assert_eq!(std::fs::read_to_string(retained).unwrap(), "C");
    }

    #[test]
    fn recovery_metadata_failure_preserves_source_and_retained_file() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("source"), "C").unwrap();
        let scope = WorkspaceScope::new(root.path()).unwrap();
        let source = super::super::artifacts::bind(&scope, "source").unwrap();
        let identity = files::transaction_identity(&source).unwrap();
        let result = retain_with_link(
            &scope,
            &source,
            &identity,
            "source",
            |source, directory, name| {
                source.parent.hard_link(&source.name, directory, name)?;
                directory.create_dir(Path::new(name).with_extension("json"))
            },
        );
        assert!(
            result.is_err(),
            "metadata must be persisted before disposal is authorized"
        );
        let receipt = &result.unwrap_err().path_results[0];
        assert_eq!(
            std::fs::read_to_string(receipt.destination_path.as_ref().unwrap()).unwrap(),
            "C"
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("source")).unwrap(),
            "C"
        );
    }

    #[test]
    fn recovery_inside_workspace_is_rejected_before_directory_creation() {
        let root = tempfile::tempdir().unwrap();
        let scope = WorkspaceScope::new(root.path()).unwrap();
        let destination = root.path().join("new/native-recovery");
        assert!(RecoveryStore::open_outside(&destination, &scope).is_err());
        assert!(!root.path().join("new").exists());
    }

    #[test]
    fn recovery_unavailable_does_not_prevent_reading_and_preserves_disposal_source() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("source"), "C").unwrap();
        let mut scope = WorkspaceScope::new(root.path()).unwrap();
        scope.recovery = None;
        scope.recovery_error =
            Some("native vault /unavailable/transaction-recovery is read-only".into());
        assert_eq!(
            super::super::artifacts::read(&scope, "source")
                .unwrap()
                .sha256,
            files::hash_bytes(b"C")
        );
        let source = super::super::artifacts::bind(&scope, "source").unwrap();
        let identity = files::transaction_identity(&source).unwrap();
        let error = files::transaction_remove(
            &scope,
            "source",
            &source,
            &identity,
            &files::hash_bytes(b"C"),
        )
        .unwrap_err();
        assert!(error.message.contains("/unavailable/transaction-recovery"));
        assert_eq!(
            std::fs::read_to_string(root.path().join("source")).unwrap(),
            "C"
        );
    }

    #[test]
    fn recovery_cross_volume_and_link_failure_preserve_source_without_copy_fallback() {
        for code in [
            if cfg!(windows) { 17 } else { 18 },
            if cfg!(windows) { 5 } else { 13 },
        ] {
            let root = tempfile::tempdir().unwrap();
            std::fs::write(root.path().join("source"), "C").unwrap();
            let scope = WorkspaceScope::new(root.path()).unwrap();
            let source = super::super::artifacts::bind(&scope, "source").unwrap();
            let identity = files::transaction_identity(&source).unwrap();
            let error = retain_with_link(&scope, &source, &identity, "source", |_, _, _| {
                Err(std::io::Error::from_raw_os_error(code))
            })
            .unwrap_err();
            assert_eq!(error.code, "workspace_recovery_unavailable");
            assert!(error
                .message
                .contains("cross-volume copying is not allowed"));
            assert_eq!(
                std::fs::read_to_string(root.path().join("source")).unwrap(),
                "C"
            );
            assert_eq!(
                scope
                    .recovery
                    .as_ref()
                    .unwrap()
                    .directory
                    .entries()
                    .unwrap()
                    .count(),
                0
            );
        }
    }

    #[test]
    fn recovery_capacity_refuses_without_purge_and_names_native_vault() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("source"), "C").unwrap();
        let scope = WorkspaceScope::new(root.path()).unwrap();
        let store = scope.recovery.as_ref().unwrap();
        let retained = store.directory.create("existing.retained").unwrap();
        retained.set_len(MAX_BYTES).unwrap();
        let source = super::super::artifacts::bind(&scope, "source").unwrap();
        let identity = files::transaction_identity(&source).unwrap();
        let error = retain(&scope, &source, &identity, "source").unwrap_err();
        assert!(error.message.contains(store.root.to_str().unwrap()));
        assert!(error.message.contains("no files were purged"));
        assert_eq!(
            std::fs::read_to_string(root.path().join("source")).unwrap(),
            "C"
        );
        assert_eq!(retained.metadata().unwrap().len(), MAX_BYTES);
    }

    #[test]
    fn recovery_postlink_failure_reports_source_and_retained_location() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("source"), "C").unwrap();
        let scope = WorkspaceScope::new(root.path()).unwrap();
        let source = super::super::artifacts::bind(&scope, "source").unwrap();
        let identity = files::transaction_identity(&source).unwrap();
        let error = retain_with_link(
            &scope,
            &source,
            &identity,
            "source",
            |source, directory, name| {
                source.parent.hard_link(&source.name, directory, name)?;
                source.parent.remove_file(&source.name)?;
                std::fs::write(root.path().join("source"), "foreign")
            },
        )
        .unwrap_err();
        let receipt = &error.path_results[0];
        assert_eq!(receipt.relative_path, "source");
        assert_eq!(
            std::fs::read_to_string(receipt.destination_path.as_ref().unwrap()).unwrap(),
            "C"
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("source")).unwrap(),
            "foreign"
        );
    }
}
