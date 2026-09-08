# Workflow Studio v3.0.0 Full Release Plan

> **Status:** Approved by the user on 2026-09-08. Publish v3.0.0 after protected workflow verification succeeds.

**Goal:** Publish Workflow Studio v3.0.0 from the reviewed `base` history using the existing draft-only GitHub Actions pipeline and a separate verified publication step.

**Release boundary:** Start from `5cad28d843b83456b013d076786aa52ff2259135`, synchronize all npm, Cargo, and Tauri version records at `3.0.0`, preserve historical releases and unrelated worktrees, and tag only the final release-preparation commit after it is contained in `origin/base`.

## Sequence

1. Change release tests and fixtures first and observe failures against v2.0.1 metadata.
2. Synchronize package, Cargo, and Tauri versions at 3.0.0.
3. Update installation, security, release, and acceptance documentation; record v2.0.1 as superseded without a tag or release.
4. Run focused release tests, both supported browser projects, and the complete local verification suite.
5. Obtain an independent review and resolve every validated Critical or Important finding.
6. Commit the candidate, merge it into local `base`, rerun the release gates on the merged tree, and push `base` without force.
7. Wait for the `base` CI run to pass, create one immutable annotated `v3.0.0` tag at the exact pushed release commit, and push the tag.
8. Dispatch `.github/workflows/release.yml` from `base` with tag `v3.0.0` and monitor all jobs.
9. Verify the draft resolves to the tagged commit and contains exactly ten nonempty assets, valid updater metadata and signatures, and `SHA256SUMS` covering the other nine assets.
10. Publish the verified draft as the latest release, confirm public installer and updater links, and record the workflow/release evidence on `base`.

## Publication boundary

The GitHub Actions workflow creates and verifies a draft. The approved full-release operation publishes only after the protected workflow and an independent downloaded-asset verification pass. macOS and Windows packages remain unsigned by their operating-system vendors; first-party updater signatures and SHA-256 checksums remain mandatory.
