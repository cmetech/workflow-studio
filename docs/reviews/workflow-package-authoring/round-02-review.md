# Independent adversarial review — round 02

## Identity and verdict

- Candidate: `5f5350a40a3d6ff4cea689ecf449350776d6495a`
- Tree: `c273ea4fbdd0673e738ad73907c049f4284e8d55`
- Feature start: `b79d4b1646cb93b47ddab2bf695fc614caf5814e`
- Read-only agent reference: `3e89c2659b6e9c95a627b8f819ff63a11529d86a`
- Verdict: **BLOCK**.
- Counts: **0 Critical, 2 Important, 1 Minor**.

The candidate identity, all 18 binding SHA-256 values, and all 301 name/status inventory entries match the instantiated prompt. Tracked files were clean before review and after the runners. The only pre-existing untracked review artifact was `round-02-prompt.md`. No implementation, candidate refs, staging, or sibling checkout changes were made. This report was reached independently without reading earlier round reports, reconciliations, progress ledgers, or the current feature verification receipt. The required marketplace contract reconciliation is a binding input, not an earlier review reconciliation.

The blockers concern normal artifact saving and Unix artifact opening. Passing multi-file transaction tests do not establish safety of the separate single-artifact save path. Coverage limits below independently preclude a clean release verdict.

## Findings

### R02-01 — Important — ordinary artifact saves delete concurrent edits made through an already-open handle

**Location:** `src-tauri/src/workspace/files.rs:750` and `:786`, particularly identity-only deletion in `:1927`; feature entry point `src-tauri/src/workspace/artifacts.rs:292`.

**Production path:** Package text/manifest/script editor Save → `src/app/App.svelte:582` → `ArtifactWorkspaceController.startSave` (`src/features/artifacts/artifact-workspace-controller.ts:112`) → `workspaceWriteTextArtifact` → `workspace_write_text_artifact` (`artifacts.rs:561`) → `write_text` → `files::write_artifact_stream` → `write_stream_impl`.

**Trigger and invariant argument:** An external editor has an open writable handle to the saved artifact. Studio verifies the expected original bytes, moves the original to its quarantine sibling, and verifies the quarantined bytes. After that final content check (the explicit `post_quarantine_hook` boundary), the other editor writes new content through its existing handle. This changes the quarantined inode, not the staged Studio file. Studio installs its staged version and calls `remove_verified_name` on the quarantine. That function compares only file identity; the concurrently edited inode still has the expected identity, so its final filesystem name is removed. The function returns a successful save result. When the external handle closes, the external content has no remaining name or recovery location.

The TypeScript completion handler accepts the successful write and confirms the document as saved; there is no native conflict/retention receipt to surface. Watching the original path cannot recover bytes deleted from the quarantined inode. This violates the explicit requirement that racing writes must not silently lose user data.

**Evidence:** The bounded Linux primitive probe below reproduced the exact relevant hard-link/unlink and same-inode write sequence: only `script.py` remained, containing `studio`; `external` had no remaining name. This was a filesystem-semantics probe plus a production-source invariant argument, **not execution of the Rust artifact command**. The Windows workspace runner passed 103 tests, but those successes do not cover this late-write gap in ordinary artifact save. The separate `transaction_remove_with_hook` path at `files.rs:2249` retains a live inode before destructive cleanup; ordinary `write_stream_impl` does not use it.

**Classification:** The identity-only cleanup primitive existed before this feature. The feature newly exposes it for general package text artifacts and claims racing artifact edits are recoverable. This is an applicable feature integration defect involving a pre-existing Studio primitive, not an upstream agent limitation. Linux inode semantics were demonstrated; equivalent Windows sharing behavior was not independently reproduced.

**Missing regression:** Exercise the actual single-artifact write entry point with another handle writing after quarantine content verification, and also immediately before/after final cleanup. Assert either a conflict with both versions preserved or a durable, surfaced recovery name retaining the *live original inode*, including subsequent writes through that handle. A final hash check alone still leaves a later-write gap.

### R02-02 — Important — Unix special files can hang artifact I/O before regular-file rejection

**Location:** `src-tauri/src/workspace/artifacts.rs:179`–`:194` (blocking `open_with` before `metadata.is_file()`); `:145` accepts a non-link leaf without requiring a regular file.

**Production path:** A resource already listed in Packages is externally replaced with a FIFO; selecting it follows `App.svelte:516` → artifact controller `open` → `workspace_read_text_artifact` (`artifacts.rs:554`) → `read_text` → `snapshot` → `bind` → `open`. Package scanning and mutation inspection also consume `artifacts::open`, so a regular-file-to-FIFO replacement between enumeration and open has the same issue.

