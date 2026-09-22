use super::{commit_all, git};
use crate::git::package::PackageGitState;
use crate::workspace::WorkspaceScope;
use std::fs;
use tempfile::tempdir;

#[test]
fn package_context_reads_committed_baseline_and_binds_repository_root() {
    let temporary = tempdir().unwrap();
    let root = temporary.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Package Test"]);
    git(root, &["config", "user.email", "package@example.test"]);
    fs::create_dir(root.join("sample")).unwrap();
    fs::create_dir_all(root.join(".well-known/hermes-workflows")).unwrap();
    fs::write(
        root.join("sample/workflow-package.json"),
        "{\"version\":\"1.0.0\"}\n",
    )
    .unwrap();
    fs::write(root.join("sample/script.py"), "print('baseline')\n").unwrap();
    let index = "{\"schemaVersion\":1,\"packages\":[{\"id\":\"sample\",\"packagePath\":\"sample\",\"version\":\"1.0.0\"}]}\n";
    fs::write(root.join(".well-known/hermes-workflows/index.json"), index).unwrap();
    commit_all(root, "baseline");
    fs::write(
        root.join("sample/workflow-package.json"),
        "{\"version\":\"2.0.0\"}\n",
    )
    .unwrap();
    let scope = WorkspaceScope::new(root).unwrap();
    let state = PackageGitState::default();
    let context = state.context(&scope, 1, "sample").unwrap();
    assert_eq!(
        context.committed_manifest_text.as_deref(),
        Some("{\"version\":\"1.0.0\"}\n")
    );
    assert_eq!(context.committed_index_text.as_deref(), Some(index));
    assert_eq!(context.committed_files.len(), 2);
    let nested = WorkspaceScope::new(&root.join("sample")).unwrap();
    assert_eq!(
        state.context(&nested, 1, "child").unwrap_err().code,
        "git_package_workspace_root_required"
    );
}

#[test]
fn package_commit_versions_exact_payload_and_preserves_unrelated_staged_changes() {
    use crate::git::package::GitPackageVersionRequest;
    use crate::workspace::package_hash;
    use sha2::{Digest, Sha256};
    let temporary = tempdir().unwrap();
    let root = temporary.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Package Test"]);
    git(root, &["config", "user.email", "package@example.test"]);
    fs::create_dir(root.join("sample")).unwrap();
    fs::create_dir_all(root.join(".well-known/hermes-workflows")).unwrap();
    fs::write(
        root.join("sample/workflow-package.json"),
        "{\"version\":\"1.0.0\"}\n",
    )
    .unwrap();
    fs::write(root.join("sample/old.md"), "old\n").unwrap();
    fs::write(root.join("unrelated.txt"), "baseline\n").unwrap();
    fs::write(root.join("unstaged.txt"), "baseline\n").unwrap();
    fs::write(root.join(".gitignore"), "*.bin\n").unwrap();
    let index = "{\"schemaVersion\":1,\"packages\":[{\"id\":\"sample\",\"packagePath\":\"sample\",\"version\":\"1.0.0\"}]}\n";
    fs::write(root.join(".well-known/hermes-workflows/index.json"), index).unwrap();
    commit_all(root, "baseline");
    let scope = WorkspaceScope::new(root).unwrap();
    let state = PackageGitState::default();
    let context = state.context(&scope, 1, "sample").unwrap();
    fs::write(
        root.join("sample/workflow-package.json"),
        "{\"version\":\"2.0.0\"}\n",
    )
    .unwrap();
    fs::remove_file(root.join("sample/old.md")).unwrap();
    fs::write(root.join("sample/data.bin"), [0, 1, 2, 255]).unwrap();
    fs::write(root.join("sample/digests.json"), "{}\n").unwrap();
    fs::write(root.join("unrelated.txt"), "staged unrelated\n").unwrap();
    git(root, &["add", "unrelated.txt"]);
    fs::write(root.join("unstaged.txt"), "mine\n").unwrap();
    let index = index.replace("1.0.0", "2.0.0");
    fs::write(root.join(".well-known/hermes-workflows/index.json"), &index).unwrap();
    let request = GitPackageVersionRequest {
        context_token: context.context_token,
        source_snapshot_token: Some("test-snapshot".into()),
        expected_index_hash: format!("{:x}", Sha256::digest(index.as_bytes())),
        version: Some("2.0.0".into()),
        message: "Package 2.0.0".into(),
    };
    let preview = state
        .preview(
            &scope,
            1,
            request,
            Some(package_hash::capture(&scope, "sample").unwrap()),
        )
        .unwrap();
    assert!(preview.changed_paths.contains(&"sample/old.md".into()));
    assert!(preview.changed_paths.contains(&"sample/data.bin".into()));
    assert!(!preview.changed_paths.contains(&"unrelated.txt".into()));
    assert!(preview.diff.contains("old.md"));
    let result = state
        .commit(&scope, 1, &preview.authorization_token, || Ok(()))
        .unwrap();
    assert!(result.committed_oid().is_some());
    assert_eq!(
        fs::read_to_string(root.join("unstaged.txt")).unwrap(),
        "mine\n"
    );
    assert_eq!(
        super::git_output(root, &["show", "HEAD:unrelated.txt"]),
        "baseline\n"
    );
    assert_eq!(
        super::git_output(root, &["diff", "--cached", "--name-only"]),
        "unrelated.txt\n"
    );
    assert_eq!(
        super::git_output(root, &["show", "HEAD:sample/workflow-package.json"]),
        "{\"version\":\"2.0.0\"}\n"
    );
    assert_eq!(
        state
            .commit(&scope, 1, &preview.authorization_token, || Ok(()))
            .unwrap_err()
            .code,
        "git_package_authorization_invalid"
    );
}

