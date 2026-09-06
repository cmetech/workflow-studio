# Workflow Studio version 1 release acceptance

Status: **PRE-RELEASE — v1.0.8 metadata and local build verification are being prepared. The immutable tag, protected updater-signed draft, publication, and installed-platform follow-up remain open.**

Recorded: 2026-09-06. v1.0.1 and v1.0.2 remain unpublished failed drafts. v1.0.3 is the published recovery release. v1.0.4 remains an unpublished failed empty draft. v1.0.5 remains unpublished with no release after CI run `33355845811`; its immutable tag peels to `0ecb5bd46a49cebe4037825856411d8ead5db17f`. v1.0.6 is the latest published content-aware workbench release, published on 2026-08-31. v1.0.7 is the verified unpublished documentation-and-shortcuts draft. v1.0.8 is the loop-group visual-authoring release candidate.

## Candidate identity

- Version/tag: `1.0.8` / `v1.0.8`
- Reviewed source baseline: `c42c1da424b51d99cba5eced1553360c81a2d0ee`
- Release metadata commit: pending local verification
- The v1.0.8 tag does not exist.
- The v1.0.8 draft does not exist.
- Published baseline: v1.0.6 remains the latest published release.
- Prior draft: v1.0.7 remains verified and unpublished at `0534d785d6d96df00f9da732bdf3c59c80b1d747`.

## Evidence available for the v1.0.8 candidate

| Area | Current evidence | Status |
| --- | --- | --- |
| Candidate source and review | Loop-group visual authoring and the Hermes scanner compatibility layer were merged into local `base`. Claude and Codex adversarial reviews found zero confirmed defects and zero unresolved suspicions, providing a clean review. | Passed locally |
| Static, contract, resource, and renderer gates | Format, lint, Svelte/TypeScript checks, bundled Hermes contracts and corpora, examples, all 40 packaged resources, and the production renderer build passed. | Passed locally |
| TypeScript | The clean full suite passed 1,819 tests across 159 files. The earlier v1.0.7 record used `npx vitest run --exclude tests/installers/install-script.test.ts --exclude '.worktrees/**'`; v1.0.8 runs the complete suite with Cargo available. | Passed locally |
| Rust | The clean native suite passed 246 Rust unit tests and 24 Rust integration tests. | Passed locally |
| Renderer E2E | The full Playwright suite passed 320/320 across Chromium and WebKit. Playwright WebKit is browser-engine evidence, not an installed Tauri/WebView result. | Passed locally |
| Performance and accessibility | seven scoped-performance checks cover root and nested loop-group graphs at the 250-node/500-edge contract. Keyboard, Escape order, reduced motion, forced colors, and compact geometry are covered in browser automation. | Passed locally within recorded browser boundaries |
| Local native package | Unsigned macOS Apple Silicon release-mode app and DMG construction, resource verification, and artifact hashes will be recorded after the versioned package is built. | In progress |
| Protected native draft | Updater-signed macOS Apple Silicon, macOS Intel, and Windows x64 jobs have not run for v1.0.8. Exact ten-asset inventory, `latest.json`, `SHA256SUMS`, signatures, and extracted payload checks remain open. | Required before publication |
| Installed-app follow-up | Clean macOS Apple Silicon/Intel and Windows installed-app validation, staged update, and release-artifact performance evidence remain open. | Required follow-up |

## Pre-publication decision

- [ ] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v1.0.8 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [ ] Release approved for manual publication.

Decision owner/date: Open. No v1.0.8 tag, push, draft workflow, or publication has been authorized or performed.

## Required next steps

1. Finish the local release-mode macOS build and record exact artifact hashes.
2. Integrate the reviewed release metadata into `base`, push the exact commit, create and push one immutable annotated `v1.0.8` tag, then dispatch the protected draft-only workflow from `base`.
3. Keep the draft unpublished unless all three native jobs, extracted package payloads, exact inventory, updater targets, checksums, and signatures pass.
4. After a separate publication decision, complete clean-machine installation, staged update, relaunch, version confirmation, and 250-node/500-edge acceptance on each supported platform.

Linux packaging and Windows ARM64 remain deferred. Extracted DMG/NSIS payload verification, exact draft inventory, checksums, and updater signatures block publication. Clean-machine functional installs and staged-update exercises remain required follow-up evidence.
