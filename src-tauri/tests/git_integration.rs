use std::fs;
#[cfg(unix)]
use std::io::Write;
use std::path::Path;
#[cfg(unix)]
use std::process::Stdio;
use std::process::{Command, Output};
use std::sync::Mutex;

use tempfile::tempdir;
use workflow_studio_lib::git::{
    create_pair_version, init_repository, move_tracked_path, set_local_identity, GitError,
};

static ENVIRONMENT: Mutex<()> = Mutex::new(());

fn git(root: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git must be installed for integration tests")
}

fn assert_git(root: &Path, args: &[&str]) -> String {
    let output = git(root, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

#[cfg(unix)]
fn write_blob(root: &Path, bytes: &[u8]) -> String {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["hash-object", "-w", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(bytes).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn repository() -> tempfile::TempDir {
    let root = tempdir().unwrap();
    assert_git(root.path(), &["init", "-b", "main"]);
    assert_git(
        root.path(),
        &["config", "--local", "user.name", "Fixture User"],
    );
    assert_git(
        root.path(),
        &["config", "--local", "user.email", "fixture@example.test"],
    );
    root
}

fn write_pair(root: &Path) {
    fs::write(
        root.join("flow.yaml"),
        "name: Flow\ndescription: one\nnodes: []\n",
    )
    .unwrap();
    fs::write(
        root.join("flow.hermes.yaml"),
        "language_compatibility: hermes-legacy\n",
    )
    .unwrap();
}

fn assert_code<T>(result: Result<T, GitError>, code: &str) {
    assert_eq!(result.err().expect("expected error").code, code);
}

#[test]
fn initializes_only_the_exact_requested_root_without_creating_a_commit() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = tempdir().unwrap();
    let repository = init_repository(root.path()).unwrap();

    assert_eq!(
        Path::new(&repository.root),
        root.path().canonicalize().unwrap()
    );
    assert!(root.path().join(".git").is_dir());
    assert!(!git(root.path(), &["rev-parse", "--verify", "HEAD"])
        .status
        .success());
}

#[test]
fn writes_identity_to_the_repository_only() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = tempdir().unwrap();
    assert_git(root.path(), &["init", "-b", "main"]);

    set_local_identity(root.path(), "Local User", "local@example.test").unwrap();

    assert_eq!(
        assert_git(root.path(), &["config", "--local", "user.name"]).trim(),
        "Local User"
    );
    assert_eq!(
        assert_git(root.path(), &["config", "--local", "user.email"]).trim(),
        "local@example.test"
    );
}

#[test]
fn commits_a_tracked_pair_and_returns_the_new_oid() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    assert_git(root.path(), &["add", "flow.yaml", "flow.hermes.yaml"]);
    assert_git(root.path(), &["commit", "-m", "initial"]);
    fs::write(
        root.path().join("flow.yaml"),
        "name: Flow\ndescription: changed\nnodes: []\n",
    )
    .unwrap();

    let version = create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "pair version",
    )
    .unwrap();

    assert_eq!(
        version.committed_oid().expect("version must be committed"),
        assert_git(root.path(), &["rev-parse", "HEAD"]).trim()
    );
    assert_eq!(
        assert_git(root.path(), &["show", "-s", "--format=%s", "HEAD"]).trim(),
        "pair version"
    );
}

#[test]
fn commits_untracked_literal_unicode_pair_paths() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    fs::write(root.path().join("flow space ☃.yaml"), "name: Snow\n").unwrap();
    fs::write(
        root.path().join("flow space ☃.hermes.yaml"),
        "profile: legacy\n",
    )
    .unwrap();

    create_pair_version(
        root.path(),
        "flow space ☃.yaml",
        Some("flow space ☃.hermes.yaml"),
        "unicode pair",
    )
    .unwrap();

    let names = assert_git(
        root.path(),
        &[
            "-c",
            "core.quotePath=false",
            "show",
            "--pretty=",
            "--name-only",
            "HEAD",
        ],
    );
    assert!(names.contains("flow space ☃.yaml"));
    assert!(names.contains("flow space ☃.hermes.yaml"));
}

