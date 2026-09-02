# Releasing Workflow Studio

Releases are native, updater-signed, and manually published. The GitHub Actions workflow creates and verifies a **draft** only. Never publish a release from this workflow automatically.

## Preconditions and tag invariant

1. Begin with a clean checkout on `base` and pull the intended public repository state.
2. Set the same semantic version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
3. Complete the v1.0.7 local verification record and prepare the macOS/Windows clean-machine acceptance record for post-publication follow-up.
4. Create an annotated `v1.0.7` tag on a commit contained in `origin/base`, then push that exact tag.

Manual workflow dispatch accepts only an existing version tag. The workflow resolves the tag to a commit, confirms it is an ancestor of `origin/base`, and confirms the tag matches the Tauri configuration. Branch names, arbitrary SHAs, invalid tags, and previously published releases are rejected.

## Native build matrix

| Runner | Target | Bundle |
|---|---|---|
| `macos-latest` | `aarch64-apple-darwin` | DMG plus updater archive/signature |
| `macos-15-intel` | `x86_64-apple-darwin` | DMG plus updater archive/signature |
| `windows-latest` | `x86_64-pc-windows-msvc` | NSIS executable plus its updater signature |

These are the exact three v1.0.7 targets; Linux and Windows ARM64 artifacts are deferred. Every native job uses `npm ci` and runs the same formatting, lint, Svelte check, TypeScript unit-test, Rust-test, authoring-contract, and example gates as `npm run verify` before Tauri builds. Release CI runs Vitest with one worker to prevent cross-file CPU contention from starving UI timing assertions on slower native runners, and gives the recovery storage-limit test 20 seconds because it intentionally serializes nearly 64 MiB. These settings change only scheduling and timeout allowances, not assertions or coverage. The operating-system artifacts are deliberately unsigned: there is no Apple notarization/Developer ID or Microsoft Authenticode identity in the workflow.

The release Tauri configuration uses native Tauri v2 updater artifacts with `createUpdaterArtifacts: true`. Each macOS build requests both `app,dmg`, producing a DMG plus an app updater archive and signature. On Windows the NSIS installer is also the updater artifact, so the two Windows updater aliases share `LOOP24-Workflow-Studio_<version>_windows_x86_64-setup.exe` and its `.exe.sig` companion. The legacy `.nsis.zip` shape is rejected. The completed draft contains exactly 10 assets, and `SHA256SUMS` contains exactly nine entries for every other asset.

## Recovery history

v1.0.1 remains unpublished as a failed draft after its final metadata-normalization job used GitHub's release-by-tag endpoint, which returns 404 for drafts; its immutable tag and draft are retained as failure evidence. v1.0.2 remains unpublished as a failed draft with seven assets after its Windows build used a positional shell variable in the default PowerShell shell; its immutable tag, draft, and assets are retained as failure evidence. v1.0.3 is the published recovery release. v1.0.4 remains unpublished as a failed empty draft: immutable tag `v1.0.4` points to `b6d7648`, its release workflow run `33350871938` was cancelled before platform assets after push CI run `33350865772` failed the Quality and E2E gates on selection loss and a 300 ms persistence-echo long task. The fixes landed in `83e48ee` and `a0843dd`. v1.0.5 remains unpublished with no release or assets: its immutable annotated tag peels to `0ecb5bd46a49cebe4037825856411d8ead5db17f`, push CI run `33355845811` failed deterministic renderer E2E, and no v1.0.5 release workflow ran. v1.0.6 is the latest published release and the content-aware workbench remediation, published on 2026-08-31. v1.0.7 is the documentation-and-shortcuts release candidate; no v1.0.7 tag or release exists as of 2026-09-02. Its first release-workflow run must begin with no v1.0.7 release, while later safe retries may reuse only one exact empty, non-prerelease draft with the expected commit. Validation reads the numeric release ID from the step environment on every shell. If no v1.0.7 release exists, it confirms complete absence, creates one draft, and validates the REST POST response directly so GitHub's eventually consistent release list cannot invalidate a successful creation.

