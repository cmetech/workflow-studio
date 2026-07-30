use std::fs;
use std::path::Path;
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
        version.oid,
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
    assert!(!git(root.path(), &["rev-parse", "--verify", "HEAD"])
        .status
        .success());
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
