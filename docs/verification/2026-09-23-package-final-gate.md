# Workflow package final verification, September 23

The tested source is `a18369d4eab8ac3d6e84a1e7a65718bff4946c95`, tree
`e8bfe4f8250b8ff70ecf08c65de4add11faed34b`. Its Linux source archive SHA-256 is
`21a5cdd0472c750557167200ab36ed98f67bc9257141dedd503541368cd1dffb`.
Browser harness correction `35b3bd06c462d556770383106ea1f25d20ffdc38`, tree
`21a18487f750a806b2cfa2006451c5c99a49c027`, changes only global warm-up and its
review receipt. All product source, dependencies, browser journey assertions,
and native code are identical to `a18369d`. Its fresh Linux archive SHA-256 is
`ef7066cfa507246cb6aaaa531e7fa4d8444b677922a69d6f558f9ece75b003ee`.
The complete Linux browser run uses that exact archive with local dependencies
and the verified production build from identical product source. Subsequent
documentation-only commits preserve these tested identities.

Final selection-test correction `a35839d28de5614b4277323dac732526250c8270`,
tree `9a3fb6715b7a08af5e457130618a9ae74074d10d`, changes only the affected
browser test and its review receipt. Independent immutable review returned
PASS with zero findings. Product source remains identical to `a18369d`.

## Automated results

| Gate | Observed result |
| --- | --- |
| Full unit suite, Linux | 3,002 tests across 256 files passed; exit 0; 441.79 seconds |
| Static checks | Formatting, lint, type checking, authoring contracts, exact pinned package contracts, examples, and 72 packaged resources passed; zero type errors or warnings |
| Production build | Passed; startup closure 1,401,106 minified bytes / 375,136 gzip bytes, below unchanged 2,000,000 / 450,000 limits |
| Windows Chromium functional | 216 passed; zero retries or skips; exit 0; 15.3 minutes |
| Windows strict reference performance | Four passed; exit 0; 51.1 seconds; unchanged thresholds |
| Linux Chromium and WebKit functional | 427 passed, two failed, three configured skips; exit 1; 31.2 minutes. All 216 Chromium cases and all package-specific cases in both engines passed. Follow-up correction and remaining deadline failure are detailed below. |
| Native Windows | 343 passed: 330 library, one IPC dispatch, 12 Git integration; exit 0 |
| Native Linux, Git 2.55.0 | 380 passed: 352 library, one IPC dispatch, 27 Git integration; exit 0 |
| Linux package Git compatibility, Git 2.34.1 | All 19 package tests passed; ordinary pair-hook paths require newer Git |
| Fresh marketplace interoperability | Both Studio-produced versions validated and compiled; install, explicit trust, and update passed; update invalidated trust |

The native suites ran on `d5a90905e6e6d370f990e87d8b39a2047e666494`.
Its `src-tauri` tree and the final candidate's are identical:
`7c7c13a17689e334361be754438a1a3514618715`. Package manifests and lockfiles
also did not change. The subsequent correction changed deferred frontend
focus handling and tests; native suites were not repeated without a native change.

All four strict performance cases passed. Every sampled long-task list was
empty. All six Arrange phases were accepted, with a 3,128.3 ms cold worker.
Package readiness measured 104 files at 520.9 ms cold and 128.6 ms concurrent,
with 30 pointer frames and zero authority work in those frames.

Functional browser commands used `playwright test --grep-invert
@reference-performance --workers=1 --retries=0 --reporter=list`, adding
`--project=chromium` on Windows. Both used the existing CI timeout profile
and an explicitly owned reusable local Vite server. Linux used the existing
CI `WORKFLOW_STUDIO_PERCEPTUAL_PERFORMANCE=off` policy; it is functional
acceptance, not strict reference-host timing evidence. Strict timing was
verified separately on Windows without that override.

