use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use sha2::{Digest, Sha256};
use tempfile::tempdir;

#[cfg(unix)]
use crate::setup::ResourceScope;
use crate::setup::{
    atomic_persist_readiness, initialize_setup_status, is_ready, load_remembered_workspace,
    redact_log_line, run_setup, verify_resource_tree, AppDataScope, BoundedSetupLog,
    IntegrityEntry, IntegrityManifest, SetupEvent, SetupPaths, SetupRunStatus, SetupServices,
    SetupState,
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
    log.push("GET https://example.test/install?token=secret&x=1")
        .unwrap();
    log.push("Authorization: Bearer top-secret").unwrap();
    log.push("prompt: reveal workflow content").unwrap();
    log.push(&"x".repeat(20_000)).unwrap();
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
        .claim_active_run("new-run", cancellation.clone())
        .unwrap();
    assert!(!state.cancel("old-run").unwrap());
    assert!(!cancellation.load(Ordering::SeqCst));
    assert!(state.cancel("new-run").unwrap());
    assert!(cancellation.load(Ordering::SeqCst));
}

#[test]
fn concurrent_run_claims_install_exactly_one_active_run() {
    let state = SetupState::default();
    let barrier = Arc::new(std::sync::Barrier::new(3));
    let mut workers = Vec::new();
    for run_id in ["claim-one", "claim-two"] {
        let state = state.clone();
        let barrier = barrier.clone();
        workers.push(std::thread::spawn(move || {
            barrier.wait();
            state
                .claim_active_run(run_id, Arc::new(AtomicBool::new(false)))
                .unwrap()
        }));
    }
    barrier.wait();
    let claims = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();

    assert_eq!(claims.iter().filter(|claim| claim.claimed).count(), 1);
    assert_eq!(claims[0].snapshot.run_id, claims[1].snapshot.run_id);
}

