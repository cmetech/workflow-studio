use std::fs;

use tempfile::tempdir;

use super::{files, paths, WorkspaceScope};

fn scope(path: &std::path::Path) -> WorkspaceScope {
    WorkspaceScope::new(path).unwrap()
}

fn assert_code<T>(result: Result<T, super::WorkspaceError>, code: &str) {
    let error = result.err().expect("operation should fail");
    assert_eq!(error.code, code);
}

#[test]
fn rejects_untrusted_relative_path_shapes() {
    for candidate in [
        "",
        "../outside.yaml",
        "nested/../../outside.yaml",
        "/tmp/outside.yaml",
    ] {
        assert_code(paths::validate_relative(candidate), "invalid_relative_path");
    }

    assert_code(
        paths::validate_relative("nested/evil\0.yaml"),
        "invalid_relative_path",
    );

    #[cfg(windows)]
    assert_code(
        paths::validate_relative(r"C:\outside.yaml"),
        "invalid_relative_path",
    );
}

#[test]
fn accepts_unicode_and_spaces_but_rejects_symlink_escape_and_missing_root() {
    let root = tempdir().unwrap();
    let nested = root.path().join("flows with spaces");
    fs::create_dir(&nested).unwrap();
    fs::write(nested.join("café.yaml"), "id: café\n").unwrap();

    let canonical = paths::canonical_root(root.path()).unwrap();
    let resolved = paths::resolve_existing(&canonical, "flows with spaces/café.yaml").unwrap();
    assert!(resolved.starts_with(&canonical));

    let outside = tempdir().unwrap();
    fs::write(outside.path().join("secret.yaml"), "secret: true\n").unwrap();
    create_file_symlink(
        &outside.path().join("secret.yaml"),
        &root.path().join("escape.yaml"),
    );
    assert_code(
        paths::resolve_existing(&canonical, "escape.yaml"),
        "path_outside_workspace",
    );

    let selected = root.path().to_path_buf();
    let selected_scope = scope(&selected);
    drop(root);
    assert_code(paths::canonical_root(&selected), "workspace_root_missing");
    assert_code(files::scan(&selected_scope), "workspace_root_missing");
}

#[test]
fn scan_does_not_follow_directory_symlinks_and_read_is_bounded_yaml_only() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/flow.yaml"), "id: flow\n").unwrap();
    fs::write(root.path().join("notes.txt"), "not yaml").unwrap();
    fs::write(outside.path().join("outside.yaml"), "outside: true\n").unwrap();
    create_dir_symlink(outside.path(), &root.path().join("linked"));

    let workspace = scope(root.path());
    let entries = files::scan(&workspace).unwrap();
    assert!(entries
        .iter()
        .any(|entry| entry.relative_path == "nested/flow.yaml"));
    assert!(!entries
        .iter()
        .any(|entry| entry.relative_path == "linked/outside.yaml"));

    assert_code(
        files::read(&workspace, "notes.txt", 1024),
        "unsupported_file_type",
    );
    assert_code(
        files::read(&workspace, "nested/flow.yaml", 4),
        "file_too_large",
    );
    let read = files::read(&workspace, "nested/flow.yaml", 1024).unwrap();
    assert_eq!(read.text, "id: flow\n");
    assert_eq!(read.sha256.len(), 64);
}

#[test]
fn writes_are_revision_checked_atomic_and_preserve_permissions() {
    let root = tempdir().unwrap();
    let target = root.path().join("flow.yaml");
    fs::write(&target, "id: before\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
    }
    let workspace = scope(root.path());
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();

    assert_code(
        files::write(&workspace, "flow.yaml", "id: stale\n", Some("wrong")),
        "external_revision_conflict",
    );
    assert_eq!(fs::read_to_string(&target).unwrap(), "id: before\n");

    let result =
        files::write(&workspace, "flow.yaml", "id: after\n", Some(&before.sha256)).unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "id: after\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }
    assert_eq!(result.sha256, files::hash_bytes(b"id: after\n"));
    assert_eq!(
        result.sha256,
        "930a3450b65f12b82d9e0ef2c7e4c8b68538adb96dc161b5b6f27a4ea342902a"
    );
    assert_eq!(
        fs::read_dir(root.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name() != "flow.yaml")
            .count(),
        0,
        "atomic write must not leave same-directory temporary files"
    );

    assert_code(
        files::write(&workspace, "flow.yaml", "id: create\n", None),
        "external_revision_conflict",
    );
}

