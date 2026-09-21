# Workflow Studio Windows-Primary Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use superpowers:test-driven-development for every behavior change, superpowers:systematic-debugging whenever observed evidence differs from this baseline, and superpowers:verification-before-completion before any completion claim.

**Goal:** Make Windows the fully supported primary Workflow Studio platform by fixing every confirmed Windows correctness and responsiveness defect, making the Windows test signal deterministic, and retaining Linux/macOS compatibility.

**Architecture:** Preserve canonical, capability-bound paths and handles inside Rust while introducing one narrow platform boundary for user-facing paths, subprocess paths, and background-process flags. Reuse the repository discovery performed while binding the workspace instead of starting a competing Git lifecycle. Keep pointer-move state inside Svelte Flow, publish durable canvas state only at interaction boundaries, and retain the layout worker as the sole expensive routing executor. Cross-platform suites remain authoritative; Windows gains full native, renderer, and installer gates.

**Tech Stack:** Svelte 5, TypeScript 6, Nanostores, Svelte Flow, ELK worker, Vitest 4, Playwright, Rust 1.88, Tauri 2, Git for Windows, GitHub Actions, Node.js 22.13+.

**Spec:** [Foundation review](../../analysis/2026-07-25-hermes-workflow-language-foundation-review.md), [authoritative product design](../specs/2026-07-25-workflow-studio-design.md), [current v3.0.1 plan](2026-09-09-workflow-studio-v3.0.1-release.md), and the repository `AGENTS.md` instructions.

## Baseline and finding coverage

The implementation starts from `base` at `7a7c19b`. Re-run the baseline before changing code if the branch tip changes.

