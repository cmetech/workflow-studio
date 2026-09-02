# Workflow Studio version 1 release acceptance

Status: **PRE-RELEASE — v1.0.7 metadata is prepared; no v1.0.7 tag or release exists, and native draft/artifacts plus clean-machine evidence remain open.**

Recorded: 2026-09-02. v1.0.1 is unpublished as a failed draft: its three native builds and payload gates passed, but final metadata normalization failed because the release-by-tag API returned 404 for the draft. Its immutable tag and seven-asset draft remain unchanged as failure evidence. v1.0.2 is unpublished as a failed draft with seven assets: its Windows build failed because default PowerShell expanded an unset positional shell variable instead of the valid release ID environment variable. Its immutable tag, draft, and assets remain unchanged as failure evidence. v1.0.3 is the published recovery release. v1.0.4 is unpublished as a failed empty draft: immutable tag `v1.0.4` points to `b6d7648`, release workflow run `33350871938` was cancelled before platform assets after push CI run `33350865772` failed Quality and E2E, and fixes landed in `83e48ee` and `a0843dd`. v1.0.5 remains unpublished with no release or assets: its immutable annotated tag peels to `0ecb5bd46a49cebe4037825856411d8ead5db17f`, push CI run `33355845811` failed deterministic renderer E2E, and no v1.0.5 release workflow ran. v1.0.6 is the latest published release and the content-aware workbench remediation, published on 2026-08-31. v1.0.7 is the documentation-and-shortcuts release candidate and uses the same fail-closed draft-release process.

## Evidence available for the v1.0.7 candidate

| Area | Current evidence | Status |
| --- | --- | --- |
| Candidate source and review | The documentation-and-shortcuts work was merged into `base`, followed by the browser-compatible Space-pan runtime correction. The 38 Space-pan focused tests passed, and a clean review found no remaining Critical or Important finding. | Passed locally |
| Static, bundled-resource, and renderer gates | Format, lint, check, contracts, examples, resources, and build passed on the final candidate tree. | Passed locally |
| Non-Cargo unit coverage | 1,162 non-Cargo unit tests passed after the final fixes. The Cargo-backed release-signature-verifier block is excluded from this count because the local environment has no Cargo executable. | Passed locally with the disclosed Cargo exclusion |
| Renderer E2E | The full Playwright suite passed 302/302 across Chromium and WebKit after the final fixes. Playwright WebKit is browser-engine evidence, not an installed Tauri/WebView result. | Passed locally |
| Rust and native local verification | Cargo/Rust was unavailable in the local environment, so Rust tests, the release-signature verifier build, and local native packaging were not run. | Environment limitation; protected native verification required |
| Published release state | v1.0.6 remains the latest published release. As of 2026-09-02, no v1.0.7 tag or release exists. | Published baseline confirmed; candidate remains untagged |
| Packaging | The protected release workflow has not run for v1.0.7, so the native draft, signed updater artifacts, extracted package-payload evidence, checksums, and exact ten-asset inventory remain open. | Native draft/artifacts gate open |
| Installed-app follow-up | macOS Apple Silicon, macOS Intel, and Windows installed-app acceptance remain open. Windows installed-app validation was not performed; staged signed-update and 250-node/500-edge reference-machine evidence also remain open. | Post-publication follow-up open |

## Required draft verification and installed-app follow-up

These gates cannot be satisfied by browser fixtures, local non-Cargo checks, or the renderer build:

1. Push the fully reviewed and verified v1.0.7 release commit to `origin/base`, then create one immutable annotated `v1.0.7` tag from that exact commit. Do not move or delete earlier tags.
2. Run the protected draft-only release workflow and verify the actual three-target artifacts, extracted package payloads, exact ten-asset inventory, `SHA256SUMS`, updater metadata, companion signatures, and first-party Minisign verification job before publication.
3. Keep the release unpublished unless every native build, Rust suite, package-payload gate, updater target, checksum, and signature passes. The workflow must create and verify a draft only; publication remains a separate manual decision.
4. After publication, install on clean macOS Apple Silicon and Intel machines through the documented unsigned Gatekeeper path and record all acceptance-template behaviors.
5. After publication, install on a clean Windows x64 machine through the documented SmartScreen path and record all acceptance-template behaviors. Windows CI bundle success is not a substitute for this installed-app check.
6. From each installed application, exercise a staged signed update through download, verification, installation, relaunch, and version confirmation.
7. Repeat the 250-node/500-edge interaction acceptance on release artifacts and reference machines for each supported operating system.

Linux packaging and clean-machine evidence remain deferred until a later reviewed release-scope amendment. Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication. Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.
