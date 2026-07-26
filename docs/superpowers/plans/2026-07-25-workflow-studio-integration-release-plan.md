# Workflow Studio Integration and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete version one with safe local Git, runtime brand/theme packs, graphical first-launch and updater flows, native packaging, one-command downloaders, and cross-platform release evidence.

**Architecture:** Rust invokes the installed Git executable with exact argument arrays and owns filesystem-sensitive branding/update operations. Shared Svelte progress surfaces render first-launch and update state. GitHub Releases hosts native artifacts and Tauri updater metadata; native CI runners build each target.

**Tech Stack:** Tauri updater/process/log plugins, Rust `std::process::Command`, Git CLI, Svelte, DOMPurify, Playwright, GitHub Actions, NSIS, DMG, AppImage, optional Debian packages.

## Global constraints

- Complete the Native Foundation, YAML/Workspace, and Visual Authoring plans first.
- Git is local-only: no remotes, credentials, network commands, branch mutation, merge, rebase, reset, or automatic commits.
- Never invoke Git through a shell. Use exact argument arrays, `--literal-pathspecs`, `--`, bounded output, and the detected repository root.
- Pair-only commits must preserve unrelated staged, unstaged, and untracked work.
- Runtime branding is data-only and cannot execute CSS, JavaScript, external SVG resources, or remote URLs.
- Installed executable/installer icons remain build-time LOOP24 identity.
- First-launch/setup stages must represent real work; do not display fake progress.
- Operating-system binaries remain unsigned. Tauri update artifacts and metadata must be signed with the updater key.
- Updater checks must never block offline authoring.
- Do not publish telemetry or analytics.
- Package on native macOS, Windows, and Linux runners; do not claim literal one-host cross-compilation.

---

### Task 1: Implement read-only local Git detection, status, diff, and history

**Files:**
- Create: `src-tauri/src/git/mod.rs`
- Create: `src-tauri/src/git/runner.rs`
- Create: `src-tauri/src/git/parse.rs`
- Create: `src-tauri/src/git/tests.rs`
- Create: `src/lib/git/types.ts`
- Create: `src/lib/git/git-api.ts`
- Create: `src/lib/git/git-api.test.ts`
- Create: `src/features/version-control/GitView.svelte`
- Create: `src/features/version-control/GitView.test.ts`
- Create: `src/features/version-control/DiffView.svelte`
- Create: `src/features/version-control/HistoryView.svelte`
- Create: `src/stores/git.ts`
- Modify: `src/lib/native/types.ts`
- Modify: `src/lib/native/tauri-bridge.ts`
- Modify: `src/lib/native/browser-bridge.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src/app/StatusBar.svelte`
- Modify: `src/app/App.svelte`

**Interfaces:**
- Consumes: selected workspace root and active workflow relative paths.
- Produces: Rust commands `git_detect`, `git_status`, `git_diff_pair`, `git_history_pair`, `git_show_pair`; TypeScript `GitRepository`, `GitStatus`, `GitDiff`, `GitCommitSummary`, and Git activity UI.

- [ ] **Step 1: Add the process-timeout dependency and define bounded Git result types**

Add `wait-timeout = "0.2.1"` to the native crate. The runner uses concurrent bounded stdout/stderr readers so a noisy process cannot deadlock while the parent waits.

Use structured shapes rather than raw command strings:

```ts
export interface GitRepository {
  root: string
  branch: string | null
  detachedHead: string | null
}

export interface GitPathStatus {
  path: string
  originalPath?: string
  index: string
  worktree: string
  untracked: boolean
}
```

Rust tests parse porcelain v2 NUL-delimited output for spaces, tabs, Unicode, renames, untracked files, staged-only changes, detached HEAD, and no-repository. Diff/history output over 5 MiB returns `git_output_too_large` rather than truncating into misleading YAML.

- [ ] **Step 2: Run Git parser tests to verify failure**

Run:

```bash
npm run test:rust -- git
npm run test:unit -- src/lib/git/git-api.test.ts
```

