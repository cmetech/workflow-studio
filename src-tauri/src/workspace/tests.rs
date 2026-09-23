use std::fs;

use tempfile::tempdir;

use super::{files, paths, WorkspaceScope};

#[test]
fn artifact_utf8_binary_controls_are_metadata_only_and_plain_unicode_remains_text() {
    let root = tempdir().unwrap();
    let scope = scope(root.path());
    for byte in (0u8..=31)
        .chain(std::iter::once(127))
        .filter(|b| ![9, 10, 13].contains(b))
    {
        let bytes = [b'a', byte, 13, 10];
        fs::write(root.path().join("data.bin"), bytes).unwrap();
        assert_eq!(
            super::artifacts::read_text(&scope, "data.bin")
                .unwrap_err()
                .code,
            "artifact_binary"
        );
        assert_eq!(
            super::artifacts::read(&scope, "data.bin").unwrap().size,
            bytes.len() as u64
        );
        assert_eq!(fs::read(root.path().join("data.bin")).unwrap(), bytes);
    }
    let text = "\u{feff}Café 日本語\tvalue\r\nnext\n";
    fs::write(root.path().join("plain.bin"), text).unwrap();
    assert_eq!(
        super::artifacts::read_text(&scope, "plain.bin")
            .unwrap()
            .text,
        text
    );
}

#[test]
fn artifact_executes_pinned_single_path_vectors() {
    let vectors: serde_json::Value = serde_json::from_str(include_str!(
        "../../../contracts/workflow-package-v1-vectors.json"
    ))
    .unwrap();
    for vector in vectors["pathVectors"].as_array().unwrap() {
        if vector["input"]["kind"] != "regular" {
            continue;
        }
        let Some(path) = vector["input"]["path"].as_str() else {
            continue;
        };
        let accepted = vector["expected"]["accepted"].as_bool().unwrap();
        let root = tempdir().unwrap();
        if accepted {
            fs::create_dir_all(root.path().join(path).parent().unwrap()).unwrap();
        }
        let result = super::artifacts::write_text(&scope(root.path()), path, "fixture", None);
        assert_eq!(result.is_ok(), accepted, "{}: {result:?}", vector["name"]);
    }
}

#[test]
fn artifact_text_drafts_and_revision_checks_preserve_yaml_boundary() {
    let root = tempdir().unwrap();
    let scope = scope(root.path());
    let saved = super::artifacts::write_text(&scope, "script.py", "def broken(:", None).unwrap();
    assert_eq!(
        super::artifacts::read_text(&scope, "script.py")
            .unwrap()
            .text,
        "def broken(:"
    );
    assert!(files::read(&scope, "script.py", files::MAX_YAML_BYTES).is_err());
    fs::write(root.path().join("script.py"), "external").unwrap();
    assert_eq!(
        super::artifacts::write_text(&scope, "script.py", "draft", Some(&saved.sha256))
            .unwrap_err()
            .code,
        "workspace_revision_conflict"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("script.py")).unwrap(),
        "external"
    );
    fs::remove_file(root.path().join("script.py")).unwrap();
    assert_eq!(
        super::artifacts::write_text(&scope, "script.py", "draft", Some(&saved.sha256))
            .unwrap_err()
            .code,
        "workspace_revision_conflict"
    );
    assert!(!root.path().join("script.py").exists());
}

#[test]
fn artifact_read_rejects_unsafe_paths_binary_text_and_oversize() {
    let root = tempdir().unwrap();
    let scope = scope(root.path());
    for path in [
        "../secret",
        ".git/config",
        "a/.GIT/config",
        "a//b",
        "a/./b",
        "C:/secret",
    ] {
        assert_eq!(
            super::artifacts::read(&scope, path).unwrap_err().code,
            "workspace_path_invalid"
        );
    }
    fs::write(root.path().join("binary"), [255]).unwrap();
    assert_eq!(
        super::artifacts::read_text(&scope, "binary")
            .unwrap_err()
            .code,
        "invalid_utf8"
    );
    let file = fs::File::create(root.path().join("large")).unwrap();
    file.set_len(super::artifacts::max_bytes() + 1).unwrap();
    assert_eq!(
        super::artifacts::read(&scope, "large").unwrap_err().code,
        "file_too_large"
    );
}

#[test]
fn artifact_grants_are_single_use_identity_and_generation_bound() {
    let root = tempdir().unwrap();
    let source = tempdir().unwrap();
    let scope = scope(root.path());
    let path = source.path().join("source.bin");
    fs::write(&path, [0, 1, 255]).unwrap();
    let grants = super::artifacts::ArtifactGrantState::default();
    let token = super::artifacts::grant_source(&path, 1, &grants)
        .unwrap()
        .source_grant_token;
    let imported =
        super::artifacts::import(&scope, 1, &grants, "resource.bin", &token, None).unwrap();
    assert_eq!(imported.size, 3);
    assert_eq!(
        fs::read(root.path().join("resource.bin")).unwrap(),
        [0, 1, 255]
    );
    assert_eq!(
        super::artifacts::import(
            &scope,
            1,
            &grants,
            "resource.bin",
            &token,
            Some(&imported.sha256)
        )
        .unwrap_err()
        .code,
        "artifact_source_grant_invalid"
    );
    let token = super::artifacts::grant_source(&path, 1, &grants)
        .unwrap()
        .source_grant_token;
    assert_eq!(
        super::artifacts::import(&scope, 2, &grants, "other.bin", &token, None)
            .unwrap_err()
            .code,
        "artifact_source_grant_invalid"
    );
    let token = super::artifacts::grant_source(&path, 2, &grants)
        .unwrap()
        .source_grant_token;
    fs::write(&path, "changed").unwrap();
    assert_eq!(
        super::artifacts::import(&scope, 2, &grants, "other.bin", &token, None)
            .unwrap_err()
            .code,
        "artifact_source_grant_invalid"
    );
    assert!(!root.path().join("other.bin").exists());
}

#[cfg(unix)]
#[test]
fn artifact_rejects_internal_and_external_symlinks() {
    use std::os::unix::fs::symlink;
    let root = tempdir().unwrap();
    fs::write(root.path().join("source"), "secret").unwrap();
    symlink("source", root.path().join("link")).unwrap();
    let scope = scope(root.path());
    assert_eq!(
        super::artifacts::read(&scope, "link").unwrap_err().code,
        "workspace_symlink_unsupported"
    );
    assert_eq!(
        super::artifacts::write_text(&scope, "link", "new", None)
            .unwrap_err()
            .code,
        "workspace_symlink_unsupported"
    );
}

#[test]
fn artifact_external_open_rejects_scripts_and_disguised_content() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("script.py"), "print(1)").unwrap();
    fs::write(root.path().join("fake.png"), "print(1)").unwrap();
    let scope = scope(root.path());
    for path in ["script.py", "fake.png"] {
        assert_eq!(
            super::artifacts::passive_png(&scope, path)
                .unwrap_err()
                .code,
            "artifact_open_unsupported"
        );
    }
}

#[test]
fn artifact_verified_png_is_reencoded_without_trailing_content() {
    let root = tempdir().unwrap();
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[0, 0, 0, 255]).unwrap();
        writer.finish().unwrap();
    }
    let clean = bytes.clone();
    bytes.extend_from_slice(b"print('never open package bytes directly')");
    fs::write(root.path().join("image.png"), bytes).unwrap();
    let scope = scope(root.path());
    assert_eq!(
        super::artifacts::read(&scope, "image.png")
            .unwrap()
            .media_type,
        "image/png"
    );
    assert_eq!(
        super::artifacts::passive_png(&scope, "image.png").unwrap(),
        clean
    );
}

#[test]
fn artifact_stream_copy_failure_preserves_original_and_cleans_staging() {
    struct BrokenSource;
    impl std::io::Read for BrokenSource {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("injected copy failure"))
        }
    }
    let root = tempdir().unwrap();
    fs::write(root.path().join("resource.bin"), "original").unwrap();
    let scope = scope(root.path());
    let hash = super::artifacts::read(&scope, "resource.bin")
        .unwrap()
        .sha256;
    assert!(files::write_artifact_stream(
        &scope,
        "resource.bin",
        &mut BrokenSource,
        Some(&hash),
        None
    )
    .is_err());
    assert_eq!(
        fs::read_to_string(root.path().join("resource.bin")).unwrap(),
        "original"
    );
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[test]
fn artifact_source_verification_failure_after_copy_never_commits() {
    let root = tempdir().unwrap();
    let scope = scope(root.path());
    let result = files::write_artifact_stream_verified(
        &scope,
        "resource.bin",
        &mut &b"copied"[..],
        None,
        None,
        || {
            Err(super::WorkspaceError::new(
                "artifact_source_grant_invalid",
                "Selected source identity changed during copying.",
            ))
        },
    );
    assert_eq!(result.unwrap_err().code, "artifact_source_grant_invalid");
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn artifact_normalization_uses_pinned_unicode14_tables() {
    assert_eq!(unicode_normalization::UNICODE_VERSION, (14, 0, 0));
    let root = tempdir().unwrap();
    let scope = scope(root.path());
    assert_eq!(
        super::artifacts::write_text(&scope, "cafe\u{301}.py", "draft", None)
            .unwrap_err()
            .code,
        "workspace_path_invalid"
    );
    super::artifacts::write_text(&scope, "caf\u{e9}.py", "draft", None).unwrap();
}

#[test]
fn artifact_source_grant_rejects_git_metadata() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join(".git")).unwrap();
    let path = root.path().join(".git/config");
    fs::write(&path, "private repository metadata").unwrap();
    let grants = super::artifacts::ArtifactGrantState::default();
    assert_eq!(
        super::artifacts::grant_source(&path, 1, &grants)
            .unwrap_err()
            .code,
        "workspace_path_invalid"
    );
}