#[test]
fn staged_write_detects_overwrite_and_create_races_without_clobbering_disk() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("existing.yaml"), "id: before\n").unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "existing.yaml", files::MAX_YAML_BYTES).unwrap();

    assert_code(
        files::write_with_precommit_hook(
            &workspace,
            "existing.yaml",
            "id: mine\n",
            Some(&before.sha256),
            || fs::write(root.path().join("existing.yaml"), "id: external\n").unwrap(),
        ),
        "external_revision_conflict",
    );
    assert_eq!(
        fs::read_to_string(root.path().join("existing.yaml")).unwrap(),
        "id: external\n"
    );

    assert_code(
        files::write_with_precommit_hook(&workspace, "created.yaml", "id: mine\n", None, || {
            fs::write(root.path().join("created.yaml"), "id: external\n").unwrap()
        }),
        "external_revision_conflict",
    );
    assert_eq!(
        fs::read_to_string(root.path().join("created.yaml")).unwrap(),
        "id: external\n"
    );
}

#[test]
fn rejects_replaced_root_and_ancestor_symlink_swap_before_commit() {
    let parent = tempdir().unwrap();
    let root_path = parent.path().join("workspace");
    fs::create_dir(&root_path).unwrap();
    fs::write(root_path.join("flow.yaml"), "id: before\n").unwrap();
    let workspace = scope(&root_path);
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();

    let displaced = parent.path().join("displaced");
    fs::rename(&root_path, &displaced).unwrap();
    fs::create_dir(&root_path).unwrap();
    fs::write(root_path.join("flow.yaml"), "id: replacement\n").unwrap();
    assert_code(
        files::write(&workspace, "flow.yaml", "id: mine\n", Some(&before.sha256)),
        "workspace_root_changed",
    );
    assert_eq!(
        fs::read_to_string(root_path.join("flow.yaml")).unwrap(),
        "id: replacement\n"
    );

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/flow.yaml"), "id: before\n").unwrap();
    fs::write(outside.path().join("flow.yaml"), "id: outside\n").unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "nested/flow.yaml", files::MAX_YAML_BYTES).unwrap();
    let parked = root.path().join("parked");
    files::write_with_precommit_hook(
        &workspace,
        "nested/flow.yaml",
        "id: mine\n",
        Some(&before.sha256),
        || {
            fs::rename(root.path().join("nested"), &parked).unwrap();
            create_dir_symlink(outside.path(), &root.path().join("nested"));
        },
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(parked.join("flow.yaml")).unwrap(),
        "id: mine\n"
    );
    assert_eq!(
        fs::read_to_string(outside.path().join("flow.yaml")).unwrap(),
        "id: outside\n"
    );
}

#[test]
fn bound_read_ignores_a_descendant_swapped_after_parent_binding() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/flow.yaml"), "id: inside\n").unwrap();
    fs::write(outside.path().join("flow.yaml"), "id: outside\n").unwrap();
    let workspace = scope(root.path());
    let parked = root.path().join("parked");

    let read = files::read_with_bound_hook(&workspace, "nested/flow.yaml", 1024, || {
        fs::rename(root.path().join("nested"), &parked).unwrap();
        create_dir_symlink(outside.path(), &root.path().join("nested"));
    })
    .unwrap();

    assert_eq!(read.text, "id: inside\n");
    assert_eq!(
        fs::read_to_string(outside.path().join("flow.yaml")).unwrap(),
        "id: outside\n"
    );
}