fn package_fixture() -> tempfile::TempDir {
    let temporary = tempdir().unwrap();
    let root = temporary.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Package Test"]);
    git(root, &["config", "user.email", "package@example.test"]);
    fs::create_dir(root.join("sample")).unwrap();
    fs::create_dir_all(root.join(".well-known/hermes-workflows")).unwrap();
    fs::write(
        root.join("sample/workflow-package.json"),
        "{\"version\":\"1.0.0\"}\n",
    )
    .unwrap();
    fs::write(root.join("sample/script.py"), "print('baseline')\n").unwrap();
    fs::write(root.join(".well-known/hermes-workflows/index.json"), "{\"schemaVersion\":1,\"packages\":[{\"id\":\"sample\",\"packagePath\":\"sample\",\"version\":\"1.0.0\"}]}\n").unwrap();
    commit_all(root, "baseline");
    temporary
}
fn request(
    context: crate::git::package::GitPackageContext,
    index: &str,
    deletion: bool,
) -> crate::git::package::GitPackageVersionRequest {
    use sha2::{Digest, Sha256};
    crate::git::package::GitPackageVersionRequest {
        context_token: context.context_token,
        source_snapshot_token: if deletion {
            None
        } else {
            Some("test-snapshot".into())
        },
        expected_index_hash: format!("{:x}", Sha256::digest(index.as_bytes())),
        version: if deletion { None } else { Some("2.0.0".into()) },
        message: "Exact package version".into(),
    }
}
#[test]
fn package_whole_deletion_commits_all_deletions_and_retains_reachable_baseline() {
    let temporary = package_fixture();
    let root = temporary.path();
    let scope = WorkspaceScope::new(root).unwrap();
    let state = PackageGitState::default();
    let context = state.context(&scope, 1, "sample").unwrap();
    fs::remove_dir_all(root.join("sample")).unwrap();
    let index = "{\"schemaVersion\":1,\"packages\":[]}\n";
    fs::write(root.join(".well-known/hermes-workflows/index.json"), index).unwrap();
    let preview = state
        .preview(&scope, 1, request(context, index, true), None)
        .unwrap();
    assert!(preview.changed_paths.contains(&"sample/script.py".into()));
    assert!(preview
        .changed_paths
        .contains(&"sample/workflow-package.json".into()));
    state
        .commit(&scope, 1, &preview.authorization_token, || Ok(()))
        .unwrap();
    let context = state.context(&scope, 1, "sample").unwrap();
    assert!(context.committed_files.is_empty());
    assert!(context.committed_manifest_text.is_none());
    assert_eq!(
        context.baseline_manifest_text.as_deref(),
        Some("{\"version\":\"1.0.0\"}\n")
    );
    assert_eq!(
        state
            .preview(&scope, 1, request(context, index, true), None)
            .unwrap_err()
            .code,
        "git_package_deletion_missing"
    );
}
#[test]
fn package_preview_rejects_foreign_index_changes_even_with_matching_working_hash() {
    let temporary = package_fixture();
    let root = temporary.path();
    let scope = WorkspaceScope::new(root).unwrap();
    let state = PackageGitState::default();
    let context = state.context(&scope, 1, "sample").unwrap();
    let index = "{\"schemaVersion\":1,\"packages\":[{\"id\":\"sample\",\"packagePath\":\"sample\",\"version\":\"2.0.0\"},{\"id\":\"foreign\",\"packagePath\":\"foreign\",\"version\":\"1.0.0\"}]}\n";
    fs::write(root.join(".well-known/hermes-workflows/index.json"), index).unwrap();
    let capture = crate::workspace::package_hash::capture(&scope, "sample").unwrap();
    assert_eq!(
        state
            .preview(&scope, 1, request(context, index, false), Some(capture))
            .unwrap_err()
            .code,
        "git_package_index_conflict"
    );
}
#[test]
fn package_commit_rechecks_membership_and_workspace_generation() {
    let temporary = package_fixture();
    let root = temporary.path();
    let scope = WorkspaceScope::new(root).unwrap();
    let state = PackageGitState::default();
    let context = state.context(&scope, 1, "sample").unwrap();
    let index_path = root.join(".well-known/hermes-workflows/index.json");
    let index = fs::read_to_string(&index_path)
        .unwrap()
        .replace("1.0.0", "2.0.0");
    fs::write(index_path, &index).unwrap();
    let capture = crate::workspace::package_hash::capture(&scope, "sample").unwrap();
    let preview = state
        .preview(&scope, 1, request(context, &index, false), Some(capture))
        .unwrap();
    let head = super::git_output(root, &["rev-parse", "HEAD"]);
    fs::write(root.join("sample/unreferenced.bin"), [0, 1, 2]).unwrap();
    assert!(state
        .commit(&scope, 1, &preview.authorization_token, || Ok(()))
        .is_err());
    assert_eq!(super::git_output(root, &["rev-parse", "HEAD"]), head);
    let context = state.context(&scope, 1, "sample").unwrap();
    let capture = crate::workspace::package_hash::capture(&scope, "sample").unwrap();
    assert_eq!(
        state
            .preview(&scope, 2, request(context, &index, false), Some(capture))
            .unwrap_err()
            .code,
        "git_package_authorization_invalid"
    );
}