#[cfg(windows)]
#[test]
fn artifact_windows_aliases_report_platform_restriction() {
    let root = tempdir().unwrap();
    let scope = scope(root.path());
    for path in ["data:report", "report.", "report "] {
        assert_eq!(
            super::artifacts::write_text(&scope, path, "draft", None)
                .unwrap_err()
                .code,
            "workspace_path_unsupported_platform"
        );
    }
}

#[cfg(unix)]
#[test]
fn artifact_posix_names_preserve_colons_and_trailing_dots() {
    let root = tempdir().unwrap();
    let scope = scope(root.path());
    super::artifacts::write_text(&scope, "data:report.", "draft", None).unwrap();
    assert_eq!(
        super::artifacts::read_text(&scope, "data:report.")
            .unwrap()
            .text,
        "draft"
    );
}

#[test]
fn artifact_stream_rechecks_destination_after_staging() {
    struct ChangingSource {
        path: std::path::PathBuf,
        done: bool,
    }
    impl std::io::Read for ChangingSource {
        fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
            if self.done {
                return Ok(0);
            }
            fs::write(&self.path, "external")?;
            output[0] = 42;
            self.done = true;
            Ok(1)
        }
    }
    let root = tempdir().unwrap();
    let path = root.path().join("resource.bin");
    fs::write(&path, "original").unwrap();
    let scope = scope(root.path());
    let hash = super::artifacts::read(&scope, "resource.bin")
        .unwrap()
        .sha256;
    assert!(files::write_artifact_stream(
        &scope,
        "resource.bin",
        &mut ChangingSource {
            path: path.clone(),
            done: false
        },
        Some(&hash),
        None
    )
    .is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "external");
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[test]
fn artifact_rejects_symlinks_when_platform_supports_them() {
    if !swap_symlink_tests_supported() {
        return;
    }
    let root = tempdir().unwrap();
    fs::write(root.path().join("source"), "original").unwrap();
    create_file_symlink(&root.path().join("source"), &root.path().join("link"));
    let scope = scope(root.path());
    assert_eq!(
        super::artifacts::read(&scope, "link").unwrap_err().code,
        "workspace_symlink_unsupported"
    );
}

fn scope(path: &std::path::Path) -> WorkspaceScope {
    WorkspaceScope::new(path).unwrap()
}

#[test]
fn workspace_bindings_change_generation_even_when_the_same_path_is_reselected() {
    let root = tempdir().unwrap();
    let state = super::WorkspaceState::default();
    {
        let mut active = state.active.lock().unwrap();
        *active = Some(super::ActiveWorkspace {
            scope: scope(root.path()),
            _watcher: None,
            generation: state
                .next_generation
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        });
    }
    let first = state.active_binding().unwrap();
    {
        let mut active = state.active.lock().unwrap();
        *active = Some(super::ActiveWorkspace {
            scope: scope(root.path()),
            _watcher: None,
            generation: state
                .next_generation
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        });
    }
    assert!(!state.binding_is_current(&first).unwrap());
}

fn assert_code<T>(result: Result<T, super::WorkspaceError>, code: &str) {
    let error = result.err().expect("operation should fail");
    assert_eq!(error.code, code);
}

#[test]
fn reading_a_vanished_save_backup_reports_path_not_found() {
    let root = tempdir().unwrap();
    let workspace = scope(root.path());
    let relative = ".workflow-studio-original-123-2-flow.yaml";
    fs::write(root.path().join(relative), "name: original\n").unwrap();
    assert_code(
        files::read_with_bound_hook(&workspace, relative, 1024, || {
            fs::remove_file(root.path().join(relative)).unwrap();
        }),
        "path_not_found",
    );
    fs::write(root.path().join("flow.yaml"), "name: saved\n").unwrap();
    assert_eq!(
        files::read(&workspace, "flow.yaml", 1024).unwrap().text,
        "name: saved\n"
    );
}

fn workspace_write_residue(path: &std::path::Path) -> Vec<String> {
    let mut residue = fs::read_dir(path)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(".workflow-studio-"))
        .collect::<Vec<_>>();
    residue.sort();
    residue
}

#[cfg(windows)]
fn park_workspace_directory_for_ambient_test(
    workspace: &mut WorkspaceScope,
    parking: &std::path::Path,
) {
    workspace.directory =
        cap_std::fs::Dir::open_ambient_dir(parking, cap_std::ambient_authority()).unwrap();
}

#[cfg(not(windows))]
fn park_workspace_directory_for_ambient_test(_: &mut WorkspaceScope, _: &std::path::Path) {}

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

    if !file_symlink_tests_supported() {
        return;
    }
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
    let mut selected_scope = scope(&selected);
    let handle_parking = tempdir().unwrap();
    park_workspace_directory_for_ambient_test(&mut selected_scope, handle_parking.path());
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
    if !dir_symlink_tests_supported() {
        return;
    }
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
        workspace_write_residue(root.path()),
        Vec::<String>::new(),
        "atomic write must not leave same-directory temporary files"
    );

    assert_code(
        files::write(&workspace, "flow.yaml", "id: create\n", None),
        "external_revision_conflict",
    );

    let read_only_target = root.path().join("read-only.yaml");
    fs::write(&read_only_target, "id: read-only-before\n").unwrap();
    let mut read_only_permissions = fs::metadata(&read_only_target).unwrap().permissions();
    read_only_permissions.set_readonly(true);
    fs::set_permissions(&read_only_target, read_only_permissions).unwrap();
    let read_only_before =
        files::read(&workspace, "read-only.yaml", files::MAX_YAML_BYTES).unwrap();

    files::write(
        &workspace,
        "read-only.yaml",
        "id: read-only-after\n",
        Some(&read_only_before.sha256),
    )
    .unwrap();

    assert_eq!(
        fs::read_to_string(&read_only_target).unwrap(),
        "id: read-only-after\n"
    );
    assert!(fs::metadata(&read_only_target)
        .unwrap()
        .permissions()
        .readonly());
    assert_eq!(workspace_write_residue(root.path()), Vec::<String>::new());

    #[cfg(windows)]
    {
        let rollback_target = root.path().join("rollback.yaml");
        fs::write(&rollback_target, "id: rollback-before\n").unwrap();
        let mut rollback_permissions = fs::metadata(&rollback_target).unwrap().permissions();
        rollback_permissions.set_readonly(true);
        fs::set_permissions(&rollback_target, rollback_permissions).unwrap();
        let rollback_before =
            files::read(&workspace, "rollback.yaml", files::MAX_YAML_BYTES).unwrap();

        let error = files::write_with_permission_restore_failure(
            &workspace,
            "rollback.yaml",
            "id: rollback-after\n",
            Some(&rollback_before.sha256),
        )
        .unwrap_err();

        assert_eq!(error.code, "workspace_permission_restore_failed");
        assert!(error.message.contains("verified original was restored"));
        assert_eq!(
            fs::read_to_string(&rollback_target).unwrap(),
            "id: rollback-before\n"
        );
        assert!(fs::metadata(&rollback_target)
            .unwrap()
            .permissions()
            .readonly());
        assert_eq!(workspace_write_residue(root.path()), Vec::<String>::new());

        let identity_target = root.path().join("identity.yaml");
        let displaced_commit = root.path().join("identity-committed.yaml");
        fs::write(&identity_target, "id: identity-before\n").unwrap();
        let identity_before =
            files::read(&workspace, "identity.yaml", files::MAX_YAML_BYTES).unwrap();

        let error = files::write_with_permission_order_hook(
            &workspace,
            "identity.yaml",
            "id: identity-mine\n",
            Some(&identity_before.sha256),
            |phase, _| {
                if phase == "afterCommit" {
                    fs::rename(&identity_target, &displaced_commit).unwrap();
                    fs::write(&identity_target, "id: identity-external\n").unwrap();
                }
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "workspace_write_partial");
        assert_eq!(
            fs::read_to_string(&identity_target).unwrap(),
            "id: identity-external\n"
        );
        assert_eq!(
            fs::read_to_string(&displaced_commit).unwrap(),
            "id: identity-mine\n"
        );
        assert!(!fs::metadata(&identity_target)
            .unwrap()
            .permissions()
            .readonly());
        let residue = workspace_write_residue(root.path());
        assert_eq!(residue.len(), 1);
        assert!(residue[0].starts_with(".workflow-studio-original-"));
        assert_eq!(
            fs::read_to_string(root.path().join(&residue[0])).unwrap(),
            "id: identity-before\n"
        );

        for target in [&read_only_target, &rollback_target] {
            let mut permissions = fs::metadata(target).unwrap().permissions();
            permissions.set_readonly(false);
            fs::set_permissions(target, permissions).unwrap();
        }
    }
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
    let mut workspace = scope(&root_path);
    let before = files::read(&workspace, "flow.yaml", files::MAX_YAML_BYTES).unwrap();

    let displaced = parent.path().join("displaced");
    let handle_parking = parent.path().join("handle-parking");
    fs::create_dir(&handle_parking).unwrap();
    park_workspace_directory_for_ambient_test(&mut workspace, &handle_parking);
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

    if !swap_symlink_tests_supported() {
        return;
    }

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/flow.yaml"), "id: before\n").unwrap();
    fs::write(outside.path().join("flow.yaml"), "id: outside\n").unwrap();
    let workspace = scope(root.path());
    let before = files::read(&workspace, "nested/flow.yaml", files::MAX_YAML_BYTES).unwrap();
    let parked = root.path().join("parked");
    let parked_file = root.path().join("nested/parked-flow.yaml");
    let result = files::write_with_precommit_hook(
        &workspace,
        "nested/flow.yaml",
        "id: mine\n",
        Some(&before.sha256),
        || {
            if cfg!(windows) {
                fs::rename(root.path().join("nested/flow.yaml"), &parked_file).unwrap();
                create_file_symlink(
                    &outside.path().join("flow.yaml"),
                    &root.path().join("nested/flow.yaml"),
                );
            } else {
                fs::rename(root.path().join("nested"), &parked).unwrap();
                create_dir_symlink(outside.path(), &root.path().join("nested"));
            }
        },
    );
    if cfg!(windows) {
        assert_code(result, "external_revision_conflict");
        assert_eq!(fs::read_to_string(&parked_file).unwrap(), "id: before\n");
    } else {
        result.unwrap();
        assert_eq!(
            fs::read_to_string(parked.join("flow.yaml")).unwrap(),
            "id: mine\n"
        );
    }
    assert_eq!(
        fs::read_to_string(outside.path().join("flow.yaml")).unwrap(),
        "id: outside\n"
    );
}

