# Windows native validation and Arrange Graph debugging handoff

Use the prompt below in a fresh coding session running directly on the Windows machine where Workflow Studio v3.0.1 still reports an Arrange Graph storage failure. Set the session's working directory to a Windows checkout of `cmetech/workflow-studio` before starting.

````text
You are working directly on a Windows machine to reproduce, diagnose, test, and correct Workflow Studio's Windows-specific behavior. Most development occurred on macOS. Do not assume passing GitHub Windows CI proves the installed Windows application works on this machine.

Primary reported defect

- The user installed official Workflow Studio v3.0.1 on Windows.
- Clicking Arrange Graph on an existing workflow still reports:
  `Layout storage failed: The parameter is incorrect. (os error 87)`
- v3.0.1 was intended to correct that exact failure, so first verify the installed bits and reproduce the real installed-app behavior. Do not assume the prior diagnosis or fix is complete.

Repository and immutable release facts

- Repository: `https://github.com/cmetech/workflow-studio`
- Development branch: `base`; never modify or merge into literal `main`.
- Published release: `v3.0.1`
- Immutable v3.0.1 release commit: `7608947b4d17e49cd064fc978d330c76aab8c281`
- Reviewed hotfix source before version preparation: `79e04d61b7b235eaf7135f0bd9b1707117d5730c`
- v3.0.1 Windows installer SHA-256:
  `500306ff03c375fbfed9a7b80d4a386d78b6c9449d96b79297379a0d0b16b3ef`
- Protected release workflow `34408692126` and protected CI run `34406142397` passed, but clean-machine Windows UAT remained open.
- The existing implementation centralizes Windows state-file replacement in `src-tauri/src/native_fs.rs`. Layout calls it from `src-tauri/src/layout.rs`; active branding, setup readiness, and updater preferences also use it.
- The prior change replaced a non-null `RootDirectory`/relative-name call to `SetFileInformationByHandle(FileRenameInfo)` with an absolute destination derived from `GetFinalPathNameByHandleW`, a null `RootDirectory`, and a dynamically sized `FILE_RENAME_INFO` buffer.
- Existing CI exercises native Rust persistence in temporary directories. The real failure may depend on the installed app-data path, an existing v3.0.0/v3.0.1 record, Windows Server behavior, filesystem policy, path syntax, permissions, handle sharing, endpoint security, or another installed-only condition.

Authority and safety rules

1. Read `AGENTS.md` completely and follow it.
2. Then read these documents completely, in order:
   - `docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md`
   - `docs/superpowers/specs/2026-07-25-workflow-studio-design.md`
   - `docs/superpowers/plans/2026-09-09-windows-layout-storage-hotfix.md`
   - `docs/verification/version-3.0.1-release-acceptance.md`
3. Read the actual implementation and callers before forming a diagnosis:
   - `src-tauri/src/native_fs.rs`
   - `src-tauri/src/layout.rs`
   - `src-tauri/src/branding.rs`
   - `src-tauri/src/setup.rs`
   - `src-tauri/src/setup_spec.rs`
   - `src-tauri/src/updater.rs`
   - `src-tauri/src/updater_spec.rs`
   - `src/lib/layout/layout-store.ts`
   - `src/features/documents/document-workspace-controller.ts`
   - the Arrange Graph and persistence paths in `src/app/App.svelte` and `src/features/canvas/GraphCanvas.svelte`
   - `.github/workflows/ci.yml`
4. Use `superpowers:systematic-debugging` before proposing a correction and `superpowers:test-driven-development` for every code fix. Use `superpowers:requesting-code-review` and `superpowers:verification-before-completion` before declaring the branch ready.
5. YAML remains the sole workflow authority. Layout/application state stays in private app data and must never enter workflow YAML, document hashes, undo history, export output, or Git changes.
6. Preserve current public APIs, error codes and precedence, storage locations, size bounds, capability checks, atomicity, lazy behavior, and all non-Windows behavior.
7. Never weaken symlink/reparse-point, directory-identity, file-identity, race, path-containment, permission, or atomic-replacement protections merely to make Windows accept a write.
8. Do not modify the sibling `hermes-agent` repository. Do not change workflow language syntax or Hermes contract behavior.
9. Preserve unrelated user files and worktrees. Do not discard, reset, stash, or overwrite them.
10. Do not merge into `base`, tag, build a public release, publish artifacts, or modify GitHub releases without separate explicit user approval.
11. Do not expose workflow content, credentials, updater signing material, private paths, or saved logs in commits or public reports. Redact evidence while retaining the exact Windows error, operation, and path shape needed for diagnosis.