#[test]
fn package_git_never_runs_filters_textconv_hooks_fsmonitor_or_signers() {
    let temporary = package_fixture();
    let root = temporary.path();
    fs::write(
        root.join(".gitattributes"),
        "sample/* filter=explode diff=explode\n",
    )
    .unwrap();
    git(
        root,
        &[
            "config",
            "filter.explode.clean",
            "sh -c 'echo forbidden > package-execution-marker; exit 97'",
        ],
    );
    git(root, &["config", "filter.explode.required", "true"]);
    git(
        root,
        &[
            "config",
            "diff.explode.textconv",
            "sh -c 'echo forbidden > package-execution-marker; exit 97'",
        ],
    );
    git(
        root,
        &[
            "config",
            "diff.external",
            "sh -c 'echo forbidden > package-execution-marker; exit 97'",
        ],
    );
    git(
        root,
        &["config", "core.fsmonitor", ".git/hooks/package-fsmonitor"],
    );
    git(root, &["config", "commit.gpgsign", "true"]);
    git(
        root,
        &["config", "gpg.program", "package-nonexistent-signer"],
    );
    for name in [
        "pre-commit",
        "prepare-commit-msg",
        "commit-msg",
        "post-commit",
        "reference-transaction",
        "package-fsmonitor",
    ] {
        let path = root.join(".git/hooks").join(name);
        fs::write(
            &path,
            "#!/bin/sh\necho forbidden > package-execution-marker\nexit 97\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    let scope = WorkspaceScope::new(root).unwrap();
    let state = PackageGitState::default();
    let context = state.context(&scope, 1, "sample").unwrap();
    fs::write(root.join("sample/script.py"), "print('new raw bytes')\r\n").unwrap();
    let index_path = root.join(".well-known/hermes-workflows/index.json");
    let index = fs::read_to_string(&index_path)
        .unwrap()
        .replace("1.0.0", "2.0.0");
    fs::write(index_path, &index).unwrap();
    let capture = crate::workspace::package_hash::capture(&scope, "sample").unwrap();
    let preview = state
        .preview(&scope, 1, request(context, &index, false), Some(capture))
        .unwrap();
    let result = state
        .commit(&scope, 1, &preview.authorization_token, || Ok(()))
        .unwrap();
    assert!(result.committed_oid().is_some());
    assert_eq!(
        crate::git::status(root).unwrap_err().code,
        "git_status_filter_unsupported"
    );
    assert!(!root.join("package-execution-marker").exists());
    assert!(!root.join(".git/package-execution-marker").exists());
    // Reading a raw committed blob itself does not invoke filters or textconv.
    assert_eq!(
        super::git_output(root, &["cat-file", "blob", "HEAD:sample/script.py"]),
        "print('new raw bytes')\r\n"
    );
}

#[test]
fn package_preview_reports_no_repository_and_noop_without_mutation() {
    let no_repo = tempdir().unwrap();
    let scope = WorkspaceScope::new(no_repo.path()).unwrap();
    assert_eq!(
        PackageGitState::default()
            .context(&scope, 1, "sample")
            .unwrap_err()
            .code,
        "git_not_repository"
    );
    let temporary = package_fixture();
    let root = temporary.path();
    let scope = WorkspaceScope::new(root).unwrap();
    let state = PackageGitState::default();
    let context = state.context(&scope, 1, "sample").unwrap();
    let index = fs::read_to_string(root.join(".well-known/hermes-workflows/index.json")).unwrap();
    let mut request = request(context, &index, false);
    request.version = Some("1.0.0".into());
    let capture = crate::workspace::package_hash::capture(&scope, "sample").unwrap();
    assert_eq!(
        state
            .preview(&scope, 1, request, Some(capture))
            .unwrap_err()
            .code,
        "git_nothing_to_commit"
    );
}
#[test]
fn package_commit_rejects_concurrent_head_and_index_changes() {
    for edit_head in [true, false] {
        let temporary = package_fixture();
        let root = temporary.path();
        let scope = WorkspaceScope::new(root).unwrap();
        let state = PackageGitState::default();
        let context = state.context(&scope, 1, "sample").unwrap();
        let index_path = root.join(".well-known/hermes-workflows/index.json");
        let index = fs::read_to_string(&index_path)
            .unwrap()
            .replace("1.0.0", "2.0.0");
        fs::write(&index_path, &index).unwrap();
        let capture = crate::workspace::package_hash::capture(&scope, "sample").unwrap();
        let preview = state
            .preview(&scope, 1, request(context, &index, false), Some(capture))
            .unwrap();
        if edit_head {
            git(root, &["commit", "--allow-empty", "-m", "concurrent"]);
        } else {
            fs::write(index_path, "concurrent index bytes").unwrap();
        }
        let head = super::git_output(root, &["rev-parse", "HEAD"]);
        assert_eq!(
            state
                .commit(&scope, 1, &preview.authorization_token, || Ok(()))
                .unwrap_err()
                .code,
            if edit_head {
                "git_base_changed"
            } else {
                "git_package_index_changed"
            }
        );
        assert_eq!(super::git_output(root, &["rev-parse", "HEAD"]), head);
    }
}
#[test]
fn package_unborn_commit_requires_local_identity_and_can_create_first_commit() {
    let temporary = tempdir().unwrap();
    let root = temporary.path();
    git(root, &["init", "-b", "main"]);
    fs::create_dir(root.join("sample")).unwrap();
    fs::create_dir_all(root.join(".well-known/hermes-workflows")).unwrap();
    fs::write(
        root.join("sample/workflow-package.json"),
        "{\"version\":\"2.0.0\"}\n",
    )
    .unwrap();
    let index = "{\"schemaVersion\":1,\"packages\":[{\"id\":\"sample\",\"packagePath\":\"sample\",\"version\":\"2.0.0\"}]}\n";
    fs::write(root.join(".well-known/hermes-workflows/index.json"), index).unwrap();
    let scope = WorkspaceScope::new(root).unwrap();
    let state = PackageGitState::default();
    for have_identity in [false, true] {
        if have_identity {
            git(root, &["config", "user.name", "Package Test"]);
            git(root, &["config", "user.email", "package@example.test"]);
        }
        let context = state.context(&scope, 1, "sample").unwrap();
        assert!(context.committed_files.is_empty());
        assert!(context.baseline_manifest_text.is_none());
        let capture = crate::workspace::package_hash::capture(&scope, "sample").unwrap();
        let preview = state
            .preview(&scope, 1, request(context, index, false), Some(capture))
            .unwrap();
        let result = state.commit(&scope, 1, &preview.authorization_token, || Ok(()));
        if have_identity {
            assert!(result.unwrap().committed_oid().is_some());
        } else {
            assert_eq!(result.unwrap_err().code, "git_identity_missing");
        }
    }
}

#[test]
fn package_shared_index_scope_rejects_duplicate_keys_aliases_and_foreign_metadata() {
    use crate::git::package_index::verify;
    let before = r#"{"schemaVersion":1,"packages":[{"id":"selected","packagePath":"sample","version":"1.0.0"},{"id":"other","packagePath":"other","version":"1.0.0","description":"keep"}]}"#;
    let after = before.replace(
        "\"packagePath\":\"sample\",\"version\":\"1.0.0\"",
        "\"packagePath\":\"sample\",\"version\":\"2.0.0\"",
    );
    verify(Some(before), &after, "sample", Some("2.0.0")).unwrap();
    for malformed in [
        after.replace(
            "\"schemaVersion\":1",
            "\"schemaVersion\":1,\"schemaVersion\":1",
        ),
        after.replace("\"description\":\"keep\"", "\"description\":\"edited\""),
        after.replace("\"id\":\"other\"", "\"id\":\"SELECTED\""),
        after.replace("\"packagePath\":\"other\"", "\"packagePath\":\"SAMPLE\""),
        after.replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"extra\":true"),
    ] {
        assert_eq!(
            verify(Some(before), &malformed, "sample", Some("2.0.0"))
                .unwrap_err()
                .code,
            "git_package_index_conflict"
        );
    }
}
#[test]
fn package_git_operations_use_literal_raw_object_and_no_execution_arguments() {
    use crate::git::runner::{MutationOperation, ReadOperation};
    let root = if cfg!(windows) {
        std::path::Path::new(r"C:\workspace-root")
    } else {
        std::path::Path::new("workspace-root")
    };
    super::assert_read_argv(
        root,
        ReadOperation::PackageTree {
            tree: "abc",
            path: "sample",
        },
        &["ls-tree", "-r", "-z", "abc", "--", "sample"],
    );
    super::assert_read_argv(
        root,
        ReadOperation::PackageHistory {
            base: "abc",
            path: "sample/workflow-package.json",
        },
        &[
            "log",
            "--format=%H",
            "--no-show-signature",
            "--max-count=257",
            "--diff-filter=AM",
            "abc",
            "--",
            "sample/workflow-package.json",
        ],
    );
    super::assert_read_argv(
        root,
        ReadOperation::PackageDiff {
            base: "abc",
            tree: "def",
            names: false,
        },
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--binary",
            "--full-index",
            "abc",
            "def",
            "--",
        ],
    );
    super::assert_mutation_suffix(
        root,
        MutationOperation::HashRaw {
            path: "sample/script.py",
        },
        &[
            "hash-object",
            "--no-filters",
            "-w",
            "--",
            "sample/script.py",
        ],
    );
    super::assert_mutation_suffix(
        root,
        MutationOperation::CacheEntry {
            path: "sample/script.py",
            mode: "100644",
            oid: "abc",
        },
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            "100644",
            "abc",
            "sample/script.py",
        ],
    );
    super::assert_mutation_suffix(
        root,
        MutationOperation::RemoveEntry {
            path: "sample/old.md",
        },
        &["update-index", "--force-remove", "--", "sample/old.md"],
    );
}

