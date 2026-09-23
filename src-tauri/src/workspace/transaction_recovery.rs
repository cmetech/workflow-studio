//! Native-only, durable inode retention. Never copy/unlink or automatically purge.
use super::{files, PathOperationResult, WorkspaceError, WorkspaceResult, WorkspaceScope};
use cap_fs_ext::{DirExt, MetadataExt};
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

#[path = "recovery_security.rs"]
mod security;

#[derive(Debug)]
pub(super) struct RecoveryStore {
    root: PathBuf,
    directory: Dir,
    identity: Handle,
    private: bool,
    #[cfg(test)]
    fixture: Option<tempfile::TempDir>,
}

impl RecoveryStore {
    pub(super) fn open_outside(root: &Path, scope: &WorkspaceScope) -> WorkspaceResult<Self> {
        Self::reject_inside(root, scope)?;
        Self::select(Some(root), scope)
    }

    pub(super) fn select(primary: Option<&Path>, scope: &WorkspaceScope) -> WorkspaceResult<Self> {
        Self::select_with_verification(primary, scope, Self::verify)
    }

    fn select_with_verification(
        primary: Option<&Path>,
        scope: &WorkspaceScope,
        verify: impl Fn(&Self, &WorkspaceScope) -> WorkspaceResult<()>,
    ) -> WorkspaceResult<Self> {
        let device = scope
            .directory()?
            .dir_metadata()
            .map_err(|e| failure(e.to_string()))?
            .dev();
        let mut reasons = Vec::new();
        if let Some(primary) = primary {
            match Self::reject_inside(primary, scope).and_then(|()| Self::open(primary)) {
                Ok(store) if store.device()? == device => {
                    match security::verify_writable(&store.directory) {
                        Ok(()) => return Ok(store),
                        Err(error) => reasons.push(format!(
                            "App-data recovery does not permit file creation: {error}"
                        )),
                    }
                }
                Ok(_) => reasons.push("App-data recovery is on another filesystem.".to_string()),
                Err(error) => reasons.push(error.message),
            }
        } else {
            reasons.push("The platform app-data location is unavailable.".into());
        }
        let user = security::user_key().map_err(|e| failure(e.to_string()))?;
        let mut key = user.into_bytes();
        key.push(0);
        key.extend_from_slice(scope.root_path()?.as_os_str().as_encoded_bytes());
        let name = format!(".loop24-transaction-recovery-{}", files::hash_bytes(&key));
        for ancestor in scope.root_path()?.ancestors().skip(1) {
            let candidate = ancestor.join(&name);
            let mut created = false;
            let outcome = (|| {
                super::artifacts::reject_ambient_links(ancestor)?;
                let parent = Dir::open_ambient_dir(ancestor, ambient_authority())
                    .map_err(|e| failure(e.to_string()))?;
                if parent
                    .dir_metadata()
                    .map_err(|e| failure(e.to_string()))?
                    .dev()
                    != device
                {
                    return Err(failure(
                        "The outside-workspace ancestor is on another filesystem.",
                    ));
                }
                let identity = Handle::from_file(
                    parent
                        .try_clone()
                        .map_err(|e| failure(e.to_string()))?
                        .into_std_file(),
                )
                .map_err(|e| failure(e.to_string()))?;
                created = security::create_private(&parent, ancestor, &name)
                    .map_err(|e| failure(e.to_string()))?;
                super::artifacts::reject_ambient_links(&candidate)?;
                let mut store = Self::open(&candidate)?;
                security::verify_private(&store.directory).map_err(|e| failure(e.to_string()))?;
                store.private = true;
                if Handle::from_path(ancestor).map_err(|e| failure(e.to_string()))? != identity
                    || store.device()? != device
                {
                    return Err(failure(
                        "Recovery ancestor or filesystem changed during selection.",
                    ));
                }
                verify(&store, scope)?;
                Ok(store)
            })();
            match outcome {
                Ok(store) => return Ok(store),
                Err(error) if created => return Err(failure(format!(
                    "New private recovery location {} could not be verified: {}. The directory was preserved for inspection; no further locations were created and no source files were removed.",
                    candidate.display(), error.message
                ))),
                Err(error) => reasons.push(format!("{}: {}", candidate.display(), error.message)),
            }
        }
        Err(failure(format!("No safe same-filesystem recovery location outside the workspace is available. Root workspaces, read-only ancestors, and nested mounts may require another workspace location. No source files were removed. {}", reasons.join(" "))))
    }

