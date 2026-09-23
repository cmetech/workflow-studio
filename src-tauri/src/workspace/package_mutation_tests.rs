use super::{artifacts, package_hash, transaction, WorkspaceScope};
use std::fs;
use tempfile::tempdir;

fn plan(scope: &WorkspaceScope, value: serde_json::Value) -> transaction::PackageMutationPlan {
    let mut value = value;
    value["workspaceId"] = transaction::workspace_id(scope).unwrap().into();
    serde_json::from_value(value).unwrap()
}

#[test]
fn guarded_mutation_rejects_changed_membership_and_outside_destinations() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    fs::write(root.path().join("p/old.md"), "old").unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let captured = package_hash::capture(&scope, "p").unwrap();
    let request = plan(
        &scope,
        serde_json::json!({"expectedEntries":[{"relativePath":"p/new/deep.md","expectedCurrentHash":null}],"writes":[{"relativePath":"p/new/deep.md","text":"new","expectedCurrentHash":null}],"moves":[],"trashes":[]}),
    );
    fs::write(root.path().join("p/foreign.md"), "foreign").unwrap();
    assert_eq!(
        transaction::apply_captured_with_hook(&scope, &request, &captured, |_| Ok(()))
            .unwrap_err()
            .code,
        "package_source_changed"
    );
    assert!(!root.path().join("p/new").exists());
    let captured = package_hash::capture(&scope, "p").unwrap();
    let outside = plan(
        &scope,
        serde_json::json!({"expectedEntries":[{"relativePath":"outside.md","expectedCurrentHash":null}],"writes":[{"relativePath":"outside.md","text":"new","expectedCurrentHash":null}],"moves":[],"trashes":[]}),
    );
    assert_eq!(
        transaction::apply_captured_with_hook(&scope, &outside, &captured, |_| Ok(()))
            .unwrap_err()
            .code,
        "package_mutation_outside_root"
    );
}

#[test]
fn guarded_mutation_adopts_only_hash_bound_standalone_sources_and_retains_outside_expectations() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    fs::write(root.path().join("p/old.md"), "old").unwrap();
    fs::write(root.path().join("standalone.yaml"), "source").unwrap();
    fs::write(root.path().join("index.json"), "{}").unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let captured = package_hash::capture(&scope, "p").unwrap();
    let source = artifacts::read(&scope, "standalone.yaml").unwrap().sha256;
    let index = artifacts::read(&scope, "index.json").unwrap().sha256;
    let mut request = plan(
        &scope,
        serde_json::json!({"expectedEntries":[{"relativePath":"p/workflows/new.yaml","expectedCurrentHash":null},{"relativePath":"index.json","expectedCurrentHash":index}],"writes":[],"moves":[{"sourcePath":"standalone.yaml","destinationPath":"p/workflows/new.yaml"}],"trashes":[]}),
    );
    assert_eq!(
        transaction::apply_captured_with_hook(&scope, &request, &captured, |_| Ok(()))
            .unwrap_err()
            .code,
        "workspace_transaction_invalid"
    );
    request
        .expected_entries
        .push(transaction::ExpectedWorkspaceEntry {
            relative_path: "standalone.yaml".into(),
            expected_current_hash: Some(source),
        });
    transaction::apply_captured_with_hook(&scope, &request, &captured, |_| Ok(())).unwrap();
    assert_eq!(
        fs::read(root.path().join("p/workflows/new.yaml")).unwrap(),
        b"source"
    );
    assert!(!root.path().join("standalone.yaml").exists());
}

