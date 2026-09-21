# Workflow Studio v3.0.3 release acceptance

Version/tag: `3.0.3` / `v3.0.3`

Recorded September 21, 2026. Status: published as latest at 22:03:27 UTC; anonymous public downloads verified.

The user authorized committing, merging, pushing and releasing v3.0.3. Publication requires passing CI, native builds and independent draft integrity verification. No installation over the user's current application is performed.

## Scope and evidence

This release replaces application-facing Hermes branding with loop24 or neutral wording. Raw YAML, technical profile identifiers, filenames, paths and Git diffs remain accurate. Dependencies, persisted workflow semantics, installer behavior and updater signing keys remain unchanged.

- [UI copy audit](../analysis/2026-09-21-ui-brand-copy-audit.md).
- [Test investigation](2026-09-21-ui-copy-test-investigation.md): 2,365 passing tests in the corrected full run plus 89 installer tests in the isolated rerun after restoring canonical LF bytes. This is combined evidence from two runs, not a claim of a single green full run.
- Existing v3.0.2 accepted performance exceptions remain recorded in its acceptance document; this patch makes no new performance claim.

## Gates

- [x] Release authorized.
- [x] Metadata RED/GREEN and local static/resource/bundle verification.
- [x] Independent source review completed.
- [x] Preparation PR and merged base CI passed.
- [x] Every linked worktree inspected immediately before tagging.
- [x] Immutable annotated tag points to tested origin/base commit.
- [x] Three native jobs and final draft verifier passed.
- [x] Ten downloaded assets, nine checksums and updater signatures independently verified.
- [x] Extracted Windows payload and protected macOS payload checks passed.
- [x] Published as latest and anonymous public downloads verified.
- [x] Development checkout returned to base.

Clean-machine functional installation and staged-update exercises remain post-publication follow-up.

## Local preparation

The new release expectations first failed five assertions against 3.0.2, then passed all ten metadata tests after synchronization. Eight direct presentation-copy tests additionally pass, including filename, Windows/Unix path, technical profile and mixed-case prose preservation. Independent read-only review found no critical or important issues; its non-blocking boundary-test suggestion is addressed by these tests.

Changed-file formatting and lint, Svelte/TypeScript checks, bundled contracts/examples, all 42 resource checks and the freshly built production bundle budget pass. The repository-wide local formatting command encountered existing CRLF checkout differences; a broad local test filter also discovered the retained nested worktree's older tests. The focused rerun explicitly excludes `.worktrees/**`. Clean CI remains the full committed-tree gate.

## Tested source and CI

