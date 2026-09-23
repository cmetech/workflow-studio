# Final-gate deferred-focus correction

The Windows Chromium functional run on `d5a9090` finished with 213 passes and
two failures, using one worker and zero retries. The earlier all-examples copy,
package keyboard, and delete/rebuild journeys all passed. This report preserves
the failed full-run result; focused checks do not replace it.

## Verified focus race

The details-panel resize journey passed pointer resizing and the Home-key
minimum-height check, then failed the End-key maximum-height check. Its trace
shows the loop heading and its stylesheet finishing loading between those
keys. The deferred heading focus request was still current for the scope,
but the user had already focused the resize handle. Completing that request
stole focus and directed End away from the handle.

Two deterministic unit regressions reproduced focus theft during loading and
settling: two failures, three existing passes. A real browser regression held
the heading module request, focused the separator and pressed Home, then
released the heading. The separator lost focus, reproducing the defect without
depending on host speed.

The helper now observes focus changes while loading and settling. A newer
non-body focus target permanently supersedes the pending request. Removing
the original opener without choosing a new target still allows normal deferred
focus. The listener is removed on success, cancellation, and exceptions.

Verification after correction: seven unit tests passed. Five Chromium journeys
passed in 33.7 seconds: the deterministic regression, the original resize case,
normal compound-group entry, and Meta/Control node-focus preservation.
Independent preliminary source review found no actionable issue, including
Inspector caller behavior and listener cleanup. Independent immutable review
of `a18369d4eab8ac3d6e84a1e7a65718bff4946c95`, tree
`e8bfe4f8250b8ff70ecf08c65de4add11faed34b`, also returned no findings.
The corrected candidate passed all 3,002 unit tests across 256 files, all
seven static checks, the production build, all four strict performance cases,
and all 216 Windows Chromium functional cases with zero retries in 15.3 minutes.
Both original failed Windows scenarios and the deterministic regression passed.
Linux two-engine functional acceptance is recorded separately in the final
verification receipt.

## Separate loading failure and runner correction

The other failed journey was the 1024-by-700 workbench-containment case. It
timed out after five seconds waiting for the graph while the UI still displayed
its visual-editor loading state. The trace contains slow local module requests
and no console errors. Its geometry assertions were not the failure.

The local final-gate helper wrote traces under
`.superpowers/.../browser-results`, outside the dev server's existing
`test-results*` watch exclusion. A synthetic probe using the actual installed
Vite watcher recorded 26 filesystem events and 16 hot-update callbacks for
that path shape, versus zero events for the excluded path shape. Local runner
logs, telemetry, and artifacts now use `test-results-final-<candidate>`.
Earlier receipts are preserved. This confirms unwanted watcher traffic; it
does not establish that traffic as the loading timeout's sole cause. The full
corrected Windows run passed with unchanged assertions and timeouts, using
the same Vite server process without a restart.

The five frozen adversarial reports remain unchanged. No native implementation
changed in this correction; the exact native results on `d5a9090` remain
separate evidence. No installed-app or macOS runtime acceptance is inferred.
