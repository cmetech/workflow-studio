# Workflow Studio version 2 release acceptance

Status: **PRE-RELEASE — the v2.0.0 source, metadata, and unsigned local macOS Apple Silicon package are verified. The immutable tag, protected updater-signed draft, publication, and installed-platform follow-up remain open.**

Recorded: 2026-09-06. v1.0.6 remains the latest published release. v1.0.7 remains a verified unpublished draft. The locally verified v1.0.8 candidate was superseded without a tag or release. v2.0.0 is the loop-group visual-authoring and Hermes compatibility release candidate.

## Candidate identity

- Version/tag: `2.0.0` / `v2.0.0`
- Feature source baseline: `7d1a57f`
- Locally built release candidate: `8a9214a309542315e6e8f233dcecd9b68d78572f`
- Release metadata commit: `8a9214a309542315e6e8f233dcecd9b68d78572f`
- The v2.0.0 tag does not exist.
- The v2.0.0 draft does not exist.
- Published baseline: v1.0.6 remains the latest published release.
- Prior draft: v1.0.7 remains verified and unpublished at `0534d785d6d96df00f9da732bdf3c59c80b1d747`.

## Evidence available for the v2.0.0 candidate

| Area | Current evidence | Status |
| --- | --- | --- |
| Candidate source and review | The candidate includes the Hermes scanner compatibility contract and corpus, faithful TypeScript reference scanning, loop-group visual authoring, reference guidance beside Problems, resizable workflow details, and a clearer loop-scope Back control. Separate Claude and Codex adversarial reviews found no confirmed or unresolved defect in the completed loop-group compatibility branch; the final workspace controls passed focused unit and Chromium/WebKit layout tests. | Passed locally |
| Static, contract, resource, and renderer gates | Format, lint, Svelte/TypeScript, bundled-contract, example, all 40 packaged-resource, and production renderer checks passed against the v2.0.0 metadata candidate. | Passed locally |
| TypeScript | The complete v2.0.0 suite passed 1,837 tests across 160 files. | Passed locally |
| Rust | The complete v2.0.0 native suite passed 246 Rust unit tests and 24 Rust integration tests. | Passed locally |
| Renderer E2E | The complete v2.0.0 Playwright suite passed 328/328 checks across Chromium and WebKit. Playwright WebKit is browser-engine evidence, not an installed Tauri/WebView result. | Passed locally within recorded browser boundaries |
| Performance and accessibility | Seven scoped-performance checks cover root and nested loop-group graphs at the 250-node/500-edge contract. Keyboard resizing, panel scrolling, Back-button visibility, 1024x700 layout, 200% reflow, reduced motion, and forced colors are covered by automated checks. | Passed locally within recorded browser boundaries |
| Local native package | The release-mode Apple Silicon `.app` and 6,301,686-byte DMG were built from `8a9214a309542315e6e8f233dcecd9b68d78572f`. Both standalone and mounted copies report version 2.0.0 and identifier `com.cmetech.workflowstudio`; the executable is ARM64, the read-only mounted DMG payload matches the standalone executable, and all 40 bundled offline resources match the committed integrity manifest in both copies. DMG SHA-256: `8f07bdb4bdf30b56a582ef46de00a3485f818c3fe29b11dc40bdd983078337d6`; executable SHA-256: `62258a58aec8b96874fd1f761d1ae5bb1684d91a0080aba4e74e5c39f5645141`. This local `--no-sign` build has only the toolchain's ad hoc linker signature and fails strict bundle-signature validation as expected; it is not Developer ID signed or notarized. | Passed locally |
| Protected native draft | Updater-signed macOS Apple Silicon, macOS Intel, and Windows x64 jobs have not run for v2.0.0. Exact ten-asset inventory, `latest.json`, `SHA256SUMS`, signatures, and extracted payload checks remain open. | Required before publication |
| Installed-app follow-up | Clean macOS Apple Silicon/Intel and Windows installed-app validation, native-WebView interaction, staged update, and release-artifact performance evidence remain open. | Required follow-up |

## Pre-publication decision

- [ ] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v2.0.0 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [ ] Release approved for manual publication.

Decision owner/date: Open. No v2.0.0 tag, push, draft workflow, or publication has been performed.

## Required next steps

1. Merge the release metadata and local-build evidence into `base`, push the exact commit, create and push one immutable annotated `v2.0.0` tag, then dispatch the protected draft-only workflow from `base`.
2. Keep the draft unpublished unless all three native jobs, extracted package payloads, exact inventory, updater targets, checksums, and signatures pass.
3. After a separate publication decision, complete clean-machine installation, staged update, relaunch, version confirmation, and 250-node/500-edge acceptance on each supported platform.

Linux packaging and Windows ARM64 remain deferred. Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication. Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.
