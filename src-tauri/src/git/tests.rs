use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

use tempfile::tempdir;

use super::parse::{parse_history, parse_status};
use super::runner::{build_read_command, MutationOperation, ReadOperation};
use super::{
    authorize_repository_root, detect_repository, diff_pair, history_pair, show_authorized_pair,
    show_from_authorization, show_pair, status, AuthorizedGitContext, GitState, HistoricalPaths,
    HistoryAuthorization, HISTORY_AUTHORIZATION_LIMIT,
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

fn git_output(root: &Path, arguments: &[&str]) -> String {
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
    String::from_utf8(output.stdout).unwrap()
}

fn commit_all(root: &Path, message: &str) {
    git(root, &["add", "--all"]);
    git(root, &["commit", "-m", message]);
}

#[test]
fn pair_move_failure_restores_two_tracked_paths_without_changing_index_or_worktree() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: original\n").unwrap();
    fs::write(root.join("flow.hermes.yaml"), "profile: original\n").unwrap();
    fs::write(root.join("unrelated.txt"), "original\n").unwrap();
    commit_all(root, "initial");
    fs::write(root.join("flow.yaml"), "name: unstaged\n").unwrap();
    fs::write(root.join("unrelated.txt"), "staged unrelated\n").unwrap();
    git(root, &["add", "unrelated.txt"]);

    let git_dir = String::from_utf8(
        Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["rev-parse", "--absolute-git-dir"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let index_path = Path::new(git_dir.trim()).join("index");
    let before_index = fs::read(&index_path).unwrap();
    let before_status = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["status", "--porcelain=v2", "-z", "--untracked-files=all"])
        .output()
        .unwrap()
        .stdout;
    let mut guard_calls = 0;

    let error = super::mutate::move_tracked_paths_with_guard(
        root,
        &[
            ("flow.yaml", "renamed.yaml"),
            ("flow.hermes.yaml", "renamed.hermes.yaml"),
        ],
        || {
            guard_calls += 1;
            if guard_calls == 2 {
                Err(super::GitError::new(
                    "injected_failure",
                    "second move failed",
                ))
            } else {
                Ok(())
            }
        },
    )
    .unwrap_err();

    assert_eq!(error.code, "injected_failure");
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert_eq!(
        Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["status", "--porcelain=v2", "-z", "--untracked-files=all"])
            .output()
            .unwrap()
            .stdout,
        before_status
    );
    assert_eq!(
        fs::read_to_string(root.join("flow.yaml")).unwrap(),
        "name: unstaged\n"
    );
    assert_eq!(
        fs::read_to_string(root.join("flow.hermes.yaml")).unwrap(),
        "profile: original\n"
    );
    assert!(!root.join("renamed.yaml").exists());
    assert!(!root.join("renamed.hermes.yaml").exists());
}

#[test]
fn tracked_move_rejects_and_rolls_back_when_its_acquired_index_lock_is_replaced() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: original\n").unwrap();
    commit_all(root, "initial");
    let index_path = root.join(".git/index");
    let lock_path = root.join(".git/index.lock");
    let parked_owned_lock = root.join(".git/parked-move-index.lock");
    let before_index = fs::read(&index_path).unwrap();

    let error = super::mutate::move_tracked_paths_with_interleave_for_test(
        root,
        &[("flow.yaml", "renamed.yaml")],
        |step| {
            if step == 2 {
                fs::rename(&lock_path, &parked_owned_lock).unwrap();
                fs::write(&lock_path, b"foreign move publisher").unwrap();
            }
            Ok(())
        },
        |_| Ok(()),
    )
    .err()
    .expect("the move index publisher must retain its acquired lock identity");

    assert_eq!(error.code, "git_index_changed");
    assert!(root.join("flow.yaml").exists());
    assert!(!root.join("renamed.yaml").exists());
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert_eq!(fs::read(&lock_path).unwrap(), b"foreign move publisher");
}

#[test]
fn post_move_failure_rolls_back_current_and_prior_tracked_paths() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: original\n").unwrap();
    fs::write(root.join("flow.hermes.yaml"), "profile: original\n").unwrap();
    commit_all(root, "initial");
    let index_path = root.join(".git/index");
    let before_index = fs::read(&index_path).unwrap();

    let error = super::mutate::move_tracked_paths_with_interleave_for_test(
        root,
        &[
            ("flow.yaml", "renamed.yaml"),
            ("flow.hermes.yaml", "renamed.hermes.yaml"),
        ],
        |_| Ok(()),
        |index| {
            if index == 1 {
                Err(super::GitError::new(
                    "injected_post_move_failure",
                    "the temporary index failed after the worktree move",
                ))
            } else {
                Ok(())
            }
        },
    )
    .unwrap_err();

    assert_eq!(error.code, "injected_post_move_failure");
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert_eq!(
        fs::read_to_string(root.join("flow.yaml")).unwrap(),
        "name: original\n"
    );
    assert_eq!(
        fs::read_to_string(root.join("flow.hermes.yaml")).unwrap(),
        "profile: original\n"
    );
    assert!(!root.join("renamed.yaml").exists());
    assert!(!root.join("renamed.hermes.yaml").exists());
    assert!(fs::read_dir(root.join(".git")).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with("workflow-studio-index-")));
}

#[test]
fn post_move_identity_race_reports_partial_after_restoring_prior_paths() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: original\n").unwrap();
    fs::write(root.join("flow.hermes.yaml"), "profile: original\n").unwrap();
    commit_all(root, "initial");
    let index_path = root.join(".git/index");
    let before_index = fs::read(&index_path).unwrap();

    let error = super::mutate::move_tracked_paths_with_interleave_for_test(
        root,
        &[
            ("flow.yaml", "renamed.yaml"),
            ("flow.hermes.yaml", "renamed.hermes.yaml"),
        ],
        |_| Ok(()),
        |index| {
            if index == 1 {
                fs::rename(
                    root.join("renamed.hermes.yaml"),
                    root.join("parked.hermes.yaml"),
                )
                .unwrap();
                fs::write(root.join("renamed.hermes.yaml"), "replacement\n").unwrap();
            }
            Ok(())
        },
    )
    .unwrap_err();

    assert_eq!(error.code, "git_move_partial");
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert_eq!(
        fs::read_to_string(root.join("flow.yaml")).unwrap(),
        "name: original\n"
    );
    assert!(!root.join("renamed.yaml").exists());
    assert_eq!(
        fs::read_to_string(root.join("parked.hermes.yaml")).unwrap(),
        "profile: original\n"
    );
    assert_eq!(
        fs::read_to_string(root.join("renamed.hermes.yaml")).unwrap(),
        "replacement\n"
    );
}

#[test]
fn linked_worktree_post_move_failure_restores_current_and_prior_paths() {
    let directory = tempdir().unwrap();
    let main = directory.path().join("main");
    let linked = directory.path().join("linked");
    fs::create_dir(&main).unwrap();
    git(&main, &["init", "-b", "main"]);
    git(&main, &["config", "user.name", "Workflow Test"]);
    git(&main, &["config", "user.email", "workflow@example.test"]);
    fs::write(main.join("flow.yaml"), "name: original\n").unwrap();
    fs::write(main.join("flow.hermes.yaml"), "profile: original\n").unwrap();
    commit_all(&main, "initial");
    git(
        &main,
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );
    let context = super::AuthorizedGitContext::bind(&linked, &linked).unwrap();
    let linked_index = context.git_metadata.metadata.worktree_dir.join("index");
    let main_index = main.join(".git/index");
    let before_linked_index = fs::read(&linked_index).unwrap();
    let before_main_index = fs::read(&main_index).unwrap();

    let error = super::mutate::move_tracked_paths_with_interleave_for_test(
        &linked,
        &[
            ("flow.yaml", "renamed.yaml"),
            ("flow.hermes.yaml", "renamed.hermes.yaml"),
        ],
        |_| context.verify(),
        |index| {
            if index == 1 {
                Err(super::GitError::new(
                    "injected_linked_failure",
                    "linked worktree failed after move",
                ))
            } else {
                Ok(())
            }
        },
    )
    .unwrap_err();

    assert_eq!(error.code, "injected_linked_failure");
    assert_eq!(fs::read(&linked_index).unwrap(), before_linked_index);
    assert_eq!(fs::read(&main_index).unwrap(), before_main_index);
    assert!(linked.join("flow.yaml").exists());
    assert!(linked.join("flow.hermes.yaml").exists());
    assert!(!linked.join("renamed.yaml").exists());
    assert!(!linked.join("renamed.hermes.yaml").exists());
    assert!(fs::read_dir(&context.git_metadata.metadata.worktree_dir)
        .unwrap()
        .all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("workflow-studio-index-")));
}

#[test]
fn tracked_pair_move_succeeds_in_main_and_linked_worktrees() {
    let directory = tempdir().unwrap();
    let main = directory.path().join("main");
    let linked = directory.path().join("linked");
    fs::create_dir(&main).unwrap();
    git(&main, &["init", "-b", "main"]);
    git(&main, &["config", "user.name", "Workflow Test"]);
    git(&main, &["config", "user.email", "workflow@example.test"]);
    for path in ["flow.yaml", "flow.hermes.yaml"] {
        fs::write(main.join(path), format!("path: {path}\n")).unwrap();
    }
    commit_all(&main, "initial pair");
    git(
        &main,
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );

    super::mutate::move_tracked_paths(
        &main,
        &[
            ("flow.yaml", "main.yaml"),
            ("flow.hermes.yaml", "main.hermes.yaml"),
        ],
    )
    .unwrap();
    assert!(main.join("main.yaml").exists());
    assert!(main.join("main.hermes.yaml").exists());

    let context = super::AuthorizedGitContext::bind(&linked, &linked).unwrap();
    super::mutate::move_tracked_paths_in_git_dir_with_guard(
        &linked,
        &context.git_metadata.metadata.worktree_dir,
        &[
            ("flow.yaml", "linked.yaml"),
            ("flow.hermes.yaml", "linked.hermes.yaml"),
        ],
        || context.verify(),
    )
    .unwrap();
    assert!(linked.join("linked.yaml").exists());
    assert!(linked.join("linked.hermes.yaml").exists());
    assert!(git_output(&linked, &["status", "--porcelain"]).contains("linked.yaml"));
}