Start with Git and machine identity

Run read-only checks before mutation and record the exact output in a private scratch/evidence directory outside the repository:

```powershell
git status --short --branch
git remote -v
git log --oneline --decorate -12
git worktree list --porcelain
git rev-parse HEAD
git rev-parse origin/base
git rev-parse 'v3.0.1^{commit}'

$PSVersionTable
[System.Environment]::OSVersion.VersionString
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, OsArchitecture
node --version
npm --version
rustc --version
cargo --version
git --version
```

Fetch without overwriting work. Inspect every listed worktree. If this is a clean clone, create a dedicated branch from the latest `origin/base`, for example `fix/windows-native-persistence-followup`. If the checkout has unrelated changes, preserve them and create an isolated worktree/branch according to `superpowers:using-git-worktrees`. Never work directly on `main`.

Before installing tools or changing machine-wide settings, explain why and obtain user approval. Record whether the machine is Windows 10, Windows 11, or Windows Server, its exact build, whether the user is standard or elevated, the system drive filesystem, profile/app-data redirection, domain policy, Controlled Folder Access, antivirus/EDR, and WebView2 runtime version. Treat elevation only as a diagnostic comparison; requiring administrator rights is not an acceptable fix.

Phase 1: prove the installed artifact and capture the real failure

1. Confirm the application footer says `Version: 3.0.1`.
2. Find the running executable through Task Manager or PowerShell and record its exact installed path and file version. Ensure an old executable, pinned shortcut, portable copy, or still-running v3.0.0 process is not being launched.
3. Verify the installer or installed package source against the published SHA-256 above. If the bytes do not match, stop and report that the tested artifact is not the official v3.0.1 installer.
4. Use the same Windows account and same existing workflow that reproduces the defect. Record:
   - whether nodes visibly move before the toast appears;
   - the exact toast text and any stable error code;
   - whether this is the first layout save or replacement of an existing layout;
   - whether it happens on every click or only after restart/upgrade;
   - whether the workflow is local NTFS, a network share, OneDrive, redirected profile, removable media, or another filesystem;
   - whether the app was installed over v3.0.0 or installed fresh;
   - whether multiple Workflow Studio processes are running.
5. Capture a screen recording or screenshots privately if useful. Do not add sensitive workflow screenshots to Git.
6. Before touching app data, quit every Workflow Studio process and copy the entire current app-data directory into a timestamped private evidence directory. The documented default is `%APPDATA%\com.cmetech.workflowstudio`, but verify the actual resolved Tauri app-data path rather than assuming it.
7. Record a bounded, redacted inventory of the app-data root:
   - file names, sizes, timestamps, attributes, owner, and ACL;
   - whether `layouts-v1.json` exists and is a regular file;
   - its size and SHA-256 before and after Arrange Graph;
   - any `.layouts-v1-*.tmp` residue;
   - whether the directory or file is read-only, compressed, encrypted, redirected, a junction, symlink, mount point, or other reparse point.
8. Preserve `layouts-v1.json` privately. Inspect only enough JSON structure to establish schema/version, entry count, and relevant workflow identity. Do not publish workflow paths or content.

Use PowerShell commands equivalent to these, adjusting only after confirming the real app-data path:

```powershell
$AppDataRoot = Join-Path $env:APPDATA 'com.cmetech.workflowstudio'
Get-Item -LiteralPath $AppDataRoot -Force | Format-List FullName,Attributes,LinkType,Target,CreationTime,LastWriteTime
Get-Acl -LiteralPath $AppDataRoot | Format-List
Get-ChildItem -LiteralPath $AppDataRoot -Force |
  Select-Object Name,Length,Attributes,LinkType,CreationTime,LastWriteTime

$LayoutFile = Join-Path $AppDataRoot 'layouts-v1.json'
if (Test-Path -LiteralPath $LayoutFile) {
  Get-Item -LiteralPath $LayoutFile -Force | Format-List FullName,Length,Attributes,LinkType,Target,CreationTime,LastWriteTime
  Get-Acl -LiteralPath $LayoutFile | Format-List
  Get-FileHash -LiteralPath $LayoutFile -Algorithm SHA256
}

Get-Process -Name 'workflow-studio' -ErrorAction SilentlyContinue |
  Select-Object Id,Path,StartTime
```

Do not delete app data as the first troubleshooting action. A reset can hide the condition that must become a regression test.

Phase 2: separate creation, replacement, upgrade-state, and environment behavior

After the original state is safely backed up, run a controlled matrix and record every result:

| Case | State | Required observation |
| --- | --- | --- |
| A | Original installed v3.0.1 plus original app data and original workflow | Reproduce the user's exact failure. |
| B | Original app data, simple bundled workflow | Determine whether workflow complexity matters. |
| C | Backed-up app data with `layouts-v1.json` absent, then first Arrange Graph | Distinguish create-new from replace-existing. Preserve/restore the original file; do not destroy it. |
| D | Same clean state, second and tenth Arrange Graph saves | Exercise repeated existing-target replacement. |
| E | Fresh Windows user/profile or isolated app-data root, if feasible | Distinguish machine policy from migrated per-user state. |
| F | Original upgraded app data restored byte-for-byte | Confirm the defect returns with the original state. |
| G | Local short ASCII workspace path and original workspace path | Separate workspace-path effects from app-data effects. |
| H | Standard-user run and one explicitly approved elevated diagnostic run | Identify ACL/policy effects; do not accept elevation as the solution. |

For each case record whether layout geometry changed, whether the toast appeared, whether `layouts-v1.json` was created/replaced, its before/after hash, whether restart restored the layout, and whether temporary files remained. Verify workflow YAML bytes and Git status are identical before and after Arrange Graph.

If nodes do not move and the UI reports `Arrange Graph could not produce a safe routed layout`, investigate the ELK/worker/layout path separately. If nodes move and the UI reports `Layout storage failed: ...`, treat layout calculation as successful and focus first on the persistence chain. If the message is `Arrange Graph was interrupted after updating the canvas`, trace the post-publication persistence failure and ensure retry/recovery semantics remain correct.

If available, use Microsoft Process Monitor as a bounded optional probe. Filter to the exact Workflow Studio process plus `layouts-v1.json` and `.layouts-v1-*.tmp`; capture CreateFile, SetRenameInformationFile/Rename, CloseFile, and the returned NTSTATUS/Win32 result. Do not install ProcMon without user approval, and do not commit an unredacted capture. Determine which exact filesystem call returns error 87 and record its parameters/path form.

Phase 3: reproduce from source on the same Windows machine

Install or confirm only the documented Windows Tauri prerequisites, Node `22.13.0` or compatible Node 22, npm 10+, Rust, Visual Studio C++ build tools, and WebView2. Do not silently change system policy.

From the isolated feature branch:

```powershell
npm ci
npm run format:check
npm run lint
npm run check
npm run contracts:check
npm run examples:check
npm run resources:verify

cargo test --locked --manifest-path src-tauri/Cargo.toml layout::tests -- --nocapture
cargo test --locked --manifest-path src-tauri/Cargo.toml branding::tests::active_record_replaces_an_existing_selection_and_uses_the_platform_replace_branch -- --exact --nocapture
cargo test --locked --manifest-path src-tauri/Cargo.toml setup_spec::readiness_is_atomic_and_keyed_by_schema_and_app_version -- --exact --nocapture
cargo test --locked --manifest-path src-tauri/Cargo.toml updater_spec::updater_preferences_default_on_recover_from_malformed_data_and_store_atomically -- --exact --nocapture
```

Record the exact exits. A passing temporary-directory unit test does not invalidate the installed-app reproduction.

Run the application from source on this Windows machine with bounded debug logging according to the repository's existing logging configuration. Reproduce Arrange Graph using:

1. the original failing app data and workflow;
2. a clean isolated app-data state;
3. a first layout creation;
4. repeated layout replacement;
5. application restart and layout reload.

Build the Windows debug bundle using the same command as CI and test the packaged executable/installer rather than relying only on `tauri dev`:

```powershell
npx --no-install tauri build --debug --config src-tauri/tauri.ci.conf.json
```

Verify which executable is running during every comparison. Keep released v3.0.1, `tauri dev`, debug bundle, and any locally installed fixed build clearly separated.

Phase 4: trace the exact failing boundary

Follow one Arrange Graph request end to end:

1. command registry and toolbar activation;
2. `GraphCanvas.svelte` layout worker request, validated positions/routes, publication, fit, and persistence callback;
3. `App.svelte` and `document-workspace-controller.ts` persistence ownership;
4. `layout-store.ts` queue, JSON serialization, and `layoutSave` invocation;
5. Tauri command `layout_save` in `src-tauri/src/layout.rs`;
6. app-data resolution and `LayoutScope` binding/verification;
7. temporary-file creation, write, flush, identity check, destination classification, and commit selection;
8. Windows call through `replace_file_in_capability_directory` in `native_fs.rs`;
9. cleanup, retry, error mapping, and UI feedback.