#[test]
fn bound_read_ignores_a_descendant_swapped_after_parent_binding() {
    if !swap_symlink_tests_supported() {
        return;
    }
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/flow.yaml"), "id: inside\n").unwrap();
    fs::write(outside.path().join("flow.yaml"), "id: outside\n").unwrap();
    let workspace = scope(root.path());
    let parked = root.path().join("parked");
    let parked_file = root.path().join("nested/parked-flow.yaml");

    let result = files::read_with_bound_hook(&workspace, "nested/flow.yaml", 1024, || {
        if cfg!(windows) {
            fs::rename(root.path().join("nested/flow.yaml"), &parked_file).unwrap();
            create_file_symlink(
                &outside.path().join("flow.yaml"),
                &root.path().join("nested/flow.yaml"),
            );
        } else {
            fs::rename(root.path().join("nested"), &parked).unwrap();
            create_dir_symlink(outside.path(), &root.path().join("nested"));
        }
    });

    if cfg!(windows) {
        assert_code(result, "path_outside_workspace");
        assert_eq!(fs::read_to_string(&parked_file).unwrap(), "id: inside\n");
    } else {
        assert_eq!(result.unwrap().text, "id: inside\n");
    }
    assert_eq!(
        fs::read_to_string(outside.path().join("flow.yaml")).unwrap(),
        "id: outside\n"
    );
}

#[test]
fn bound_scan_never_follows_a_descendant_swapped_after_entry_binding() {
    if !dir_symlink_tests_supported() {
        return;
    }
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/inside.yaml"), "id: inside\n").unwrap();
    fs::write(outside.path().join("outside.yaml"), "id: outside\n").unwrap();
    let workspace = scope(root.path());
    let parked = root.path().join("parked");
    let mut swapped = false;

    let result = files::scan_with_entry_hook(&workspace, |relative| {
        if relative == "nested" && !swapped {
            swapped = true;
            fs::rename(root.path().join("nested"), &parked).unwrap();
            create_dir_symlink(outside.path(), &root.path().join("nested"));
        }
    });

    assert!(swapped);
    if cfg!(windows) {
        assert_code(result, "path_outside_workspace");
    } else {
        assert!(!result
            .unwrap()
            .iter()
            .any(|entry| entry.relative_path == "nested/outside.yaml"));
    }
    assert_eq!(
        fs::read_to_string(outside.path().join("outside.yaml")).unwrap(),
        "id: outside\n"
    );
}

#[test]
fn bound_rename_and_trash_ignore_descendant_swaps_after_binding() {
    if !swap_symlink_tests_supported() {
        return;
    }
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/old.yaml"), "id: inside\n").unwrap();
    fs::write(outside.path().join("old.yaml"), "id: outside\n").unwrap();
    let workspace = scope(root.path());
    let parked = root.path().join("parked");
    let parked_file = root.path().join("nested/parked-old.yaml");

    let result = files::rename_pair_with_bound_hook(
        &workspace,
        "nested/old.yaml",
        "nested/new.yaml",
        || {
            if cfg!(windows) {
                fs::rename(root.path().join("nested/old.yaml"), &parked_file).unwrap();
                create_file_symlink(
                    &outside.path().join("old.yaml"),
                    &root.path().join("nested/old.yaml"),
                );
            } else {
                fs::rename(root.path().join("nested"), &parked).unwrap();
                create_dir_symlink(outside.path(), &root.path().join("nested"));
            }
        },
    );
    if cfg!(windows) {
        assert_code(result, "path_outside_workspace");
        assert_eq!(fs::read_to_string(&parked_file).unwrap(), "id: inside\n");
        fs::remove_file(root.path().join("nested/old.yaml")).unwrap();
        fs::rename(&parked_file, root.path().join("nested/old.yaml")).unwrap();
    } else {
        result.unwrap();
        assert_eq!(
            fs::read_to_string(parked.join("new.yaml")).unwrap(),
            "id: inside\n"
        );
        fs::remove_file(root.path().join("nested")).unwrap();
        fs::rename(&parked, root.path().join("nested")).unwrap();
    }
    assert_eq!(
        fs::read_to_string(outside.path().join("old.yaml")).unwrap(),
        "id: outside\n"
    );

    let parked = root.path().join("parked-again");
    let parked_file = root.path().join("nested/parked-again.yaml");
    let trash_relative = if cfg!(windows) {
        "nested/old.yaml"
    } else {
        "nested/new.yaml"
    };
    let result = files::trash_paths_with_bound_hook(
        &workspace,
        &[trash_relative.to_string()],
        || {
            if cfg!(windows) {
                fs::rename(root.path().join(trash_relative), &parked_file).unwrap();
                create_file_symlink(
                    &outside.path().join("old.yaml"),
                    &root.path().join(trash_relative),
                );
            } else {
                fs::rename(root.path().join("nested"), &parked).unwrap();
                create_dir_symlink(outside.path(), &root.path().join("nested"));
            }
        },
        |quarantined| fs::remove_file(quarantined).map_err(|error| error.to_string()),
    )
    .unwrap();
    if cfg!(windows) {
        assert_eq!(result.results[0].status, "failed");
        assert_eq!(
            result.results[0].error_code.as_deref(),
            Some("path_outside_workspace")
        );
        assert_eq!(fs::read_to_string(&parked_file).unwrap(), "id: inside\n");
    } else {
        assert_eq!(result.results[0].status, "trashed");
    }
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
    let root = tempdir().unwrap();
    let root_path = root.path();
    fs::write(root_path.join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(root_path);

    let result = files::trash_paths_with_scope_verification_failure(
        &workspace,
        &["flow.yaml".to_string()],
        "beforeHandoff",
        || {},
        |_| panic!("a replaced selected root must not reach OS Trash"),
    )
    .unwrap();

    assert_eq!(result.results[0].status, "failed");
    assert_eq!(
        result.results[0].error_code.as_deref(),
        Some("workspace_root_changed")
    );
    assert_eq!(
        fs::read_to_string(root_path.join("flow.yaml")).unwrap(),
        "id: original\n"
    );
}

#[test]
fn trash_never_reports_success_if_the_root_changes_after_os_handoff() {
    let parent = tempdir().unwrap();
    let root_path = parent.path().join("workspace");
    fs::create_dir(&root_path).unwrap();
    fs::write(root_path.join("flow.yaml"), "id: original\n").unwrap();
    let workspace = scope(&root_path);
    let os_trash_path = parent.path().join("os-trash-flow.yaml");

    let result = files::trash_paths_with_scope_verification_failure(
        &workspace,
        &["flow.yaml".to_string()],
        "afterDelete",
        || fs::write(root_path.join("flow.yaml"), "id: replacement\n").unwrap(),
        |quarantine| fs::rename(quarantine, &os_trash_path).map_err(|error| error.to_string()),
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
    if !file_symlink_tests_supported() {
        return;
    }
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
    let recovery = fs::read_dir(root.path())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(".workflow-studio-trash-")
        })
        .unwrap();
    assert_eq!(
        fs::read_to_string(&recovery).unwrap(),
        "id: in-place-external\n"
    );
    assert!(result.results[0]
        .message
        .as_ref()
        .unwrap()
        .contains(recovery.file_name().unwrap().to_str().unwrap()));
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
fn nested_workspace_watcher_emits_parent_repository_metadata_changes_without_polling() {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let root = tempdir().unwrap();
    git_fixture(root.path(), &["init", "-b", "main"]);
    fs::create_dir(root.path().join("selected")).unwrap();
    fs::write(root.path().join("selected/flow.yaml"), "name: one\n").unwrap();
    let (sender, receiver) = mpsc::channel();
    let git_directory = root.path().join(".git");
    let git_identity = std::sync::Arc::new(same_file::Handle::from_path(&git_directory).unwrap());
    let metadata = crate::git::GitRepositoryMetadata {
        worktree_dir: git_directory.clone(),
        common_dir: git_directory,
        worktree_identity: std::sync::Arc::clone(&git_identity),
        common_identity: git_identity,
    };
    let watcher = super::watcher::start_with_git_metadata_sink(
        &root.path().join("selected"),
        &metadata,
        move |event| sender.send(event).unwrap(),
    )
    .unwrap();

    git_fixture(root.path(), &["add", "selected/flow.yaml"]);
    git_fixture(root.path(), &["checkout", "-b", "topic"]);

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut git_paths = Vec::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        git_paths.extend(
            event
                .paths
                .into_iter()
                .filter(|path| path.starts_with("@git/")),
        );
        if git_paths.iter().any(|path| path.ends_with("index"))
            && git_paths.iter().any(|path| path.ends_with("HEAD"))
        {
            break;
        }
    }

    assert!(
        git_paths.iter().any(|path| path.ends_with("index")),
        "events: {git_paths:?}"
    );
    assert!(
        git_paths.iter().any(|path| path.ends_with("HEAD")),
        "events: {git_paths:?}"
    );
    drop(watcher);
}