Expected: FAIL because Git modules are absent.

- [ ] **Step 3: Implement the safe runner**

Resolve Git with `Command::new("git")`; do not search or bundle alternate executables. Use global arguments `--literal-pathspecs` and `-C <root>`. Set `GIT_PAGER=cat`, `GIT_TERMINAL_PROMPT=0`, and `LC_ALL=C`. Clear editor variables for noninteractive read commands. Apply a 10-second timeout to read operations and a 120-second timeout to commit/hook operations, with bounded stdout/stderr capture and child termination on timeout.

Allowed read subcommands are a closed enum, not arbitrary renderer arguments:

- `rev-parse --show-toplevel`
- `symbolic-ref --quiet --short HEAD`
- `rev-parse --short=12 HEAD`
- `status --porcelain=v2 -z --untracked-files=all`
- `diff --no-ext-diff --no-color -- definition-path companion-path`
- `diff --cached --no-ext-diff --no-color -- definition-path companion-path`
- `log` with a fixed NUL-safe format and exact path
- `show <validated-oid>:<validated-relative-path>`

Validate object IDs as 7-64 lowercase/uppercase hex before `show`.

- [ ] **Step 4: Test against real temporary repositories**

Create Rust integration fixtures using `tempfile` and actual `git init`. Configure identity locally in the fixture. Assert no-repository, normal branch, detached HEAD, pair rename, definition/companion history merge, and unrelated status.

- [ ] **Step 5: Implement renderer API and Git view**

The activity view displays branch/detached state, workflow-pair status, working/index diffs, and merged chronological history for either pair path. Selecting a commit previews exact definition/companion content read-only. External Git changes refresh through the existing workspace watcher without polling during drag.

- [ ] **Step 6: Verify Git inspection**

Run:

```bash
npm run test:rust
npm run test:unit -- src/lib/git src/features/version-control
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/git src-tauri/src/lib.rs src/lib/git src/features/version-control src/stores/git.ts src/lib/native src/app/StatusBar.svelte src/app/App.svelte
git commit -m "feat: inspect local workflow git history"
```

---

### Task 2: Add explicit Git initialization and pair-only versions

**Files:**
- Create: `src-tauri/src/git/mutate.rs`
- Create: `src-tauri/tests/git_integration.rs`
- Create: `src/features/version-control/CreateVersionDialog.svelte`
- Create: `src/features/version-control/CreateVersionDialog.test.ts`
- Create: `src/features/version-control/InitializeRepositoryDialog.svelte`
- Create: `src/features/version-control/RepositoryIdentityDialog.svelte`
- Create: `src/lib/git/version-actions.ts`
- Create: `src/lib/git/version-actions.test.ts`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src/lib/git/types.ts`
- Modify: `src/lib/native/types.ts`
- Modify: `src/features/version-control/HistoryView.svelte`
- Modify: `src/features/workspace/workspace-actions.ts`
- Modify: `src/features/workspace/workspace-actions.test.ts`

**Interfaces:**
- Consumes: saved valid pair, exact Git diff, current repository/identity.
- Produces: `git_init`, `git_set_local_identity`, `git_create_pair_version`, `loadHistoricalPairAsDraft()`, and explicit dialogs.

- [ ] **Step 1: Write real-repository mutation tests first**

Use actual temporary repositories to assert:

- initialization occurs only after an explicit command and respects Git's configured default branch;
- repository-local identity does not change global configuration;
- tracked pair changes commit successfully;
- an untracked definition and companion commit successfully;
- a deleted companion is recorded;
- unrelated staged changes remain staged and are absent from the new commit;
- unrelated unstaged/untracked files remain unchanged;
- pair paths with spaces/Unicode remain literal;
- empty pair diff returns `git_nothing_to_commit`;
- missing identity returns `git_identity_missing` before staging mutation;
- a failing commit hook returns bounded diagnostics and does not commit; and
- historical load returns text to the document store as an unsaved draft without checkout/reset.

- [ ] **Step 2: Run mutation tests to verify failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test git_integration -- --nocapture
npm run test:unit -- src/lib/git/version-actions.test.ts
```