| ID | Confirmed Windows finding | Planned task |
| --- | --- | --- |
| W1 | Git and Hermes child processes use `CREATE_SUSPENDED` without `CREATE_NO_WINDOW`, allowing console flashes | 3 |
| W2 | Opening a folder performs four synchronous Git probes and then starts a duplicate renderer Git lifecycle | 8 |
| W3 | Normal YAML overwrite fails with Windows error 5 while restoring permissions through a read-only handle | 5 |
| W4 | Git rejects verbatim `\\?\` temporary-index and message-file paths; all ten native Git integrations fail | 4, 7 |
| W5 | Custom brand import renames a staging directory while its directory handle is open; Windows returns error 32 | 6 |
| W6 | Canonical `\\?\` paths leak into the workspace title and recent-workspace JSON | 4 |
| W7 | Every drag pointer event clones and compares the entire global canvas-position map; 250-node and loop-scope drags create 67–140 ms main-thread tasks | 9 |
| W8 | Arrange Graph intermittently stalls or exceeds its five-second worker timeout; warmed 250-node/500-edge layout misses the three-second contract | 10 |
| W9 | The main renderer entry is 2.58 MB minified / 558 KB gzip and eagerly includes cold-only surfaces | 11 |
| W10 | A normal `core.autocrlf=true` checkout makes formatting and exact-byte/string tests fail | 1 |
| W11 | A style-contract diagnostic reports platform separators instead of repository `/` paths | 1 |
| W12 | Release-state tests can invoke the real installed `gh.exe` and contact GitHub | 2 |
| W13 | Installer tests select the Windows WSL launcher as `bash`, hang, and race temporary-directory cleanup | 2 |
| W14 | Windows CI runs only four focused Rust tests and never exercises the full native or functional Chromium suites | 12 |
| W15 | The loop-token E2E test clicks into the middle of text but assumes an end caret | 1 |
| W16 | The unsharded two-browser E2E command exceeds the practical Windows feedback window | 12 |
| W17 | Production audit reports vulnerable direct `ajv`/`fast-uri` and `dompurify`; development audit reports four more findings | 11 |
| W18 | Native welcome/idle behavior is healthy, but installed-app save, Git, brand, restart, and large-canvas flows have not passed packaged Windows UAT | 13 |

Two observations are recorded but are not classified as application regressions: the cold `npm ci` took about seven minutes on this Windows/Defender filesystem, and WebKit is renderer coverage rather than a native Windows WebView2 engine. Task 12 addresses feedback time with caching and isolated E2E shards without conflating either observation with UI runtime performance. The healthy native idle sample (about 49.7 MiB, 0% sampled CPU, 16 threads, and 490 handles) becomes a non-regression baseline in Task 13.

## Global constraints

- [ ] Create `fix/windows-primary-stabilization` from an up-to-date `base`; do not implement directly on `base`.
- [ ] Preserve YAML as the only workflow authority and preserve comments, key order, scalar style, unknown fields, and DAG invariants.
- [ ] Keep canonical/verbatim paths for capability and identity checks. Normalize only serialized display/storage paths and OS subprocess arguments.
- [ ] Keep all native commands capability-scoped and free of shell interpolation.
- [ ] Do not parse YAML, validate the graph, route/layout, call Git, or perform native I/O in pointer-move frames.
- [ ] Use real temporary directories and repositories for native filesystem and Git regression tests.
- [ ] Run each behavior change red, implement the smallest fix, and run it green before proceeding.
- [ ] Do not weaken a timing assertion or raise the five-second layout timeout to make a performance test pass.
- [ ] Do not run the installed application until the user has saved work and closed it. Back up its application-data directory before packaged UAT.
- [ ] This plan ends at a reviewed, release-ready commit and verification record. Merging to `base`, tagging, publishing, or replacing the installed app requires separate user approval.

---

## Task 1: Make Windows checkouts and renderer tests deterministic

**Files:**

- Modify: `.gitattributes`
- Create: `tests/project/line-ending-contract.test.ts`
- Modify: `tests/project/style-contract.test.ts`
- Modify: `tests/e2e/loop-group-authoring.spec.ts`

- [ ] **Step 1: Write the failing checkout contract.** Add a test that parses `.gitattributes`, requires repository text to be LF, retains CRLF only for `*.cmd` and `*.bat`, and rejects an unclassified text-file exception:

  ```ts
  expect(attributes).toContain('* text=auto eol=lf')
  expect(attributes).toContain('*.cmd text eol=crlf')
  expect(attributes).toContain('*.bat text eol=crlf')
  ```

  Update the style test to report `relative(process.cwd(), file).replaceAll('\\', '/')`. In the loop-token E2E test, focus the prompt and explicitly place the caret at `value.length`; add a companion assertion proving a mid-string selection still inserts at that selected caret.

- [ ] **Step 2: Confirm RED on the Windows checkout.** Run:

  ```powershell
  npm run test:unit -- tests/project/line-ending-contract.test.ts tests/project/style-contract.test.ts
  npx playwright test tests/e2e/loop-group-authoring.spec.ts --project=chromium --grep "authors body nodes and references"
  npm run format:check
  ```

  Expected: the line-ending contract and current formatting fail; the existing caret-dependent expectation reproduces before its test setup is corrected.

- [ ] **Step 3: Establish LF source checkout policy.** Add:

  ```gitattributes
  * text=auto eol=lf
  *.bat text eol=crlf
  *.cmd text eol=crlf
  ```

  Keep the existing protected-resource and license rules. Run `git add --renormalize .`, then `npm run format` once to convert the current working tree. Review `git diff --ignore-space-at-eol --stat` and every non-empty content diff; do not accept unrelated formatting edits.

- [ ] **Step 4: Run GREEN and cross-platform-sensitive checks.** Run:

  ```powershell
  npm run format:check
  npm run test:unit -- tests/project/line-ending-contract.test.ts tests/project/style-contract.test.ts
  npx playwright test tests/e2e/loop-group-authoring.spec.ts --project=chromium
  git ls-files --eol
  ```

  Expected: tracked source reports `i/lf`; working-tree files are LF except classified batch files; both end-caret and selected-caret token insertion pass.

- [ ] **Step 5: Commit.**

  ```powershell
  git add .gitattributes tests/project/line-ending-contract.test.ts tests/project/style-contract.test.ts tests/e2e/loop-group-authoring.spec.ts
  git commit -m "test: stabilize Windows checkout semantics"
  ```

## Task 2: Isolate release and installer tests from host executables

**Files:**

- Modify: `scripts/resolve-release.mjs`
- Modify: `tests/installers/release-state.test.ts`
- Create: `tests/support/posix-shell.ts`
- Create: `tests/support/posix-shell.test.ts`
- Modify: `tests/installers/install-script.test.ts`

- [ ] **Step 1: Write failing process-isolation tests.** Require release tests to inject a function instead of changing `PATH`, record every requested `gh` argument, and fail if the production runner is called. Add Windows resolver cases for Git-for-Windows `cmd\git.exe -> bin\bash.exe`, an explicit verified override, rejection of `System32\bash.exe`, and an unavailable-shell result.

  ```ts
  const runGh = vi.fn(() => ({ status: 0, stdout: JSON.stringify([[release]]), stderr: '' }))
  const result = resolveRelease(args, { runGh })
  expect(runGh).toHaveBeenCalledWith(['api', '--paginate', '--slurp', endpoint])
  ```

- [ ] **Step 2: Confirm RED.** Run:

  ```powershell
  npm run test:unit -- tests/installers/release-state.test.ts tests/support/posix-shell.test.ts tests/installers/install-script.test.ts
  ```

  Expected: release tests still spawn a host executable and installer tests still use bare `sh`/`bash`.

- [ ] **Step 3: Separate release resolution from its CLI adapter.** Export `resolveRelease(arguments_, { runGh, readInput })`; return output text and an exit classification rather than writing globals inside the core. Keep the direct CLI adapter as the only code that calls literal `spawnSync('gh', ..., { shell: false })`. Detect direct execution with `pathToFileURL(process.argv[1]).href === import.meta.url`. The test suite imports the core and injects `runGh`; `validate-json` asserts `runGh` is never called. Never add an environment-variable executable override to production release code.

- [ ] **Step 4: Resolve a real POSIX shell explicitly.** Implement `resolvePosixShell()` so Windows checks a test override and Git-for-Windows candidates derived from `where.exe git` plus `C:\Program Files\Git\bin\bash.exe`, accepts only an executable whose `--version` identifies GNU bash, and rejects the WSL launcher. Replace all bare `spawnSync('sh'...)` and `spawnSync('bash'...)` calls with the resolved executable. In CI, absence is a failure; locally, Unix-installer-only tests skip with the exact reason while PowerShell installer tests remain mandatory. Include `timeout` and verify `result.error` before deleting temporary directories.

- [ ] **Step 5: Run GREEN and prove no network-capable host tool was reached.** Run:

  ```powershell
  npm run test:unit -- tests/installers/release-state.test.ts tests/support/posix-shell.test.ts tests/installers/install-script.test.ts
  ```

  Expected: no test creates `gh.cmd`, no real release is observed, Git Bash is used on this machine, and cleanup completes without `EBUSY`.

- [ ] **Step 6: Commit.**

  ```powershell
  git add scripts/resolve-release.mjs tests/installers/release-state.test.ts tests/installers/install-script.test.ts tests/support/posix-shell.ts tests/support/posix-shell.test.ts
  git commit -m "test: isolate Windows installer tooling"
  ```

## Task 3: Launch all background native children without console windows

**Files:**

- Create: `src-tauri/src/native_process.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/git/runner.rs`
- Modify: `src-tauri/src/contracts.rs`

- [ ] **Step 1: Write failing flag and process-tree tests.** In `native_process.rs`, test the pure flag selector under `cfg(windows)`:

  ```rust
  assert_eq!(background_creation_flags(), CREATE_SUSPENDED | CREATE_NO_WINDOW);
  ```

  Retain the existing job-object timeout tests and add one harmless child command for each Git and Hermes runner path that records no visible console-capable launch while still proving descendants terminate on timeout.

- [ ] **Step 2: Confirm RED.** Run:

  ```powershell
  cargo test --manifest-path src-tauri/Cargo.toml native_process
  cargo test --manifest-path src-tauri/Cargo.toml runner
  cargo test --manifest-path src-tauri/Cargo.toml contracts
  ```

  Expected: the shared policy does not exist and current flags omit `CREATE_NO_WINDOW`.

- [ ] **Step 3: Implement one launch policy.** `background_creation_flags()` returns `CREATE_SUSPENDED | CREATE_NO_WINDOW` on Windows. Both runners call it immediately before `spawn`; keep `CREATE_SUSPENDED` so the child is assigned to the job object before resume. Keep Unix process groups unchanged, standard streams piped/null as today, and do not use `cmd.exe`, PowerShell, or `shell(true)`.

- [ ] **Step 4: Run GREEN.** Repeat the focused tests and manually open a Git workspace plus run a Hermes contract refresh from the debug app while watching for console flashes.

- [ ] **Step 5: Commit.**

  ```powershell
  git add src-tauri/src/native_process.rs src-tauri/src/lib.rs src-tauri/src/git/runner.rs src-tauri/src/contracts.rs
  git commit -m "fix: hide Windows background child processes"
  ```

## Task 4: Separate canonical paths from Windows presentation and subprocess paths

**Files:**

- Create: `src-tauri/src/platform_paths.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/workspace/mod.rs`
- Modify: `src-tauri/src/startup.rs`
- Modify: `src/lib/native/types.ts`
- Modify: `src/lib/workspace/recent-workspaces.ts`
- Modify: `src/lib/workspace/recent-workspaces.test.ts`

- [ ] **Step 1: Write failing path-boundary tests.** Add Windows Rust cases for:

  ```text
  \\?\C:\Work\flows       -> C:\Work\flows
  \\?\UNC\server\share   -> \\server\share
  \\.\PhysicalDrive0     -> rejected for public/subprocess conversion
  ```

  Add startup/workspace tests proving the canonical path remains verbatim for identity checks while the serialized `rootPath`, startup path, and recent record are normalized. Add TypeScript migration tests proving prefixed and unprefixed forms deduplicate to one newest record.

- [ ] **Step 2: Confirm RED.** Run the focused Rust startup/workspace tests and `npm run test:unit -- src/lib/workspace/recent-workspaces.test.ts src/lib/native/workspace-api.test.ts`.

- [ ] **Step 3: Implement the boundary.** Add:

  ```rust
  pub(crate) fn public_path(path: &Path) -> io::Result<PathBuf>;
  pub(crate) fn subprocess_path(path: &Path) -> io::Result<OsString>;
  ```

  On Windows, strip only `Prefix::VerbatimDisk` and `Prefix::VerbatimUNC`; reject device namespaces and non-absolute conversions. On other platforms, return the input unchanged. `WorkspaceScope`, `Handle`, watchers, and revision checks retain canonical paths. `WorkspaceRootInfo`, startup arguments, and recent JSON use `public_path`; Task 7 applies `subprocess_path` at the Git process boundary.

- [ ] **Step 4: Fix recent availability without weakening identity.** Recanonicalize the stored public path, verify it is a directory, and compare canonical identities/paths rather than requiring `canonical == requested`. Normalize records during load/save and preserve the newest timestamp when migration collapses duplicates.

- [ ] **Step 5: Run GREEN.** Run all focused tests and inspect a real workspace title/recent record; neither may contain `\\?\`. Confirm long Windows paths still open because authority remains canonical internally.

- [ ] **Step 6: Commit.**

  ```powershell
  git add src-tauri/src/platform_paths.rs src-tauri/src/lib.rs src-tauri/src/workspace/mod.rs src-tauri/src/startup.rs src/lib/native/types.ts src/lib/workspace/recent-workspaces.ts src/lib/workspace/recent-workspaces.test.ts
  git commit -m "fix: normalize Windows path boundaries"
  ```

## Task 5: Restore YAML permissions through the committed file handle

**Files:**

- Modify: `src-tauri/src/native_fs.rs`
- Modify: `src-tauri/src/workspace/files.rs`

- [ ] **Step 1: Extend the failing real-filesystem regression.** Cover an ordinary overwrite, a read-only overwrite, identity replacement immediately before restore, restore failure rollback, original-byte preservation, and absence of temporary/quarantine residue. Keep `writes_are_revision_checked_atomic_and_preserve_permissions` as the main regression name.

- [ ] **Step 2: Confirm RED on Windows.** Run:

  ```powershell
  cargo test --manifest-path src-tauri/Cargo.toml workspace::tests::writes_are_revision_checked_atomic_and_preserve_permissions -- --exact --nocapture
  ```

  Expected: permission restoration returns OS error 5.

- [ ] **Step 3: Reopen the verified handle for attributes.** After opening the committed file and comparing its `Handle` identity, call a Windows-only helper that uses `ReOpenFile` on that exact raw handle with `FILE_WRITE_ATTRIBUTES` and `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`, wraps the returned owned handle, and applies the prior permissions. Do not reopen by ambient path. Unix retains `file.set_permissions`.

- [ ] **Step 4: Run GREEN and the full workspace suite.**

  ```powershell
  cargo test --manifest-path src-tauri/Cargo.toml workspace::tests
  ```

  Expected: revisions, atomic replacement, read-only restoration, rollback, and adversarial identity checks all pass.

- [ ] **Step 5: Commit.**

  ```powershell
  git add src-tauri/src/native_fs.rs src-tauri/src/workspace/files.rs
  git commit -m "fix: restore Windows workspace permissions by handle"
  ```

## Task 6: Close custom-brand staging handles before atomic publication

**Files:**

- Modify: `src-tauri/src/branding.rs`

- [ ] **Step 1: Add a real Windows regression.** Import a complete custom brand into a real temporary app-data tree, assert its manifest/assets and identity after publication, assert no `.tmp` directory remains, and retain the adversarial root/staging replacement tests.

- [ ] **Step 2: Confirm RED.** Run the exact new import test on Windows; expect sharing violation OS error 32 at the rename.

- [ ] **Step 3: Make the staging lifecycle explicit.** Store `directory: Option<Dir>`. Expose `directory()` only while writing and `close_for_commit()` that verifies the named identity, takes/drops the open `Dir`, and retains `{ name, identity, active }` for rename and cleanup. After the capability-scoped rename, disarm cleanup and revalidate the published directory identity. `Drop` removes only an active uncommitted staging name.

- [ ] **Step 4: Run GREEN.**

  ```powershell
  cargo test --manifest-path src-tauri/Cargo.toml branding::tests
  ```

  Expected: normal import, replacement attacks, quota checks, cleanup, activation, and removal all pass.

- [ ] **Step 5: Commit.**

  ```powershell
  git add src-tauri/src/branding.rs
  git commit -m "fix: publish brand packs after closing Windows handles"
  ```

## Task 7: Make Git mutation paths valid for Windows subprocesses

**Files:**

- Modify: `src-tauri/src/git/runner.rs`
- Modify: `src-tauri/src/git/tests.rs`
- Modify: `src-tauri/tests/git_integration.rs`

- [ ] **Step 1: Write failing command-boundary and integration cases.** Inspect built command args/env and require `-C`, `GIT_INDEX_FILE`, hook message paths, and commit message paths to use `subprocess_path`. Add real repositories covering pair version creation, tracked single/pair move, Unicode workspace/file names, linked worktrees, and preservation of unrelated index entries.

- [ ] **Step 2: Confirm RED.** Run:

  ```powershell
  cargo test --manifest-path src-tauri/Cargo.toml --test git_integration -- --nocapture
  ```

  Expected: Git reports it cannot create a `\\?\...lock` file; the test harness must recover from a failed case without poisoning later mutex users.

- [ ] **Step 3: Convert only at process construction.** Apply `subprocess_path` to all path-valued arguments and environment variables in `build_read_command`, `build_mutation_command`, `mutation_arguments`, and `run_mutation_with_index`. Keep canonical paths in `AuthorizedGitContext`, temporary-file ownership, identity bindings, and cleanup. Propagate conversion errors as a stable `git_path_unsupported` error before spawning Git.

- [ ] **Step 4: Run GREEN and Git unit tests.**

  ```powershell
  cargo test --manifest-path src-tauri/Cargo.toml git::tests
  cargo test --manifest-path src-tauri/Cargo.toml --test git_integration -- --test-threads=1
  ```

  Expected: all ten original integrations plus Unicode and linked-worktree regressions pass, and no `.lock`/candidate index remains.

- [ ] **Step 5: Commit.**

  ```powershell
  git add src-tauri/src/git/runner.rs src-tauri/src/git/tests.rs src-tauri/tests/git_integration.rs
  git commit -m "fix: pass Windows-safe paths to Git"
  ```

## Task 8: Perform one Git discovery generation when a folder opens

**Files:**

- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/workspace/mod.rs`
- Modify: `src/lib/native/types.ts`
- Modify: `src/features/workspace/workspace-actions.ts`
- Modify: `src/features/workspace/workspace-actions.test.ts`
- Modify: `src/stores/git.ts`
- Modify: `src/features/version-control/git-lifecycle.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`

