# Workflow Studio v1.0.1 Stabilization Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task, superpowers:test-driven-development for every behavior change, and superpowers:verification-before-completion before any completion claim.

**Goal:** Publish v1.0.1 for automatic installation on Windows x64 and macOS Apple Silicon/Intel, fixing packaged resource verification, the Windows console window, release logging, and favicon behavior while enforcing the approved three-target release contract.

**Architecture:** Application bytes are built only from immutable tag `v1.0.1`; a separate credential-free checkout pinned to the manually dispatched `base` commit supplies release verification tooling. The versioned setup-integrity manifest remains authoritative for the exact bundled offline resource tree. The release workflow verifies extracted DMG/NSIS payloads before a draft can be published, then verifies the exact final release inventory and updater signatures.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Rust, Tauri 2, GitHub Actions, Node.js release tooling, PowerShell, POSIX shell.

---

## Task 1: Make bundled resource bytes checkout-stable and independently verifiable

**Files:**

- Create: `.gitattributes`
- Create: `tests/installers/release-package.test.ts`
- Modify: `scripts/verify-release-assets.mjs`
- Modify: `package.json`

### Step 1: Write failing packaged-resource tests

Add tests that construct a temporary resource root from the real integrity manifest and prove:

- the exact 30-file tree passes;
- an LF-to-CRLF byte transformation fails its digest;
- missing, extra, symlinked, oversized, and non-regular entries fail;
- a real temporary Git repository cloned with `core.autocrlf=true` preserves all protected resources and passes verification.

The checkout regression must copy the real `brands/`, `contracts/`, `examples/`, and `src-tauri/resources/setup-integrity-v1.json`, commit them with `core.autocrlf=false`, clone with `git -c core.autocrlf=true`, and call the exported verifier against the clone.

### Step 2: Run the focused test and confirm RED

Run:

```bash
npm run test:unit -- tests/installers/release-package.test.ts
```

Expected failure: packaged-resource verification is not exported and the autocrlf clone changes protected bytes.

### Step 3: Add the LF checkout contract

Create `.gitattributes` with:

```gitattributes
/brands/** text=auto eol=lf
/contracts/** text=auto eol=lf
/examples/** text=auto eol=lf
/src-tauri/resources/*.json text=auto eol=lf
```

### Step 4: Implement the smallest packaged-resource verifier

In `scripts/verify-release-assets.mjs` export a function that:

- accepts a packaged resource root plus integrity-manifest path;
- accepts only manifest schema version 1 and the existing exact 30-entry inventory;
- hashes raw bytes without newline normalization;
- checks each `sha256` and `maxBytes` value;
- rejects missing, extra, duplicate, symlinked, and non-regular files;
- returns `{ verifiedFiles: 30 }` on success.

Add a CLI mode:

```text
--packaged-resource-root ROOT --integrity-manifest MANIFEST [--pe-executable FILE]
```

The PE option is implemented in Task 2; resource-only mode remains valid for source and macOS checks.

Add this package script:

```json
"resources:verify": "node scripts/verify-release-assets.mjs --packaged-resource-root . --integrity-manifest src-tauri/resources/setup-integrity-v1.json"
```

### Step 5: Run GREEN and regression checks

Run:

```bash
npm run test:unit -- tests/installers/release-package.test.ts
npm run resources:verify
npm run lint -- --quiet
```

Expected: all pass and the resource verifier reports exactly 30 verified files.

### Step 6: Commit

```bash
git add .gitattributes package.json scripts/verify-release-assets.mjs tests/installers/release-package.test.ts
git commit -m "fix: verify byte-stable packaged resources"
```

## Task 2: Make Windows a GUI application and stabilize release diagnostics

**Files:**

- Modify: `tests/installers/release-package.test.ts`
- Modify: `scripts/verify-release-assets.mjs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/logging.rs`
- Create: `public/favicon.ico` by copying the existing LOOP24 `src-tauri/icons/icon.ico`
- Modify: `index.html`
- Modify: applicable Rust tests adjacent to `src-tauri/src/lib.rs`

