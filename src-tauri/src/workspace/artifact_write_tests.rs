use super::*;

#[test]
fn artifact_commit_rollback_retains_destination_after_stage_name_replacement() {
    for (existing, recovery) in [(false, true), (true, true), (false, false)] {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("script.py");
        if existing {
            std::fs::write(&target, "original").unwrap();
        }
        let mut scope = WorkspaceScope::new(root.path()).unwrap();
        if !recovery {
            scope.recovery = None;
        }
        let expected = existing.then(|| hash_bytes(b"original"));
        let mut writer = None;
        let mut foreign = None;
        let error = write_stream_impl(
            &scope,
            "script.py",
            &mut b"studio".as_slice(),
            expected.as_deref(),
            super::super::artifacts::max_bytes(),
            true,
            None,
            || Ok(()),
            WriteHooks {
                pre_hash: || {},
                post_hash: || {},
                post_quarantine: || {},
                permission: |phase: &str, _: bool| {
                    if phase == "beforeCommitUnlink" {
                        let stage = std::fs::read_dir(root.path())
                            .unwrap()
                            .map(|entry| entry.unwrap().path())
                            .find(|path| {
                                path.extension().is_some_and(|extension| extension == "tmp")
                            })
                            .unwrap();
                        let mut file = std::fs::OpenOptions::new()
                            .write(true)
                            .open(&stage)
                            .unwrap();
                        file.write_all(b"late staged").unwrap();
                        file.sync_all().unwrap();
                        std::fs::remove_file(&stage).unwrap();
                        std::fs::write(&stage, "foreign stage").unwrap();
                        writer = Some(file);
                        foreign = Some(stage);
                    }
                },
                restore_permissions: restore_file_permissions,
            },
        )
        .unwrap_err();
        let retained = error
            .path_results
            .iter()
            .filter_map(|entry| entry.destination_path.as_ref())
            .find(|path| std::fs::read(path).is_ok_and(|bytes| bytes == b"late staged"))
            .expect(
                "commit rollback must retain the owned destination before removing its last name",
            );
        let mut writer = writer.unwrap();
        writer.seek(SeekFrom::Start(0)).unwrap();
        writer.write_all(b"after rollback").unwrap();
        writer.set_len(14).unwrap();
        writer.sync_all().unwrap();
        assert_eq!(std::fs::read(retained).unwrap(), b"after rollback");
        assert_eq!(std::fs::read(foreign.unwrap()).unwrap(), b"foreign stage");
        if !recovery {
            assert_eq!(std::fs::read(&target).unwrap(), b"after rollback");
        } else if existing {
            assert_eq!(std::fs::read(&target).unwrap(), b"original");
        } else {
            assert!(!target.exists());
        }
    }
}

#[cfg(windows)]
#[test]
fn artifact_retained_original_permissions_survive_postcommit_error() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("script.py");
    std::fs::write(&target, "original").unwrap();
    let mut permissions = std::fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&target, permissions).unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let error = write_stream_impl(
        &scope,
        "script.py",
        &mut b"studio".as_slice(),
        Some(&hash_bytes(b"original")),
        super::super::artifacts::max_bytes(),
        true,
        None,
        || Ok(()),
        WriteHooks {
            pre_hash: || {},
            post_hash: || {},
            post_quarantine: || {},
            permission: |phase: &str, _: bool| {
                if phase == "afterCommit" {
                    std::fs::remove_file(&target).unwrap();
                }
            },
            restore_permissions: restore_file_permissions,
        },
    )
    .unwrap_err();
    let retained = error
        .path_results
        .iter()
        .filter_map(|entry| entry.destination_path.as_ref())
        .find(|path| std::fs::read(path).is_ok_and(|bytes| bytes == b"original"))
        .unwrap();
    let mut permissions = std::fs::metadata(retained).unwrap().permissions();
    let readonly = permissions.readonly();
    permissions.set_readonly(false);
    std::fs::set_permissions(retained, permissions).unwrap();
    assert!(
        readonly,
        "retained original metadata must be restored on error exits too"
    );
}