#[test]
fn cancellation_after_readiness_commit_cannot_disagree_with_terminal_status() {
    let app_data = tempdir().unwrap();
    let (resources, manifest) = resource_fixture();
    let cancelled = AtomicBool::new(false);
    let events = std::sync::Mutex::new(Vec::new());
    let snapshot = run_setup(
        &SetupPaths {
            app_data: app_data.path().to_path_buf(),
            resource_root: resources.path().to_path_buf(),
        },
        "commit-run",
        "0.1.0",
        &manifest,
        &cancelled,
        &SetupServices::new(|| Ok("git version 2.50".to_owned())),
        &|event| {
            if matches!(
                event,
                SetupEvent::Stage {
                    stage_id: "ready",
                    status: crate::setup::SetupStageStatus::Succeeded,
                    ..
                }
            ) {
                cancelled.store(true, Ordering::SeqCst);
            }
            events.lock().unwrap().push(event.clone());
        },
    )
    .unwrap();

    assert!(is_ready(app_data.path(), "0.1.0"));
    assert_eq!(snapshot.status, SetupRunStatus::Succeeded);
    assert!(matches!(
        events.lock().unwrap().last(),
        Some(SetupEvent::Complete { .. })
    ));
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

#[test]
fn app_data_scope_rejects_replaced_root_and_ancestor_names_for_read_write_and_prune() {
    let outer = tempdir().unwrap();
    let ancestor = outer.path().join("private");
    let app_data = ancestor.join("workflow-studio");
    fs::create_dir_all(&app_data).unwrap();
    let scope = AppDataScope::bind(&app_data).unwrap();

    fs::rename(&ancestor, outer.path().join("private-old")).unwrap();
    fs::create_dir_all(&app_data).unwrap();

    assert_eq!(
        scope.load_remembered_workspace().unwrap_err().code,
        "setup_app_data_changed"
    );
    assert_eq!(
        scope.persist_readiness(1, "0.1.0").unwrap_err().code,
        "setup_app_data_changed"
    );
    assert_eq!(
        scope.prune_setup_logs(None).err().unwrap().code,
        "setup_app_data_changed"
    );
}

#[cfg(unix)]
#[test]
fn app_data_scope_rejects_recent_readiness_and_log_leaf_swaps() {
    use std::os::unix::fs::symlink;

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
    let scope = AppDataScope::bind(app_data.path()).unwrap();
    let outside = app_data
        .path()
        .parent()
        .unwrap()
        .join("outside-setup-target");
    fs::write(&outside, "outside").unwrap();

    let recent = app_data.path().join("recent-workspaces-v1.json");
    assert_eq!(
        scope
            .load_remembered_workspace_with_open_hook(|| {
                fs::remove_file(&recent).unwrap();
                symlink(&outside, &recent).unwrap();
            })
            .unwrap_err()
            .code,
        "setup_workspace_record_changed"
    );
    fs::remove_file(&recent).unwrap();

    assert_eq!(
        scope
            .persist_readiness_with_commit_hook(1, "0.1.0", || {
                symlink(&outside, app_data.path().join("setup-ready-v1.json")).unwrap();
            })
            .unwrap_err()
            .code,
        "setup_ready_destination_changed"
    );
    assert_eq!(fs::read_to_string(&outside).unwrap(), "outside");

    let (mut log, saved) = scope.create_log("leaf-run", 1_234).unwrap();
    let logs = app_data.path().join("setup-logs");
    fs::rename(&logs, app_data.path().join("setup-logs-old")).unwrap();
    fs::create_dir(&logs).unwrap();
    symlink(&outside, logs.join(saved.file_name())).unwrap();
    assert_eq!(
        saved.validate_for_open().unwrap_err().code,
        "setup_app_data_changed"
    );
    assert_eq!(
        log.push("must stay private").unwrap_err().code,
        "setup_app_data_changed"
    );
    assert_eq!(fs::read_to_string(&outside).unwrap(), "outside");
}

#[cfg(unix)]
#[test]
fn resource_scope_rejects_root_and_leaf_name_swaps() {
    use std::os::unix::fs::symlink;

    let (root, manifest) = resource_fixture();
    let resource_path = root.path().to_path_buf();
    let scope = ResourceScope::bind(&resource_path).unwrap();
    let moved = resource_path.with_extension("moved");
    fs::rename(&resource_path, &moved).unwrap();
    fs::create_dir_all(&resource_path).unwrap();
    assert_eq!(
        scope.verify(&manifest).unwrap_err().code,
        "setup_resource_root_changed"
    );

    fs::remove_dir_all(&resource_path).unwrap();
    fs::rename(&moved, &resource_path).unwrap();
    let scope = ResourceScope::bind(&resource_path).unwrap();
    let contract = resource_path.join("contracts/contract.json");
    let target = resource_path.join("brands/loop24/brand.yaml");
    assert_eq!(
        scope
            .verify_with_entry_hook(&manifest, |relative| {
                if relative == "contracts/contract.json" {
                    fs::remove_file(&contract).unwrap();
                    symlink(&target, &contract).unwrap();
                }
            })
            .unwrap_err()
            .code,
        "setup_resource_invalid_type"
    );
}

#[cfg(unix)]
#[test]
fn resource_scope_rejects_a_symbolic_link_root() {
    use std::os::unix::fs::symlink;

    let (root, _) = resource_fixture();
    let link_parent = tempdir().unwrap();
    let link = link_parent.path().join("resources");
    symlink(root.path(), &link).unwrap();

    assert_eq!(
        ResourceScope::bind(&link).err().unwrap().code,
        "setup_resource_root_changed"
    );
}

#[test]
fn setup_registers_the_current_log_before_renderer_log_events() {
    let app_data = tempdir().unwrap();
    let (resources, manifest) = resource_fixture();
    let state = SetupState::default();
    state
        .claim_active_run("registered-run", Arc::new(AtomicBool::new(false)))
        .unwrap();
    let callback_state = state.clone();
    let registered = Arc::new(AtomicBool::new(false));
    let callback_registered = registered.clone();
    let services =
        SetupServices::new(|| Ok("git version 2.50".to_owned())).with_log_registry(move |logs| {
            callback_state.replace_logs(logs)?;
            if let Some(saved) = callback_state.saved_log("registered-run")? {
                saved.validate_for_open()?;
                callback_registered.store(true, Ordering::SeqCst);
            }
            Ok(())
        });

    run_setup(
        &SetupPaths {
            app_data: app_data.path().to_path_buf(),
            resource_root: resources.path().to_path_buf(),
        },
        "registered-run",
        "0.1.0",
        &manifest,
        &AtomicBool::new(false),
        &services,
        &|event| {
            if matches!(event, SetupEvent::Log { .. }) {
                assert!(registered.load(Ordering::SeqCst));
            }
        },
    )
    .unwrap();

    assert!(registered.load(Ordering::SeqCst));
}

#[test]
fn startup_prunes_and_rehydrates_persisted_log_capabilities() {
    let app_data = tempdir().unwrap();
    let scope = AppDataScope::bind(app_data.path()).unwrap();
    let (_log, saved) = scope.create_log("restart-run", 1_234).unwrap();
    saved
        .open_with(|path| {
            assert!(path.is_file());
            Ok(())
        })
        .unwrap();
    drop(scope);
    let state = SetupState::default();

    assert!(!initialize_setup_status(app_data.path(), &state, "0.1.0").unwrap());
    assert!(state.saved_log("restart-run").unwrap().is_some());
}

#[cfg(unix)]
#[test]
fn persisted_logs_are_pruned_across_retries_and_restart_by_count_and_bytes() {
    use std::ffi::OsStr;
    use std::os::unix::fs::symlink;

    let app_data = tempdir().unwrap();
    let scope = AppDataScope::bind(app_data.path()).unwrap();
    let logs = app_data.path().join("setup-logs");
    for index in 0..25 {
        fs::write(
            logs.join(format!("{:013}-retry-{index}.log", index + 1)),
            vec![b'x'; 120 * 1_024],
        )
        .unwrap();
    }
    let current = "0000000000000-current.log";
    fs::write(logs.join(current), vec![b'c'; 200 * 1_024]).unwrap();
    fs::write(logs.join("not-a-log.txt"), b"corrupt").unwrap();
    fs::write(
        logs.join("9999999999998-oversized.log"),
        vec![b'o'; 256 * 1_024 + 1],
    )
    .unwrap();
    let outside = app_data.path().parent().unwrap().join("outside-log-target");
    fs::write(&outside, "outside").unwrap();
    symlink(&outside, logs.join("9999999999999-symlink.log")).unwrap();

    let retained = scope.prune_setup_logs(Some(OsStr::new(current))).unwrap();
    assert!(logs.join(current).is_file());
    assert!(retained.len() <= 20);
    assert!(
        retained
            .iter()
            .map(|saved| fs::metadata(saved.validate_for_open().unwrap())
                .unwrap()
                .len())
            .sum::<u64>()
            <= 2 * 1024 * 1024
    );
    assert!(!logs.join("not-a-log.txt").exists());
    assert!(!logs.join("9999999999998-oversized.log").exists());
    assert!(!logs.join("9999999999999-symlink.log").exists());

    drop(scope);
    let restarted = AppDataScope::bind(app_data.path()).unwrap();
    let retained_after_restart = restarted
        .prune_setup_logs(Some(OsStr::new(current)))
        .unwrap();
    assert!(retained_after_restart.len() <= 20);
    assert!(logs.join(current).is_file());
}

#[test]
fn log_writes_enforce_the_aggregate_persisted_byte_bound() {
    let app_data = tempdir().unwrap();
    let scope = AppDataScope::bind(app_data.path()).unwrap();
    let logs = app_data.path().join("setup-logs");
    for index in 0..8 {
        fs::write(
            logs.join(format!("{:013}-older-{index}.log", index + 1)),
            vec![b'o'; 255 * 1_024],
        )
        .unwrap();
    }
    let (mut current, saved) = scope.create_log("write-run", 9_999_999_999_999).unwrap();

    current.push(&"x".repeat(4_096)).unwrap();
    current.push(&"y".repeat(4_096)).unwrap();

    let total = fs::read_dir(&logs)
        .unwrap()
        .map(|entry| entry.unwrap().metadata().unwrap().len())
        .sum::<u64>();
    assert!(total <= 2 * 1024 * 1024);
    assert!(saved.validate_for_open().unwrap().is_file());
}

#[test]
fn failed_pruning_does_not_accumulate_a_new_log_on_each_retry() {
    let app_data = tempdir().unwrap();
    let scope = AppDataScope::bind(app_data.path()).unwrap();
    let logs = app_data.path().join("setup-logs");
    fs::create_dir(logs.join("unexpected-directory")).unwrap();

    for timestamp in 1..=3 {
        assert_eq!(
            scope
                .create_log("bounded-retry", timestamp)
                .err()
                .unwrap()
                .code,
            "setup_log_invalid"
        );
    }

    assert_eq!(
        fs::read_dir(&logs)
            .unwrap()
            .filter(|entry| entry.as_ref().unwrap().file_type().unwrap().is_file())
            .count(),
        0
    );
}