- [ ] **Step 1: Write failing discovery-count tests.** Introduce a test-only Git runner probe/counter and assert workspace activation performs one bounded discovery sequence, returns its public repository result, and the renderer requests status without another `gitDetect`. Add controller tests proving a superseded workspace generation cannot publish or start pair inspection.

  ```ts
  expect(native.gitDetect).not.toHaveBeenCalled()
  expect(native.gitStatus).toHaveBeenCalledTimes(1)
  expect(gitState.get().inspection.repository).toEqual(selected.repository)
  ```

- [ ] **Step 2: Confirm RED.** Run the focused Rust workspace/Git tests and:

  ```powershell
  npm run test:unit -- src/features/workspace/workspace-actions.test.ts src/features/version-control/git-lifecycle.test.ts src/app/App.test.ts
  ```

  Expected: `workspace_set_root` discards detected repository information and `App.svelte` starts both explicit and reactive refreshes.

- [ ] **Step 3: Collapse and return the existing discovery result.** Add one `ReadOperation::RepositoryContext` using a single `git rev-parse --path-format=absolute --show-toplevel --absolute-git-dir --git-common-dir --abbrev-ref=strict HEAD` subprocess for the normal attached-branch case. Parse its ordered lines into `DetectedRepository { repository, metadata }`; only a detached `HEAD` requires the existing bounded short-OID follow-up. The watcher receives metadata and `WorkspaceRootInfo` serializes `repository`. Do not introduce cached Git authority beyond the active workspace generation.