#[test]
fn linked_worktree_metadata_repoint_rolls_back_before_move_and_before_index_publication() {
    for swap_at in [1, 4] {
        let directory = tempdir().unwrap();
        let main = directory.path().join("main");
        let linked = directory.path().join("linked");
        fs::create_dir(&main).unwrap();
        git(&main, &["init", "-b", "main"]);
        git(&main, &["config", "user.name", "Workflow Test"]);
        git(&main, &["config", "user.email", "workflow@example.test"]);
        fs::write(main.join("flow.yaml"), "name: flow\n").unwrap();
        fs::write(main.join("flow.hermes.yaml"), "profile: flow\n").unwrap();
        commit_all(&main, "initial pair");
        git(
            &main,
            &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
        );
        fs::write(linked.join("flow.yaml"), "name: unstaged\n").unwrap();
        let context = super::AuthorizedGitContext::bind(&linked, &linked).unwrap();
        let original_indirection = fs::read(linked.join(".git")).unwrap();
        let linked_index = context.git_metadata.metadata.worktree_dir.join("index");
        let main_index = main.join(".git/index");
        let before_linked_index = fs::read(&linked_index).unwrap();
        let before_main_index = fs::read(&main_index).unwrap();
        let mut guard_calls = 0;

        let error = super::mutate::move_tracked_paths_in_git_dir_with_guard(
            &linked,
            &context.git_metadata.metadata.worktree_dir,
            &[
                ("flow.yaml", "renamed.yaml"),
                ("flow.hermes.yaml", "renamed.hermes.yaml"),
            ],
            || {
                guard_calls += 1;
                if guard_calls == swap_at {
                    fs::write(
                        linked.join(".git"),
                        format!("gitdir: {}\n", main.join(".git").display()),
                    )
                    .unwrap();
                }
                context.verify()
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "git_repository_changed");
        assert_eq!(fs::read(&linked_index).unwrap(), before_linked_index);
        assert_eq!(fs::read(&main_index).unwrap(), before_main_index);
        assert!(linked.join("flow.yaml").exists());
        assert!(linked.join("flow.hermes.yaml").exists());
        assert!(!linked.join("renamed.yaml").exists());
        assert!(!linked.join("renamed.hermes.yaml").exists());
        assert!(!context
            .git_metadata
            .metadata
            .worktree_dir
            .join("index.lock")
            .exists());
        assert!(fs::read_dir(&context.git_metadata.metadata.worktree_dir)
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("workflow-studio-index-")));
        fs::write(linked.join(".git"), original_indirection).unwrap();
        assert!(git_output(&linked, &["status", "--porcelain"]).contains("flow.yaml"));
    }
}

#[test]
fn pair_version_preview_includes_untracked_bytes_and_rejects_in_place_changes() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: previewed\n").unwrap();

    let (diff, binding) = super::mutate::preview_pair_version(root, "flow.yaml", None).unwrap();
    assert!(diff.contains("flow.yaml"));
    assert!(diff.contains("+name: previewed"));

    fs::write(root.join("flow.yaml"), "name: changed in place\n").unwrap();
    assert_eq!(binding.verify().unwrap_err().code, "git_pair_changed");
}

#[cfg(unix)]
#[test]
fn pair_version_rejects_chmod_after_the_authorized_preview() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    git(root, &["config", "core.fileMode", "true"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    let (_, binding, base) =
        super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();
    let before_head = git_output(root, &["rev-parse", "HEAD"]);
    let before_index = fs::read(root.join(".git/index")).unwrap();
    let mut permissions = fs::metadata(root.join("flow.yaml")).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(root.join("flow.yaml"), permissions).unwrap();

    let error = super::mutate::create_pair_version_with_guard(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            binding.verify()?;
            base.verify(root)
        },
    )
    .err()
    .expect("chmod after preview must invalidate pair authorization");

    assert_eq!(error.code, "git_pair_changed");
    assert_eq!(git_output(root, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
}

#[cfg(unix)]
#[test]
fn pair_version_rejects_chmod_performed_by_a_commit_hook() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    git(root, &["config", "core.fileMode", "true"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    let (_, binding, base) =
        super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();
    let before_head = git_output(root, &["rev-parse", "HEAD"]);
    let before_index = fs::read(root.join(".git/index")).unwrap();
    let hook = root.join(".git/hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh\nchmod +x flow.yaml\n").unwrap();
    let mut hook_permissions = fs::metadata(&hook).unwrap().permissions();
    hook_permissions.set_mode(0o755);
    fs::set_permissions(&hook, hook_permissions).unwrap();

    let error = super::mutate::create_pair_version_with_guard(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            binding.verify()?;
            base.verify(root)
        },
    )
    .err()
    .expect("hook chmod must invalidate the accepted pair entry");

    assert_eq!(error.code, "git_pair_changed");
    assert_eq!(git_output(root, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
}

#[cfg(unix)]
#[test]
fn pair_version_rejects_transient_stage_chmod_restored_by_a_hook() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    git(root, &["config", "core.fileMode", "true"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    let (_, _binding, base) =
        super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();
    let before_head = git_output(root, &["rev-parse", "HEAD"]);
    let before_index = fs::read(root.join(".git/index")).unwrap();
    let hook = root.join(".git/hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh\nchmod -x flow.yaml\n").unwrap();
    let mut hook_permissions = fs::metadata(&hook).unwrap().permissions();
    hook_permissions.set_mode(0o755);
    fs::set_permissions(&hook, hook_permissions).unwrap();

    let error = super::mutate::create_pair_version_with_stage_interleave_for_test(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            let mut permissions = fs::metadata(root.join("flow.yaml")).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(root.join("flow.yaml"), permissions).unwrap();
            Ok(())
        },
    )
    .err()
    .expect("candidate mode must equal the preview-authorized mode");

    assert_eq!(error.code, "git_commit_candidate_changed");
    assert_eq!(git_output(root, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
}

#[cfg(unix)]
#[test]
fn authorized_pair_rejects_core_filemode_drift_before_candidate_staging() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    git(root, &["config", "core.fileMode", "false"]);
    let mut permissions = fs::metadata(root.join("flow.yaml")).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(root.join("flow.yaml"), permissions).unwrap();
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    let (_, binding, base) =
        super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();
    let before_head = git_output(root, &["rev-parse", "HEAD"]);
    let before_index = fs::read(root.join(".git/index")).unwrap();
    git(root, &["config", "core.fileMode", "true"]);

    let error = super::mutate::create_pair_version_with_guard(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            binding.verify()?;
            base.verify(root)
        },
    )
    .err()
    .expect("effective Git mode semantics changed after authorization");

    assert_eq!(error.code, "git_pair_changed");
    assert_eq!(git_output(root, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
}

#[cfg(unix)]
#[test]
fn authorized_pair_rejects_core_filemode_true_to_false_transition() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    git(root, &["config", "core.fileMode", "true"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    let (_, binding, base) =
        super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();
    let before_head = git_output(root, &["rev-parse", "HEAD"]);
    let before_index = fs::read(root.join(".git/index")).unwrap();
    git(root, &["config", "core.fileMode", "false"]);

    let error = super::mutate::create_pair_version_with_guard(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            binding.verify()?;
            base.verify(root)
        },
    )
    .err()
    .expect("effective Git mode semantics changed after authorization");

    assert_eq!(error.code, "git_pair_changed");
    assert_eq!(git_output(root, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
}

#[cfg(unix)]
#[test]
fn safe_symlink_binding_tracks_link_and_target_identity_but_not_target_content() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    fs::create_dir(root.join("targets")).unwrap();
    fs::write(root.join("targets/one.yaml"), "name: one\n").unwrap();
    symlink("targets/one.yaml", root.join("flow.yaml")).unwrap();
    let binding = super::mutate::PairPathBinding::capture(root, &["flow.yaml"]).unwrap();

    fs::write(root.join("targets/one.yaml"), "name: edited in place\n").unwrap();
    binding
        .verify()
        .expect("Git symlink entries do not include resolved target content");

    symlink("targets/one.yaml", root.join("replacement-flow.yaml")).unwrap();
    fs::rename(root.join("replacement-flow.yaml"), root.join("flow.yaml")).unwrap();
    assert_eq!(binding.verify().unwrap_err().code, "git_pair_changed");

    let binding = super::mutate::PairPathBinding::capture(root, &["flow.yaml"]).unwrap();
    fs::write(root.join("targets/replacement.yaml"), "name: replacement\n").unwrap();
    fs::rename(
        root.join("targets/replacement.yaml"),
        root.join("targets/one.yaml"),
    )
    .unwrap();
    assert_eq!(binding.verify().unwrap_err().code, "git_pair_changed");
}

#[test]
fn pair_binding_rejects_a_replaced_capability_root_even_with_the_same_file_inode() {
    let parent = tempdir().unwrap();
    let root = parent.path().join("repo");
    let parked = parent.path().join("parked-repo");
    fs::create_dir(&root).unwrap();
    git(&root, &["init", "-b", "main"]);
    fs::write(root.join("flow.yaml"), "name: retained\n").unwrap();
    let binding = super::mutate::PairPathBinding::capture(&root, &["flow.yaml"]).unwrap();

    fs::rename(&root, &parked).unwrap();
    fs::create_dir(&root).unwrap();
    git(&root, &["init", "-b", "main"]);
    fs::hard_link(parked.join("flow.yaml"), root.join("flow.yaml")).unwrap();

    assert_eq!(binding.verify().unwrap_err().code, "git_pair_changed");
}

#[cfg(unix)]
#[test]
fn untracked_safe_symlink_preview_uses_link_mode_and_target_bytes() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    fs::create_dir(root.join("targets")).unwrap();
    fs::write(
        root.join("targets/definition.yaml"),
        "name: resolved target\n",
    )
    .unwrap();
    symlink("targets/definition.yaml", root.join("flow.yaml")).unwrap();

    let (diff, binding) = super::mutate::preview_pair_version(root, "flow.yaml", None).unwrap();

    assert!(diff.contains("new file mode 120000"));
    assert!(diff.contains("+targets/definition.yaml"));
    assert!(!diff.contains("+name: resolved target"));
    binding.verify().unwrap();
}

#[cfg(unix)]
#[test]
fn symlink_binding_rejects_escape_directory_broken_and_nested_workspace_escape() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let root = directory.path();
    let workspace = root.join("workspace");
    let outside = tempdir().unwrap();
    fs::create_dir(&workspace).unwrap();
    fs::write(root.join("elsewhere.yaml"), "name: elsewhere\n").unwrap();
    fs::write(outside.path().join("outside.yaml"), "name: outside\n").unwrap();
    git(root, &["init", "-b", "main"]);

    symlink("../elsewhere.yaml", workspace.join("flow.yaml")).unwrap();
    assert_eq!(
        super::mutate::PairPathBinding::capture_in_workspace(root, &workspace, &["flow.yaml"],)
            .err()
            .expect("a link outside the selected nested workspace must reject")
            .code,
        "git_pair_unavailable"
    );
    fs::remove_file(workspace.join("flow.yaml")).unwrap();

    for target in [
        outside.path().join("outside.yaml"),
        workspace.join("missing.yaml"),
        workspace.clone(),
    ] {
        symlink(&target, workspace.join("flow.yaml")).unwrap();
        assert_eq!(
            super::mutate::PairPathBinding::capture_in_workspace(root, &workspace, &["flow.yaml"],)
                .err()
                .expect("unsafe, broken, and directory links must reject")
                .code,
            "git_pair_unavailable"
        );
        fs::remove_file(workspace.join("flow.yaml")).unwrap();
    }
}

#[cfg(unix)]
#[test]
fn authorized_pair_rejects_a_safe_symlink_swapped_to_escape_before_staging() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let root = directory.path();
    let outside = tempdir().unwrap();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("target.yaml"), "name: contained\n").unwrap();
    fs::write(outside.path().join("outside.yaml"), "name: outside\n").unwrap();
    symlink("target.yaml", root.join("flow.yaml")).unwrap();
    let (_, binding, base) =
        super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();
    let before_index = fs::read(root.join(".git/index")).ok();
    fs::remove_file(root.join("flow.yaml")).unwrap();
    symlink(outside.path().join("outside.yaml"), root.join("flow.yaml")).unwrap();

    let error = super::mutate::create_pair_version_with_guard(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || binding.verify(),
    )
    .err()
    .expect("unsafe replacement must reject before candidate staging");

    assert_eq!(error.code, "git_pair_unavailable");
    assert!(!Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--verify", "HEAD"])
        .status()
        .unwrap()
        .success());
    assert_eq!(fs::read(root.join(".git/index")).ok(), before_index);
}

#[cfg(unix)]
#[test]
fn candidate_staging_never_hashes_a_path_swapped_through_an_escaping_parent_link() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let root = directory.path();
    let outside = tempdir().unwrap();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::create_dir(root.join("flows")).unwrap();
    fs::write(root.join("flows/flow.yaml"), "name: accepted inside\n").unwrap();
    fs::write(
        outside.path().join("flow.yaml"),
        "name: must never be hashed\n",
    )
    .unwrap();
    let outside_oid = git_output(
        outside.path(),
        &[
            "hash-object",
            outside.path().join("flow.yaml").to_str().unwrap(),
        ],
    );
    let base = super::mutate::GitBase::capture(root).unwrap();

    let error = super::mutate::create_pair_version_with_stage_interleave_for_test(
        root,
        &root.join(".git"),
        &base,
        "flows/flow.yaml",
        None,
        "version",
        || {
            fs::rename(root.join("flows"), root.join("accepted-flows")).unwrap();
            symlink(outside.path(), root.join("flows")).unwrap();
            Ok(())
        },
    )
    .err()
    .expect("the swapped path must reject before publication");

    assert!(!error.code.is_empty());
    assert!(!Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["cat-file", "-e", outside_oid.trim()])
        .status()
        .unwrap()
        .success());
    assert!(!Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--verify", "HEAD"])
        .status()
        .unwrap()
        .success());
}

#[test]
fn pair_version_authorization_is_exact_single_use_and_rejects_replacement() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    fs::write(root.join("flow.yaml"), "name: first\n").unwrap();
    fs::write(root.join("other.yaml"), "name: other\n").unwrap();
    let context = super::AuthorizedGitContext::bind(root, root).unwrap();
    let state = super::GitState::default();
    state.activate_history_session(1).unwrap();

    let (_, binding) = super::mutate::preview_pair_version(root, "flow.yaml", None).unwrap();
    let request = state.begin_version(1, 1).unwrap();
    let token = state
        .issue_version(
            request,
            super::VersionAuthorization::from_preview(
                &context,
                "flow.yaml".to_owned(),
                None,
                binding,
                super::mutate::GitBase::capture(root).unwrap(),
            ),
        )
        .unwrap();
    state.retain_version(1, 1, &token).unwrap();
    assert_eq!(
        state
            .consume_version(&token, &context, "other.yaml", None)
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );
    assert_eq!(
        state
            .consume_version(&token, &context, "flow.yaml", None)
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );

    let (_, binding) = super::mutate::preview_pair_version(root, "flow.yaml", None).unwrap();
    let request = state.begin_version(1, 2).unwrap();
    let token = state
        .issue_version(
            request,
            super::VersionAuthorization::from_preview(
                &context,
                "flow.yaml".to_owned(),
                None,
                binding,
                super::mutate::GitBase::capture(root).unwrap(),
            ),
        )
        .unwrap();
    state.retain_version(1, 2, &token).unwrap();
    fs::rename(root.join("flow.yaml"), root.join("parked.yaml")).unwrap();
    fs::write(root.join("flow.yaml"), "name: replacement\n").unwrap();
    assert_eq!(
        state
            .consume_version(&token, &context, "flow.yaml", None)
            .err()
            .unwrap()
            .code,
        "git_pair_changed"
    );

    let other = tempdir().unwrap();
    git(other.path(), &["init", "-b", "main"]);
    fs::write(other.path().join("flow.yaml"), "name: other root\n").unwrap();
    let other_context = super::AuthorizedGitContext::bind(other.path(), other.path()).unwrap();
    let (_, binding) = super::mutate::preview_pair_version(root, "flow.yaml", None).unwrap();
    let request = state.begin_version(1, 3).unwrap();
    let token = state
        .issue_version(
            request,
            super::VersionAuthorization::from_preview(
                &context,
                "flow.yaml".to_owned(),
                None,
                binding,
                super::mutate::GitBase::capture(root).unwrap(),
            ),
        )
        .unwrap();
    state.retain_version(1, 3, &token).unwrap();
    assert_eq!(
        state
            .consume_version(&token, &other_context, "flow.yaml", None)
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );
}

