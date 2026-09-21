# Windows primary stabilization verification

Status: **verification reconciled; release handoff ready with explicit exceptions**. Updated September 21, 2026.

Branch: `fix/windows-primary-stabilization`. Latest regression checkpoint:
`baf04fe8763d06478e77a08284b6f7d6eb88e237` (single-worker packaged fix and native keyboard activation; all seven CI jobs passed).
Independent whole-branch review covered
`7a7c19b26a58d428ac0a3d854105a97a1cd68918..5ccbe5327243e46b04f6bd2d597e1815c11616d3`;
subsequent fixes `d6d53f7` and `baf04fe` have RED/GREEN, full CI and packaged
verification, not a second whole-branch review. This document-only handoff does
not change the tested application. The final disposition and requirement table
are authoritative; earlier checkpoint narratives retain the state at their date,
including failures and then-open gates, and are not new release blockers.

## Final disposition and release boundary

The implementation and verification work is ready for a release decision, with
four explicit user exceptions. The original strict performance command is not
reported as passing where these exceptions apply:

| Area | Disposition |
| --- | --- |
| Startup | Accepted p50 2,924.9 ms / p95 7,843.7 ms; original <1 second / 20% improvement target missed. |
| Back to root | Accepted measured 61–85 ms navigation pauses; no further optimization requested. |
| Rare capacity Arrange | Accepted timeout limitation at 250 nodes / 500 edges; ordinary two-node native pointer and keyboard Arrange pass. |
| Git Create Version | Accepted approximately 30 seconds; latest 25,537 ms with independent window response maximum 11.1608 ms and zero timeouts. |

All other measured interactions retain the strict 50 ms limit. Functional graph
validation, stale-response rejection, timeout handling, YAML preservation and
atomic file safety were not waived. Cross-platform evidence is CI/native build
coverage, not a claim of hands-on macOS or Linux desktop UAT.