### Step 1: Write failing PE and runtime tests

Add tests that synthesize minimal PE headers and prove:

- AMD64 plus `IMAGE_SUBSYSTEM_WINDOWS_GUI` (`2`) passes;
- console subsystem (`3`), x86/ARM machine types, bad DOS/PE signatures, out-of-bounds `e_lfanew`, and truncation fail;
- `--pe-executable` triggers both the PE gate and packaged-resource gate.

Add Rust tests for an environment-independent logging configuration helper. Debug builds must use `Debug` with stdout and log-directory targets; release builds must use `Info` with the log-directory target only. Add source-contract assertions for the Windows GUI subsystem attribute and explicit favicon link.

### Step 2: Run tests and confirm RED

Run:

```bash
npm run test:unit -- tests/installers/release-package.test.ts
npm run test:rust
```

Expected failure: PE validation, GUI subsystem configuration, and release log selection are absent.

### Step 3: Implement PE validation

Parse the executable directly in `scripts/verify-release-assets.mjs`:

- require DOS magic `MZ`;
- read a bounded little-endian `e_lfanew`;
- require `PE\0\0`;
- require AMD64 machine `0x8664`;
- accept valid PE32 or PE32+ optional headers;
- require subsystem `2` and reject subsystem `3`.

Require the executable to be a regular non-symlink file.

### Step 4: Configure native runtime behavior

Add as the first crate attribute in `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
```

In a small feature-owned logging module used by `src-tauri/src/lib.rs`, select log level and targets with a testable `configuration(debug_build: bool)` helper. Its core level choice is:

```rust
fn native_log_level() -> tauri_plugin_log::log::LevelFilter {
    if cfg!(debug_assertions) {
        tauri_plugin_log::log::LevelFilter::Debug
    } else {
        tauri_plugin_log::log::LevelFilter::Info
    }
}
```

Apply the level and targets explicitly to the log plugin so release builds do not emit DEBUG routing noise or target stdout. Debug builds retain both stdout and log-directory output.

### Step 5: Add the explicit favicon

Copy the existing LOOP24 native icon byte-for-byte from `src-tauri/icons/icon.ico` to `public/favicon.ico` and add to `index.html`:

```html
<link rel="icon" href="/favicon.ico" type="image/x-icon" />
```

Build and assert the emitted asset exists:

```bash
npm run build
test -s dist/favicon.ico
```

### Step 6: Run GREEN and commit

Run:

```bash
npm run test:unit -- tests/installers/release-package.test.ts
npm run test:rust
npm run build
```

Then commit:

```bash
git add index.html public/favicon.ico scripts/verify-release-assets.mjs src-tauri/src/main.rs src-tauri/src/lib.rs src-tauri/src/logging.rs tests/installers/release-package.test.ts
git commit -m "fix: stabilize packaged Windows runtime"
```

## Task 3: Enforce the exact macOS/Windows release inventory and bootstrap scope

**Files:**

- Modify: `tests/installers/install-script.test.ts`
- Modify: `tests/fixtures/releases/valid-manifest.json`
- Modify: `scripts/verify-release-assets.mjs`
- Modify: `scripts/install.sh`
- Modify: any audited installer hash allowlist referenced by tests

### Step 1: Change fixture and tests first

Set the valid fixture to `v1.0.1` and exactly 11 public assets:

- three installers: two DMGs and one Windows setup EXE;
- three updater archives;
- three updater `.sig` companions;
- `latest.json`;
- `SHA256SUMS`.

Require exactly ten checksum lines. Require exactly these six updater keys:

```text
darwin-aarch64
darwin-aarch64-app
darwin-x86_64
darwin-x86_64-app
windows-x86_64
windows-x86_64-nsis
```