#[test]
fn records_a_deleted_companion() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    assert_git(root.path(), &["add", "."]);
    assert_git(root.path(), &["commit", "-m", "initial"]);
    fs::remove_file(root.path().join("flow.hermes.yaml")).unwrap();

    create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "remove companion",
    )
    .unwrap();

    assert!(
        !git(root.path(), &["cat-file", "-e", "HEAD:flow.hermes.yaml"])
            .status
            .success()
    );
}

#[test]
fn preserves_unrelated_staged_unstaged_and_untracked_work() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    fs::write(root.path().join("staged.txt"), "base\n").unwrap();
    fs::write(root.path().join("unstaged.txt"), "base\n").unwrap();
    assert_git(root.path(), &["add", "."]);
    assert_git(root.path(), &["commit", "-m", "initial"]);

    fs::write(
        root.path().join("flow.yaml"),
        "name: Flow\ndescription: changed\nnodes: []\n",
    )
    .unwrap();
    fs::write(root.path().join("staged.txt"), "staged change\n").unwrap();
    assert_git(root.path(), &["add", "staged.txt"]);
    fs::write(root.path().join("unstaged.txt"), "unstaged change\n").unwrap();
    fs::write(root.path().join("untracked.txt"), "untracked\n").unwrap();

    create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "pair only",
    )
    .unwrap();

    let committed = assert_git(root.path(), &["show", "--pretty=", "--name-only", "HEAD"]);
    assert!(committed.contains("flow.yaml"));
    assert!(!committed.contains("staged.txt"));
    let staged = assert_git(root.path(), &["diff", "--cached", "--", "staged.txt"]);
    assert!(staged.contains("-base\n+staged change\n"));
    assert_eq!(
        fs::read_to_string(root.path().join("unstaged.txt")).unwrap(),
        "unstaged change\n"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("untracked.txt")).unwrap(),
        "untracked\n"
    );
}

#[test]
fn rejects_nothing_to_commit() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    assert_git(root.path(), &["add", "."]);
    assert_git(root.path(), &["commit", "-m", "initial"]);

    assert_code(
        create_pair_version(root.path(), "flow.yaml", Some("flow.hermes.yaml"), "empty"),
        "git_nothing_to_commit",
    );
}

#[test]
fn rejects_missing_identity_before_mutating_the_index() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = tempdir().unwrap();
    assert_git(root.path(), &["init", "-b", "main"]);
    write_pair(root.path());

    assert_code(
        create_pair_version(
            root.path(),
            "flow.yaml",
            Some("flow.hermes.yaml"),
            "version",
        ),
        "git_identity_missing",
    );
    assert!(assert_git(root.path(), &["diff", "--cached", "--name-only"]).is_empty());
}

#[cfg(unix)]
#[test]
fn a_rejected_commit_hook_returns_diagnostics_without_committing() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    let hook = root.path().join(".git/hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh\necho hook rejected >&2\nexit 1\n").unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();

    let error = create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "version",
    )
    .unwrap_err();

    assert_eq!(error.code, "git_commit_rejected");
    assert!(error.message.contains("hook rejected"));
    assert!(error.message.contains("worktree side effects may remain"));
    assert!(!git(root.path(), &["rev-parse", "--verify", "HEAD"])
        .status
        .success());
}

#[cfg(unix)]
#[test]
fn hook_cannot_broaden_pair_commit_or_mutate_the_real_index() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    fs::write(root.path().join("tracked.txt"), "base\n").unwrap();
    assert_git(root.path(), &["add", "."]);
    assert_git(root.path(), &["commit", "-m", "initial"]);
    fs::write(root.path().join("flow.yaml"), "name: changed\n").unwrap();
    fs::write(root.path().join("tracked.txt"), "preexisting staged\n").unwrap();
    assert_git(root.path(), &["add", "tracked.txt"]);
    let index_path = root.path().join(".git/index");
    let before_index = fs::read(&index_path).unwrap();
    let before_head = assert_git(root.path(), &["rev-parse", "HEAD"]);
    let hook = root.path().join(".git/hooks/pre-commit");
    fs::write(
        &hook,
        "#!/bin/sh\nprintf 'hook created\\n' > hook-created.txt\ngit add tracked.txt hook-created.txt\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();

    let error = create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "version",
    )
    .unwrap_err();

    assert_eq!(error.code, "git_commit_candidate_changed");
    assert!(error.message.contains("worktree side effects may remain"));
    assert_eq!(assert_git(root.path(), &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert_eq!(
        assert_git(root.path(), &["show", "HEAD:tracked.txt"]),
        "base\n"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("hook-created.txt")).unwrap(),
        "hook created\n"
    );
}