- [ ] **Step 4: Seed and coalesce the renderer lifecycle.** Add `activateWorkspace(workspaceId, repository)` to the Git inspection controller. It increments the generation, revokes stale authorizations, seeds the repository, and requests only status. Pair selection upgrades that same generation to pair inspection. Remove `gitController.reset(); void refreshGitRepository()` from `openWorkspacePath`; make the single reactive lifecycle consume the selected workspace result. Startup uses the same path.

- [ ] **Step 5: Measure GREEN behavior.** Run focused tests, then collect ten debug-native folder-open timings. Acceptance: one discovery generation, no console flash, no duplicate detect, no stale publication, and median Git workspace activation below 400 ms in the same repository where the four-probe baseline was about 1.05 s. Record raw timings in the verification document created in Task 13.

- [ ] **Step 6: Commit.**

  ```powershell
  git add src-tauri/src/git/mod.rs src-tauri/src/workspace/mod.rs src/lib/native/types.ts src/features/workspace/workspace-actions.ts src/features/workspace/workspace-actions.test.ts src/stores/git.ts src/features/version-control/git-lifecycle.test.ts src/app/App.svelte src/app/App.test.ts
  git commit -m "perf: coalesce workspace Git discovery"
  ```

## Task 9: Remove global canvas-store work from pointer-move frames

