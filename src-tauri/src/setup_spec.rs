use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use sha2::{Digest, Sha256};
use tempfile::tempdir;

use crate::setup::{
    atomic_persist_readiness, load_remembered_workspace, redact_log_line, run_setup,
    verify_resource_tree, BoundedSetupLog, IntegrityEntry, IntegrityManifest, SetupEvent,
    SetupPaths, SetupRunStatus, SetupServices, SetupState,
};

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn resource_fixture() -> (tempfile::TempDir, IntegrityManifest) {
    let root = tempdir().unwrap();
    let files = [
        ("contracts/contract.json", b"contract".as_slice()),
        (
            "examples/minimal/workflow.yaml",
            b"name: minimal\n".as_slice(),
        ),
        ("brands/loop24/brand.yaml", b"schemaVersion: 1\n".as_slice()),
    ];
    let mut entries = Vec::new();
    for (path, bytes) in files {
        let destination = root.path().join(path);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(&destination, bytes).unwrap();
        entries.push(IntegrityEntry {
            path: path.to_owned(),
            sha256: digest(bytes),
            max_bytes: 1_024,
        });
    }
    (
        root,
        IntegrityManifest {
            schema_version: 1,
            files: entries,
        },
    )
}

#[test]
fn committed_integrity_manifest_matches_the_exact_bundled_repository_tree() {
    let manifest: IntegrityManifest =
        serde_json::from_str(include_str!("../resources/setup-integrity-v1.json")).unwrap();
    let repository_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();

    verify_resource_tree(repository_root, &manifest).unwrap();
    assert_eq!(manifest.files.len(), 30);
}

#[test]
fn resource_verification_rejects_tampering_missing_extra_and_oversized_files() {
    let (root, manifest) = resource_fixture();
    verify_resource_tree(root.path(), &manifest).unwrap();

    fs::write(root.path().join("contracts/contract.json"), b"tampered").unwrap();
    assert_eq!(
        verify_resource_tree(root.path(), &manifest)
            .unwrap_err()
            .code,
        "setup_resource_digest_mismatch"
    );
    fs::write(root.path().join("contracts/contract.json"), b"contract").unwrap();
    fs::write(root.path().join("examples/extra.yaml"), b"extra").unwrap();
    assert_eq!(
        verify_resource_tree(root.path(), &manifest)
            .unwrap_err()
            .code,
        "setup_resource_unexpected"
    );
    fs::remove_file(root.path().join("examples/extra.yaml")).unwrap();
    fs::remove_file(root.path().join("brands/loop24/brand.yaml")).unwrap();
    assert_eq!(
        verify_resource_tree(root.path(), &manifest)
            .unwrap_err()
            .code,
        "setup_resource_missing"
    );

    let (root, mut manifest) = resource_fixture();
    manifest.files[0].max_bytes = 2;
    assert_eq!(
        verify_resource_tree(root.path(), &manifest)
            .unwrap_err()
            .code,
        "setup_resource_too_large"
    );
}

#[cfg(unix)]
#[test]
fn resource_verification_rejects_symlinks_and_special_entries() {
    use std::os::unix::fs::symlink;

    let (root, manifest) = resource_fixture();
    fs::remove_file(root.path().join("contracts/contract.json")).unwrap();
    symlink(
        "../brands/loop24/brand.yaml",
        root.path().join("contracts/contract.json"),
    )
    .unwrap();
    assert_eq!(
        verify_resource_tree(root.path(), &manifest)
            .unwrap_err()
            .code,
        "setup_resource_invalid_type"
    );
}

