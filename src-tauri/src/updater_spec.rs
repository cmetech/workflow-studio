use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier};

use tempfile::tempdir;

#[cfg(unix)]
use crate::setup::AppDataScope;
use crate::updater::{
    install_after_verified_download, load_update_preferences, redact_update_log_line,
    store_update_preferences, InstallOutcome, UpdatePhase, UpdateState,
};
#[cfg(unix)]
use crate::updater::{load_update_preferences_with_hook, store_update_preferences_with_hook};
use crate::updater_key::{validate_public_key, TEST_UPDATER_PUBLIC_KEY};

#[test]
fn only_one_active_update_run_can_be_claimed_atomically() {
    let state = Arc::new(UpdateState::default());
    let barrier = Arc::new(Barrier::new(9));
    let mut workers = Vec::new();
    for index in 0..8 {
        let state = state.clone();
        let barrier = barrier.clone();
        workers.push(std::thread::spawn(move || {
            barrier.wait();
            state
                .claim_check(format!("run-{index}"), 100)
                .unwrap()
                .claimed
        }));
    }
    barrier.wait();
    let claims = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .filter(|claimed| *claimed)
        .count();
    assert_eq!(claims, 1);
    assert_eq!(state.snapshot().unwrap().phase, UpdatePhase::Checking);
}

#[test]
fn cancellation_returns_an_authoritative_terminal_event_and_snapshot() {
    let state = UpdateState::default();
    state.claim_check("cancel-run".to_owned(), 100).unwrap();
    let (cancelled, event) = state.cancel("cancel-run").unwrap();
    assert!(cancelled);
    assert!(event.is_some());
    assert_eq!(state.snapshot().unwrap().phase, UpdatePhase::Dismissed);
}

#[test]
fn signature_failure_never_reaches_the_install_commit_point() {
    let marked_installing = AtomicBool::new(false);
    let installed = AtomicBool::new(false);
    let result = install_after_verified_download::<Vec<u8>, (), &'static str>(
        Err("signature invalid"),
        || {
            marked_installing.store(true, Ordering::SeqCst);
            Ok(Some(()))
        },
        |_| {
            installed.store(true, Ordering::SeqCst);
            Ok(())
        },
    );

    assert_eq!(result.unwrap_err(), "signature invalid");
    assert!(!marked_installing.load(Ordering::SeqCst));
    assert!(!installed.load(Ordering::SeqCst));
}

#[test]
fn cancellation_wins_before_install_but_not_after_the_explicit_commit_point() {
    let installed = AtomicBool::new(false);
    assert_eq!(
        install_after_verified_download(
            Ok::<_, ()>(vec![1]),
            || Ok(None::<()>),
            |_| {
                installed.store(true, Ordering::SeqCst);
                Ok(())
            }
        )
        .unwrap(),
        InstallOutcome::Cancelled
    );
    assert!(!installed.load(Ordering::SeqCst));

    assert_eq!(
        install_after_verified_download(
            Ok::<_, ()>(vec![1]),
            || Ok(Some(())),
            |_| {
                installed.store(true, Ordering::SeqCst);
                Ok(())
            }
        )
        .unwrap(),
        InstallOutcome::Installed
    );
    assert!(installed.load(Ordering::SeqCst));
}

#[test]
fn an_install_commit_failure_is_propagated_without_running_the_installer() {
    let installed = AtomicBool::new(false);
    let result = install_after_verified_download(
        Ok::<_, &'static str>(vec![1]),
        || Err::<Option<()>, _>("install commit failed"),
        |_| {
            installed.store(true, Ordering::SeqCst);
            Ok(())
        },
    );

    assert_eq!(result.unwrap_err(), "install commit failed");
    assert!(!installed.load(Ordering::SeqCst));
}

#[test]
fn updater_preferences_default_on_recover_from_malformed_data_and_store_atomically() {
    let root = tempdir().unwrap();
    assert!(
        load_update_preferences(root.path())
            .unwrap()
            .startup_check_enabled
    );

    std::fs::write(root.path().join("update-settings-v1.json"), b"not json").unwrap();
    assert!(
        load_update_preferences(root.path())
            .unwrap()
            .startup_check_enabled
    );

    store_update_preferences(root.path(), false).unwrap();
    assert!(
        !load_update_preferences(root.path())
            .unwrap()
            .startup_check_enabled
    );
    assert!(std::fs::read_dir(root.path()).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains(".tmp")));
}