#[cfg(windows)]
#[test]
fn artifact_retained_original_preserves_read_only_permissions() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("script.py");
    std::fs::write(&target, "original").unwrap();
    let mut permissions = std::fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&target, permissions).unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let saved = super::super::artifacts::write_text(
        &scope,
        "script.py",
        "studio",
        Some(&hash_bytes(b"original")),
    )
    .unwrap();
    let retained = saved.recovery_results[0].destination_path.as_ref().unwrap();
    let retained_readonly = std::fs::metadata(retained)
        .unwrap()
        .permissions()
        .readonly();
    for path in [target.as_path(), Path::new(retained)] {
        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(false);
        std::fs::set_permissions(path, permissions).unwrap();
    }
    assert!(
        retained_readonly,
        "retained original must retain its original permissions"
    );
}

#[test]
fn artifact_precommit_failure_retains_open_staged_inode() {
    let root = tempfile::tempdir().unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let mut writer = None;
    let error = write_artifact_stream_verified(
        &scope,
        "script.py",
        &mut b"studio".as_slice(),
        None,
        None,
        || {
            let stage = std::fs::read_dir(root.path())
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path();
            let mut file = std::fs::OpenOptions::new().write(true).open(stage).unwrap();
            file.write_all(b"external staged").unwrap();
            file.sync_all().unwrap();
            writer = Some(file);
            Err(WorkspaceError::new(
                "artifact_source_grant_invalid",
                "Injected source change",
            ))
        },
    )
    .unwrap_err();
    let retained = error
        .path_results
        .iter()
        .filter_map(|receipt| receipt.destination_path.as_ref())
        .find(|path| std::fs::read(path).is_ok_and(|bytes| bytes == b"external staged"))
        .expect("early failure must retain externally written staged inode");
    let mut writer = writer.unwrap();
    writer.seek(SeekFrom::Start(0)).unwrap();
    writer.write_all(b"after failure").unwrap();
    writer.set_len(13).unwrap();
    writer.sync_all().unwrap();
    assert_eq!(std::fs::read(retained).unwrap(), b"after failure");
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn artifact_save_retains_original_write_immediately_before_cleanup() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("script.py");
    std::fs::write(&target, "original").unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let mut writer = std::fs::OpenOptions::new()
        .write(true)
        .open(&target)
        .unwrap();
    let saved = write_stream_impl(
        &scope,
        "script.py",
        &mut b"studio".as_slice(),
        Some(&hash_bytes(b"original")),
        super::super::artifacts::max_bytes(),
        true,
        None,
        || Ok(()),
        WriteHooks {
            pre_hash: || {},
            post_hash: || {},
            post_quarantine: || {},
            permission: |phase: &str, _: bool| {
                if phase == "afterRestore" {
                    writer.write_all(b"last gap").unwrap();
                    writer.sync_all().unwrap();
                }
            },
            restore_permissions: restore_file_permissions,
        },
    )
    .unwrap();
    assert_eq!(saved.recovery_results.len(), 1);
    assert_eq!(
        std::fs::read(saved.recovery_results[0].destination_path.as_ref().unwrap()).unwrap(),
        b"last gap"
    );
    assert_eq!(std::fs::read(target).unwrap(), b"studio");
}

#[test]
fn artifact_import_forwards_recovery_receipt_and_new_save_omits_empty_receipts() {
    let root = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let saved =
        super::super::artifacts::write_text(&scope, "resource.bin", "original", None).unwrap();
    assert!(serde_json::to_value(&saved)
        .unwrap()
        .get("recoveryResults")
        .is_none());
    let path = source.path().join("source.bin");
    std::fs::write(&path, [0, 255, 1]).unwrap();
    let grants = super::super::artifacts::ArtifactGrantState::default();
    let token = super::super::artifacts::grant_source(&path, 1, &grants)
        .unwrap()
        .source_grant_token;
    let imported = super::super::artifacts::import(
        &scope,
        1,
        &grants,
        "resource.bin",
        &token,
        Some(&saved.sha256),
    )
    .unwrap();
    assert_eq!(imported.recovery_results.len(), 1);
    assert_eq!(
        std::fs::read(
            imported.recovery_results[0]
                .destination_path
                .as_ref()
                .unwrap()
        )
        .unwrap(),
        b"original"
    );
    assert_eq!(
        std::fs::read(root.path().join("resource.bin")).unwrap(),
        [0, 255, 1]
    );
}

