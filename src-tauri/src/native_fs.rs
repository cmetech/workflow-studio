use std::io;

use cap_std::fs::Dir;

#[cfg(windows)]
use cap_std::fs::File;

pub(crate) fn sync_capability_directory(directory: &Dir) -> io::Result<()> {
    directory.open(".")?.sync_all()
}

#[cfg(windows)]
pub(crate) fn replace_file_in_capability_directory(
    directory: &Dir,
    source: &File,
    target_name: &str,
) -> io::Result<()> {
    use std::mem::{align_of, offset_of, size_of};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileRenameInfo, GetFinalPathNameByHandleW, SetFileInformationByHandle,
        FILE_NAME_NORMALIZED, FILE_RENAME_INFO, FILE_RENAME_INFO_0, VOLUME_NAME_DOS,
    };

    if target_name.is_empty()
        || target_name
            .bytes()
            .any(|byte| matches!(byte, b'\\' | b'/' | b':' | 0))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the bound replacement name is invalid",
        ));
    }

    let required = unsafe {
        GetFinalPathNameByHandleW(
            directory.as_raw_handle(),
            std::ptr::null_mut(),
            0,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    };
    if required == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut directory_name = vec![0_u16; required as usize];
    let written = unsafe {
        GetFinalPathNameByHandleW(
            directory.as_raw_handle(),
            directory_name.as_mut_ptr(),
            required,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    };
    if written == 0 {
        return Err(io::Error::last_os_error());
    }
    if written >= required {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "the bound directory path changed while it was inspected",
        ));
    }
    directory_name.truncate(written as usize);
    if !directory_name.ends_with(&[b'\\' as u16]) {
        directory_name.push(b'\\' as u16);
    }
    directory_name.extend(target_name.encode_utf16());
    directory_name.push(0);

    let file_name_length = directory_name
        .len()
        .checked_sub(1)
        .and_then(|length| length.checked_mul(size_of::<u16>()))
        .and_then(|length| u32::try_from(length).ok())
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "replacement name is too long")
        })?;
    let buffer_size = offset_of!(FILE_RENAME_INFO, FileName)
        .checked_add(file_name_length as usize)
        .and_then(|length| length.checked_add(size_of::<u16>()))
        .and_then(|length| u32::try_from(length).ok())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "replacement information is too large",
            )
        })?;
    let storage_words = (buffer_size as usize).div_ceil(size_of::<usize>());
    let mut storage = vec![0_usize; storage_words];
    debug_assert!(align_of::<usize>() >= align_of::<FILE_RENAME_INFO>());
    let rename = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    unsafe {
        std::ptr::addr_of_mut!((*rename).Anonymous)
            .write(FILE_RENAME_INFO_0 { ReplaceIfExists: 1 });
        std::ptr::addr_of_mut!((*rename).RootDirectory).write(std::ptr::null_mut());
        std::ptr::addr_of_mut!((*rename).FileNameLength).write(file_name_length);
        directory_name.as_ptr().copy_to_nonoverlapping(
            std::ptr::addr_of_mut!((*rename).FileName).cast::<u16>(),
            directory_name.len(),
        );
    }
    let replaced = unsafe {
        SetFileInformationByHandle(
            source.as_raw_handle(),
            FileRenameInfo,
            rename.cast(),
            buffer_size,
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
