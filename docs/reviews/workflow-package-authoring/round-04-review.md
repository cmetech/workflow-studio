# Independent adversarial review — round 04

## Identity, independence, and disposition

**Verdict: BLOCK.** Findings: **0 Critical, 1 Important, 2 Minor**. The Important finding violates the explicit local-only Git boundary. Passing tests below do not override it. Verification is bounded and has the platform and inspection gaps listed below; this is not a clean release certification.

- Feature start: `b79d4b1646cb93b47ddab2bf695fc614caf5814e`.
- Candidate: `cf1fe25bee98369ed138b8f5dd2206cd830ed4d1`.
- Candidate tree: `2220a282762e90394f0a94e2c4612d62f756b18f`.
- Read-only agent source: `3e89c2659b6e9c95a627b8f819ff63a11529d86a`, read with `git show` from the designated sibling checkout.
- Worktree: `C:/Users/ecorell/Developer/work/cmetech/github.com/cmetech/workflow-studio/.worktrees/workflow-package-authoring`.
- Instructions: `round-04-prompt.md`, applicable AGENTS instructions, binding foundation/design/reconciliation/plan, pinned contracts and vectors. The round emphasis did not limit inspection to Git.

At entry, the tracked working tree and index were clean; the round prompt was untracked. HEAD, tree, feature-start ancestry, and changed-path inventory matched the prompt. All 18 binding SHA-256 values matched. Immediately before report creation, HEAD/tree were unchanged, `git diff --exit-code` and `git diff --cached --exit-code` were clean, ancestry returned 0, and all 18 hashes matched again. No scope error was found. An initial unquoted PowerShell tree-expression lookup was malformed; the quoted lookup succeeded and is the identity used here.

This report was frozen without reading earlier round reports, current-feature verification receipts, reconciliation of earlier findings, progress ledgers, or implementer explanations. The required contract-reconciliation document is a binding input, not a previous-round finding reconciliation. Only the pre-existing stabilization release boundary was consulted for accepted baseline limitations; none was applied as a waiver for a new package defect. No production source was edited, no sibling files were changed, and no delegation occurred. The parent granted an exclusive runner window. All test/build/probe jobs were serialized; only the already-running Vite 1433 server remained idle alongside non-browser jobs.

## Findings

### R04-01 — Important — Raw package Git reads can implicitly fetch from a promisor remote

**Candidate locations:** `src-tauri/src/git/runner.rs:508` (read-command construction), `:566` (environment setup), `:812` (`RawBlob` command); `src-tauri/src/git/package.rs:162` (read every committed package blob). Production entry points include `src/app/App.svelte:846` and `:875`.

**Trigger and complete path:** Open a repository with partial-clone/promisor configuration and a missing promised object needed for the selected package's committed baseline. This can occur when the working package is present but an older committed blob is not locally materialized. Select **Validate Package**, or validate within **Prepare Package**. `App.validateSelectedPackage` / `createPackagePreparationBackend.validate` calls `native.gitReadPackageContext`; the Tauri adapter invokes `git_read_package_context`; `PackageGitState::context` lists the committed package tree and calls `blob`; `blob` uses `ReadOperation::RawBlob`; `build_read_command` starts `git cat-file blob <oid>`.

The command disables fsmonitor/untracked cache, optional locks, prompts, and replace objects, but does not prohibit Git's lazy object fetch. `GIT_TERMINAL_PROMPT=0` prevents an interactive prompt; it does not make object lookup local-only. The operation enum's absence of an explicit fetch variant also does not prevent Git from spawning one internally.

**Observed result:** A bounded synthetic repository, configured with a promisor origin pointing only to a nonexistent local directory, caused the exact raw-read primitive to launch `git fetch origin --no-tags --no-write-fetch-head --recurse-submodules=no --filter=blob:none --stdin`. Trace also showed a shell and local `git-upload-pack` child. No network URL, credentials, user content, or workflow code was used. Repeating the same lookup with `GIT_NO_LAZY_FETCH=1` produced the expected missing-object error with no fetch child. Both lookups exited 128 because the object was absent; the different subprocess behavior is the evidence.

