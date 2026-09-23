# Workflow Studio v3.1.0 Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this release inline.

**Goal:** Merge, push, build, verify, and release workflow package authoring as v3.1.0, as requested September 23, 2026.

**Architecture:** Preserve the reviewed application and pinned marketplace contracts. Synchronize release identity, require fresh preparation and merged-base CI, then build immutable-tag Windows/macOS artifacts through the existing draft-only release workflow. Independently verify downloaded artifacts before publication.

**Tech Stack:** Svelte, CodeMirror, TypeScript, Tauri/Rust, GitHub Actions, existing updater signing and release verification tools.

**Spec:** `docs/superpowers/specs/2026-09-03-workflow-package-authoring-and-local-publishing-design.md`; release procedure `docs/releasing.md`.

## Authorization and limits

The user explicitly requested merge, push, and a release after receiving the final verification summary. This authorizes integration and release operations. It does not turn unperformed manual checks or failed commands into passing evidence. Preserve the complete [feature verification record](../../verification/2026-09-23-package-final-gate.md), including the intermittent local Linux WebKit capacity timeout. Fresh CI is required before merging and tagging. Native functional installation and screen-reader observations remain explicitly unverified follow-up, consistent with the existing release runbook; extracted native payload integrity, checksums, signatures, and exact draft identity block publication.

Studio delivers complete marketplace-compatible package preparation, not remote publishing inside the application. A normal external Git client publishes the prepared commit; the agent marketplace owns discovery, installation, compatibility/admission, execution, and trust. Do not claim unqualified marketplace compliance beyond the pinned contract and verified backend. Python/JavaScript/TypeScript have language-aware editors; Bash content remains inline YAML or plain-text resource editing without a bundled Bash parser.

## Sequence

- [x] Set version-test expectations to 3.1.0 and observe failure against 3.0.3. Preserve immutable dependency provenance while allowing only application-version fields to change.
- [x] Synchronize package manifests/locks, Cargo application metadata/lock, Tauri version, footer expectation, installation/runbook guidance, and the v3.1.0 acceptance record. Leave dependency versions and historical receipts unchanged.
- [x] Run focused release tests, static/contract/example/resource checks, and a fresh production build/budget check. Obtain independent review of the release preparation diff.
- [ ] Push the feature branch, create a PR against `base`, and require all seven CI jobs to pass. Investigate failures without changing thresholds to get a green result.
- [ ] Merge the reviewed PR and verify merged-base CI. Inspect every linked worktree and record its disposition before creating an immutable annotated v3.1.0 tag.
- [ ] Push the tag and dispatch the existing native draft workflow from `base`. Require all three builds and final draft verification.
- [ ] Download and independently verify the exact ten assets, nine checksums, updater signatures, and extracted Windows payload. Update accurate release notes and publish the verified draft.
- [ ] Verify anonymous public downloads and updater metadata. Commit final evidence, return the main development checkout to `base`, and preserve unrelated worktrees and local evidence.

## Review focus

- Version changes must not hide unrelated dependency drift.
- Release notes must distinguish package preparation from the external publishing step and static parsing from execution.
- The tag, application commit, build tooling, asset inventory, signatures, and public URLs must stay bound to the same release.
- Earlier failures and unverified platform/manual observations remain visible.
- Do not overwrite the installed application or expose signing credentials.
