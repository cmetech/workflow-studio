# Package troubleshooting

Start with the package overview and the first blocking finding. Repair `workflow-package.json` in source mode if structured metadata cannot load. A missing `scripts/analyze.py` requires restoring or explicitly selecting the intended resource; changing the reference blindly can bind a different file.

## Drafts and external changes

Invalid script and command drafts can be saved. Recovery preserves differing unsaved edits by workspace and path. When disk content changes, Compare shows both versions. Keep Mine requires comparison and a fresh revision check. Reload Disk accepts current disk content; accepting a deletion closes the artifact while retaining its recovery draft. A second external edit can require another comparison.

## Preparation failures

If preparation requires the repository root, reopen that directory as the workspace and select the package subfolder. Opening only the package folder does not grant access to its parent repository's index.

For a stale snapshot, save or refresh and validate again. For a shared-index conflict, reconcile the unselected entry changes before preparing. For unsupported include origins or runtime contexts, use the supported portable source layout rather than guessing compiler resolution.

Missing local Git identity requires local configuration. Expired preview authorization or changed HEAD requires a new preview. If native rollback reports a partial outcome, inspect each reported recovery location before retrying or removing files. Do not assume an error means no files changed.

Package transactions and artifact saves can retain old files in the application's recovery storage, including after a successful operation. The receipt shows the original path and the exact recovery location. Artifact save notices remain visible across artifact navigation until you dismiss them; dismissing a notice does not delete the retained files. A neighboring JSON record preserves the original workspace and file path after the app closes. These files remain outside the package and its digest. Retention preserves writes made by another editor that already had the file open; finish those edits before deciding which version to keep. Recovery files are not automatically removed.

If recovery storage is full or unavailable, inspect the reported files and locations before retrying. A workspace on another volume may not support retaining the same file in application storage. In that case Studio preserves the workspace file and reports that cleanup needs attention. It does not silently copy and delete the file. Keep recovery files until you have verified the desired contents and closed other editors using them.

See [Readiness](#guide:package-readiness), [Preparing packages](#guide:preparing-packages), and [Folder structure](#guide:package-folder-structure).