Unit JSON SHA-256:
`fe0942131bef7823b557e634f0edb4363aeaa1664fe96383afecd3fcfd452ed1`.
Windows logs and command/exit receipts are retained under the ignored
`test-results-final-a18369d4eab8ac3d6e84a1e7a65718bff4946c95` directory.
Linux phase receipts, logs, and marketplace receipts are retained under
`.superpowers/sdd/2026-09-03-workflow-package-authoring-local-publishing`.
The final browser reconciliation receipt SHA-256 is
`9946445eb21566ebbde1d91d78a030895ff80743b352eea2343c04d98dde31c0`;
it pins the full failed run, affected-file pass, and isolated baseline comparison.

## Preserved failures and corrections

The five original adversarial reports remain frozen with their original
verdicts. Their [reconciliations](2026-09-22-workflow-package-authoring.md)
record accepted findings and verified corrections. Additional final-gate
regressions were reproduced and independently reviewed:

- [Git filter isolation](../reviews/workflow-package-authoring/final-gate-git-filter-correction.md): index serialization could invoke a configured filter on an unrelated racy entry.
- [Normalized index entries](../reviews/workflow-package-authoring/final-gate-normalized-index-correction.md): copied index stat metadata could conceal a same-length symlink retarget.
- [Deferred focus](../reviews/workflow-package-authoring/final-gate-deferred-focus-correction.md): a late loop-heading load could steal a newer keyboard focus choice.
- [Cold browser warm-up](../reviews/workflow-package-authoring/final-gate-cold-browser-warmup.md): missing package/artifact imports and an early warm-up close allowed dependency optimization to reload active test pages.
- [Selection test precondition](../reviews/workflow-package-authoring/final-gate-selection-precondition.md): whole-document replacement introduced a new node-cursor selection into a test that required no selection during projection refresh.

An explicit Unix permission-constant conversion also resolves an Apple
`u16`/`u32` type mismatch. Compiler probes and independent source review
verify the conversion; they do not establish macOS build or runtime acceptance.

The first isolated Linux unit run passed 2,990 tests and failed eight because
its runner lacked build output, Git provenance history, jq, and the expected
Cargo example path. Correcting those prerequisites cleared all 108 tests in
the affected four files, then the full corrected suite. No assertion changed.

The prior Windows functional candidate passed 213 cases and failed two.
The focus regression received deterministic failing/passing tests. A separate
runner defect wrote traces outside Vite's existing watch exclusions: a real
watcher probe produced 26 events and 16 hot-update callbacks for the old path,
and none for the corrected path. This proves unwanted watcher traffic, not
the loading timeout's sole cause. All 216 corrected Windows cases passed on
the same server process, with unchanged assertions and timeouts.

The initial Linux browser attempt used symlinked shared dependencies. Vite
rejected font requests outside its filesystem allow list, and dependency
optimization reloaded the failed Examples journey. That run was stopped:
30 passed, one failed, one interrupted, 400 not run, exit 130. Its evidence
is preserved. Dependencies were copied into the isolated checkout, without
changing tracked source or broadening Vite's filesystem permissions. After
optimization settled, the original journey passed in Chromium and WebKit
with one worker and zero retries, two passes in 13.4 seconds. An earlier
diagnostic invocation accidentally retained CI retries after shell argument
splitting; its flaky result is not acceptance evidence.

The subsequent Linux attempt passed 121 tests before being stopped with one
script-editing failure, one interrupted case, and 309 not run, exit 130.
The trace and server log identify a Markdown editor dependency optimization
reload during the failed journey. The warm-up correction adds seven deferred
surfaces and awaits startup network idle within the unchanged timeout.
Fresh-cache Examples and script-editing regressions passed in both engines:
four passes in 35.7 seconds, zero retries, and exactly one document request
per retained test trace. Seven warm-up/policy unit tests, affected formatting
and lint, and type checking (zero errors/warnings) passed. Independent review
confirmed immutable `35b3bd0` with zero findings. Product code and acceptance
assertions did not change.

## Linux full-run disposition

The complete two-engine run on `35b3bd0` exited 1 with 427 passes, two failures,
and three existing WebKit skips. The skipped worker-inspection and routed-edge
measurement/forced-color probes are configured for Chromium. The full run
passed every package authoring, preparation, and recovery case in both
engines. No font-denial or optimizer-reload failure recurred.