    fn reject_inside(root: &Path, scope: &WorkspaceScope) -> WorkspaceResult<()> {
        for ancestor in root.ancestors() {
            if let Ok(canonical) = ancestor.canonicalize() {
                if canonical.starts_with(scope.root_path()?) {
                    return Err(failure(format!("Native recovery location {} lies inside the selected workspace; transaction disposal is unavailable.", root.display())));
                }
                break;
            }
        }
        Ok(())
    }

    fn device(&self) -> WorkspaceResult<u64> {
        Ok(self
            .directory
            .dir_metadata()
            .map_err(|e| failure(e.to_string()))?
            .dev())
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
            private: false,
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
        if self.private {
            security::verify_private(&self.directory).map_err(|e| failure(e.to_string()))?;
        }
        security::verify_writable(&self.directory).map_err(|e| {
            failure(format!(
                "Recovery storage does not permit file creation: {e}"
            ))
        })?;
        Ok(())
    }
}

/// Check the nearest existing parent before any staging or transaction mutation.
/// A nested mount cannot borrow a vault on the workspace root's filesystem.
pub(super) fn preflight(scope: &WorkspaceScope, relative: &str) -> WorkspaceResult<()> {
    super::artifacts::validate(relative)?;
    let store = scope.recovery.as_ref().ok_or_else(|| {
        failure(format!(
            "Native recovery storage is unavailable; no mutation was started. {}",
            scope
                .recovery_error
                .as_deref()
                .unwrap_or("No recovery capability is bound.")
        ))
    })?;
    store.verify(scope)?;
    let mut parent = scope
        .directory()?
        .try_clone()
        .map_err(|e| failure(e.to_string()))?;
    let parts: Vec<_> = relative.split('/').collect();
    let mut complete_parent = true;
    for part in &parts[..parts.len() - 1] {
        match parent.symlink_metadata(part) {
            Ok(metadata) => {
                super::artifacts::reject_link(&metadata)?;
                parent = parent
                    .open_dir_nofollow(part)
                    .map_err(|e| failure(e.to_string()))?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                complete_parent = false;
                break;
            }
            Err(error) => return Err(failure(error.to_string())),
        }
    }
    if parent
        .dir_metadata()
        .map_err(|e| failure(e.to_string()))?
        .dev()
        != store.device()?
    {
        return Err(failure("The artifact is on a filesystem without a bound outside-workspace recovery vault; no mutation was started."));
    }
    if complete_parent {
        let bound = files::BoundPath {
            parent,
            name: parts[parts.len() - 1].into(),
            reject_symlinks: true,
        };
        match super::artifacts::open(&bound) {
            Ok(file)
                if file.metadata().map_err(|e| failure(e.to_string()))?.dev()
                    != store.device()? =>
            {
                return Err(failure("The mounted artifact is on a filesystem without a bound outside-workspace recovery vault; no mutation was started."));
            }
            Ok(_) => (),
            Err(error) if error.code == "path_not_found" => (),
            Err(error) => return Err(error),
        }
    }
    Ok(())
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

    fn assert_runtime_save_retains_live_inode(root: &Path, primary: &Path) {
        use std::io::{Seek, SeekFrom, Write};
        let target = root.join("script.py");
        std::fs::write(&target, "original").unwrap();
        let mut writer = std::fs::OpenOptions::new()
            .write(true)
            .open(&target)
            .unwrap();
        let mut scope = WorkspaceScope::new(root).unwrap();
        match RecoveryStore::open_outside(primary, &scope) {
            Ok(store) => scope.recovery = Some(store),
            Err(error) => {
                scope.recovery = None;
                scope.recovery_error = Some(error.message);
            }
        }
        let saved = super::super::artifacts::write_text(
            &scope,
            "script.py",
            "replacement",
            Some(&files::hash_bytes(b"original")),
        )
        .expect("a writable workspace must save with an available same-volume external vault");
        assert_eq!(std::fs::read(&target).unwrap(), b"replacement");
        let retained = PathBuf::from(
            saved
                .recovery_results
                .iter()
                .find(|entry| entry.status == "recoveryRetained")
                .unwrap()
                .destination_path
                .as_ref()
                .unwrap(),
        );
        assert!(!retained.starts_with(root.canonicalize().unwrap()));
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
        writer.seek(SeekFrom::Start(0)).unwrap();
        writer.write_all(b"late external write").unwrap();
        writer.set_len(19).unwrap();
        writer.sync_all().unwrap();
        drop(scope);
        assert_eq!(std::fs::read(&retained).unwrap(), b"late external write");
        let metadata: serde_json::Value =
            serde_json::from_slice(&std::fs::read(retained.with_extension("json")).unwrap())
                .unwrap();
        assert_eq!(metadata["relativePath"], "script.py");
        assert_eq!(
            metadata["workspaceRoot"],
            root.canonicalize().unwrap().to_str().unwrap()
        );
        let restarted = WorkspaceScope::new(root).unwrap();
        let reopened = RecoveryStore::open_outside(primary, &restarted).unwrap();
        assert_eq!(retained.parent().unwrap(), reopened.root);
    }

    #[test]
    fn recovery_runtime_save_when_app_data_is_unavailable() {
        let sandbox = tempfile::tempdir().unwrap();
        let root = sandbox.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let blocked = sandbox.path().join("unavailable-app-data");
        std::fs::write(&blocked, "not a directory").unwrap();
        assert_runtime_save_retains_live_inode(&root, &blocked.join("transaction-recovery"));
    }

    #[cfg(windows)]
    #[test]
    fn recovery_runtime_save_when_existing_primary_denies_file_creation() {
        let sandbox = tempfile::tempdir().unwrap();
        let root = sandbox.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let primary = sandbox.path().join("readonly-primary");
        security::create_read_only_for_test(&primary).unwrap();
        Dir::open_ambient_dir(&primary, ambient_authority()).expect("readable existing primary");
        assert_eq!(
            std::fs::File::create(primary.join("denied"))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::PermissionDenied,
            "prove actual Windows create denial"
        );
        assert_runtime_save_retains_live_inode(&root, &primary);
        assert_eq!(
            std::fs::File::create(primary.join("still-denied"))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::PermissionDenied,
            "selection must not rewrite the primary DACL"
        );
        assert_eq!(std::fs::read_dir(primary).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn recovery_runtime_save_with_effective_primary_write_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let sandbox = tempfile::tempdir().unwrap();
        let root = sandbox.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let primary = sandbox.path().join("readonly-primary");
        std::fs::create_dir(&primary).unwrap();
        std::fs::set_permissions(&primary, std::fs::Permissions::from_mode(0o500)).unwrap();
        let create_denied = match std::fs::File::create(primary.join("permission-check")) {
            Err(error) => {
                assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
                true
            }
            Ok(file) => {
                // Privileged users may legitimately bypass 0500. Do not claim a denial in that case.
                drop(file);
                std::fs::remove_file(primary.join("permission-check")).unwrap();
                false
            }
        };
        eprintln!(
            "effective uid={}, actual primary create denial={create_denied}",
            unsafe { libc::geteuid() }
        );
        assert_runtime_save_retains_live_inode(&root, &primary);
        assert_eq!(
            std::fs::metadata(&primary).unwrap().permissions().mode() & 0o777,
            0o500
        );
        if create_denied {
            assert_eq!(std::fs::read_dir(&primary).unwrap().count(), 0);
        }
        std::fs::set_permissions(&primary, std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[test]
    fn recovery_full_primary_budget_is_not_bypassed_by_selecting_a_fallback() {
        let sandbox = tempfile::tempdir().unwrap();
        let root = sandbox.path().join("workspace");
        let primary = sandbox.path().join("primary");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&primary).unwrap();
        std::fs::File::create(primary.join("full.retained"))
            .unwrap()
            .set_len(MAX_BYTES)
            .unwrap();
        std::fs::write(root.join("source"), "original").unwrap();
        let mut scope = WorkspaceScope::new(&root).unwrap();
        let selected = RecoveryStore::select(Some(&primary), &scope).unwrap();
        assert_eq!(selected.root, primary.canonicalize().unwrap());
        scope.recovery = Some(selected);
        let error = super::super::artifacts::write_text(
            &scope,
            "source",
            "new",
            Some(&files::hash_bytes(b"original")),
        )
        .unwrap_err();
        assert!(error.message.contains("full"));
        assert_eq!(std::fs::read(root.join("source")).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(sandbox.path()).unwrap().count(), 2);
        assert_eq!(
            std::fs::metadata(primary.join("full.retained"))
                .unwrap()
                .len(),
            MAX_BYTES
        );
    }

    #[test]
    fn recovery_new_private_vault_verification_failure_stops_ancestor_search() {
        let sandbox = tempfile::tempdir().unwrap();
        let parent = sandbox.path().join("parent");
        let root = parent.join("workspace");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("source"), "original").unwrap();
        let scope = WorkspaceScope::new(&root).unwrap();
        let first = std::cell::RefCell::new(None);
        let error = RecoveryStore::select_with_verification(None, &scope, |store, _| {
            assert!(
                first.borrow().is_none(),
                "a newly created vault failed verification; must not create another ancestor vault"
            );
            security::verify_private(&store.directory).unwrap();
            *first.borrow_mut() = Some(store.root.clone());
            std::fs::write(store.root.join("inspection-evidence"), "preserve").unwrap();
            Err(failure(
                "injected post-creation capability verification failure",
            ))
        })
        .unwrap_err();
        assert_eq!(error.code, "workspace_recovery_unavailable");
        let retained = first.into_inner().unwrap();
        assert_eq!(
            std::fs::read(retained.join("inspection-evidence")).unwrap(),
            b"preserve"
        );
        assert_eq!(std::fs::read(root.join("source")).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(sandbox.path()).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(parent).unwrap().count(), 2);
    }

    #[test]
    fn recovery_missing_app_data_resolution_selects_private_restartable_vault() {
        let sandbox = tempfile::tempdir().unwrap();
        let root = sandbox.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let scope = WorkspaceScope::new(&root).unwrap();
        let store = RecoveryStore::select(None, &scope).unwrap();
        security::verify_private(&store.directory).unwrap();
        assert!(store.private);
        assert_eq!(
            store.root.parent().unwrap(),
            sandbox.path().canonicalize().unwrap()
        );
        assert_eq!(
            store.root,
            RecoveryStore::select(None, &scope).unwrap().root
        );
        assert!(std::fs::read_dir(root).unwrap().next().is_none());
    }

    #[test]
    fn recovery_private_creation_never_takes_over_existing_unrelated_directory() {
        let sandbox = tempfile::tempdir().unwrap();
        let path = sandbox.path().join("existing");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("unrelated"), "keep").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let parent = Dir::open_ambient_dir(sandbox.path(), ambient_authority()).unwrap();
        let directory = parent.open_dir_nofollow("existing").unwrap();
        assert!(security::verify_private(&directory).is_err());
        security::create_private(&parent, sandbox.path(), "existing").unwrap();
        assert!(security::verify_private(&directory).is_err());
        assert_eq!(std::fs::read(path.join("unrelated")).unwrap(), b"keep");
    }

    #[test]
    fn recovery_unavailable_transaction_is_rejected_before_staging_or_mutation() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("source"), "original").unwrap();
        let mut scope = WorkspaceScope::new(root.path()).unwrap();
        scope.recovery = None;
        let plan: super::super::transaction::PackageMutationPlan = serde_json::from_value(
            serde_json::json!({"workspaceId":super::super::transaction::workspace_id(&scope).unwrap(),
                "expectedEntries":[{"relativePath":"source","expectedCurrentHash":files::hash_bytes(b"original")}],
                "writes":[{"relativePath":"source","text":"new","expectedCurrentHash":files::hash_bytes(b"original")}],
                "moves":[],"trashes":[]})
        ).unwrap();
        let error = super::super::transaction::apply_with_staging_hook(&scope, &plan, |_| {
            panic!("recovery must be selected before staging")
        })
        .unwrap_err();
        assert_eq!(error.code, "workspace_recovery_unavailable");
        assert_eq!(
            std::fs::read(root.path().join("source")).unwrap(),
            b"original"
        );
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn recovery_cross_filesystem_preflight_preserves_workspace_without_staging() {
        let root = tempfile::tempdir_in("/tmp").unwrap();
        let other = tempfile::tempdir_in("/dev/shm").unwrap();
        std::fs::write(root.path().join("source"), "original").unwrap();
        let mut scope = WorkspaceScope::new(root.path()).unwrap();
        scope.recovery = Some(RecoveryStore::open(other.path()).unwrap());
        let error = super::super::artifacts::write_text(
            &scope,
            "source",
            "new",
            Some(&files::hash_bytes(b"original")),
        )
        .unwrap_err();
        assert!(error.message.contains("no mutation was started"));
        assert_eq!(
            std::fs::read(root.path().join("source")).unwrap(),
            b"original"
        );
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(other.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn recovery_filesystem_root_without_external_location_fails_closed() {
        let scope = WorkspaceScope::new(Path::new("/")).unwrap();
        let error = RecoveryStore::select(None, &scope).unwrap_err();
        assert!(error
            .message
            .contains("No safe same-filesystem recovery location outside"));
    }

    #[cfg(unix)]
    #[test]
    fn recovery_private_permissions_and_identity_are_rechecked_before_retention() {
        use std::os::unix::fs::PermissionsExt;
        let sandbox = tempfile::tempdir().unwrap();
        let root = sandbox.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("source"), "original").unwrap();
        let mut scope = WorkspaceScope::new(&root).unwrap();
        scope.recovery = Some(RecoveryStore::select(None, &scope).unwrap());
        let vault = scope.recovery.as_ref().unwrap().root.clone();
        std::fs::set_permissions(&vault, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(preflight(&scope, "source").is_err());
        std::fs::set_permissions(&vault, std::fs::Permissions::from_mode(0o700)).unwrap();
        let moved = vault.with_extension("moved");
        std::fs::rename(&vault, &moved).unwrap();
        std::os::unix::fs::symlink(&moved, &vault).unwrap();
        assert!(preflight(&scope, "source").is_err());
        assert_eq!(std::fs::read(root.join("source")).unwrap(), b"original");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn recovery_runtime_save_with_app_data_on_a_distinct_filesystem() {
        let sandbox = tempfile::tempdir_in("/tmp").unwrap();
        let primary = tempfile::tempdir_in("/dev/shm").unwrap();
        assert_ne!(
            std::fs::metadata(sandbox.path()).unwrap().dev(),
            std::fs::metadata(primary.path()).unwrap().dev(),
            "test requires two real filesystems"
        );
        let root = sandbox.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        assert_runtime_save_retains_live_inode(&root, primary.path());
    }

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