#[test]
fn newer_version_request_retains_the_winner_despite_stale_retain_and_late_issue() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    fs::write(root.join("old.yaml"), "name: old\n").unwrap();
    fs::write(root.join("new.yaml"), "name: new\n").unwrap();
    let context = super::AuthorizedGitContext::bind(root, root).unwrap();
    let state = super::GitState::default();
    state.activate_history_session(7).unwrap();

    let old_request = state.begin_version(7, 1).unwrap();
    let (_, old_binding, old_base) =
        super::mutate::preview_pair_version_authorized(root, "old.yaml", None).unwrap();
    let old_authorization = super::VersionAuthorization::from_preview(
        &context,
        "old.yaml".to_owned(),
        None,
        old_binding,
        old_base,
    );
    let old_token = state.issue_version(old_request, old_authorization).unwrap();

    let new_request = state.begin_version(7, 2).unwrap();
    let (_, new_binding, new_base) =
        super::mutate::preview_pair_version_authorized(root, "new.yaml", None).unwrap();
    let new_authorization = super::VersionAuthorization::from_preview(
        &context,
        "new.yaml".to_owned(),
        None,
        new_binding,
        new_base,
    );
    let new_token = state.issue_version(new_request, new_authorization).unwrap();
    state.retain_version(7, 2, &new_token).unwrap();

    assert_eq!(
        state.retain_version(7, 1, &old_token).unwrap_err().code,
        "git_context_changed"
    );
    let (_, late_binding, late_base) =
        super::mutate::preview_pair_version_authorized(root, "old.yaml", None).unwrap();
    let late = super::VersionAuthorization::from_preview(
        &context,
        "old.yaml".to_owned(),
        None,
        late_binding,
        late_base,
    );
    assert_eq!(
        state.issue_version(old_request, late).unwrap_err().code,
        "git_context_changed"
    );
    assert!(state
        .consume_version(&new_token, &context, "new.yaml", None)
        .is_ok());
    assert_eq!(
        state
            .consume_version(&new_token, &context, "new.yaml", None)
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );
}

#[test]
fn disposing_version_session_revokes_pending_and_retained_authority() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    fs::write(root.join("flow.yaml"), "name: flow\n").unwrap();
    let context = super::AuthorizedGitContext::bind(root, root).unwrap();
    let state = super::GitState::default();
    state.activate_history_session(9).unwrap();
    let request = state.begin_version(9, 1).unwrap();
    let (_, binding, base) =
        super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();
    let token = state
        .issue_version(
            request,
            super::VersionAuthorization::from_preview(
                &context,
                "flow.yaml".to_owned(),
                None,
                binding,
                base,
            ),
        )
        .unwrap();
    state.retain_version(9, 1, &token).unwrap();
    state.dispose_history_session(9).unwrap();

    assert_eq!(
        state
            .consume_version(&token, &context, "flow.yaml", None)
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );
    assert!(state.version.lock().unwrap().pending.is_empty());
    assert!(state.version.lock().unwrap().retained.is_empty());
}

#[test]
fn prospective_pair_preview_combines_staged_unstaged_and_deletion_without_unrelated_paths() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: original\n").unwrap();
    fs::write(root.join("flow.hermes.yaml"), "profile: original\n").unwrap();
    fs::write(root.join("unrelated.txt"), "secret original\n").unwrap();
    commit_all(root, "initial");
    fs::write(root.join("flow.yaml"), "name: staged\n").unwrap();
    git(root, &["add", "flow.yaml"]);
    fs::write(root.join("flow.yaml"), "name: final unstaged\n").unwrap();
    fs::remove_file(root.join("flow.hermes.yaml")).unwrap();
    fs::write(root.join("unrelated.txt"), "secret changed\n").unwrap();

    let (diff, _) =
        super::mutate::preview_pair_version(root, "flow.yaml", Some("flow.hermes.yaml")).unwrap();

    assert!(diff.contains("name: final unstaged"));
    assert!(diff.contains("profile: original"));
    assert!(!diff.contains("secret changed"));
    assert!(!diff.contains("unrelated.txt"));
}

#[test]
fn unborn_pair_preview_recovers_after_rejected_hook_left_intent_to_add_entries() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: unborn\n").unwrap();
    fs::write(root.join("flow.hermes.yaml"), "profile: unborn\n").unwrap();
    fs::write(root.join("unrelated.txt"), "leave untracked\n").unwrap();
    let hook = root.join(".git/hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh\necho rejected >&2\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }

    let (first_diff, _) =
        super::mutate::preview_pair_version(root, "flow.yaml", Some("flow.hermes.yaml")).unwrap();
    assert!(first_diff.contains("+name: unborn"));
    assert!(first_diff.contains("+profile: unborn"));
    assert_eq!(
        super::mutate::create_pair_version(
            root,
            "flow.yaml",
            Some("flow.hermes.yaml"),
            "rejected",
        )
        .unwrap_err()
        .code,
        "git_commit_rejected"
    );
    assert!(!Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--verify", "HEAD"])
        .status()
        .unwrap()
        .success());

    fs::remove_file(&hook).unwrap();
    let (retry_diff, _) =
        super::mutate::preview_pair_version(root, "flow.yaml", Some("flow.hermes.yaml")).unwrap();
    assert!(retry_diff.contains("+name: unborn"));
    assert!(retry_diff.contains("+profile: unborn"));
    let version =
        super::mutate::create_pair_version(root, "flow.yaml", Some("flow.hermes.yaml"), "retry")
            .unwrap();
    assert_eq!(
        version.committed_oid().expect("version must be committed"),
        git_output(root, &["rev-parse", "HEAD"]).trim()
    );
    assert_eq!(
        git_output(root, &["show", "HEAD:flow.yaml"]),
        "name: unborn\n"
    );
    assert!(root.join("unrelated.txt").exists());
    assert!(!git_output(root, &["status", "--porcelain", "--", "unrelated.txt"]).is_empty());
}

