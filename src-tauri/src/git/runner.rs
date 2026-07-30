use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::os::windows::process::CommandExt as WindowsCommandExt;
use wait_timeout::ChildExt;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, TerminateJobObject,
};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    OpenThread, ResumeThread, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
};

use super::{GitError, GitResult};

const MAX_OUTPUT_BYTES: usize = 5 * 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(10);
const MUTATION_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) enum ReadOperation<'a> {
    RepositoryRoot,
    GitDirectory,
    GitCommonDirectory,
    Branch,
    HeadReference,
    ShortHead,
    FullHead,
    Status,
    #[cfg(test)]
    Diff {
        cached: bool,
        paths: &'a [&'a str],
    },
    HeadDiff {
        base: &'a str,
        paths: &'a [&'a str],
    },
    EmptyTree,
    UntrackedDiff {
        path: &'a str,
    },
    History {
        follow: bool,
        paths: &'a [&'a str],
    },
    Show {
        oid: &'a str,
        path: &'a str,
    },
    LocalConfig {
        key: &'a str,
    },
    PairStatus {
        paths: &'a [&'a str],
    },
    IsTracked {
        path: &'a str,
    },
    ResolveRef {
        reference: &'a str,
    },
    HashFile {
        path: &'a str,
    },
    TreeEntry {
        tree: &'a str,
        path: &'a str,
    },
}

pub(crate) enum MutationOperation<'a> {
    Init {
        workspace_root: &'a Path,
    },
    SetLocalConfig {
        key: &'a str,
        value: &'a str,
    },
    ReadTree {
        tree: &'a str,
    },
    AddAll {
        paths: &'a [&'a str],
    },
    WriteTree,
    RunHook {
        name: &'a str,
        message_file: Option<&'a Path>,
        source: Option<&'a str>,
    },
    CommitTree {
        tree: &'a str,
        parent: Option<&'a str>,
        message_file: &'a Path,
    },
    UpdateRef {
        reference: &'a str,
        new_oid: &'a str,
        old_oid: &'a str,
    },
    Move {
        source: &'a str,
        destination: &'a str,
    },
}

#[derive(Debug)]
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
    run_command(build_read_command(root, operation), READ_TIMEOUT, None)
}

pub(crate) fn run_mutation(
    root: &Path,
    operation: MutationOperation<'_>,
) -> GitResult<CommandOutput> {
    run_command(
        build_mutation_command(root, operation),
        MUTATION_TIMEOUT,
        None,
    )
}

pub(crate) fn run_mutation_with_index(
    root: &Path,
    operation: MutationOperation<'_>,
    index_path: &Path,
) -> GitResult<CommandOutput> {
    let mut command = build_mutation_command(root, operation);
    command
        .env("GIT_INDEX_FILE", index_path)
        .env("GIT_EDITOR", ":");
    run_command(command, MUTATION_TIMEOUT, None)
}

fn run_command(
    mut command: Command,
    timeout: Duration,
    #[cfg_attr(not(test), allow(unused_variables))] injected: Option<InjectedFailure>,
) -> GitResult<CommandOutput> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(CREATE_SUSPENDED);

    let started = Instant::now();
    let mut child = command.spawn().map_err(|_| {
        GitError::new(
            "git_unavailable",
            "The system Git executable could not be started.",
        )
    })?;
    #[cfg(unix)]
    let process_tree = ProcessTree::new(child.id());
    #[cfg(windows)]
    let process_tree = match ProcessTree::contain(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let total = Arc::new(AtomicUsize::new(0));
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout_receiver = spawn_reader(stdout, total.clone(), overflow.clone());
    let stderr_receiver = spawn_reader(stderr, total, overflow.clone());

    #[cfg(test)]
    if injected == Some(InjectedFailure::Read) {
        process_tree.terminate(&mut child);
        return Err(GitError::new(
            "git_read_failed",
            "Git stdout could not be read.",
        ));
    }

    let remaining = timeout.saturating_sub(started.elapsed());
    #[cfg(test)]
    let waited = if injected == Some(InjectedFailure::Wait) {
        Err(std::io::Error::other("injected wait failure"))
    } else {
        child.wait_timeout(remaining)
    };
    #[cfg(not(test))]
    let waited = child.wait_timeout(remaining);
    let status = match waited {
        Ok(Some(status)) => status,
        Ok(None) => {
            process_tree.terminate(&mut child);
            return Err(GitError::new(
                "git_timeout",
                "The local Git read operation exceeded 10 seconds.",
            ));
        }
        Err(_) => {
            process_tree.terminate(&mut child);
            return Err(GitError::new(
                "git_wait_failed",
                "The local Git command could not be monitored.",
            ));
        }
    };

    let stdout = receive_reader(&stdout_receiver, started, timeout).map_err(|error| {
        process_tree.terminate(&mut child);
        error
    })?;
    let stderr = receive_reader(&stderr_receiver, started, timeout).map_err(|error| {
        process_tree.terminate(&mut child);
        error
    })?;
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

fn receive_reader(
    receiver: &mpsc::Receiver<std::io::Result<Vec<u8>>>,
    started: Instant,
    timeout: Duration,
) -> GitResult<Vec<u8>> {
    let remaining = timeout.saturating_sub(started.elapsed());
    match receiver.recv_timeout(remaining) {
        Ok(Ok(bytes)) => Ok(bytes),
        Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Disconnected) => Err(GitError::new(
            "git_read_failed",
            "Git output could not be read.",
        )),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(GitError::new(
            "git_timeout",
            "The local Git read operation exceeded 10 seconds.",
        )),
    }
}

