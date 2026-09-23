//! Private fallback vaults. Never chmod or replace the ACL of an existing entry.
use cap_std::fs::Dir;
use std::{io, path::Path};

#[cfg(unix)]
pub(super) fn user_key() -> io::Result<String> {
    Ok(unsafe { libc::geteuid() }.to_string())
}

#[cfg(unix)]
pub(crate) fn create_private(parent: &Dir, _path: &Path, name: &str) -> io::Result<bool> {
    use cap_std::fs::{DirBuilder, DirBuilderExt};
    let mut builder = DirBuilder::new();
    builder.mode(0o700);
    match parent.create_dir_with(name, &builder) {
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        result => result.map(|()| true),
    }
}

#[cfg(unix)]
pub(crate) fn verify_private(directory: &Dir) -> io::Result<()> {
    use cap_std::fs::MetadataExt;
    let metadata = directory.dir_metadata()?;
    if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o777 != 0o700 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Recovery vault must already be owned by the current user with mode 0700.",
        ));
    }
    Ok(())
}

#[cfg(unix)]
pub(super) fn verify_writable(directory: &Dir) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    // Ask the OS using effective credentials and the bound directory, including ACLs.
    // No named probe is created or unlinked, and permissions are never changed.
    if unsafe {
        libc::faccessat(
            directory.as_raw_fd(),
            c".".as_ptr(),
            libc::W_OK | libc::X_OK,
            libc::AT_EACCESS,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) use windows::{create_private, verify_private};
#[cfg(windows)]
pub(super) use windows::{user_key, verify_writable};

#[cfg(all(test, windows))]
pub(super) use windows::create_read_only_for_test;

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{
        ffi::c_void,
        mem::size_of,
        os::windows::{
            ffi::OsStrExt,
            io::{AsRawHandle, FromRawHandle, OwnedHandle},
        },
        ptr::null_mut,
    };
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{Authorization::*, *},
        Storage::FileSystem::{
            CreateDirectoryW, FILE_ADD_FILE, FILE_ALL_ACCESS, FILE_FLAG_BACKUP_SEMANTICS,
            FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
            FILE_TRAVERSE,
        },
        System::{
            SystemServices::ACCESS_ALLOWED_ACE_TYPE,
            Threading::{GetCurrentProcess, OpenProcessToken},
        },
    };

    struct LocalAllocation(*mut c_void);
    impl Drop for LocalAllocation {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }

    struct User(Vec<usize>);
    impl User {
        fn current() -> io::Result<Self> {
            let mut token = null_mut();
            if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
                return Err(io::Error::last_os_error());
            }
            let token = unsafe { OwnedHandle::from_raw_handle(token) };
            let mut size = 0;
            unsafe {
                GetTokenInformation(token.as_raw_handle(), TokenUser, null_mut(), 0, &mut size);
            }
            if size == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut data = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
            if unsafe {
                GetTokenInformation(
                    token.as_raw_handle(),
                    TokenUser,
                    data.as_mut_ptr().cast(),
                    size,
                    &mut size,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(data))
        }
        fn sid(&self) -> PSID {
            unsafe { (*(self.0.as_ptr().cast::<TOKEN_USER>())).User.Sid }
        }
        fn text(&self) -> io::Result<String> {
            let mut value = null_mut();
            if unsafe { ConvertSidToStringSidW(self.sid(), &mut value) } == 0 {
                return Err(io::Error::last_os_error());
            }
            let _allocation = LocalAllocation(value.cast());
            let mut length = 0;
            unsafe {
                while *value.add(length) != 0 {
                    length += 1;
                }
            }
            Ok(String::from_utf16_lossy(unsafe {
                std::slice::from_raw_parts(value, length)
            }))
        }
    }

    pub(crate) fn user_key() -> io::Result<String> {
        User::current()?.text()
    }

    pub(crate) fn verify_writable(directory: &Dir) -> io::Result<()> {
        use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsMaybeDirExt};
        use cap_std::fs::{OpenOptions, OpenOptionsExt};
        // Request directory-add rights through the existing capability. No creation,
        // truncation, deletion, or ambient directory pathname is involved.
        let mut options = OpenOptions::new();
        options
            .read(true)
            .maybe_dir(true)
            .follow(FollowSymlinks::No)
            .access_mode(FILE_ADD_FILE | FILE_TRAVERSE | FILE_READ_ATTRIBUTES)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS);
        let checked = directory.open_with(".", &options)?;
        let identity = same_file::Handle::from_file(directory.try_clone()?.into_std_file())?;
        if same_file::Handle::from_file(checked.into_std())? != identity {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "The directory write-access capability changed identity.",
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn create_read_only_for_test(path: &Path) -> io::Result<()> {
        let sid = User::current()?.text()?;
        let descriptor: Vec<u16> = format!("O:{sid}D:P(A;OICI;FRFX;;;{sid})")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut descriptor_ptr = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                descriptor.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor_ptr,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let _allocation = LocalAllocation(descriptor_ptr);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor_ptr,
            bInheritHandle: 0,
        };
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { CreateDirectoryW(path.as_ptr(), &attributes) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub(crate) fn create_private(
        _parent: &Dir,
        parent_path: &Path,
        name: &str,
    ) -> io::Result<bool> {
        // The DACL is supplied at creation, never retrofitted onto a raced/pre-existing directory.
        // The caller checks the bound parent's identity before accepting the result.
        let sid = User::current()?.text()?;
        let descriptor: Vec<u16> = format!("O:{sid}D:P(A;OICI;FA;;;{sid})")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut descriptor_ptr = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                descriptor.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor_ptr,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let _allocation = LocalAllocation(descriptor_ptr);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor_ptr,
            bInheritHandle: 0,
        };
        let path: Vec<u16> = parent_path
            .join(name)
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        if unsafe { CreateDirectoryW(path.as_ptr(), &attributes) } == 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
            return Ok(false);
        }
        Ok(true)
    }

    pub(crate) fn verify_private(directory: &Dir) -> io::Result<()> {
        let user = User::current()?;
        let mut owner = null_mut();
        let mut dacl = null_mut();
        let mut descriptor = null_mut();
        let result = unsafe {
            GetSecurityInfo(
                directory.as_raw_handle(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                &mut dacl,
                null_mut(),
                &mut descriptor,
            )
        };
        if result != 0 {
            return Err(io::Error::from_raw_os_error(result as i32));
        }
        let _allocation = LocalAllocation(descriptor);
        let invalid =
            || {
                io::Error::new(io::ErrorKind::PermissionDenied,
            "Recovery vault requires current-user ownership and a protected owner-only DACL.")
            };
        let mut control = 0;
        let mut revision = 0;
        if owner.is_null()
            || dacl.is_null()
            || unsafe { EqualSid(owner, user.sid()) } == 0
            || unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0
            || control & SE_DACL_PROTECTED == 0
            || unsafe { (*dacl).AceCount } != 1
        {
            return Err(invalid());
        }
        let mut ace = null_mut();
        if unsafe { GetAce(dacl, 0, &mut ace) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let header = unsafe { &*(ace.cast::<ACE_HEADER>()) };
        if header.AceType != ACCESS_ALLOWED_ACE_TYPE as u8
            || (header.AceSize as usize) < size_of::<ACCESS_ALLOWED_ACE>()
        {
            return Err(invalid());
        }
        let ace = unsafe { &*(ace.cast::<ACCESS_ALLOWED_ACE>()) };
        let sid = (&ace.SidStart as *const u32).cast_mut().cast();
        if ace.Header.AceType != ACCESS_ALLOWED_ACE_TYPE as u8
            || ace.Header.AceFlags != (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8
            || ace.Mask != FILE_ALL_ACCESS
            || unsafe { EqualSid(sid, user.sid()) } == 0
        {
            return Err(invalid());
        }
        Ok(())
    }
}