#[cfg(unix)]
#[test]
fn hooks_cannot_change_pair_tree_or_stage_unrelated_content() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = ENVIRONMENT.lock().unwrap();
    for scenario in ["pair", "message-hooks"] {
        let root = repository();
        write_pair(root.path());
        fs::write(root.path().join("unrelated.txt"), "base\n").unwrap();
        assert_git(root.path(), &["add", "."]);
        assert_git(root.path(), &["commit", "-m", "initial"]);
        fs::write(root.path().join("flow.yaml"), "name: accepted\n").unwrap();
        let index_path = root.path().join(".git/index");
        let before_index = fs::read(&index_path).unwrap();
        let before_head = assert_git(root.path(), &["rev-parse", "HEAD"]);
        if scenario == "pair" {
            let hook = root.path().join(".git/hooks/pre-commit");
            fs::write(
                &hook,
                "#!/bin/sh\nprintf 'name: hook changed\\n' > flow.yaml\ngit add flow.yaml\n",
            )
            .unwrap();
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        } else {
            fs::write(root.path().join("prepare.txt"), "prepare\n").unwrap();
            fs::write(root.path().join("message.txt"), "message\n").unwrap();
            let prepare = root.path().join(".git/hooks/prepare-commit-msg");
            fs::write(
                &prepare,
                "#!/bin/sh\ntest \"$#\" = 2 && test \"$2\" = message || exit 19\ngit add prepare.txt\n",
            )
            .unwrap();
            fs::set_permissions(&prepare, fs::Permissions::from_mode(0o755)).unwrap();
            let commit = root.path().join(".git/hooks/commit-msg");
            fs::write(
                &commit,
                "#!/bin/sh\ntest \"$#\" = 1 || exit 20\ngit add message.txt\n",
            )
            .unwrap();
            fs::set_permissions(&commit, fs::Permissions::from_mode(0o755)).unwrap();
        }

        let error = create_pair_version(
            root.path(),
            "flow.yaml",
            Some("flow.hermes.yaml"),
            "version",
        )
        .unwrap_err();

        let expected = if scenario == "pair" {
            "git_pair_changed"
        } else {
            "git_commit_candidate_changed"
        };
        assert_eq!(error.code, expected, "{scenario}");
        assert_eq!(assert_git(root.path(), &["rev-parse", "HEAD"]), before_head);
        assert_eq!(fs::read(&index_path).unwrap(), before_index);
    }
}

#[cfg(unix)]
#[test]
fn hooks_run_in_git_order_with_exact_arguments_and_post_commit_is_advisory() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    assert_git(root.path(), &["add", "."]);
    assert_git(root.path(), &["commit", "-m", "initial"]);
    fs::write(root.path().join("flow.yaml"), "name: accepted\n").unwrap();
    let hooks = root.path().join(".git/hooks");
    let scripts = [
        (
            "pre-commit",
            "#!/bin/sh\nprintf 'pre\\n' >> hook-order\nprintf 'name: accepted\\n' > flow.yaml\ngit add flow.yaml\n",
        ),
        (
            "prepare-commit-msg",
            "#!/bin/sh\ntest \"$#\" = 2 && test \"$2\" = message || exit 21\nprintf 'prepare:%s\\n' \"$2\" >> hook-order\n",
        ),
        (
            "commit-msg",
            "#!/bin/sh\ntest \"$#\" = 1 || exit 22\nprintf 'message\\n' >> hook-order\n",
        ),
        (
            "post-commit",
            "#!/bin/sh\ngit rev-parse --verify HEAD >/dev/null || exit 23\nprintf 'post\\n' >> hook-order\necho 'post hook warning' >&2\nexit 7\n",
        ),
    ];
    for (name, script) in scripts {
        let hook = hooks.join(name);
        fs::write(&hook, script).unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }

    let result = create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "version",
    )
    .unwrap();
    let warnings = match result {
        workflow_studio_lib::git::GitVersionResult::Committed { warnings, .. } => warnings,
        workflow_studio_lib::git::GitVersionResult::Unknown { .. } => {
            panic!("commit outcome must be known")
        }
    };

    assert_eq!(
        fs::read_to_string(root.path().join("hook-order")).unwrap(),
        "pre\nprepare:message\nmessage\npost\n"
    );
    assert!(warnings
        .iter()
        .any(|warning| warning.contains("post hook warning")));
    assert_eq!(
        assert_git(root.path(), &["show", "HEAD:flow.yaml"]),
        "name: accepted\n"
    );
}