#[test]
fn missing_external_git_metadata_does_not_block_primary_workspace_events() {
    use std::sync::mpsc;
    use std::time::Duration;

    let root = tempdir().unwrap();
    let missing_metadata = root.path().join("missing-parent-git-metadata");
    let (sender, receiver) = mpsc::channel();
    let fallback_identity = std::sync::Arc::new(same_file::Handle::from_path(root.path()).unwrap());
    let metadata = crate::git::GitRepositoryMetadata {
        worktree_dir: missing_metadata.clone(),
        common_dir: missing_metadata,
        worktree_identity: std::sync::Arc::clone(&fallback_identity),
        common_identity: fallback_identity,
    };
    let watcher =
        super::watcher::start_with_git_metadata_sink(root.path(), &metadata, move |event| {
            sender.send(event).unwrap()
        })
        .expect("optional metadata canonicalization must not block the workspace watcher");

    fs::write(root.path().join("flow.yaml"), "name: primary\n").unwrap();
    let event = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("primary workspace event");
    assert!(event.paths.iter().any(|path| path == "flow.yaml"));
    drop(watcher);
}

#[test]
fn rejected_external_git_watch_registration_does_not_block_primary_workspace_events() {
    use notify::Watcher;
    use std::sync::mpsc;
    use std::time::Duration;

    let parent = tempdir().unwrap();
    let root = parent.path().join("workspace");
    let metadata = parent.path().join("parent.git");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&metadata).unwrap();
    let canonical_metadata = metadata.canonicalize().unwrap();
    let metadata_identity = std::sync::Arc::new(same_file::Handle::from_path(&metadata).unwrap());
    let (sender, receiver) = mpsc::channel();
    let metadata_paths = crate::git::GitRepositoryMetadata {
        worktree_dir: metadata.clone(),
        common_dir: metadata,
        worktree_identity: std::sync::Arc::clone(&metadata_identity),
        common_identity: metadata_identity,
    };
    let watcher = super::watcher::start_with_git_metadata_sink_and_registration(
        &root,
        &metadata_paths,
        move |native, path, mode| {
            if path.starts_with(&canonical_metadata) {
                Err(notify::Error::generic(
                    "injected optional Git watch failure",
                ))
            } else {
                native.watch(path, mode)
            }
        },
        move |event| sender.send(event).unwrap(),
    )
    .expect("optional metadata registration must not block the workspace watcher");

    fs::write(root.join("flow.yaml"), "name: primary\n").unwrap();
    let event = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("primary workspace event");
    assert!(event.paths.iter().any(|path| path == "flow.yaml"));
    drop(watcher);
}

#[test]
fn renamed_git_metadata_is_not_reauthorized_during_watcher_registration() {
    use notify::Watcher;
    use std::sync::{Arc, Mutex};

    let parent = tempdir().unwrap();
    let repository = parent.path().join("repo");
    fs::create_dir(&repository).unwrap();
    git_fixture(&repository, &["init", "-b", "main"]);
    fs::create_dir(repository.join("selected")).unwrap();
    let metadata = crate::git::detect_repository_metadata(&repository.join("selected"))
        .unwrap()
        .unwrap();
    let detected_path = metadata.worktree_dir.clone();
    fs::rename(&detected_path, repository.join("parked.git")).unwrap();
    fs::create_dir(&detected_path).unwrap();

    let registered = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&registered);
    let watcher = super::watcher::start_with_git_metadata_sink_and_registration(
        &repository.join("selected"),
        &metadata,
        move |native, path, mode| {
            observed.lock().unwrap().push(path.to_path_buf());
            native.watch(path, mode)
        },
        |_| {},
    )
    .expect("metadata identity mismatch must not block the primary watcher");

    assert!(!registered.lock().unwrap().contains(&detected_path));
    drop(watcher);
}

#[cfg(unix)]
#[test]
fn symlink_swapped_git_metadata_is_not_reauthorized_during_watcher_registration() {
    use notify::Watcher;
    use std::os::unix::fs::symlink;
    use std::sync::{Arc, Mutex};

    let parent = tempdir().unwrap();
    let repository = parent.path().join("repo");
    fs::create_dir(&repository).unwrap();
    git_fixture(&repository, &["init", "-b", "main"]);
    fs::create_dir(repository.join("selected")).unwrap();
    let metadata = crate::git::detect_repository_metadata(&repository.join("selected"))
        .unwrap()
        .unwrap();
    let detected_path = metadata.common_dir.clone();
    fs::rename(&detected_path, repository.join("parked.git")).unwrap();
    let replacement = parent.path().join("replacement.git");
    fs::create_dir(&replacement).unwrap();
    symlink(&replacement, &detected_path).unwrap();

    let registered = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&registered);
    let watcher = super::watcher::start_with_git_metadata_sink_and_registration(
        &repository.join("selected"),
        &metadata,
        move |native, path, mode| {
            observed.lock().unwrap().push(path.to_path_buf());
            native.watch(path, mode)
        },
        |_| {},
    )
    .expect("metadata symlink swap must not block the primary watcher");

    assert!(!registered.lock().unwrap().contains(&replacement));
    drop(watcher);
}