**Files:**

- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `src/stores/canvas.test.ts`
- Modify: `tests/e2e/canvas-capacity.spec.ts`
- Modify: `tests/e2e/loop-group-authoring.spec.ts`

- [ ] **Step 1: Write failing interaction-boundary tests.** Subscribe to `$canvasPositions`, dispatch 100 drag-move events, and assert zero durable publications until drag stop and exactly one at stop. Cover single-node, multi-selection, loop-scope, cancelled/unmounted drag, keyboard nudge, and persistence count.

  ```ts
  expect(positionPublications).toBe(0)
  dispatchDragStop(finalPositions)
  expect(positionPublications).toBe(1)
  expect(layoutSaves).toBe(1)
  ```

- [ ] **Step 2: Confirm RED.** Run `npm run test:unit -- src/features/canvas/GraphCanvas.test.ts src/stores/canvas.test.ts`; current drag moves publish on every event.

- [ ] **Step 3: Keep transient drag state local.** Let Svelte Flow own live node positions. `handleDrag` records only the pointer metric and the latest bounded drag detail in component-local state; it must not increment layout revision, clone the position map, invalidate routing repeatedly, or publish Nanostores. `handleDragStart` invalidates routing once. `handleDragStop` derives the final selected-node positions, publishes once with `moveCanvasPositions`, advances revision once, and schedules one layout persistence write. Clear pending state on cancel/unmount/workflow change.