#[cfg(unix)]
#[test]
fn clean_filter_cannot_change_the_accepted_pair_bytes() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    fs::write(
        root.path().join(".gitattributes"),
        "flow.yaml filter=rewrite\n",
    )
    .unwrap();
    assert_git(
        root.path(),
        &[
            "config",
            "filter.rewrite.clean",
            "sed 's/accepted/transformed/'",
        ],
    );
    assert_git(root.path(), &["config", "filter.rewrite.smudge", "cat"]);
    assert_git(root.path(), &["add", "."]);
    assert_git(root.path(), &["commit", "-m", "initial"]);
    fs::write(root.path().join("flow.yaml"), "name: accepted\n").unwrap();
    let index_path = root.path().join(".git/index");
    let before_index = fs::read(&index_path).unwrap();
    let before_head = assert_git(root.path(), &["rev-parse", "HEAD"]);

    let error = create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "version",
    )
    .unwrap_err();

    assert_eq!(error.code, "git_commit_candidate_changed");
    assert_eq!(assert_git(root.path(), &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert_eq!(
        fs::read_to_string(root.path().join("flow.yaml")).unwrap(),
        "name: accepted\n"
    );
}

#[cfg(unix)]
#[test]
fn replacement_ref_cannot_substitute_accepted_bytes_for_a_filtered_candidate_blob() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    fs::write(
        root.path().join(".gitattributes"),
        "flow.yaml filter=rewrite\n",
    )
    .unwrap();
    assert_git(
        root.path(),
        &[
            "config",
            "filter.rewrite.clean",
            "sed 's/accepted/transformed/'",
        ],
    );
    assert_git(root.path(), &["config", "filter.rewrite.smudge", "cat"]);
    assert_git(root.path(), &["add", "."]);
    assert_git(root.path(), &["commit", "-m", "initial"]);
    let accepted = b"name: accepted\n";
    let transformed = b"name: transformed\n";
    let accepted_oid = write_blob(root.path(), accepted);
    let transformed_oid = write_blob(root.path(), transformed);
    assert_git(root.path(), &["replace", &transformed_oid, &accepted_oid]);
    assert_eq!(
        assert_git(root.path(), &["cat-file", "blob", &transformed_oid]).as_bytes(),
        accepted
    );
    let raw = Command::new("git")
        .arg("-C")
        .arg(root.path())
        .args(["cat-file", "blob", &transformed_oid])
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .output()
        .unwrap();
    assert!(raw.status.success());
    assert_eq!(raw.stdout, transformed);
    fs::write(root.path().join("flow.yaml"), accepted).unwrap();
    let index_path = root.path().join(".git/index");
    let before_index = fs::read(&index_path).unwrap();
    let before_head = assert_git(root.path(), &["rev-parse", "HEAD"]);

    let error = create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "version",
    )
    .err()
    .expect("raw candidate bytes must not resolve through replacement refs");

    assert_eq!(error.code, "git_commit_candidate_changed");
    assert_eq!(assert_git(root.path(), &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
}

#[cfg(unix)]
#[test]
fn commits_untracked_contained_pair_symlinks_as_exact_link_blobs() {
    use std::os::unix::fs::symlink;

    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    fs::create_dir(root.path().join("targets")).unwrap();
    fs::write(
        root.path().join("targets/definition.yaml"),
        "name: target\n",
    )
    .unwrap();
    fs::write(
        root.path().join("targets/companion.yaml"),
        "language_compatibility: target\n",
    )
    .unwrap();
    symlink("targets/definition.yaml", root.path().join("flow.yaml")).unwrap();
    symlink(
        "targets/companion.yaml",
        root.path().join("flow.hermes.yaml"),
    )
    .unwrap();

    let version = create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "link pair",
    )
    .unwrap();

    assert!(version.committed_oid().is_some());
    assert_eq!(
        assert_git(root.path(), &["ls-tree", "HEAD", "--", "flow.yaml"])
            .split_whitespace()
            .next(),
        Some("120000")
    );
    assert_eq!(
        assert_git(root.path(), &["ls-tree", "HEAD", "--", "flow.hermes.yaml"])
            .split_whitespace()
            .next(),
        Some("120000")
    );
    assert_eq!(
        assert_git(root.path(), &["show", "HEAD:flow.yaml"]),
        "targets/definition.yaml"
    );
    assert_eq!(
        assert_git(root.path(), &["show", "HEAD:flow.hermes.yaml"]),
        "targets/companion.yaml"
    );
    assert!(assert_git(root.path(), &["diff", "--cached", "--name-only"]).is_empty());
    let untracked = assert_git(root.path(), &["ls-files", "--others", "--exclude-standard"]);
    assert!(untracked.contains("targets/definition.yaml"));
    assert!(untracked.contains("targets/companion.yaml"));
}