#[test]
fn linked_worktree_common_ref_only_commit_emits_git_change() {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let repository = tempdir().unwrap();
    git_fixture(repository.path(), &["init", "-b", "main"]);
    git_fixture(repository.path(), &["config", "user.name", "Workflow Test"]);
    git_fixture(
        repository.path(),
        &["config", "user.email", "workflow@example.test"],
    );
    fs::write(repository.path().join("flow.yaml"), "name: initial\n").unwrap();
    git_fixture(repository.path(), &["add", "flow.yaml"]);
    git_fixture(repository.path(), &["commit", "-m", "initial"]);

    let linked = repository.path().join("linked worktree");
    git_fixture(
        repository.path(),
        &[
            "worktree",
            "add",
            "-b",
            "linked-topic",
            linked.to_str().unwrap(),
        ],
    );
    let metadata = crate::git::detect_repository_metadata(&linked)
        .unwrap()
        .unwrap();
    assert_ne!(metadata.worktree_dir, metadata.common_dir);
    let head_before = fs::read(metadata.worktree_dir.join("HEAD")).unwrap();
    let index_before = fs::read(metadata.worktree_dir.join("index")).unwrap();

    let (sender, receiver) = mpsc::channel();
    let watcher = super::watcher::start_with_git_metadata_sink(&linked, &metadata, move |event| {
        sender.send(event).unwrap()
    })
    .unwrap();

    git_fixture(
        &linked,
        &["commit", "--allow-empty", "-m", "external ref only"],
    );
    assert_eq!(
        fs::read(metadata.worktree_dir.join("HEAD")).unwrap(),
        head_before
    );
    assert_eq!(
        fs::read(metadata.worktree_dir.join("index")).unwrap(),
        index_before
    );

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut git_paths = Vec::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        git_paths.extend(
            event
                .paths
                .into_iter()
                .filter(|path| path.starts_with("@git/")),
        );
        if git_paths
            .iter()
            .any(|path| path.contains("common/refs/heads/linked-topic"))
        {
            break;
        }
    }

    assert!(
        git_paths
            .iter()
            .any(|path| path.contains("common/refs/heads/linked-topic")),
        "events: {git_paths:?}"
    );
    drop(watcher);
}

pub(super) fn git_fixture(root: &std::path::Path, arguments: &[&str]) {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .output()
        .expect("git fixture command should start");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
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

#[cfg(not(windows))]
fn file_symlink_tests_supported() -> bool {
    true
}

#[cfg(windows)]
fn file_symlink_tests_supported() -> bool {
    let fixture = tempdir().unwrap();
    let target = fixture.path().join("target.yaml");
    let link = fixture.path().join("link.yaml");
    fs::write(&target, "id: target\n").unwrap();
    match std::os::windows::fs::symlink_file(&target, &link) {
        Ok(()) => true,
        Err(error) if error.raw_os_error() == Some(1314) => {
            eprintln!("skipping symlink test because Windows symlink privilege is unavailable");
            false
        }
        Err(error) => panic!("failed to create Windows file symlink fixture: {error}"),
    }
}

#[cfg(unix)]
fn create_dir_symlink(target: &std::path::Path, link: &std::path::Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[cfg(windows)]
fn create_dir_symlink(target: &std::path::Path, link: &std::path::Path) {
    std::os::windows::fs::symlink_dir(target, link).unwrap();
}

#[cfg(not(windows))]
fn dir_symlink_tests_supported() -> bool {
    true
}

#[cfg(windows)]
fn dir_symlink_tests_supported() -> bool {
    let fixture = tempdir().unwrap();
    let target = fixture.path().join("target");
    let link = fixture.path().join("link");
    fs::create_dir(&target).unwrap();
    match std::os::windows::fs::symlink_dir(&target, &link) {
        Ok(()) => true,
        Err(error) if error.raw_os_error() == Some(1314) => {
            eprintln!("skipping symlink test because Windows symlink privilege is unavailable");
            false
        }
        Err(error) => panic!("failed to create Windows directory symlink fixture: {error}"),
    }
}

#[cfg(windows)]
fn swap_symlink_tests_supported() -> bool {
    file_symlink_tests_supported()
}

#[cfg(not(windows))]
fn swap_symlink_tests_supported() -> bool {
    dir_symlink_tests_supported()
}

#[test]
fn transaction_creates_nested_files_and_refuses_stale_plan_before_mutation() {
    let root = tempdir().unwrap();
    let scope = scope(root.path());
    fs::write(root.path().join("existing.md"), "old").unwrap();
    let value = serde_json::json!({"workspaceId": super::transaction::workspace_id(&scope).unwrap(), "expectedEntries": [{"relativePath":"new/deep/one.md","expectedCurrentHash":null},{"relativePath":"existing.md","expectedCurrentHash":"stale"}],"writes":[{"relativePath":"new/deep/one.md","text":"one","expectedCurrentHash":null},{"relativePath":"existing.md","text":"new","expectedCurrentHash":"stale"}],"moves":[],"trashes":[]});
    let plan = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(
        super::transaction::apply(&scope, &plan).unwrap_err().code,
        "workspace_revision_conflict"
    );
    assert!(!root.path().join("new").exists());
    let mut good = value;
    good["writes"].as_array_mut().unwrap().pop();
    good["expectedEntries"].as_array_mut().unwrap().pop();
    good["expectedEntries"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({"relativePath":"new","expectedCurrentHash":null}));
    let plan = serde_json::from_value(good).unwrap();
    assert_eq!(
        super::transaction::apply(&scope, &plan).unwrap().status,
        "committed"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("new/deep/one.md")).unwrap(),
        "one"
    );
}

#[test]
fn transaction_failure_after_each_step_restores_files_and_created_directories() {
    for fail in 0..4 {
        let root = tempdir().unwrap();
        fs::write(root.path().join("old.md"), "original").unwrap();
        let scope = scope(root.path());
        let hash = files::hash_bytes(b"original");
        let plan = serde_json::from_value(serde_json::json!({"workspaceId": super::transaction::workspace_id(&scope).unwrap(),"expectedEntries":[{"relativePath":"old.md","expectedCurrentHash":hash},{"relativePath":"new/deep/dest.md","expectedCurrentHash":null},{"relativePath":"new/manifest.json","expectedCurrentHash":null}],"writes":[{"relativePath":"new/manifest.json","text":"{}","expectedCurrentHash":null}],"moves":[{"sourcePath":"old.md","destinationPath":"new/deep/dest.md"}],"trashes":[]})).unwrap();
        let result = super::transaction::apply_with_hook(&scope, &plan, |step| {
            if step == fail {
                Err(super::WorkspaceError::new("injected", "failure"))
            } else {
                Ok(())
            }
        });
        assert!(result.is_err(), "failure index {fail}");
        assert_eq!(
            fs::read_to_string(root.path().join("old.md")).unwrap(),
            "original"
        );
        assert!(!root.path().join("new").exists());
    }
}

#[test]
fn package_hash_includes_ignored_and_nested_digest_files_and_rejects_added_members() {
    let root = tempdir().unwrap();
    fs::create_dir_all(root.path().join("p/node_modules")).unwrap();
    fs::create_dir_all(root.path().join("p/nested")).unwrap();
    for (path, text) in [
        ("p/workflow-package.json", "{}"),
        ("p/digests.json", "generated"),
        ("p/node_modules/data", "ignored"),
        ("p/nested/digests.json", "nested"),
    ] {
        fs::write(root.path().join(path), text).unwrap();
    }
    let scope = scope(root.path());
    let captured = super::package_hash::capture(&scope, "p").unwrap();
    assert_eq!(
        captured
            .files
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect::<Vec<_>>(),
        [
            "nested/digests.json",
            "node_modules/data",
            "workflow-package.json"
        ]
    );
    fs::write(root.path().join("p/new.txt"), "new").unwrap();
    assert_eq!(
        super::package_hash::verify(&scope, &captured)
            .unwrap_err()
            .code,
        "package_source_changed"
    );
}

#[test]
fn package_hash_rejects_repository_metadata_casefold_aliases_and_limits() {
    let root = tempdir().unwrap();
    fs::create_dir_all(root.path().join("p/.git")).unwrap();
    fs::write(root.path().join("p/.git/config"), "private").unwrap();
    let scope = scope(root.path());
    assert_eq!(
        super::package_hash::capture(&scope, "p").unwrap_err().code,
        "package_repository_metadata"
    );
    fs::remove_file(root.path().join("p/.git/config")).unwrap();
    fs::remove_dir(root.path().join("p/.git")).unwrap();
    fs::write(root.path().join("p/Stra\u{00df}e"), "a").unwrap();
    fs::write(root.path().join("p/STRASSE"), "b").unwrap();
    assert_eq!(
        super::package_hash::capture(&scope, "p").unwrap_err().code,
        "package_path_collision"
    );
}

#[test]
fn package_generated_files_commit_together_and_refuse_changed_index() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    fs::write(root.path().join("p/workflow-package.json"), "{}").unwrap();
    let scope = scope(root.path());
    let captured = super::package_hash::capture(&scope, "p").unwrap();
    let writes = vec![
        super::transaction::WriteRequest {
            relative_path: "p/digests.json".into(),
            text: "digest".into(),
            expected_current_hash: None,
        },
        super::transaction::WriteRequest {
            relative_path: super::generated_write::INDEX_PATH.into(),
            text: "index".into(),
            expected_current_hash: None,
        },
    ];
    super::generated_write::replace(&scope, &captured, &writes).unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("p/digests.json")).unwrap(),
        "digest"
    );
    assert_eq!(
        fs::read_to_string(root.path().join(super::generated_write::INDEX_PATH)).unwrap(),
        "index"
    );
    let captured = super::package_hash::capture(&scope, "p").unwrap();
    let mut writes = writes;
    writes[0].expected_current_hash = Some(files::hash_bytes(b"digest"));
    writes[0].text = "new".into();
    writes[1].expected_current_hash = Some(files::hash_bytes(b"index"));
    fs::write(
        root.path().join(super::generated_write::INDEX_PATH),
        "external",
    )
    .unwrap();
    assert_eq!(
        super::generated_write::replace(&scope, &captured, &writes)
            .unwrap_err()
            .code,
        "workspace_revision_conflict"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("p/digests.json")).unwrap(),
        "digest"
    );
}