#[test]
fn package_automatic_status_refuses_executable_filters_without_running_them() {
    let temporary = package_fixture();
    let root = temporary.path();
    fs::write(root.join(".gitattributes"), "sample/* filter=explode\n").unwrap();
    fs::write(root.join("sample/script.py"), "new bytes\n").unwrap();
    git(
        root,
        &[
            "config",
            "filter.explode.clean",
            "sh -c 'echo forbidden > package-execution-marker; exit 97'",
        ],
    );
    git(root, &["config", "filter.explode.required", "true"]);
    let error = crate::git::status(root).unwrap_err();
    assert_eq!(error.code, "git_status_filter_unsupported");
    assert!(!root.join("package-execution-marker").exists());
}

#[test]
fn package_automatic_history_never_runs_configured_signature_verifiers() {
    let temporary = package_fixture();
    let root = temporary.path();
    let parent = super::git_output(root, &["rev-parse", "HEAD"]);
    fs::write(
        root.join("sample/workflow-package.json"),
        "{\"version\":\"2.0.0\"}\n",
    )
    .unwrap();
    git(root, &["add", "sample/workflow-package.json"]);
    let tree = super::git_output(root, &["write-tree"]);
    let commit = format!("tree {}\nparent {}\nauthor Package Test <package@example.test> 1700000000 +0000\ncommitter Package Test <package@example.test> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n fake\n -----END PGP SIGNATURE-----\n\nsigned fixture\n", tree.trim(), parent.trim());
    fs::write(root.join(".git/signed-fixture"), commit).unwrap();
    let oid = super::git_output(
        root,
        &[
            "hash-object",
            "-t",
            "commit",
            "-w",
            "--",
            ".git/signed-fixture",
        ],
    );
    git(root, &["update-ref", "HEAD", oid.trim()]);
    let verifier = root.join(".git/hooks/fixture-verifier");
    fs::write(
        &verifier,
        "#!/bin/sh\necho forbidden > package-signature-marker\nexit 97\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&verifier, fs::Permissions::from_mode(0o755)).unwrap();
    }
    git(root, &["config", "log.showSignature", "true"]);
    git(
        root,
        &["config", "gpg.program", ".git/hooks/fixture-verifier"],
    );
    let paths = ["sample/workflow-package.json"];
    let result = crate::git::runner::run_read(
        root,
        crate::git::runner::ReadOperation::History {
            follow: false,
            paths: &paths,
        },
    )
    .unwrap();
    assert!(result.success());
    assert!(!root.join("package-signature-marker").exists());
}
