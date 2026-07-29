use std::fs;
use std::path::Path;
use std::process::Command;

use tempfile::tempdir;

use super::parse::{parse_history, parse_status};
use super::runner::{build_read_command, ReadOperation};
use super::{
    authorize_repository_root, detect_repository, diff_pair, history_pair, show_pair, status,
};

fn git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .output()
        .expect("git fixture command should start");
    assert!(
        output.status.success(),
        "git fixture command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn commit_all(root: &Path, message: &str) {
    git(root, &["add", "--all"]);
    git(root, &["commit", "-m", message]);
}

#[test]
fn parses_porcelain_v2_without_losing_literal_paths_or_status_columns() {
    let bytes = concat!(
        "# branch.oid 0123456789abcdef\0",
        "# branch.head main\0",
        "1 M. N... 100644 100644 100644 abcdef1 abcdef2 staged only.yaml\0",
        "1 .M N... 100644 100644 100644 abcdef1 abcdef2 café\tflow.yaml\0",
        "2 R. N... 100644 100644 100644 abcdef1 abcdef2 R100 renamed flow.yaml\0old flow.yaml\0",
        "? untracked ü.yaml\0",
    )
    .as_bytes();

    let parsed = parse_status(bytes).expect("porcelain should parse");

    assert_eq!(parsed.entries.len(), 4);
    assert_eq!(parsed.entries[0].path, "staged only.yaml");
    assert_eq!(parsed.entries[0].index, "M");
    assert_eq!(parsed.entries[0].worktree, ".");
    assert_eq!(parsed.entries[1].path, "café\tflow.yaml");
    assert_eq!(
        parsed.entries[2].original_path.as_deref(),
        Some("old flow.yaml")
    );
    assert_eq!(parsed.entries[3].path, "untracked ü.yaml");
    assert!(parsed.entries[3].untracked);
}

#[test]
fn parses_nul_delimited_history_records() {
    let bytes = b"0123456789abcdef\x0001234567890\x00Ada\x002026-07-29T10:00:00Z\x00update definition\x00\x00fedcba9876543210\x00fedcba987654\x00Lin\x002026-07-28T09:00:00Z\x00add companion\x00";

    let commits = parse_history(bytes).expect("history should parse");

    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].subject, "update definition");
    assert_eq!(commits[1].oid, "fedcba9876543210");
}

#[test]
fn inspects_real_repositories_and_merges_pair_history_without_unrelated_entries() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::create_dir(root.join("flows")).unwrap();
    fs::write(root.join("flows/pair ü.yaml"), "name: one\n").unwrap();
    commit_all(root, "add definition");
    fs::write(
        root.join("flows/pair ü.hermes.yaml"),
        "language_compatibility: hermes-legacy\n",
    )
    .unwrap();
    commit_all(root, "add companion");
    fs::write(root.join("unrelated.txt"), "outside pair\n").unwrap();
    commit_all(root, "unrelated commit");
    git(
        root,
        &["mv", "flows/pair ü.yaml", "flows/renamed\tflow.yaml"],
    );
    fs::write(root.join("unrelated scratch.txt"), "leave me alone\n").unwrap();

    let repository = detect_repository(root).unwrap().expect("repository");
    assert_eq!(
        repository.root,
        root.canonicalize().unwrap().to_string_lossy()
    );
    assert_eq!(repository.branch.as_deref(), Some("main"));
    assert!(repository.detached_head.is_none());

    let current = status(root).unwrap();
    let rename = current
        .entries
        .iter()
        .find(|entry| entry.path == "flows/renamed\tflow.yaml")
        .expect("rename status");
    assert_eq!(rename.original_path.as_deref(), Some("flows/pair ü.yaml"));
    assert_eq!(rename.index, "R");
    assert!(current
        .entries
        .iter()
        .any(|entry| entry.path == "unrelated scratch.txt" && entry.untracked));

    let diff = diff_pair(
        root,
        "flows/renamed\tflow.yaml",
        Some("flows/pair ü.hermes.yaml"),
    )
    .unwrap();
    assert!(diff.index.contains("renamed\\tflow.yaml"));
    assert!(diff.working.is_empty());

    commit_all(root, "rename definition");

    let history = history_pair(
        root,
        "flows/renamed\tflow.yaml",
        Some("flows/pair ü.hermes.yaml"),
    )
    .unwrap();
    assert_eq!(
        history
            .iter()
            .map(|commit| commit.subject.as_str())
            .collect::<Vec<_>>(),
        vec!["rename definition", "add companion", "add definition"]
    );
    let snapshot = show_pair(
        root,
        &history[1].oid,
        "flows/renamed\tflow.yaml",
        Some("flows/pair ü.hermes.yaml"),
    )
    .unwrap();
    assert!(snapshot.definition.is_none());
    assert_eq!(
        snapshot.companion.as_deref(),
        Some("language_compatibility: hermes-legacy\n")
    );
}