#[cfg(unix)]
#[test]
fn commits_existing_executable_and_mode_only_pair_entries_without_drift() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = ENVIRONMENT.lock().unwrap();

    let executable = repository();
    write_pair(executable.path());
    for path in ["flow.yaml", "flow.hermes.yaml"] {
        let mut permissions = fs::metadata(executable.path().join(path))
            .unwrap()
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(executable.path().join(path), permissions).unwrap();
    }
    create_pair_version(
        executable.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "executable pair",
    )
    .unwrap();
    for path in ["flow.yaml", "flow.hermes.yaml"] {
        assert_eq!(
            assert_git(executable.path(), &["ls-tree", "HEAD", "--", path])
                .split_whitespace()
                .next(),
            Some("100755")
        );
    }

    let mode_only = repository();
    write_pair(mode_only.path());
    assert_git(mode_only.path(), &["add", "flow.yaml", "flow.hermes.yaml"]);
    assert_git(mode_only.path(), &["commit", "-m", "base"]);
    let mut permissions = fs::metadata(mode_only.path().join("flow.yaml"))
        .unwrap()
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(mode_only.path().join("flow.yaml"), permissions).unwrap();
    create_pair_version(
        mode_only.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "mode only",
    )
    .unwrap();
    assert_eq!(
        assert_git(mode_only.path(), &["ls-tree", "HEAD", "--", "flow.yaml"])
            .split_whitespace()
            .next(),
        Some("100755")
    );
    assert_eq!(
        assert_git(
            mode_only.path(),
            &["ls-tree", "HEAD", "--", "flow.hermes.yaml"]
        )
        .split_whitespace()
        .next(),
        Some("100644")
    );
}

#[cfg(unix)]
#[test]
fn core_filemode_false_preserves_the_base_mode_during_content_commit() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    assert_git(root.path(), &["add", "flow.yaml", "flow.hermes.yaml"]);
    assert_git(root.path(), &["commit", "-m", "base"]);
    assert_git(root.path(), &["config", "core.fileMode", "false"]);
    let mut permissions = fs::metadata(root.path().join("flow.yaml"))
        .unwrap()
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(root.path().join("flow.yaml"), permissions).unwrap();
    fs::write(root.path().join("flow.yaml"), "name: content changed\n").unwrap();

    create_pair_version(
        root.path(),
        "flow.yaml",
        Some("flow.hermes.yaml"),
        "content only mode ignored",
    )
    .unwrap();

    assert_eq!(
        assert_git(root.path(), &["ls-tree", "HEAD", "--", "flow.yaml"])
            .split_whitespace()
            .next(),
        Some("100644")
    );
}