`OpenOptions::new().read(true).follow(FollowSymlinks::No)` does not request nonblocking access. A FIFO with no writer therefore blocks inside the open operation before the code can reject its non-regular metadata. `bind` rejects symlinks/reparse points but permits this leaf. The Tauri command is synchronous and runs inside `with_scope`, which retains the workspace state's mutex for the operation (`src-tauri/src/workspace/mod.rs:330`). The result is an indefinitely pending operation and blocked subsequent scope-dependent native work; file/byte/traversal ceilings cannot bound this wait.

**Evidence:** Read the actual installed `cap-primitives-3.4.5` sources: `fs/open_options.rs:58` initializes `nonblock: false`; `rustix/fs/oflags.rs:39` adds `NONBLOCK` only when requested. The Linux primitive probe below opened a synthetic FIFO using `O_RDONLY | O_NOFOLLOW | O_CLOEXEC`; it remained blocked and was killed after 500 ms. Adding `O_NONBLOCK` returned immediately and allowed `fstat` to identify the FIFO. This demonstrates the OS precondition and the production source establishes the call ordering; it is **not a Linux Rust/Tauri integration run**. The pinned upstream package reader separately uses nonblocking file-open flags, so this should not be attributed to upstream behavior.

**Missing regression:** A Unix-only bounded subprocess test of the actual native artifact read must reject a FIFO without a writer; also cover replacement of an enumerated regular file before open. The type check must operate on the opened handle without allowing opening a special file to block first. Preserve no-follow and size/identity checks.

### R02-03 — Minor — Escape hides the Add Artifact dialog while its operation remains busy

**Location:** `src/features/packages/PackageAuthoringDialogs.svelte:196`; unchanged consumer `src/app/ModalShell.svelte:95`–`:100`.

**Trigger and production path:** Open Add Artifact, start Create text artifact or a file import, then press Escape while its asynchronous operation is pending. The parent sets `busy = true` at line 123 and its `close()` returns early when busy (line 61). However, this ModalShell invocation passes `{busy}` without `dismissible={!busy}`. ModalShell defaults `dismissible` to true, handles Escape, and calls `closeDialog()` **before** invoking the parent's `onCancel`. Its `busy` prop only supplies `aria-busy`; it does not guard cancellation.

The native operation continues while the dialog is hidden. If it fails, the parent records the error/recovery receipt inside the still-mounted but closed dialog. Changing between `artifact`, `receipt`, and `recovery-error` uses the same conditional branch and does not rerun ModalShell's `onMount`/`showModal`. The user can consequently miss the operation failure or retained-file receipt. The ordinary Close button being disabled does not prevent the keyboard/backdrop route.

**Evidence:** This is a rigorous source control-flow argument, not a browser reproduction. Related Create, Import Workflow, Mutation, and Prepare dialogs explicitly pass `dismissible={!busy}`; the Add Artifact branch omits it. No claim is made that this issue itself deletes files.

**Missing regression:** Mount the production Add Artifact dialog with a deferred native operation, press Escape and click its backdrop while busy, reject with a recovery receipt, and assert the dialog stays open and exposes the error and exact recovery locations. Then verify normal dismissal/focus restoration after completion.

## Coverage inventory

The review covered the full feature at functional-path level, with deeper inspection of native filesystem and transaction code. This is not a claim that every changed line or every platform was exercised.