Fresh September 21 handoff checks (all exit 0): `npm run bundle:check` reported
1,999,412 minified / 384,773 gzip bytes; `npm run resources:verify` verified 42
files; `npm audit --omit=dev` and `npm audit` each reported zero vulnerabilities;
`git diff --check` passed. The exact-code CI run was rechecked as successful:
[35590210035](https://github.com/cmetech/workflow-studio/actions/runs/35590210035).
The full suite was run by CI on this application commit rather than repeated
locally for this evidence-only edit. Counts and platform distinctions follow below.

The private Windows x64 NSIS installer is retained at
`C:/Users/ecorell/AppData/Local/Temp/ws-private-candidate-7onran/WorkflowStudio-baf04fe-private-x64.exe`.
Its SHA-256 was rechecked:
`340e75188accd69cd0a809806403992c806b4eda9f84a0ac2425cd2053f8f070`.
It is unsigned, unpublished, uninstalled and still internally version 3.0.1;
it must not be confused with an official new release. The existing draft
[PR #2](https://github.com/cmetech/workflow-studio/pull/2) targets `base`.
The latest published release is v3.0.1; v3.0.2 is the proposed patch version,
not an approved or created tag. Merging, tagging, publication and installing over
the user's current copy still require explicit approval. The release workflow
requires an immutable version-matching tag on `base` and initially creates a draft.

### Known limitations and deferred minors

- Native scale checks used effective WebView2 DPR 1 and 2, not a physical OS DPI
  setting change. Offline launch used candidate-only unreachable proxies; the
  browser external probe was blocked by CSP and the native updater reported offline.
- Visible-console observation was sampled (2,291 samples over 74,390 ms), so it
  cannot exclude flashes shorter than the sampling interval. Native launch-flag
  regressions provide supporting coverage. Idle resource sampling is not a leak test.
- A successful canvas drag may retain a grabbing cursor class (source-traced,
  not reproduced natively); modal loading punctuation contains mojibake.
- Earlier task-level deferred minors: repeated compilation of the Windows
  test-only `gh.exe` forwarder adds test time; directory errors are not uniform
  across every unchanged rename entry point. These are not new release blockers.
- The earlier custom-brand staging identity test concern was resolved in Task 6
  fix round 2; it is not a remaining deferred item.

### Evidence retention and rollback

Logs and drivers remain under
`.superpowers/sdd/2026-09-14-workflow-studio-windows-primary-stabilization/`.
The candidate root retains screenshots (`native-effective-scale-1.png`,
`native-effective-scale-2.png`, `native-capacity-drag.png`, `native-small-arrange.png`),
its manifest and resource-integrity output. Failed attempts are retained and
identified separately; screenshot filenames alone do not prove acceptance.

All UAT runs restored the agreed data and left the installed application intact.
Latest restoration record:
`C:/Users/ecorell/AppData/Local/Temp/ws-private-uat-backup-FWoAdQ/restoration.json`,
at `2026-09-21T11:14:00.262Z`, reports `installationUnchanged: true` and
`originalDataHashesMatch: true`. Test data was retained in `post-uat-lDyIRB`.
Its `local/EBWebView/Last Version` records runtime **153.0.4234.48**.

No rollback is currently needed. If recovery is required, first save work and
close Workflow Studio, verify the exact backup manifest and obtain approval
before replacing app data. From this worktree, the retained helper accepts:

```powershell
node .superpowers/sdd/2026-09-14-workflow-studio-windows-primary-stabilization/prepare-uat-backup.mjs --restore C:/Users/ecorell/AppData/Local/Temp/ws-private-uat-backup-FWoAdQ
```

It verifies hashes and the unchanged installation, preserves displaced app data
in another `post-uat-*` directory and restores the original roaming/local data.
Do not run it casually after new user work: restoring an older snapshot changes
current app state. It deliberately refuses an installation mismatch and is not
an installer rollback mechanism. No worktree, backup or evidence cleanup is part
of this handoff.

## Current verification

### September 21: complete CI and matched release startup comparison

Packaged capacity and console observation passed in
`baf04fe-native-capacity-console-2.log` (exit 0). The fixture contained 250 nodes
and 500 edges in both root and one loop body. Real header drags changed node
transforms, produced no observed tasks over 50 ms, and left YAML unchanged.
Capacity Arrange was not retried; its accepted exception remains unchanged.
Git version creation completed in 25,537 ms, within the previously accepted
approximately 30-second behavior. All 234 independent window-response samples
responded within 50 ms (maximum 11.1608 ms). History preview and preservation of
unrelated staged changes passed. A desktop visible-console observer recorded
zero new console windows across 2,291 samples over 74,390 ms with a requested
20 ms polling delay. This does not rule out flashes shorter than its actual
sampling interval; native no-window launch-flag tests provide supporting coverage.
Backup `zScjTF` restored successfully, retaining `post-uat-kTwToA`.
The first combined attempt failed because the test driver left the capacity
workflow selected for the original workflow's Git assertion. That driver error
was corrected; its evidence and successful restoration remain retained.

Simulated offline launch passed in `baf04fe-native-offline-launch-2.log` (exit 0).
Unreachable HTTP(S)/ALL proxies and a WebView proxy were configured only in the
candidate process environment/arguments from process start. The native updater
reported `offline`, and an external browser probe was blocked by the existing
CSP before reaching the proxy. No CSP bypass, updater download/install, firewall
change, system proxy change or physical network disconnection was performed.
Welcome, native folder opening, YAML save, keyboard Arrange and bundled offline
documentation remained functional. The earlier probe attempt treated the CSP
block as a harness error; the corrected probe records that distinction instead
of weakening the policy. Both attempts restored original app data; final backup
`FWoAdQ` retained test state `post-uat-lDyIRB`. Workflow Studio is closed.

All seven jobs in CI run `35590210035` passed on
`baf04fe8763d06478e77a08284b6f7d6eb88e237`, including 2,451 unit tests across
186 files, both Windows functional shards, native bundles on Windows/macOS/Linux,
and cross-browser E2E. The quality job also passed 253 Rust unit tests, one IPC
integration test and 26 Git integration tests on Linux. Windows native coverage
is provided by its separate successful job, not inferred from Linux results.

`baf04fe-matched-startup.log` compared ten alternating launches each of the
private candidate and a hash-identical temporary copy of the installed 3.0.1
release. Each launch used a fresh WebView profile and the same original app data,
restored and verified after every sample. Process start to enabled welcome plus
one rendered frame was measured through CDP. No startup optimization was made.

| Release | Nearest-rank p50 | p95 |
| --- | --- | --- |
| Installed baseline copy | 3,027.9 ms | 7,417.8 ms |
| Candidate baf04fe | 2,924.9 ms | 7,843.7 ms |

The p50 improvement is **3.4%**, not the required 20%; startup is also above one
second. Therefore the measurement command's exit 0 does **not** mean the original
startup target passed. On September 21, the user explicitly approved:
"Accept measured startup exception." These measured timings are accepted for
this release, and further startup optimization is out of scope. This exception
does not relax other interaction limits or authorize merging, tagging, publishing,
or replacing the installed application.
Raw samples and `comparison.json` are retained under
`C:/Users/ecorell/AppData/Local/Temp/ws-matched-startup-fhtDb0`.
Backup `EHJ4Vu` restored successfully, final retained test state `post-uat-anpzdN`.
The baseline executable SHA-256 is
`64a08b166e53c9237c680169898130ac3a909ee278b96fe1ef4ad86acde419cc`.
This is a released-build comparison, not the earlier invalid debug/profile comparison.

### September 21: approved keyboard fix verified in packaged Windows

Commit `baf04fe` preserves native button Enter/Space activation instead of letting
the canvas inspector shortcut cancel it. Canvas-node Enter and modified shortcuts
remain active. Unit regression failed before the fix; the real browser regression
also failed because Enter could not open More with a node selected. After the fix,
40 focused unit tests and both Chromium/WebKit keyboard Arrange tests passed.
Lint, type checks and the CI full unit/Rust quality gate passed. Both Windows
functional shards and Windows/macOS native jobs passed. Linux packaging and
cross-browser CI were still running at this checkpoint in
[run 35590210035](https://github.com/cmetech/workflow-studio/actions/runs/35590210035).
Private candidate `ws-private-candidate-7onran` built successfully, with its GUI
executable and 42 resources verified. Native keyboard Arrange passed at both
100% and 200% effective WebView2 scaling using the unchanged production timeout:
`baf04fe-native-keyboard.log` and `baf04fe-native-keyboard-scale2.log` both exit 0.
The selected-node case now activates Arrange and leaves workflow YAML unchanged.
Real folder-dialog open, YAML save and offline documentation checks also passed.
Backups `7HCa27` and `jkeEJg` restored verified original data, retaining test states
`post-uat-SnESKJ` and `post-uat-OCPCU7`. The installed copy is unchanged and the
candidate is closed. Installer SHA-256:
`340e75188accd69cd0a809806403992c806b4eda9f84a0ac2425cd2053f8f070`.
This was a private, unpublished, uninstalled candidate, not an official release.
The earlier
single-worker commit `d6d53f7` completed all seven CI jobs successfully.

### Earlier packaged checkpoint: worker fixed; keyboard then remained open

Private candidate `d6d53f7` built successfully and verified its GUI executable and
42 resources. Pointer-activated Arrange now succeeds on the packaged two-node,
one-edge workflow with the unchanged production timeout and unchanged YAML bytes.
Evidence: `d6d53f7-native-pointer.log` (exit 0). The final commit's CI quality gate,
including the full unit suite and Rust tests, passed; both Windows functional
shards and Windows/macOS native bundles also passed. Linux bundle and cross-browser
jobs were still running at this checkpoint.

A separate keyboard run failed (`d6d53f7-native-keyboard.log`, exit 1): Enter on the
focused Arrange menu item with a node selected did not activate Arrange. Source
inspection identifies the canvas Enter-to-inspect shortcut intercepting the button
activation. This is separate from worker initialization and has not been fixed.
Both UAT runs restored original app data with verification; the installed copy is
unchanged and Workflow Studio is closed. Backups `OCM5vG` and `sWPIqE` retain their
test states. Startup acceptance is still open. No official release was published.

The user has now explicitly accepted the measured **61–85ms Back to root**
navigation exception and requested continued release checks without further
navigation optimization. Other interaction limits remain 50ms. This does not
waive startup or small-workflow Arrange failures, nor change the recorded exit
code of the strict reference run. Earlier pending-navigation statements below
are superseded by this decision.

### Earlier investigation: packaged Arrange failed on a small workflow

**Investigation update:** the earlier direct-engine timeout was a harness artifact:
the synchronous diagnostic child blocked the primary driver's worker/debugger
event handling. With an asynchronous child, the same engine returned its
registration response in **191.6ms**. Evidence:
`5ccbe53-native-direct-elk-async-probe.log`. Its overall acceptance exit remains 1
because the original nested Arrange request still failed.

`5ccbe53-native-detached-arrange.log` also exited 1: Arrange was scheduled after
disconnecting CDP, then inspected after an eight-second debugger-free interval;
the retained worker response trace was empty. Backup `ws-private-uat-backup-VJgR3E`
restored, test state `post-uat-Bv9lpB` retained.

The observed direct-worker success and packaged nested-worker hang match
[Tauri upstream issue 15755](https://github.com/tauri-apps/tauri/issues/15755),
which reports nested script loading hanging specifically under packaged Windows
`tauri.localhost`, while development HTTP and direct fetching work. This supports
a worker-initialization fix rather than further layout-complexity optimization.
The user approved the bounded single-worker fix, committed and pushed as `d6d53f7`. The implementation
keeps ELK inside the existing dedicated layout worker through a local protocol
adapter, without spawning a nested worker. Safety, revision checks, cancellation,
CSP and the production timeout are unchanged. Production build, lint, type checks,
formatting, contracts, examples, resources and bundle checks passed. Real worker
tests passed in Chromium (4) and WebKit (3, with one Chromium-only inspection
skipped); the offline emitted-worker test also passed. The local full unit run
finished with 2,446 passed and two failures (exit 1, 1,875.58s). Both discovered test issues have passing focused reruns: the
obsolete nested-worker asset expectation and cold deferred-surface readiness in
profile-migration setup. The final committed full suite passed in
[CI run 35550649357](https://github.com/cmetech/workflow-studio/actions/runs/35550649357).
The subsequent private build and pointer UAT passed as recorded above. Keyboard
activation remains a separate open acceptance gate.

After the source review, native acceptance found that Arrange fails on a
**two-node, one-edge workflow**. Mouse activation displayed the safe-layout
failure message and preserved the previous layout. Keyboard activation did not
produce a completion result either; it is not yet isolated as a separate defect.
This is not covered by the user's rare large-diagram Arrange exception.

The outer layout worker was created and received a valid request, but no result
or worker error was observed. A **diagnostic-only** runtime extension from 5s to
30s still produced no response. No production timeout was changed. A CDP snapshot
showed the nested engine target with an empty URL/title and PID 0. However, a
separate synchronous diagnostic direct-renderer launch also timed out; that
particular result was later invalidated by the harness correction described
above. Moving layout work to the UI thread or weakening CSP is not approved.

Evidence in plan scratch: `5ccbe53-native-small-arrange.log`,
`5ccbe53-native-small-arrange-pointer.log`, `5ccbe53-native-small-arrange-trace.log`,
`5ccbe53-native-small-arrange-timeout-probe.log`, and
`5ccbe53-native-direct-elk-probe.log`. All acceptance attempts exited 1.
Latest backup `ws-private-uat-backup-2PLHpP` restored successfully with test state
preserved as `post-uat-K5UDBY`. Candidates are closed. The source-review verdict
does not override this newly observed native release blocker.

### Final acceptance pass, September 20

All seven jobs in [CI run 35544104568](https://github.com/cmetech/workflow-studio/actions/runs/35544104568)
passed for `5ccbe5327243e46b04f6bd2d597e1815c11616d3`: quality, Windows/Linux/macOS
native, both Windows functional shards, and cross-browser renderer coverage.

The final reference command used Chromium, one worker, five repetitions of
`canvas responsive and local-only|hidden scopes idle`, with
`WORKFLOW_STUDIO_PERCEPTUAL_PERFORMANCE=on`. It exited **1**, with five general
canvas passes and five scoped-navigation failures. Every measured phase other
than Back to root reported no tasks over 50ms. Back-to-root maxima were
**63, 68, 85, 69, 61ms**; the third repetition contained 75/85/54ms tasks.
Evidence: plan scratch `5ccbe53-final-reference.log` and
`test-results-final-reference-5ccbe53/`. This is not a full performance pass.
The larger navigation measurements have been presented to the user for explicit
acceptance; the prior small-overrun waiver has not been silently widened.
The separately waived capacity Arrange scenario was deliberately excluded.

Packaged `5ccbe53-native-appearance-3.log` exited 0: native custom-brand import,
preview and activation; graceful app restart; persistence of custom brand,
Light theme and Ocean Blue accent; active-brand removal reverting to LOOP24;
basic Tab focus; offline documentation; no uncaught renderer errors.
Main-process idle sample: 10.020 seconds, 0% of one CPU core, 38.35MiB working
set, 10.05MiB private memory, 604 handles, 19 threads, responsive window.
This excludes WebView child processes and is not a sustained leak test.
Backup `ws-private-uat-backup-IUvR3R` was restored with test state preserved in
`post-uat-VTsFNV`; installation unchanged. Earlier appearance attempts failed
on test-driver file-picker/transition locators, not a demonstrated app defect.

One independent read-only whole-branch reviewer completed
`7a7c19b26a58d428ac0a3d854105a97a1cd68918..5ccbe5327243e46b04f6bd2d597e1815c11616d3`.
No critical or important code defect was found. Two minor findings are deferred:
`CanvasViewportController.svelte:54` may retain its manually added dragging class
after successful drag (source-traced, not native-reproduced); and
`DeferredSurface.svelte:118` contains garbled punctuation in a modal loading status.
The executor agrees these are nonblocking polish issues. No production fix was
made, so the tested candidate and reviewed source remain identical.

The review explicitly did not certify outstanding UAT, final evidence accuracy,
fresh test execution, or acceptance of newer navigation timings. These remain
executor/user gates, not implied passes. Accepted Git duration and capacity Arrange
were excluded from renewed optimization, not from their safety checks.

`5ccbe53-native-acceptance-scale2-2.log` exited 0. WebView2 was launched with
`--force-device-scale-factor=2`: measured DPR 2, 720×450 CSS pixels in the
1440×900 native window, no document-level horizontal overflow. Native open/edit/save,
keyboard node selection and Inspector opening, local Git version creation,
historical preview without disk mutation, and Rename Pair of a tracked workflow
all passed. Renamed bytes and the unrelated staged note were preserved.
Git completion was 31,840ms; 295 window samples had zero timeouts and a maximum
18.9744ms response. Offline documentation and uncaught-error assertions passed.
Backup `ws-private-uat-backup-sPc4r6` restored; test state `post-uat-cK2ByY` retained.
This is **effective WebView rendering scale**, not a change to Windows OS DPI or
proof of native-dialog scaling. The 100% run measured DPR 1 and 1440×900 CSS pixels;
it passed saving, keyboard selection, Git/history and branding, but the added
reopen driver initially assumed workspace auto-reopening. The app correctly
returned to welcome, so the driver now selects the exact temporary recent folder.

Remaining packaged acceptance and evidence reconciliation are still in progress.
Nothing has been merged, tagged, published, or installed over the existing app.

`5ccbe53-native-reopen-idle.log` exited 0: 100% effective-scale open/save,
keyboard node selection, brand import/activation/restart/persistence/removal,
and reopening the saved YAML through its exact temporary recent-folder entry
passed. The app correctly starts at welcome rather than automatically opening
a previous workspace. Ten-second idle measurement across seven processes:
0.4683% of one CPU core, 409.04MiB private memory total, 527.23MiB summed working
sets (shared pages may be counted more than once), 3,846 handles. Main process:
0% CPU, 39.16MiB working set. The window remained responsive; no uncaught renderer
errors. This is a short sample, not a leak test. Backup `ws-private-uat-backup-DZNZVh`
restored; candidate test state retained as `post-uat-WfJSnj`.

### Earlier startup measurement (superseded by the matched comparison above)

`5ccbe53-native-startup-2.log` completed ten private release launches with fresh
WebView profiles. Process-start to visible, enabled welcome Open Folder plus
the next animation frame, measured through CDP (25ms readiness polling):
**3155.5, 8074.6, 3207.3, 3322.4, 3283.3, 3276.2, 3287.2, 3547.5, 8308.1,
3258.3ms**. Nearest-rank median **3283.3ms**, p95 **8308.1ms**. The measurement
command exited 0, but that is not acceptance: the median exceeds one second and
there is no matched baseline demonstrating the alternative 20% improvement.
Historical debug/profile-mode measurements cannot supply that comparison.
The first attempt exposed a driver bug (checking enabled immediately after
visible); the driver now waits for enabled within the unchanged 30s deadline.
Both attempts restored original app data. Latest backup `ws-private-uat-backup-qpAlYw`,
retained test state `post-uat-Bm1kSx`. Startup has not been waived by the user.

## Historical checkpoints

The following chronological notes retain intermediate failures and superseded
CI/pending statements for traceability. They are not the current acceptance
verdict; the section above takes precedence. The provisional requirement map
at the end still needs reconciliation before this document is committed.

### Native external-file and read-only checks passed

`5ccbe53-native-file-safety-2.log` exited 0. Real filesystem writes exercised
clean external-edit automatic reload, dirty-buffer conflict prompting, and
explicit Reload Disk resolution. Disk bytes stayed external until the choice.
A Windows read-only temporary file showed Save workflow disabled and retained
its original bytes after Ctrl+S. This covers disabled saving of that fixture,
not every read-only editing or overwrite scenario. Offline documentation and
the zero-uncaught-renderer-error assertion also passed.

The first attempt used an incorrect driver locator (`Save` rather than the
accessible name `Save workflow`); only the driver was corrected. Both attempts
restored original app-data hashes and verified the installation unchanged.
Latest backup: `ws-private-uat-backup-jANS9h`, restored at
2026-09-20T23:27:24.824Z; candidate state preserved as `post-uat-xXYKlg`. App closed.

CI35544104568 now has five green jobs, including the Linux quality job that
previously failed the IPC-origin regression. Both Windows functional shards and
Windows/macOS native passed. Linux native bundle and cross-browser renderer are
still running; comprehensive packaged UAT and final review remain open.

### Accepted Git duration and latest packaged result

The user explicitly accepted approximately **30 seconds for Git version
creation** and requested no further optimization. Latest measured completion:
**28,668ms**. This exception does not waive the strict 50ms responsiveness limit,
Git safety checks, other action timings, or the remaining acceptance gates.

Candidate `5ccbe5327243e46b04f6bd2d597e1815c11616d3` built successfully and passed
GUI PE and all 42 bundled-resource checks. Root:
`C:\Users\ecorell\AppData\Local\Temp\ws-private-candidate-z4qCcQ`.
Installer SHA256: `18f6ac484bba9b4a0ab4fd1d750f5404fb0762e0c75c7f03fa564f808715c280`.

`5ccbe53-native-git-uat.log` exited 0: **262 window-response samples, zero
timeouts, maximum 21.9016ms**. Native open/edit/save, Git commit creation,
preservation of unrelated staged notes, offline documentation and zero uncaught
renderer errors passed. The candidate is closed and remains unpublished and
not installed over the existing app. Backup `ws-private-uat-backup-kDn5ZJ` was
restored at 2026-09-20T23:22:23.739Z with original data hashes matching and the
installation unchanged; test state preserved in `post-uat-4wMzT5`.

CI35544104568 is still running: Windows/macOS native and Windows functional
shard 1 passed at the last check. Overall acceptance remains open.

### Approved duplicate-check reduction and portable test origin

Commit `5ccbe53` removes duplicate HEAD reads from the workspace guard while
retaining the commit routine's HEAD verification at each mutation checkpoint.
The real-repository regression first failed with a false post-commit warning
about the app's own successful HEAD update, then passed with no warnings and
unrelated staged notes preserved. Read probes decreased from **43 to 33**.
This is a subprocess-count reduction, not yet a packaged timing result.

The complete native suite passed: **236 unit tests** (578.38s), **one IPC test**
(0.04s), and **12 Git integration tests** (199.91s). A strengthened stale-HEAD
regression, edited after the full suite compiled, passed separately (27.89s):
the mutation routine still rejects intervening commits without the outer guard's
duplicate HEAD check. Formatting and diff checks passed; existing warnings remain.

The IPC test now uses Tauri's platform-specific local origin and prints the full
error on assertion failure. Windows verification passed; the updated Linux CI
result is pending. The subsequent packaged result and user acceptance exception
are recorded above.

### Git latency investigation (no production changes)

An instrumented rerun reproduced **28,224ms** version completion. Its 265 Windows
response samples all passed (maximum 15.829ms). The 27.63-second commit interval
contained **54 Git process starts**, with only **4.096 seconds** of summed Git
internal runtime: 13 config, 14 rev-parse, nine symbolic-ref, and 18 other commands.
Background detection may overlap this interval, so these are interval counts,
not exact attribution to the create-version command alone.

Independent measurements with the candidate closed found a trivial PATH-resolved
`git --version` took 344–366ms; the Git launcher took 339–352ms and its underlying
executable 228–242ms. Warmed system-thread snapshots took about 5–6ms. Evidence
therefore points primarily to repeated Windows subprocess startup/management
overhead, not one expensive Git operation. The underlying OS/security contribution
has not been isolated; no antivirus settings were changed or blamed.

Source inspection found repeated HEAD verification within the same mutation
checkpoint: the guard calls `base.verify`, followed by another caller-side
`base.verify`; each launches symbolic-ref and rev-parse. Consolidation needs a
bounded design that preserves checks across every mutation/hook/race boundary.
No optimization has been implemented or its speedup claimed.

CI35541208861's quality job failed the new IPC regression on Linux after all
252 native unit tests passed. The expected workspace error code was absent.
The fixture hardcodes the Windows HTTP origin, whereas installed Tauri examples
select `tauri://localhost` outside Windows/Android. Origin rejection is the leading
explanation and needs a portable fixture correction followed by CI verification.

Evidence: `6781ac1-git-latency-trace.log`, `git-startup-idle.log`, and the candidate's
`git-latency-trace.jsonl`. Fresh backup `ws-private-uat-backup-34ooDO` was restored
with matching original data hashes and unchanged installation at
2026-09-20T22:40:11.686Z; candidate state preserved in `post-uat-TIQQP9`. App closed.

### Approved Git dispatch correction: targeted packaged responsiveness passed

The eleven Git commands that perform filesystem/subprocess work now request
Tauri asynchronous command dispatch. Their synchronous bodies and existing
authorization/generation guards are unchanged; short token/session commands
remain synchronous. This does not claim to reduce the underlying Git duration.

The generated-IPC integration regression first failed with all eleven commands
executing inline (`git-dispatch-red-3.log`), then passed after the attribute
changes (`git-dispatch-green.log`, 1/1). It also verifies workspace selection
remains mandatory. Windows integration-test executables receive the required
common-controls v6 manifest dependency; the production manifest is unchanged.
Earlier unit-test executable loader errors were setup failures, not RED evidence.

The full native suite exited 0: **235 unit tests** (511.17s), **1 IPC regression**
(0.03s), and **12 Git integration tests** (198.09s). Rust formatting and diff
checks passed; existing compiler warnings remain. Committed and pushed as
`6781ac1`. The private optimized build exited 0 and passed GUI PE and all 42
resource checks. Candidate: `C:\Users\ecorell\AppData\Local\Temp\ws-private-candidate-qKL0e6`.
Installer SHA256: `25dca71d7caa9aab656da719e6a53d87aee95cefae32a55332c48486a6a47fca`.

`6781ac1-native-git-uat-2.log` exited 0. During native version creation, a separate
Windows WM_NULL probe recorded **299 samples, zero timeouts, maximum 13.8802ms**,
all within the strict 50ms threshold. The real Git commit contained the saved
YAML and preserved unrelated staged notes. Native folder open/read/edit/save,
offline documentation and zero uncaught renderer errors also passed.

**Overall Git latency remains open:** dialog completion took **32,271ms**. The
first run stopped at the driver's default five-second Git readiness expectation;
the successful retry used a 30-second functional readiness wait. Neither that
wait nor the window-response result accepts overall Git latency, renderer-frame
performance, or comprehensive packaged UAT.

Both runs restored original app data and verified the installation unchanged.
Backup roots: `ws-private-uat-backup-IhoeKH` and `ws-private-uat-backup-fdopsK` under
local Temp; last preserved candidate state `post-uat-TQPoce`. Restoration hash
verification completed at 2026-09-20T22:22:45.116Z. The candidate is closed,
unsigned, unpublished, and not installed over the existing app.

CI35541208861 is running for `6781ac1`; macOS native and Windows functional shard
1 passed at the last check, with five jobs still in progress.

### Native Git investigation: functionally passes, window responsiveness fails

The initial Create version driver timeout was not proof of an endless refresh
loop. `efbdef7-git-trace.log` shows a save-triggered refresh settling from
21:35:21.204 to 21:35:29.317 UTC (about 8.1 seconds); the view then became ready.
The save generated separate real-file and temporary-cleanup watcher batches and
two workspace scans. Trace instrumentation was enabled: these are diagnostic
observations, not controlled performance acceptance measurements.

With the driver allowed to wait for the native operation's actual completion,
`efbdef7-git-completion.log` passed real local-version creation and verified the
unrelated staged `notes.txt` remained staged. Dialog completion took **26,511ms**;
the resulting commit contained the edited YAML. Offline documentation and the
zero-uncaught-error assertion also passed. No app code changed in this investigation.

**Open blocking responsiveness finding:** during version creation, Windows
`Get-Process workflow-studio` reported `Responding: false` for candidate PID24520.
The relevant Git entry points in `src-tauri/src/git/mod.rs` are synchronous
`#[tauri::command]` handlers. Installed `tauri-macros-2.6.3/src/command/wrapper.rs`
selects the blocking inline response path for these handlers; its asynchronous
dispatch path exists separately. Proposed bounded correction: dispatch blocking
Git operations off the native window thread while preserving authorization,
generation and repository safety checks; add a responsiveness regression and
repeat packaged UAT. The user subsequently approved this bounded correction;
the implementation checkpoint is recorded above.

Both diagnostic runs restored original app-data hashes and verified installation
unchanged: local Temp backups `ws-private-uat-backup-ArXaBC` and
`ws-private-uat-backup-TWpnpv` (last preserved state `post-uat-U4gTZH`). Candidate
is closed. One orphaned Git reader from the earlier driver-terminated RGKdL6
temporary test workspace was stopped after checking its exact PID, parent and
command line; no user Git processes or files were removed.

CI35538508877 completed successfully across all jobs for `efbdef7`, including
Windows, Linux, macOS and renderer checks. It does not verify the new uncommitted
Git dispatch change.

### Vanished-read correction verified in the packaged app (`efbdef7`)

Committed and pushed the approved read-open NotFound classification fix. The
real-directory Rust regression failed with the original error code before the
fix, then passed within the complete **235/235 native unit suite** (618.27s).
All **12/12 Git integration tests** passed (176.73s), along with **14/14 bridge
tests**, type checking, focused lint/formatting and diff checks. Existing native
compiler warnings remain; this was not a warning-free build.

The updated private optimized NSIS build exited 0 and passed GUI PE and all 42
resource checks. Candidate root:
`C:\Users\ecorell\AppData\Local\Temp\ws-private-candidate-FvRzdC`.
Installer SHA256: `df9d6e70e177fd71d11dac34c872a1e7463562f31eae6e5855af6fd96d7fd0a6`.
It remains unsigned, unpublished, and not installed over the existing app.

`efbdef7-native-save.log` records a successful native welcome / real folder dialog /
YAML read-edit-save / offline lazy documentation sequence with **zero uncaught
renderer errors**. The result is also in `native-smoke-result.json` in the candidate
root. This verifies the original missing-file symptom for the exercised sequence,
not comprehensive packaged acceptance.

Broader native Git UAT is **not passing yet**:

- `efbdef7-native-uat.log`: first visual-editor load in a temporary Git repository
  exceeded the driver's 5-second expectation; the UI still showed loading.
- `efbdef7-native-uat-2.log`: with a 20-second functional wait, the graph and save
  succeeded, but Git kept showing refresh state and the Create version button
  detached during the driver's 15-second click timeout. Root cause remains to be
  diagnosed. These longer functional waits do not waive performance criteria.
- All three runs restored original app data and verified installation unchanged.
  Backup roots under local Temp: `ws-private-uat-backup-hEV94l`,
  `ws-private-uat-backup-iUJxfb`, and `ws-private-uat-backup-w1uPeS`.
  Last restoration evidence is `restoration.json` under `w1uPeS`; candidate closed.

Fresh CI [35538508877](https://github.com/cmetech/workflow-studio/actions/runs/35538508877)
has passed Windows native, macOS native and both Windows functional shards.
Quality, Linux native and cross-browser renderer jobs were still running at the
last check. Full remaining UAT, non-waived performance and final branch review
remain open. Prior all-green CI below applies to `cc76824`, not this new commit.

### Private candidate and initial native UAT (`cc76824`)

The optimized x64 NSIS build exited 0. The extracted GUI executable and all 42
bundled resource files passed verification. This is an unsigned private candidate,
not a publication, installation, or release-acceptance claim.

- Candidate evidence: `C:\Users\ecorell\AppData\Local\Temp\ws-private-candidate-5cHP56`.
- Installer SHA256: `77fdff46f4e23fbbea012269c4d7e3d1810ae0f3365caa290b4c6440a76cb816`.
- Verified backup: `C:\Users\ecorell\AppData\Local\Temp\ws-private-uat-backup-tbcAwF` (44 installation, 10 roaming, 324 local files).
- Restoration completed: `restoration.json` confirms original data hashes match and installation unchanged. Candidate is closed. Post-test data is preserved under that backup, not deleted.

Native WebView2 checks exercised the real Windows folder dialog and temporary
workflow files: welcome, folder open, YAML read/edit/save with on-disk verification,
and lazy bundled Quick Start documentation with external browser requests blocked.
Reduced-motion preference was enabled, but this alone is not an accessibility pass.
Screenshots and `native-smoke-result.json` are in the candidate evidence directory;
the command log is `cc76824-native-smoke.log` in the plan scratch directory.

**Open finding (root cause reproduced):** one renderer `pageerror` reported “The workspace operation failed:
The system cannot find the file specified. (os error 2)” during the successful
save/documentation sequence. Reproduce with timestamped native-command/error
tracing before classifying or fixing it. The subsequent `cc76824-native-trace-2.log`
reproduced the cause: at 20:58:53 UTC, the watcher tried to read the already-removed
`.workflow-studio-original-23380-2-native-uat.yaml` safety copy. Native `read_impl`
maps the missing file to `workspace_read_failed`, whereas `watchWorkspaceChanges`
only treats `path_not_found` as an expected disappearance. This rejects the batch.
Proposed bounded correction: classify actual NotFound errors at native read-open
as `path_not_found`, retaining security and other I/O failures; cover vanished
files with real-directory Rust tests and watcher batch behavior in TypeScript.
The user approved the bounded correction. The Rust regression reproduced
`workspace_read_failed` before the change; after mapping only read-open NotFound
to `path_not_found`, all 235 native unit tests passed. Three TypeScript watcher
cases cover survival of the batch and continued propagation of security/other
I/O errors; the bridge suite passed 14/14. Type checking, focused formatting, and
lint passed. The separate 12 Git integration tests and updated packaged candidate
verification remain in progress at this checkpoint. Logs: `vanished-read-red.log`,
`vanished-read-native-green.log`, `vanished-read-bridge.log`, `vanished-read-check.log`.
Do not treat the smoke command's exit 0
as a clean packaged-UAT pass. Immediate save before analysis settled was also
blocked with `analysis_missing_or_stale`; waiting for analysis allowed saving.

Early driver attempts failed because the native invoke property is immutable and
because the Windows folder input is itself an Edit control. The final driver uses
the actual dialog; no native filesystem commands were mocked. Full native Git,
branding, restart, scale, idle/console, and remaining UAT coverage are still open,
as are non-waived performance acceptance and final review/evidence.

Diagnostic runs used fresh verified backups `ws-private-uat-backup-1MPvwY` and
`ws-private-uat-backup-wlGqgr` under the user's local Temp directory. Both restores
completed; the latter run reproduced the bug and preserved test state under
`post-uat-f5dasO`. The first trace attempt hit a startup-navigation test-driver
error, not a classified product failure. `native-uat-session.mjs` now wraps each
candidate run in verified backup and restoration. Diagnostics log native calls
with CDP function breakpoints; they are not performance measurements.

### Windows CI argument correction (`cc76824`)

The failed hosted Windows installer run had dropped timeout and worker arguments
when invoking `npm` through PowerShell. The Windows-only command now uses
`npm.cmd`, matching the functional shard commands. Updated contract coverage
failed before the workflow change, then all **92 toolchain/checkout/installer
tests passed** locally in 133.93 seconds. Formatting and diff checks passed.

Pushed `cc7682452571f0e5036daf8965631be1ac119730` to the existing draft PR 2.
CI run [35534747271](https://github.com/cmetech/workflow-studio/actions/runs/35534747271)
has passed all seven jobs: Windows, Linux, and macOS native, quality gates, both
Windows functional shards, and cross-browser renderer E2E.
Windows logs confirm the complete timeout/worker arguments reached Vitest:
**234 native tests, 12 Git integration tests, and 89 installer/checkout tests
passed**, with both debug bundles built. Fresh complete local functional coverage
passed **199/199 in 15.4 minutes** (`cc76824-full-functional.log`).

The previously tested preliminary-placement optimization and capacity diagnostic
changes are now separately committed as `2bb97ba` and `a052294`, so CI uses the
same runtime source as the completed local unit verification. Private candidate
and backup/restoration evidence is recorded above.

### User-accepted large-diagram Arrange limitation

After the 250-node/500-edge Arrange timeout and its user impact were explained,
the user explicitly chose to skip further work because diagrams that large are
rarely expected. The proposed worker-pipeline redesign is therefore dropped;
this capacity-scale Arrange timeout is an accepted limitation rather than a
blocker by itself for the approved private candidate/UAT. Failed measurements
below remain failures, not timing passes. No timeout, safety check, or test
threshold has been relaxed.

This decision is limited to the discussed large-diagram Arrange problem. It does
not establish a blanket exception for ordinary-sized workflows, other interaction
pauses, correctness regressions, or CI. Normal-use Windows validation, regression
checks, cross-platform CI, and packaged backup/UAT/restoration remain required.

### Cold-worker investigation after `7cbedf4` (no product changes)

Three alternating browser-only diagnostics measured baseline workers at
3,307.6 / 3,021.3 / 3,634.3 ms and cheaper preliminary polyline routing at
3,197.9 / 3,139.5 / 2,970.1 ms. All six completed, but the preliminary phase did
not show a consistent saving sufficient to establish timeout reliability.
Evidence: plan-scratch `cold-paired-base-*.log` and `cold-paired-polyline-*.log`.

A separate final-placement `SIMPLE` experiment returned in 2,520.7 / 2,450 /
3,200.7 ms but the application rejected all three layouts. A fourth diagnostic
identified `route_point_count` as the rejection. This alternative is rejected;
the route bounds and 5-second timeout remain unchanged. Evidence:
`cold-simple-final-*.log`. No experimental settings were applied to product files.

The routed-layout design explicitly requires preliminary port ordering followed
by final fixed-order routing. Removing a full ELK pass therefore needs a scoped
design review, not an undocumented settings change. Performance acceptance is
still open; no new private candidate was built.

### Approved coincident-segment sweep (`7cbedf4`)

Replaced the all-pairs route-overlap check with an orientation/axis-sorted
candidate scan and cached intervals. Geometry tolerance, strict fan-zone length,
same-route exclusion, and every other validation rule are unchanged. The work
regression failed first (500,000 coordinate reads against a 20,000 bound), then
passed; boundary, reversed-direction, same-route, and seeded all-pairs equivalence
coverage is included. Affected tests passed **143/143 across four files**.
Lint and type checks passed (zero Svelte errors/warnings); production build and
bundle budget passed (**1,999,252 minified / 384,741 gzip bytes**).

Fresh diagnostic samples measured warm validation **37.1 ms before / 21.1 ms
after**; publication was **19.9 / 20.4 ms**. These are diagnostic samples, not a
controlled benchmark or acceptance result. Evidence: `arrange-next-step.log`,
`arrange-coincident-sweep.log`, and corresponding CPU profiles in plan scratch.

Strict five-repeat reference run: **3 passed / 12 failed**, exit 1 in 4.6 minutes
(`coincident-reference-five.log`, `test-results-coincident-five/`). Failures:

- Cold Arrange: two worker timeouts.
- Warmed Arrange: one 52 ms long task.
- Routed content-only analysis: one 50.426 ms CDP renderer task.
- Root connection: two 62 ms long tasks; earlier five passing phases are not a
  guarantee of current acceptance.
- Settings navigation: one 52 ms long task.
- Back to root: five failed cases, maxima 100 / 74 / 67 / 56 / 74 ms. No new waiver.

One CPU snapshot during the run was 78%; this does not establish the cause or
justify dismissing failures. No concurrent owned build/unit run was active.
Full unit verification passed **2,444/2,444 tests across 186 files**, exit 0 in
1,210.31 seconds (`coincident-full-unit.log`). All six focused functional browser
cases passed in 56.6 seconds, exit 0 (`coincident-functional.log`), covering
capacity overview handles, timeout recovery, offline emitted production worker,
root/body route restoration, malformed responses, and dragging after Arrange.
Repository-wide formatting and `git diff --check` also passed. Committed only
the overlap checker and its regression tests as `7cbedf4`; the earlier ELK
experiment remains uncommitted. No fresh full 199-case functional run, CI push,
private candidate, installation, or app-data changes occurred for this optimization.

### Approved bounded prop-forwarding follow-up (`f1fce4d`)

The user explicitly retained the **50 ms limit** for connection and Arrange and
approved the bounded `DeferredSurface` change. This is not the broader scope
activation redesign. Property-specific derived readers are created at boundary
initialization, preserving identity and synchronous updates; later-added keys
forward directly rather than acquiring a transient child effect's lifetime.
The unchanged-consumer regression failed before implementation. An additional
absent-property regression failed and was corrected; App and boundary tests then
passed **80/80**. Initial lazy-derived prototypes were rejected because real
Inspector controls retained stale transition state. A raw-cell alternative was
also rejected: it delayed parent revision changes until rendering, losing mixed
selection during YAML edits. A same-callback derived-value test failed (2 instead
of 4), then passed with eager boundary-owned readers. Final affected App/boundary
tests passed **81/81**, the strengthened boundary suite **10/10**, and the mixed
selection browser regression passed **3/3** after failing all three raw-cell
repeats. Current lint/type/build/budget checks passed: **1,999,252 minified /
384,739 gzip bytes**. Fresh full Windows units passed **2,435/2,435 across
185 files**, exit 0 in 1,609.76 seconds (`eager-derived-full-unit.log`).
Overall verification remains blocked by the functional/performance results below.

Five reference repetitions of the **current eager-derived implementation** completed with **11 passed / 4 failed**
(15 tests, 3.5 minutes; exit 1). This is **not overall performance acceptance**.

| Measured action | Final five-repeat evidence |
| --- | --- |
| Root connection | 5/5 phases with no main-thread task above 50 ms |
| Root/body Inspector authoring | All measured phases had no task above 50 ms |
| Cold Arrange | 5/5 accepted; worker 4,589.3 / 2,997.7 / 4,418.9 / 4,463.6 / 4,863.3 ms; last sample has little timeout margin |
| Warmed Arrange | One test failed: 52 ms observer task; remains a strict blocker |
| Settings navigation/return | 5/5 phases with no main-thread task above 50 ms |
| Back to root | Three strict failures, maximum 53 / 59 / 90 ms; two repetitions stayed within 50 ms. The 90 ms result exceeds the small overrun originally discussed; not a timing pass or a newly approved exception |

Evidence: plan scratch `eager-derived-reference-five.log` and worktree
`test-results-eager-derived-five/`. Thresholds and the 5,000 ms worker
timeout are unchanged. The earlier preliminary ELK `SIMPLE` placement change is
also present in this working tree; final routing retains its original strategy.

Final source lint/type checks and renderer build/budget passed: **1,999,252
minified / 384,739 gzip bytes** (748 minified bytes of headroom). A separate
capacity test's initial Explorer query failed both with this code and with the
original `ba4450d` boundary while showing its loading placeholder. Applying that
test's existing deferred-surface readiness wait passed **2/2**; no application
timing limit changed. Full functional Chromium
completed **198 passed / 1 failed** in 17.3 minutes (exit 1): capacity overview
Arrange timed out with one request, no response, one worker termination, and
5,011 ms worker time. There were no missing-handle warnings; no route validation
or publication occurred. The mixed-selection regression passed. This run
overlapped the unit suite and is not an isolated timing measurement, but remains
a failed functional gate; it must not be presented as a clean pass.
Evidence: `eager-derived-full-functional.log` and
`test-results-eager-derived-full-functional/` (`overview-arrange.json`).
After the unit workload ended, the same capacity overview case passed **3/3**
isolated repetitions in 37 seconds (exit 0; `eager-derived-overview-isolated.log`).
This supports investigating load sensitivity, but does not erase the full-run
failure or establish a clean complete functional gate. The bounded forwarding
fix is committed separately as `f1fce4d`; the earlier ELK experiment and timing
instrumentation remain uncommitted. No fresh CI push was made in this follow-up.

CI at `ba4450d` (run `35524827117`) is **not green**: the Windows installer-contract
step dropped its command-line timeout/worker options before Vitest started, and
the PowerShell architecture fixture timed out at the default 5 seconds. Its log
shows 88 passing tests and one failure. That separate CI correction remains open.
No new private candidate, real-app backup, native test launch, or restoration has
been performed during this follow-up.

### User decisions and current checkpoint

- On September 20, the user accepted leaving the small Back-to-root navigation
  overrun unchanged. The retained implementation had measured 54–56 ms against
  the original 50 ms limit. This is an accepted limitation, not a timing pass;
  it does not waive cold Arrange failures or other interaction requirements.
- The user approved a private candidate build after code/regression checks pass,
  with no publication or installed-copy replacement. The previously approved
  installation/app-data backup, separate launch, and restoration remain required.
- Pushed checkpoint `c9a47c0` includes `b2e7272` (unavailable worker feedback),
  `5627c5d` (preserve focus during initial YAML selection synchronization), and
  Windows CI shard/pointer-readiness corrections. Focus regression failed before
  the fix; focused editor/toolchain verification passed **19/19**. Worker/App
  affected verification passed **45/45**. Current full Windows units are running.
- Real Windows shard listings partition **101 + 98 = 199** functional tests with
  no overlap. The preceding CI run `35520369076` passed all three native bundles,
  but failed quality and renderer checks; it is not an overall acceptance pass.
- Rendering experiments were rejected and removed. Incoming-edge batching passed
  its behavior test but failed reference acceptance (Back to root **73 ms**, cold
  Arrange worker **5,011.4 ms** timeout). No timeout or timing limit was raised.
- Focused Chromium keyboard/port scenarios passed both repeats. Windows WebKit
  passed one keyboard run but timed out in another under concurrent unit load;
  its palette drag did not add a node in both repeats. A minimal browser-only
  draggable-div reproduction, including double-hover, loses the custom MIME
  value on Windows WebKit but preserves it on Chromium. This is a Windows
  Playwright WebKit-port limitation, not evidence of a native WebView2 defect.
  No application fallback or test skip was introduced; Linux WebKit CI remains
  a separate required gate. Evidence: `diagnose-drag-mime-manual.log`.
- CI run `35522959691` at `c9a47c0` completed successfully across all seven jobs.
  Linux quality: **2,430 unit tests / 185 files**, plus **251 native library /
  26 integration tests**. Linux renderer: **400 passed, 4 existing skips**.
  Windows functional shards: **100 passed + 1 flaky**, and **98 passed**.
  The flaky Quick Open compact-modal case passed on retry but is not a clean
  first-pass result. Local repeats before a helper correction passed 5/5;
  the helper now awaits a real dialog action so it cannot measure the transient
  loading modal. This test-only follow-up is under verification.
- Fresh complete Windows units passed **2,430/2,430 in 185 files**, exit 0,
  **1,938.20 seconds** (`full-unit-focus-fix.log`). Native verification passed
  **234 library + 12 integration tests**, exit 0 (`native-current-final.log`).
  The unit output includes a CodeMirror/jsdom `getClientRects` stderr message
  in a passing editor test; it is not an unhandled suite failure.
- Fresh `contracts:check`, `examples:check`, and `resources:verify` passed
  (42 resource files). Both production-only and full npm audits reported zero
  vulnerabilities. The combined command exited 0 on September 20.
- Fresh full formatting passed. Renderer build/budget passed with **1,998,797
  minified / 384,565 gzip bytes**. Private UAT backup/restoration tooling passed
  a temporary-data self-test; the real installation and app data remain untouched.

### Historical three-gate checkpoints, September 20

The entries below retain earlier evidence and chronology; current state and user
decisions above supersede their pending-action statements.

- Latest checkpoint is pushed to draft PR #2. CI run `35520369076` is in progress
  on `734a94a`; no merge or release. User approved both CI publication and the
  packaged UAT backup/test/restoration procedure; no app backup/launch yet.
- `e55f8f3`: generated native HTML watcher regression failed before the exclusion,
  then passed with real Vite watcher/temp-directory coverage.
- `ca11130`: Inspector patches and validates using the existing complete YAML
  transaction in a one-shot worker. Worker identity, timeout/error cleanup,
  comment preservation, self-edge rejection, and stale UI binding are covered.
  The client and empty-loop-only surface are deferred to retain the startup budget.
- Latest affected verification: **157/157 tests, 7 files, 106.38 seconds, exit 0**;
  format/lint/check exit 0, Svelte 0 errors/warnings; production build and bundle
  budget exit 0, **1,998,797 minified / 384,566 gzip bytes**. Full current unit
  and native suites remain outstanding. Targeted native init identity test passes.
- Windows reference run after the worker fix: **2 passed / 1 failed, 50.4 seconds**.
  Root and body Inspector phases reported no long tasks, root connection and
  Settings passed, all five warmed Arrange phases passed. **Back to root: 56 ms**
  fails the unchanged 50 ms limit. Five consecutive full passes are still required.
  Evidence: `worker-inspector-reference-1.log` and
  `test-results-task13-worker-inspector-reference-1` in the worktree.
- A separate instrumented Back-to-root profile points to multiple Svelte rendering
  flushes, including WorkflowNode/Handle mounting; timings under profiling are
  diagnostic, not acceptance. `worker-navigation-profile.log`,
  `worker-navigation-summary.log`, and `navigation-scope` CPU/trace artifacts
  are in the plan scratch directory; earlier traces were timestamp-copied first.
- CI at the previous `877f73e`: both Windows functional shards and macOS native
  bundle passed. Linux quality reported 2,419 unit passes, one missing-dist-manifest
  failure, and an Explorer async-import teardown error. Windows native reported
  234 library passes, 11 integration passes, and one short-path/long-path identity
  assertion failure. `734a94a` moves the prerequisite build before unit tests,
  awaits Explorer authoring imports, and compares canonical filesystem paths.
  CI verification of those corrections is pending.

- On shutdown, the buffered Vite log exposed page reloads caused by generated
  `src-tauri/target/debug/build/.../tauri-codegen-assets/*.html` during native
  builds. The concurrent build may have interfered with browser tests; this is
  not proven to explain the Setup failure. The next broad run must isolate
  generated Rust output from the frontend watcher or serialize native builds
  and browser tests. The owned E2E server was stopped; no test process remains.
- Fresh locked native suite exited 0: **234 library tests and 12 real-Git
  integration tests passed**. Raw log: `native-final-sep20.log` in plan scratch.
- With all competing suites stopped, the enforced reference run still failed:
  root connection 61 ms and body Inspector commit 55 ms; warmed Arrange passed.
  This rules out test-suite contention as the sole explanation. Worker startup
  remained close to its unchanged limit (4,705.1 ms in that run).
- Problems-panel investigation found quadratic duplicate-ordinal scans. An
  80-row deterministic work-budget test failed at **9,960 identity reads** against
  a 240-read ceiling. A one-pass map retains the existing per-fingerprint keys;
  the Problems/identity suite then passed **18/18**. The expanded App/Problems/
  identity run passed **87/87** before extracting the map into the existing pure
  TypeScript helper to satisfy lint, then passed **87/87 again** afterward
  (70.77 seconds, exit 0). Fix commit: `dc956cf`.
  Fresh full-repository format/lint/check/build/bundle gates passed, with zero
  Svelte errors/warnings and 1,999,841 minified / 384,473 gzip bytes.
  Final targeted browser checks passed **3/3** (33.3 seconds): overview Arrange,
  scoped Problems routing, and repeated export diagnostics. The cold Arrange
  worker responded in 4,542.9 ms with no termination or missing-handle warning;
  its attached metric snapshot precedes debounced persistence. Diagnostic commit:
  `877f73e`. These checks do not replace the remaining full-suite acceptance run.
- Post-optimization reference run: **2 passed / 1 failed**. Root connection,
  root Inspector (50 ms), Settings navigation, and every warmed Arrange passed;
  loop-body Inspector remained at 60 ms. The five-pass sequence stopped at run
  one. `linear-problems-reference-1.log` and its test-results directory retain
  evidence; no threshold was weakened. Warmed accepted totals were 402.9, 389.8,
  388.1, 385.4, and 386.9 ms, each with no observed long task.
- Inspector profiling found synchronous full-document YAML parsing on the main
  thread in `applyWorkflowMutation -> patchWorkflowPair -> patchWorkflowDocument`:
  a 93.132 ms microtask interval included 79.2 ms in `parseWorkflowYaml`. The
  post-worker renderer task was 40.408 ms. These are profiler diagnostics, not
  acceptance timings. Next work must preserve syntax/alias safety and revision
  checks while moving expensive field-patch preparation off the UI thread.
  The browser-only stale/read-only presentation experiment did not improve the
  connection result and was not included in production.
- Full unit run exited 1: **2,418 passed / 1 failed**, 184 files, 2,204.17 seconds.
  The sole failure compared the lockfile to pre-security-patch commit `1227cc7`.
  Verified that the only lockfile difference is devalue's version, URL, and
  integrity; updated the immutable provenance reference to `51ef64a`, retaining
  exact-byte comparison. The complete release-check file then passed **10/10**,
  exit 0 (13.27 seconds). Fix commit: `9ab130b`. This is full-run evidence plus a
  focused correction, not a claim that a second full run has passed.
- Full functional Chromium run exited 1: **197 passed / 2 failed** (21.0 minutes).
  Setup at effective 200% failed a named-dialog lookup despite the captured title
  and content being present. Unchanged targeted repeats passed all **12 Setup
  cases**, plus five isolated lookup probes; no speculative modal fix was made.
  The overview Arrange regression failed in the full run and three targeted
  repeats. A further diagnostic attempt proved a **5,003.3 ms worker timeout**:
  one request, zero responses, one termination, zero validation/publication/
  persistence, and zero missing-handle warnings. Raw JSON is in
  `test-results-task13-arrange-diagnostic-sep20/canvas-capacity-keeps-capa-6e792-y-available-through-Arrange-chromium/overview-arrange.json`.
  These runs overlapped correctness suites; they are not reference-performance
  measurements. No worker timeout or routing-safety assertion was weakened.
- Current debug MSI and NSIS rebuild exited 0; the extracted NSIS payload passed
  all 42 resource checks. Its executable deliberately retains the console
  subsystem under `debug_assertions`, as declared in `src-tauri/src/main.rs`:
  applying the release GUI-subsystem check to it failed as expected. Only the
  optimized candidate below passed that check. Debug NSIS SHA-256:
  `E1BE64E047D48822031523B128C27720FD6F50FB330F5B7F78BDF8B35B28F40E`;
  MSI: `996098F0DBD6570839F90772559AB37F5D3F32ED89462630B440BADDDFA99806`.
  Debug extraction: `C:\Users\ecorell\AppData\Local\Temp\ws-debug-check-f1d46cd3ceb447d587229c509a92536e`.
- GitHub read-only branch-run query returned no runs. Branch push/draft-PR
  permission has been requested to obtain CI results; neither action has occurred.
- The preserved Task 11 startup report explicitly used
  `C:\Users\ecorell\ws11target\debug\workflow-studio.exe`. Its later reference to
  an "unchanged release binary" is inaccurate: those measurements do not establish
  optimized-release startup performance. The failed historical comparison remains
  recorded, and current release-mode measurement is still outstanding.
- Overview handle regression: new unit test failed because both measurable
  anchors were absent; after adding hidden noninteractive anchors, 3/3 node tests
  passed. The browser regression also passed: an accepted 250/500 Arrange retains
  overview edges and emits no missing-handle warnings. RED artifacts:
  `test-results-task13-handles-red` (missing overview edges) and
  `test-results-task13-handles-red-2` (separate cold Arrange timeout); GREEN:
  `test-results-task13-handles-green`.
- First post-anchor enforced reference run: **2 passed / 1 failed**. Root gestures,
  authoring, Settings, and Arrange passed; all five warmed Arrange samples had no
  long tasks and accepted totals of 389.1, 386.4, 372.9, 379.5, and 370.9 ms.
  The scoped scenario failed Back to root at 54 ms. Artifacts:
  `test-results-task13-handles-performance`.
- Scope-return profiling identified card/edge detail and interactive Handle
  registration in the same reveal frame. A new frame-order regression failed
  before splitting the updates and passed afterward. Full affected canvas/node
  files passed **146 tests across two files**, exit 0 (29.70 seconds).
- The attempted five-consecutive-run gate stopped at run one: Arrange passed
  again, Settings navigation failed at 73 ms, and body Inspector commit failed at
  74 ms. Back to root was not reached, so the new staging has not yet earned a
  reference-performance acceptance claim. Raw output:
  `.superpowers/sdd/2026-09-14-workflow-studio-windows-primary-stabilization/reference-sep20-1.log`;
  artifacts: `test-results-task13-reference-sep20-1`. No threshold was relaxed.
- Fresh repository-wide formatting, lint, and Svelte/TypeScript checks passed
  (zero Svelte errors/warnings). Lint initially found a rule violation in the
  temporary profiling script; that script was corrected before the passing run.
  Contracts, examples, 42 resource checks, and both audits passed; zero reported
  vulnerabilities. Current bundle: 1,999,841 minified / 384,472 gzip bytes.
- Full unit regression and optimized NSIS rebuild are running at this checkpoint.
  No final regression gate is claimed until their exit results are recorded.
- Updated optimized NSIS rebuild subsequently exited 0 (release compile 3m26s).
  Extracted payload passed all 42 resource checks and the GUI PE-subsystem check.
  SHA-256: `03DB01B01980882BB77C4A031C1E3E716D5F38E873E8A526870DEC317810A013`.
  Payload: `C:\Users\ecorell\AppData\Local\Temp\ws-release-check-463a77ac38224dbba70cfa5b2995ecc8`.
  This local unsigned candidate includes the handle/staging fixes committed in
  `83427da`; final whole-project acceptance remains pending. It was extracted,
  not installed or launched. Full unit and functional Chromium runs are underway;
  raw logs are `full-unit-sep20.log` and `full-functional-sep20.log` in plan scratch.
- Read-only UAT preparation identified version 3.0.1 installed at
  `C:\Users\ecorell\AppData\Local\LOOP24 Workflow Studio`, with existing state at
  `C:\Users\ecorell\AppData\Roaming\com.cmetech.workflowstudio` and
  `C:\Users\ecorell\AppData\Local\com.cmetech.workflowstudio`. No app process was
  running at that check. User confirmation was requested before backup/test launch
  and restoration; no approval has yet been received and nothing was launched.

### September 20 navigation checkpoint

Commit: `944bb9f`. Fresh post-change Svelte/TypeScript check exited 0 with zero
errors/warnings. This checkpoint is not a final whole-project acceptance claim.

- Isolated diagnostic experiments did not establish focus-only scheduling or
  removing the scroll scan as sufficient fixes. These browser-only experiments
  did not alter production scroll restoration.
- Identified a concrete navigation cost: `surfaceActive` drove both Svelte Flow
  capability props and an effect cloning every node's drag/connect flags.
  Inactivity now uses an inert canvas boundary plus existing gesture guards;
  capabilities still update for read-only, stale, transition, and Arrange states.
  The new behavior test failed before implementation and passed afterward.
- Heading focus now yields to an animation frame instead of extending the
  navigation microtask flush. Pending focus is cancelled on effect cleanup and
  disconnected headings are ignored. The new focus-order test failed before
  implementation and passed afterward. No scrolling behavior was removed.
- Fresh combined `App.test.ts`, `ActivityPage.test.ts`, and `GraphCanvas.test.ts`:
  **213 passed across three files**, exit 0, 80.97 seconds. Fresh full
  `activity-pages.spec.ts` Chromium run after both changes: **10 passed**, exit 0,
  1.1 minutes; artifacts: `test-results-task13-navigation-focus-sep20`.
  Changed-file formatting/lint and diff checks passed. Full-project regression
  acceptance is still pending; these are affected-suite results.
- Production build and bundle budget passed: **1,999,841 bytes minified /
  384,469 bytes gzip** (only 159 bytes below the minified budget).
- Navigation-only CPU/Chrome diagnostic after both changes showed a maximum
  reported main task of **40.454 ms** versus earlier 62–65 ms samples. This is
  exploratory evidence, not five consecutive enforced reference passes.
- Reference run after capability stabilization but before deferred heading focus
  failed all three scenarios: valid root connection 52 ms, warmed Arrange 63 ms,
  loop-body Inspector commit 64 ms. Earlier phases passed; Settings and Back to
  root were not reached in that run. CPU sampled 56%. Artifacts preserved in
  `test-results-task13-performance-sep20`.
  Cold Arrange accepted after 4,979.4 ms worker time / 5,574.3 ms total; validation
  56.4 ms, publish 37.8 ms, fit 42.6 ms. Warmed response was a cache hit: worker
  10.7 ms, validation 43.7 ms, publish 29.3 ms, fit 3 ms; assertion failed before
  persistence completed. No timeout, long-task, or bundle threshold was relaxed.
- Follow-up warmed Arrange CPU profiling (`profile-arrange.mjs` and
  `arrange.cpuprofile` in the plan scratch directory) found **399 missing-handle
  warnings** over cold/warm layout: 397 source and two target. Svelte Flow
  `getEdgePosition` warning forwarding through the Vite client was a prominent
  sampled hotspot; `hasLongCoincidentSegment`/`coincidentLength` and safety
  validation were also prominent. The final diagnostic accepted cold/warm
  arrangements: worker 3,361.1/10.3 ms, validation 45.5/44.1 ms, publish 37.7/24.5 ms,
  total 3,881.8/432.1 ms. Profiling overhead means these are diagnostic samples,
  not performance acceptance. Investigate handle lifecycle before suppressing any
  warning or changing the geometry safety algorithm. No fix for this finding yet.

### Machine and earlier checkpoints

Machine inventory: Windows 11 Enterprise 10.0.26200 (build 26200); Intel Core
i5-1145G7, four cores/eight logical processors; 68,384,157,696 bytes physical RAM.
Reported active display resolutions: 1920×1080 (Intel Iris Xe) and 3840×2160
(DisplayLink). Actual per-monitor effective DPI remains to be measured during UAT;
registry DPI offsets alone are not an effective-scale measurement. Installed
WebView2 directories include 153.0.4234.32, .46, and .48; the actual packaged-app
runtime version must be recorded when launched. Toolchain: Node 22.23.1, npm 10.9.8,
Rust/Cargo 1.88.0, Git 2.55.0.windows.3.

Commands run from `.worktrees/windows-primary-stabilization` with the LOOP24 Node
installation and the user Cargo installation prepended to the process PATH.

| Check | Result | Notes |
| --- | --- | --- |
| Focused canvas measurement, invalid dimensions, compound group, and rendering boundary tests | Exit 0; 9 passed | Restored observer-based measurement for ordinary graphs; bounded DOM fallback remains capacity-only. |
| Scoped canvas performance and E2E performance policy unit tests | Exit 0; 11 passed | Scope-switch assertion waits for deferred rendering. Policy verifies use of the retry helper; retry behavior has separate tests. |
| Keyboard authoring unit tests, isolated rerun | 3 passed | Failed in the concurrent broader run; full-suite acceptance remains open. |
| `npm run contracts:check` | Exit 0 | Bundled contracts and conformance corpora validated. |
| `npm run examples:check` | Exit 0 | Bundled examples validated. |
| `npm run resources:verify` | Exit 0 | 42 packaged resource files verified. |
| `npm run build` | Exit 0 | Production renderer build. |
| `npm run bundle:check` | Exit 0 | Initial closure: 1,999,726 bytes minified; 384,433 bytes gzip. |
| `git diff --check` | Exit 0 | Before this evidence document was added. |

The full unit run was started before the scope/policy test corrections. Its result
cannot be treated as final verification of those corrections. Final static, unit,
native, security, functional-browser, and reference-performance results remain to
be recorded after the last applicable change.

## Historical acceptance gates (superseded by final disposition above)

### Additional findings during the September 19 run

- The full audit reported GHSA-9rgm-9g3h-6x36 in transitive `devalue@5.8.2`.
  `npm update devalue --package-lock-only --ignore-scripts` resolved `5.9.4` and
  reported zero vulnerabilities. Installation and checks against that installed
  version remain pending; the active unit run uses the earlier installed tree.
- Native untracked-file Git previews failed with `git_preview_failed`. This host
  has a real `C:\dev\null` directory; `git diff --no-index /dev/null <file>` tries
  to read a child of that directory. The same read-only probe with `NUL` succeeds.
  The runner now selects `NUL` on Windows and `/dev/null` elsewhere. The existing
  real-repository `disposing_version_session_revokes_pending_and_retained_authority`
  test reproduced the failure and then passed after the fix (1 passed, exit 0).
  The argv contract was updated too. The obsolete full native run was stopped and
  a fresh full run started. The unrelated `C:\dev\null` directory was not changed.
- Lint, Svelte/TypeScript checks, and formatting passed before this document and
  the native/dependency changes. Svelte reported zero errors and zero warnings.
- Subsequent `npm audit --omit=dev` and `npm audit` both exited 0 with zero
  vulnerabilities in the updated lockfile. The lockfile diff is limited to the
  version, URL, and integrity of `devalue`; unrelated npm classification changes
  were removed. `cargo +1.88.0 fmt --manifest-path src-tauri/Cargo.toml -- --check`
  and `git diff --check` also exited 0 after the native fix.
- Three CPU samples during the broad correctness runs reported 100% utilization.
  Other installation processes and endpoint services were active. The owned idle
  Vite server on port 1521 was stopped to reduce load. Do not attribute timing
  failures from this interval to application code without an isolated rerun.
- Independent review found two Important regressions: overview edges omitted the
  class that provides their visible stroke, and deferred multiline scalar edits
  skipped semantic equality verification. Both reproduced with failing tests.
  Overview paths now carry the stroke class; block/multiline scalar edits retain
  exact-value verification and fallback. `WorkflowEdge.test.ts`,
  `transactions.test.ts`, and `patch-document.test.ts` passed 94/94 tests, exit 0.
  Narrow re-review confirmed both findings resolved with no new findings. Actual
  browser visibility and the remaining acceptance gates are still pending.
- `cargo +1.88.0 test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1`
  exited 0: 234 library tests passed in 881.97 seconds and 12 real-Git integration
  tests passed in 295.03 seconds. The reviewed native null-device fix is committed
  separately as `90949a1`.
- After the review fixes, `npm run format:check`, `npm run lint`, and
  `npm run check` all exited 0; Svelte reported zero errors and zero warnings.
- Broad unit command completed in 2,284.23 seconds: 181 files passed, three
  failed; 2,408 tests passed and three failed (2,411 total). The scope/policy
  failures were from assertions corrected after the run started. The remaining
  failure used the default one-second wait for the lazy Explorer; that lookup now
  uses the existing deferred-surface readiness timeout, like the canvas lookup.
- Installed `devalue@5.9.4` using `npm install --ignore-scripts --no-audit --no-fund`.
  A fresh combined run of the three previously failing files and the three review
  regression files passed all 108 tests across six files (85.71 seconds, exit 0).
  Both audits then exited 0 with zero vulnerabilities. Dependency fix: `51ef64a`.
- Rebuilt renderer and bundle budget passed after the review fixes and installed
  dependency update: 1,999,764 bytes minified and 384,446 bytes gzip. An initial
  performance launch collided with the manually starting Vite server before any
  scenario ran. After HTTP 200 readiness was confirmed, the enforced performance
  command was restarted with reuse enabled on port 1521.
- Enforced reference run: **1 passed, 2 failed** (exit 1, 1.2 minutes). Settings
  navigation recorded 67 ms and 60 ms long tasks; warmed Arrange recorded 56 ms.
  Root drag, connection, Inspector, and Problems phases reported zero long tasks
  before the Settings failure. The complete scoped-gesture/navigation scenario
  passed with zero long tasks in every reported phase. CPU samples during this
  run were 54.57%, 83.74%, and 51.14%; a quiet-host comparison is still required.
  Thresholds were not relaxed. The overview-edge screenshot was visually inspected.
  The subsequent functional run reused `test-results`, overwriting these performance
  artifacts; only the recorded timings below remain. Subsequent targeted runs must
  use separate output directories to retain evidence.
- Functional browser coverage exposed small-graph edge hover suppression below
  0.5 zoom. The capacity optimization now checks capacity rendering before
  suppressing hover. A 3/100-node parameterized regression reproduced the small
  graph failure before the fix; seven hover/emphasis tests passed afterward.
  Independent narrow review found no correctness concerns. Browser rerun pending.
- Two Add Node modal cases measured/injected overflow into the deferred loading
  dialog. The test now waits for the real picker combobox before geometry checks;
  review accepted this readiness correction without weakening the assertions.
- Debug MSI and NSIS builds exited 0. Extracting the NSIS payload without installing
  and running the packaged-resource verifier passed all 42 files. PowerShell's
  recursive inventory hit MAX_PATH in the deep artifact directory; Node's verifier
  successfully checked the extracted resources. No installed application was run.
  These provisional packages precede the hover correction and need rebuilding.
  Debug MSI SHA-256: `FCDF2F51EFAE98E68EC79AEC6400239A2A0BA6AD0FEA9B0A143D6632FEEA2E6B`.
  Debug NSIS SHA-256: `3D83C169D781D40DF781E5C14F31E715E85398D305CEF8E6C7694A4BFA500BEB`.
- Full Windows functional Chromium run completed in 21.4 minutes: 194 passed,
  four failed (the two modal and two edge-emphasis cases above). A fresh affected
  browser run after both fixes passed all nine cases in one minute, including all
  four modal geometries. Artifacts: `test-results-task13-hover-modal`; original
  failures remain in `test-results`. The broad run started before these fixes;
  this is not a single clean final full-suite run. Fix checkpoint: `fde007b`.
  Fresh `npm run check` reported zero errors/warnings; changed-file ESLint and
  Prettier checks, plus `git diff --check`, all exited 0.
- The initial optimized x86_64 Windows NSIS build exited 0 (Rust release compile:
  19m04s). Its extracted payload passed the GUI PE-subsystem check and all 42
  resource checks. Local test configuration disables updater signing; Authenticode
  status is `NotSigned`. Provisional installer SHA-256:
  `F1B12365876605275766CB0B051D723C6497C77ABB57A63FD078D6D34874E0F4`.
  Extraction only, no launch: `%LOCALAPPDATA%/Temp/ws-release-check-34e6a1813fc8471fb20a33cafbade3e9`.
  Like the debug bundle, this initial release bundle predates the hover correction.
- Post-build performance rerun at `fde007b`, with no owned concurrent build/test
  suite, failed all three reference cases. A CPU sample during the run was 21%
  (not proof of sustained idle): Settings 60 ms; cold Arrange worker timed out at
  5,006.6 ms (total 5,112.7 ms, zero responses); Back to root 55/59 ms. Earlier
  scoped gesture phases again recorded zero long tasks. Artifacts are preserved
  separately in `test-results-task13-performance-isolated`. Host contention alone
  is not a sufficient explanation. No threshold or timeout was changed.
- Diagnostic navigation-only CPU/Chrome trace reproduced 64.841/62.193 ms main
  tasks. Reactive flushes occupied 43.879/46.627 ms; focus stacks point to
  `ActivityPage.svelte` and `returnToAuthoringSurface` in `App.svelte`. Style updates
  touched 2,617/3,280 elements; a layout visited 4,380 objects. This supports
  investigating focus/layout combined with reactive navigation work, but is not
  a confirmed isolated root cause or acceptance measurement (profiling adds cost).
  Local diagnostic files: `.superpowers/sdd/2026-09-14-workflow-studio-windows-primary-stabilization/`
  `profile-navigation.mjs`, `navigation.cpuprofile`, and `navigation-trace.json`.
  No product changes were made from this profiling hypothesis yet.

| Arrange phase (ms) | Cold run 0 | Warmed run 1 at failed assertion |
| --- | --- | --- |
| Measure | 81.5 | 16.3 |
| Fingerprint | 2.2 | 2.3 |
| Serialize | 0.2 | 0.1 |
| Worker | 3464.0 | 9.3 |
| Validate | 47.5 | 54.8 |
| Publish | 30.8 | 24.0 |
| Fit | 29.2 | 1.9 |
| Persist | 6.2 | 0 (pending) |
| Total | 3985.5 (accepted) | 152.3 (pending) |

The cold response contained 2,086 route points; the warmed worker returned a cache
hit (`durationMs: 0`). The warmed run is not an accepted performance result.

1. Complete automated verification and resolve any remaining failures.
2. Run Windows functional Chromium coverage and five consecutive enforced
   reference-performance passes, recording raw timings and long tasks. Revalidate
   the carried-forward cold-start and first-drag gates.
3. Build and inspect debug and release Windows packages.
4. Obtain the planned safety confirmation before replacing or launching the
   installed application; back up exact installation and application-data paths,
   record hashes and restoration instructions, then perform packaged UAT.
5. Record W1–W18 requirement evidence, machine/toolchain details, cross-platform CI
   results, reviewed commit, limitations, and final review outcome.

Linux/macOS compatibility has not been established by the current Windows-only
run. No installed-app replacement, user-data migration, or release is claimed by
this record.

## Final requirement evidence map

| Requirement | Available evidence | Qualification / disposition |
| --- | --- | --- |
| W1: no Git/Hermes console flashes | Shared native launch flags; Windows native suite passes; packaged launch/folder/Git observation found zero new visible console windows in 2,291 samples | Observation is sampled, not an absolute guarantee against sub-poll flashes |
| W2: one folder/Git discovery lifecycle | Current CI unit/native gates; Task 8 debug-native folder-open median 393.026 ms against <400 ms target; current packaged folder opening passed | Task 8 timing is historical, not a new packaged latency measurement; raw samples below |
| W3: Windows YAML overwrite | Current Windows native suite; packaged atomic save, external conflicts, read-only save prevention, restart/reopen passed | Required tested flows covered; not a claim about every filesystem/ACL combination |
| W4: Git-compatible Windows paths | 12 real-Git integration tests; current packaged version/history/tracked rename passed, unrelated staged note preserved | None for tested flows |
| W5: custom-brand staging rename | Current native suite; packaged import/preview/activate/restart/remove passed | None for tested flows |
| W6: no user-visible verbatim paths | Current regression gates; welcome/recent temporary-folder display uses ordinary Windows paths | None for observed surfaces |
| W7: bounded root/scoped drag | Five current general canvas passes; all scoped gestures had no >50ms tasks; user accepted Back-to-root 61–85ms exception | No further navigation optimization authorized |
| W8: reliable bounded Arrange | User accepted rare capacity Arrange timeout; packaged pointer Arrange passed at d6d53f7 and keyboard Arrange at baf04fe at 100%/200% effective scale | Do not claim strict capacity acceptance |
| W9: bounded cold renderer closure | Fresh bundle 1,999,412 minified / 384,773 gzip bytes passes | Measured native startup exception explicitly accepted September 21 |
| W10: checkout line endings | Current CI quality and Windows checkout/installer gates passed | None for reviewed revision |
| W11: portable diagnostic paths | Current full CI unit suite passed | None for reviewed revision |
| W12: isolated release-state GitHub tests | Current full CI unit suite passed | None for reviewed revision |
| W13: explicit Windows POSIX shell | Current Windows checkout/installer gate passed | None for reviewed revision |
| W14: full Windows CI | All seven jobs passed at baf04fe, including full Windows native and functional shards | None for this revision |
| W15: deterministic loop-token caret | Current Windows functional shards and cross-browser renderer passed | None for reviewed revision |
| W16: practical renderer feedback | Current Windows functional shards and cross-browser renderer passed | None for reviewed revision |
| W17: dependency advisories | Fresh production and full audits report zero vulnerabilities | Recheck if dependencies change |
| W18: packaged workflow coverage | Native file/Git/brand/restart/100%-200% effective-scale/keyboard/idle checks; pointer and keyboard Arrange; capacity root/body drag; simulated offline launch; console observation; GUI+42 resources and backup restoration verified; measured startup exception explicitly accepted September 21 | Complete within recorded exceptions and test scope; physical OS DPI/network settings were not changed |

### Raw timing inventory carried into the final record

Task 8 debug-native folder-open critical path, milliseconds (capability binding,
repository discovery and watcher registration; excludes watcher shutdown):
`436.4808, 418.6724, 419.0088, 393.2835, 378.1919, 379.8898, 392.7680, 376.3180, 409.3509, 385.2703`.
Median: **393.02575 ms**. Discovery-only median: **389.2036 ms**. Source:
scratch `task-8-report.md`, completed at `e7c819c`. Task 8 required debug-native
timing, not a second packaged benchmark; current CI regression coverage and
packaged folder opening complement, but do not re-date, that measurement.

Matched startup samples, milliseconds, ten alternating launches per executable:

- Installed-copy baseline: `2493.6, 7303.2, 2719.9, 3100.1, 3027.9, 6795.2, 7417.8, 2644.7, 2933.8, 3721.3`.
- Candidate: `2924.9, 2620.2, 7839.5, 3241.9, 7843.7, 2911.3, 2634.4, 6949.7, 2745.6, 3077.5`.

The startup summary uses nearest-rank percentiles, unlike the Task 8 arithmetic
median. Its exit-0 collection result contains `targetMet: false`; the user's
exception, not a changed threshold, resolves release acceptance.