#[test]
fn pair_version_rejects_head_advances_before_index_or_commit_mutation() {
    for advance_pair in [false, true] {
        let directory = tempdir().unwrap();
        let root = directory.path();
        git(root, &["init", "-b", "main"]);
        git(root, &["config", "user.name", "Workflow Test"]);
        git(root, &["config", "user.email", "workflow@example.test"]);
        fs::write(root.join("flow.yaml"), "name: initial\n").unwrap();
        fs::write(root.join("unrelated.txt"), "initial\n").unwrap();
        commit_all(root, "initial");
        fs::write(root.join("flow.yaml"), "name: authorized\n").unwrap();
        let (_, binding, base) =
            super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();

        if advance_pair {
            git(root, &["add", "flow.yaml"]);
            git(root, &["commit", "-m", "advance pair"]);
        } else {
            fs::write(root.join("unrelated.txt"), "advanced\n").unwrap();
            git(root, &["add", "unrelated.txt"]);
            git(root, &["commit", "-m", "advance unrelated"]);
        }
        let git_dir = git_output(root, &["rev-parse", "--absolute-git-dir"]);
        let index_path = Path::new(git_dir.trim()).join("index");
        let before_index = fs::read(&index_path).unwrap();
        let before_status =
            git_output(root, &["status", "--porcelain=v2", "--untracked-files=all"]);
        let before_pair = fs::read(root.join("flow.yaml")).unwrap();

        let error = super::mutate::create_pair_version_with_guard(
            root,
            Path::new(git_dir.trim()),
            &base,
            "flow.yaml",
            None,
            "must reject",
            || {
                binding.verify()?;
                base.verify(root)
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "git_base_changed");
        assert_eq!(fs::read(&index_path).unwrap(), before_index);
        assert_eq!(
            git_output(root, &["status", "--porcelain=v2", "--untracked-files=all"]),
            before_status
        );
        assert_eq!(fs::read(root.join("flow.yaml")).unwrap(), before_pair);
    }
}

#[test]
fn pair_version_rejects_unborn_to_born_transition_and_accepts_unchanged_head() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: unborn authorized\n").unwrap();
    let (_, binding, base) =
        super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();
    fs::write(root.join("unrelated.txt"), "born\n").unwrap();
    git(root, &["add", "unrelated.txt"]);
    git(root, &["commit", "-m", "birth"]);
    let before_status = git_output(root, &["status", "--porcelain=v2", "--untracked-files=all"]);

    let error = super::mutate::create_pair_version_with_guard(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "must reject birth",
        || {
            binding.verify()?;
            base.verify(root)
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "git_base_changed");
    assert_eq!(
        git_output(root, &["status", "--porcelain=v2", "--untracked-files=all"]),
        before_status
    );

    let (_, binding, base) =
        super::mutate::preview_pair_version_authorized(root, "flow.yaml", None).unwrap();
    let version = super::mutate::create_pair_version_with_guard(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "same head",
        || {
            binding.verify()?;
            base.verify(root)
        },
    )
    .unwrap();
    assert_eq!(
        version.committed_oid().expect("version must be committed"),
        git_output(root, &["rev-parse", "HEAD"]).trim()
    );
}

#[test]
fn ref_update_failure_is_classified_from_the_exact_bound_ref() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    let base = super::mutate::GitBase::capture(root).unwrap();
    let failed = || Err(super::GitError::new("git_timeout", "update-ref timed out"));

    assert!(matches!(
        super::mutate::classify_ref_update(root, &base, &"b".repeat(40), failed()).unwrap(),
        super::mutate::RefUpdateOutcome::NotCommitted(_)
    ));

    fs::write(root.join("flow.yaml"), "name: candidate\n").unwrap();
    commit_all(root, "candidate");
    let candidate = git_output(root, &["rev-parse", "HEAD"]).trim().to_owned();
    assert!(matches!(
        super::mutate::classify_ref_update(root, &base, &candidate, failed()).unwrap(),
        super::mutate::RefUpdateOutcome::Committed { warning: Some(_) }
    ));

    let divergent_base = super::mutate::GitBase::capture(root).unwrap();
    fs::write(root.join("flow.yaml"), "name: divergent\n").unwrap();
    commit_all(root, "divergent");
    assert!(matches!(
        super::mutate::classify_ref_update(root, &divergent_base, &"c".repeat(40), failed())
            .unwrap(),
        super::mutate::RefUpdateOutcome::Unknown
    ));
    assert!(matches!(
        super::mutate::classify_ref_update(
            &root.join("missing-repository"),
            &divergent_base,
            &"d".repeat(40),
            failed(),
        )
        .unwrap(),
        super::mutate::RefUpdateOutcome::Unknown
    ));
}

#[test]
fn normalized_index_lock_observes_a_publisher_immediately_before_acquisition() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    fs::write(root.join("unrelated.txt"), "base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("unrelated.txt"), "newly staged\n").unwrap();
    let index_path = root.join(".git/index");
    let original = fs::read(&index_path).unwrap();

    let error = super::mutate::PreparedIndexLock::prepare_with_interleave(
        &index_path,
        Some(&original),
        &original,
        || {
            git(root, &["add", "unrelated.txt"]);
            Ok(())
        },
        || Ok(()),
    )
    .err()
    .expect("a publisher before lock acquisition must invalidate the captured index");

    assert_eq!(error.code, "git_index_changed");
    assert!(git_output(root, &["diff", "--cached", "--name-only"]).contains("unrelated.txt"));
    assert!(!root.join(".git/index.lock").exists());
}

#[test]
fn normalized_index_lock_blocks_a_publisher_after_acquisition() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    fs::write(root.join("unrelated.txt"), "base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("unrelated.txt"), "must remain unstaged\n").unwrap();
    let index_path = root.join(".git/index");
    let original = fs::read(&index_path).unwrap();
    let mut publisher_was_blocked = false;

    let prepared = super::mutate::PreparedIndexLock::prepare_with_interleave(
        &index_path,
        Some(&original),
        &original,
        || Ok(()),
        || {
            let output = Command::new("git")
                .arg("-C")
                .arg(root)
                .args(["add", "unrelated.txt"])
                .output()
                .unwrap();
            publisher_was_blocked = !output.status.success();
            Ok(())
        },
    )
    .unwrap();

    assert!(publisher_was_blocked);
    assert_eq!(fs::read(&index_path).unwrap(), original);
    assert!(root.join(".git/index.lock").exists());
    drop(prepared);
    assert!(!root.join(".git/index.lock").exists());
    assert!(git_output(root, &["diff", "--cached", "--name-only"]).is_empty());
}

#[test]
fn normalized_index_lock_preserves_contended_locks_it_does_not_own() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    git(root, &["add", "flow.yaml"]);
    let index_path = root.join(".git/index");
    let original = fs::read(&index_path).unwrap();
    let lock_path = root.join(".git/index.lock");
    fs::write(&lock_path, b"other publisher").unwrap();

    let error = super::mutate::PreparedIndexLock::prepare_with_interleave(
        &index_path,
        Some(&original),
        &original,
        || Ok(()),
        || panic!("a contended lock must never run the held-lock hook"),
    )
    .err()
    .expect("an index lock owned by another publisher must reject publication");

    assert_eq!(error.code, "git_index_changed");
    assert_eq!(fs::read(&lock_path).unwrap(), b"other publisher");
}

#[test]
fn normalized_index_lock_drop_preserves_a_replacement_path_it_does_not_own() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    git(root, &["add", "flow.yaml"]);
    let index_path = root.join(".git/index");
    let original = fs::read(&index_path).unwrap();
    let lock_path = root.join(".git/index.lock");
    let parked_owned_lock = root.join(".git/parked-owned-index.lock");

    let error = super::mutate::PreparedIndexLock::prepare_with_interleave(
        &index_path,
        Some(&original),
        &original,
        || Ok(()),
        || {
            fs::rename(&lock_path, &parked_owned_lock).unwrap();
            fs::write(&lock_path, b"foreign publisher").unwrap();
            Ok(())
        },
    )
    .err()
    .expect("preparation must reject when its acquired lock is replaced");

    assert_eq!(error.code, "git_index_changed");
    assert_eq!(fs::read(&lock_path).unwrap(), b"foreign publisher");
    assert!(parked_owned_lock.exists());
    assert_eq!(fs::read(&index_path).unwrap(), original);
}

#[test]
fn normalized_index_lock_drop_after_prepare_preserves_a_foreign_replacement() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    git(root, &["add", "flow.yaml"]);
    let index_path = root.join(".git/index");
    let original = fs::read(&index_path).unwrap();
    let lock_path = root.join(".git/index.lock");
    let parked_owned_lock = root.join(".git/parked-prepared-index.lock");
    let prepared = super::mutate::PreparedIndexLock::prepare_with_interleave(
        &index_path,
        Some(&original),
        &original,
        || Ok(()),
        || Ok(()),
    )
    .unwrap();

    fs::rename(&lock_path, &parked_owned_lock).unwrap();
    fs::write(&lock_path, &original).unwrap();
    drop(prepared);

    assert_eq!(fs::read(&lock_path).unwrap(), original);
    assert!(parked_owned_lock.exists());
}

#[cfg(unix)]
#[test]
fn normalized_index_lock_rejects_a_symlink_to_its_parked_owned_file() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    git(root, &["add", "flow.yaml"]);
    let index_path = root.join(".git/index");
    let original = fs::read(&index_path).unwrap();
    let lock_path = root.join(".git/index.lock");
    let parked_owned_lock = root.join(".git/parked-symlink-target.lock");

    let error = super::mutate::PreparedIndexLock::prepare_with_interleave(
        &index_path,
        Some(&original),
        &original,
        || Ok(()),
        || {
            fs::rename(&lock_path, &parked_owned_lock).unwrap();
            symlink(&parked_owned_lock, &lock_path).unwrap();
            Ok(())
        },
    )
    .err()
    .expect("a symlink pathname cannot retain index lock ownership");

    assert_eq!(error.code, "git_index_changed");
    assert!(fs::symlink_metadata(&lock_path)
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(parked_owned_lock.exists());
}

#[test]
fn pair_version_rejects_an_index_lock_replaced_before_ref_publication() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    let index_path = root.join(".git/index");
    let lock_path = root.join(".git/index.lock");
    let parked_owned_lock = root.join(".git/parked-owned-index.lock");
    let before_index = fs::read(&index_path).unwrap();
    let before_head = git_output(root, &["rev-parse", "HEAD"]);
    let base = super::mutate::GitBase::capture(root).unwrap();

    let error = super::mutate::create_pair_version_with_index_interleave_for_test(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || Ok(()),
        || {
            fs::rename(&lock_path, &parked_owned_lock).unwrap();
            fs::write(&lock_path, b"foreign publisher").unwrap();
            Ok(())
        },
    )
    .err()
    .expect("lock replacement must reject before ref publication");

    assert_eq!(error.code, "git_index_changed");
    assert_eq!(git_output(root, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert_eq!(fs::read(&lock_path).unwrap(), b"foreign publisher");
    assert!(parked_owned_lock.exists());
}

#[test]
fn pair_version_rejects_an_index_lock_replaced_immediately_before_ref_update() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    let index_path = root.join(".git/index");
    let lock_path = root.join(".git/index.lock");
    let parked_owned_lock = root.join(".git/pre-ref-owned-index.lock");
    let before_index = fs::read(&index_path).unwrap();
    let before_head = git_output(root, &["rev-parse", "HEAD"]);
    let base = super::mutate::GitBase::capture(root).unwrap();

    let error = super::mutate::create_pair_version_with_lock_identity_interleave_for_test(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            fs::rename(&lock_path, &parked_owned_lock).unwrap();
            fs::write(&lock_path, b"foreign pre-ref publisher").unwrap();
            Ok(())
        },
        || panic!("the ref must not publish after lock ownership is lost"),
    )
    .err()
    .expect("lock replacement at the final pre-ref guard must reject");

    assert_eq!(error.code, "git_index_changed");
    assert_eq!(git_output(root, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert_eq!(fs::read(&lock_path).unwrap(), b"foreign pre-ref publisher");
}

#[test]
fn pair_version_reports_committed_when_index_lock_is_replaced_before_index_rename() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    let index_path = root.join(".git/index");
    let lock_path = root.join(".git/index.lock");
    let parked_owned_lock = root.join(".git/post-ref-owned-index.lock");
    let before_index = fs::read(&index_path).unwrap();
    let before_head = git_output(root, &["rev-parse", "HEAD"]);
    let base = super::mutate::GitBase::capture(root).unwrap();

    let result = super::mutate::create_pair_version_with_lock_identity_interleave_for_test(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || Ok(()),
        || {
            assert_ne!(git_output(root, &["rev-parse", "HEAD"]), before_head);
            fs::rename(&lock_path, &parked_owned_lock).unwrap();
            fs::write(&lock_path, b"foreign post-ref publisher").unwrap();
            Ok(())
        },
    )
    .expect("a known published ref must return an explicit committed outcome");

    match result {
        super::mutate::GitVersionResult::Committed { oid, warnings, .. } => {
            assert_eq!(oid, git_output(root, &["rev-parse", "HEAD"]).trim());
            assert!(warnings.iter().any(|warning| warning.contains("index")));
        }
        super::mutate::GitVersionResult::Unknown { .. } => {
            panic!("a known published ref cannot become retryable or unknown")
        }
    }
    assert_eq!(fs::read(&index_path).unwrap(), before_index);
    assert_eq!(fs::read(&lock_path).unwrap(), b"foreign post-ref publisher");
}