## v1.0.7 candidate evidence

The current local record has format, lint, check, contracts, examples, resources, and build passing. The exact command `npx vitest run --exclude tests/installers/install-script.test.ts --exclude '.worktrees/**'` passed 1,163 tests across 130 files; it excludes the entire Cargo-dependent installer test file. A separate focused run passed 49/49 Cargo-independent installer checks while the 38-test Cargo-backed release-verifier block remained skipped. The full Playwright suite passed 302/302 across Chromium and WebKit after the final fixes. The Space-pan correction has 38 focused tests passing and a clean review. Cargo/Rust was unavailable in the local environment, so local Rust tests and native packaging were not run. The protected native draft, signed updater artifacts, exact release inventory, and macOS/Windows clean-machine evidence remain open.

## Updater-key custody

Tauri updater signing is an integrity control and is distinct from third-party operating-system publisher signing. GitHub Actions reads only these repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Keep the private key and its password in the repository secrets and a maintainer-controlled offline recovery system. Never write them into the repository, workflow artifacts, logs, release notes, issues, or chat. Only the public key belongs in `src-tauri/tauri.conf.json`.

For rotation, generate a new key outside the repository, update the two secrets, commit the new public key in a normal reviewed change, ship an intermediate app capable of trusting the intended rotation path, and test a staged update before retiring the old key. Losing the private key means existing installations cannot verify releases under an uncoordinated replacement.

## Draft verification and publication

The release workflow is dispatched from `base`, resolves the tag once, and uses that immutable application commit for every package build. It separately checks out the immutable `base` tooling commit without persisted credentials, re-resolves the remote tag before release operations, and stops if the tag moved. The pinned release resolver lists all releases with authenticated pagination, treats tags only as child-process data, and fails closed unless its `absent` or `exact-draft` contract is satisfied. Validation first reuses one exact empty draft only when its tag and commit match and `draft` is true while `prerelease` is false. When no matching release exists, validation confirms the tag is still absent, creates exactly one draft through the REST API, validates the POST response directly against the same invariants, and exports its positive numeric release ID without depending on an immediate list refresh. Every later Tauri Action or REST mutation uses only that ID. Exact-draft reads must still match the original ID and validate every asset ID and safe unique basename before any download, deletion, or filesystem path is constructed. Before accepting each package, the workflow extracts the DMG or NSIS payload and verifies its exact bundled resource tree against the tagged integrity manifest. Its final job:

1. authenticates to GitHub and resolves the exact draft by tag, commit SHA, and the validation job's numeric release ID;
2. downloads every asset by its authenticated release-asset ID;
3. normalizes updater URLs to the exact public tag and uploads `latest.json`;
4. re-downloads the published `latest.json` bytes before hashing;
5. rejects empty, Linux, unknown, duplicate, ambiguous, unsafe, or cross-release assets and verifies exactly the two macOS and one Windows updater targets/signatures;
6. generates `SHA256SUMS` over only the re-downloaded public bytes and uploads it; and
7. re-downloads and validates the completed draft while leaving publication manual.

Review the workflow logs, `latest.json`, artifact names and byte sizes, `SHA256SUMS`, and contract/example results. Download a clean copy of every artifact and independently compare its digest before using GitHub’s release UI to publish the draft manually. Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication. Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.

If any package-payload gate, native job, updater target, checksum, or signature is absent, keep the draft unpublished. Clean-machine macOS/Windows acceptance remains required follow-up evidence, but does not replace or weaken this publication gate. Never remove a target from verification simply to make a release green.

## After release work

Confirm the published `latest.json` and installer links resolve, then return the development checkout to `base`. Delete temporary keys/downloads using exact paths, retain the acceptance evidence, and start subsequent implementation branches from the updated `base`. Do not leave release work on the feature checkout.