- [ ] **Step 4: Run correctness and performance GREEN.** Run focused unit tests and the drag portions of both E2E specs with perceptual performance enabled. Acceptance: no YAML/validation/layout/Git/native calls during pointer moves and no >50 ms main-thread task across five consecutive 250-node root and hidden-loop drag runs.

- [ ] **Step 5: Commit.**

  ```powershell
  git add src/features/canvas/GraphCanvas.svelte src/features/canvas/GraphCanvas.test.ts src/stores/canvas.test.ts tests/e2e/canvas-capacity.spec.ts tests/e2e/loop-group-authoring.spec.ts
  git commit -m "perf: publish canvas positions at drag completion"
  ```

## Task 10: Profile and bring Arrange Graph inside the Windows capacity contract

**Files:**

- Create: `src/lib/metrics/arrange-metrics.ts`
- Create: `src/lib/metrics/arrange-metrics.test.ts`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `src/workers/layout-client.ts`
- Modify: `src/workers/layout-client.test.ts`
- Modify: `src/workers/layout-worker.ts`
- Modify: `src/workers/layout-worker.test.ts`
- Modify: `tests/e2e/canvas-capacity.spec.ts`

- [ ] **Step 1: Add bounded phase evidence before optimizing.** Record `measure`, `fingerprint`, `serialize`, `worker`, `validate`, `publish`, `fit`, and `persist` durations for only the most recent arrange request. Expose them through the existing E2E metrics surface; do not log workflow content or retain unbounded samples. Add tests for cancellation/supersession and total/phase consistency.

- [ ] **Step 2: Confirm the baseline bottleneck.** Run the 250-node/500-edge arrange case five times with performance enforcement on. Save phase timings and long-task entries. If the worker phase is dominant, proceed with Step 3a; if renderer measurement/publish is dominant, proceed with Step 3b; execute both when each exceeds 20% of total. This is an evidence gate, not permission to relax acceptance.

- [ ] **Step 3a: Bound worker work.** Reuse one warmed worker, preserve compact frozen request snapshots, cache the last accepted result by full layout identity/fingerprint, and reject stale responses without restarting a worker unnecessarily. Keep ELK and graph routing entirely inside `layout-worker.ts`. Add a worker test showing identical topology/dimensions hits the bounded cache while any identity, node size, edge, or scope change misses.

- [ ] **Step 3b: Bound renderer work.** Cache measured dimensions by `{workflowIdentity, scopeKey, nodeId, renderedKind}`; only offscreen-mount nodes without a valid measurement; reveal all missing cards in one containment layer and yield between bounded batches without remapping the full node/edge arrays per card batch. Prepare positions/routes offscreen and retain the existing single-turn accepted publication. Invalidate dimensions on ResizeObserver changes, content/kind changes, workflow/scope changes, and disposal.

- [ ] **Step 4: Keep failure semantics.** The client timeout stays 5,000 ms. Superseded/cancelled requests cannot publish, invalid routes fail closed, the original graph remains usable on failure, and no YAML mutation occurs.

- [ ] **Step 5: Run GREEN.** Run unit tests, `tests/performance`, and five consecutive Windows Chromium capacity runs. Acceptance for every warmed run: result accepted within 3,000 ms, no main-thread task >50 ms, no timeout, correct 250 nodes/500 edges, stable routing, one persistence publication, and zero pointer-frame forbidden work.

- [ ] **Step 6: Commit.**

  ```powershell
  git add src/lib/metrics/arrange-metrics.ts src/lib/metrics/arrange-metrics.test.ts src/features/canvas/GraphCanvas.svelte src/features/canvas/GraphCanvas.test.ts src/workers/layout-client.ts src/workers/layout-client.test.ts src/workers/layout-worker.ts src/workers/layout-worker.test.ts tests/e2e/canvas-capacity.spec.ts
  git commit -m "perf: meet Windows routed-layout capacity"
  ```

## Task 11: Reduce cold renderer work and clear dependency advisories

**Files:**