#[test]
fn package_limits_include_complete_tree_and_root_digest() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    let scope = scope(root.path());
    let big = fs::File::create(root.path().join("p/digests.json")).unwrap();
    big.set_len(super::artifacts::max_bytes() + 1).unwrap();
    drop(big);
    assert_eq!(
        super::package_hash::capture(&scope, "p").unwrap_err().code,
        "package_file_size_limit"
    );
}

#[test]
fn transaction_reports_recovery_when_external_file_blocks_rollback() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("old"), "old").unwrap();
    let scope = scope(root.path());
    let plan=serde_json::from_value(serde_json::json!({"workspaceId":super::transaction::workspace_id(&scope).unwrap(),"expectedEntries":[{"relativePath":"old","expectedCurrentHash":files::hash_bytes(b"old")},{"relativePath":"dest","expectedCurrentHash":null}],"writes":[],"moves":[{"sourcePath":"old","destinationPath":"dest"}],"trashes":[]})).unwrap();
    let result = super::transaction::apply_with_hook(&scope, &plan, |step| {
        if step == 1 {
            fs::write(root.path().join("old"), "external").unwrap();
            Err(super::WorkspaceError::new("injected", "fail"))
        } else {
            Ok(())
        }
    })
    .unwrap_err();
    assert_eq!(result.code, "workspace_transaction_partial");
    assert!(!result.path_results.is_empty());
    assert_eq!(
        fs::read_to_string(root.path().join("old")).unwrap(),
        "external"
    );
    let saved = result
        .path_results
        .iter()
        .find_map(|path| path.destination_path.as_ref())
        .unwrap();
    assert_eq!(fs::read_to_string(root.path().join(saved)).unwrap(), "old");
}

#[test]
fn transaction_preserves_same_identity_concurrent_installed_write_and_original() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("old"), "A").unwrap();
    let scope = scope(root.path());
    let hash = files::hash_bytes(b"A");
    let plan = serde_json::from_value(serde_json::json!({
        "workspaceId": super::transaction::workspace_id(&scope).unwrap(),
        "expectedEntries": [{"relativePath":"old","expectedCurrentHash":hash}],
        "writes": [{"relativePath":"old","text":"B","expectedCurrentHash":hash}],
        "moves": [], "trashes": []
    }))
    .unwrap();
    let error = super::transaction::apply_with_hook(&scope, &plan, |step| {
        if step == 2 {
            let before = same_file::Handle::from_path(root.path().join("old")).unwrap();
            fs::write(root.path().join("old"), "C").unwrap();
            assert_eq!(
                before,
                same_file::Handle::from_path(root.path().join("old")).unwrap()
            );
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(fs::read_to_string(root.path().join("old")).unwrap(), "C");
    assert_eq!(error.code, "workspace_transaction_partial");
    assert!(error
        .path_results
        .iter()
        .any(|value| value.relative_path == "old" && value.status == "partial"));
    let backup = error
        .path_results
        .iter()
        .find_map(|value| value.destination_path.as_ref())
        .expect("actionable original recovery path");
    assert_eq!(fs::read_to_string(root.path().join(backup)).unwrap(), "A");
}

#[test]
fn transaction_disposal_preserves_write_in_final_hash_to_unlink_gap() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("installed"), "B").unwrap();
    let scope = scope(root.path());
    let bound = super::artifacts::bind(&scope, "installed").unwrap();
    let identity = files::transaction_identity(&bound).unwrap();
    let result = files::transaction_remove_with_hook(
        &scope,
        "installed",
        &bound,
        &identity,
        &files::hash_bytes(b"B"),
        || {
            fs::write(root.path().join("installed"), "C").unwrap();
            assert_eq!(identity, files::transaction_identity(&bound).unwrap());
        },
    );
    assert!(result.is_err(), "changed bytes need a recovery receipt");
    let error = result.unwrap_err();
    let retained = error
        .path_results
        .iter()
        .find_map(|entry| entry.destination_path.as_ref())
        .expect("exact retained path");
    assert_eq!(fs::read_to_string(retained).unwrap(), "C");
}

#[test]
fn transaction_disposal_retains_later_writes_through_open_handle() {
    use std::io::{Seek, SeekFrom, Write};
    let root = tempdir().unwrap();
    fs::write(root.path().join("installed"), "B").unwrap();
    let scope = scope(root.path());
    let bound = super::artifacts::bind(&scope, "installed").unwrap();
    let identity = files::transaction_identity(&bound).unwrap();
    let mut writer = fs::OpenOptions::new()
        .write(true)
        .open(root.path().join("installed"))
        .unwrap();
    let receipt = files::transaction_remove(
        &scope,
        "installed",
        &bound,
        &identity,
        &files::hash_bytes(b"B"),
    )
    .unwrap();
    assert!(!root.path().join("installed").exists());
    writer.seek(SeekFrom::Start(0)).unwrap();
    writer.write_all(b"C").unwrap();
    writer.sync_all().unwrap();
    assert_eq!(receipt.status, "recoveryRetained");
    let saved = receipt.destination_path.unwrap();
    assert!(!std::path::Path::new(&saved).starts_with(root.path()));
    assert_eq!(fs::read_to_string(saved).unwrap(), "C");
}

#[test]
fn transaction_rollback_reports_inner_gap_write_and_restores_original() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("old"), "A").unwrap();
    let scope = scope(root.path());
    let hash = files::hash_bytes(b"A");
    let plan = serde_json::from_value(serde_json::json!({
        "workspaceId": super::transaction::workspace_id(&scope).unwrap(),
        "expectedEntries": [{"relativePath":"old","expectedCurrentHash":hash}],
        "writes": [{"relativePath":"old","text":"B","expectedCurrentHash":hash}], "moves": [], "trashes": []
    })).unwrap();
    let error = super::transaction::apply_with_disposal_hook(
        &scope,
        &plan,
        |step| {
            if step == 2 {
                Err(super::WorkspaceError::new(
                    "injected",
                    "rollback installed write",
                ))
            } else {
                Ok(())
            }
        },
        |relative| {
            assert_eq!(relative, "old");
            let before = same_file::Handle::from_path(root.path().join(relative)).unwrap();
            fs::write(root.path().join(relative), "C").unwrap();
            assert_eq!(
                before,
                same_file::Handle::from_path(root.path().join(relative)).unwrap()
            );
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "workspace_transaction_partial");
    assert_eq!(fs::read_to_string(root.path().join("old")).unwrap(), "A");
    let receipt = error
        .path_results
        .iter()
        .find(|entry| entry.status == "recoveryRetained")
        .unwrap();
    assert_eq!(receipt.relative_path, "old");
    assert_eq!(
        fs::read_to_string(receipt.destination_path.as_ref().unwrap()).unwrap(),
        "C"
    );
}

#[test]
fn transaction_success_discloses_original_recovery_without_package_pollution() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("workflow-package.json"), "A").unwrap();
    let scope = scope(root.path());
    let hash = files::hash_bytes(b"A");
    let plan = serde_json::from_value(serde_json::json!({
        "workspaceId": super::transaction::workspace_id(&scope).unwrap(),
        "expectedEntries": [{"relativePath":"workflow-package.json","expectedCurrentHash":hash}],
        "writes": [{"relativePath":"workflow-package.json","text":"B","expectedCurrentHash":hash}], "moves": [], "trashes": []
    })).unwrap();
    let result = super::transaction::apply(&scope, &plan).unwrap();
    assert_eq!(result.status, "committed");
    let receipt = result
        .results
        .iter()
        .find(|entry| entry.status == "recoveryRetained")
        .unwrap();
    assert_eq!(receipt.relative_path, "workflow-package.json");
    assert_eq!(
        fs::read_to_string(receipt.destination_path.as_ref().unwrap()).unwrap(),
        "A"
    );
    let snapshot = super::package_hash::capture(&scope, "").unwrap();
    assert_eq!(snapshot.files.len(), 1);
    assert_eq!(snapshot.files[0].sha256, files::hash_bytes(b"B"));
}