#[cfg(unix)]
#[test]
fn core_filemode_false_uses_644_for_untracked_exec_and_preserves_tracked_755() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = ENVIRONMENT.lock().unwrap();

    let untracked = repository();
    assert_git(untracked.path(), &["config", "core.fileMode", "false"]);
    fs::write(untracked.path().join("flow.yaml"), "name: untracked\n").unwrap();
    let mut permissions = fs::metadata(untracked.path().join("flow.yaml"))
        .unwrap()
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(untracked.path().join("flow.yaml"), permissions).unwrap();
    create_pair_version(untracked.path(), "flow.yaml", None, "untracked executable").unwrap();
    assert_eq!(
        assert_git(untracked.path(), &["ls-tree", "HEAD", "--", "flow.yaml"])
            .split_whitespace()
            .next(),
        Some("100644")
    );

    let tracked = repository();
    fs::write(tracked.path().join("flow.yaml"), "name: base\n").unwrap();
    let mut permissions = fs::metadata(tracked.path().join("flow.yaml"))
        .unwrap()
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(tracked.path().join("flow.yaml"), permissions).unwrap();
    assert_git(tracked.path(), &["add", "flow.yaml"]);
    assert_git(tracked.path(), &["commit", "-m", "executable base"]);
    assert_git(tracked.path(), &["config", "core.fileMode", "false"]);
    let mut permissions = fs::metadata(tracked.path().join("flow.yaml"))
        .unwrap()
        .permissions();
    permissions.set_mode(0o644);
    fs::set_permissions(tracked.path().join("flow.yaml"), permissions).unwrap();
    fs::write(tracked.path().join("flow.yaml"), "name: content changed\n").unwrap();
    create_pair_version(
        tracked.path(),
        "flow.yaml",
        None,
        "preserve base executable",
    )
    .unwrap();
    assert_eq!(
        assert_git(tracked.path(), &["ls-tree", "HEAD", "--", "flow.yaml"])
            .split_whitespace()
            .next(),
        Some("100755")
    );
}

#[cfg(unix)]
#[test]
fn tracked_symlink_retarget_commits_link_bytes_and_target_content_only_is_not_pair_change() {
    use std::os::unix::fs::symlink;

    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    fs::write(root.path().join("one.yaml"), "name: one\n").unwrap();
    fs::write(root.path().join("two.yaml"), "name: two\n").unwrap();
    symlink("one.yaml", root.path().join("flow.yaml")).unwrap();
    assert_git(root.path(), &["add", "flow.yaml"]);
    assert_git(root.path(), &["commit", "-m", "base link"]);

    fs::write(root.path().join("one.yaml"), "name: edited target only\n").unwrap();
    assert_code(
        create_pair_version(root.path(), "flow.yaml", None, "target content"),
        "git_nothing_to_commit",
    );

    fs::remove_file(root.path().join("flow.yaml")).unwrap();
    symlink("two.yaml", root.path().join("flow.yaml")).unwrap();
    create_pair_version(root.path(), "flow.yaml", None, "retarget link").unwrap();

    assert_eq!(
        assert_git(root.path(), &["show", "HEAD:flow.yaml"]),
        "two.yaml"
    );
    assert_eq!(
        assert_git(root.path(), &["ls-tree", "HEAD", "--", "flow.yaml"])
            .split_whitespace()
            .next(),
        Some("120000")
    );
}

#[cfg(unix)]
#[test]
fn rejects_escaping_symlink_before_candidate_index_staging() {
    use std::os::unix::fs::symlink;

    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("outside.yaml"), "name: outside\n").unwrap();
    symlink(
        outside.path().join("outside.yaml"),
        root.path().join("flow.yaml"),
    )
    .unwrap();

    assert_code(
        create_pair_version(root.path(), "flow.yaml", None, "unsafe link"),
        "git_pair_unavailable",
    );

    assert!(!git(root.path(), &["rev-parse", "--verify", "HEAD"])
        .status
        .success());
    assert!(!root.path().join(".git/index").exists());
    assert!(fs::read_dir(root.path().join(".git"))
        .unwrap()
        .all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("workflow-studio-")));
}

