//! Automatic reads must not activate repository-configured clean/process filters.
use super::runner::{run_read, ReadOperation};
use super::{GitError, GitResult};
use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;
fn unsupported() -> GitError {
    GitError::new("git_status_filter_unsupported", "Automatic Git status and working-tree diffs are unavailable because executable clean/process filters apply to workspace files. Raw package preparation and versioning remain available.")
}
pub(super) fn prepare(root: &Path, command: &mut Command) -> GitResult<()> {
    let config = run_read(root, ReadOperation::FilterNames)?;
    // git config returns 1 for no matching key; other failures must not permit
    // an unguarded status. The runner exposes this distinction without text parsing.
    if !config.success() && config.exit_code() != Some(1) {
        return Err(unsupported());
    }
    let mut drivers = BTreeSet::new();
    for key in config
        .stdout
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
    {
        let key = std::str::from_utf8(key).map_err(|_| unsupported())?;
        let key = key.strip_prefix("filter.").ok_or_else(unsupported)?;
        let (name, _) = key.rsplit_once('.').ok_or_else(unsupported)?;
        drivers.insert(name.to_owned());
    }
    let listing = run_read(root, ReadOperation::FilterPaths)?;
    super::ensure_success("git_status_failed", &listing)?;
    let mut paths = BTreeSet::new();
    for record in listing
        .stdout
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
    {
        let record = std::str::from_utf8(record).map_err(|_| unsupported())?;
        let path = if let Some((metadata, path)) = record.split_once('\t') {
            let fields: Vec<_> = metadata.split(' ').collect();
            if fields.len() == 3
                && fields[0].len() == 6
                && fields[0].bytes().all(|byte| byte.is_ascii_digit())
            {
                if fields[0] == "160000" {
                    return Err(GitError::new(
                        "git_status_submodule_unsupported",
                        "Automatic status cannot safely run configured filters inside submodules.",
                    ));
                }
                path
            } else {
                record
            }
        } else {
            record
        };
        paths.insert(path.to_owned());
    }
    let mut batch = Vec::new();
    let mut size = 0;
    for path in &paths {
        if size + path.len() > 4096 && !batch.is_empty() {
            check(root, &batch, &drivers)?;
            batch.clear();
            size = 0;
        }
        batch.push(path.as_str());
        size += path.len();
    }
    if !batch.is_empty() && !drivers.is_empty() {
        check(root, &batch, &drivers)?;
    }
    // An attribute edit after the probe cannot activate an already configured
    // driver: neutralize each discovered driver for this process as well.
    command.env("GIT_CONFIG_COUNT", (drivers.len() * 3).to_string());
    for (index, driver) in drivers.iter().enumerate() {
        for (offset, (name, value)) in [("clean", ""), ("process", ""), ("required", "false")]
            .iter()
            .enumerate()
        {
            let position = index * 3 + offset;
            command.env(
                format!("GIT_CONFIG_KEY_{position}"),
                format!("filter.{driver}.{name}"),
            );
            command.env(format!("GIT_CONFIG_VALUE_{position}"), value);
        }
    }
    Ok(())
}
fn check(root: &Path, paths: &[&str], drivers: &BTreeSet<String>) -> GitResult<()> {
    let attributes = run_read(root, ReadOperation::FilterAttributes { paths })?;
    super::ensure_success("git_status_failed", &attributes)?;
    let parts: Vec<_> = attributes.stdout.split(|byte| *byte == 0).collect();
    if parts.last() != Some(&&b""[..]) || (parts.len() - 1) % 3 != 0 {
        return Err(unsupported());
    }
    for record in parts[..parts.len() - 1].chunks_exact(3) {
        let value = std::str::from_utf8(record[2]).map_err(|_| unsupported())?;
        if drivers.contains(value) {
            return Err(unsupported());
        }
    }
    Ok(())
}