#[test]
fn bound_scan_never_follows_a_descendant_swapped_after_entry_binding() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/inside.yaml"), "id: inside\n").unwrap();
    fs::write(outside.path().join("outside.yaml"), "id: outside\n").unwrap();
    let workspace = scope(root.path());
    let parked = root.path().join("parked");
    let mut swapped = false;

    let entries = files::scan_with_entry_hook(&workspace, |relative| {
        if relative == "nested" && !swapped {
            swapped = true;
            fs::rename(root.path().join("nested"), &parked).unwrap();
            create_dir_symlink(outside.path(), &root.path().join("nested"));
        }
    })
    .unwrap();

    assert!(swapped);
    assert!(!entries
        .iter()
        .any(|entry| entry.relative_path == "nested/outside.yaml"));
    assert_eq!(
        fs::read_to_string(outside.path().join("outside.yaml")).unwrap(),
        "id: outside\n"
    );
}

#[test]
fn bound_rename_and_trash_ignore_descendant_swaps_after_binding() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/old.yaml"), "id: inside\n").unwrap();
    fs::write(outside.path().join("old.yaml"), "id: outside\n").unwrap();
    let workspace = scope(root.path());
    let parked = root.path().join("parked");

    files::rename_pair_with_bound_hook(&workspace, "nested/old.yaml", "nested/new.yaml", || {
        fs::rename(root.path().join("nested"), &parked).unwrap();
        create_dir_symlink(outside.path(), &root.path().join("nested"));
    })
    .unwrap();
    assert_eq!(
        fs::read_to_string(parked.join("new.yaml")).unwrap(),
        "id: inside\n"
    );
    assert_eq!(
        fs::read_to_string(outside.path().join("old.yaml")).unwrap(),
        "id: outside\n"
    );

    fs::remove_file(root.path().join("nested")).unwrap();
    fs::rename(&parked, root.path().join("nested")).unwrap();
    let parked = root.path().join("parked-again");
    let result = files::trash_paths_with_bound_hook(
        &workspace,
        &["nested/new.yaml".to_string()],
        || {
            fs::rename(root.path().join("nested"), &parked).unwrap();
            create_dir_symlink(outside.path(), &root.path().join("nested"));
        },
        |quarantined| fs::remove_file(quarantined).map_err(|error| error.to_string()),
    )
    .unwrap();
    assert_eq!(result.results[0].status, "trashed");
    assert_eq!(
        fs::read_to_string(outside.path().join("old.yaml")).unwrap(),
        "id: outside\n"
    );
}

#[test]
fn no_clobber_move_preserves_both_unlink_and_cleanup_failures() {
    let outcome = files::move_noclobber_outcome_for_test(
        Ok(()),
        Err("source unlink failed".to_string()),
        Err("destination cleanup failed".to_string()),
    );

    assert_eq!(outcome.status, "partial");
    assert_eq!(
        outcome.unlink_error.as_deref(),
        Some("source unlink failed")
    );
    assert_eq!(
        outcome.cleanup_error.as_deref(),
        Some("destination cleanup failed")
    );
}

#[test]
fn no_clobber_move_never_unlinks_a_source_name_replaced_after_hard_link() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("source.yaml"), "id: original\n").unwrap();
    let workspace = scope(root.path());

    let outcome = files::move_noclobber_with_hooks_for_test(
        &workspace,
        "source.yaml",
        "destination.yaml",
        || {
            fs::rename(
                root.path().join("source.yaml"),
                root.path().join("parked.yaml"),
            )
            .unwrap();
            fs::write(root.path().join("source.yaml"), "id: replacement\n").unwrap();
        },
        || {},
    )
    .unwrap();

    assert_eq!(outcome.status, "rolledBack");
    assert_eq!(outcome.unlink_error_code, Some("source_identity_changed"));
    assert_eq!(
        fs::read_to_string(root.path().join("source.yaml")).unwrap(),
        "id: replacement\n"
    );
    assert!(!root.path().join("destination.yaml").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("parked.yaml")).unwrap(),
        "id: original\n"
    );
}

