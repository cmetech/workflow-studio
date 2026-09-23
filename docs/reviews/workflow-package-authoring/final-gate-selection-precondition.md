# Final-gate selection test precondition correction

The full Linux Chromium/WebKit run on `35b3bd0` completed with 427 passes,
two failures, and three existing skips in 31.2 minutes. One failure was the
existing Escape/selection journey, previously reproduced against the
pre-feature application on Windows WebKit. Its final Create Edge assertion
expected no selected node after replacing the complete YAML document.

Whole-document replacement leaves the editor caret on the final `publish`
node. `YamlEditor` deliberately synchronizes new cursor selections to the
canvas. The previously cleared `prepare` node and dependency remained
cleared; the newly selected `publish` enabled Create Edge. Adding an explicit
empty selected-node assertion reproduced the failure as `['publish']`
instead of `[]` in 11.7 seconds.

The test now changes only the top-level description through actual editor
keyboard input. It verifies exact authoritative YAML and waits for the
matching analysis revision. The caret stays outside all node ranges during
the edit. No selection-clearing action occurs after the edit, so projection
resurrection remains observable. Every original assertion remains, together
with the stronger final empty-selection assertion.

The corrected journey passed in Chromium and WebKit with zero retries, two
passes in 14.4 seconds. The complete affected authoring file then passed all
48 cases across both engines in 4.1 minutes. Windows Chromium passed the
corrected journey and neighboring picker-priority case, two passes in
19.7 seconds. Independent preliminary review returned PASS with zero findings.
Immutable review confirmation is recorded in the
[final verification receipt](../../verification/2026-09-23-package-final-gate.md).

The other full-run failure was WebKit capacity Arrange reaching its unchanged
five-second worker deadline. This test correction does not address or waive
that separate result. No product code, timeout, retry count, or performance
threshold changed. The five frozen adversarial reports remain unchanged.