This is an actual remote-access attempt by the current command construction, even though the test origin was deliberately local and nonexistent. With an ordinary configured network promisor origin, the same production path delegates transport/authentication behavior to Git. Actual network contact and credential-helper execution were neither attempted nor claimed here. Package validation/preparation must instead fail closed when required objects are unavailable locally.

**Minimal reproduction:** Git used was `2.55.0.windows.3`. In a fresh temporary directory:

```powershell
git init --quiet $probeRoot
git -C $probeRoot config extensions.partialClone origin
git -C $probeRoot config remote.origin.promisor true
git -C $probeRoot config remote.origin.url (Join-Path $probeRoot 'absent-local-origin')
$env:GIT_TRACE='1'
$env:GIT_TERMINAL_PROMPT='0'
$env:GIT_OPTIONAL_LOCKS='0'
$env:GIT_NO_REPLACE_OBJECTS='1'
$env:GIT_PAGER='cat'
$env:LC_ALL='C'
git --literal-pathspecs -c core.fsmonitor=false -c core.untrackedCache=false -C $probeRoot cat-file blob 1111111111111111111111111111111111111111
# Trace: run_command: git ... fetch origin ... --filter=blob:none --stdin
# Exit 128, after local upload-pack attempts.
$env:GIT_NO_LAZY_FETCH='1'
git --literal-pathspecs -c core.fsmonitor=false -c core.untrackedCache=false -C $probeRoot cat-file blob 1111111111111111111111111111111111111111
# Exit 128; no fetch subprocess in trace.
```

The probe directory was `C:/Users/ecorell/AppData/Local/Temp/studio-round04-promisor-80468659c0dc4253bee3d1c9dbbe6a84`. The probe exercises the production Git primitive; full Tauri UI execution against a partial clone was not performed. The source path above establishes its reachability. This is a feature boundary failure, not an upstream marketplace limitation.

**Missing regression assertion:** A real temporary promisor repository with a missing baseline blob/tree must cause package context/preview to return a local missing-object failure without any fetch, transport, helper, or authentication subprocess. Cover every package read/mutation command capable of object materialization, not just a literal command-name denylist. Preserve the same assertion with ambient Git configuration present.

### R04-02 — Minor — A normal trailing newline in the commit message makes native preparation fail after writing generated files

**Candidate locations:** `src/features/packages/PreparePackageDialog.svelte:164`, `src/features/packages/package-preparation.ts:188`, `:209`, and `src-tauri/src/git/package.rs:374`.

**Trigger and complete path:** In an otherwise valid native package preparation, use a message such as `Prepare laptop 1.0.1` followed by a newline, or a leading/trailing space. The dialog accepts it because its gate checks `message.trim()` only for emptiness, then passes the original message to `PreparePackageController.prepare`. The backend writes the chosen manifest version, regenerates `digests.json` and the marketplace index, reads a fresh context, and requests `gitPreviewPackageVersion` with the untrimmed string. Rust returns `request.message.trim()` as the preview message. The TypeScript backend requires exact equality to the original untrimmed input and throws `git_preview_mismatch`.

**Wrong result and impact:** A legitimate nonempty textarea message cannot reach the final commit preview. The manifest/generated writes have already happened and remain disclosed through the preparation failure/recovery path. The user must change the message and revalidate as needed; retrying the same message cannot work. No commit or silent data loss is claimed. This is a deterministic cross-language contract mismatch rather than a timing concern.

**Evidence / reproduction:** Source inspection of the complete production path above establishes the invariant: for any accepted message `m` where `m.trim() !== m`, the native response is necessarily unequal to the caller's authorization input. Enter such a message at Version & Commit and choose the preparation preview action to reproduce in native Studio. This specific UI reproduction was not executed. The selected backend/controller tests passed, but the backend fixture returns `message: request.message`, so it does not reproduce the native normalization. The Rust fixtures inspected use already-trimmed messages.