#[test]
fn guarded_mutation_detects_foreign_members_during_publication_and_rolls_back_owned_files() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    fs::write(root.path().join("p/old.md"), "old").unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let captured = package_hash::capture(&scope, "p").unwrap();
    let request = plan(
        &scope,
        serde_json::json!({"expectedEntries":[{"relativePath":"p/new/deep.md","expectedCurrentHash":null}],"writes":[{"relativePath":"p/new/deep.md","text":"new","expectedCurrentHash":null}],"moves":[],"trashes":[]}),
    );
    let error = transaction::apply_captured_with_hook(&scope, &request, &captured, |step| {
        if step == 1 {
            fs::write(root.path().join("p/new/foreign.md"), "foreign").unwrap();
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "workspace_transaction_partial");
    assert!(error
        .path_results
        .iter()
        .any(|result| result.relative_path == "p/new" && result.status == "partial"));
    assert_eq!(fs::read(root.path().join("p/old.md")).unwrap(), b"old");
    assert_eq!(
        fs::read(root.path().join("p/new/foreign.md")).unwrap(),
        b"foreign"
    );
    assert!(!root.path().join("p/new/deep.md").exists());
}

#[test]
fn guarded_mutation_checks_aggregate_not_just_new_write_bytes() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    for index in 0..8 {
        fs::write(
            root.path().join(format!("p/{index}.bin")),
            vec![0u8; 1024 * 1024],
        )
        .unwrap();
    }
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let captured = package_hash::capture(&scope, "p").unwrap();
    let request = plan(
        &scope,
        serde_json::json!({"expectedEntries":[{"relativePath":"p/new.md","expectedCurrentHash":null}],"writes":[{"relativePath":"p/new.md","text":"x","expectedCurrentHash":null}],"moves":[],"trashes":[]}),
    );
    assert_eq!(
        transaction::apply_captured_with_hook(&scope, &request, &captured, |_| Ok(()))
            .unwrap_err()
            .code,
        "package_total_size_limit"
    );
    assert!(!root.path().join("p/new.md").exists());
}

#[test]
fn guarded_binary_import_projects_exact_bytes_and_creates_nested_parents() {
    let root = tempdir().unwrap();
    let external = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    for index in 0..8 {
        fs::write(
            root.path().join(format!("p/{index}.bin")),
            vec![0u8; 1024 * 1024],
        )
        .unwrap();
    }
    fs::write(external.path().join("source.bin"), [255u8]).unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let grants = artifacts::ArtifactGrantState::default();
    let captured = package_hash::capture(&scope, "p").unwrap();
    let grant = artifacts::grant_source(&external.path().join("source.bin"), 1, &grants).unwrap();
    assert_eq!(
        artifacts::import_captured(
            &scope,
            1,
            &grants,
            "p/new.bin",
            &grant.source_grant_token,
            None,
            Some(&captured)
        )
        .unwrap_err()
        .code,
        "package_total_size_limit"
    );
    assert!(!root.path().join("p/new.bin").exists());
    let grant = artifacts::grant_source(&external.path().join("source.bin"), 1, &grants).unwrap();
    let prior = artifacts::read(&scope, "p/0.bin").unwrap();
    artifacts::import_captured(
        &scope,
        1,
        &grants,
        "p/0.bin",
        &grant.source_grant_token,
        Some(&prior.sha256),
        Some(&captured),
    )
    .unwrap();
    let captured = package_hash::capture(&scope, "p").unwrap();
    let grant = artifacts::grant_source(&external.path().join("source.bin"), 1, &grants).unwrap();
    artifacts::import_captured(
        &scope,
        1,
        &grants,
        "p/new/deep.bin",
        &grant.source_grant_token,
        None,
        Some(&captured),
    )
    .unwrap();
    assert_eq!(
        fs::read(root.path().join("p/new/deep.bin")).unwrap(),
        [255u8]
    );
}

#[test]
fn guarded_binary_stream_failure_at_each_source_check_rolls_back_created_directories() {
    for failure in 1..=3 {
        let root = tempdir().unwrap();
        fs::create_dir(root.path().join("p")).unwrap();
        fs::write(root.path().join("p/old.md"), "old").unwrap();
        let scope = WorkspaceScope::new(root.path()).unwrap();
        let captured = package_hash::capture(&scope, "p").unwrap();
        let request = plan(
            &scope,
            serde_json::json!({"expectedEntries":[{"relativePath":"p/new/deep.bin","expectedCurrentHash":null}],"writes":[{"relativePath":"p/new/deep.bin","text":"","expectedCurrentHash":null}],"moves":[],"trashes":[]}),
        );
        let bytes = [255u8, 0];
        let mut reader = std::io::Cursor::new(bytes);
        let hash = super::files::hash_bytes(&bytes);
        let checks = std::cell::Cell::new(0);
        let result = transaction::apply_captured_stream(
            &scope,
            &request,
            &captured,
            &hash,
            2,
            &mut reader,
            || {
                checks.set(checks.get() + 1);
                if checks.get() == failure {
                    Err(super::WorkspaceError::new(
                        "injected_source_change",
                        "source changed",
                    ))
                } else {
                    Ok(())
                }
            },
        );
        assert_eq!(result.unwrap_err().code, "injected_source_change");
        assert!(
            !root.path().join("p/new").exists(),
            "failure check {failure}"
        );
        assert_eq!(fs::read(root.path().join("p/old.md")).unwrap(), b"old");
    }
}

