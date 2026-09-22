use super::{
    package_hash::{self, error, PackageSnapshotState},
    transaction::{
        self, ExpectedWorkspaceEntry, PackageMutationPlan, WorkspaceTransactionResult, WriteRequest,
    },
    WorkspaceResult, WorkspaceState,
};
use serde::Deserialize;
use tauri::State;

pub const INDEX_PATH: &str = ".well-known/hermes-workflows/index.json";
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceGeneratedRequest {
    pub source_snapshot_token: String,
    pub writes: Vec<WriteRequest>,
}

#[tauri::command]
pub fn workspace_replace_generated_files(
    request: ReplaceGeneratedRequest,
    state: State<'_, WorkspaceState>,
    snapshots: State<'_, PackageSnapshotState>,
) -> WorkspaceResult<WorkspaceTransactionResult> {
    let active = state.active.lock().map_err(|_| super::state_error())?;
    let active = active
        .as_ref()
        .ok_or_else(|| error("workspace_not_selected"))?;
    let snapshot = snapshots
        .snapshots
        .lock()
        .map_err(|_| super::state_error())?
        .remove(&request.source_snapshot_token)
        .ok_or_else(|| error("package_snapshot_invalid"))?;
    if snapshot.generation != active.generation
        || snapshot.workspace_id != transaction::workspace_id(&active.scope)?
    {
        return Err(error("package_snapshot_invalid"));
    }
    replace(&active.scope, &snapshot.capture, &request.writes)
}
pub(super) fn replace(
    scope: &super::WorkspaceScope,
    captured: &package_hash::Capture,
    writes: &[WriteRequest],
) -> WorkspaceResult<WorkspaceTransactionResult> {
    replace_impl(scope, captured, writes, |_| Ok(()))
}
#[cfg(test)]
pub(super) fn replace_with_hook(
    scope: &super::WorkspaceScope,
    captured: &package_hash::Capture,
    writes: &[WriteRequest],
    hook: impl FnMut(usize) -> WorkspaceResult<()>,
) -> WorkspaceResult<WorkspaceTransactionResult> {
    replace_impl(scope, captured, writes, hook)
}
fn replace_impl(
    scope: &super::WorkspaceScope,
    captured: &package_hash::Capture,
    writes: &[WriteRequest],
    hook: impl FnMut(usize) -> WorkspaceResult<()>,
) -> WorkspaceResult<WorkspaceTransactionResult> {
    if captured.package_root.is_empty() {
        return Err(error("package_root_required"));
    }
    let digest = format!("{}/digests.json", captured.package_root);
    if writes.len() != 2
        || writes
            .iter()
            .filter(|write| write.relative_path == digest)
            .count()
            != 1
        || writes
            .iter()
            .filter(|write| write.relative_path == INDEX_PATH)
            .count()
            != 1
    {
        return Err(error("workspace_transaction_invalid"));
    }
    package_hash::verify_generated_capacity(captured)?;
    package_hash::verify(scope, captured)?;
    let plan = PackageMutationPlan {
        package_snapshot_token: None,
        workspace_id: transaction::workspace_id(scope)?,
        expected_entries: writes
            .iter()
            .map(|write| ExpectedWorkspaceEntry {
                relative_path: write.relative_path.clone(),
                expected_current_hash: write.expected_current_hash.clone(),
            })
            .collect(),
        writes: writes.to_vec(),
        moves: vec![],
        trashes: vec![],
    };
    transaction::apply_verified(
        scope,
        &plan,
        |temporary| package_hash::verify_sources(scope, captured, temporary),
        |temporary| {
            let mut ignored = temporary.to_vec();
            ignored.push(digest);
            package_hash::verify_sources(scope, captured, &ignored)
        },
        hook,
    )
}