Preparation commit `277a4e327129e9206a863ee6871efaa14d858465` was reviewed and merged through [PR #5](https://github.com/cmetech/workflow-studio/pull/5). All seven jobs in [preparation CI 35644341332](https://github.com/cmetech/workflow-studio/actions/runs/35644341332) passed, including 2,462 unit tests, 253 Rust unit tests, one IPC test, 26 Git integration tests and 404 cross-browser tests with four configured skips.

All seven jobs in [merged-base CI 35647573904](https://github.com/cmetech/workflow-studio/actions/runs/35647573904) passed before tagging. Immutable annotated tag `v3.0.3` resolves to `33e7e07507f17164e0789cd9ce962d2386320a89`, whose tree exactly matches the reviewed preparation commit. [Native release run 35650318562](https://github.com/cmetech/workflow-studio/actions/runs/35650318562) uses that same application and tooling commit.

## Worktree preflight

Immediately before tagging, the main checkout was clean on `base` at `33e7e07`, matching `origin/base`. The retained `.worktrees/windows-primary-stabilization` checkout was clean on `fix/release-verification-shell` at `a683359`. The detached `C:/Users/ecorell/ws11base` checkout at `55b5adf` contained only unrelated untracked `node_modules.partial/`, which was preserved. A command-scoped safe-directory option allowed its read-only inspection without changing global Git configuration. No intended release work was left behind.

## Native build investigation

Apple Silicon job `106500979538` passed 2,462 unit tests across 187 files, 253 Rust unit tests, one IPC test, 26 Git integration tests and all 42 extracted DMG resources.

The initial Intel job `106500979550` stopped after 2,461 passing unit tests and one failure in the unchanged `App.companion-contract-readiness.test.ts`, at the assertion that the newly created companion file becomes readable. Its polling wait uses Testing Library's default 1,000 ms even though the test function has a 20-second budget. The action loads a deferred analysis module and validates the workflow before writing. The failure is consistent with timing sensitivity, but that explanation is not proven by the runner log. The exact unchanged test passed in preparation CI, merged CI, Apple Silicon release validation and two focused local reruns. No assertion, timeout, application code or immutable tag was changed in response. One bounded retry of the failed Intel job started as attempt 2, job `106524305150`, after Windows completed; GitHub rejected the earlier request while Windows was still running. The successful platform results were retained. The initial failure log is retained locally as `.release-303-intel.log`.

Windows job `106500979609` passed all 2,462 unit tests, 236 Rust unit tests, one IPC test, 12 Git integration tests, the GUI executable check and all 42 extracted NSIS resources.

The single unchanged Intel retry passed: job `106524305150` completed all 2,462 unit tests, 253 Rust unit tests, one IPC test, 26 Git integration tests and all 42 extracted DMG resources. This demonstrates that the initial failure was intermittent; the timing explanation remains an inference. Its complete log is retained as `.release-303-intel-retry.log`. No further native retry was needed. The final complete-draft verifier is job `106533342369`.

## Independent Windows verification

The Windows installer and signature were independently downloaded into `C:/Users/ecorell/AppData/Local/Temp/ws-v303-release-482b57f8/windows-independent`. Exact-draft identity, API sizes/digests and the cryptographic updater signature passed. Pinned 7-Zip 26.03 extracted the installer without executing it. All 42 resources and the GUI PE subsystem passed the repository verifier; both executable ProductVersion and FileVersion are `3.0.3`. The installer is 5,125,395 bytes with SHA-256 `4340ee910d7e5aeacaee22bb1137f73d4047f3dc087af7197b72fa9d7f5734a4`. Full ten-asset verification subsequently passed after the Intel retry and final draft verifier completed.


## Publication and final integrity evidence

Release workflow attempt 2 passed, including the complete-draft verifier. Exactly ten independently downloaded assets, nine checksum entries, all three updater targets and cryptographic signatures passed the repository verifier. Every local asset size and digest matched fresh exact-draft API metadata. The Windows bytes matched the previously extracted and verified installer. Remote tag identity was reconfirmed before publication.

GitHub release [393267558](https://github.com/cmetech/workflow-studio/releases/tag/v3.0.3) was published as latest at 2026-09-21 22:03:27 UTC. Anonymous public latest-release metadata, Windows installer, updater manifest and SHA256SUMS matched the independently verified release. Both macOS public download URLs returned success. The immutable v1.0.5 PowerShell bootstrap matched Git blob 0a8b10b6e0cf6160ea6c93082e101c013de1b367; it was downloaded but not executed. No installed application was replaced.

Independent files and extraction evidence are retained at C:/Users/ecorell/AppData/Local/Temp/ws-v303-release-482b57f8. Final evidence documentation is committed after the immutable application tag; it does not alter the shipped application. The development checkout remains on base.

| Asset | Bytes | SHA-256 |
| --- | --- | --- |
| `latest.json` | 3920 | `d2368e16f1bb98dd8f69c4e73999f7451e1a6c3404f2937c5c40d06d56b67e86` |
| `LOOP24-Workflow-Studio_3.0.3_macos_aarch64.app.tar.gz` | 6977285 | `de597f930f4e05c7fd71815dab79510662473c35fbc2c79d4752875996a0cf35` |
| `LOOP24-Workflow-Studio_3.0.3_macos_aarch64.app.tar.gz.sig` | 424 | `ee051ab417f346bb589d685b4147e287d92c60536b7f87baa94c2d496db8ab7b` |
| `LOOP24-Workflow-Studio_3.0.3_macos_aarch64.dmg` | 6869254 | `5f28ccb36d0a0132469a57038b5f5eb0c1f3fd46e50aeea7a2bc45f90003b796` |
| `LOOP24-Workflow-Studio_3.0.3_macos_x86_64.app.tar.gz` | 7088381 | `e7dd1e0b24cda268b9d66706e38ba98c47bf739add64345a10f4cff7a925ae93` |
| `LOOP24-Workflow-Studio_3.0.3_macos_x86_64.app.tar.gz.sig` | 424 | `317bb7193fc67e2be7058b7322c4e6be218f10f1e5bfb4440bdfc8682359cbe5` |
| `LOOP24-Workflow-Studio_3.0.3_macos_x86_64.dmg` | 7046032 | `93f3fce5290751aa1074300e55ba3a2f06b4f6bf1faf2fdf40707bbb363b8471` |
| `LOOP24-Workflow-Studio_3.0.3_windows_x86_64-setup.exe` | 5125395 | `4340ee910d7e5aeacaee22bb1137f73d4047f3dc087af7197b72fa9d7f5734a4` |
| `LOOP24-Workflow-Studio_3.0.3_windows_x86_64-setup.exe.sig` | 436 | `8452436d7fbaf583e0f0a6dc8c7d4026ab2c7c9741b203972b9df34291c77261` |
| `SHA256SUMS` | 1033 | `a448b3e3f2f82c0776cc9ba5e24e0c78b499741cfcd29d7ab6d29c18cb18dbf2` |
