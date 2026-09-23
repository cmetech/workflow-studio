# Preparing packages locally

Prepare Package creates a reviewable local version of one selected package, for example `packages/laptop-support`, together with `.well-known/hermes-workflows/index.json`.

Open the Git repository root as your workspace and keep the package in a subfolder. Preparation cannot update an index outside the active workspace, or place the shared repository index inside the selected package.

1. Save relevant workflow and artifact edits, then validate. Fix blocking findings; review destination advisories.
2. Review the changed file list and execution/trust surface, including unreferenced resources and binary replacements.
3. Choose a valid semantic version and local Git commit message, inspect the exact preview, and create the local version.

Preparing a preview removes leading and trailing whitespace from the commit message and displays that message for review. Interior line breaks are preserved. Editing the version or message afterward requires a fresh preview.

Digest and index replacement checks the captured source bytes and existing generated-file revisions. The index retains committed metadata for unselected packages; conflicting uncommitted shared-index changes block preparation. Local versioning preserves unrelated staged and unstaged work.

Completion says **Prepared locally** and displays the local commit identity. If Git identity is missing, configure it locally and retry; generated files may already be recoverable on disk. A stale authorization or changed HEAD requires a fresh preview. Inspect any partial filesystem recovery details before retrying.

Remote availability requires a separate external Git operation and destination marketplace support.

Git comparison and preparation use local objects only. If a partial clone lacks a required committed object, use your external Git client to make it available locally, then refresh Studio.

See [Publishing with Git](#guide:publishing-packages-with-git), [Readiness](#guide:package-readiness), and [Troubleshooting](#guide:package-troubleshooting).