**Missing regression assertion:** Exercise the real/native-compatible preview response with leading/trailing spaces and a trailing newline. Either normalize once before all preview/authorization comparisons, consistently showing the normalized message, or reject unsupported input before any writes. Assert that accepted input reaches a committable preview and that the message bound to the native authorization agrees with the displayed message.

### R04-03 — Minor — The package overview and package rows never expose their required Git change summary

**Candidate locations:** `src/features/packages/PackageOverview.svelte:52`, `src/features/packages/PackageTree.svelte:162`; caller `src/app/App.svelte:4194`. Requirement: package design sections 8.1 and 8.2, lines 173 and 184.

**Trigger and path:** Open a repository containing a previously versioned package, modify an included script, and select that package in Packages. The tree row renders ID/version/readiness only. The overview always renders `Not compared with a local Git version`. Validate Package obtains a Git context for readiness, but the overview has no change-summary input and still renders that constant. A proposed version is also absent from this overview; suggestions are available only later in preparation.

**Wrong result and impact:** The approved package activity requires local change counts, and the overview requires working changes compared with the last local Git version. Users cannot distinguish changed packages or inspect this comparison from those surfaces, including after validation. They must enter the preparation flow instead. The text is honest about not comparing, but the promised comparison is unimplemented. This is a small functional omission, not a request to redesign the UI.

**Evidence / reproduction:** The entire overview and the tree row rendering were inspected; the constant is unconditional and no prop/state supplies a Git comparison. The parent passes readiness and actions, not comparison data. The selected component/browser tests passed without asserting this required behavior. No additional custom browser reproduction was needed for this unconditional rendering invariant.

**Missing regression assertion:** After a committed package member changes, the package row shows the selected package's change count and its overview shows the exact added/modified/deleted paths versus the committed baseline. Verify a clean package, two packages with unrelated dirty state, an unborn repository, and refreshed state after a local package commit.

## Coverage inventory and boundary reasoning

The review covered every major feature area, but not every line or every platform branch. The following describes actual inspection and checks, rather than treating test names as proof of uninspected behavior.

| Surface | Independent inspection and bounded evidence |
| --- | --- |
| Authority and contracts | Binding design/plan/reconciliation; package and resource contract envelopes, provenance, vector-family structure and consumer tests; loader rejection paths; pinned byte comparison. Existing authoring schema/profile selection, YAML parsing, reference indexing, and DAG validation consumers were traced where package analysis enters them. No independently persisted graph authority was found in these paths. Full old authoring corpora were validated by the gate rather than manually inspected entry by entry. |
| Discovery and membership | Manifest parsing/editing, package paths, discovery, creation, authoring source selection, package catalog/controller, multiple member pairing, duplicate names, exact companion paths, nested roots, full tree limits, and generated index location. Create/copy/move and package mutation flows were examined with their expectations; selected unit and browser creation/copy/rename checks passed. |
| Resource semantics | Resource resolution, package references, authenticated body references, classification, static script/command analysis, readiness, package analysis capture/worker boundary, and resource-action coordinator. Reviewed source-origin limitations and fail-closed unsupported contexts. Missing packaged bytes are blockers; external tools/services/trust remain advisories. Selected tests include command/script/MCP and resolver behavior. |
| Editors and recovery | Artifact session/workspace controller, text/command/binary views, manifest editing, browser/native adapters, recovery storage integration, generated read-only routes, scoped source grants, and native-verified passive PNG boundary. Browser checks covered malformed draft restore/save, external changes, binary replacement, and workflow return focus. These do not prove native editor/OS integration. |
| Targeted mutations | Package mutation planning, resource actions, rename consumer updates, draft flush boundaries, transaction recovery disclosure, generated replacement, package capture/verification, and relevant pair/file write consumers. Native tests exercised staged-file failures, between-generated-write failure, postcommit source checks, stale membership, final traversal limits, and outside read-only expectations. |
| Exact digest/payload | Exact-byte hashing, sorted canonical paths, root-only digest exclusion, nested digest inclusion, ignored/unreferenced payloads, path aliases/casefold/NFC handling, membership recapture, aggregate budgets, index projection and unselected metadata reconciliation. Read generated/native checks and ran the package tests plus contract/resource gates. |
| Local Git | Read/mutation command construction, raw object operations, package context/preview/grants, isolated candidate index, shared index uniqueness and selected-entry checks, HEAD/index/membership rechecks, literal paths, filter/textconv/hooks/fsmonitor/signing avoidance, local identity, unborn commit, deletion baseline, exact selected commit paths, unrelated staged state. The 34-test native selection passed; the additional promisor probe falsified the no-remote claim despite those tests. |
| Version/repeat preparation | Contract-backed SemVer parsing uses BigInt, prerelease ordering and build-metadata-insensitive precedence; baseline version increase checks, suggestions, source capture authorization, repeated previews, single-use commit grants, and final preview comparisons were inspected and selected tests passed. Cross-layer message normalization remains R04-02. |
| Marketplace and trust | Pinned agent `plugins/workflow/marketplace/package.py`, `models.py`, relevant `service.py` paths, and `plugins/workflow/resources.py` were independently read at the pinned commit. Verified source expectations for exact distribution digest/index metadata, strict schemas, resolver separation, and a separate trust-review token bound to actor/profile/identity/distribution/review digest. No install or trust grant was performed. |
| UI/accessibility | Package tree/overview/inspector, preparation and authoring dialogs, resource controls, editors, and unchanged ModalShell focus/cancel mechanics inspected. Chromium package keyboard/reduced-motion journey passed, along with the other 13 selected journeys/checks. R04-03 records the missing summary. |
| Offline/release/docs/performance | All package app guides inspected, navigation/sanitized Markdown integration sampled, example copy/analysis and packaging scripts examined. Eight gates passed, including offline resource integrity, examples and bundle budget. Package Chromium 250-node/500-edge check passed under unchanged thresholds; pointer audit passed separately. This is not a fresh full canvas/startup/release-platform certification. |