At each boundary record the expected input, observed input, exact return/error, and whether state already changed. Do not infer the failing Windows API from the final toast alone.

Inspect these Windows-specific questions using evidence from the failing machine:

- Does `GetFinalPathNameByHandleW` return a drive path, `\\?\` path, UNC path, volume GUID path, redirected path, or another form?
- Is that returned path form valid for the selected `SetFileInformationByHandle` information class on this exact Windows/Windows Server build?
- Are `FileNameLength`, buffer size, alignment, terminator handling, and structure initialization correct for the observed UTF-16 destination?
- Does the destination already exist, and is `ReplaceIfExists` sufficient under the actual attributes/ACL/share modes?
- Are source and destination on the same volume?
- Does any retained destination handle, cloned capability handle, antivirus scanner, indexer, backup agent, or second app process change sharing behavior?
- Does the first-save branch use `Dir::rename` while only the replacement branch uses the Windows helper?
- Is a stale `LayoutScope` retained after profile redirection, directory replacement, upgrade, sleep/resume, or account policy change?
- Is error 87 returned by `GetFinalPathNameByHandleW`, `SetFileInformationByHandle`, another native call, or later verification?
- Do non-ASCII, spaces, long paths, UNC/redirection, read-only attributes, and inherited ACLs change the outcome?

Do not switch APIs or add fallback behavior until the exact failing call and contract are proven. A fallback must preserve atomic replacement, source/destination identity, capability containment, same-directory/same-volume behavior, temporary-file cleanup, and error precedence. Never fall back to delete-then-rename or copy-overwrite because either can lose the existing layout or expose a partial file.

Phase 5: add a real failing Windows regression test before changing production code

The regression must fail on the current v3.0.1 implementation on this Windows machine for the same reason as the installed app. Prefer the smallest real native filesystem test that preserves the relevant environmental trigger. It must exercise the real Windows API and actual app-data path shape or an equivalent controlled path; a mocked selector or seam-only test is insufficient.

Depending on the proven cause, cover only the relevant variants, such as:

- replacing an existing `layouts-v1.json` created by the released version;
- the exact Windows Server path form returned from a bound app-data directory;
- redirected/UNC/volume-prefix behavior;
- Unicode or long-path handling;
- destination attributes, ACLs, or share-mode behavior;
- repeated replacement with no temporary residue;
- restart/load after replacement;
- the installed package's app-data location and standard-user context.

Record the red test command and complete failure output. Confirm the failure disappears if and only if the real trigger is removed. Do not weaken an existing test or change its assertion to accept the error.

Phase 6: implement the smallest correction

Make only the change supported by the root-cause evidence. Keep shared behavior in one Windows helper when the same native operation applies to layout, branding, setup, and updater state. Keep module-specific error mapping at the callers. Avoid a broad filesystem abstraction rewrite.

After the focused test passes, add adversarial tests for the nearest failure boundaries that could regress:

- first creation and existing-target replacement;
- repeated writes and restart/load;
- source and destination identity validation;
- unsafe leaf names and path forms;
- root/destination replacement races;
- temporary cleanup on every failure;
- exact error mapping and retry behavior;
- no mutation of workflow YAML.

Test the locally built packaged app against the original backed-up state on the same Windows machine. A unit-test-only fix is incomplete.

Phase 7: exhaustive Windows compatibility pass

After the Arrange Graph defect is fixed, run and record a broader Windows pass. Fix confirmed regressions within the existing approved architecture using the same red-test-first process. Do not invent unrelated features.

Native persistence and app data

- Arrange Graph layout create, replace, ten repeated saves, close/reopen, and upgrade-state restore.
- Drag, viewport, collapsed panels, lower-panel sizing, root scope, and multiple loop-group scope persistence.
- Active brand-pack import/select/restart/remove.
- Setup readiness creation/replacement and saved setup logs.
- Updater preference creation/replacement, update-log storage, and staged update state.
- Recovery drafts, recent workspaces, cached contracts, resource verification, and bounded log storage.
- Standard-user operation, spaces, Unicode, long paths, read-only files, ACL denial, reparse points, and cleanup after injected failures.

Workspace filesystem and watcher

- Open local folders and workflow pairs through Windows dialogs.
- Atomic save, overwrite conflict, external edit detection, rename pair, duplicate, export, and recycle-bin behavior.
- Windows separators, drive roots, case-insensitive names, reserved names, UNC/network paths where supported, and symlink/junction containment.
- No YAML corruption, comment/key/scalar-style loss, or unrelated file changes.

Git and subprocesses

- Repository discovery, status, diff, history, pair-only version commit, linked worktrees, Unicode/spaced paths, and unborn repositories.
- Preserve unrelated staged, unstaged, and untracked changes.
- Confirm Git and contract subprocesses use argument arrays without shell interpolation or unwanted console windows.
- Verify timeout/process-tree cleanup on Windows.

Canvas, input, WebView2, and accessibility

- Arrange root and multiple loop-group graphs, fan-out/fan-in routes, crossings, selection, drag completion, pan/zoom, and restart restoration.
- Fixed 250-node/500-edge performance fixture on the real Windows machine; no parsing, validation, layout, Git, or native I/O during pointer frames.
- `Ctrl` shortcuts, `Ctrl+Y`, Delete/Backspace, F1, keyboard canvas navigation, focus return, context menus, and text-editor shortcut isolation.
- 100%, 125%, 150%, and 200% display scaling where available; narrow and large windows; reduced motion; forced colors/high contrast; screen-reader names.
- WebView2 startup, offline operation, emitted workers, local fonts/resources, and no external runtime asset dependency.

Installation, package, and update

- Official v3.0.1 upgrade and fresh-install behavior under a standard user.
- Installed version/footer, Start menu shortcut, executable identity, app-data location, uninstall entry, and preservation of workspace YAML/app data.
- SmartScreen behavior is documented honestly; do not disable security policy as a workaround.
- Debug/release NSIS payload contains the exact integrity-manifest resource tree.
- In-app updater finds the expected target, verifies its first-party signature, persists preferences, and handles cancel/retry/relaunch without losing work. Do not publish or stage a public test release without approval.

Run complete verification after all fixes

Use the repository's current commands and do not omit Windows-native tests:

```powershell
npm run format:check
npm run lint
npm run check
npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1
npm run test:rust
npm run contracts:check
npm run examples:check
npm run resources:verify
npm run build
npm run test:e2e
npx --no-install tauri build --debug --config src-tauri/tauri.ci.conf.json
```

Also rerun the four separate Windows persistence commands from `.github/workflows/ci.yml`. Do not combine them in a way that lets a later success hide an earlier failure. If a full check fails, use `superpowers:systematic-debugging`; do not rerun blindly or relax the check.

Required Arrange Graph acceptance result

On the exact Windows machine/account/state that reproduced v3.0.1 error 87:

1. The failing regression test is red on unmodified v3.0.1 and green after the fix.
2. A packaged local build runs as a standard user.
3. Arrange Graph succeeds on the original workflow and original restored app data.
4. Ten consecutive arrangements complete without a storage toast or temporary residue.
5. Closing and reopening restores the final positions, routes, viewport, and per-loop-group scope state.
6. `layouts-v1.json` remains one valid bounded regular file with the expected updated content and no partial write.
7. Workflow YAML hashes and Git status do not change because of Arrange Graph.
8. Branding, setup readiness, and updater preferences pass their repeated replacement tests if they share the corrected helper.
9. The full Windows verification suite and packaged debug build pass.
10. No capability, containment, atomicity, error-precedence, accessibility, or performance invariant is weakened.

Review and delivery

Before calling the work ready:

1. Create `docs/verification/2026-09-10-windows-native-validation.md` on the feature branch.
2. Record the Windows edition/build/architecture, standard/elevated status, filesystem/path shape, installed executable identity, v3.0.1 reproduction steps, exact failing API, root cause, red/green test evidence, commands/results, packaged-app UAT, and remaining limits. Redact private workflow content and user paths.
3. Include a requirements-to-evidence table for every item in the exhaustive Windows pass. Mark each supported, failed/fixed, or not executed with a reason; do not convert unavailable testing into a pass.
4. Request an adversarial code review of the complete branch. Require exact file/line evidence and reproduction for each finding. Consolidate duplicates, independently validate every finding, add a failing test for each valid defect, implement the smallest correction, and rerun focused review.
5. Commit coherent tested changes on the feature branch. Preserve unrelated changes.
6. Report in plain language:
   - what actually caused error 87 on the user's Windows machine;
   - why existing CI missed it;
   - what changed;
   - which Windows areas were tested;
   - exact passing counts/commands;
   - installed/package UAT results;
   - remaining risks or unavailable tests;
   - branch and commit IDs.
7. Stop and wait for explicit user approval before merging to `base`, tagging, publishing, or creating another release.

Do not declare success merely because the existing Windows CI tests pass. Completion requires reproducing the released failure on the user's Windows environment, proving its exact native boundary, making a test fail for that same reason, and validating a packaged fixed build against the original state.
````