Expected: FAIL because mutation commands/actions are absent.

- [ ] **Step 3: Implement the closed mutation set**

Allowed commands are:

- `git init <workspace-root>` after confirmation;
- `git config --local user.name USER_NAME` and `git config --local user.email USER_EMAIL`, where the values come from the confirmed repository-identity form;
- `git add --intent-to-add -- <untracked-pair-paths>`;
- `git commit --only -m <message> -- <pair-paths>`; and
- exact-path `git mv -- <old> <new>` for tracked app-driven pair rename.

For a pair version, preflight identity and diff before intent-to-add. Never use `--no-verify`; local hooks are part of the user's repository and may reject the version. Return the final commit OID and re-read status.

The test suite is the authority for whether `--only` preserves unrelated index state on supported Git versions. If a platform test disproves the invariant, stop and implement a tested index-preserving approach; do not weaken the invariant.

Update the workspace rename action to query tracked status first: use exact-path `git mv` for tracked pair files and the existing scoped filesystem rename for untracked/no-repository files. Mixed tracked/untracked pairs run the appropriate exact operation per file and migrate document/layout identity only after every required move succeeds.

- [ ] **Step 4: Implement explicit confirmation UI**

Create Version shows exact pair files, combined working diff, warnings/advisories, editable required message, and a note that local Git hooks may run. Disable it until YAML is saved/current/structurally valid.

Initialize Repository names the exact root and creates no commit. Identity dialog writes only local configuration and explains scope.

- [ ] **Step 5: Implement restore-as-draft**

History action loads the selected commit's existing definition/companion blobs, shows a comparison, and applies accepted text through one `replace-document` transaction per affected file grouped as one pair operation. It never changes HEAD, branch, index, or working files until the user explicitly saves.

- [ ] **Step 6: Verify local versioning**

Run:

```bash
npm run test:rust
npm run test:unit -- src/lib/git src/features/version-control
npm run check
```

Expected: PASS across the Git integration matrix.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git src-tauri/tests/git_integration.rs src/features/version-control src/lib/git src/lib/native/types.ts src/features/workspace/workspace-actions.ts src/features/workspace/workspace-actions.test.ts
git commit -m "feat: create local workflow git versions"
```

---

### Task 3: Import and validate runtime brand/theme packs

**Files:**
- Create: `src/lib/branding/validate-theme.ts`
- Create: `src/lib/branding/validate-theme.test.ts`
- Create: `src/lib/branding/sanitize-assets.ts`
- Create: `src/lib/branding/sanitize-assets.test.ts`
- Create: `src/features/branding/BrandSettings.svelte`
- Create: `src/features/branding/BrandSettings.test.ts`
- Create: `src/features/branding/BrandPreview.svelte`
- Create: `src-tauri/src/branding.rs`
- Modify: `src/lib/native/types.ts`
- Modify: `src/stores/branding.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: user-selected `brand.yaml` plus local PNG/SVG assets.
- Produces: `validateBrandPack()`, `sanitizeBrandAsset()`, `import_brand_pack`, `remove_brand_pack`, `set_window_icon`, and Settings preview/activation.

- [ ] **Step 1: Write failing theme and malicious-asset tests**

Test required semantic tokens, hex/rgb parsing, WCAG contrast calculations, invalid/traversal/absolute/remote paths, missing assets, files over 2 MiB each or 8 MiB total, and duplicate IDs.

Malicious SVG corpus includes `script`, `foreignObject`, event handlers, `javascript:` links, external `href`/`xlink:href`, CSS `url()`, entity/DOCTYPE, and animation. Sanitized output contains none of them and still renders the approved LOOP24 SVG.

