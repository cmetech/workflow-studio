# Workflow Studio v1 release platform scope

**Status:** Approved design, pending written-spec review  
**Date:** 2026-07-30

## Context

The immutable `v1.0.0` application-source tag already exists and must not move. Native release jobs successfully built and verified macOS Apple Silicon, macOS Intel, and Windows x64 artifacts. The Linux x64 runner remained unusually slow and was cancelled at the user's direction because Linux is not a version 1 release priority.

The existing release contract requires Linux x64 alongside the three completed targets. Merely publishing the partial draft would bypass its final checksum, updater-manifest, signature, and asset-inventory gate. Version 1 therefore needs an explicit platform-scope amendment rather than a manual partial publication.

This specification supersedes only the version 1 release-platform and pre-publication acceptance requirements in the 2026-07-25 product and release documents. It does not remove Linux compatibility from the application's long-term product direction.

## Decision

Workflow Studio `v1.0.0` will publicly support these native release targets:

- macOS Apple Silicon (`aarch64` DMG and updater archive/signature)
- macOS Intel (`x86_64` DMG and updater archive/signature)
- Windows x64 (NSIS installer and updater archive/signature)

Linux packaging is deferred. Version 1 must not publish an AppImage, advertise Linux installation, or silently redirect Linux users to another platform artifact. The shell bootstrap must reject Linux with a clear unsupported-platform error before downloading a release asset.

The existing `v1.0.0` application-source tag remains immutable. Release-policy and verification changes live on reviewed `base` commits. The release workflow must pin the exact release-tooling commit used by a run while continuing to build application artifacts exclusively from the validated `v1.0.0` tag commit.

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

Successful assets from cancelled attempts may remain in the draft only if the new run overwrites the exact expected names and the final verifier validates the freshly downloaded bytes. Stale or extra Linux assets must be deleted or rejected before publication.

## Installer and documentation behavior

The public installation documentation lists macOS Apple Silicon, macOS Intel, and Windows x64 only.

The PowerShell bootstrap continues to select Windows x64 exactly, verify `SHA256SUMS`, and launch NSIS. The shell bootstrap supports macOS Apple Silicon and Intel, verifies `SHA256SUMS`, and opens the DMG. Linux and unsupported architectures fail clearly without downloading or launching an installer.

The documentation continues to explain that OS bundles lack Apple Developer ID/notarization and Microsoft Authenticode signatures. Gatekeeper and SmartScreen instructions must not disable or weaken system security. Tauri updater signatures remain mandatory and distinct from publisher signing.

## Publication and acceptance

The automated three-platform build and draft-wide verification gate is the required pre-publication gate for `v1.0.0`. Once it is green, an independent authenticated download must confirm the draft inventory, checksum manifest, updater metadata, and updater signatures before the draft is published.

Clean-machine functional, installation, updater, and performance acceptance for macOS and Windows remains required release follow-up evidence, but it no longer blocks making this explicitly unsigned `v1.0.0` release public. Any failure found during that acceptance is handled through a subsequent immutable patch release; `v1.0.0` assets and tag must not be silently replaced after publication.

Linux clean-machine acceptance is deferred until Linux packaging is reintroduced in a later reviewed release-scope amendment.

## Test-driven implementation

Implementation follows strict red-green-refactor sequencing:

1. Add failing workflow-contract tests for the exact three-target matrix and immutable separate tooling checkout.
2. Add failing asset-verifier tests that require exactly the two macOS targets and Windows x64 and reject Linux assets.
3. Add failing bootstrap tests proving Linux is rejected before any network or launch operation.
4. Update the smallest relevant workflow, verifier, installer, and documentation surfaces.
5. Run focused tests after each change, then the complete TypeScript, Rust, contract, example, formatting, lint, type, workflow-lint, and end-to-end gates.
6. Obtain independent subagent specification and code-quality reviews.
7. Run the macOS/Windows release workflow against the unchanged `v1.0.0` source tag.
8. Independently download and verify every completed draft asset before publication.

## Non-goals

- Moving, deleting, or recreating the existing `v1.0.0` tag
- Publishing Linux, Windows ARM64, or macOS universal artifacts in version 1
- Adding Apple notarization, Developer ID, or Microsoft Authenticode signing
- Weakening updater signatures, checksums, exact-asset selection, or tag ancestry checks
- Changing application behavior or the workflow YAML source-of-truth model
