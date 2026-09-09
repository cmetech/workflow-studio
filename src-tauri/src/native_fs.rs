use std::io;

use cap_std::fs::Dir;

#[cfg(windows)]
use cap_std::fs::File;

pub(crate) fn sync_capability_directory(directory: &Dir) -> io::Result<()> {
    directory.open(".")?.sync_all()
}

#[cfg(windows)]
#[repr(C)]
struct RelativeRenameInfo<const TARGET_LENGTH: usize> {
    anonymous: windows_sys::Win32::Storage::FileSystem::FILE_RENAME_INFO_0,
    root_directory: windows_sys::Win32::Foundation::HANDLE,
    file_name_length: u32,
    file_name: [u16; TARGET_LENGTH],
}

#[cfg(windows)]
pub(crate) fn replace_file_in_capability_directory<const TARGET_LENGTH: usize>(
    directory: &Dir,
    source: &File,
    target_name: &str,
) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{FileRenameInfo, SetFileInformationByHandle};

    let encoded = target_name.encode_utf16().collect::<Vec<_>>();
    if encoded.len() != TARGET_LENGTH || TARGET_LENGTH == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the bound replacement name has an invalid UTF-16 length",
        ));
    }
    let mut file_name = [0_u16; TARGET_LENGTH];
    file_name.copy_from_slice(&encoded);
    let file_name_length = TARGET_LENGTH
        .checked_mul(std::mem::size_of::<u16>())
        .and_then(|length| u32::try_from(length).ok())
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "replacement name is too long")
        })?;
    let rename = RelativeRenameInfo {
        anonymous: windows_sys::Win32::Storage::FileSystem::FILE_RENAME_INFO_0 {
            ReplaceIfExists: 1,
        },
        root_directory: directory.as_raw_handle(),
        file_name_length,
        file_name,
    };
    let buffer_size = std::mem::offset_of!(RelativeRenameInfo<TARGET_LENGTH>, file_name)
        .checked_add(file_name_length as usize)
        .and_then(|length| u32::try_from(length).ok())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "replacement information is too large",
            )
        })?;
    let replaced = unsafe {
        SetFileInformationByHandle(
            source.as_raw_handle(),
            FileRenameInfo,
            std::ptr::addr_of!(rename).cast(),
            buffer_size,
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
