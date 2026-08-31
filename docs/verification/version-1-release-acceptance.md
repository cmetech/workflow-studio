# Workflow Studio version 1 release acceptance

Status: **PRE-RELEASE — v1.0.6 metadata is prepared; immutable tag, draft artifacts, publication, and installed-app follow-up remain open.**

Recorded: 2026-08-31. v1.0.1 is unpublished as a failed draft: its three native builds and payload gates passed, but final metadata normalization failed because the release-by-tag API returned 404 for the draft. Its immutable tag and seven-asset draft remain unchanged as failure evidence. v1.0.2 is unpublished as a failed draft with seven assets: its Windows build failed because default PowerShell expanded an unset positional shell variable instead of the valid release ID environment variable. Its immutable tag, draft, and assets remain unchanged as failure evidence. v1.0.3 is the published recovery release. v1.0.4 is unpublished as a failed empty draft: immutable tag `v1.0.4` points to `b6d7648`, release workflow run `33350871938` was cancelled before platform assets after push CI run `33350865772` failed Quality and E2E, and fixes landed in `83e48ee` and `a0843dd`. v1.0.5 remains unpublished with no release or assets: its immutable annotated tag peels to `0ecb5bd46a49cebe4037825856411d8ead5db17f`, push CI run `33355845811` failed deterministic renderer E2E, and no v1.0.5 release workflow ran. v1.0.6 is the current content-aware workbench remediation release and uses the same fail-closed draft-release process.

## Evidence available before the v1.0.6 version bump

| Area | Current evidence | Status |
| --- | --- | --- |
| Base CI | Remediation commit `8084211d9f4d28f505db0a960b83e8629f7f2a86` completed base CI run `33413849179`. Quality and native debug bundle jobs on macOS, Windows, and Ubuntu succeeded. The renderer E2E job concluded success with `1 flaky, 293 passed`: one WebKit activity-pages initial timeout passed on retry. | Successful with the disclosed E2E retry; native debug bundles are build evidence, not installed-app evidence |
| Renderer E2E | Playwright uses isolated browser contexts and retained failure traces/screenshots. The full Chromium and WebKit suite covers exact-YAML authoring/canvas persistence, content-aware activity pages, constrained layouts and zoom, modal focus behavior, local-only Git, setup/update flows, and release-critical regressions. Local verification was clean 294/294; CI run `33413849179` concluded success only after the disclosed WebKit retry. | Clean 294/294 locally; CI retry disclosed |
| Security | `tests/security/security-boundaries.test.ts` parses the real CSP/capability/command/Git/updater configuration, allowlists outbound mechanisms, enforces private-log bounds, executes sanitizer corpora, keeps native CI fork-safe, and rejects E2E controls from a real production build. Native Rust suites cover app-data scoping, bounds, redaction, path containment, and updater transitions. | Included in the passing full local and CI gates |
| Performance | The final stabilization tree includes the deterministic 250-node/500-edge contract and trace-backed workbench remediations. The complete local Chromium/WebKit run passed cleanly after stabilization. CI concluded successfully with the disclosed WebKit activity-pages retry, so this record does not characterize that CI E2E execution as clean or retry-free. | Passed cleanly locally; CI retry disclosed; installed reference-machine repetition remains open |
| Full local verification | Format, lint, Svelte/TypeScript, contracts, examples, 32 bundled resources, 1,206 TypeScript unit/component/integration tests, 245 Rust unit tests, 24 real Git integration tests, production renderer build, and 294 Playwright E2E tests passed on the final stabilization tree before the release-only version bump. The renderer build transformed 877 modules and retained only the documented non-blocking chunk-size warning. | Passed on macOS arm64 before metadata preparation |
| Packaging | Base CI created native debug bundles successfully on macOS, Windows, and Ubuntu. The protected release workflow has not yet run for v1.0.6, so no v1.0.6 draft, signed updater metadata, checksums, or release artifacts exist yet. | Release artifact gate open |

Playwright WebKit is browser-engine evidence, not an installed Tauri/WebView result. Windows installed-app validation was not performed and remains open. No Windows installed-app behavior is recorded as passing.

## Required draft verification and installed-app follow-up

These gates cannot be satisfied by browser fixtures, local cross-checks, or the successful debug-bundle jobs:

1. Create the immutable `v1.0.6` annotated tag from the fully reviewed and verified release commit on `origin/base`; do not move or delete earlier tags.
2. Run the protected draft-only release workflow and verify the actual three-target artifacts, extracted package payloads, exact ten-asset inventory, `SHA256SUMS`, updater metadata, companion signatures, and first-party Minisign verification job before publication.
3. On clean macOS Apple Silicon and Intel machines, install through the documented unsigned Gatekeeper path and record all acceptance-template behaviors.
4. On a clean Windows x64 machine, install through the documented SmartScreen path and record all acceptance-template behaviors. Windows CI bundle success is not a substitute for this installed-app check.
5. From each installed application, exercise a staged signed update through download, verification, installation, relaunch, and version confirmation.
6. Repeat the 250-node/500-edge interaction acceptance on release artifacts and reference machines for each supported operating system.

Linux packaging and clean-machine evidence remain deferred until a later reviewed release-scope amendment. The exact three-target draft verification and package-payload gate block publication; macOS and Windows clean-machine records remain required post-publication follow-up evidence.