#[test]
fn pair_version_rejects_a_real_index_publish_immediately_before_its_lock() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    fs::write(root.join("unrelated.txt"), "base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    fs::write(root.join("unrelated.txt"), "newly staged\n").unwrap();
    let before_head = git_output(root, &["rev-parse", "HEAD"]);
    let base = super::mutate::GitBase::capture(root).unwrap();

    let error = super::mutate::create_pair_version_with_index_interleave_for_test(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            git(root, &["add", "unrelated.txt"]);
            Ok(())
        },
        || Ok(()),
    )
    .err()
    .expect("a newer real index must reject pair version publication");

    assert_eq!(error.code, "git_index_changed");
    assert_eq!(git_output(root, &["rev-parse", "HEAD"]), before_head);
    assert!(git_output(root, &["diff", "--cached", "--name-only"]).contains("unrelated.txt"));
    assert!(!root.join(".git/index.lock").exists());
}

#[test]
fn linked_pair_version_holds_only_its_bound_index_lock_before_ref_publication() {
    let directory = tempdir().unwrap();
    let main = directory.path().join("main");
    let linked = directory.path().join("linked");
    fs::create_dir(&main).unwrap();
    git(&main, &["init", "-b", "main"]);
    git(&main, &["config", "user.name", "Workflow Test"]);
    git(&main, &["config", "user.email", "workflow@example.test"]);
    fs::write(main.join("flow.yaml"), "name: base\n").unwrap();
    fs::write(main.join("unrelated.txt"), "base\n").unwrap();
    commit_all(&main, "base");
    git(
        &main,
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );
    fs::write(linked.join("flow.yaml"), "name: accepted\n").unwrap();
    fs::write(linked.join("unrelated.txt"), "must remain unstaged\n").unwrap();
    let metadata = super::detect_repository_metadata(&linked)
        .unwrap()
        .expect("linked repository metadata");
    let linked_index = metadata.worktree_dir.join("index");
    let main_index = main.join(".git/index");
    let before_main_index = fs::read(&main_index).unwrap();
    let before_head = git_output(&linked, &["rev-parse", "HEAD"]);
    let base = super::mutate::GitBase::capture(&linked).unwrap();
    let mut publisher_was_blocked = false;

    let version = super::mutate::create_pair_version_with_index_interleave_for_test(
        &linked,
        &metadata.worktree_dir,
        &base,
        "flow.yaml",
        None,
        "version",
        || Ok(()),
        || {
            assert!(linked_index.with_extension("lock").exists());
            assert!(!main_index.with_extension("lock").exists());
            assert_eq!(git_output(&linked, &["rev-parse", "HEAD"]), before_head);
            let output = Command::new("git")
                .arg("-C")
                .arg(&linked)
                .args(["add", "unrelated.txt"])
                .output()
                .unwrap();
            publisher_was_blocked = !output.status.success();
            Ok(())
        },
    )
    .unwrap();

    assert!(publisher_was_blocked);
    assert!(version.committed_oid().is_some());
    assert_ne!(git_output(&linked, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(&main_index).unwrap(), before_main_index);
    assert!(!linked_index.with_extension("lock").exists());
    assert!(git_output(&linked, &["diff", "--cached", "--name-only"]).is_empty());
    assert!(git_output(&linked, &["diff", "--name-only"]).contains("unrelated.txt"));
}

#[test]
fn linked_pair_version_preserves_both_indexes_when_its_lock_is_replaced_post_ref() {
    let directory = tempdir().unwrap();
    let main = directory.path().join("main");
    let linked = directory.path().join("linked");
    fs::create_dir(&main).unwrap();
    git(&main, &["init", "-b", "main"]);
    git(&main, &["config", "user.name", "Workflow Test"]);
    git(&main, &["config", "user.email", "workflow@example.test"]);
    fs::write(main.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(&main, "base");
    git(
        &main,
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );
    fs::write(linked.join("flow.yaml"), "name: accepted\n").unwrap();
    let metadata = super::detect_repository_metadata(&linked)
        .unwrap()
        .expect("linked repository metadata");
    let linked_index = metadata.worktree_dir.join("index");
    let linked_lock = linked_index.with_extension("lock");
    let parked_owned_lock = metadata.worktree_dir.join("parked-post-ref-index.lock");
    let main_index = main.join(".git/index");
    let before_main_index = fs::read(&main_index).unwrap();
    let before_linked_index = fs::read(&linked_index).unwrap();
    let before_head = git_output(&linked, &["rev-parse", "HEAD"]);
    let base = super::mutate::GitBase::capture(&linked).unwrap();

    let result = super::mutate::create_pair_version_with_lock_identity_interleave_for_test(
        &linked,
        &metadata.worktree_dir,
        &base,
        "flow.yaml",
        None,
        "version",
        || Ok(()),
        || {
            assert_ne!(git_output(&linked, &["rev-parse", "HEAD"]), before_head);
            assert!(!main_index.with_extension("lock").exists());
            fs::rename(&linked_lock, &parked_owned_lock).unwrap();
            fs::write(&linked_lock, b"foreign linked publisher").unwrap();
            Ok(())
        },
    )
    .unwrap();

    match result {
        super::mutate::GitVersionResult::Committed { warnings, .. } => {
            assert!(warnings.iter().any(|warning| warning.contains("index")));
        }
        super::mutate::GitVersionResult::Unknown { .. } => {
            panic!("known linked ref publication must remain committed")
        }
    }
    assert_eq!(fs::read(&main_index).unwrap(), before_main_index);
    assert_eq!(fs::read(&linked_index).unwrap(), before_linked_index);
    assert_eq!(fs::read(&linked_lock).unwrap(), b"foreign linked publisher");
}

#[test]
fn linked_pair_version_preserves_both_indexes_when_its_lock_is_replaced_pre_ref() {
    let directory = tempdir().unwrap();
    let main = directory.path().join("main");
    let linked = directory.path().join("linked");
    fs::create_dir(&main).unwrap();
    git(&main, &["init", "-b", "main"]);
    git(&main, &["config", "user.name", "Workflow Test"]);
    git(&main, &["config", "user.email", "workflow@example.test"]);
    fs::write(main.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(&main, "base");
    git(
        &main,
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );
    fs::write(linked.join("flow.yaml"), "name: accepted\n").unwrap();
    let metadata = super::detect_repository_metadata(&linked)
        .unwrap()
        .expect("linked repository metadata");
    let linked_index = metadata.worktree_dir.join("index");
    let linked_lock = linked_index.with_extension("lock");
    let parked_owned_lock = metadata.worktree_dir.join("parked-pre-ref-index.lock");
    let main_index = main.join(".git/index");
    let before_main_index = fs::read(&main_index).unwrap();
    let before_linked_index = fs::read(&linked_index).unwrap();
    let before_head = git_output(&linked, &["rev-parse", "HEAD"]);
    let base = super::mutate::GitBase::capture(&linked).unwrap();

    let error = super::mutate::create_pair_version_with_lock_identity_interleave_for_test(
        &linked,
        &metadata.worktree_dir,
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            assert!(!main_index.with_extension("lock").exists());
            fs::rename(&linked_lock, &parked_owned_lock).unwrap();
            fs::write(&linked_lock, b"foreign linked pre-ref publisher").unwrap();
            Ok(())
        },
        || panic!("linked ref must not publish after lock replacement"),
    )
    .err()
    .expect("linked index lock replacement must reject before ref publication");

    assert_eq!(error.code, "git_index_changed");
    assert_eq!(git_output(&linked, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(fs::read(&main_index).unwrap(), before_main_index);
    assert_eq!(fs::read(&linked_index).unwrap(), before_linked_index);
    assert_eq!(
        fs::read(&linked_lock).unwrap(),
        b"foreign linked pre-ref publisher"
    );
}

#[test]
fn post_publication_guard_failure_returns_committed_with_warning() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: base\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("flow.yaml"), "name: accepted\n").unwrap();
    let base = super::mutate::GitBase::capture(root).unwrap();
    let original_oid = base.parent().unwrap().to_owned();

    let result = super::mutate::create_pair_version_with_guard(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            let current = git_output(root, &["rev-parse", "HEAD"]);
            if current.trim() != original_oid {
                Err(super::GitError::new(
                    "git_repository_changed",
                    "metadata changed after publication",
                ))
            } else {
                Ok(())
            }
        },
    )
    .unwrap();

    match result {
        super::mutate::GitVersionResult::Committed { oid, warnings, .. } => {
            assert_eq!(oid, git_output(root, &["rev-parse", "HEAD"]).trim());
            assert!(warnings
                .iter()
                .any(|warning| warning.contains("metadata changed after publication")));
        }
        super::mutate::GitVersionResult::Unknown { .. } => panic!("published ref must be known"),
    }
}

#[test]
fn post_commit_timeout_and_status_failure_are_committed_warnings() {
    let post_warning = super::mutate::post_commit_warning(Err(super::GitError::new(
        "git_timeout",
        "post-commit timed out",
    )))
    .expect("post-commit failure must warn");
    assert!(post_warning.contains("committed"));
    assert!(post_warning.contains("timed out"));

    let (status, warning) = super::mutate::committed_status(Err(super::GitError::new(
        "git_status_failed",
        "status unavailable",
    )));
    assert!(status.is_none());
    assert!(warning.unwrap().contains("status unavailable"));
}

fn authorization(
    context: &AuthorizedGitContext,
    definition_path: impl Into<String>,
    by_oid: HashMap<String, HistoricalPaths>,
) -> HistoryAuthorization {
    HistoryAuthorization {
        workspace_root: context.workspace_root.clone(),
        workspace_identity: context.workspace_identity.clone(),
        repository_root: context.repository_root.clone(),
        repository_identity: context.repository_identity.clone(),
        definition_path: definition_path.into(),
        companion_path: None,
        by_oid,
    }
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
fn rejects_malformed_or_non_ascii_porcelain_status_bytes_without_panicking() {
    for bytes in [
        b"1 \xC3\xA9 N... 100644 100644 100644 abcdef1 abcdef2 flow.yaml\0".as_slice(),
        b"1 ZZ N... 100644 100644 100644 abcdef1 abcdef2 flow.yaml\0".as_slice(),
    ] {
        let result = std::panic::catch_unwind(|| parse_status(bytes));
        assert!(result.is_ok(), "malformed porcelain must never panic");
        assert_eq!(result.unwrap().unwrap_err().code, "git_output_invalid");
    }
}

#[test]
fn exact_pair_tree_entry_parser_rejects_unsupported_mode_type_and_path() {
    let oid = "a".repeat(40);
    for raw in [
        format!("160000 commit {oid}\tflow.yaml\0"),
        format!("040000 tree {oid}\tflow.yaml\0"),
        format!("100644 blob {oid}\tother.yaml\0"),
    ] {
        let error = super::mutate::parse_tree_entry(raw.as_bytes(), "flow.yaml")
            .err()
            .expect("unsupported tree semantics must reject the candidate");
        assert_eq!(error.code, "git_commit_candidate_changed");
    }

    let executable = super::mutate::parse_tree_entry(
        format!("100755 blob {oid}\tflow.yaml\0").as_bytes(),
        "flow.yaml",
    )
    .unwrap()
    .expect("exact executable blob entry");
    assert_eq!(executable.mode, "100755");
    assert_eq!(executable.oid, oid);
}

#[test]
fn parses_nul_delimited_history_records() {
    let bytes = b"\x00C\x000123456789abcdef\x0001234567890\x00Ada\x001785317200\x002026-07-29T10:00:00Z\x00update definition\x00\x00\nM\x00flow.yaml\x00\x00C\x00fedcba9876543210\x00fedcba987654\x00Lin\x001785227600\x002026-07-28T09:00:00Z\x00add companion\x00\x00\nA\x00flow.hermes.yaml\x00";

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
    git(root, &["add", "--all"]);
    git_with_dates(
        root,
        &["commit", "-m", "add definition"],
        "2026-07-29T09:00:00Z",
    );
    fs::write(
        root.join("flows/pair ü.hermes.yaml"),
        "language_compatibility: hermes-legacy\n",
    )
    .unwrap();
    git(root, &["add", "--all"]);
    git_with_dates(
        root,
        &["commit", "-m", "add companion"],
        "2026-07-29T10:00:00Z",
    );
    fs::write(root.join("unrelated.txt"), "outside pair\n").unwrap();
    git(root, &["add", "--all"]);
    git_with_dates(
        root,
        &["commit", "-m", "unrelated commit"],
        "2026-07-29T11:00:00Z",
    );
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

    git(root, &["add", "--all"]);
    git_with_dates(
        root,
        &["commit", "-m", "rename definition"],
        "2026-07-29T12:00:00Z",
    );

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
fn nested_workspace_paths_are_rebased_and_cannot_resolve_same_named_root_or_sibling_files() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::create_dir(root.join("selected")).unwrap();
    fs::write(root.join("flow.yaml"), "name: wrong root pair\n").unwrap();
    fs::write(root.join("sibling.yaml"), "name: sibling secret\n").unwrap();
    fs::write(root.join("selected/flow.yaml"), "name: selected pair\n").unwrap();
    commit_all(root, "initial");
    fs::write(root.join("selected/flow.yaml"), "name: selected changed\n").unwrap();
    fs::write(root.join("sibling.yaml"), "name: sibling changed\n").unwrap();

    let context = AuthorizedGitContext::bind(&root.join("selected"), root).unwrap();
    let pair_diff = context.diff_pair("flow.yaml", None).unwrap();
    assert!(pair_diff.working.contains("selected changed"));
    assert!(!pair_diff.working.contains("wrong root pair"));
    assert!(!pair_diff.working.contains("sibling changed"));

    let selected_status = context.status().unwrap();
    assert_eq!(selected_status.entries.len(), 1);
    assert_eq!(selected_status.entries[0].path, "flow.yaml");

    let oid = context.history_pair("flow.yaml", None).unwrap()[0]
        .oid
        .clone();
    let error = context
        .show_authorized_pair(&oid, "sibling.yaml", None)
        .unwrap_err();
    assert_eq!(error.code, "git_pair_not_authorized");
}

#[test]
fn nested_workspace_history_stops_when_a_tracked_path_crosses_in_from_a_sibling() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::create_dir(root.join("selected")).unwrap();
    fs::write(root.join("sibling.yaml"), "name: sibling history\n").unwrap();
    commit_all(root, "sibling-only history");
    git(root, &["mv", "sibling.yaml", "selected/flow.yaml"]);
    commit_all(root, "move into selected workspace");

    let context = AuthorizedGitContext::bind(&root.join("selected"), root).unwrap();
    let history = context.history_pair("flow.yaml", None).unwrap();
    assert_eq!(
        history
            .iter()
            .map(|commit| commit.subject.as_str())
            .collect::<Vec<_>>(),
        vec!["move into selected workspace"]
    );
}

#[test]
fn bound_context_rejects_workspace_and_repository_replacement_races() {
    let parent = tempdir().unwrap();
    let root = parent.path().join("repo");
    fs::create_dir(&root).unwrap();
    git(&root, &["init", "-b", "main"]);
    fs::create_dir(root.join("selected")).unwrap();
    let context = AuthorizedGitContext::bind(&root.join("selected"), &root).unwrap();

    fs::rename(root.join("selected"), root.join("parked-selected")).unwrap();
    fs::create_dir(root.join("selected")).unwrap();
    assert_eq!(context.verify().unwrap_err().code, "git_workspace_changed");

    let context = AuthorizedGitContext::bind(&root.join("selected"), &root).unwrap();
    let parked = parent.path().join("parked-repo");
    fs::rename(&root, &parked).unwrap();
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("selected")).unwrap();
    assert_eq!(context.verify().unwrap_err().code, "git_repository_changed");
}