#[test]
fn no_clobber_move_never_cleans_a_destination_name_replaced_after_unlink_failure() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("source.yaml"), "id: original\n").unwrap();
    let workspace = scope(root.path());

    let outcome = files::move_noclobber_with_hooks_for_test(
        &workspace,
        "source.yaml",
        "destination.yaml",
        || {
            fs::rename(
                root.path().join("source.yaml"),
                root.path().join("parked-source.yaml"),
            )
            .unwrap();
            fs::write(root.path().join("source.yaml"), "id: replacement source\n").unwrap();
        },
        || {
            fs::rename(
                root.path().join("destination.yaml"),
                root.path().join("parked-destination.yaml"),
            )
            .unwrap();
            fs::write(
                root.path().join("destination.yaml"),
                "id: replacement destination\n",
            )
            .unwrap();
        },
    )
    .unwrap();

    assert_eq!(outcome.status, "partial");
    assert_eq!(outcome.unlink_error_code, Some("source_identity_changed"));
    assert_eq!(
        outcome.cleanup_error_code,
        Some("destination_identity_changed")
    );
    assert_eq!(
        fs::read_to_string(root.path().join("destination.yaml")).unwrap(),
        "id: replacement destination\n"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("parked-destination.yaml")).unwrap(),
        "id: original\n"
    );
}

#[test]
fn write_never_replaces_a_name_changed_after_hash_and_identity_binding() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();

    let error = files::write_with_post_hash_hook(
        &workspace,
        "flow.yaml",
        "id: mine\n",
        Some(&before.sha256),
        || {
            fs::rename(
                root.path().join("flow.yaml"),
                root.path().join("parked.yaml"),
            )
            .unwrap();
            fs::write(root.path().join("flow.yaml"), "id: external\n").unwrap();
        },
    )
    .unwrap_err();

    assert_eq!(error.code, "external_revision_conflict");
    assert_eq!(
        fs::read_to_string(root.path().join("flow.yaml")).unwrap(),
        "id: external\n"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("parked.yaml")).unwrap(),
        "id: original\n"
    );
}

#[test]
fn write_rolls_back_or_retains_recovery_when_target_reappears_after_quarantine() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();

    let error = files::write_with_post_quarantine_hook(
        &workspace,
        "flow.yaml",
        "id: mine\n",
        Some(&before.sha256),
        || fs::write(root.path().join("flow.yaml"), "id: external\n").unwrap(),
    )
    .unwrap_err();

    assert_eq!(error.code, "workspace_write_partial");
    assert!(error.message.contains("recovery"));
    assert_eq!(
        fs::read_to_string(root.path().join("flow.yaml")).unwrap(),
        "id: external\n"
    );
    let recovery = fs::read_dir(root.path())
        .unwrap()
        .filter_map(Result::ok)
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".workflow-studio-original-")
        })
        .expect("verified original remains recoverable");
    assert_eq!(
        fs::read_to_string(recovery.path()).unwrap(),
        "id: original\n"
    );
}

#[test]
fn trash_never_hands_off_a_quarantine_name_replaced_after_binding() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(root.path());

    let result = files::trash_paths_with_handoff_hook(
        &workspace,
        &["flow.yaml".to_string()],
        |quarantine| {
            fs::rename(quarantine, root.path().join("parked-quarantine.yaml")).unwrap();
            fs::write(quarantine, "id: replacement\n").unwrap();
        },
        |_| panic!("an unverified quarantine must not reach OS Trash"),
    )
    .unwrap();

    assert_eq!(result.results[0].status, "partial");
    assert_eq!(
        result.results[0].error_code.as_deref(),
        Some("workspace_trash_partial")
    );
    assert_eq!(
        fs::read_to_string(root.path().join("parked-quarantine.yaml")).unwrap(),
        "id: original\n"
    );
}