#[test]
fn artifact_save_retains_late_open_handle_writes_and_remains_editable() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("script.py");
    std::fs::write(&target, "original").unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let mut writer = std::fs::OpenOptions::new()
        .write(true)
        .open(&target)
        .unwrap();
    let result = write_stream_impl(
        &scope,
        "script.py",
        &mut b"studio".as_slice(),
        Some(&hash_bytes(b"original")),
        super::super::artifacts::max_bytes(),
        true,
        None,
        || Ok(()),
        WriteHooks {
            pre_hash: || {},
            post_hash: || {},
            post_quarantine: || {
                writer.write_all(b"external").unwrap();
                writer.sync_all().unwrap();
            },
            permission: noop_permission_hook,
            restore_permissions: restore_file_permissions,
        },
    )
    .unwrap();
    let value = serde_json::to_value(result).unwrap();
    let receipts = value["recoveryResults"]
        .as_array()
        .expect("save must surface retained live inode");
    let retained = Path::new(receipts[0]["destinationPath"].as_str().unwrap());
    assert_eq!(std::fs::read(retained).unwrap(), b"external");
    writer.seek(SeekFrom::Start(0)).unwrap();
    writer.write_all(b"after save").unwrap();
    writer.set_len(10).unwrap();
    writer.sync_all().unwrap();
    assert_eq!(std::fs::read(retained).unwrap(), b"after save");
    let provenance: serde_json::Value =
        serde_json::from_slice(&std::fs::read(retained.with_extension("json")).unwrap()).unwrap();
    assert_eq!(provenance["relativePath"], "script.py");
    assert_eq!(
        provenance["workspaceRoot"],
        scope.root_path().unwrap().to_str().unwrap()
    );
    let read = super::super::artifacts::read_text(&scope, "script.py").unwrap();
    assert_eq!(read.text, "studio");
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_eq!(std::fs::metadata(&target).unwrap().nlink(), 1);
    }
    super::super::artifacts::write_text(&scope, "script.py", "next", Some(&read.sha256)).unwrap();
    assert_eq!(
        super::super::artifacts::read_text(&scope, "script.py")
            .unwrap()
            .text,
        "next"
    );
}