#[test]
fn stale_native_history_authorization_cannot_publish_after_context_clear() {
    let root = tempdir().unwrap();
    git(root.path(), &["init", "-b", "main"]);
    let context = AuthorizedGitContext::bind(root.path(), root.path()).unwrap();
    let state = GitState::default();
    let controller_epoch = state.begin_history_session().unwrap();
    let request = state.begin_history(controller_epoch, 1).unwrap();
    state.clear();
    let error = state
        .issue_history(
            request,
            authorization(&context, "flow.yaml", Default::default()),
        )
        .unwrap_err();
    assert_eq!(error.code, "git_context_changed");
    let history = state.history.lock().unwrap();
    assert!(history.pending.is_empty());
    assert!(history.retained.is_empty());
}

#[test]
fn obsolete_pair_authorization_published_after_visible_pair_does_not_revoke_visible_pair() {
    let root = tempdir().unwrap();
    git(root.path(), &["init", "-b", "main"]);
    let context = AuthorizedGitContext::bind(root.path(), root.path()).unwrap();
    let state = GitState::default();

    let controller_epoch = state.begin_history_session().unwrap();
    let obsolete_request = state.begin_history(controller_epoch, 1).unwrap();
    let visible_request = state.begin_history(controller_epoch, 2).unwrap();
    let visible_token = state
        .issue_history(
            visible_request,
            authorization(&context, "visible.yaml", Default::default()),
        )
        .unwrap();
    state
        .retain_history(controller_epoch, 2, &visible_token)
        .unwrap();

    // The renderer has already selected the visible pair, but an obsolete request
    // only reaches the native command after that newer request has completed.
    let obsolete_error = state
        .issue_history(
            obsolete_request,
            authorization(&context, "obsolete.yaml", Default::default()),
        )
        .unwrap_err();
    assert_eq!(obsolete_error.code, "git_context_changed");

    assert!(state
        .authorized_history(&visible_token, &context, "visible.yaml", None)
        .is_ok());
    assert_eq!(
        state
            .authorized_history(
                &visible_token,
                &context,
                "visible.yaml",
                Some("obsolete.yaml")
            )
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );

    state.clear();
    assert_eq!(
        state
            .authorized_history(&visible_token, &context, "visible.yaml", None)
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );
}

#[test]
fn native_history_authorization_keeps_only_the_latest_renderer_generation() {
    let root = tempdir().unwrap();
    git(root.path(), &["init", "-b", "main"]);
    let context = AuthorizedGitContext::bind(root.path(), root.path()).unwrap();
    let state = GitState::default();
    let controller_epoch = state.begin_history_session().unwrap();
    let mut tokens = Vec::new();

    for index in 0..=HISTORY_AUTHORIZATION_LIMIT {
        let request_generation = index as u64 + 1;
        let request = state
            .begin_history(controller_epoch, request_generation)
            .unwrap();
        let token = state
            .issue_history(
                request,
                authorization(&context, format!("flow-{index}.yaml"), Default::default()),
            )
            .unwrap();
        state
            .retain_history(controller_epoch, request_generation, &token)
            .unwrap();
        tokens.push(token);
    }

    assert_eq!(state.history.lock().unwrap().retained.len(), 1);
    assert!(state
        .authorized_history(&tokens[0], &context, "flow-0.yaml", None)
        .is_err());
    assert!(state
        .authorized_history(
            tokens.last().unwrap(),
            &context,
            &format!("flow-{HISTORY_AUTHORIZATION_LIMIT}.yaml"),
            None,
        )
        .is_ok());
}