#[cfg(unix)]
#[test]
fn hook_symlink_escape_rejects_without_ref_or_real_index_publication() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    let outside = tempdir().unwrap();
    fs::write(root.path().join("one.yaml"), "name: one\n").unwrap();
    fs::write(root.path().join("two.yaml"), "name: two\n").unwrap();
    fs::write(outside.path().join("outside.yaml"), "name: outside\n").unwrap();
    symlink("one.yaml", root.path().join("flow.yaml")).unwrap();
    assert_git(root.path(), &["add", "flow.yaml"]);
    assert_git(root.path(), &["commit", "-m", "base link"]);
    fs::remove_file(root.path().join("flow.yaml")).unwrap();
    symlink("two.yaml", root.path().join("flow.yaml")).unwrap();
    symlink(
        outside.path().join("outside.yaml"),
        root.path().join("escape-link"),
    )
    .unwrap();
    let hook = root.path().join(".git/hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh\nrm flow.yaml\nmv escape-link flow.yaml\n").unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let before_head = assert_git(root.path(), &["rev-parse", "HEAD"]);
    let index_path = root.path().join(".git/index");
    let before_index = fs::read(&index_path).unwrap();

    let error = create_pair_version(root.path(), "flow.yaml", None, "retarget link")
        .err()
        .expect("hook escape must reject the accepted pair");

    assert_eq!(error.code, "git_pair_changed");
    assert!(error.message.contains("worktree side effects may remain"));
    assert_eq!(assert_git(root.path(), &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert!(!root.path().join(".git/index.lock").exists());
}

#[test]
fn init_honors_configured_default_branch_and_local_identity_leaves_global_config_unchanged() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let config_dir = tempdir().unwrap();
    let global = config_dir.path().join("global.gitconfig");
    let original = "[init]\n\tdefaultBranch = configured-default\n[user]\n\tname = Global User\n\temail = global@example.test\n";
    fs::write(&global, original).unwrap();
    let previous = std::env::var_os("GIT_CONFIG_GLOBAL");
    std::env::set_var("GIT_CONFIG_GLOBAL", &global);

    let root = tempdir().unwrap();
    let result = (|| {
        init_repository(root.path())?;
        set_local_identity(root.path(), "Repository User", "repository@example.test")?;
        Ok::<_, GitError>(())
    })();

    match previous {
        Some(value) => std::env::set_var("GIT_CONFIG_GLOBAL", value),
        None => std::env::remove_var("GIT_CONFIG_GLOBAL"),
    }
    result.unwrap();
    assert_eq!(
        assert_git(root.path(), &["symbolic-ref", "--short", "HEAD"]).trim(),
        "configured-default"
    );
    assert_eq!(fs::read_to_string(global).unwrap(), original);
}

#[test]
fn tracked_move_is_exact_and_untracked_move_is_rejected() {
    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    fs::write(root.path().join("tracked old.yaml"), "name: tracked\n").unwrap();
    fs::write(root.path().join("untracked old.yaml"), "name: untracked\n").unwrap();
    assert_git(root.path(), &["add", "tracked old.yaml"]);
    assert_git(root.path(), &["commit", "-m", "initial"]);

    move_tracked_path(root.path(), "tracked old.yaml", "tracked new.yaml").unwrap();
    assert_code(
        move_tracked_path(root.path(), "untracked old.yaml", "untracked new.yaml"),
        "git_path_not_tracked",
    );

    assert!(!root.path().join("tracked old.yaml").exists());
    assert!(root.path().join("tracked new.yaml").exists());
    assert!(root.path().join("untracked old.yaml").exists());
    assert!(!root.path().join("untracked new.yaml").exists());
}

#[cfg(unix)]
#[test]
fn rejected_hook_output_is_bounded() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = ENVIRONMENT.lock().unwrap();
    let root = repository();
    write_pair(root.path());
    let hook = root.path().join(".git/hooks/pre-commit");
    fs::write(
        &hook,
        "#!/bin/sh\ndd if=/dev/zero bs=1048576 count=6 2>/dev/null | tr '\\000' x >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();

    assert_code(
        create_pair_version(
            root.path(),
            "flow.yaml",
            Some("flow.hermes.yaml"),
            "version",
        ),
        "git_output_too_large",
    );
    assert!(!git(root.path(), &["rev-parse", "--verify", "HEAD"])
        .status
        .success());
}
