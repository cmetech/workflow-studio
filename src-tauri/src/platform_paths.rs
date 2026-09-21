use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};

#[cfg(windows)]
pub(crate) fn public_path(path: &Path) -> io::Result<PathBuf> {
    use std::path::{Component, Prefix};

    if !path.is_absolute() {
        return Err(invalid_path("path must be absolute"));
    }

    let mut components = path.components();
    let prefix = match components.next() {
        Some(Component::Prefix(prefix)) => prefix,
        _ => {
            return Err(invalid_path(
                "path does not have a supported Windows prefix",
            ))
        }
    };

    match prefix.kind() {
        Prefix::Disk(_) | Prefix::UNC(_, _) => Ok(path.to_path_buf()),
        Prefix::VerbatimDisk(drive) => {
            skip_explicit_root(&mut components);
            let mut converted = PathBuf::from(format!("{}:\\", char::from(drive)));
            converted.extend(components.map(|component| component.as_os_str()));
            Ok(converted)
        }
        Prefix::VerbatimUNC(server, share) => {
            skip_explicit_root(&mut components);
            let mut root = OsString::from(r"\\");
            root.push(server);
            root.push(r"\");
            root.push(share);
            let mut converted = PathBuf::from(root);
            converted.extend(components.map(|component| component.as_os_str()));
            Ok(converted)
        }
        Prefix::DeviceNS(_) | Prefix::Verbatim(_) => Err(invalid_path(
            "Windows device namespaces are not public paths",
        )),
    }
}

#[cfg(not(windows))]
pub(crate) fn public_path(path: &Path) -> io::Result<PathBuf> {
    Ok(path.to_path_buf())
}

// Task 7 consumes this at the native Git process boundary.
#[allow(dead_code)]
pub(crate) fn subprocess_path(path: &Path) -> io::Result<OsString> {
    Ok(public_path(path)?.into_os_string())
}

#[cfg(windows)]
fn skip_explicit_root(components: &mut std::path::Components<'_>) {
    if matches!(
        components.clone().next(),
        Some(std::path::Component::RootDir)
    ) {
        components.next();
    }
}

#[cfg(windows)]
fn invalid_path(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};

    use super::{public_path, subprocess_path};

    #[cfg(windows)]
    #[test]
    fn strips_only_supported_windows_verbatim_prefixes() {
        assert_eq!(
            public_path(Path::new(r"C:\Work\flows")).unwrap(),
            PathBuf::from(r"C:\Work\flows")
        );
        assert_eq!(
            public_path(Path::new(r"\\server\share")).unwrap(),
            PathBuf::from(r"\\server\share")
        );
        assert_eq!(
            public_path(Path::new(r"\\?\C:\Work\flows")).unwrap(),
            PathBuf::from(r"C:\Work\flows")
        );
        assert_eq!(
            public_path(Path::new(r"\\?\UNC\server\share")).unwrap(),
            PathBuf::from(r"\\server\share")
        );
        assert_eq!(
            subprocess_path(Path::new(r"\\?\C:\Work\flows")).unwrap(),
            OsString::from(r"C:\Work\flows")
        );
        assert_eq!(
            subprocess_path(Path::new(r"\\?\UNC\server\share")).unwrap(),
            OsString::from(r"\\server\share")
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_device_namespaces_and_non_absolute_paths() {
        for path in [
            r"\\.\PhysicalDrive0",
            r"\\?\GLOBALROOT\Device",
            r"C:flows",
            r"\flows",
            r"flows",
        ] {
            assert!(public_path(Path::new(path)).is_err(), "accepted {path}");
            assert!(subprocess_path(Path::new(path)).is_err(), "accepted {path}");
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn leaves_non_windows_paths_unchanged() {
        let path = Path::new("relative/workspace");
        assert_eq!(public_path(path).unwrap(), path);
        assert_eq!(subprocess_path(path).unwrap(), OsString::from(path));
    }
}
