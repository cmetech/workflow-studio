# Workflow Studio version 1 release acceptance

Status: **FOLLOW-UP — v1.0.2 local and draft-release verification must be recorded; clean-machine evidence is post-publication follow-up.**

Recorded: 2026-07-30. v1.0.1 is unpublished as a failed draft: its three native builds and payload gates passed, but final metadata normalization failed because the release-by-tag API returned 404 for the draft. Its immutable tag and seven-asset draft remain unchanged as failure evidence. v1.0.2 is the recovery release; it replaces that lookup with an authenticated paginated release-list resolver and corrects the native Tauri v2 updater artifact contract before any new tag or draft is created.

## Evidence available in the repository

| Area | Current evidence | Status |
| --- | --- | --- |
| Renderer E2E | Playwright uses localhost, one Chromium worker, isolated test contexts, retained failure traces/screenshots, and an E2E-only bridge seeded before application modules. Nine scenarios cover exact-YAML authoring/canvas persistence, invalid YAML recovery, all ten examples/contextual docs, pair-only Git, malicious/valid branding, setup/update retry, download/verify/install/relaunch, and cancellation. | 9 passed locally |
| Security | Eight tests in `tests/security/security-boundaries.test.ts` parse the real CSP/capability/command/Git/updater configuration, allowlist outbound mechanisms, enforce private-log bounds, execute sanitizer corpora, keep native CI fork-safe, and reject E2E controls from a real production build. Native Rust suites cover app-data scoping, bounds, redaction, path containment, and updater transitions. | 8 passed locally |
| Performance | `docs/verification/phase-3-canvas-performance.md` records the deterministic 250-node/500-edge automated contract and macOS arm64 development-build observations, including disclosed interaction delays. | Available; must be repeated on release artifacts/platforms |
| Full verification | Format, lint, Svelte/TypeScript, 915 unit/component/integration tests, 234 Rust unit tests, and 24 real Git integration tests. Contracts, examples, production renderer, and CI workflow syntax also pass. | Passed locally on macOS arm64 |
| Packaging | Native CI and the draft-only release workflow target exactly macOS arm64/x64 and Windows x64. Installer scripts require exact target selection and checksums; Linux is deferred and rejected before a bootstrap network request. Before a draft accepts each build, the workflow verifies the extracted DMG/NSIS payload against the setup-integrity manifest. A macOS arm64 debug app/DMG bundle completed with the checked-in CI override that disables updater artifacts and therefore requires no release signing secret; the protected release workflow still creates signed updater artifacts. Windows GNU test-target compilation passed. | Native build/cross-check only; not clean-machine or staged-updater evidence |

## Required draft verification and clean-machine follow-up

These blockers cannot be satisfied by browser fixtures, local cross-checks, or an unexecuted workflow:

1. Create the immutable `v1.0.2` tag and draft release from the approved commit, without publishing it.
2. Download and verify the actual three-target draft artifacts, extracted package payloads, checksum manifest, updater metadata, companion signatures, and first-party Minisign verification job.
3. On clean macOS Apple Silicon and Intel machines, install through the documented unsigned Gatekeeper path and record all template behaviors.
4. On a clean Windows x64 machine, install through the documented SmartScreen path and record all template behaviors.
5. From each installed application, exercise a staged signed update through download, verification, installation, relaunch, and version confirmation.
6. Repeat the 250-node/500-edge interaction acceptance on the release artifact/reference machine for each supported operating system.

Linux packaging and clean-machine evidence are deferred until a later reviewed release-scope amendment. The exact three-target draft verification and package-payload gate block publication; the macOS/Windows clean-machine records remain required post-publication follow-up evidence.