- [ ] **Step 2: Run brand security tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/branding
npm run test:rust -- branding
```

Expected: FAIL because runtime import is absent.

- [ ] **Step 3: Implement token and asset validation**

Parse manifests with YAML 1.2 duplicate-key rejection. Reject unknown executable/style sections. Use DOMPurify with an SVG-specific allowlist, then independently parse the sanitized SVG and reject forbidden elements/attributes/URLs. PNG files must match their signature and decode dimensions within 4096x4096.

Report contrast below 4.5:1 for normal text or 3:1 for large/non-text controls. Blocking contrast failures apply to text/background/focus/error combinations required for operation; secondary decorative warnings may remain non-blocking during preview.

- [ ] **Step 4: Implement native app-data storage**

Copy only validated manifest and sanitized bytes into an app-data `brands/<id>/` directory using atomic writes. Never render directly from the originally selected path after validation. Removal cannot remove the built-in LOOP24 pack or an active pack without first reverting to LOOP24.

`set_window_icon` applies PNG/icon bytes only where Tauri/platform supports it and returns `unsupported` otherwise. It does not promise to rewrite installed application icons.

- [ ] **Step 5: Implement settings and live preview**

Preview applies tokens inside an isolated preview root, not globally. Activation validates again, saves the ID, and atomically swaps global tokens/assets. On startup failure, revert to LOOP24 and show a bounded warning.

- [ ] **Step 6: Tighten Content Security Policy**

Configure a CSP with `default-src 'self'`, no `unsafe-eval`, no remote script/style/img sources, and only the Tauri/local asset protocols required by the app. Add a manifest test so later changes cannot silently broaden it.

- [ ] **Step 7: Verify runtime branding**

Run:

```bash
npm run test:unit -- src/lib/branding src/features/branding
npm run test:rust
npm run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/branding src/features/branding src/stores/branding.ts src-tauri/src/branding.rs src-tauri/src/lib.rs src/lib/native/types.ts src-tauri/tauri.conf.json
git commit -m "feat: add safe runtime brand packs"
```

---

### Task 4: Build the graphical first-launch/setup protocol

**Files:**
- Create: `src/lib/progress/types.ts`
- Create: `src/lib/progress/progress-reducer.ts`
- Create: `src/lib/progress/progress-reducer.test.ts`
- Create: `src/features/setup/SetupOverlay.svelte`
- Create: `src/features/setup/SetupOverlay.test.ts`
- Create: `src/features/setup/ProgressStageList.svelte`
- Create: `src/features/setup/ExpandableLog.svelte`
- Create: `src/features/setup/ExpandableLog.test.ts`
- Create: `src-tauri/src/setup.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/app/App.svelte`

**Interfaces:**
- Consumes: native setup events and bundled resources.
- Produces: `ProgressEvent`, `ProgressState`, `applyProgressEvent()`, Rust `setup_status`, `setup_start`, `setup_cancel`, event channel `setup://event`, and shared setup UI.

- [ ] **Step 1: Define the stage protocol and failing reducer tests**

Use manifest, stage, log, complete, failed, and cancelled events. A stage has `pending`, `running`, `succeeded`, `skipped`, or `failed`; timestamps and durations are numeric. Reducer tests cover reconnection snapshots, duplicate events, bounded 500-line in-memory ring, progress math, stale run IDs, and automatic failure log expansion.

