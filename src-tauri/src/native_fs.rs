use std::io;

use cap_std::fs::Dir;

pub(crate) fn sync_capability_directory(directory: &Dir) -> io::Result<()> {
    directory.open(".")?.sync_all()
}