#[test]
fn fails_closed_when_a_diff_exceeds_the_output_ceiling() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("large.yaml"), "name: small\n").unwrap();
    commit_all(root, "initial");
    fs::write(
        root.join("large.yaml"),
        format!("value: {}\n", "x".repeat(6 * 1024 * 1024)),
    )
    .unwrap();

    let error = diff_pair(root, "large.yaml", None).unwrap_err();
    assert_eq!(error.code, "git_output_too_large");
}

#[test]
fn reports_no_repository_and_detached_head_without_mutating_working_state() {
    let outside = tempdir().unwrap();
    assert!(detect_repository(outside.path()).unwrap().is_none());

    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: detached\n").unwrap();
    commit_all(root, "initial");
    git(root, &["checkout", "--detach"]);

    let repository = detect_repository(root).unwrap().expect("repository");
    assert!(repository.branch.is_none());
    assert_eq!(repository.detached_head.as_deref().map(str::len), Some(12));
}

#[test]
fn treats_an_initialized_repository_without_commits_as_empty_history() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);

    let repository = detect_repository(root).unwrap().expect("repository");
    assert_eq!(repository.branch.as_deref(), Some("main"));
    assert!(history_pair(root, "flow.yaml", None).unwrap().is_empty());
}

#[test]
fn rejects_unsafe_show_identifiers_and_paths() {
    let directory = tempdir().unwrap();
    let error = show_pair(directory.path(), "HEAD", "flow.yaml", None).unwrap_err();
    assert_eq!(error.code, "git_invalid_oid");
    let error = diff_pair(directory.path(), "../outside.yaml", None).unwrap_err();
    assert_eq!(error.code, "git_invalid_path");
    let error = diff_pair(directory.path(), "evil\0.yaml", None).unwrap_err();
    assert_eq!(error.code, "git_invalid_path");
}

#[test]
fn rejects_a_repository_root_that_was_not_detected_from_the_selected_workspace() {
    let selected = tempdir().unwrap();
    git(selected.path(), &["init", "-b", "main"]);
    let unrelated = tempdir().unwrap();
    git(unrelated.path(), &["init", "-b", "main"]);

    let error = authorize_repository_root(unrelated.path(), selected.path()).unwrap_err();
    assert_eq!(error.code, "git_repository_not_authorized");
    assert_eq!(
        authorize_repository_root(selected.path(), selected.path()).unwrap(),
        selected.path().canonicalize().unwrap()
    );
}

#[test]
fn builds_a_fixed_noninteractive_literal_diff_command() {
    let root = Path::new("/selected workspace");
    let paths = ["flows/a b.yaml"];
    let command = build_read_command(
        root,
        ReadOperation::Diff {
            cached: false,
            paths: &paths,
        },
    );
    let arguments = command
        .get_args()
        .map(|value| value.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        arguments,
        vec![
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "-C",
            "/selected workspace",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
            "flows/a b.yaml",
        ]
    );
    let environment = command
        .get_envs()
        .map(|(key, value)| {
            (
                key.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(environment.get("GIT_PAGER"), Some(&Some("cat".to_owned())));
    assert_eq!(
        environment.get("GIT_TERMINAL_PROMPT"),
        Some(&Some("0".to_owned()))
    );
    assert_eq!(
        environment.get("GIT_OPTIONAL_LOCKS"),
        Some(&Some("0".to_owned()))
    );
    assert_eq!(environment.get("LC_ALL"), Some(&Some("C".to_owned())));
    assert_eq!(environment.get("GIT_DIR"), Some(&None));
    assert_eq!(environment.get("GIT_EXTERNAL_DIFF"), Some(&None));
}

#[test]
fn reports_pipe_read_failures_instead_of_returning_partial_git_output() {
    struct FailingReader;
    impl std::io::Read for FailingReader {
        fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("fixture read failure"))
        }
    }

    let error = super::runner::read_for_test(FailingReader).unwrap_err();
    assert_eq!(error.code, "git_read_failed");
}