#[test]
fn trash_rolls_back_through_bound_handles_if_the_selected_root_is_replaced() {
    let parent = tempdir().unwrap();
    let root_path = parent.path().join("workspace");
    fs::create_dir(&root_path).unwrap();
    fs::write(root_path.join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(&root_path);
    let displaced = parent.path().join("displaced");

    let result = files::trash_paths_with_handoff_hook(
        &workspace,
        &["flow.yaml".to_string()],
        |_| {
            fs::rename(&root_path, &displaced).unwrap();
            fs::create_dir(&root_path).unwrap();
            fs::write(root_path.join("flow.yaml"), "id: replacement\n").unwrap();
        },
        |_| panic!("a replaced selected root must not reach OS Trash"),
    )
    .unwrap();

    assert_eq!(result.results[0].status, "failed");
    assert_eq!(
        result.results[0].error_code.as_deref(),
        Some("workspace_root_changed")
    );
    assert_eq!(
        fs::read_to_string(displaced.join("flow.yaml")).unwrap(),
        "id: original\n"
    );
    assert_eq!(
        fs::read_to_string(root_path.join("flow.yaml")).unwrap(),
        "id: replacement\n"
    );
}

#[test]
fn trash_never_reports_success_if_the_root_changes_after_os_handoff() {
    let parent = tempdir().unwrap();
    let root_path = parent.path().join("workspace");
    fs::create_dir(&root_path).unwrap();
    fs::write(root_path.join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(&root_path);
    let displaced = parent.path().join("displaced");
    let os_trash_path = parent.path().join("os-trash-flow.yaml");

    let result = files::trash_paths_with_post_delete_hook(
        &workspace,
        &["flow.yaml".to_string()],
        |quarantine| fs::rename(quarantine, &os_trash_path).map_err(|error| error.to_string()),
        || {
            fs::rename(&root_path, &displaced).unwrap();
            fs::create_dir(&root_path).unwrap();
            fs::write(root_path.join("flow.yaml"), "id: replacement\n").unwrap();
        },
    )
    .unwrap();

    assert_eq!(result.results[0].status, "partial");
    assert_eq!(
        result.results[0].error_code.as_deref(),
        Some("workspace_trash_partial")
    );
    assert_eq!(
        fs::read_to_string(&os_trash_path).unwrap(),
        "id: original\n"
    );
    assert_eq!(
        fs::read_to_string(root_path.join("flow.yaml")).unwrap(),
        "id: replacement\n"
    );
}

#[test]
fn write_restores_read_only_permissions_only_after_staged_unlink_commits() {
    let root = tempdir().unwrap();
    let target = root.path().join("flow.yaml");
    fs::write(&target, "id: original\n").unwrap();
    let mut permissions = fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&target, permissions).unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();
    let mut observed = Vec::new();

    files::write_with_permission_order_hook(
        &workspace,
        "flow.yaml",
        "id: mine\n",
        Some(&before.sha256),
        |phase, read_only| observed.push((phase.to_string(), read_only)),
    )
    .unwrap();

    assert_eq!(
        observed,
        vec![
            ("beforeCommit".to_string(), false),
            ("afterCommit".to_string(), false),
            ("afterRestore".to_string(), true),
        ]
    );
    assert!(fs::metadata(&target).unwrap().permissions().readonly());
    assert_eq!(fs::read_to_string(&target).unwrap(), "id: mine\n");
}

#[test]
fn trash_preserves_each_capability_resolver_error_code() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("outside.yaml"), "id: outside\n").unwrap();
    create_file_symlink(
        &outside.path().join("outside.yaml"),
        &root.path().join("escape.yaml"),
    );
    let workspace = scope(root.path());

    let result = files::trash_paths_with(
        &workspace,
        &["escape.yaml".to_string(), "missing.yaml".to_string()],
        |_| panic!("resolver failures must not reach the OS Trash adapter"),
    )
    .unwrap();

    assert_eq!(result.results[0].status, "failed");
    assert_eq!(
        result.results[0].error_code.as_deref(),
        Some("path_outside_workspace")
    );
    assert_eq!(result.results[1].status, "failed");
    assert_eq!(
        result.results[1].error_code.as_deref(),
        Some("path_not_found")
    );
    assert_eq!(
        fs::read_to_string(outside.path().join("outside.yaml")).unwrap(),
        "id: outside\n"
    );
}

