# Workflow Studio v3.0.3 Release Plan

Approved September 21, 2026: commit, merge, push and build/release v3.0.3. Execute inline using `docs/releasing.md`.

**Goal:** Publish the UI branding cleanup as v3.0.3, preserving technical identifiers and workflow source.

**Architecture:** Presentation-only copy changes; existing immutable-tag native release pipeline. No dependency or signing-key changes.

**References:** The authoritative design, UI brand copy audit and UI copy test investigation.

## Sequence

- [ ] Change version assertions in `tests/project/release-version.test.ts` and the footer expectation in `tests/e2e/workbench-containment.spec.ts`; observe the focused version test fail against 3.0.2.
- [ ] Synchronize the application version in package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json; update installation/runbook documentation and create the v3.0.3 acceptance record. Preserve frozen dependency provenance and historical release records.
- [ ] Pass focused metadata tests, formatting, lint, type checks, contract/example/resource verification and a fresh production bundle budget check. Complete independent UI-copy review. Commit intended changes, push the feature branch and open a PR.
- [ ] Require full seven-job CI before merging; verify merged `base` CI. Inspect every linked worktree and record its disposition immediately before creating the annotated immutable v3.0.3 tag.
- [ ] Push the tag and dispatch release.yml from base. Require all three native builds and completed-draft verification to pass.
- [ ] Independently download and verify all ten draft assets, nine checksum entries, updater signatures and extracted Windows resource payload. Publish only after all gates pass.
- [ ] Verify anonymous published downloads and updater metadata; record exact source/run IDs and hashes. Leave the development checkout on base. Preserve previous releases and unrelated worktrees; do not replace the installed application.

Clean-machine functional installation and staged-update exercises remain post-publication follow-up. The accepted v3.0.2 performance exceptions remain unchanged.
