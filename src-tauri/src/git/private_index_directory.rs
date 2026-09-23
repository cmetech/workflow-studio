//! Empty, owner-private working directory for Git index serialization.
use cap_fs_ext::DirExt;
use cap_std::{ambient_authority, fs::Dir};
use same_file::Handle;
use std::{
    io,
    path::{Path, PathBuf},
};

pub(super) struct PrivateIndexDirectory {
    parent: Dir,
    parent_path: PathBuf,
    parent_identity: Handle,
    directory: Option<Dir>,
    identity: Option<Handle>,
    name: String,
    path: PathBuf,
    #[cfg(windows)]
    _path_locks: Vec<std::fs::File>,
}

fn identity(directory: &Dir) -> io::Result<Handle> {
    Handle::from_file(directory.try_clone()?.into_std_file())
}

impl PrivateIndexDirectory {
    pub(super) fn new() -> io::Result<Self> {
        let parent_path = std::env::temp_dir().canonicalize()?;
        #[cfg(unix)]
        verify_parent_chain(&parent_path)?;
        #[cfg(windows)]
        let mut path_locks = lock_path_chain(&parent_path)?;
        let parent = Dir::open_ambient_dir(&parent_path, ambient_authority())?;
        let parent_identity = identity(&parent)?;
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|error| io::Error::other(error.to_string()))?;
        let name = format!(
            "loop24-git-index-{}",
            random
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
        if Handle::from_path(&parent_path)? != parent_identity {
            return Err(io::Error::other("Temporary directory changed."));
        }
        if !crate::workspace::create_private_directory(&parent, &parent_path, &name)? {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "Private index directory already exists.",
            ));
        }
        let directory = parent.open_dir_nofollow(&name)?;
        let identity = identity(&directory)?;
        let path = parent_path.join(&name);
        #[cfg(windows)]
        path_locks.push(lock_directory(&path)?);
        let result = Self {
            parent,
            parent_path,
            parent_identity,
            directory: Some(directory),
            identity: Some(identity),
            name,
            path,
            #[cfg(windows)]
            _path_locks: path_locks,
        };
        result.verify()?;
        Ok(result)
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn verify(&self) -> io::Result<()> {
        let directory = self
            .directory
            .as_ref()
            .ok_or_else(|| io::Error::other("Private directory closed."))?;
        let bound_identity = self
            .identity
            .as_ref()
            .ok_or_else(|| io::Error::other("Private directory closed."))?;
        crate::workspace::verify_private_directory(directory)?;
        if Handle::from_path(&self.parent_path)? != self.parent_identity
            || &identity(&self.parent.open_dir_nofollow(&self.name)?)? != bound_identity
            || &Handle::from_path(&self.path)? != bound_identity
            || directory.entries()?.next().is_some()
        {
            return Err(io::Error::other(
                "Private index directory changed or is not empty.",
            ));
        }
        Ok(())
    }
}

impl Drop for PrivateIndexDirectory {
    fn drop(&mut self) {
        // Never recursively remove unexpected content or a replacement directory.
        if self.verify().is_ok() {
            // Windows denies deletion while our own path locks remain open.
            #[cfg(windows)]
            self._path_locks.pop();
            // cap-std's Windows directory handles also deny delete sharing.
            self.identity.take();
            self.directory.take();
            let _ = self.parent.remove_dir(&self.name);
        }
    }
}

#[cfg(unix)]
fn verify_parent_chain(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    for ancestor in path.ancestors() {
        let metadata = std::fs::symlink_metadata(ancestor)?;
        let trusted_owner = metadata.uid() == 0 || metadata.uid() == unsafe { libc::geteuid() };
        let mutable_by_others = metadata.mode() & 0o022 != 0;
        let sticky = metadata.mode() & u32::from(libc::S_ISVTX) != 0;
        if !metadata.is_dir() || !trusted_owner || (mutable_by_others && !sticky) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Temporary directory ancestors permit replacement by another user.",
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn lock_directory(path: &Path) -> io::Result<std::fs::File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    // Deny delete sharing throughout the command, including on every ancestor.
    // This prevents parent FILE_DELETE_CHILD rights from replacing the path.
    let file = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Temporary directory path contains a reparse point.",
        ));
    }
    Ok(file)
}

#[cfg(windows)]
fn lock_path_chain(path: &Path) -> io::Result<Vec<std::fs::File>> {
    path.ancestors()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(lock_directory)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn private_index_directory_is_owner_private_empty_and_removed_on_drop() {
        let directory = PrivateIndexDirectory::new().unwrap();
        let path = directory.path().to_owned();
        crate::workspace::verify_private_directory(directory.directory.as_ref().unwrap()).unwrap();
        assert_eq!(fs::read_dir(&path).unwrap().count(), 0);
        drop(directory);
        assert!(!path.exists());
    }

    #[test]
    fn private_index_directory_preserves_unexpected_contents() {
        let directory = PrivateIndexDirectory::new().unwrap();
        let path = directory.path().to_owned();
        fs::write(path.join("unexpected"), b"preserve").unwrap();
        assert!(directory.verify().is_err());
        drop(directory);
        assert_eq!(fs::read(path.join("unexpected")).unwrap(), b"preserve");
        fs::remove_file(path.join("unexpected")).unwrap();
        fs::remove_dir(path).unwrap();
    }

    #[test]
    fn private_index_directory_rejects_and_preserves_replacement() {
        let directory = PrivateIndexDirectory::new().unwrap();
        let path = directory.path().to_owned();
        let moved = path.with_extension("moved");
        #[cfg(windows)]
        {
            assert!(fs::rename(&path, &moved).is_err());
            directory.verify().unwrap();
            drop(directory);
            assert!(!path.exists());
            return;
        }
        #[cfg(unix)]
        {
            fs::rename(&path, &moved).unwrap();
            fs::create_dir(&path).unwrap();
            assert!(directory.verify().is_err());
            drop(directory);
            assert!(path.is_dir());
            assert!(moved.is_dir());
            fs::remove_dir(path).unwrap();
            fs::remove_dir(moved).unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn private_index_directory_rejects_writable_nonsticky_parent() {
        use std::os::unix::fs::PermissionsExt;
        let temporary = tempfile::tempdir().unwrap();
        fs::set_permissions(temporary.path(), fs::Permissions::from_mode(0o777)).unwrap();
        assert!(verify_parent_chain(temporary.path()).is_err());
        fs::set_permissions(temporary.path(), fs::Permissions::from_mode(0o700)).unwrap();
        verify_parent_chain(temporary.path()).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn private_index_directory_locks_ancestors_until_released() {
        let temporary = tempfile::tempdir().unwrap();
        let ancestor = temporary.path().join("ancestor");
        let child = ancestor.join("child");
        fs::create_dir_all(&child).unwrap();
        let locks = lock_path_chain(&child).unwrap();
        let renamed = temporary.path().join("renamed");
        assert!(fs::rename(&ancestor, &renamed).is_err());
        drop(locks);
        fs::rename(&ancestor, &renamed).unwrap();
        fs::rename(&renamed, &ancestor).unwrap();
    }
}