#[test]
fn renderer_retained_same_pair_token_survives_late_obsolete_publication_and_pressure() {
    let root = tempdir().unwrap();
    git(root.path(), &["init", "-b", "main"]);
    git(root.path(), &["config", "user.name", "Workflow Test"]);
    git(
        root.path(),
        &["config", "user.email", "workflow@example.test"],
    );
    fs::write(root.path().join("flow.yaml"), "name: A\n").unwrap();
    commit_all(root.path(), "version A");
    let context = AuthorizedGitContext::bind(root.path(), root.path()).unwrap();
    let (_, old_authorization) = context.history_pair_authorized("flow.yaml", None).unwrap();

    fs::write(root.path().join("flow.yaml"), "name: B\n").unwrap();
    commit_all(root.path(), "version B");
    let (new_commits, new_authorization) =
        context.history_pair_authorized("flow.yaml", None).unwrap();
    let new_oid = new_commits
        .iter()
        .find(|commit| commit.subject == "version B")
        .unwrap()
        .oid
        .clone();
    let state = GitState::default();

    let controller_epoch = state.begin_history_session().unwrap();
    let old_request = state.begin_history(controller_epoch, 1).unwrap();
    let winning_request = state.begin_history(controller_epoch, 2).unwrap();
    let winning_token = state
        .issue_history(winning_request, new_authorization)
        .unwrap();
    assert_eq!(winning_token.len(), 64);
    assert!(winning_token.bytes().all(|byte| byte.is_ascii_hexdigit()));
    state
        .retain_history(controller_epoch, 2, &winning_token)
        .unwrap();

    for index in 0..=HISTORY_AUTHORIZATION_LIMIT {
        assert_eq!(
            state
                .retain_history(controller_epoch, 1, &format!("obsolete-{index}"))
                .unwrap_err()
                .code,
            "git_context_changed"
        );
    }
    // The pre-mutation A request completes only after B won renderer publication.
    assert_eq!(
        state
            .issue_history(old_request, old_authorization)
            .unwrap_err()
            .code,
        "git_context_changed"
    );

    let authorization = state
        .authorized_history(&winning_token, &context, "flow.yaml", None)
        .unwrap();
    assert!(authorization.by_oid.contains_key(&new_oid));
    let snapshot =
        show_from_authorization(&context, &authorization, &new_oid, "flow.yaml", None).unwrap();
    assert_eq!(snapshot.definition.as_deref(), Some("name: B\n"));
    assert_eq!(
        show_from_authorization(&context, &authorization, "ffffffff", "flow.yaml", None)
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );
    assert_eq!(
        state
            .authorized_history(&winning_token, &context, "other.yaml", None,)
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );
    assert_eq!(
        state
            .authorized_history("obsolete", &context, "flow.yaml", None)
            .err()
            .unwrap()
            .code,
        "git_pair_not_authorized"
    );
}

#[test]
fn live_history_winner_survives_seventeen_late_stale_retain_completions() {
    let root = tempdir().unwrap();
    git(root.path(), &["init", "-b", "main"]);
    let context = AuthorizedGitContext::bind(root.path(), root.path()).unwrap();
    let state = GitState::default();
    let controller_epoch = state.begin_history_session().unwrap();

    let winning_generation = 18;
    let mut stale_tokens = Vec::new();
    for request_generation in 1..winning_generation {
        let request = state
            .begin_history(controller_epoch, request_generation)
            .unwrap();
        stale_tokens.push(
            state
                .issue_history(
                    request,
                    authorization(
                        &context,
                        format!("stale-{request_generation}.yaml"),
                        Default::default(),
                    ),
                )
                .unwrap(),
        );
    }
    let winning_request = state
        .begin_history(controller_epoch, winning_generation)
        .unwrap();
    let winning_token = state
        .issue_history(
            winning_request,
            authorization(&context, "winner.yaml", Default::default()),
        )
        .unwrap();
    state
        .retain_history(controller_epoch, winning_generation, &winning_token)
        .unwrap();

    // These represent retain RPCs from older renderer requests that crossed
    // their renderer-side staleness check before the live request won.
    assert_eq!(stale_tokens.len(), HISTORY_AUTHORIZATION_LIMIT + 1);
    for (index, token) in stale_tokens.iter().enumerate() {
        assert_eq!(
            state
                .retain_history(controller_epoch, (index + 1) as u64, token)
                .unwrap_err()
                .code,
            "git_context_changed"
        );
    }

    assert!(state
        .authorized_history(&winning_token, &context, "winner.yaml", None)
        .is_ok());
    let history = state.history.lock().unwrap();
    assert_eq!(history.retained.len(), 1);
    assert!(history.pending.is_empty());
}

#[test]
fn old_controller_cannot_activate_or_dispose_after_a_new_controller_mounts() {
    let root = tempdir().unwrap();
    git(root.path(), &["init", "-b", "main"]);
    let context = AuthorizedGitContext::bind(root.path(), root.path()).unwrap();
    let state = GitState::default();
    let old_epoch = state.begin_history_session().unwrap();
    let old_request = state.begin_history(old_epoch, 1).unwrap();
    let old_token = state
        .issue_history(
            old_request,
            authorization(&context, "old.yaml", Default::default()),
        )
        .unwrap();

    let new_epoch = state.begin_history_session().unwrap();
    let new_request = state.begin_history(new_epoch, 1).unwrap();
    let new_token = state
        .issue_history(
            new_request,
            authorization(&context, "new.yaml", Default::default()),
        )
        .unwrap();
    state.retain_history(new_epoch, 1, &new_token).unwrap();

    assert_eq!(
        state
            .retain_history(old_epoch, 1, &old_token)
            .unwrap_err()
            .code,
        "git_context_changed"
    );
    state.dispose_history_session(old_epoch).unwrap();
    assert!(state
        .authorized_history(&new_token, &context, "new.yaml", None)
        .is_ok());
}

#[test]
fn replaced_session_reports_pair_not_authorized_for_a_formerly_retained_preview_token() {
    let root = tempdir().unwrap();
    git(root.path(), &["init", "-b", "main"]);
    git(root.path(), &["config", "user.name", "Workflow Test"]);
    git(
        root.path(),
        &["config", "user.email", "workflow@example.test"],
    );
    fs::write(root.path().join("flow.yaml"), "name: retained\n").unwrap();
    commit_all(root.path(), "retained preview");

    let context = AuthorizedGitContext::bind(root.path(), root.path()).unwrap();
    let (commits, authorization) = context.history_pair_authorized("flow.yaml", None).unwrap();
    let oid = commits[0].oid.clone();
    let state = GitState::default();

    let first_epoch = state.begin_history_session().unwrap();
    let request = state.begin_history(first_epoch, 1).unwrap();
    let token = state.issue_history(request, authorization).unwrap();
    state.retain_history(first_epoch, 1, &token).unwrap();

    // A later renderer controller activates after the first controller published
    // its history. Activation revokes the old retained capability before preview.
    let replacement_epoch = state.begin_history_session().unwrap();
    let error =
        show_authorized_pair(&state, &context, &token, &oid, "flow.yaml", None).unwrap_err();

    assert_eq!(error.code, "git_pair_not_authorized");

    let (_, replacement_authorization) =
        context.history_pair_authorized("flow.yaml", None).unwrap();
    let replacement_request = state.begin_history(replacement_epoch, 1).unwrap();
    let revoked_token = state
        .issue_history(replacement_request, replacement_authorization)
        .unwrap();
    state
        .retain_history(replacement_epoch, 1, &revoked_token)
        .unwrap();
    state.revoke_history(&revoked_token).unwrap();
    assert_eq!(
        state
            .authorized_history(&revoked_token, &context, "flow.yaml", None)
            .err()
            .expect("revoked token must not remain authorized")
            .code,
        "git_pair_not_authorized"
    );
    let history = state.history.lock().unwrap();
    assert!(history.pending.is_empty());
    assert!(history.retained.is_empty());
}

#[test]
fn lower_server_epoch_cannot_activate_after_a_newer_session_even_if_it_completes_late() {
    let state = GitState::default();

    state.activate_history_session(2).unwrap();
    state.dispose_history_session(2).unwrap();

    assert_eq!(
        state.activate_history_session(1).unwrap_err().code,
        "git_context_changed"
    );
}

#[test]
fn retained_token_rejects_a_replacement_at_the_same_workspace_and_repository_paths() {
    let parent = tempdir().unwrap();
    let root = parent.path().join("repo");
    fs::create_dir(&root).unwrap();
    git(&root, &["init", "-b", "main"]);
    let original_context = AuthorizedGitContext::bind(&root, &root).unwrap();
    let state = GitState::default();
    let controller_epoch = state.begin_history_session().unwrap();
    let request = state.begin_history(controller_epoch, 1).unwrap();
    let token = state
        .issue_history(
            request,
            authorization(&original_context, "flow.yaml", Default::default()),
        )
        .unwrap();
    state.retain_history(controller_epoch, 1, &token).unwrap();

    fs::rename(&root, parent.path().join("parked-repo")).unwrap();
    fs::create_dir(&root).unwrap();
    git(&root, &["init", "-b", "main"]);
    let replacement_context = AuthorizedGitContext::bind(&root, &root).unwrap();

    assert_eq!(
        state
            .authorized_history(&token, &replacement_context, "flow.yaml", None)
            .err()
            .expect("a token must not cross stable directory identities")
            .code,
        "git_pair_not_authorized"
    );
}

#[test]
fn history_uses_numeric_epochs_and_pre_rename_paths_for_snapshots() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("old.yaml"), "name: before rename\n").unwrap();
    git(root, &["add", "--all"]);
    git_with_dates(
        root,
        &["commit", "-m", "older local date"],
        "2026-07-29T23:30:00+14:00",
    );
    git(root, &["mv", "old.yaml", "new.yaml"]);
    git_with_dates(
        root,
        &["commit", "-m", "newer absolute time"],
        "2026-07-29T00:30:00-10:00",
    );

    let context = AuthorizedGitContext::bind(root, root).unwrap();
    let history = context.history_pair("new.yaml", None).unwrap();
    assert_eq!(history[0].subject, "newer absolute time");
    assert_eq!(history[1].subject, "older local date");
    let old = context
        .show_authorized_pair(&history[1].oid, "new.yaml", None)
        .unwrap();
    assert_eq!(old.definition.as_deref(), Some("name: before rename\n"));
}

