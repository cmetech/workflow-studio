# Workflow Studio v1.0.1 stabilization release

**Status:** Approved design, pending written-spec review  
**Date:** 2026-07-30

## Context

The public `v1.0.0` owner-test release proved that the Windows bootstrap can download, checksum, and launch the unsigned NSIS installer. It also exposed two application-package defects:

1. Setup fails while verifying bundled resources. The shipped NSIS payload contains all 30 committed resource files, but the Windows checkout converted their LF line endings to CRLF before packaging. Every packaged SHA-256 digest therefore differs from the integrity manifest embedded in the executable.
2. Launching the installed app opens a terminal window. The Rust binary lacks the Windows GUI-subsystem attribute, while the default Tauri log plugin emits trace/debug records to stdout. A missing frontend favicon caused the visible Tauri asset-fallback messages.

The setup verifier behaved correctly and must not be weakened. These fixes require new application source, so the immutable `v1.0.0` source tag cannot produce the corrected executable.

This specification supersedes the final-version and release-lifecycle portions of the 2026-07-30 v1 release-platform scope design. Its macOS/Windows platform scope, exact asset verification, unsigned-distribution policy, and Linux deferral remain in force.

## Release decision

Workflow Studio will ship one combined stabilization release, `v1.0.1`. It includes the discovered Windows fixes and every outstanding macOS/Windows-only release-tooling, installer, documentation, and validation change from the v1 platform-scope design.

The existing `v1.0.0` tag and assets are never moved or replaced. Its release is marked as a prerelease/owner-test build with a visible known-issue notice so the GitHub latest-release API no longer offers the broken package. `v1.0.1` becomes the first completed public release and the latest release only after its full gate passes.

## Application-package fixes

### Byte-stable bundled resources

Repository attributes enforce LF checkout bytes for every integrity-protected file under `brands/`, `contracts/`, and `examples/`, including on Windows runners. A regression test performs a real Git checkout with Windows line-ending conversion enabled and proves that the checked-out resource digest still matches the committed integrity manifest.

The release gate inspects the actual native bundle payload, not just the source tree. Windows NSIS resources must be extracted or otherwise enumerated and hashed against the embedded manifest before the target is accepted. Equivalent macOS bundle-resource verification remains required. Missing, extra, transformed, or mismatched bundled resources fail the release.

Setup continues to verify exact file identity, paths, types, sizes, and SHA-256 digests at runtime. No normalization or digest bypass is introduced.

### Native Windows GUI behavior

The release Rust binary uses the Windows GUI subsystem while debug builds retain their development console behavior. A PE-header verifier checks the packaged release executable and rejects the Windows build unless its subsystem is `Windows GUI` rather than `Windows CUI`.

Release logging is capped at informational severity and remains available in the application log directory. Development builds may retain debug logging. The frontend includes an explicit bundled LOOP24 favicon so the webview does not request a missing `favicon.ico` fallback.

## Supported platforms

`v1.0.1` publishes exactly:

- macOS Apple Silicon: DMG plus updater archive/signature;
- macOS Intel: DMG plus updater archive/signature; and
- Windows x64: NSIS installer plus updater archive/signature.

Linux is deferred. No Linux artifact appears in the release, documentation, updater manifest, checksum inventory, or native matrix. The shell bootstrap rejects Linux before any release-asset network request.

## Release workflow and verification

Application code is built exclusively from the immutable `v1.0.1` tag commit. The manually dispatched workflow also records its exact release-tooling commit and checks out that tooling separately without persisted credentials. Release tooling may verify and normalize metadata but never replace tagged application source, configuration, bundled resources, or binaries.

The three native jobs remain serialized and each runs formatting, lint, type/Svelte checks, TypeScript tests, Rust tests, contract checks, and example checks before packaging. The final verifier requires exactly the three supported target inventories, validates updater identities and cryptographic signatures, normalizes `latest.json`, generates `SHA256SUMS` from downloaded release bytes, and re-downloads and revalidates the completed draft.

The Windows target additionally proves LF-stable resource bytes and the GUI PE subsystem. The macOS targets prove their bundled resources match the same integrity manifest. Stale, Linux, duplicate, unknown, ambiguous, or cross-version assets block publication.

After the automated gate is green, an independent authenticated download validates every draft asset, checksum, updater URL, and updater signature. Only then is `v1.0.1` published as the latest release.

## Bootstrap and documentation

The Windows PowerShell bootstrap retains its Windows PowerShell 5.1-compatible architecture resolver, queries the latest public release, selects Windows x64 exactly, verifies `SHA256SUMS`, and launches NSIS. The documented Windows command uses the familiar complete-script form:

```powershell
iex (irm 'https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.1/scripts/install.ps1')
```

The macOS bootstrap supports Apple Silicon and Intel only, verifies `SHA256SUMS`, and opens the matching DMG. Documentation provides a copy-safe one-line command while preserving the bootstrap's exact release selection and installer checksum verification.

Documentation states that the OS bundles lack Apple Developer ID/notarization and Microsoft Authenticode signatures. SmartScreen and Gatekeeper guidance never disables platform security. Tauri updater signatures remain mandatory and distinct from publisher signing.

Installing `v1.0.1` over the owner-test `v1.0.0` is the supported recovery path. The final handoff includes uninstall/reinstall guidance only if the NSIS upgrade behavior requires it.

## Test-driven implementation and review

Implementation uses strict red-green-refactor cycles:

1. Prove Windows-style Git checkout changes protected bytes, then add the minimal LF attributes and prove digest stability.
2. Add failing Windows GUI-subsystem verification tests, then add the release-only Rust subsystem attribute and native release gate.
3. Add failing log-level/favicon packaging tests, then make the smallest logging and frontend-asset changes.
4. Add failing tests for the exact three-platform matrix, verifier inventory, Linux bootstrap rejection, separate pinned tooling checkout, and updated installation contract.
5. Bump every authoritative package/native version to `1.0.1` and prove version synchronization.
6. Run focused tests after each change, then all TypeScript, Rust, contract, example, formatting, lint, type, build, end-to-end, workflow, performance, and accessibility gates.
7. Obtain independent specification and code-quality reviews and resolve every blocking finding.
8. Mark `v1.0.0` as a known-broken prerelease, tag the verified source as `v1.0.1`, run the three native builds, independently verify the completed draft, and publish it as latest.

## Non-goals

- Moving, deleting, or recreating `v1.0.0`
- Weakening runtime resource integrity checks
- Publishing Linux, Windows ARM64, or a macOS universal artifact
- Adding Apple notarization, Developer ID, or Microsoft Authenticode signing
- Adding remote Git operations or changing workflow-authoring behavior
- Splitting these fixes across multiple patch releases
