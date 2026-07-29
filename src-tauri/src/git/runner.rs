use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use wait_timeout::ChildExt;

use super::{GitError, GitResult};

const MAX_OUTPUT_BYTES: usize = 5 * 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) enum ReadOperation<'a> {
    RepositoryRoot,
    Branch,
    ShortHead,
    Status,
    Diff { cached: bool, paths: &'a [&'a str] },
    History { follow: bool, paths: &'a [&'a str] },
    Show { oid: &'a str, path: &'a str },
}

pub(crate) struct CommandOutput {
    status: ExitStatus,
    pub(crate) stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl CommandOutput {
    pub(crate) fn success(&self) -> bool {
        self.status.success()
    }

    pub(crate) fn stderr_text(&self) -> String {
        String::from_utf8_lossy(&self.stderr).trim().to_owned()
    }
}

pub(crate) fn run_read(root: &Path, operation: ReadOperation<'_>) -> GitResult<CommandOutput> {
    let mut command = build_read_command(root, operation);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|_| {
        GitError::new(
            "git_unavailable",
            "The system Git executable could not be started.",
        )
    })?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let total = Arc::new(AtomicUsize::new(0));
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout_reader = spawn_reader(stdout, total.clone(), overflow.clone());
    let stderr_reader = spawn_reader(stderr, total, overflow.clone());

    let status = match child.wait_timeout(READ_TIMEOUT).map_err(|_| {
        GitError::new(
            "git_wait_failed",
            "The local Git command could not be monitored.",
        )
    })? {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(GitError::new(
                "git_timeout",
                "The local Git read operation exceeded 10 seconds.",
            ));
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| GitError::new("git_read_failed", "Git stdout capture failed."))?
        .map_err(|_| GitError::new("git_read_failed", "Git stdout could not be read."))?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| GitError::new("git_read_failed", "Git stderr capture failed."))?
        .map_err(|_| GitError::new("git_read_failed", "Git stderr could not be read."))?;
    if overflow.load(Ordering::Relaxed) {
        return Err(GitError::new(
            "git_output_too_large",
            "Git output exceeded the 5 MiB safety limit.",
        ));
    }
    Ok(CommandOutput {
        status,
        stdout,
        stderr,
    })
}

pub(crate) fn build_read_command(root: &Path, operation: ReadOperation<'_>) -> Command {
    let mut command = Command::new("git");
    command
        .arg("--literal-pathspecs")
        .args(["-c", "core.fsmonitor=false"])
        .args(["-c", "core.untrackedCache=false"])
        .arg("-C")
        .arg(root)
        .args(arguments(operation));
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_COMMON_DIR",
        "GIT_CEILING_DIRECTORIES",
        "GIT_DISCOVERY_ACROSS_FILESYSTEM",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS",
        "GIT_EDITOR",
        "GIT_SEQUENCE_EDITOR",
        "GIT_EXTERNAL_DIFF",
        "GIT_PAGER",
        "GIT_OPTIONAL_LOCKS",
        "EDITOR",
        "VISUAL",
    ] {
        command.env_remove(key);
    }
    command
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C");
    command
}

fn spawn_reader(
    reader: impl Read + Send + 'static,
    total: Arc<AtomicUsize>,
    overflow: Arc<AtomicBool>,
) -> thread::JoinHandle<std::io::Result<Vec<u8>>> {
    thread::spawn(move || read_bounded(reader, total, overflow))
}

fn read_bounded(
    mut reader: impl Read,
    total: Arc<AtomicUsize>,
    overflow: Arc<AtomicBool>,
) -> std::io::Result<Vec<u8>> {
    let mut captured = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let before = total.fetch_add(count, Ordering::Relaxed);
        if before < MAX_OUTPUT_BYTES {
            let retain = count.min(MAX_OUTPUT_BYTES - before);
            captured.extend_from_slice(&buffer[..retain]);
        }
        if before.saturating_add(count) > MAX_OUTPUT_BYTES {
            overflow.store(true, Ordering::Relaxed);
        }
    }
    Ok(captured)
}

#[cfg(test)]
pub(crate) fn read_for_test(reader: impl Read) -> GitResult<Vec<u8>> {
    read_bounded(
        reader,
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicBool::new(false)),
    )
    .map_err(|_| GitError::new("git_read_failed", "Git output could not be read."))
}

fn arguments(operation: ReadOperation<'_>) -> Vec<OsString> {
    match operation {
        ReadOperation::RepositoryRoot => strings(&["rev-parse", "--show-toplevel"]),
        ReadOperation::Branch => strings(&["symbolic-ref", "--quiet", "--short", "HEAD"]),
        ReadOperation::ShortHead => strings(&["rev-parse", "--short=12", "HEAD"]),
        ReadOperation::Status => {
            strings(&["status", "--porcelain=v2", "-z", "--untracked-files=all"])
        }
        ReadOperation::Diff { cached, paths } => {
            let mut values = strings(&["diff"]);
            if cached {
                values.push("--cached".into());
            }
            values.extend(strings(&[
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--",
            ]));
            values.extend(paths.iter().map(OsString::from));
            values
        }
        ReadOperation::History { follow, paths } => {
            let mut values = strings(&["log"]);
            if follow {
                values.push("--follow".into());
            }
            values.extend(strings(&[
                "--format=%x00%H%x00%h%x00%an%x00%aI%x00%s%x00",
                "--",
            ]));
            values.extend(paths.iter().map(OsString::from));
            values
        }
        ReadOperation::Show { oid, path } => {
            let mut values = strings(&["show", "--no-ext-diff", "--no-color"]);
            values.push(format!("{oid}:{path}").into());
            values
        }
    }
}

fn strings(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}