#[test]
fn trash_expected_hash_never_trashes_an_external_replacement() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();
    fs::write(root.path().join("flow.yaml"), "id: external\n").unwrap();

    let result = files::trash_paths_checked_with(
        &workspace,
        &[files::TrashPathRequest {
            relative_path: "flow.yaml".to_string(),
            expected_current_hash: before.sha256,
        }],
        |_| panic!("a hash mismatch must not reach OS Trash"),
    )
    .unwrap();

    assert_eq!(result.results[0].status, "failed");
    assert_eq!(
        result.results[0].error_code.as_deref(),
        Some("external_revision_conflict")
    );
    assert_eq!(
        fs::read_to_string(root.path().join("flow.yaml")).unwrap(),
        "id: external\n"
    );
}

#[test]
fn trash_rechecks_quarantined_content_immediately_before_os_handoff() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();

    let result = files::trash_paths_checked_with_handoff_hook(
        &workspace,
        &[files::TrashPathRequest {
            relative_path: "flow.yaml".to_string(),
            expected_current_hash: before.sha256,
        }],
        |quarantined| fs::write(quarantined, "id: in-place-external\n").unwrap(),
        |_| panic!("mutated quarantined content must not reach OS Trash"),
    )
    .unwrap();

    assert_eq!(result.results[0].status, "failed");
    assert_eq!(
        result.results[0].error_code.as_deref(),
        Some("external_revision_conflict")
    );
    assert_eq!(
        fs::read_to_string(root.path().join("flow.yaml")).unwrap(),
        "id: in-place-external\n"
    );
}

#[test]
fn trash_reports_partial_when_quarantine_hash_mismatch_cannot_roll_back() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();

    let result = files::trash_paths_checked_with_handoff_hook(
        &workspace,
        &[files::TrashPathRequest {
            relative_path: "flow.yaml".to_string(),
            expected_current_hash: before.sha256,
        }],
        |quarantined| {
            fs::write(quarantined, "id: in-place-external\n").unwrap();
            fs::write(root.path().join("flow.yaml"), "id: source-recreated\n").unwrap();
        },
        |_| panic!("mutated quarantined content must not reach OS Trash"),
    )
    .unwrap();

    assert_eq!(result.results[0].status, "partial");
    assert_eq!(
        result.results[0].error_code.as_deref(),
        Some("workspace_trash_partial")
    );
    assert_eq!(
        fs::read_to_string(root.path().join("flow.yaml")).unwrap(),
        "id: source-recreated\n"
    );
}

#[test]
fn classifies_watcher_event_hints_without_file_content() {
    use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
    use notify::EventKind;

    assert_eq!(
        super::watcher::event_hint(&EventKind::Create(CreateKind::File)),
        "create"
    );
    assert_eq!(
        super::watcher::event_hint(&EventKind::Modify(ModifyKind::Name(RenameMode::Both))),
        "rename"
    );
    assert_eq!(
        super::watcher::event_hint(&EventKind::Remove(RemoveKind::File)),
        "remove"
    );
}