#[cfg(unix)]
#[test]
fn updater_preferences_reject_symlinks_and_root_swap_interleavings() {
    use std::os::unix::fs::symlink;

    let parent = tempdir().unwrap();
    let app_data = parent.path().join("app-data");
    std::fs::create_dir(&app_data).unwrap();
    let outside = parent.path().join("outside.json");
    std::fs::write(
        &outside,
        br#"{"schemaVersion":1,"startupCheckEnabled":false}"#,
    )
    .unwrap();
    symlink(&outside, app_data.join("update-settings-v1.json")).unwrap();
    assert!(
        load_update_preferences(&app_data)
            .unwrap()
            .startup_check_enabled
    );
    assert!(store_update_preferences(&app_data, false).is_err());
    std::fs::remove_file(app_data.join("update-settings-v1.json")).unwrap();
    store_update_preferences(&app_data, true).unwrap();

    let parked = parent.path().join("parked");
    let replacement = app_data.clone();
    let result = load_update_preferences_with_hook(&app_data, || {
        std::fs::rename(&replacement, &parked).unwrap();
        std::fs::create_dir(&replacement).unwrap();
    });
    assert_eq!(result.unwrap_err().code, "update_app_data_changed");

    std::fs::remove_dir(&replacement).unwrap();
    std::fs::rename(&parked, &replacement).unwrap();
    let parked = parent.path().join("parked-write");
    let replacement_for_hook = replacement.clone();
    let result = store_update_preferences_with_hook(&replacement, false, || {
        std::fs::rename(&replacement_for_hook, &parked).unwrap();
        std::fs::create_dir(&replacement_for_hook).unwrap();
    });
    assert_eq!(result.unwrap_err().code, "update_app_data_changed");
}

#[cfg(unix)]
#[test]
fn updater_saved_logs_reject_leaf_replacement_before_opening() {
    let root = tempdir().unwrap();
    let scope = AppDataScope::bind_for_logs(root.path(), "update-logs").unwrap();
    let (_log, saved) = scope.create_log("opaque-update-run", 100).unwrap();
    let path = saved.validate_for_open().unwrap();
    std::fs::remove_file(&path).unwrap();
    std::fs::write(&path, b"replacement").unwrap();

    assert!(saved.open_with(|_| Ok(())).is_err());
}

#[test]
fn update_log_redaction_removes_queries_credentials_signatures_and_workflow_content() {
    let lines = [
        "GET https://example.test/latest.json?token=secret&x=1",
        "Authorization: Bearer top-secret",
        "signature=untrusted-material",
        "nodes: private workflow content",
    ]
    .map(redact_update_log_line);

    let joined = lines.join("\n");
    assert!(joined.contains("?[REDACTED]"));
    assert!(!joined.contains("secret"));
    assert!(!joined.contains("untrusted-material"));
    assert!(!joined.contains("private workflow content"));
    assert!(lines.iter().all(|line| line.len() <= 4_096));
}

#[test]
fn release_public_key_validation_rejects_empty_malformed_and_documented_test_keys() {
    const STRUCTURALLY_INVALID_MINISIGN_DOCUMENT: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDAwMDAwMDAwMDAwMDAwMDAKUldSaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoCg==";

    assert!(validate_public_key("", false).is_err());
    assert!(validate_public_key("not a minisign public key", false).is_err());
    assert!(validate_public_key(STRUCTURALLY_INVALID_MINISIGN_DOCUMENT, false).is_err());
    assert!(validate_public_key(TEST_UPDATER_PUBLIC_KEY, false).is_err());
    assert!(validate_public_key(TEST_UPDATER_PUBLIC_KEY, true).is_ok());
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(
        config
            .pointer("/plugins/updater/endpoints/0")
            .and_then(serde_json::Value::as_str),
        Some("https://github.com/cmetech/workflow-studio/releases/latest/download/latest.json")
    );
    assert!(validate_public_key(
        config
            .pointer("/plugins/updater/pubkey")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default(),
        false
    )
    .is_ok());
}