**Inspection and execution gaps:** Unreviewed at full-file/line-by-line depth are the remainder of the large unchanged App shell outside package/artifact integration; unchanged canvas/layout/ELK implementation and standalone document operations beyond the consumers traced; deep lower-level filesystem/pair/Git helper branches outside the selected package paths; all CSS/visual states, OS menu/dialog/keyboard behavior, and every Svelte event interleaving; generated Unicode tables and complete authoring-corpus contents as manual data review; every test implementation and every example fixture byte as manual review; installer/update/setup internals beyond changed resources/packaging checks; and the rest of the upstream marketplace/compiler/runtime beyond the explicitly named acceptance/resource/trust paths. Changed types/stores/registries/configuration were followed through callers or gates where relevant, not independently exhaustively audited. These gaps are not evidence of defects, and cannot support PASS.

## Commands and actual outcomes

Commands used the repository worktree and Node prefix `C:/Users/ecorell/AppData/Local/loop24/node`. No dependencies were installed. All runners had exclusive serialized use of the lane.

1. `npx.cmd --no-install vitest run src/lib/packages src/lib/git/package-version-actions.test.ts src/features/packages src/features/artifacts src/lib/native/git-package-api.test.ts src/lib/native/transaction-recovery.test.ts --maxWorkers=1 --testTimeout=30000`
   - Exit 0: **50 files, 382 tests passed**, 340.61 seconds. The worker output was buffered until completion; no second runner was started.
2. `cargo test --manifest-path src-tauri/Cargo.toml git::package_tests -- --test-threads=1`
   - Exit 0 but **zero tests matched**; this gives no coverage and was corrected.
3. `cargo test --manifest-path src-tauri/Cargo.toml package_ -- --test-threads=1`
   - Exit 0: **34 passed, 0 failed**, 533.03 seconds. Main/integration binaries selected zero tests; 278 library tests were filtered out. Compiler warnings were emitted, not test failures.
4. Local promisor-object probe described under R04-01.
   - Unguarded raw read: exit 128 and fetch/upload-pack children observed. Guarded control: exit 128 without fetch children. No network origin was configured.