#[test]
fn transaction_binary_replacement_returns_recovery_receipt_and_rejects_user_hardlinks() {
    let root = tempdir().unwrap();
    let external = tempdir().unwrap();
    fs::write(root.path().join("old.bin"), [0, 255]).unwrap();
    fs::write(external.path().join("new.bin"), [255, 0]).unwrap();
    let scope = scope(root.path());
    let captured = super::package_hash::capture(&scope, "").unwrap();
    let grants = super::artifacts::ArtifactGrantState::default();
    let grant =
        super::artifacts::grant_source(&external.path().join("new.bin"), 1, &grants).unwrap();
    let imported = super::artifacts::import_captured(
        &scope,
        1,
        &grants,
        "old.bin",
        &grant.source_grant_token,
        Some(&files::hash_bytes(&[0, 255])),
        Some(&captured),
    )
    .unwrap();
    assert_eq!(imported.recovery_results.len(), 1);
    let receipt = &imported.recovery_results[0];
    assert_eq!(receipt.status, "recoveryRetained");
    assert_eq!(
        fs::read(receipt.destination_path.as_ref().unwrap()).unwrap(),
        [0, 255]
    );
    assert_eq!(
        super::package_hash::capture(&scope, "")
            .unwrap()
            .files
            .len(),
        1
    );
    fs::hard_link(
        root.path().join("old.bin"),
        external.path().join("user-linked.bin"),
    )
    .unwrap();
    assert!(super::package_hash::capture(&scope, "").is_err());
}

#[test]
fn transaction_preserves_same_identity_concurrent_moved_file() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("old"), "A").unwrap();
    let scope = scope(root.path());
    let plan = serde_json::from_value(serde_json::json!({
        "workspaceId": super::transaction::workspace_id(&scope).unwrap(),
        "expectedEntries": [{"relativePath":"old","expectedCurrentHash":files::hash_bytes(b"A")},{"relativePath":"dest","expectedCurrentHash":null}],
        "writes": [], "moves": [{"sourcePath":"old","destinationPath":"dest"}], "trashes": []
    })).unwrap();
    let error = super::transaction::apply_with_hook(&scope, &plan, |step| {
        if step == 2 {
            fs::write(root.path().join("dest"), "C").unwrap();
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "workspace_transaction_partial");
    assert_eq!(fs::read_to_string(root.path().join("dest")).unwrap(), "C");
    assert!(!root.path().join("old").exists());
    assert!(error
        .path_results
        .iter()
        .any(|value| value.relative_path == "dest" && value.status == "partial"));
}

#[test]
fn transaction_preserves_same_identity_concurrent_staged_file() {
    let root = tempdir().unwrap();
    let scope = scope(root.path());
    let plan = serde_json::from_value(serde_json::json!({
        "workspaceId": super::transaction::workspace_id(&scope).unwrap(),
        "expectedEntries": [{"relativePath":"dest","expectedCurrentHash":null}],
        "writes": [{"relativePath":"dest","text":"B","expectedCurrentHash":null}], "moves": [], "trashes": []
    })).unwrap();
    let mut saved = String::new();
    let error = super::transaction::apply_with_hook(&scope, &plan, |step| {
        if step == 0 {
            saved = fs::read_dir(root.path())
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .file_name()
                .to_str()
                .unwrap()
                .to_owned();
            fs::write(root.path().join(&saved), "C").unwrap();
            return Err(super::WorkspaceError::new(
                "injected",
                "stop before installation",
            ));
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "workspace_transaction_partial");
    assert_eq!(fs::read_to_string(root.path().join(&saved)).unwrap(), "C");
    assert!(error
        .path_results
        .iter()
        .any(|value| value.relative_path == saved && value.status == "partial"));
}

#[test]
fn transaction_preserves_same_identity_concurrent_backup_on_failure_and_success() {
    for fail in [true, false] {
        let root = tempdir().unwrap();
        fs::write(root.path().join("old"), "A").unwrap();
        let scope = scope(root.path());
        let hash = files::hash_bytes(b"A");
        let plan = serde_json::from_value(serde_json::json!({
            "workspaceId": super::transaction::workspace_id(&scope).unwrap(),
            "expectedEntries": [{"relativePath":"old","expectedCurrentHash":hash}],
            "writes": [{"relativePath":"old","text":"B","expectedCurrentHash":hash}], "moves": [], "trashes": []
        })).unwrap();
        let mut saved = String::new();
        let result = super::transaction::apply_with_hook(&scope, &plan, |step| {
            if step == 2 {
                saved = fs::read_dir(root.path())
                    .unwrap()
                    .map(|entry| entry.unwrap().file_name().to_str().unwrap().to_owned())
                    .find(|name| name.starts_with(".workflow-studio-original-"))
                    .unwrap();
                fs::write(root.path().join(&saved), "C").unwrap();
                if fail {
                    return Err(super::WorkspaceError::new(
                        "injected",
                        "stop after installation",
                    ));
                }
            }
            Ok(())
        });
        assert!(result.is_err(), "changed backup must be reported");
        let error = result.unwrap_err();
        assert_eq!(error.code, "workspace_transaction_partial");
        assert_eq!(fs::read_to_string(root.path().join(&saved)).unwrap(), "C");
        assert!(error
            .path_results
            .iter()
            .any(|value| value.destination_path.as_ref() == Some(&saved)
                && value.status == "partial"));
        if fail {
            assert!(!root.path().join("old").exists());
        } else {
            assert_eq!(fs::read_to_string(root.path().join("old")).unwrap(), "B");
        }
    }
}

#[test]
fn package_contract_filesystem_boundary_recipes() {
    use base64::Engine;
    let vectors: serde_json::Value = serde_json::from_str(include_str!(
        "../../../contracts/workflow-package-v1-vectors.json"
    ))
    .unwrap();
    fn bytes(value: &serde_json::Value) -> Vec<u8> {
        if let Some(repeat) = value["repeat"].as_str() {
            return repeat
                .repeat(value["count"].as_u64().unwrap() as usize)
                .into_bytes();
        }
        let text = value["value"].as_str().unwrap();
        if value["encoding"] == "base64" {
            base64::engine::general_purpose::STANDARD
                .decode(text)
                .unwrap()
        } else {
            text.as_bytes().to_vec()
        }
    }
    fn path(template: &str, index: u64) -> String {
        template
            .replace("{index:04d}", &format!("{index:04}"))
            .replace("{index:02d}", &format!("{index:02}"))
    }
    for vector in vectors["boundaryVectors"].as_array().unwrap() {
        let recipe = &vector["recipe"];
        let kind = recipe["kind"].as_str().unwrap();
        if kind != "packageFiles" && kind != "filesystemEntries" {
            continue;
        }
        let root = tempdir().unwrap();
        fs::create_dir(root.path().join("p")).unwrap();
        if kind == "filesystemEntries" {
            for index in 0..recipe["count"].as_u64().unwrap() {
                fs::create_dir(
                    root.path()
                        .join("p")
                        .join(path(recipe["pathTemplate"].as_str().unwrap(), index)),
                )
                .unwrap();
            }
        } else {
            let create = |name: String, data: Vec<u8>| {
                let file = root.path().join("p").join(name);
                fs::create_dir_all(file.parent().unwrap()).unwrap();
                fs::write(file, data).unwrap();
            };
            for file in recipe["files"].as_array().unwrap() {
                create(
                    file["path"].as_str().unwrap().into(),
                    bytes(&file["content"]),
                );
            }
            for set in recipe["generatedFiles"].as_array().unwrap() {
                for index in 0..set["count"].as_u64().unwrap() {
                    create(
                        path(
                            set["pathTemplate"].as_str().unwrap(),
                            index + set["startIndex"].as_u64().unwrap(),
                        ),
                        bytes(&set["content"]),
                    );
                }
            }
        }
        if kind == "packageFiles" {
            fs::write(root.path().join("p/digests.json"), "generated metadata").unwrap();
        }
        let result = super::package_hash::capture(&scope(root.path()), "p");
        if vector["expected"]["accepted"] == true {
            assert!(
                result.is_ok(),
                "{}: {:?}",
                vector["name"],
                result.unwrap_err()
            );
            if kind == "filesystemEntries" {
                let writes = vec![
                    super::transaction::WriteRequest {
                        relative_path: "p/digests.json".into(),
                        text: "{}".into(),
                        expected_current_hash: None,
                    },
                    super::transaction::WriteRequest {
                        relative_path: super::generated_write::INDEX_PATH.into(),
                        text: "{}".into(),
                        expected_current_hash: None,
                    },
                ];
                let workspace = scope(root.path());
                assert_eq!(
                    super::generated_write::replace(&workspace, &result.unwrap(), &writes)
                        .unwrap_err()
                        .code,
                    "package_traversal_limit"
                );
                assert!(!root.path().join("p/digests.json").exists());
                fs::remove_dir(
                    root.path()
                        .join("p")
                        .join(path(recipe["pathTemplate"].as_str().unwrap(), 0)),
                )
                .unwrap();
                let captured = super::package_hash::capture(&workspace, "p").unwrap();
                super::generated_write::replace(&workspace, &captured, &writes).unwrap();
                let captured = super::package_hash::capture(&workspace, "p").unwrap();
                let existing_writes: Vec<_> = writes
                    .into_iter()
                    .map(|mut write| {
                        write.expected_current_hash = Some(files::hash_bytes(b"{}"));
                        write
                    })
                    .collect();
                super::generated_write::replace(&workspace, &captured, &existing_writes).unwrap();
            }
        } else {
            assert_eq!(
                result.unwrap_err().code,
                vector["expected"]["diagnosticCode"].as_str().unwrap(),
                "{}",
                vector["name"]
            );
        }
    }
}

#[test]
fn package_hash_rejects_membership_change_during_capture() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    fs::write(root.path().join("p/a"), "a").unwrap();
    let scope = scope(root.path());
    let result = super::package_hash::capture_with_hook(&scope, "p", || {
        fs::write(root.path().join("p/new"), "new").unwrap();
    });
    assert_eq!(result.unwrap_err().code, "package_source_changed");
}

#[test]
fn package_generated_failure_between_writes_restores_both_outputs() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    fs::create_dir_all(root.path().join(".well-known/hermes-workflows")).unwrap();
    fs::write(root.path().join("p/a"), "source").unwrap();
    fs::write(root.path().join("p/digests.json"), "old digest").unwrap();
    fs::write(
        root.path().join(super::generated_write::INDEX_PATH),
        "old index",
    )
    .unwrap();
    let scope = scope(root.path());
    let writes = vec![
        super::transaction::WriteRequest {
            relative_path: "p/digests.json".into(),
            text: "new digest".into(),
            expected_current_hash: Some(files::hash_bytes(b"old digest")),
        },
        super::transaction::WriteRequest {
            relative_path: super::generated_write::INDEX_PATH.into(),
            text: "new index".into(),
            expected_current_hash: Some(files::hash_bytes(b"old index")),
        },
    ];
    for fail in 0..5 {
        let capture = super::package_hash::capture(&scope, "p").unwrap();
        assert!(
            super::generated_write::replace_with_hook(&scope, &capture, &writes, |step| {
                if step == fail {
                    Err(super::WorkspaceError::new("injected", "failure"))
                } else {
                    Ok(())
                }
            })
            .is_err()
        );
        assert_eq!(
            fs::read_to_string(root.path().join("p/digests.json")).unwrap(),
            "old digest"
        );
        assert_eq!(
            fs::read_to_string(root.path().join(super::generated_write::INDEX_PATH)).unwrap(),
            "old index"
        );
    }
}

#[test]
fn package_generated_postcommit_source_verification_rolls_back_outputs() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    fs::write(root.path().join("p/source"), "original").unwrap();
    let scope = scope(root.path());
    let capture = super::package_hash::capture(&scope, "p").unwrap();
    let writes = vec![
        super::transaction::WriteRequest {
            relative_path: "p/digests.json".into(),
            text: "digest".into(),
            expected_current_hash: None,
        },
        super::transaction::WriteRequest {
            relative_path: super::generated_write::INDEX_PATH.into(),
            text: "index".into(),
            expected_current_hash: None,
        },
    ];
    let result = super::generated_write::replace_with_hook(&scope, &capture, &writes, |step| {
        if step == 1 {
            fs::write(root.path().join("p/source"), "changed").unwrap();
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(result.code, "package_source_changed");
    assert!(!root.path().join("p/digests.json").exists());
    assert!(!root.path().join(".well-known").exists());
}

#[test]
fn transaction_readonly_target_fails_closed_before_mutation() {
    let root = tempdir().unwrap();
    let target = root.path().join("draft.md");
    fs::write(&target, "old").unwrap();
    let mut permissions = fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&target, permissions).unwrap();
    let scope = scope(root.path());
    let hash = files::hash_bytes(b"old");
    let plan = serde_json::from_value(serde_json::json!({"workspaceId":super::transaction::workspace_id(&scope).unwrap(),"expectedEntries":[{"relativePath":"draft.md","expectedCurrentHash":hash}],"writes":[{"relativePath":"draft.md","text":"new","expectedCurrentHash":hash}],"moves":[],"trashes":[]})).unwrap();
    let outcome = super::transaction::apply(&scope, &plan);
    let mut permissions = fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(false);
    fs::set_permissions(&target, permissions).unwrap();
    assert_eq!(outcome.unwrap_err().code, "workspace_readonly_unsupported");
    assert_eq!(fs::read_to_string(&target).unwrap(), "old");
}
#[cfg(unix)]
#[test]
fn transaction_preserves_executable_permission_bits() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempdir().unwrap();
    let target = root.path().join("draft.py");
    fs::write(&target, "old").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o750)).unwrap();
    let scope = scope(root.path());
    let hash = files::hash_bytes(b"old");
    let plan = serde_json::from_value(serde_json::json!({"workspaceId":super::transaction::workspace_id(&scope).unwrap(),"expectedEntries":[{"relativePath":"draft.py","expectedCurrentHash":hash}],"writes":[{"relativePath":"draft.py","text":"new","expectedCurrentHash":hash}],"moves":[],"trashes":[]})).unwrap();
    super::transaction::apply(&scope, &plan).unwrap();
    assert_eq!(
        fs::metadata(target).unwrap().permissions().mode() & 0o777,
        0o750
    );
}

