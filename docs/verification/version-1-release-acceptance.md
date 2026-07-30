# Workflow Studio version 1 release acceptance

Status: **BLOCKED — implementation-local gates are complete; no version 1 release is approved.**

Recorded: 2026-07-30. The application intentionally has not been tagged or published during Task 7.

## Evidence available in the repository

| Area | Current evidence | Status |
| --- | --- | --- |
| Renderer E2E | Playwright uses localhost, one Chromium worker, isolated test contexts, retained failure traces/screenshots, and an E2E-only bridge seeded before application modules. Nine scenarios cover exact-YAML authoring/canvas persistence, invalid YAML recovery, all ten examples/contextual docs, pair-only Git, malicious/valid branding, setup/update retry, download/verify/install/relaunch, and cancellation. | 9 passed locally |
| Security | Eight tests in `tests/security/security-boundaries.test.ts` parse the real CSP/capability/command/Git/updater configuration, allowlist outbound mechanisms, enforce private-log bounds, execute sanitizer corpora, keep native CI fork-safe, and reject E2E controls from a real production build. Native Rust suites cover app-data scoping, bounds, redaction, path containment, and updater transitions. | 8 passed locally |
| Performance | `docs/verification/phase-3-canvas-performance.md` records the deterministic 250-node/500-edge automated contract and macOS arm64 development-build observations, including disclosed interaction delays. | Available; must be repeated on release artifacts/platforms |
| Full verification | Format, lint, Svelte/TypeScript, 914 unit/component/integration tests, 234 Rust unit tests, and 24 real Git integration tests. Contracts, examples, production renderer, and CI workflow syntax also pass. | Passed locally on macOS arm64 |
| Packaging | Native CI and the draft-only release workflow target macOS arm64/x64, Windows x64, and Linux x64. Installer scripts require exact target selection, checksums, and reject unsupported ARM64 Windows/Linux. A macOS arm64 debug app/DMG bundle completed with the checked-in CI override that disables updater artifacts and therefore requires no release signing secret; the protected release workflow still creates signed updater artifacts. Windows GNU test-target compilation passed. | Native build/cross-check only; not clean-machine or staged-updater evidence |

## Mandatory external acceptance still missing

These blockers cannot be satisfied by browser fixtures, local cross-checks, or an unexecuted workflow:

1. Create an immutable version tag and draft release from the approved commit, without publishing it.
2. Download and verify the actual draft artifacts, checksum manifest, updater metadata, companion signatures, and first-party Minisign verification job.
3. On clean macOS Apple Silicon and Intel machines, install through the documented unsigned Gatekeeper path and record all template behaviors.
4. On a clean Windows x64 machine, install through the documented SmartScreen path and record all template behaviors.
5. On a clean Linux x64 machine, run/install the AppImage and record all template behaviors.
6. From each installed application, exercise a staged signed update through download, verification, installation, relaunch, and version confirmation.
7. Repeat the 250-node/500-edge interaction acceptance on the release artifact/reference machine for each supported operating system.

Until every item has real artifact/machine evidence, version 1 remains a release blocker even when all safe local implementation and CI gates pass.
