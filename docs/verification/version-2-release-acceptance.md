# Workflow Studio version 2 release acceptance

Status: **PRE-RELEASE — v2.0.0 metadata is prepared. Complete local verification, the unsigned macOS Apple Silicon package, immutable tag, protected updater-signed draft, publication, and installed-platform follow-up remain open.**

Recorded: 2026-09-06. v1.0.6 remains the latest published release. v1.0.7 remains a verified unpublished draft. The locally verified v1.0.8 candidate was superseded without a tag or release. v2.0.0 is the loop-group visual-authoring and Hermes compatibility release candidate.

## Candidate identity

- Version/tag: `2.0.0` / `v2.0.0`
- Feature source baseline: `7d1a57f`
- Release metadata commit: pending local verification
- The v2.0.0 tag does not exist.
- The v2.0.0 draft does not exist.
- Published baseline: v1.0.6 remains the latest published release.
- Prior draft: v1.0.7 remains verified and unpublished at `0534d785d6d96df00f9da732bdf3c59c80b1d747`.

## Evidence available for the v2.0.0 candidate

| Area | Current evidence | Status |
| --- | --- | --- |
| Candidate source and review | The candidate includes the Hermes scanner compatibility contract and corpus, faithful TypeScript reference scanning, loop-group visual authoring, reference guidance beside Problems, resizable workflow details, and a clearer loop-scope Back control. Separate Claude and Codex adversarial reviews found no confirmed or unresolved defect in the completed loop-group compatibility branch; the final workspace controls passed focused unit and Chromium/WebKit layout tests. | Passed locally |
| Static, contract, resource, and renderer gates | Fresh v2.0.0 format, lint, Svelte/TypeScript, bundled-contract, example, resource, and production renderer checks are pending. | In progress |
| TypeScript | The merged feature baseline passed 1,837 tests across 160 files. A fresh run against the v2.0.0 metadata candidate is pending. | In progress |
| Rust | The merged feature baseline passed 246 Rust unit tests and 24 Rust integration tests. A fresh v2.0.0 run is pending. | In progress |
| Renderer E2E | The complete v2.0.0 Playwright run across Chromium and WebKit is pending. The final workspace-control file passed 58/58 checks across both engines. | In progress |
| Performance and accessibility | Seven scoped-performance checks cover root and nested loop-group graphs at the 250-node/500-edge contract. Keyboard resizing, panel scrolling, Back-button visibility, 1024x700 layout, 200% reflow, reduced motion, and forced colors are covered by automated checks. | Passed locally within recorded browser boundaries |
| Local native package | Unsigned macOS Apple Silicon release-mode app and DMG construction, resource verification, package identity, and artifact hashes are pending. | In progress |
| Protected native draft | Updater-signed macOS Apple Silicon, macOS Intel, and Windows x64 jobs have not run for v2.0.0. Exact ten-asset inventory, `latest.json`, `SHA256SUMS`, signatures, and extracted payload checks remain open. | Required before publication |
| Installed-app follow-up | Clean macOS Apple Silicon/Intel and Windows installed-app validation, native-WebView interaction, staged update, and release-artifact performance evidence remain open. | Required follow-up |

## Pre-publication decision

- [ ] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v2.0.0 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [ ] Release approved for manual publication.

Decision owner/date: Open. No v2.0.0 tag, push, draft workflow, or publication has been performed.

## Required next steps

1. Complete all local gates and record the unsigned Apple Silicon package evidence.
2. Merge the release metadata and local-build evidence into `base`, push the exact commit, create and push one immutable annotated `v2.0.0` tag, then dispatch the protected draft-only workflow from `base`.
3. Keep the draft unpublished unless all three native jobs, extracted package payloads, exact inventory, updater targets, checksums, and signatures pass.
4. After a separate publication decision, complete clean-machine installation, staged update, relaunch, version confirmation, and 250-node/500-edge acceptance on each supported platform.

Linux packaging and Windows ARM64 remain deferred. Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication. Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.
