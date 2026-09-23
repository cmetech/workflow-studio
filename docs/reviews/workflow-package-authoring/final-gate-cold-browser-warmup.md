# Final-gate cold browser warm-up correction

The isolated Linux functional run on `a18369d` exposed two dev-server
startup boundaries. Shared symlinked dependencies caused font requests to
fall outside Vite's filesystem allow list; copying dependencies into the
isolated checkout resolved that runner configuration issue. The next run
passed 121 cases, failed the first script-editing journey, and was stopped
with one interrupted case and 309 not run (exit 130). Both failed attempts
and their traces remain preserved.

The failed script journey returned to Welcome while awaiting its new editor.
Its trace records a second page load, and the server log records first-time
optimization of `@codemirror/lang-markdown` at that point. The earlier
Examples failure likewise coincided with optimization of existing icon and
Markdown-rendering dependencies. This was a page reload, not a failed native
save or a slow assertion.

The existing global warm-up omitted all seven new package/artifact surfaces
and closed its page as soon as dynamic imports resolved. Vite can schedule
a reload after dependency discovery completes. The correction adds those
surfaces to the existing import list and waits for network idle before
closing the warm-up page, using the existing timeout. It changes no product
code, test assertions, retry count, or performance threshold.

Verification began with a fresh optimizer cache and the affected Examples
and script-editing journeys in both Chromium and WebKit. All four passed,
with one worker and zero retries, in 35.7 seconds. Every retained trace has
exactly one document request: its initial test navigation. The optimizer
reload occurred during warm-up, before the journeys began. All seven
existing warm-up/performance-policy unit tests passed.

Independent preliminary source review returned PASS with zero findings.
Immutable confirmation and the complete Linux functional result are recorded
in the [final verification receipt](../../verification/2026-09-23-package-final-gate.md).
The five frozen adversarial reports remain unchanged.