fn spawn_reader(
    reader: impl Read + Send + 'static,
    total: Arc<AtomicUsize>,
    overflow: Arc<AtomicBool>,
) -> mpsc::Receiver<std::io::Result<Vec<u8>>> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = sender.send(read_bounded(reader, total, overflow));
    });
    receiver
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

#[cfg(unix)]
struct ProcessTree {
    process_group: u32,
}

#[cfg(unix)]
impl ProcessTree {
    fn new(process_group: u32) -> Self {
        Self { process_group }
    }

    fn terminate(&self, child: &mut std::process::Child) {
        unsafe {
            libc::kill(-(self.process_group as i32), libc::SIGKILL);
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(windows)]
struct ProcessTree(HANDLE);

#[cfg(windows)]
impl ProcessTree {
    fn contain(child: &std::process::Child) -> GitResult<Self> {
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(process_containment_error("create a process job"));
        }
        let tree = Self(job);
        if unsafe { AssignProcessToJobObject(tree.0, child.as_raw_handle() as HANDLE) } == 0 {
            return Err(process_containment_error("assign Git to its process job"));
        }
        let thread = primary_thread_for(child.id())?;
        if unsafe { ResumeThread(thread) } == u32::MAX {
            unsafe { CloseHandle(thread) };
            return Err(process_containment_error("resume contained Git"));
        }
        unsafe { CloseHandle(thread) };
        Ok(tree)
    }

    fn terminate(&self, child: &mut std::process::Child) {
        unsafe {
            let _ = TerminateJobObject(self.0, 1);
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(windows)]
fn process_containment_error(action: &str) -> GitError {
    GitError::new(
        "git_unavailable",
        format!("Could not {action}: {}", std::io::Error::last_os_error()),
    )
}

#[cfg(windows)]
fn primary_thread_for(process_id: u32) -> GitResult<HANDLE> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot.is_null() || snapshot as isize == -1 {
        return Err(process_containment_error("enumerate suspended Git threads"));
    }
    let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
    let mut found = None;
    if unsafe { Thread32First(snapshot, &mut entry) } != 0 {
        loop {
            if entry.th32OwnerProcessID == process_id {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if !thread.is_null() {
                    found = Some(thread);
                    break;
                }
            }
            if unsafe { Thread32Next(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }
    unsafe { CloseHandle(snapshot) };
    found.ok_or_else(|| process_containment_error("open the suspended Git primary thread"))
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
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_COMMITTER_DATE",
        "EMAIL",
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

fn build_mutation_command(root: &Path, operation: MutationOperation<'_>) -> Command {
    let mut command = Command::new("git");
    command.arg("--literal-pathspecs");
    match operation {
        MutationOperation::Init { workspace_root } => {
            command.arg("init").arg(workspace_root);
        }
        operation => {
            command
                .arg("-C")
                .arg(root)
                .args(mutation_arguments(operation));
        }
    }
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
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_COMMITTER_DATE",
        "EMAIL",
        "EDITOR",
        "VISUAL",
    ] {
        command.env_remove(key);
    }
    command
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    command
}

fn arguments(operation: ReadOperation<'_>) -> Vec<OsString> {
    match operation {
        ReadOperation::RepositoryRoot => strings(&["rev-parse", "--show-toplevel"]),
        ReadOperation::GitDirectory => strings(&["rev-parse", "--absolute-git-dir"]),
        ReadOperation::GitCommonDirectory => {
            strings(&["rev-parse", "--path-format=absolute", "--git-common-dir"])
        }
        ReadOperation::Branch => strings(&["symbolic-ref", "--quiet", "--short", "HEAD"]),
        ReadOperation::HeadReference => strings(&["symbolic-ref", "--quiet", "HEAD"]),
        ReadOperation::ShortHead => strings(&["rev-parse", "--short=12", "HEAD"]),
        ReadOperation::FullHead => strings(&["rev-parse", "HEAD"]),
        ReadOperation::Status => {
            strings(&["status", "--porcelain=v2", "-z", "--untracked-files=all"])
        }
        #[cfg(test)]
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
        ReadOperation::HeadDiff { base, paths } => {
            let mut values = strings(&[
                "diff",
                base,
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--",
            ]);
            values.extend(paths.iter().map(OsString::from));
            values
        }
        ReadOperation::EmptyTree => strings(&["hash-object", "-t", "tree", "--stdin"]),
        ReadOperation::UntrackedDiff { path } => {
            let mut values = strings(&[
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--",
                "/dev/null",
            ]);
            values.push(path.into());
            values
        }
        ReadOperation::History { follow, paths } => {
            let mut values = strings(&["log"]);
            if follow {
                values.push("--follow".into());
            }
            values.extend(strings(&[
                "--format=%x00C%x00%H%x00%h%x00%an%x00%at%x00%aI%x00%s%x00",
                "--name-status",
                "-z",
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
        ReadOperation::LocalConfig { key } => {
            let mut values = strings(&["config", "--local", "--get"]);
            values.push(key.into());
            values
        }
        ReadOperation::PairStatus { paths } => {
            let mut values = strings(&[
                "status",
                "--porcelain=v2",
                "-z",
                "--untracked-files=all",
                "--",
            ]);
            values.extend(paths.iter().map(OsString::from));
            values
        }
        ReadOperation::IsTracked { path } => {
            let mut values = strings(&["ls-files", "--error-unmatch", "--"]);
            values.push(path.into());
            values
        }
        ReadOperation::ResolveRef { reference } => {
            let mut values = strings(&["rev-parse", "--verify"]);
            values.push(reference.into());
            values
        }
        ReadOperation::HashFile { path } => {
            let mut values = strings(&["hash-object", "--no-filters", "--"]);
            values.push(path.into());
            values
        }
        ReadOperation::TreeEntry { tree, path } => {
            let mut values = strings(&["ls-tree", "-z"]);
            values.push(tree.into());
            values.push("--".into());
            values.push(path.into());
            values
        }
    }
}

fn mutation_arguments(operation: MutationOperation<'_>) -> Vec<OsString> {
    match operation {
        MutationOperation::Init { .. } => unreachable!("init does not use -C arguments"),
        MutationOperation::SetLocalConfig { key, value } => {
            let mut values = strings(&["config", "--local"]);
            values.extend([OsString::from(key), OsString::from(value)]);
            values
        }
        MutationOperation::ReadTree { tree } => {
            let mut values = strings(&["read-tree"]);
            values.push(tree.into());
            values
        }
        MutationOperation::AddAll { paths } => {
            let mut values = strings(&["add", "--all", "--"]);
            values.extend(paths.iter().map(OsString::from));
            values
        }
        MutationOperation::WriteTree => strings(&["write-tree"]),
        MutationOperation::RunHook {
            name,
            message_file,
            source,
        } => {
            let mut values = strings(&["hook", "run", "--ignore-missing"]);
            values.push(name.into());
            if let Some(message_file) = message_file {
                values.push("--".into());
                values.push(message_file.as_os_str().into());
                if let Some(source) = source {
                    values.push(source.into());
                }
            }
            values
        }
        MutationOperation::CommitTree {
            tree,
            parent,
            message_file,
        } => {
            let mut values = strings(&["commit-tree"]);
            values.push(tree.into());
            if let Some(parent) = parent {
                values.push("-p".into());
                values.push(parent.into());
            }
            values.push("-F".into());
            values.push(message_file.as_os_str().into());
            values
        }
        MutationOperation::UpdateRef {
            reference,
            new_oid,
            old_oid,
        } => {
            let mut values = strings(&["update-ref"]);
            values.extend([
                OsString::from(reference),
                OsString::from(new_oid),
                OsString::from(old_oid),
            ]);
            values
        }
        MutationOperation::Move {
            source,
            destination,
        } => {
            let mut values = strings(&["mv", "--"]);
            values.extend([OsString::from(source), OsString::from(destination)]);
            values
        }
    }
}

fn strings(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) enum InjectedFailure {
    Wait,
    Read,
}

#[cfg(test)]
pub(crate) fn run_command_for_test(
    command: Command,
    timeout: Duration,
) -> GitResult<CommandOutput> {
    run_command(command, timeout, None)
}

#[cfg(test)]
pub(crate) fn run_command_with_failure_for_test(
    command: Command,
    timeout: Duration,
    failure: InjectedFailure,
) -> GitResult<CommandOutput> {
    run_command(command, timeout, Some(failure))
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