#[cfg(unix)]
#[test]
fn artifact_fifo_read_and_bound_replacement_are_bounded() {
    use wait_timeout::ChildExt;
    const CHILD: &str = "WORKFLOW_STUDIO_FIFO_REGRESSION";
    const ROOT: &str = "WORKFLOW_STUDIO_FIFO_ROOT";
    if let Ok(mode) = std::env::var(CHILD) {
        let root = std::path::PathBuf::from(std::env::var_os(ROOT).unwrap());
        let target = root.join("script.py");
        std::fs::write(&target, "ordinary").unwrap();
        let mut scope = WorkspaceScope::new(&root).unwrap();
        // The parent owns fixtures even if it must kill this process at deadline.
        scope.recovery = None;
        let bound = super::super::artifacts::bind(&scope, "script.py").unwrap();
        let identity = transaction_identity(&bound).unwrap();
        let permissions = bound.parent.metadata(&bound.name).unwrap().permissions();
        let replace = || {
            std::fs::remove_file(&target).unwrap();
            use std::os::unix::ffi::OsStrExt;
            let name = std::ffi::CString::new(target.as_os_str().as_bytes()).unwrap();
            assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        };
        if mode == "save" {
            let error = write_stream_impl(
                &scope,
                "script.py",
                &mut b"studio".as_slice(),
                Some(&hash_bytes(b"ordinary")),
                super::super::artifacts::max_bytes(),
                true,
                None,
                || Ok(()),
                WriteHooks {
                    pre_hash: || {},
                    post_hash: replace,
                    post_quarantine: || {},
                    permission: noop_permission_hook,
                    restore_permissions: restore_file_permissions,
                },
            )
            .unwrap_err();
            assert_eq!(error.code, "external_revision_conflict");
        } else {
            replace();
            let (error, expected) = match mode.as_str() {
                "bound" => (
                    super::super::artifacts::open(&bound).unwrap_err(),
                    "not_a_file",
                ),
                "identity" => (
                    transaction_identity(&bound).unwrap_err(),
                    "workspace_identity_failed",
                ),
                "permissions" => (
                    restore_committed_permissions(
                        &bound,
                        &identity,
                        permissions,
                        restore_file_permissions,
                    )
                    .unwrap_err(),
                    "workspace_permission_restore_failed",
                ),
                _ => (
                    super::super::artifacts::read_text(&scope, "script.py").unwrap_err(),
                    "not_a_file",
                ),
            };
            assert_eq!(error.code, expected);
        }
        return;
    }
    for mode in ["read", "bound", "identity", "permissions", "save"] {
        let root = tempfile::tempdir().unwrap();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "workspace::files::artifact_save_regressions::artifact_fifo_read_and_bound_replacement_are_bounded", "--nocapture"])
            .env(CHILD, mode).env(ROOT, root.path()).spawn().unwrap();
        let status = child
            .wait_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        if status.is_none() {
            child.kill().unwrap();
            child.wait().unwrap();
        }
        assert!(
            status.is_some_and(|status| status.success()),
            "actual native artifact {mode} must reject FIFO before deadline"
        );
    }
}

#[test]
fn artifact_permission_rollback_retains_installed_live_inode() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("script.py");
    std::fs::write(&target, "original").unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let mut writer = None;
    let error = write_stream_impl(
        &scope,
        "script.py",
        &mut b"studio".as_slice(),
        Some(&hash_bytes(b"original")),
        super::super::artifacts::max_bytes(),
        true,
        None,
        || Ok(()),
        WriteHooks {
            pre_hash: || {},
            post_hash: || {},
            post_quarantine: || {},
            permission: |phase: &str, _: bool| {
                if phase == "afterCommit" {
                    let mut file = std::fs::OpenOptions::new()
                        .write(true)
                        .open(&target)
                        .unwrap();
                    file.write_all(b"external staged").unwrap();
                    file.sync_all().unwrap();
                    writer = Some(file);
                }
            },
            restore_permissions: fail_permission_restore,
        },
    )
    .unwrap_err();
    assert_eq!(std::fs::read(&target).unwrap(), b"original");
    let retained = error
        .path_results
        .iter()
        .filter_map(|receipt| receipt.destination_path.as_ref())
        .find(|path| std::fs::read(path).is_ok_and(|bytes| bytes == b"external staged"))
        .expect("rollback must retain the installed inode before unlink");
    let mut writer = writer.unwrap();
    writer.seek(SeekFrom::Start(0)).unwrap();
    writer.write_all(b"after rollback").unwrap();
    writer.set_len(14).unwrap();
    writer.sync_all().unwrap();
    assert_eq!(std::fs::read(retained).unwrap(), b"after rollback");
}

#[test]
fn artifact_save_without_recovery_fails_before_displacing_original() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("script.py"), "original").unwrap();
    let mut scope = WorkspaceScope::new(root.path()).unwrap();
    scope.recovery = None;
    let error = super::super::artifacts::write_text(
        &scope,
        "script.py",
        "studio",
        Some(&hash_bytes(b"original")),
    )
    .unwrap_err();
    assert_eq!(error.code, "workspace_recovery_unavailable");
    assert_eq!(
        std::fs::read(root.path().join("script.py")).unwrap(),
        b"original"
    );
}