- [ ] **Step 2: Run progress tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/progress src/features/setup
```

Expected: FAIL because protocol/UI are absent.

- [ ] **Step 3: Implement real first-launch stages**

Rust exposes these idempotent stages:

1. `app-data` — create and permission-check application-data directories;
2. `resources` — verify bundled contract/example/LOOP24 manifests and digests;
3. `git` — run the bounded Git availability/version probe;
4. `workspace` — validate a remembered workspace or report that selection is required; and
5. `ready` — persist setup schema/app version success.

No stage downloads Python, Node, Hermes, Git, or source code. Git absence is a non-blocking stage result because authoring works without version control, even though the product assumes most users have Git.

- [ ] **Step 4: Implement the graphical overlay**

Mirror the approved co-worker behavior: branded header, total progress, current stage and elapsed time, stage rows, expandable autoscrolling log, cancel while safe, failure summary, automatic log expansion, Copy Output, Open Saved Log, and Retry.

The log persists under app data with timestamp/run ID. Redact URL query strings, authorization-shaped values, and workflow content; setup does not need workflow text.

- [ ] **Step 5: Verify setup UX**

Run:

```bash
npm run test:unit -- src/lib/progress src/features/setup
npm run test:rust
npm run check
```

Expected: PASS for success, cancellation, resource failure, missing Git, and retry.

- [ ] **Step 6: Commit**

```bash
git add src/lib/progress src/features/setup src-tauri/src/setup.rs src-tauri/src/lib.rs src/app/App.svelte
git commit -m "feat: add graphical first-launch setup"
```

---

### Task 5: Implement the signed in-app updater and progress UI

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/updater.rs`
- Create: `src/lib/updates/types.ts`
- Create: `src/lib/updates/update-api.ts`
- Create: `src/lib/updates/update-api.test.ts`
- Create: `src/features/updates/UpdateOverlay.svelte`
- Create: `src/features/updates/UpdateOverlay.test.ts`
- Create: `src/features/settings/AboutView.svelte`
- Create: `src/features/settings/AboutView.test.ts`
- Create: `src/stores/updates.ts`
- Modify: `src/lib/native/types.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/app/StatusBar.svelte`

**Interfaces:**
- Consumes: Tauri updater release metadata and shared progress components.
- Produces: `update_status`, `update_check`, `update_download_install`, `update_cancel`, `UpdateState`, Settings > About, footer update state, and graphical updater.

- [ ] **Step 1: Install updater plugins**

Run:

```bash
npm install @tauri-apps/plugin-updater@2.10.1 @tauri-apps/plugin-process@2.3.1
```

Add matching Rust plugins `tauri-plugin-updater = "2.10.1"` and `tauri-plugin-process = "2.3.1"`.

- [ ] **Step 2: Write failing updater state tests**

Test idle/checking/current/available/downloading/verifying/installing/restart-required/deferred/failed states; bytes never decrease; unknown total remains indeterminate; stale run IDs are ignored; cancellation leaves current install usable; offline check is non-destructive; and failed signature verification can never transition to installing.

- [ ] **Step 3: Run updater tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/updates src/features/updates
npm run test:rust -- updater
```

Expected: FAIL because update services/UI are absent.

- [ ] **Step 4: Implement native updater commands**

Use the Tauri updater extension from Rust. Checks identify the exact platform/architecture endpoint and return version, release notes, date, and size when available. Download emits bytes/total/speed events, verifies the Tauri signature before install, and persists a bounded local log.

Only one update run may exist. Manual checks are always available; startup checks are configurable in normal app settings, default on, time-bounded, and never block opening a workspace. Do not use user-facing environment variables.

- [ ] **Step 5: Implement footer/About/update overlay**

Footer shows Current, Checking, Update Available, progress, Restart Required, or Failed. About shows app version, contract versions/digests, OS/arch, Check for Updates, release notes, and the same progress/log surface.

Users can Download/Install, Later, Cancel while supported, Retry, Copy/Open Log, and Relaunch. Failure auto-expands details. Update UI uses real byte/stage events, not timers that simulate progress.

- [ ] **Step 6: Generate and configure the updater signing identity**

From a maintainer-controlled machine, generate the updater key outside the repository:

```bash
workflow_key_dir="$(mktemp -d)"
npm run tauri -- signer generate -w "$workflow_key_dir/workflow-studio.key"
```

Commit only the generated public key to Tauri configuration. Immediately store the private key and password in the repository's GitHub Actions secrets as `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; never copy either into the repository, logs, issue comments, or planning files. If external-secret mutation has not been explicitly authorized, stop after generating/recording the public key and ask the maintainer to set the two secrets.