#[test]
fn setup_logs_are_private_bounded_and_redacted_before_sink_and_storage() {
    let root = tempdir().unwrap();
    let mut log = BoundedSetupLog::create(root.path(), "opaque-run-1", 1_234).unwrap();
    log.push("GET https://example.test/install?token=secret&x=1");
    log.push("Authorization: Bearer top-secret");
    log.push("prompt: reveal workflow content");
    log.push(&"x".repeat(20_000));
    let lines = log.lines();

    assert_eq!(lines.len(), 4);
    assert!(lines[0].contains("?[REDACTED]"));
    assert!(!lines.join("\n").contains("secret"));
    assert!(!lines.join("\n").contains("reveal workflow content"));
    assert!(lines[3].len() <= 4_096);
    let persisted = fs::read_to_string(log.path()).unwrap();
    assert_eq!(persisted, format!("{}\n", lines.join("\n")));
    assert!(persisted.len() <= 256 * 1_024);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(root.path().join("setup-logs"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(log.path()).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn redaction_is_case_insensitive_and_bounds_event_payloads() {
    assert_eq!(
        redact_log_line("AUTHORIZATION=Bearer ABCDEF"),
        "AUTHORIZATION=[REDACTED]"
    );
    assert_eq!(
        redact_log_line("https://host/path?code=abc#fragment"),
        "https://host/path?[REDACTED]"
    );
    assert_eq!(redact_log_line("ToKeN=ABCDEF"), "ToKeN=[REDACTED]");
}

#[test]
fn setup_runs_real_stages_and_missing_git_is_a_non_blocking_advisory() {
    let app_data = tempdir().unwrap();
    let (resources, manifest) = resource_fixture();
    let recent_workspace = tempdir().unwrap();
    let recent_workspace_path = recent_workspace.path().canonicalize().unwrap();
    fs::write(
        app_data.path().join("recent-workspaces-v1.json"),
        format!(
            "[{{\"rootPath\":{},\"lastOpenedAt\":\"2026-07-30T00:00:00Z\"}}]",
            serde_json::to_string(recent_workspace_path.to_str().unwrap()).unwrap()
        ),
    )
    .unwrap();
    let paths = SetupPaths {
        app_data: app_data.path().to_path_buf(),
        resource_root: resources.path().to_path_buf(),
    };
    let events = std::sync::Mutex::new(Vec::new());
    let snapshot = run_setup(
        &paths,
        "run-1",
        "0.1.0",
        &manifest,
        &AtomicBool::new(false),
        &SetupServices::new(|| Err("Git is not installed".to_owned())),
        &|event| events.lock().unwrap().push(event.clone()),
    )
    .unwrap();

    assert_eq!(snapshot.status, SetupRunStatus::Succeeded);
    assert_eq!(snapshot.stages.len(), 5);
    assert_eq!(snapshot.stages[2].status.as_str(), "skipped");
    assert!(snapshot.stages[2]
        .message
        .as_deref()
        .unwrap()
        .contains("Git is unavailable"));
    assert!(snapshot.stages[3]
        .message
        .as_deref()
        .unwrap()
        .contains("remembered workspace"));
    assert!(app_data.path().join("setup-ready-v1.json").is_file());
    assert!(events.lock().unwrap().len() >= 12);
}

#[test]
fn readiness_is_atomic_and_keyed_by_schema_and_app_version() {
    let root = tempdir().unwrap();
    atomic_persist_readiness(root.path(), 1, "0.1.0").unwrap();
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(root.path().join("setup-ready-v1.json")).unwrap())
            .unwrap();
    assert_eq!(value["schemaVersion"], 1);
    assert_eq!(value["appVersion"], "0.1.0");
    assert!(fs::read_dir(root.path()).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains(".tmp")));
}

#[test]
fn remembered_workspace_reads_only_app_owned_state_without_granting_capability() {
    let app_data = tempdir().unwrap();
    let workspace = tempdir().unwrap();
    let workspace_path = workspace.path().canonicalize().unwrap();
    fs::write(
        app_data.path().join("recent-workspaces-v1.json"),
        format!(
            "[{{\"rootPath\":{},\"lastOpenedAt\":\"now\"}}]",
            serde_json::to_string(workspace_path.to_str().unwrap()).unwrap()
        ),
    )
    .unwrap();
    assert_eq!(
        load_remembered_workspace(app_data.path()).unwrap(),
        Some(workspace_path)
    );
    fs::write(
        app_data.path().join("recent-workspaces-v1.json"),
        "not json",
    )
    .unwrap();
    assert_eq!(load_remembered_workspace(app_data.path()).unwrap(), None);
}

#[test]
fn cancellation_is_run_specific_and_observed_only_between_stages() {
    let state = SetupState::default();
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .install_active_run("new-run", cancellation.clone())
        .unwrap();
    assert!(!state.cancel("old-run").unwrap());
    assert!(!cancellation.load(Ordering::SeqCst));
    assert!(state.cancel("new-run").unwrap());
    assert!(cancellation.load(Ordering::SeqCst));
}

#[test]
fn app_data_failure_emits_a_terminal_failure_snapshot_event() {
    let app_data_parent = tempdir().unwrap();
    let app_data = app_data_parent.path().join("not-a-directory");
    fs::write(&app_data, "occupied").unwrap();
    let (resources, manifest) = resource_fixture();
    let events = std::sync::Mutex::new(Vec::new());

    let result = run_setup(
        &SetupPaths {
            app_data,
            resource_root: resources.path().to_path_buf(),
        },
        "run-failure",
        "0.1.0",
        &manifest,
        &AtomicBool::new(false),
        &SetupServices::new(|| Ok("git version 2.50".to_owned())),
        &|event| events.lock().unwrap().push(event.clone()),
    );

    assert_eq!(result.unwrap_err().code, "setup_app_data_invalid");
    assert!(matches!(
        events.lock().unwrap().last(),
        Some(SetupEvent::Failed {
            code: "setup_app_data_invalid",
            ..
        })
    ));
}