Update installer tests so supported targets are exactly `darwin-aarch64`, `darwin-x86_64`, and `windows-x86_64`. Add failures for Linux targets, Linux updater keys/assets, stale AppImage/deb/rpm files, and unknown files.

Add a shell test using a sentinel fake `curl` to prove Linux exits unsupported before any network call.

### Step 2: Run tests and confirm RED

```bash
npm run test:unit -- tests/installers/install-script.test.ts
```

Expected: current four-platform inventory and Linux shell path violate the new assertions.

### Step 3: Narrow release verifier and shell bootstrap

Remove Linux from verifier target tables and updater aliases. Perform exact inventory validation before normalization or checksum generation. Reject stale and unknown artifacts, including AppImage, deb, and rpm files.

Change `scripts/install.sh` to reject Linux immediately with a clear macOS-only message, before invoking curl or downloading release metadata. Keep macOS Apple Silicon and Intel selection unchanged.

If installer integrity tests pin the shell script hash, calculate the new digest with:

```bash
shasum -a 256 scripts/install.sh
```

and update the audited allowlist only after reviewing the script diff.

### Step 4: Run GREEN and commit

```bash
npm run test:unit -- tests/installers/install-script.test.ts
node scripts/verify-release-assets.mjs --fixture tests/fixtures/releases/valid-manifest.json
```

Then:

```bash
git add scripts/install.sh scripts/verify-release-assets.mjs tests/installers/install-script.test.ts tests/fixtures/releases/valid-manifest.json
git commit -m "fix: enforce supported release inventory"
```

## Task 4: Pin the release boundary and verify actual DMG/NSIS payloads

**Files:**

- Modify: `tests/installers/install-script.test.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/verify-release-assets.mjs`

### Step 1: Write failing workflow-contract tests

Assert the workflow:

- is dispatch-only with required `tag` input;
- rejects dispatch unless `github.ref` is `refs/heads/base`;
- resolves the application commit from the immutable tag;
- emits `${{ github.sha }}` as `tooling_commit` and verifies it belongs to `base`;
- uses separate credential-free application and `.release-tooling` checkouts;
- runs tooling only from `.release-tooling` while application config, manifest, Rust verifier, tests, and build stay rooted in tagged source;
- has exactly three serialized matrix entries: macOS ARM DMG, macOS Intel DMG, Windows x64 NSIS;
- contains post-build extracted package gates for every target;
- retains normalize, upload, re-download, signature/checksum, final-download, and exact-final-validation ordering.

### Step 2: Run and confirm RED

```bash
npm run test:unit -- tests/installers/install-script.test.ts
```

Expected: tag-push triggering, Linux matrix entry, single checkout, and absent package gates fail.

### Step 3: Implement immutable source/tooling checkouts

Make `.github/workflows/release.yml` dispatch-only. Validate a semantic `v*` tag, resolve it to one application commit, and refuse a non-`base` dispatch. Record application and tooling commits in the job summary.

In every relevant job:

- checkout the validated application commit at repository root;
- checkout `needs.validate.outputs.tooling_commit` into `.release-tooling`;
- use `persist-credentials: false` and `fetch-depth: 0`;
- call `node .release-tooling/scripts/verify-release-assets.mjs ...`;
- never copy tooling over tagged application files.

### Step 4: Implement the exact matrix

Use `max-parallel: 1` and only:

```text
macos-latest   macos   aarch64   aarch64-apple-darwin       dmg
macos-15-intel macos   x86_64   x86_64-apple-darwin        dmg
windows-latest windows x86_64   x86_64-pc-windows-msvc    nsis
```

Remove Linux build dependencies from the build matrix. Ubuntu dependencies may remain only where needed to compile the tagged Rust signature verifier in the final verification job.

### Step 5: Verify real packages before accepting the build

After the Tauri build action:

- macOS: resolve exactly one DMG, mount read-only, resolve exactly one `.app`, verify `Contents/Resources/_up_` against the tagged manifest, and always detach;
- Windows: resolve exactly one NSIS setup executable, extract to a fresh runner-temp directory with 7-Zip, resolve exactly one `_up_` root and application executable, and run both resource and PE checks.

Fail ambiguous or missing matches. Keep the release in draft until all build and final verifier jobs pass.

### Step 6: Run GREEN, validate YAML, and commit

```bash
npm run test:unit -- tests/installers/install-script.test.ts
npx prettier --check .github/workflows/release.yml scripts/verify-release-assets.mjs tests/installers
npx eslint scripts/verify-release-assets.mjs tests/installers
actionlint .github/workflows/release.yml
```

If `actionlint` is not installed, install it through Homebrew and rerun; do not skip the check.

Commit:

```bash
git add .github/workflows/release.yml scripts/verify-release-assets.mjs tests/installers/install-script.test.ts
git commit -m "ci: harden three-target release pipeline"
```

## Task 5: Version and document v1.0.1 automatic installation

**Files:**

- Modify: `tests/project/release-version.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `docs/installing.md`
- Modify: `docs/releasing.md`
- Modify: `docs/security.md`
- Modify: applicable acceptance/release documentation found by `rg -n '1\.0\.0|Linux|AppImage|\.deb|\.rpm|signing|notar' docs README.md`

### Step 1: Write the failing version and documentation assertions

Change release-version expectations to `1.0.1`. Add assertions that installation documentation:

- gives the exact Windows `irm | iex` command;
- gives a copy-safe macOS curl bootstrap command;
- states the app is not code-signed/notarized and explains the expected OS warning;
- states Linux is deferred and unsupported by the bootstrap;
- does not claim v1.0.0 is the supported release.

### Step 2: Run and confirm RED

```bash
npm run test:unit -- tests/project/release-version.test.ts tests/installers/install-script.test.ts
```

### Step 3: Bump every product version

Run:

```bash
npm version 1.0.1 --no-git-tag-version
```

Then update `src-tauri/Cargo.toml`, regenerate `src-tauri/Cargo.lock`, and update `src-tauri/tauri.conf.json` so all tested version surfaces are exactly `1.0.1`.

### Step 4: Update operator and user documentation

Document Windows installation exactly as:

```powershell
iex (irm 'https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.1/scripts/install.ps1')
```

Document macOS installation with a single-line `curl -fsSL .../v1.0.1/scripts/install.sh | sh` command. Explain that scripts select the correct CPU installer, verify checksums, and install automatically; unsigned/not-notarized OS warnings are expected. Remove Linux installation instructions and clearly label Linux deferred.

Update releasing/security/acceptance wording to the exact three-target contract and package-payload verification gate.

### Step 5: Run GREEN and commit

```bash
npm run test:unit -- tests/project/release-version.test.ts tests/installers/install-script.test.ts
npm run test:rust
npm run contracts:check
git diff --check
```

Then:

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json docs tests/project/release-version.test.ts
git commit -m "release: prepare Workflow Studio v1.0.1"
```

## Task 6: Complete local verification and two-stage review

**Files:**

- Modify only files required by verified review findings

### Step 1: Run the full clean local gate