| Surface | Review performed |
| --- | --- |
| Binding design and contract | Read the required foundation/design/feature specification/reconciliation/plan in order; checked pinned provenance and binding hashes; inspected package contract and all shared vector families, including admission, compilation, discriminators, filesystem recipes, lookup and MCP candidates. Checked pinned upstream package file-open and resource semantics via `git show`, without using the sibling working tree as authority. |
| Discovery, manifests, integrity | Reviewed package discovery/path identity, manifest parsing, exact-byte digest calculation, supporting-file inventory, limits, marketplace-index validation, native capture tokens and mutation projection. Examined stale source identities, generated exclusions, exact traversal limits and directory identity handling. |
| Native files and transactions | Reviewed artifact binding/open/snapshot/source grants, scan paths, streaming ordinary save, no-clobber moves, staged writes/backups, rollback and failure receipts, generated-write source verification, app-data recovery retention, and related unchanged helpers. Checked same-inode changes, changed parent binding, unsupported links, partial rollback, retained originals and generated post-state verification. Windows workspace test filter exercised existing bounded fault-injection and temporary-filesystem cases. |
| Authoring and resources | Reviewed creation/import/mutations, authenticated references, resolver candidates/discriminators, selection/create/extract actions and coordinator, YAML mutation handoff, unknown/manual references, source hashes and expected candidate absences. Inspected scoped graph/node selection and App integration. |
| Artifact editor and drafts | Reviewed artifact controller save/recovery/external-change lifecycle, text/editor routing, static diagnostics, command parsing/preview, manifest source/inspector editing, binary routing and draft-preparation blockers. Ordinary save and Add Artifact cancellation yielded findings above. |
| Local preparation and Git | Reviewed analysis worker/controller, readiness, version actions, preparation backend/state/UI, captured revisions, generated output, final preview and authorizations. Reviewed native package Git/index/filter guard and relevant `mutate.rs` and `runner.rs` consumers: literal arguments, raw object creation, exact candidate/index handling, local commit boundary and hook/filter exclusion. |
| UI/accessibility/offline | Inspected package tree/actions, authoring/mutation/preparation dialogs, overview/inspector/readiness integration, shared ModalShell, command rendering and App routing. Reviewed bundled contract/example loading, example validation, selected recovery/install/publishing guides, offline documentation/no-execution tests and release asset/bundle configuration. |

**Explicitly unreviewed or incompletely verified surfaces:** No exhaustive fresh audit of every authoring-contract field/corpus entry, every bundled example payload, all fifteen guide texts, every changed UI/test file, or every unchanged document/canvas/native subsystem. Unchanged YAML transaction/DAG internals were followed through their feature callers rather than fully re-audited. Whole-App lifecycle and stylesheet behavior were sampled around package paths, not exhaustively checked. Upstream compiler/service/installer implementations were not fully audited; remote installation/trust were not exercised. Native watchers, crash/power-loss persistence, all device/filesystem combinations, macOS, Windows reparse-point privilege variants, and end-to-end desktop dialogs remain unverified. Browser focus/reduced-motion behavior and the 250-node/500-edge performance contract were not rerun. No PASS is inferred for these boundaries.

## Commands and actual results

All runners were coordinated in an exclusive test window. Commands used the candidate worktree, PowerShell `login:false`, and the pinned local Node installation. No dependencies were installed or network probes made.

1. `git status --short`, `git rev-parse HEAD 'HEAD^{tree}'`, `git diff --name-status b79d4b1646cb93b47ddab2bf695fc614caf5814e 5f5350a40a3d6ff4cea689ecf449350776d6495a`; PowerShell `Compare-Object` against the instantiated prompt's inventory and `Get-FileHash -Algorithm SHA256` for its binding table: candidate/tree match, 301/301 inventory entries with no differences, all 18 hashes match. An initial unquoted PowerShell `HEAD^{tree}` was rejected by Git argument parsing; the quoted command above succeeded.
2. `cargo test --offline --manifest-path src-tauri/Cargo.toml workspace:: -- --test-threads=1`: exit 0; **103 passed, 0 failed, 0 ignored**, 199 filtered out; test duration 205.34 seconds. Other test binaries selected zero tests. Windows-only run; Unix-gated code/tests excluded and privilege-dependent test branches are not evidence of all Windows symlink cases. Compiler emitted existing platform unused/dead-code warnings.
3. The exact selected Vitest command below: exit 0; **18 files passed, 204 tests passed**, duration 220.75 seconds (tests 16.69 seconds). No full suite was started.

```powershell
$env:PATH = 'C:/Users/ecorell/AppData/Local/loop24/node;' + $env:PATH
npx.cmd --no-install vitest run src/lib/packages/digest.test.ts src/lib/packages/paths.test.ts src/lib/packages/manifest.test.ts src/lib/packages/marketplace-index.test.ts src/lib/packages/resource-resolution.test.ts src/lib/packages/package-references.test.ts src/lib/packages/package-mutations.test.ts src/lib/packages/resource-actions.test.ts src/lib/packages/readiness.test.ts src/features/packages/package-preparation.test.ts src/features/packages/prepare-package-controller.test.ts src/features/packages/package-authoring-controller.test.ts src/features/packages/package-analysis-client.test.ts src/features/artifacts/artifact-workspace-controller.test.ts src/lib/native/transaction-recovery.test.ts tests/project/package-contract-parity.test.ts tests/project/package-no-execution.test.ts tests/project/package-documentation.test.ts --maxWorkers=1 --testTimeout=30000
```