5. Sequential `npm.cmd run check`, `lint`, `contracts:check`, `package-contracts:check`, `examples:check`, `resources:verify`, `build`, `bundle:check`.
   - All eight exited 0. Svelte check: 0 errors/0 warnings. Package contract bytes matched the pinned upstream. Resource verification: **72 files**. Build completed with plugin-timing and ineffective-dynamic-import warnings. Initial renderer closure: **1,308,457 minified bytes / 341,141 gzip bytes**.
6. `npx.cmd --no-install playwright test tests/e2e/package-authoring.spec.ts tests/e2e/package-preparation.spec.ts tests/e2e/package-recovery.spec.ts tests/e2e/package-performance.spec.ts --project=chromium --workers=1 --retries=0 --reporter=list`
   - Environment: `CI=1`, `WORKFLOW_STUDIO_E2E_PORT=1433`, `WORKFLOW_STUDIO_E2E_REUSE_SERVER=true`; disposable output under `C:/Users/ecorell/AppData/Local/Temp/studio-round04-playwright`. Parent confirmed this server was the implementation worktree in e2e mode. No new server or threshold override.
   - Exit 0: **14 passed in 1.7 minutes**. Uses the repository's CI profile and existing per-test timeouts, zero retries.
   - Package performance: 250 nodes/500 edges, 104 files; first readiness **915.8 ms**, concurrent readiness **181.9 ms**, **30 pointer frames**, **0 authority frames**, no observed cold/concurrent long-task entries. These are one bounded Chromium sample, not a hardware-independent guarantee.
7. `npx.cmd --no-install vitest run tests/project/package-contract-parity.test.ts tests/project/package-documentation.test.ts tests/project/package-no-execution.test.ts tests/project/package-performance.test.ts src/app/App.resource-navigation.test.ts --maxWorkers=1 --testTimeout=30000`
   - Exit 0: **5 files, 17 tests passed**, 66.00 seconds. No source or hook-timeout changes.
8. Identity/cleanliness/18 checksum checks repeated before freeze, all matched as recorded above.

Aggregate selected TypeScript tests: **55 files / 399 passed**. The source execution audit passed, but it does not establish that a permitted Git executable cannot internally start a remote operation, as R04-01 demonstrates.

## Skipped checks and residual risks

- No additional full Vitest or full Rust suite was started, per bounded-review instructions. Native artifact-save, all pair races, linked-worktree variants, crash/power-loss recovery, cross-volume recovery storage, lock contention and every native command-dispatch test were not freshly executed by this reviewer unless covered by the selected filter above.
- Rust execution was on Windows only. Unix-only symlink/permission/descriptor cases are not executed by a Windows pass. Some filesystem tests conditionally return when symlink creation is unavailable; a green aggregate must not be read as proof of those branches. macOS/Linux filesystem and native UI behavior are UNVERIFIED.
- Browser tests used the e2e browser adapter. They cannot prove Tauri IPC serialization, OS file chooser/trash/reveal behavior, actual Git subprocess effects, native accessibility, screen-reader output, or installed-app release packaging. WebKit, manual screen-reader/high-contrast/native keyboard review, installer smoke tests and full visual inspection were not run.
- The package performance sample does not rerun the complete existing canvas acceptance matrix, startup, scoped Arrange/Back-to-root, or all viewports. Previously accepted stabilization exceptions are not extended by this report.
- Agent compatibility was checked against pinned source and bundled byte/vector contracts, not a new end-to-end remote installation. No network operations, external publishing, package execution or trust authorization were permitted. Agent source explicitly fails closed when descriptor-safe traversal is unavailable (`_HAS_DESCRIPTOR_WALK`); that pre-existing upstream/platform constraint must remain separate from Studio feature defects. Actual Windows marketplace acceptance is UNVERIFIED here.
- No finding is based solely on a missing test. R04-01 has an observed subprocess reproduction and a source-traced production path; R04-02 and R04-03 have deterministic source invariants. UI-specific reproductions of those two minor findings remain unexecuted.

The report is frozen on the stated candidate. Address R04-01 before accepting the local-only claim; reconcile the two smaller behavior gaps against the binding design and add boundary-level assertions before seeking a clean review.