- Create: `scripts/check-bundle-budget.mjs`
- Create: `tests/project/bundle-budget.test.ts`
- Create: `src/app/DeferredSurface.svelte`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `src/lib/docs/guide-sources.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing bundle-budget and deferred-loading tests.** Parse `.vite/manifest.json` plus emitted assets and require the initial entry closure to exclude documentation markdown, settings/brand editors, example gallery, Git history UI, CodeMirror, Svelte Flow, and ELK until their surface is requested. Set an initial-entry budget of 2.0 MB minified and 450 KB gzip and retain the existing assertion that ELK is worker-only.

- [ ] **Step 2: Confirm RED and record cold startup.** Run `npm run build`, the new budget test, and ten native welcome launches measuring process start to first interactive welcome frame. Record median/p95 and emitted chunk sizes.

- [ ] **Step 3: Add real lazy boundaries.** `DeferredSurface.svelte` accepts a memoized dynamic importer and renders an accessible busy state until resolved. Convert documentation guide `import.meta.glob` to lazy imports. Dynamically import cold-only documentation, examples, settings/branding, and Git activity components on first activation and cache the loaded module. Keep bundled content local so all deferred surfaces work offline. If CodeMirror or Svelte Flow is still in the welcome closure, defer the entire inactive YAML or visual editor subtree at its existing mode boundary without changing document/canvas stores.

- [ ] **Step 4: Upgrade vulnerable packages one direct dependency at a time.** Update `dompurify` to the patched compatible release and `ajv`/its resolved `fast-uri` to a patched compatible release; run sanitizer, schema, contract, offline, and CSP tests after each lockfile change. Then update vulnerable dev-only packages within compatible majors and run their owning suites. Do not run `npm audit fix --force` and do not suppress advisories.

- [ ] **Step 5: Run GREEN.**

  ```powershell
  npm run build
  npm run test:unit -- tests/project/bundle-budget.test.ts src/lib/branding/sanitize-assets.test.ts src/lib/branding/csp.test.ts
  npm audit --omit=dev
  npm audit
  ```

  Expected: budget passes, production audit reports zero known vulnerabilities, full audit reports zero or a documented upstream-only dev advisory with no patch. Cold welcome median must not regress and should improve by at least 20% or remain below one second on the reference machine.

- [ ] **Step 6: Commit.**

  ```powershell
  git add scripts/check-bundle-budget.mjs tests/project/bundle-budget.test.ts src/app/DeferredSurface.svelte src/app/App.svelte src/app/App.test.ts src/lib/docs/guide-sources.ts vite.config.ts package.json package-lock.json
  git commit -m "perf: defer cold renderer surfaces"
  ```

## Task 12: Promote Windows to a full CI and practical E2E gate

**Files:**

- Modify: `package.json`
- Modify: `playwright.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/project/toolchain-contract.test.ts`
- Modify: `tests/project/e2e-performance-policy.test.ts`

- [ ] **Step 1: Write failing workflow-contract tests.** Require Windows CI to run full locked Rust tests, native Git integration, line-ending/installer tests, a production build/bundle budget, and functional Chromium E2E. Require a distinct reference-performance command that cannot set `WORKFLOW_STUDIO_PERCEPTUAL_PERFORMANCE=off`.

- [ ] **Step 2: Add explicit commands.** Add scripts equivalent to:

  ```json
  {
    "test:e2e:functional:windows": "playwright test --project=chromium --grep-invert @reference-performance",
    "test:e2e:performance:windows": "playwright test --project=chromium --grep @reference-performance",
    "bundle:check": "node scripts/check-bundle-budget.mjs dist/.vite/manifest.json"
  }
  ```

  Tag only hardware-sensitive capacity/long-task cases `@reference-performance`; functional capacity, accessibility, keyboard, modal, Git, workspace, and branding behavior stays in the Windows hosted-runner suite.

- [ ] **Step 3: Shorten feedback without hiding coverage.** Define Playwright projects/spec groups that can use separate ports and isolated E2E state. Run safe groups concurrently as separate CI jobs while retaining `workers: 1` within each group. Chromium is the native Windows functional engine; WebKit remains renderer coverage on Linux/macOS and is not described as native Windows coverage. Keep retry/trace evidence and never share a dev-server port.

- [ ] **Step 4: Expand Windows CI.** Replace the four focused Rust commands with:

  ```powershell
  cargo +1.88.0 test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1
  npm run test:e2e:functional:windows
  npm run build
  npm run bundle:check
  ```

  Keep the Tauri debug bundle step. Upload Rust logs, Playwright traces/screenshots, bundle manifest, and test results on failure. Continue running Linux quality and both Chromium/WebKit renderer suites.

- [ ] **Step 5: Run local GREEN.** Run workflow-contract tests, full Windows Rust, installer tests, unit suite, functional Chromium shards, build, and bundle check. Confirm the functional Windows wall clock is bounded enough for iteration and no spec silently disappeared.

- [ ] **Step 6: Commit.**

  ```powershell
  git add package.json playwright.config.ts .github/workflows/ci.yml tests/project/toolchain-contract.test.ts tests/project/e2e-performance-policy.test.ts
  git commit -m "ci: make Windows a full platform gate"
  ```

## Task 13: Run comprehensive verification and packaged Windows UAT

**Files:**

- Create: `docs/verification/2026-09-14-windows-primary-stabilization.md`
- Modify only if evidence reveals a regression: the owning test/implementation files from Tasks 1–12, using a new red test and a separate fix commit

- [ ] **Step 1: Verify the working tree and toolchain.** Record `git status --short`, `git diff --check`, `node --version`, `npm --version`, `rustc +1.88.0 --version`, `cargo +1.88.0 --version`, `git --version`, Windows build, CPU, RAM, display resolution, DPI, and WebView2 version.

- [ ] **Step 2: Run all static, contract, unit, and native gates.** Run:

  ```powershell
  npm ci
  npm run format:check
  npm run lint
  npm run check
  npm run contracts:check
  npm run examples:check
  npm run resources:verify
  npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1
  cargo +1.88.0 test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1
  npm run build
  npm run bundle:check
  npm audit --omit=dev
  ```

- [ ] **Step 3: Run renderer and reference performance gates.** Run all Windows functional Chromium shards with perceptual enforcement off only where the hosted-style functional command specifies it. Then run `npm run test:e2e:performance:windows` on the reference machine with enforcement on for five consecutive passes. Record raw drag/arrange phases, long tasks, and wall times. Run the Linux/macOS CI suites before claiming cross-platform compatibility.

- [ ] **Step 4: Build the packaged app.** Run `npx --no-install tauri build --debug --config src-tauri/tauri.ci.conf.json` for automated bundle checks, then the release-mode Windows bundle command used by the protected release workflow. Verify PE GUI subsystem, bundled resources, signatures/checksums where applicable, and absence of console windows.

- [ ] **Step 5: Obtain the user's UAT safety confirmation.** Stop before launching/replacing the installed app. Ask the user to save work and close Workflow Studio. Back up the exact real application-data and installation directories with timestamps and hashes; record restore instructions. Do not rely on `APPDATA` redirection because Known Folder resolution can ignore it.

- [ ] **Step 6: Perform packaged Windows UAT.** On the release candidate, test clean launch, existing-state migration, welcome UI, open folder, recent-path display, create/open/edit/save/reopen YAML, read-only overwrite behavior, external change, local Git status/history/version/move, custom brand import/activate/remove, 250-node root and loop-scope drag, Arrange Graph, keyboard navigation, 100% and 200% effective scale, reduced motion, restart persistence, offline launch, and idle CPU/memory/handles. Confirm no terminal flashes and no `\\?\` user-visible paths. Restore or retain user data exactly as agreed.

- [ ] **Step 7: Write the evidence record.** The verification document must include a requirement-to-evidence table for W1–W18, exact commands and exit codes, test counts, machine/build details, raw timing tables, bundle/audit results, screenshots/log locations, known limitations, backup/restore outcome, and the exact reviewed commit SHA. No claim may rely only on an earlier run.

- [ ] **Step 8: Request review and stop before release.** Use `superpowers:requesting-code-review`, resolve findings with TDD, rerun affected and full gates, and use `superpowers:verification-before-completion`. Commit only the evidence:

  ```powershell
  git add docs/verification/2026-09-14-windows-primary-stabilization.md
  git commit -m "docs: record Windows stabilization verification"
  ```

  Present the reviewed branch, commits, remaining limitations, and rollback instructions. Ask for explicit approval before merging to `base`, tagging, publishing, or installing over the user's current application.

## Definition of done

- [ ] Every W1–W18 row has passing automated or packaged-UAT evidence linked in the verification record.
- [ ] A normal Windows checkout passes formatting and exact-byte/string tests without changing global Git configuration.
- [ ] Full Rust and Git integration suites pass on Windows; YAML overwrite and custom-brand import pass on real Windows filesystems.
- [ ] Git/Hermes children never flash a console and their timeout process trees still terminate.
- [ ] Canonical capability paths remain internal; no supported UI, startup, recent, or Git subprocess boundary leaks `\\?\`.
- [ ] Folder activation starts one Git discovery generation and meets the measured latency target.
- [ ] Five consecutive reference runs meet the 50 ms pointer/long-task and three-second warmed Arrange Graph contracts at 250 nodes/500 edges.
- [ ] The initial renderer closure meets its budget, production audit is clean, and the app remains fully offline.
- [ ] Windows CI runs full native plus functional renderer coverage while Linux/macOS gates remain green.
- [ ] Packaged Windows UAT passes at 100% and 200% effective scale with restart persistence and no user-data loss.
- [ ] The branch is release-ready, but no merge, tag, publication, or installed-app replacement occurred without explicit user approval.