The Escape-selection failure came from a distinct cursor gesture introduced
by whole-document replacement. A stronger regression first exposed
`selectedNodeIds: ['publish']`. The corrected test changes only the top-level
description through real keyboard input, verifies exact YAML and matching
analysis, and preserves every original assertion. It does not clear selection
after the edit. Both focused cases passed, then the entire affected authoring
file passed 48 tests across Chromium and WebKit, zero retries, in 4.1 minutes.
Windows Chromium also passed the corrected and adjacent picker-priority cases,
two passes in 19.7 seconds. Affected formatting/lint and type checking passed,
with zero type errors or warnings. These results correct that test's
precondition; they are not a new full-suite pass.

The remaining capacity failure reached the unchanged five-second worker
deadline: 5,002 ms, zero worker responses, one termination, and no missing
handles. The application preserved its existing layout. The capacity test
and all canvas/worker source files are identical to pre-feature baseline
`955499dde9eb29c3dd2b06fdcbb26022ab4d1ccf`.

An isolated Linux comparison used that baseline's source archive, SHA-256
`925f76017ed10c1e8e48b178311a2ee09b19626f4f56edac453a112082c429c2`, with the
same installed browser/dependency versions and a test-only startup network-idle
barrier. Baseline production code and capacity assertions were unchanged.
Both baseline cases passed in 23.9 seconds; its WebKit worker took 4,244 ms.
Both feature-candidate cases also passed in isolation, in 18.4 seconds;
its WebKit worker took 4,621 ms. This establishes an intermittent observed
deadline failure, not its complete cause or a passing full Linux gate.

Earlier Windows baseline reproductions and the recorded acceptance of rare
Windows capacity timeouts remain historical context. They do not create a
new Linux/WebKit waiver. No deadline, assertion, retry count, or skip changed
to accept this result. Further investigation or explicit acceptance of this
Linux limitation remains necessary before claiming the full gate passes.

## Marketplace handoff

Fresh synthetic versions 1.0.0 and 1.0.1 were generated by the final Studio
candidate's production APIs and accepted by pinned agent
`3e89c2659b6e9c95a627b8f819ff63a11529d86a` on its descriptor-safe Linux backend.
Distribution/index validation and compilation passed for both versions.
Installation was untrusted, explicit synthetic trust changed it to trusted,
and the payload update invalidated trust. No authored content executed;
socket access was blocked and Git transport was local-file-only.

Acceptance receipt SHA-256:
`26cd6299bd6b4ddca9db11b0ec6253f0f4c110f687ac6eb101e38ef44843b1d6`.
The [interoperability procedure](2026-09-22-package-marketplace-interop.md)
describes the production API flow and admission constraints. This is local
compatibility evidence, not marketplace publication.

## Remaining acceptance boundaries

Installed-app keyboard and screen-reader observations, native file picker,
Open/Reveal, restart recovery, macOS runtime, physical Windows cross-volume,
and crash/power-loss acceptance remain unverified. Browser mocks do not prove
these native interactions. Filesystem-root workspaces or mounted resources
without a safe external retention location fail closed.

The implementation completion gate remains open for the Linux capacity
deadline failure and required manual acceptance. No merge, push, publication,
signed build, or release is claimed.

Use an isolated synthetic workspace for the installed-app observations and
record the exact build/commit, platform, actions, results, and retained paths:

- Navigate a package, workflow, custom companion, script, and action menu by keyboard; verify cancellation restores focus.
- Inspect package labels, previews, errors, and recovery locations with a screen reader; check reduced motion in the native WebView.
- Reveal and open a synthetic PNG or plain text file, verifying the actual OS destination. Do not execute authored scripts.
- Make external changes while a draft exists; compare versions, exercise Keep Mine with a second external change, and verify restart recovery.
- Verify retained-file notices remain accessible across artifact navigation; dismissing a notice must preserve the recovery file and its origin record after restart.
- Replace a binary through the OS picker; inspect destination/hash, verify cancellation preserves bytes, and confirm successful replacement updates size and recovery details.
- Record supported-platform link/reparse, permissions, cross-volume, and crash limitations explicitly; injected tests do not replace physical platform observations.
