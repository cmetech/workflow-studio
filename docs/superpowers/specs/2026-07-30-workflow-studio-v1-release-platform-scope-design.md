# Workflow Studio v1 release platform scope

**Status:** Approved design, pending written-spec review  
**Date:** 2026-07-30

## Context

The immutable `v1.0.0` application-source tag already exists and must not move. Native release jobs successfully built and verified macOS Apple Silicon, macOS Intel, and Windows x64 artifacts. The Linux x64 runner remained unusually slow and was cancelled at the user's direction because Linux is not a version 1 release priority.

The existing release contract requires Linux x64 alongside the three completed targets. Publishing the partial draft bypasses its final updater-manifest, signature, and asset-inventory gate. At the user's explicit direction, the current artifacts and an independently verified checksum manifest were made public temporarily so the owner can test the Windows bootstrap and unsigned installer before the full three-platform rebuild. This owner-only test state is not final release acceptance. Version 1 still needs an explicit platform-scope amendment and a complete three-platform verification pass.

This specification supersedes only the version 1 release-platform and pre-publication acceptance requirements in the 2026-07-25 product and release documents. It does not remove Linux compatibility from the application's long-term product direction.

## Decision

Workflow Studio `v1.0.0` will publicly support these native release targets:

- macOS Apple Silicon (`aarch64` DMG and updater archive/signature)
- macOS Intel (`x86_64` DMG and updater archive/signature)
- Windows x64 (NSIS installer and updater archive/signature)

Linux packaging is deferred. Version 1 must not publish an AppImage, advertise Linux installation, or silently redirect Linux users to another platform artifact. The shell bootstrap must reject Linux with a clear unsupported-platform error before downloading a release asset.

The existing `v1.0.0` application-source tag remains immutable. Release-policy and verification changes live on reviewed `base` commits. The release workflow must pin the exact release-tooling commit used by a run while continuing to build application artifacts exclusively from the validated `v1.0.0` tag commit.

Before the verified rebuild mutates any public asset, the temporary test release must be returned to draft state. Exact test assets may then be deleted or replaced while the release is private. The final verified release is published again only after all amended gates pass.

## Release-tooling boundary

The release workflow has two independently auditable inputs:

1. **Application source:** the immutable commit resolved from `v1.0.0`. All native builds, bundled resources, application tests, Rust tests, authoring-contract checks, and example checks run against this commit.
2. **Release tooling:** the immutable `base` commit that defines the dispatched workflow. A separate credential-free checkout supplies the reviewed asset verifier that understands the amended three-target scope. The workflow records and uses this exact commit rather than reading a moving branch during the run.

The separate tooling checkout may validate and normalize release metadata, but it must never replace application source, Tauri configuration, bundled resources, or native binaries. The signature verifier and Tauri public key configuration remain built/read from the tagged application source.

## Workflow and asset contract

The native matrix contains exactly the three supported targets and remains serialized so Tauri updater metadata cannot be overwritten by concurrent uploads. Every target runs the same full formatting, lint, Svelte/TypeScript, unit-test, Rust-test, contract, and example gates before packaging.

The final release verifier must:

- require exactly the two macOS targets and Windows x64;
- reject missing, duplicate, ambiguous, unsafe, cross-release, Linux, or otherwise unknown assets;
- verify updater URLs, updater signatures, companion signature files, version, product identity, platform identity, and architecture identity;
- normalize and re-upload `latest.json` only after all required target assets exist;
- generate `SHA256SUMS` from freshly downloaded release bytes;
- re-download the completed draft and validate it again before allowing publication; and
- keep the release as a draft until that job is green.

Successful assets from cancelled attempts or the temporary owner-only test publication may remain after the release returns to draft only if the new run overwrites the exact expected names and the final verifier validates the freshly downloaded bytes. Stale or extra Linux assets must be deleted or rejected before final publication.

## Installer and documentation behavior

The public installation documentation lists macOS Apple Silicon, macOS Intel, and Windows x64 only.

The PowerShell bootstrap continues to select Windows x64 exactly, verify `SHA256SUMS`, and launch NSIS. The shell bootstrap supports macOS Apple Silicon and Intel, verifies `SHA256SUMS`, and opens the DMG. Linux and unsupported architectures fail clearly without downloading or launching an installer.

The documentation continues to explain that OS bundles lack Apple Developer ID/notarization and Microsoft Authenticode signatures. Gatekeeper and SmartScreen instructions must not disable or weaken system security. Tauri updater signatures remain mandatory and distinct from publisher signing.

## Publication and acceptance

The current public `v1.0.0` is an explicit, temporary exception used only by the repository owner to exercise the initial Windows installation path. Its Windows bytes and public checksum path were independently verified before publication, but its updater inventory is incomplete and it must not be described as the completed release.

After the owner test, `v1.0.0` returns to draft before any asset replacement. The automated three-platform build and draft-wide verification gate is then the required gate for final publication. Once it is green, an independent authenticated download must confirm the draft inventory, checksum manifest, updater metadata, and updater signatures before the completed draft is published.

Clean-machine functional, installation, updater, and performance acceptance for macOS and Windows remains required release follow-up evidence, but it no longer blocks final publication of this explicitly unsigned `v1.0.0` release. After final publication, any failure found during that acceptance is handled through a subsequent immutable patch release; `v1.0.0` assets and tag must not be silently replaced again.

Linux clean-machine acceptance is deferred until Linux packaging is reintroduced in a later reviewed release-scope amendment.

## Test-driven implementation

Implementation follows strict red-green-refactor sequencing:

1. Add failing workflow-contract tests for the exact three-target matrix and immutable separate tooling checkout.
2. Add failing asset-verifier tests that require exactly the two macOS targets and Windows x64 and reject Linux assets.
3. Add failing bootstrap tests proving Linux is rejected before any network or launch operation.
4. Update the smallest relevant workflow, verifier, installer, and documentation surfaces.
5. Run focused tests after each change, then the complete TypeScript, Rust, contract, example, formatting, lint, type, workflow-lint, and end-to-end gates.
6. Obtain independent subagent specification and code-quality reviews.
7. Return the temporary owner-test release to draft state before replacing any asset.
8. Run the macOS/Windows release workflow against the unchanged `v1.0.0` source tag.
9. Independently download and verify every completed draft asset before final publication.

## Non-goals

- Moving, deleting, or recreating the existing `v1.0.0` tag
- Publishing Linux, Windows ARM64, or macOS universal artifacts in version 1
- Adding Apple notarization, Developer ID, or Microsoft Authenticode signing
- Weakening updater signatures, checksums, exact-asset selection, or tag ancestry checks
- Changing application behavior or the workflow YAML source-of-truth model
