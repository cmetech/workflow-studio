# Workflow Studio v3.0.1 Windows Persistence Hotfix Release Plan

> **Status:** Approved and in progress on 2026-09-09. Publish only after the protected release workflow verifies the draft.

**Goal:** Publish Workflow Studio v3.0.1 from `base` so Windows users can persist Arrange Graph layout and the other native app-state files without operating-system error 87.

**Release boundary:** The reviewed hotfix ends at `79e04d61b7b235eaf7135f0bd9b1707117d5730c`. Preserve the v3.0.0 release record, all unrelated worktrees, and the user's untracked mockups and test-script directory. Tag only the final release-preparation commit after it is contained in `origin/base`.

## Sequence

1. Change current-release tests and fixtures first and observe failures against v3.0.0 metadata.
2. Synchronize package, Cargo, Tauri, fixture, footer, installation, security, and release metadata at 3.0.1 while retaining v3.0.0 history.
3. Record a separate v3.0.1 acceptance document with the reviewed source boundary, Windows CI evidence, worktree preflight, and pending protected-release gates.
4. Run focused release tests and the complete local release verification suite.
5. Review every linked worktree immediately before tagging and record why any dirty state is unrelated.
6. Commit and push `base` without force, then wait for the protected `base` CI run to pass.
7. Create and push one annotated `v3.0.1` tag at the exact pushed release-preparation commit.
8. Dispatch `.github/workflows/release.yml` from `base` with tag `v3.0.1` and monitor every native build and draft-verification job.
9. Independently download the draft and verify the exact ten-asset inventory, updater metadata and signatures, extracted package payloads, and `SHA256SUMS`.
10. Publish the verified draft as the latest release, confirm public installer and updater links, copy the Windows installer to `~/Downloads`, and record final evidence on `base`.

## Publication boundary

The existing GitHub Actions pipeline creates and verifies a draft. The approved release operation publishes only after every protected job passes and the downloaded draft bytes pass the repository verifier and checksum validation. Windows clean-machine testing remains post-publication UAT because this release exists to make the corrected installer available on the user's Windows server.