#[test]
fn package_hash_rejects_nested_manifests_case_insensitively() {
    let root = tempdir().unwrap();
    fs::create_dir_all(root.path().join("p/nested")).unwrap();
    fs::write(root.path().join("p/nested/WORKFLOW-PACKAGE.JSON"), "{}").unwrap();
    assert_eq!(
        super::package_hash::capture(&scope(root.path()), "p")
            .unwrap_err()
            .code,
        "package_root_nested"
    );
}

#[test]
fn package_workspace_root_capture_revalidates_without_absolute_joins() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("workflow-package.json"), "{}").unwrap();
    fs::write(root.path().join("nested/a.md"), "a").unwrap();
    fs::write(root.path().join("digests.json"), "generated").unwrap();
    let workspace = scope(root.path());
    let captured = super::package_hash::capture(&workspace, "").unwrap();
    assert_eq!(
        captured
            .files
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect::<Vec<_>>(),
        vec!["nested/a.md", "workflow-package.json"]
    );
    assert_eq!(
        super::package_hash::workspace_entries(&captured)
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect::<Vec<_>>(),
        vec![
            "digests.json",
            "nested",
            "nested/a.md",
            "workflow-package.json"
        ]
    );
    super::package_hash::verify(&workspace, &captured).unwrap();
    super::package_hash::verify_sources(&workspace, &captured, &[]).unwrap();
    assert_eq!(
        super::generated_write::replace(&workspace, &captured, &[])
            .unwrap_err()
            .code,
        "package_root_required"
    );
    fs::write(root.path().join("nested/a.md"), "changed").unwrap();
    assert_eq!(
        super::package_hash::verify_sources(&workspace, &captured, &[])
            .unwrap_err()
            .code,
        "package_source_changed"
    );
}

#[test]
fn package_transaction_failure_at_each_staged_file_restores_existing_and_new_package_trees() {
    for fail in 0..8 {
        let root = tempdir().unwrap();
        fs::write(root.path().join("existing.md"), "retained bytes").unwrap();
        let scope = scope(root.path());
        let paths = [
            "new/README.md",
            "new/workflow-package.json",
            "new/workflows/main.yaml",
            "new/scripts/helper.py",
            "new/workflows/main.hermes.yaml",
            "new/commands/run.md",
            "new/fixtures/input.json",
            "new/digests.json",
        ];
        let expected: Vec<_> = paths
            .iter()
            .map(|path| serde_json::json!({"relativePath":path,"expectedCurrentHash":null}))
            .collect();
        let writes: Vec<_> = paths.iter().map(|path| serde_json::json!({"relativePath":path,"text":"new bytes","expectedCurrentHash":null})).collect();
        let plan = serde_json::from_value(serde_json::json!({"workspaceId":super::transaction::workspace_id(&scope).unwrap(),"expectedEntries":expected,"writes":writes,"moves":[],"trashes":[]})).unwrap();
        let result = super::transaction::apply_with_staging_hook(&scope, &plan, |position| {
            if position == fail {
                Err(super::WorkspaceError::new(
                    "injected_staging_failure",
                    "injected disk staging failure",
                ))
            } else {
                Ok(())
            }
        });
        assert_eq!(
            result.unwrap_err().code,
            "injected_staging_failure",
            "staged position {fail}"
        );
        assert_eq!(
            fs::read(root.path().join("existing.md")).unwrap(),
            b"retained bytes"
        );
        assert!(!root.path().join("new").exists());
        assert_eq!(
            fs::read_dir(root.path()).unwrap().count(),
            1,
            "no temporary siblings after staged failure {fail}"
        );
    }
}