Set the build-time updater endpoint to `https://github.com/cmetech/workflow-studio/releases/latest/download/latest.json`. Add a test that rejects an empty or known test public key in release builds while permitting the documented test key only under the test configuration.

- [ ] **Step 7: Verify updater behavior**

Run:

```bash
npm run test:unit -- src/lib/updates src/features/updates src/features/settings/AboutView.test.ts
npm run test:rust
npm run check
```

Expected: PASS, including signature-failure containment.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/updater.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json src/lib/updates src/features/updates src/features/settings src/stores/updates.ts src/lib/native/types.ts src/app/StatusBar.svelte
git commit -m "feat: add signed graphical app updates"
```

---

### Task 6: Package native releases and one-command downloaders

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/install.sh`
- Create: `scripts/install.ps1`
- Create: `tests/installers/install-script.test.ts`
- Create: `tests/fixtures/releases/valid-manifest.json`
- Create: `scripts/verify-release-assets.mjs`
- Create: `docs/installing.md`
- Create: `docs/releasing.md`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: tagged `base` commit, GitHub release credentials, updater signing secrets.
- Produces: DMG, NSIS, AppImage, optional Debian packages, checksums, updater metadata/signatures, downloader scripts, and release runbook.

- [ ] **Step 1: Write failing artifact-selection tests**

Model release assets for macOS Intel/Apple Silicon, Windows x64/ARM64 where available, and Linux x64/ARM64. Tests assert each supported OS/arch selects exactly one installer, unsupported targets fail clearly, asset names include version/OS/arch, checksums are required, and brand mix-ups are impossible.

Downloader static tests reject `eval`, remote command execution, unverified launch, silent architecture fallback, and broad deletion paths.

- [ ] **Step 2: Run installer tests to verify failure**

Run:

```bash
npm run test:unit -- tests/installers/install-script.test.ts
```

Expected: FAIL because scripts/selector are absent.

- [ ] **Step 3: Create native release workflow**

Trigger only on version tags and manual dispatch. Use native `macos-latest`, `windows-latest`, and `ubuntu-24.04` jobs. Checkout the exact tag, run `npm ci`, full verification, contract/example checks, and Tauri build.

Use `tauri-apps/tauri-action` to publish draft GitHub Releases with updater JSON/signatures. Supply `TAURI_SIGNING_PRIVATE_KEY` and password only from secrets. Do not configure Apple/Windows code-signing identities.

Generate a SHA-256 checksum manifest over every public artifact. A final job downloads the draft assets and runs `verify-release-assets.mjs` before the release can be published manually.

- [ ] **Step 4: Implement safe downloaders**

`install.sh` detects Darwin/Linux and `uname -m`; `install.ps1` detects Windows architecture. Both query this repository's GitHub latest-release API, select exact assets, download to an OS temporary directory, verify the checksum manifest, then open/run the native installer with explicit user-visible status.

The shell downloader opens DMG on macOS and launches AppImage/install guidance on Linux. PowerShell launches NSIS. Scripts never bypass Gatekeeper/SmartScreen or alter security policy.

- [ ] **Step 5: Document unsigned installation honestly**

`docs/installing.md` covers direct download and one-command paths, exact first-launch Gatekeeper right-click Open flow, Windows SmartScreen More info/Run anyway flow, Linux executable permissions, install locations, uninstall, app-data locations, Git assumption, and updater behavior.

`docs/releasing.md` covers native runner matrix, contract/example gates, version/tag process, updater key custody/rotation, artifact verification, draft review, and required return to `base` after release work.

- [ ] **Step 6: Verify release configuration without publishing**

Run:

```bash
npm run verify
npm run contracts:check
npm run examples:check
node scripts/verify-release-assets.mjs --fixture tests/fixtures/releases/valid-manifest.json
```