```bash
npm ci
npm audit --audit-level=high
npm run format:check
npm run lint
npm run check
npm run test:unit -- --testTimeout=20000 --maxWorkers=1
npm run test:rust
npm run contracts:check
npm run examples:check
npm run resources:verify
npm run build
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

Every command must pass. Fix failures with a new red-green cycle and an atomic commit; never weaken a verifier to make a package pass.

### Step 2: Verify a local macOS bundle payload

Build the local macOS application bundle and verify its emitted resource bytes:

```bash
npm run tauri -- build --config src-tauri/tauri.ci.conf.json --bundles app
APP_RESOURCE_ROOT="src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app/Contents/Resources/_up_"
node scripts/verify-release-assets.mjs --packaged-resource-root "$APP_RESOURCE_ROOT" --integrity-manifest src-tauri/resources/setup-integrity-v1.json
```

Require the verifier to report exactly 30 files. If Tauri emits a different app path, resolve exactly one `.app` below `src-tauri/target/release/bundle/macos` and fail if zero or multiple bundles exist.

### Step 3: Run independent specification review

Dispatch a fresh review subagent with the approved design spec, this plan, and the complete v1.0.1 commit range. Require it to report missing requirements or return approval. Address every valid finding with strict TDD and rerun affected/full gates.

### Step 4: Run independent code-quality review

Dispatch a different fresh review subagent to inspect security, correctness, portability, release-workflow trust boundaries, installer behavior, and test quality. Address every valid finding with strict TDD and rerun affected/full gates.

### Step 5: Final verification commit if needed

If review fixes were required, commit each coherent fix atomically. Confirm `git status --short` is empty and rerun the complete Step 1 gate after the last fix.

## Task 7: Publish and independently verify v1.0.1

**Files:**

- GitHub release metadata and immutable Git refs only; no source edits after tagging

### Step 1: Mark v1.0.0 as an owner-test prerelease

Inspect current metadata, then edit it without replacing its immutable tag or assets:

```bash
gh release view v1.0.0 --json tagName,isDraft,isPrerelease,name,url
gh release edit v1.0.0 --prerelease --title "Workflow Studio v1.0.0 owner test" --notes "Owner-test build retained for audit history. Known issue: Windows checkout newline conversion can cause bundled resource verification to fail. Install v1.0.1 instead."
```

### Step 2: Push reviewed base and create the immutable tag

```bash
git status --short --branch
git push origin base
git tag -a v1.0.1 -m "Workflow Studio v1.0.1"
git push origin v1.0.1
```

Resolve local and remote tag commits and require exact equality before dispatch.

### Step 3: Dispatch from base and monitor every job

```bash
gh workflow run release.yml --ref base -f tag=v1.0.1
```

Capture the run ID. Monitor validation, all three serialized build jobs, and final verification until conclusion. If a job fails, diagnose from logs, fix through TDD on `base`, create a new patch tag rather than moving `v1.0.1`, and report the version adjustment.

### Step 4: Independently verify the completed draft

Use a fresh directory:

```bash
RELEASE_VERIFY_DIR=$(mktemp -d)
gh release download v1.0.1 --dir "$RELEASE_VERIFY_DIR"
cargo build --manifest-path src-tauri/Cargo.toml --example verify_release_signature
node scripts/verify-release-assets.mjs --directory "$RELEASE_VERIFY_DIR" --tag v1.0.1 --tauri-config src-tauri/tauri.conf.json --signature-verifier src-tauri/target/debug/examples/verify_release_signature
```

Require exact application identity (`LOOP24 Workflow Studio`, `com.cmetech.workflowstudio`, version `1.0.1`), exactly 11 release assets, exactly ten checksum entries, valid URL mappings, and valid signatures for the three unique updater archives.

### Step 5: Publish and validate public bootstrap endpoints

Only after Step 4 passes:

```bash
gh release edit v1.0.1 --draft=false --latest
gh release view v1.0.1 --json tagName,isDraft,isPrerelease,name,url,assets
curl -fsSL https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.1/scripts/install.sh >/dev/null
curl -fsSL https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.1/scripts/install.ps1 >/dev/null
```

Confirm v1.0.1 is latest, non-draft, non-prerelease, and exposes exactly the independently verified inventory.

### Step 6: Report the release and install commands

Provide the release URL, workflow run URL, verification results, known unsigned/not-notarized warning, and these commands:

```powershell
iex (irm 'https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.1/scripts/install.ps1')
```

```bash
curl -fsSL https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.1/scripts/install.sh | sh
```
