# Workflow Studio version 1 release acceptance

Status: **PRE-RELEASE — v1.0.8 metadata and the unsigned macOS Apple Silicon package are verified locally. The immutable tag, protected updater-signed draft, publication, and installed-platform follow-up remain open.**

Recorded: 2026-09-06. v1.0.1 and v1.0.2 remain unpublished failed drafts. v1.0.3 is the published recovery release. v1.0.4 remains an unpublished failed empty draft. v1.0.5 remains unpublished with no release after CI run `33355845811`; its immutable tag peels to `0ecb5bd46a49cebe4037825856411d8ead5db17f`. v1.0.6 is the latest published content-aware workbench release, published on 2026-08-31. v1.0.7 is the verified unpublished documentation-and-shortcuts draft. v1.0.8 is the loop-group visual-authoring release candidate.

## Candidate identity

- Version/tag: `1.0.8` / `v1.0.8`
- Built source baseline: `9a0a38bb52c423f64301f9b2f9a488214de6a0d3`
- Release metadata commit: `756d0e974661376445d6241428eeee978ba13ddf`
- The v1.0.8 tag does not exist.
- The v1.0.8 draft does not exist.
- Published baseline: v1.0.6 remains the latest published release.
- Prior draft: v1.0.7 remains verified and unpublished at `0534d785d6d96df00f9da732bdf3c59c80b1d747`.

## Evidence available for the v1.0.8 candidate

| Area | Current evidence | Status |
| --- | --- | --- |
| Candidate source and review | Loop-group visual authoring and the Hermes scanner compatibility layer were merged into local `base`. Claude and Codex provided a clean review of source baseline `c42c1da424b51d99cba5eced1553360c81a2d0ee`, finding zero confirmed defects and zero unresolved suspicions. The reviewed feedback changes add clearer loop-reference guidance and a dedicated reference panel. The final test-only correction targets the Problems auxiliary tabpanel by its current accessible role and was independently approved. | Passed locally |
| Static, contract, resource, and renderer gates | Format, lint, Svelte/TypeScript checks, bundled Hermes contracts and corpora, examples, all 40 packaged resources, and the production renderer build passed. | Passed locally |
| TypeScript | The final clean full suite passed 1,835 tests across 160 files. The earlier reviewed loop-group baseline passed 1,819 tests across 159 files. The v1.0.7 record used `npx vitest run --exclude tests/installers/install-script.test.ts --exclude '.worktrees/**'`; v1.0.8 runs the complete suite with Cargo available. | Passed locally |
| Rust | The clean native suite passed 246 Rust unit tests and 24 Rust integration tests. | Passed locally |
| Renderer E2E | The reviewed loop-group baseline passed 320/320. The final full Playwright suite passed 326/326 across Chromium and WebKit after the stale Problems-role locators were corrected without changing their assertions. Playwright WebKit is browser-engine evidence, not an installed Tauri/WebView result. | Passed locally |
| Performance and accessibility | seven scoped-performance checks cover root and nested loop-group graphs at the 250-node/500-edge contract. Keyboard, Escape order, reduced motion, forced colors, and compact geometry are covered in browser automation. | Passed locally within recorded browser boundaries |
| Local native package | The release-mode Apple Silicon `.app` and 6,300,653-byte DMG built from `9a0a38bb52c423f64301f9b2f9a488214de6a0d3`. Both report version 1.0.8 and identifier `com.cmetech.workflowstudio`; the executable is ARM64, the read-only mounted DMG payload matches the standalone executable, and all 40 bundled offline resources match the committed integrity manifest in both copies. DMG SHA-256: `bc4564b4446d8b4f252d96a02928947ae19ba3e3e4b74c83fd378d790731318e`; executable SHA-256: `e42b0be4bd184cbd663150a5f3f1bba259eb943d0b7d206bf3e80ffc36225f25`. This local `--no-sign` build has only the toolchain's ad hoc linker signature and fails strict bundle-signature validation as expected; it is not Developer ID signed or notarized. | Passed locally |
| Protected native draft | Updater-signed macOS Apple Silicon, macOS Intel, and Windows x64 jobs have not run for v1.0.8. Exact ten-asset inventory, `latest.json`, `SHA256SUMS`, signatures, and extracted payload checks remain open. | Required before publication |
| Installed-app follow-up | Clean macOS Apple Silicon/Intel and Windows installed-app validation, native-WebView interaction, staged update, and release-artifact performance evidence remain open. | Required follow-up |

## Pre-publication decision

- [ ] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v1.0.8 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [ ] Release approved for manual publication.

Decision owner/date: Open. No v1.0.8 tag, push, draft workflow, or publication has been authorized or performed.

## Required next steps

1. Integrate the reviewed release metadata and local-build evidence into `base`, push the exact commit, create and push one immutable annotated `v1.0.8` tag, then dispatch the protected draft-only workflow from `base`.
2. Keep the draft unpublished unless all three native jobs, extracted package payloads, exact inventory, updater targets, checksums, and signatures pass.
3. After a separate publication decision, complete clean-machine installation, staged update, relaunch, version confirmation, and 250-node/500-edge acceptance on each supported platform.

Linux packaging and Windows ARM64 remain deferred. Extracted DMG/NSIS payload verification, exact draft inventory, checksums, and updater signatures block publication. Clean-machine functional installs and staged-update exercises remain required follow-up evidence.