Validate the workflow syntax with GitHub's current action tooling or a dry-run linter. Do not tag or publish during implementation.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/release.yml scripts/install.sh scripts/install.ps1 scripts/verify-release-assets.mjs tests/installers tests/fixtures/releases docs/installing.md docs/releasing.md src-tauri/tauri.conf.json package.json README.md
git commit -m "feat: package native workflow studio releases"
```

---

### Task 7: Complete E2E, security, and clean-machine release acceptance

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/workspace-authoring.spec.ts`
- Create: `tests/e2e/invalid-yaml-recovery.spec.ts`
- Create: `tests/e2e/examples-and-docs.spec.ts`
- Create: `tests/e2e/git-version.spec.ts`
- Create: `tests/e2e/branding.spec.ts`
- Create: `tests/e2e/update-progress.spec.ts`
- Create: `tests/security/security-boundaries.test.ts`
- Create: `docs/security.md`
- Create: `docs/verification/release-acceptance-template.md`
- Create: `docs/verification/version-1-release-acceptance.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete application and browser bridge fixtures.
- Produces: Playwright suite, security boundary suite, threat model, and three-platform acceptance record.

- [ ] **Step 1: Install Playwright test harness**

Run:

```bash
npm install --save-dev @playwright/test@1.62.0
npx playwright install chromium
```

Add scripts `test:e2e` and `test:e2e:headed`. CI installs only Chromium for deterministic renderer flows; native install/update UAT remains platform-specific.

- [ ] **Step 2: Write end-to-end workflows before final fixes**

Cover:

1. open fixture folder, select pair, see graph, edit YAML, see graph update;
2. add/duplicate/connect/rename/delete through canvas, inspect exact YAML, save, reopen, retain positions;
3. introduce invalid YAML, observe stale canvas and blocked save, recover, save;
4. create from every example and open contextual docs;
5. create a local Git version without unrelated fixture changes;
6. preview/reject malicious brand and activate a valid brand; and
7. render deterministic setup/update progress, failure log, retry, and defer flows.

- [ ] **Step 3: Write the security boundary test**

Assert:

- CSP has no unsafe eval or remote renderer resources;
- Tauri capabilities have no shell permission or blanket filesystem scope;
- no native command accepts arbitrary executable/argument arrays;
- no Git remote/mutation beyond the approved closed set exists;
- no telemetry/analytics dependency or endpoint exists;
- workflow/recovery/log contents do not escape approved locations;
- updater requires the configured release public key rather than the known test key in release mode; and
- theme/Markdown sanitizers pass the malicious corpus.

- [ ] **Step 4: Run E2E/security tests and fix only demonstrated defects**

Run:

```bash
npm run test:e2e
npm run test:unit -- tests/security
npm run verify
```

Expected: PASS.

- [ ] **Step 5: Write the final threat model and operating guidance**

`docs/security.md` documents trusted/untrusted inputs, workspace containment, symlinks, YAML aliases, Git hooks, theme assets, Markdown, logs, update chain, unsigned OS artifacts, recovery data, and explicitly excluded telemetry/network behavior. Each mitigation points to a behavior/test module, not a line number.

- [ ] **Step 6: Perform clean-machine acceptance on all platforms**

For macOS, Windows, and Linux, record:

- artifact name/checksum and machine architecture;
- unsigned warning and documented user path;
- first-launch stages/log;
- folder open/import/create/save/reopen layout;
- YAML/visual/form round-trip;
- bundled examples/docs;
- local Git version and unrelated-change preservation;
- valid/malicious brand results;
- updater check/download/signature/install/relaunch using a staged release; and
- 250-node/500-edge canvas evidence.

Use `docs/verification/release-acceptance-template.md` and place actual evidence in `version-1-release-acceptance.md`. A missing platform remains an explicit release blocker.

- [ ] **Step 7: Run the final release gate**

Run:

```bash
npm ci
npm run contracts:check
npm run examples:check
npm run verify
npm run test:e2e
npm run build
npm run tauri -- build --debug
git status --short
```

Expected: all commands PASS; `git status --short` is empty; the acceptance document has no unresolved release blocker.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e tests/security docs/security.md docs/verification .github/workflows/ci.yml README.md
git commit -m "test: verify workflow studio version one"
```