#[test]
fn pre_rename_pair_preview_uses_topology_when_display_timestamps_tie() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("old.yaml"), "name: before rename\n").unwrap();
    fs::write(root.join("flow.hermes.yaml"), "version: one\n").unwrap();
    git(root, &["add", "--all"]);
    git_with_dates(
        root,
        &["commit", "-m", "initial pair"],
        "2026-07-29T09:00:00Z",
    );
    fs::write(root.join("flow.hermes.yaml"), "version: two\n").unwrap();
    git(root, &["add", "--all"]);
    git_with_dates(
        root,
        &["commit", "-m", "companion before rename"],
        "2026-07-29T10:00:00Z",
    );
    git(root, &["mv", "old.yaml", "new.yaml"]);
    git_with_dates(
        root,
        &["commit", "-m", "rename with tied time"],
        "2026-07-29T10:00:00Z",
    );

    let context = AuthorizedGitContext::bind(root, root).unwrap();
    let history = context
        .history_pair("new.yaml", Some("flow.hermes.yaml"))
        .unwrap();
    let before_rename = history
        .iter()
        .find(|commit| commit.subject == "companion before rename")
        .unwrap();
    let snapshot = context
        .show_authorized_pair(&before_rename.oid, "new.yaml", Some("flow.hermes.yaml"))
        .unwrap();
    assert_eq!(
        snapshot.definition.as_deref(),
        Some("name: before rename\n")
    );
    assert_eq!(snapshot.companion.as_deref(), Some("version: two\n"));
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
fn read_only_historical_show_remains_replacement_aware() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Workflow Test"]);
    git(root, &["config", "user.email", "workflow@example.test"]);
    fs::write(root.join("flow.yaml"), "name: original\n").unwrap();
    commit_all(root, "base");
    fs::write(root.join("replacement.txt"), "name: replacement\n").unwrap();
    let head = git_output(root, &["rev-parse", "HEAD"]);
    let original_blob = git_output(root, &["rev-parse", "HEAD:flow.yaml"]);
    let replacement_blob = git_output(root, &["hash-object", "-w", "replacement.txt"]);
    git(
        root,
        &["replace", original_blob.trim(), replacement_blob.trim()],
    );

    let snapshot = show_pair(root, head.trim(), "flow.yaml", None).unwrap();

    assert_eq!(snapshot.definition.as_deref(), Some("name: replacement\n"));
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
fn pair_version_rejects_a_file_replaced_after_preflight_before_index_mutation() {
    let directory = tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "--local", "user.name", "Fixture"]);
    git(
        root,
        &["config", "--local", "user.email", "fixture@example.test"],
    );
    fs::write(root.join("flow.yaml"), "name: original\n").unwrap();
    let context = AuthorizedGitContext::bind(root, root).unwrap();
    let base = super::mutate::GitBase::capture(root).unwrap();
    let mut replaced = false;

    let error = super::mutate::create_pair_version_with_guard(
        root,
        &root.join(".git"),
        &base,
        "flow.yaml",
        None,
        "version",
        || {
            context.verify()?;
            if !replaced {
                fs::rename(root.join("flow.yaml"), root.join("original.yaml")).unwrap();
                fs::write(root.join("flow.yaml"), "name: attacker\n").unwrap();
                replaced = true;
            }
            Ok(())
        },
    )
    .unwrap_err();

    assert_eq!(error.code, "git_pair_changed");
    let index = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["diff", "--cached", "--name-only"])
        .output()
        .unwrap();
    assert!(index.status.success());
    assert!(index.stdout.is_empty());
    assert!(!Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--verify", "HEAD"])
        .status()
        .unwrap()
        .success());
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
fn raw_object_reads_disable_replacements_without_changing_historical_show() {
    let root = Path::new("/selected workspace");
    let oid = "a".repeat(40);
    let raw = build_read_command(root, ReadOperation::RawBlob { oid: &oid });
    let raw_environment = raw
        .get_envs()
        .map(|(key, value)| {
            (
                key.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(
        raw_environment.get("GIT_NO_REPLACE_OBJECTS"),
        Some(&Some("1".to_owned()))
    );

    let show = build_read_command(
        root,
        ReadOperation::Show {
            oid: &oid,
            path: "flow.yaml",
        },
    );
    let show_environment = show
        .get_envs()
        .map(|(key, value)| {
            (
                key.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(show_environment.get("GIT_NO_REPLACE_OBJECTS"), Some(&None));
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

#[cfg(unix)]
#[test]
fn runner_timeout_is_bounded_when_a_descendant_keeps_output_pipes_open() {
    use std::time::{Duration, Instant};

    let mut command = Command::new("sh");
    command.args(["-c", "(sleep 30) &"]);
    let started = Instant::now();
    let error =
        super::runner::run_command_for_test(command, Duration::from_millis(150)).unwrap_err();
    assert_eq!(error.code, "git_timeout");
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[cfg(unix)]
#[test]
fn runner_cleans_up_the_process_tree_on_injected_wait_and_reader_failures() {
    use std::time::{Duration, Instant};

    for failure in [
        super::runner::InjectedFailure::Wait,
        super::runner::InjectedFailure::Read,
    ] {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30"]);
        let started = Instant::now();
        let error = super::runner::run_command_with_failure_for_test(
            command,
            Duration::from_millis(200),
            failure,
        )
        .unwrap_err();
        assert!(matches!(error.code, "git_wait_failed" | "git_read_failed"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}

#[test]
fn maps_every_closed_git_operation_to_exact_argv() {
    let root = Path::new("workspace-root");
    let paths = ["flows/main.yaml", "flows/main.hermes.yaml"];

    assert_read_argv(root, ReadOperation::Version, &["--version"]);
    assert_read_argv(
        root,
        ReadOperation::RepositoryRoot,
        &["rev-parse", "--show-toplevel"],
    );
    assert_read_argv(
        root,
        ReadOperation::GitDirectory,
        &["rev-parse", "--absolute-git-dir"],
    );
    assert_read_argv(
        root,
        ReadOperation::GitCommonDirectory,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    );
    assert_read_argv(
        root,
        ReadOperation::Branch,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
    );
    assert_read_argv(
        root,
        ReadOperation::HeadReference,
        &["symbolic-ref", "--quiet", "HEAD"],
    );
    assert_read_argv(
        root,
        ReadOperation::ShortHead,
        &["rev-parse", "--short=12", "HEAD"],
    );
    assert_read_argv(root, ReadOperation::FullHead, &["rev-parse", "HEAD"]);
    assert_read_argv(
        root,
        ReadOperation::Status,
        &["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    );
    assert_read_argv(
        root,
        ReadOperation::Diff {
            cached: false,
            paths: &paths,
        },
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
            paths[0],
            paths[1],
        ],
    );
    assert_read_argv(
        root,
        ReadOperation::Diff {
            cached: true,
            paths: &paths,
        },
        &[
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
            paths[0],
            paths[1],
        ],
    );
    assert_read_argv(
        root,
        ReadOperation::HeadDiff {
            base: "0123456789abcdef",
            paths: &paths,
        },
        &[
            "diff",
            "0123456789abcdef",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
            paths[0],
            paths[1],
        ],
    );
    assert_read_argv(
        root,
        ReadOperation::EmptyTree,
        &["hash-object", "-t", "tree", "--stdin"],
    );
    assert_read_argv(
        root,
        ReadOperation::UntrackedDiff { path: paths[0] },
        &[
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
            "/dev/null",
            paths[0],
        ],
    );
    for follow in [false, true] {
        let mut expected = vec!["log"];
        if follow {
            expected.push("--follow");
        }
        expected.extend([
            "--format=%x00C%x00%H%x00%h%x00%an%x00%at%x00%aI%x00%s%x00",
            "--name-status",
            "-z",
            "--",
            paths[0],
            paths[1],
        ]);
        assert_read_argv(
            root,
            ReadOperation::History {
                follow,
                paths: &paths,
            },
            &expected,
        );
    }
    assert_read_argv(
        root,
        ReadOperation::Show {
            oid: "0123456789abcdef",
            path: paths[0],
        },
        &[
            "show",
            "--no-ext-diff",
            "--no-color",
            "0123456789abcdef:flows/main.yaml",
        ],
    );
    assert_read_argv(
        root,
        ReadOperation::LocalConfig { key: "user.name" },
        &["config", "--local", "--get", "user.name"],
    );
    assert_read_argv(
        root,
        ReadOperation::ConfigBool {
            key: "core.filemode",
        },
        &["config", "--bool", "--get", "core.filemode"],
    );
    assert_read_argv(
        root,
        ReadOperation::PairStatus { paths: &paths },
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
            "--",
            paths[0],
            paths[1],
        ],
    );
    assert_read_argv(
        root,
        ReadOperation::IsTracked { path: paths[0] },
        &["ls-files", "--error-unmatch", "--", paths[0]],
    );
    assert_read_argv(
        root,
        ReadOperation::ResolveRef {
            reference: "refs/heads/base",
        },
        &["rev-parse", "--verify", "refs/heads/base"],
    );
    assert_read_argv(
        root,
        ReadOperation::TreeEntry {
            tree: "0123456789abcdef",
            path: paths[0],
        },
        &["ls-tree", "-z", "0123456789abcdef", "--", paths[0]],
    );
    assert_read_argv(
        root,
        ReadOperation::RawTreeEntry {
            tree: "0123456789abcdef",
            path: paths[1],
        },
        &["ls-tree", "-z", "0123456789abcdef", "--", paths[1]],
    );
    assert_read_argv(
        root,
        ReadOperation::RawBlob {
            oid: "0123456789abcdef",
        },
        &["cat-file", "blob", "0123456789abcdef"],
    );

    assert_mutation_argv(
        root,
        MutationOperation::Init {
            workspace_root: Path::new("init-root"),
        },
        &["--literal-pathspecs", "init", "init-root"],
    );
    assert_mutation_suffix(
        root,
        MutationOperation::SetLocalConfig {
            key: "user.name",
            value: "Workflow Tester",
        },
        &["config", "--local", "user.name", "Workflow Tester"],
    );
    assert_mutation_suffix(
        root,
        MutationOperation::ReadTree {
            tree: "0123456789abcdef",
        },
        &["read-tree", "0123456789abcdef"],
    );
    assert_mutation_suffix(
        root,
        MutationOperation::AddAll { paths: &paths },
        &["add", "--all", "--", paths[0], paths[1]],
    );
    assert_mutation_suffix(root, MutationOperation::WriteTree, &["write-tree"]);
    assert_mutation_suffix(
        root,
        MutationOperation::RunHook {
            name: "pre-commit",
            message_file: None,
            source: None,
        },
        &["hook", "run", "--ignore-missing", "pre-commit"],
    );
    assert_mutation_suffix(
        root,
        MutationOperation::RunHook {
            name: "commit-msg",
            message_file: Some(Path::new("message.txt")),
            source: Some("message"),
        },
        &[
            "hook",
            "run",
            "--ignore-missing",
            "commit-msg",
            "--",
            "message.txt",
            "message",
        ],
    );
    assert_mutation_suffix(
        root,
        MutationOperation::CommitTree {
            tree: "tree-oid",
            parent: None,
            message_file: Path::new("message.txt"),
        },
        &["commit-tree", "tree-oid", "-F", "message.txt"],
    );
    assert_mutation_suffix(
        root,
        MutationOperation::CommitTree {
            tree: "tree-oid",
            parent: Some("parent-oid"),
            message_file: Path::new("message.txt"),
        },
        &[
            "commit-tree",
            "tree-oid",
            "-p",
            "parent-oid",
            "-F",
            "message.txt",
        ],
    );
    assert_mutation_suffix(
        root,
        MutationOperation::UpdateRef {
            reference: "refs/heads/base",
            new_oid: "new-oid",
            old_oid: "old-oid",
        },
        &["update-ref", "refs/heads/base", "new-oid", "old-oid"],
    );
    assert_mutation_suffix(
        root,
        MutationOperation::Move {
            source: paths[0],
            destination: "flows/renamed.yaml",
        },
        &["mv", "--", paths[0], "flows/renamed.yaml"],
    );
}

fn assert_read_argv(root: &Path, operation: ReadOperation<'_>, suffix: &[&str]) {
    let mut expected = vec![
        "--literal-pathspecs",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-C",
        "workspace-root",
    ];
    expected.extend_from_slice(suffix);
    assert_eq!(
        super::runner::read_command_arguments_for_test(root, operation),
        expected
    );
}

fn assert_mutation_suffix(root: &Path, operation: MutationOperation<'_>, suffix: &[&str]) {
    let mut expected = vec!["--literal-pathspecs", "-C", "workspace-root"];
    expected.extend_from_slice(suffix);
    assert_mutation_argv(root, operation, &expected);
}

fn assert_mutation_argv(root: &Path, operation: MutationOperation<'_>, expected: &[&str]) {
    assert_eq!(
        super::runner::mutation_command_arguments_for_test(root, operation),
        expected
    );
}

fn git_with_dates(root: &Path, arguments: &[&str], date: &str) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .env("GIT_AUTHOR_DATE", date)
        .env("GIT_COMMITTER_DATE", date)
        .output()
        .expect("git fixture command should start");
    assert!(
        output.status.success(),
        "git fixture command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