#[test]
fn watcher_debounces_mixed_hints_preserves_rename_paths_and_shuts_down() {
    use std::collections::BTreeMap;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let root = tempdir().unwrap();
    fs::write(root.path().join("removed.yaml"), "id: removed\n").unwrap();
    fs::write(root.path().join("old.yaml"), "id: old\n").unwrap();
    let (sender, receiver) = mpsc::channel();
    let watcher = super::watcher::start_with_sink(root.path(), move |event| {
        sender.send(event).unwrap();
    })
    .unwrap();

    fs::write(root.path().join("created.yaml"), "id: created\n").unwrap();
    fs::remove_file(root.path().join("removed.yaml")).unwrap();
    fs::rename(root.path().join("old.yaml"), root.path().join("new.yaml")).unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut hints = BTreeMap::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        for path in event.paths {
            assert!(
                hints.insert(path, event.kind.clone()).is_none(),
                "each debounced path belongs to one homogeneous event"
            );
        }
        if ["created.yaml", "removed.yaml", "old.yaml", "new.yaml"]
            .iter()
            .all(|path| hints.contains_key(*path))
        {
            break;
        }
    }

    assert_eq!(
        hints.get("created.yaml").map(String::as_str),
        Some("create"),
        "received hints: {hints:?}"
    );
    assert_eq!(
        hints.get("removed.yaml").map(String::as_str),
        Some("remove")
    );
    assert_eq!(hints.get("old.yaml").map(String::as_str), Some("rename"));
    assert_eq!(hints.get("new.yaml").map(String::as_str), Some("rename"));

    drop(watcher);
    assert!(matches!(
        receiver.recv_timeout(Duration::from_secs(1)),
        Err(mpsc::RecvTimeoutError::Disconnected)
    ));
}

#[test]
fn rename_pair_rejects_destination_collisions_without_changing_sources() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.yaml"), "id: old\n").unwrap();
    fs::write(root.path().join("old.hermes.yaml"), "profile: default\n").unwrap();
    fs::write(root.path().join("taken.yaml"), "id: taken\n").unwrap();
    let workspace = scope(root.path());

    assert_code(
        files::rename_pair(&workspace, "old.yaml", "taken.yaml"),
        "destination_exists",
    );
    assert!(root.path().join("old.yaml").exists());
    assert!(root.path().join("old.hermes.yaml").exists());

    let renamed = files::rename_pair(&workspace, "old.yaml", "new name.yaml").unwrap();
    assert_eq!(renamed.paths, vec!["new name.yaml", "new name.hermes.yaml"]);
    assert!(root.path().join("new name.yaml").exists());
    assert!(root.path().join("new name.hermes.yaml").exists());
}

#[test]
fn rename_pair_rejects_a_directory_disguised_as_yaml() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("directory.yaml")).unwrap();
    let workspace = scope(root.path());

    assert_code(
        files::rename_pair(&workspace, "directory.yaml", "renamed.yaml"),
        "not_a_file",
    );
    assert!(root.path().join("directory.yaml").is_dir());
}

#[test]
fn pair_rename_never_overwrites_a_recreated_source_and_reports_partial_state() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.yaml"), "id: old\n").unwrap();
    fs::write(root.path().join("old.hermes.yaml"), "profile: default\n").unwrap();
    let workspace = scope(root.path());

    let error =
        files::rename_pair_with_second_step_hook(&workspace, "old.yaml", "new.yaml", || {
            fs::write(root.path().join("old.yaml"), "id: recreated\n").unwrap();
            fs::write(root.path().join("new.hermes.yaml"), "collision: true\n").unwrap();
        })
        .unwrap_err();

    assert_eq!(error.code, "workspace_rename_partial");
    assert_eq!(
        fs::read_to_string(root.path().join("old.yaml")).unwrap(),
        "id: recreated\n"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("new.yaml")).unwrap(),
        "id: old\n"
    );
    assert_eq!(error.path_results[0].status, "partial");
    assert_eq!(
        error.path_results[0].error_code.as_deref(),
        Some("workspace_rename_partial")
    );
    assert!(error.path_results[0]
        .message
        .as_deref()
        .is_some_and(|message| message.contains("rollback")));
    assert_eq!(error.path_results[1].status, "failed");
}