4. `cargo test --offline --manifest-path src-tauri/Cargo.toml git::package -- --test-threads=1`: exit 0 but **zero matching tests**; no Git coverage claimed from this command. Corrected command: `cargo test --offline --manifest-path src-tauri/Cargo.toml package_tests:: -- --test-threads=1`: exit 0; **13 passed, 0 failed, 0 ignored**, 289 filtered out; test duration 587.80 seconds. Other test binaries selected zero tests. This exercised real temporary Git repositories for exact payload/index preservation, source generation changes, concurrent HEAD/index changes, no-op/unborn/deleted packages, shared-index scope and forbidden executable configuration. Unix-only marker assertions remain excluded on Windows.

5. Tiny Linux primitive probe: a PowerShell single-quoted here-string containing the Python program below was piped to `wsl.exe -d Ubuntu-22.04 -- python3 -`. Exit 0. It created only benign temporary files, killed its own blocked child at the deadline, and cleaned its temporary directories. It did not run workflow/package content or modify candidate source. This was run independently of the Windows runner because it is a tiny OS primitive probe, not a timing benchmark.

```python
import os, tempfile, subprocess, sys, stat
with tempfile.TemporaryDirectory(prefix='loop24-round02-') as root:
    fifo = os.path.join(root, 'artifact.txt')
    os.mkfifo(fifo)
    code = 'import os,sys; fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC); print("opened",flush=True); os.close(fd)'
    child = subprocess.Popen([sys.executable, '-c', code, fifo], stdout=subprocess.PIPE)
    try:
        child.communicate(timeout=.5)
    except subprocess.TimeoutExpired:
        child.kill(); child.communicate()
        print('O_RDONLY|O_NOFOLLOW|O_CLOEXEC FIFO open: blocked until killed at 500 ms')
    fd = os.open(fifo, os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK)
    print('nonblocking FIFO open: returned immediately; mode is FIFO:', stat.S_ISFIFO(os.fstat(fd).st_mode))
    os.close(fd)
with tempfile.TemporaryDirectory(prefix='loop24-round02-save-') as root:
    target = os.path.join(root, 'script.py')
    backup = os.path.join(root, '.original')
    staged = os.path.join(root, '.staged')
    with open(target, 'wb') as f: f.write(b'old')
    writer = open(target, 'r+b')
    original = os.fstat(writer.fileno()).st_ino
    with open(staged, 'wb') as f: f.write(b'studio')
    os.link(target, backup); os.unlink(target)
    with open(backup, 'rb') as f: assert f.read() == b'old'
    writer.seek(0); writer.write(b'external'); writer.truncate(); writer.flush(); os.fsync(writer.fileno())
    os.link(staged, target); os.unlink(staged)
    assert os.stat(backup).st_ino == original
    os.unlink(backup); writer.close()
    with open(target, 'r') as f:
        print('post-quarantine same-inode write plus identity-only cleanup:', os.listdir(root), f.read(), 'external edit has no remaining name')
```

Observed output:

```text
O_RDONLY|O_NOFOLLOW|O_CLOEXEC FIFO open: blocked until killed at 500 ms
nonblocking FIFO open: returned immediately; mode is FIFO: True
post-quarantine same-inode write plus identity-only cleanup: ['script.py'] studio external edit has no remaining name
```

The code above records the minimal reproduced sequence; its result establishes filesystem behavior, not an end-to-end app test.

## Skipped checks and residual risks

- Did not run `check`, `lint`, contract/example/resource CLI checks, production build, bundle gate, full Vitest, or browser suite. Selected contract/documentation/no-execution tests and source inspection were used in this bounded round. Existing receipts were deliberately not read and supply no evidence for this report.
- No Linux Rust toolchain is installed in the available prepared environment; actual Unix artifact-command regression remains to be run. Windows cannot exercise `mkfifo`. The Unix finding is supported by source/installed-dependency tracing and the bounded OS reproduction, not a platform assumption presented as a passing integration test.
- No UI thresholds were relaxed or inherited as new exceptions. The required baseline final release boundary was consulted only for its existing accepted exceptions; it does not waive package regression checks.
- Did not trigger actual power loss, forced process crash during a transaction, full-disk failure, cross-volume recovery storage, or privilege changes. Existing fault-injection coverage is narrower than those real deployment conditions.
- No remote discovery/install/update/trust claim follows from local Studio tests. Pinned agent source is read-only semantic evidence; destination credential/backend/platform capability remains an external boundary.

## Freeze record

Report frozen after all selected runners exited. Final `git diff --quiet`, `git diff --cached --quiet`, and `git diff --check` succeeded; HEAD/tree remain the identities above. Only the instantiated prompt and this report are untracked. No earlier review findings or implementer explanations were consulted before this freeze. The exclusive runner window is released at handoff.