#[test]
fn guarded_mutation_accepts_exact_final_traversal_limit_when_staging_adds_parent_directories() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    let traversal = package_hash::limit("max_traversal_entries");
    for index in 0..traversal - 2 {
        fs::create_dir(root.path().join(format!("p/d{index}"))).unwrap();
    }
    fs::write(root.path().join("p/old-a.md"), "a").unwrap();
    fs::write(root.path().join("p/old-b.md"), "b").unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let captured = package_hash::capture(&scope, "p").unwrap();
    let a = artifacts::read(&scope, "p/old-a.md").unwrap().sha256;
    let b = artifacts::read(&scope, "p/old-b.md").unwrap().sha256;
    // Move one member into a new directory and remove another: final traversal stays exact.
    let request = plan(
        &scope,
        serde_json::json!({"expectedEntries":[{"relativePath":"p/new/a.md","expectedCurrentHash":null},{"relativePath":"p/old-a.md","expectedCurrentHash":a},{"relativePath":"p/old-b.md","expectedCurrentHash":b}],"writes":[],"moves":[{"sourcePath":"p/old-a.md","destinationPath":"p/new/a.md"}],"trashes":[{"relativePath":"p/old-b.md","expectedCurrentHash":b}]}),
    );
    transaction::apply_captured_with_hook(&scope, &request, &captured, |_| Ok(())).unwrap();
    assert_eq!(
        package_hash::workspace_entries(&package_hash::capture(&scope, "p").unwrap()).len() as u64,
        traversal
    );
}

#[test]
fn guarded_publication_rechecks_installed_identity_after_final_capture() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let request = plan(
        &scope,
        serde_json::json!({"expectedEntries":[{"relativePath":"p/new.md","expectedCurrentHash":null}],"writes":[{"relativePath":"p/new.md","text":"new","expectedCurrentHash":null}],"moves":[],"trashes":[]}),
    );
    let result = transaction::apply_verified(
        &scope,
        &request,
        |_| Ok(()),
        |_| {
            fs::remove_file(root.path().join("p/new.md")).unwrap();
            fs::write(root.path().join("p/new.md"), "new").unwrap();
            Ok(())
        },
        |_| Ok(()),
    );
    assert_eq!(result.unwrap_err().code, "workspace_transaction_partial");
    assert_eq!(fs::read(root.path().join("p/new.md")).unwrap(), b"new");
}

#[test]
fn guarded_publication_rechecks_read_only_outside_expectations_after_final_capture() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("p")).unwrap();
    fs::write(root.path().join("index.json"), "old index").unwrap();
    let scope = WorkspaceScope::new(root.path()).unwrap();
    let index = artifacts::read(&scope, "index.json").unwrap().sha256;
    let request = plan(
        &scope,
        serde_json::json!({"expectedEntries":[{"relativePath":"p/new.md","expectedCurrentHash":null},{"relativePath":"index.json","expectedCurrentHash":index}],"writes":[{"relativePath":"p/new.md","text":"new","expectedCurrentHash":null}],"moves":[],"trashes":[]}),
    );
    let result = transaction::apply_verified(
        &scope,
        &request,
        |_| Ok(()),
        |_| {
            fs::write(root.path().join("index.json"), "concurrent index").unwrap();
            Ok(())
        },
        |_| Ok(()),
    );
    assert_eq!(result.unwrap_err().code, "workspace_revision_conflict");
    assert!(!root.path().join("p/new.md").exists());
    assert_eq!(
        fs::read(root.path().join("index.json")).unwrap(),
        b"concurrent index"
    );
}
