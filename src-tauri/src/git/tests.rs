use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

use tempfile::tempdir;

use super::parse::{parse_history, parse_status};
use super::runner::{build_read_command, ReadOperation};
use super::{
    authorize_repository_root, detect_repository, diff_pair, history_pair, show_from_authorization,
    show_pair, status, AuthorizedGitContext, GitState, HistoricalPaths, HistoryAuthorization,
    HISTORY_AUTHORIZATION_LIMIT,
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

fn commit_all(root: &Path, message: &str) {
    git(root, &["add", "--all"]);
    git(root, &["commit", "-m", message]);
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