#[test]
fn pair_rename_rolls_back_definition_when_the_companion_move_fails() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.yaml"), "id: old\n").unwrap();
    fs::write(root.path().join("old.hermes.yaml"), "profile: default\n").unwrap();
    let workspace = scope(root.path());

    let error =
        files::rename_pair_with_second_step_hook(&workspace, "old.yaml", "new.yaml", || {
            fs::write(root.path().join("new.hermes.yaml"), "collision: true\n").unwrap()
        })
        .unwrap_err();

    assert_eq!(error.code, "workspace_rename_failed");
    assert_eq!(error.path_results[0].status, "rolledBack");
    assert!(root.path().join("old.yaml").is_file());
    assert!(!root.path().join("new.yaml").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("new.hermes.yaml")).unwrap(),
        "collision: true\n"
    );
}

#[test]
fn two_path_trash_reports_each_result_when_the_second_operation_fails() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("flow.yaml"), "id: flow\n").unwrap();
    fs::write(root.path().join("flow.hermes.yaml"), "profile: default\n").unwrap();
    let workspace = scope(root.path());
    let mut calls = 0;
    let result = files::trash_paths_with(
        &workspace,
        &["flow.yaml".to_string(), "flow.hermes.yaml".to_string()],
        |path| {
            calls += 1;
            if calls == 1 {
                fs::remove_file(path).map_err(|error| error.to_string())
            } else {
                Err("simulated trash failure".to_string())
            }
        },
    )
    .unwrap();

    assert_eq!(result.results[0].status, "trashed");
    assert_eq!(result.results[1].status, "failed");
    assert_eq!(
        result.results[1].error_code.as_deref(),
        Some("workspace_trash_failed")
    );
}

#[cfg(windows)]
#[test]
fn windows_atomic_replace_restores_read_only_permissions() {
    let root = tempdir().unwrap();
    let target = root.path().join("flow.yaml");
    fs::write(&target, "id: before\n").unwrap();
    let mut permissions = fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&target, permissions).unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();

    files::write(&workspace, "flow.yaml", "id: after\n", Some(&before.sha256)).unwrap();

    assert!(fs::metadata(&target).unwrap().permissions().readonly());
}

#[cfg(windows)]
#[test]
fn windows_failed_replace_restores_original_read_only_permissions() {
    let root = tempdir().unwrap();
    let target = root.path().join("flow.yaml");
    fs::write(&target, "id: before\n").unwrap();
    let mut permissions = fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&target, permissions.clone()).unwrap();

    let parent =
        cap_std::fs::Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
    let permissions = cap_std::fs::Permissions::from_std(permissions);
    files::make_windows_target_replaceable(
        &parent,
        std::ffi::OsStr::new("flow.yaml"),
        Some(&permissions),
    )
    .unwrap();
    assert!(!fs::metadata(&target).unwrap().permissions().readonly());
    files::restore_windows_permissions_after_failure(
        &parent,
        std::ffi::OsStr::new("flow.yaml"),
        Some(&permissions),
    )
    .unwrap();

    assert!(fs::metadata(&target).unwrap().permissions().readonly());
    assert_eq!(fs::read_to_string(&target).unwrap(), "id: before\n");
}

#[cfg(unix)]
fn create_file_symlink(target: &std::path::Path, link: &std::path::Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[cfg(windows)]
fn create_file_symlink(target: &std::path::Path, link: &std::path::Path) {
    std::os::windows::fs::symlink_file(target, link).unwrap();
}

#[cfg(unix)]
fn create_dir_symlink(target: &std::path::Path, link: &std::path::Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[cfg(windows)]
fn create_dir_symlink(target: &std::path::Path, link: &std::path::Path) {
    std::os::windows::fs::symlink_dir(target, link).unwrap();
}
