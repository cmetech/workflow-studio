# Workflow Studio version 1 release acceptance

Status: **PRE-PUBLICATION — the immutable v1.0.7 tag and protected draft passed the native and draft-integrity gates. The draft remains unpublished because manual publication has not been authorized; clean-machine, staged-update, and release-artifact performance evidence remain open follow-up.**

Recorded: 2026-09-02. v1.0.1 is unpublished as a failed draft: its three native builds and payload gates passed, but final metadata normalization failed because the release-by-tag API returned 404 for the draft. Its immutable tag and seven-asset draft remain unchanged as failure evidence. v1.0.2 is unpublished as a failed draft with seven assets: its Windows build failed because default PowerShell expanded an unset positional shell variable instead of the valid release ID environment variable. Its immutable tag, draft, and assets remain unchanged as failure evidence. v1.0.3 is the published recovery release. v1.0.4 is unpublished as a failed empty draft: immutable tag `v1.0.4` points to `b6d7648`, release workflow run `33350871938` was cancelled before platform assets after push CI run `33350865772` failed Quality and E2E, and fixes landed in `83e48ee` and `a0843dd`. v1.0.5 remains unpublished with no release or assets: its immutable annotated tag peels to `0ecb5bd46a49cebe4037825856411d8ead5db17f`, push CI run `33355845811` failed deterministic renderer E2E, and no v1.0.5 release workflow ran. v1.0.6 is the latest published release and the content-aware workbench remediation, published on 2026-08-31. v1.0.7 is the documentation-and-shortcuts release candidate; its immutable annotated tag and verified draft remain unpublished.

## Candidate identity

- Version/tag: `1.0.7` / `v1.0.7`
- Exact tagged commit: `0534d785d6d96df00f9da732bdf3c59c80b1d747`
- Protected Actions run: <https://github.com/cmetech/workflow-studio/actions/runs/33605902987> — completed with `success`
- Draft release: <https://github.com/cmetech/workflow-studio/releases/tag/untagged-8693db71cfbc5ab247be>
- Draft boundary: `draft=true`, `prerelease=false`, `publishedAt=null`
- Published baseline: v1.0.6 remains the latest published release

## Evidence available for the v1.0.7 candidate

| Area | Current evidence | Status |
| --- | --- | --- |
| Candidate source and review | The documentation-and-shortcuts work was merged into `base`, followed by the browser-compatible Space-pan runtime correction. The 38 Space-pan focused tests passed, and a clean review found no remaining Critical or Important finding. | Passed locally |
| Static, bundled-resource, and renderer gates | Format, lint, check, contracts, examples, resources, and build passed on the final candidate tree. | Passed locally |
| Unit coverage without the installer test file | The exact command `npx vitest run --exclude tests/installers/install-script.test.ts --exclude '.worktrees/**'` passed 1,163 tests across 130 files after the final fixes; it excludes the entire Cargo-dependent installer test file. A separate focused run passed 49/49 Cargo-independent installer checks while the 38-test Cargo-backed release-verifier block remained skipped because the local environment has no Cargo executable. | Passed locally with the exact scope and Cargo limitation disclosed |
| Renderer E2E | The full Playwright suite passed 302/302 across Chromium and WebKit after the final fixes. Playwright WebKit is browser-engine evidence, not an installed Tauri/WebView result. | Passed locally |
| Rust and native local verification | Cargo/Rust was unavailable in the local environment, so Rust tests, the release-signature verifier build, and local native packaging were not run there. The protected native workflow ran the Rust and native-build gates on the supported native runners and closes this local environment limitation for the draft. | Passed in protected native workflow; local limitation retained accurately |
| Immutable tag and draft boundary | Annotated tag `v1.0.7` and the draft both resolve to `0534d785d6d96df00f9da732bdf3c59c80b1d747`. Actions run `33605902987` completed successfully, and the release remains `draft=true`, `prerelease=false`, `publishedAt=null`. | Verified; unpublished |
| Native matrix and package payloads | All three native jobs—macOS aarch64, macOS x86_64, and Windows x86_64—passed. Each ran the application, Rust, bundled authoring-contract, and example gates before packaging; extracted DMG/NSIS payload verification also passed. | Passed in protected workflow |
| Aggregate draft verification | The final aggregate job passed the exact 10-asset inventory, normalized `latest.json`, updater-signature verification, and `SHA256SUMS` generation plus re-download validation. | Passed in protected workflow |
| Independent controller download | A separate controller download verified all 9 `SHA256SUMS` entries. The downloaded `latest.json` version `1.0.7` contains exactly six expected macOS/Windows updater aliases—`darwin-aarch64`, `darwin-aarch64-app`, `darwin-x86_64`, `darwin-x86_64-app`, `windows-x86_64`, and `windows-x86_64-nsis`—and every entry has a non-empty signature. | Passed independently against draft bytes |
| Installed-app follow-up | macOS Apple Silicon, macOS Intel, and Windows installed-app acceptance remain open. Windows installed-app validation was not performed; staged signed-update and 250-node/500-edge reference-machine evidence also remain open. | Post-publication follow-up open |

## Pre-publication decision

- [x] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures were verified from downloaded draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [ ] Release approved for manual publication.

Decision owner/date: Open. The user has not authorized publication, so the verified draft must remain unpublished.

## Required post-publication follow-up

- [ ] Install on clean macOS Apple Silicon and Intel machines through the documented unsigned Gatekeeper path and record every acceptance-template behavior.
- [ ] Install on a clean Windows x64 machine through the documented SmartScreen path and record every acceptance-template behavior. Windows CI bundle success is not a substitute for this installed-app check.
- [ ] From each installed application, exercise a staged signed update through download, verification, installation, relaunch, and version confirmation.
- [ ] Repeat the 250-node/500-edge interaction acceptance on release artifacts and reference machines for each supported operating system.

Linux packaging and clean-machine evidence remain deferred until a later reviewed release-scope amendment. Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication. Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.
