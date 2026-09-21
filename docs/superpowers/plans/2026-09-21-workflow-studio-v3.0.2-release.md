# Workflow Studio v3.0.2 Release Plan

> Approved September 21, 2026: proceed with the official release and provide the Windows install/upgrade command. Execute inline using the existing release runbook; no new product behavior or optimization.

**Goal:** Publish the verified Windows-primary stabilization as v3.0.2.

**Architecture:** Preserve the application at `baf04fe` and its evidence at `b1147a7`; change release identity and documentation only. Use the existing immutable-tag, draft-build and artifact-verification pipeline.

**Tech stack:** Tauri, Rust, TypeScript, GitHub Actions, Windows NSIS and macOS DMG.

**References:** `docs/releasing.md`, `docs/verification/2026-09-14-windows-primary-stabilization.md`, and the authoritative Workflow Studio design.

## Constraints

- Preserve all four accepted performance exceptions and strict non-waived safety checks.
- No dependency updates, signing-key changes, installer behavior changes or installed-app replacement.
- Preserve historical releases, backups, scratch evidence and unrelated worktrees.
- Publish only after exact-tag CI and all native/draft integrity checks pass.
- Return the main development checkout to `base` after release work.

## Approved sequence

- [ ] Update `tests/project/release-version.test.ts` to require 3.0.2 across package/Cargo/Tauri identity, permitting only the root application version change against frozen dependency provenance. Change the footer expectation in `tests/e2e/workbench-containment.spec.ts` to 3.0.2. Run the focused metadata test and observe the old identity fail.
- [ ] Synchronize `package.json`, root entries in `package-lock.json`, `src-tauri/Cargo.toml`, the workflow-studio entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Update installation/runbook documentation and create `docs/verification/version-3.0.2-release-acceptance.md` without claiming publication early. Retain version-independent historical installer fixtures.
- [ ] Run focused metadata and installer verification, format/lint/type/contract/resource checks; commit and push only intended files. Run the full seven-job CI profile on this exact commit, including the complete unit/native suites and Windows functional shards. Resolve any failures before integration.
- [ ] Inspect every linked worktree and record its disposition. Merge the approved PR into `base`, preserving commit history; verify the merged commit's CI before creating one annotated `v3.0.2` tag. Never retarget an existing tag.
- [ ] Dispatch `.github/workflows/release.yml` from `base` for `v3.0.2`. Monitor all three native builds and the completed-draft verifier; retain failures without publishing if any gate fails.
- [ ] Download every draft asset to a new temporary directory. Independently verify ten-asset inventory, nine checksum entries, updater metadata/signatures and the Windows extracted resource payload using repository verification tools.
- [ ] Publish the verified draft as latest, verify anonymous public installer/updater/checksum URLs and the immutable PowerShell bootstrap. Record tag/run IDs/hashes and publication status, update the main checkout to `base`, and give the user the Windows command without executing it.

## Review focus

Existing release tests and artifact verifier cover version drift, wrong-tag downloads, unexpected target inventory, checksum/signature tampering, and unsigned package disclosure. This release changes no installer or application behavior; the source review and post-review verification are recorded in the stabilization evidence document. Clean-machine install and staged-update exercises remain post-publication follow-up, not claims inferred from CI.
