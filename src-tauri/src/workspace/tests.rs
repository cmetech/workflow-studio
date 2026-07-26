use std::fs;

use tempfile::tempdir;

use super::{files, paths};

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
    drop(root);
    assert_code(paths::canonical_root(&selected), "workspace_root_missing");
    assert_code(files::scan(&selected), "workspace_root_missing");
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

    let canonical = paths::canonical_root(root.path()).unwrap();
    let entries = files::scan(&canonical).unwrap();
    assert!(entries
        .iter()
        .any(|entry| entry.relative_path == "nested/flow.yaml"));
    assert!(!entries
        .iter()
        .any(|entry| entry.relative_path == "linked/outside.yaml"));

    assert_code(
        files::read(&canonical, "notes.txt", 1024),
        "unsupported_file_type",
    );
    assert_code(
        files::read(&canonical, "nested/flow.yaml", 4),
        "file_too_large",
    );
    let read = files::read(&canonical, "nested/flow.yaml", 1024).unwrap();
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
    let canonical = paths::canonical_root(root.path()).unwrap();
    let before = files::read(&canonical, "flow.yaml", files::MAX_YAML_BYTES).unwrap();

    assert_code(
        files::write(&canonical, "flow.yaml", "id: stale\n", Some("wrong")),
        "external_revision_conflict",
    );
    assert_eq!(fs::read_to_string(&target).unwrap(), "id: before\n");

    let result =
        files::write(&canonical, "flow.yaml", "id: after\n", Some(&before.sha256)).unwrap();
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
        files::write(&canonical, "flow.yaml", "id: create\n", None),
        "external_revision_conflict",
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
fn rename_pair_rejects_destination_collisions_without_changing_sources() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.yaml"), "id: old\n").unwrap();
    fs::write(root.path().join("old.hermes.yaml"), "profile: default\n").unwrap();
    fs::write(root.path().join("taken.yaml"), "id: taken\n").unwrap();
    let canonical = paths::canonical_root(root.path()).unwrap();

    assert_code(
        files::rename_pair(&canonical, "old.yaml", "taken.yaml"),
        "destination_exists",
    );
    assert!(root.path().join("old.yaml").exists());
    assert!(root.path().join("old.hermes.yaml").exists());

    let renamed = files::rename_pair(&canonical, "old.yaml", "new name.yaml").unwrap();
    assert_eq!(renamed.paths, vec!["new name.yaml", "new name.hermes.yaml"]);
    assert!(root.path().join("new name.yaml").exists());
    assert!(root.path().join("new name.hermes.yaml").exists());
}

#[test]
fn rename_pair_rejects_a_directory_disguised_as_yaml() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("directory.yaml")).unwrap();
    let canonical = paths::canonical_root(root.path()).unwrap();

    assert_code(
        files::rename_pair(&canonical, "directory.yaml", "renamed.yaml"),
        "not_a_file",
    );
    assert!(root.path().join("directory.yaml").is_dir());
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
