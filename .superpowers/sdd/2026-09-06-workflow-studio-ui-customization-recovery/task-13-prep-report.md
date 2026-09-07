# Task 13 preparation report

> The current receipts are in [Post-review verification](#post-review-verification--supersedes-the-earlier-candidate). Earlier candidate/artifact hashes below are historical and have been superseded.

This report covers preparation and verification only. Independent Claude/Codex review, reconciliation, and the completion review remain controller-owned follow-up work. No integration, version change, tag, release workflow, publication, application installation, or changes to another worktree/Hermes were performed.

## Scope and committed corrections

Starting HEAD: `081b4f8cef6299b0202a0d639d84e55dd2c68f26`. Worktree: `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery`. Branch: `fix/ui-customization-recovery`.

- `e38e20f`: committed the common external adversarial prompt before any verification correction. Both independent lanes receive R1–R19, every-changed-path inspection, current loop/scanner preservation, user-template exclusion, frozen identity/receipts, and stable reviewer-prefixed findings with trigger, expected/actual behavior, impact, evidence, and smallest correction.
- `31420cd`: fixed the compact More menu height allocation while preserving the 44px canvas contract.
- `2292667`: corrected stale app-capacity Save expectations and exercised real CodeMirror edits plus exact native YAML writes above capacity.
- `3125495`: removed four trailing-space Markdown hard breaks in the recovery design header so the complete branch diff passes `git diff --check`.
- `c45bdf1`: replaced the node-menu metric test's insufficient 400ms delay with the existing explicit persistence flush.
- `e6ec543`: corrected the keyboard accessibility fixture's unmeasured initial resize and focused-Explorer precondition, without changing product behavior.

## Root cause and RED/GREEN evidence

### Compact 200% canvas

Existing behavioral regression command, run before production modification:

```text
npx playwright test tests/e2e/workbench-layout.spec.ts --project=chromium --grep 'usable canvas and every More'
1 failed
Expected: >= 44
Received:    43.40625
```

A temporary browser measurement probe recorded each vertical boundary. At 512×350 CSS pixels: titlebar 53px; footer 33px; workbench 264px; editor rows 42px / 116.40625px / 105.59375px. The More toolbar occupied 73px: 32px trigger + fixed 40px compact menu + 1px toolbar border. Its 116.40625px graph container therefore left 43.40625px for the actual canvas viewport. The lower panel's fractional 40% allocation explains the fractional result; neither the visible Save row nor the viewport assertion was changed.

The smallest source fix bounds the compact menu with `min(2.5rem, calc(100cqh - 2rem - 1px - 2.75rem))`, reserving the existing trigger, border, and 44px viewport while keeping the overflow menu scrollable and hittable. Temporary instrumentation was removed; the original threshold and test remain byte-identical.

```text
npx playwright test tests/e2e/workbench-layout.spec.ts --grep 'usable canvas and every More'
2 passed (3.9s)
```

Chromium and WebKit both passed the existing containment, minimum-height, scrolling, focus, hit-testing, and last-action click assertions. This is effective 200% CSS reflow evidence, not an assertion of native zoom testing.

### Oversized clean-document Save

```text
npm run test:unit -- tests/performance/app-capacity.test.ts
Test Files  1 failed (1)
Tests  2 failed (2)
Expected: "saved"
Received: undefined
```

Task 6's reviewed report explicitly defines clean-document Save as disabled; App's `documentSaveAvailable` requires a dirty writable nonmissing pair, and the shared button/shortcut handler returns otherwise. The two old capacity tests invoked Save without editing, then expected a controller `saved` result containing `unchanged`. That expectation is stale; the capacity advisory is not the blocker.

The corrected tests retain exact 251-node and 33-node/501-edge fixtures and assert clean status, disabled visible Save, no save outcome, and no write after the clean shortcut. They then insert a comment through the real CodeMirror view, await the current real worker analysis, invoke visible Save, and assert one exact YAML write, unchanged parsed graph content, restored clean status, and continued YAML-only mode. No product Save guard was changed.

```text
npm run test:unit -- tests/performance/app-capacity.test.ts
Test Files  1 passed (1)
Tests  2 passed (2)
```

Exact 250-node/500-edge positive-capacity and per-scope coverage remains in `canvas-performance`, `scoped-canvas-performance`, and `indexed-reference-validation`; `app-capacity` deliberately tests the boundaries immediately above that contract.

### Keyboard fixture discovered by the whole suite

The initial ordered gate run passed gates 1–6, then stopped on one deterministic unit failure:

```text
Test Files  1 failed | 164 passed (165)
Tests  1 failed | 1969 passed (1970)
FAIL tests/accessibility/keyboard-authoring.test.ts
Expected the element to have attribute: inert
Received: null
```

The focused suite reproduced the same failure (1 failed, 1 passed). A temporary probe confirmed that jsdom's initial workbench measured 0px, no docked ResizeObserver state was established, the viewport had switched to drawers, and focus remained on the Explorer treeitem. The existing resize contract preserves a focused panel; Task 8 now correctly restores docked open state, exposing this old fixture assumption. App's existing resize logic was unchanged by this preparation.

The fixture now supplies the initial 1440px docked workbench measurement and 720px editor measurement, then reaches the canvas through the existing keyboard-only Tab helper before simulating compact resize. The closed Explorer expectation now has the same preconditions as the real browser journey. All subsequent keyboard authoring, focus, save, and cycle-rejection assertions remain intact.

```text
npm run test:unit -- tests/accessibility/keyboard-authoring.test.ts
Test Files  1 passed (1)
Tests  2 passed (2)
```

The ordered gates were restarted after this test correction; initial failure receipts were preserved separately.

## Evidence location

All raw logs and measured diagnostic output are retained locally under `.superpowers/sdd/2026-09-06-workflow-studio-ui-customization-recovery/task-13-evidence/` in this worktree. The directory is ignored; this report is force-added as the requested committed handoff record. It includes `layout-red.log`, `layout-sizing-probe.log`, `layout-green.log`, `capacity-red.log`, `capacity-green.log`, `keyboard-investigation.log`, `keyboard-sizing-probe.log`, `keyboard-green.log`, `gate-07-test-unit-initial.log`, `gate-receipts-initial.json`, and the final gate receipts/logs. Diagnostic instrumentation is absent from committed tests.

## WebKit menu measurement correction

The next full gate run passed unit/Rust/build, then completed E2E with `351 passed (6.1m)` and one WebKit Control-menu failure: the menu-only metric snapshot reported `nativeCalls: 1` instead of zero. The isolated rerun passed, so a temporary native-boundary probe logged method identity and timing while repeating the exact test 10 times. It reproduced nine failures and one pass, identifying `layoutSave` approximately 74–89ms after metrics reset.

`LayoutPersistenceController.viewportOrPanelsChanged` schedules at 500ms. The test's 400ms delay therefore reset metrics before the already pending layout write had drained; normal platform timing decided whether the write landed inside the menu assertion interval. This was unrelated to menu-open/navigation work and did not require weakening a metric or changing production persistence.

The correction uses the existing `window.__WORKFLOW_STUDIO_E2E__!.flushRecoveryPersistence()` hook, which flushes graph persistence, document layout persistence, and recovery before resetting metrics. Existing scoped performance browser journeys already use this boundary. All parse, validation, layout, YAML transaction, native call, Git, and layout-save zero limits are unchanged.

```text
npx playwright test tests/e2e/workspace-authoring.spec.ts --project=webkit --grep 'node actions preserve Control' --repeat-each=10
10 passed (20.3s)
```

Temporary bridge and browser console probes were removed completely before commit. Raw evidence: `control-webkit-red.log` (isolated pass after the whole-run failure), `control-webkit-native-probe.log` (9 failures/1 pass with exact native call stacks), `control-webkit-green.log` (10 passes), and `gate-10-test-e2e-before-menu-flush.log` (the full 351/352 result). The full ordered gates were restarted on `c45bdf1` after the final test and whitespace corrections.

## Final deterministic gates

All commands ran in the required order on clean candidate `c45bdf1b89c1a8ff7dbd4806fe76e1e1c8c267a5`. Exact raw output remains in each named log; timings are wall-clock seconds measured by the receipt runner.

| Order | Command | Exit | Seconds | Exact result | Log |
| --- | --- | --- | --- | --- | --- |
| 1 | `npm run format:check` | 0 | 2.932 | All matched files use Prettier code style! | `gate-01-format-check.log` |
| 2 | `npm run lint` | 0 | 3.27 | No ESLint findings. | `gate-02-lint.log` |
| 3 | `npm run check` | 0 | 3.718 | svelte-check found 0 errors and 0 warnings; tsc exited 0. | `gate-03-check.log` |
| 4 | `npm run contracts:check` | 0 | 0.174 | Validated bundled authoring contracts and conformance corpora. | `gate-04-contracts-check.log` |
| 5 | `npm run examples:check` | 0 | 0.372 | Validated bundled workflow examples. | `gate-05-examples-check.log` |
| 6 | `npm run resources:verify` | 0 | 0.103 | Verified 40 packaged resource files | `gate-06-resources-verify.log` |
| 7 | `npm run test:unit` | 0 | 15.0 | Test Files  165 passed (165); Tests  1970 passed (1970) | `gate-07-test-unit.log` |
| 8 | `npm run test:rust` | 0 | 18.053 | 246 native unit + 24 local Git integration tests passed; 0 failed/ignored; main/doc suites contain 0 tests. | `gate-08-test-rust.log` |
| 9 | `npm run build` | 0 | 1.064 | ✓ built in 823ms | `gate-09-build.log` |
| 10 | `npm run test:e2e` | 0 | 364.351 | 352 passed (6.1m) — 176 Chromium and 176 WebKit, no skips or retries. | `gate-10-test-e2e.log` |

Exact unit and Rust result lines:

```text
 Test Files  165 passed (165)
      Tests  1970 passed (1970)
test result: ok. 246 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 11.53s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.06s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The complete unit run includes the unchanged exact-capacity fixtures in `tests/performance/canvas-performance.test.ts`, `scoped-canvas-performance.test.ts`, and `indexed-reference-validation.test.ts`, plus the corrected oversized-boundary `app-capacity.test.ts`. Browser `canvas-capacity` and the scoped hidden-work instrumentation also passed in both engines.

The renderer build emitted the existing advisory that some minified chunks exceed 500 kB. Playwright emitted the existing `NO_COLOR`/`FORCE_COLOR` environment warning. These were warnings, not failing gates.

## Unsigned macOS candidate

```text
npx tauri build --no-sign --bundles app,dmg
exit 0; wall time 68.668 seconds
Finished `release` profile [optimized] target(s) in 34.20s
Warn Skipping signing due to --no-sign flag.
Warn Updater signing is skipped due to --no-sign flag.
```

The build ran at the same source candidate as the final deterministic gates. `Info.plist` reports:

```json
{
  "CFBundleName": "LOOP24 Workflow Studio",
  "CFBundleDisplayName": "LOOP24 Workflow Studio",
  "CFBundleIdentifier": "com.cmetech.workflowstudio",
  "CFBundleShortVersionString": "2.0.0",
  "CFBundleVersion": "2.0.0",
  "CFBundleExecutable": "workflow-studio"
}
```

`file` reports `Mach-O 64-bit executable arm64`; `lipo -archs` reports `arm64`. `codesign -dv --verbose=4` reports `flags=0x20002(adhoc,linker-signed)`, `Signature=adhoc`, `TeamIdentifier=not set`, and `Sealed Resources=none`. This is linker ad-hoc metadata, not Developer ID/Apple signing or notarization. Updater signing was skipped, and no `.sig` file was produced.

The application bundle is located at:

```text
/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app
```

Artifacts and exact SHA-256 receipts:

- `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/dmg/LOOP24 Workflow Studio_2.0.0_aarch64.dmg`
  - Bytes: `6312669`
  - SHA-256: `b13105f6474f32709d7c338e0b013641e85b835601afe0eec5caa890dbf381ac`
- `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio`
  - Bytes: `17724800`
  - SHA-256: `b97963baf03a027946fb7a0884598e0beb08c8a68c22e6b0e5cef9193cc800a7`
- `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app.tar.gz`
  - Bytes: `6419701`
  - SHA-256: `fc0fa7d411b117cba69d907be1b0a7fb2ba2a141f46df4ea397ad96a240ce761`
- `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/.superpowers/sdd/2026-09-06-workflow-studio-ui-customization-recovery/task-13-evidence/app-file-sha256.json`
  - Bytes: `5630`
  - SHA-256: `5aee3906e1a91b5935254026180ad45ac1c7a1dd6644b16370bdb1b78143f21d`

A directory has no single native file hash: `app-file-sha256.json` records each of the app's 43 files, and its own SHA-256 is listed above. The app archive is an additional unsigned artifact automatically emitted by Tauri, not a signed updater deliverable.

Resource verification ran against both the built app's `Contents/Resources/_up_` and a read-only mounted DMG payload using the committed `src-tauri/resources/setup-integrity-v1.json`. Both commands returned exactly `Verified 40 packaged resource files`. This covers contracts and paired corpora, examples, LOOP24 brand resources, and license documentation. The complete 43-file app tree in the DMG matches the built app by exact per-file SHA-256; the unsigned tar archive matches the same tree. The temporary DMG mount was detached successfully and its worktree-local mount directory removed.

Offline guides are bundled in the renderer. All `14` guide titles and raw-import keys are present in `App-1ka22jXl.js`. Its exact uncompressed SHA-256 is `fd3e7f8b6783becb8721f9b3b9e154f06c5b51b7568284cbb02c39d4aed2f94d` (2583975 bytes). The matching Tauri-generated Brotli asset is `96bcb6c69f4a388f74721a40b969815d75bd459f9c25d7896a3b8da59af19285` (460938 bytes), decompresses byte-for-byte to that renderer, and its complete compressed byte sequence is present in the packaged executable. This verifies the native artifact contains the renderer whose guide presence was checked.

Native evidence files: `native-build.log`, `native-build-receipt.json`, `native-verification.log`, `native-artifacts.json`, `app-file-sha256.json`, `embedded-guides.log`, `embedded-guides.json`, and `archive-verification.log`. Verification drivers are retained as `verify-native.py` and `verify-embedded-guides.mjs`.

This preparation does not claim native launch, installation, clean-machine acceptance, Intel/Windows packaging, Apple notarization, or updater signature verification. Independent review and any later release decisions remain separate.

## Frozen source candidate and changed-path inventory

The following commands ran after the successful build/resource verification and before the report-only handoff commit. This source candidate owns the exact tested/built artifacts; the later handoff commit adds only this SDD report.

```text
git merge-base base HEAD
aa91baac4081f0ca585b10fb3fb65b966a7ec24c
git rev-parse HEAD
c45bdf1b89c1a8ff7dbd4806fe76e1e1c8c267a5
git status --short --branch
## fix/ui-customization-recovery
git diff --check base...HEAD
(no output; exit 0)
```

`git diff --name-status base...HEAD` returned exactly 84 paths:

```text
M	docs/app-guides/conditions-and-outputs.md
M	docs/app-guides/dag-dependencies.md
M	docs/app-guides/loops-and-approvals.md
A	docs/app-guides/node-types.md
M	docs/app-guides/quick-start.md
M	docs/app-guides/retry-and-triggers.md
M	docs/releasing.md
A	docs/reviews/2026-09-06-ui-customization-recovery-external-review-prompt.md
A	docs/superpowers/plans/2026-09-06-workflow-studio-ui-customization-recovery.md
A	docs/superpowers/specs/2026-09-06-workflow-studio-ui-customization-recovery-design.md
M	src/app/ActivityPage.svelte
M	src/app/ActivityPage.test.ts
M	src/app/App.canvas-authoring.test.ts
M	src/app/App.svelte
M	src/app/App.test.ts
M	src/app/StatusBar.svelte
M	src/app/StatusBar.test.ts
M	src/e2e/bootstrap.ts
A	src/features/branding/AccentPicker.svelte
A	src/features/branding/AccentPicker.test.ts
A	src/features/branding/AppearanceSettings.svelte
A	src/features/branding/AppearanceSettings.test.ts
M	src/features/branding/BrandSettings.svelte
M	src/features/branding/BrandSettings.test.ts
A	src/features/branding/Loop24Mark.svelte
A	src/features/branding/Loop24Mark.test.ts
M	src/features/canvas/CanvasToolbar.svelte
M	src/features/canvas/GraphCanvas.svelte
M	src/features/canvas/GraphCanvas.test.ts
M	src/features/canvas/canvas-actions.test.ts
M	src/features/canvas/canvas-actions.ts
M	src/features/canvas/canvas-authoring-coordinator.test.ts
M	src/features/canvas/canvas-authoring-coordinator.ts
M	src/features/documentation/DocumentationArticle.svelte
M	src/features/documentation/DocumentationArticle.test.ts
M	src/features/documentation/DocumentationOverview.test.ts
M	src/features/documents/AuxiliaryPanel.svelte
M	src/features/documents/AuxiliaryPanel.test.ts
M	src/features/documents/ProblemsPanel.svelte
M	src/features/documents/ProblemsPanel.test.ts
M	src/features/documents/document-workspace-controller.test.ts
M	src/features/documents/document-workspace-controller.ts
M	src/features/editor/editor-extensions.test.ts
M	src/features/editor/editor-extensions.ts
M	src/features/examples/ExampleGallery.svelte
M	src/features/examples/ExampleGallery.test.ts
M	src/features/workspace/OpenWorkspace.svelte
M	src/features/workspace/OpenWorkspace.test.ts
A	src/lib/branding/appearance.test.ts
A	src/lib/branding/appearance.ts
M	src/lib/branding/theme-sync.test.ts
M	src/lib/branding/theme-sync.ts
M	src/lib/commands/registry.test.ts
M	src/lib/commands/registry.ts
M	src/lib/commands/types.ts
M	src/lib/docs/build-index.test.ts
M	src/lib/docs/build-index.ts
M	src/lib/docs/navigation.test.ts
M	src/lib/docs/navigation.ts
M	src/lib/documents/transactions.test.ts
M	src/lib/documents/transactions.ts
M	src/lib/layout/layout-store.test.ts
M	src/lib/layout/layout-store.ts
M	src/lib/layout/types.ts
M	src/lib/validation/analyze-workflow.test.ts
M	src/lib/validation/analyze-workflow.ts
M	src/lib/workspace/recent-workspaces.test.ts
M	src/lib/workspace/recent-workspaces.ts
M	src/lib/yaml/patch-document.test.ts
M	src/lib/yaml/patch-document.ts
M	src/main.ts
A	src/stores/appearance.test.ts
M	src/stores/branding.ts
M	tests/accessibility/keyboard-authoring.test.ts
M	tests/e2e/branding.spec.ts
A	tests/e2e/fixtures/problems-panel.html
M	tests/e2e/invalid-yaml-recovery.spec.ts
M	tests/e2e/loop-group-authoring.spec.ts
M	tests/e2e/modal-layout.spec.ts
M	tests/e2e/workbench-containment.spec.ts
M	tests/e2e/workbench-layout.spec.ts
M	tests/e2e/workspace-authoring.spec.ts
M	tests/performance/app-capacity.test.ts
M	tests/project/release-version.test.ts
```

The subsequent report-only commit adds `.superpowers/sdd/2026-09-06-workflow-studio-ui-customization-recovery/task-13-prep-report.md` to that inventory. Its full commit identity is returned in the controller handoff, avoiding a self-referential commit hash inside the report. No executable input changes after the frozen source candidate.

All six npm/package-lock/Cargo/Cargo-lock/Tauri version records were independently checked as `2.0.0`; the release-metadata diff against `base` is empty. `git ls-files "*ProblemsResizeHandle*"` returns no paths. The merge base remains the required immutable `aa91baa` baseline. `candidate-identity.json`, `candidate-changed-paths.txt`, `candidate.diff`, and `version-invariants.log` retain the exact freeze receipts.

No completion-review file was created, and no external review lanes were dispatched. The controller can now freeze the report-bearing handoff commit and dispatch the common independent review prompt.

## Post-review verification — supersedes the earlier candidate

This section supersedes all earlier candidate, gate, and artifact identities in this preparation report. Earlier receipts remain historical evidence for source `c45bdf1b89c1a8ff7dbd4806fe76e1e1c8c267a5`; rebuilding replaces the artifacts at the same local bundle paths. Use only the post-review hashes below for the current candidate.

The controller requested re-verification of post-review source `8d6def0103238ec25f6fa6fc8fdcf1779a044abc`. Its first ordered gate run passed gates 1–6, then stopped at the full unit gate with `7 failed | 1983 passed (1990)` across `4 failed | 162 passed (166)` files. Focused reproduction returned the same seven failures; YamlEditor alone retained two failures, ruling out cross-file ordering and the new startup-test mocks.

Six failures were dependency-environment drift: the committed npm lockfile pins `@codemirror/commands` 6.10.4, but the installed tree held root 6.10.4 and a nested 6.11.0 under codemirror. The independent module copies own different history StateFields. A read-only state probe demonstrated that one commands copy sees an undo depth of 1 while the other sees 0 and returns false for the same edited state. The reviewed editor change touched theme CSS only; its basicSetup/history setup was unchanged. `npm ci` restored the exact committed installation, after which all 76 tests in the three previously failing editor/App suites passed without source edits. Before/after dependency trees and install output are retained as `dependencies-before.log`, `dependencies-after.log`, and `npm-ci.log`. Neither package nor lockfile was modified.

The remaining failure was the style inventory's classification of `focus-contrast`. It is generated by the appearance layer rather than supplied by imported BrandManifest data. A standalone style-contract run after `npm ci` remained RED (1 failed, 1 passed), identifying `focus-contrast` as its only unknown token. Commit `e5b2a219f1a1822fbb9fc27678a3d811c6381e9a` adds a test-local explicit set containing only that renderer-derived token; the imported `THEME_TOKEN_NAMES` schema remains unchanged. A temporary unknown CSS color token still triggered the original guard and was removed immediately. The style/load-brand/validate-theme suites then passed all 34 tests, and full format/lint/check passed. This is the only source-tree correction made during this post-review verification task, and it changes only `tests/project/style-contract.test.ts`.

The final tested/built source candidate is `e5b2a219f1a1822fbb9fc27678a3d811c6381e9a`, whose parent is exactly the requested post-review source. Every complete gate was restarted in the required order on that clean commit, with no subsequent application or test changes. The later handoff commit changes this report only.

All new raw receipts are under `.superpowers/sdd/2026-09-06-workflow-studio-ui-customization-recovery/task-13-post-review-evidence/`. The initial failed gate receipts are preserved in `initial-8d6def0/`; focused diagnostic evidence includes `focused-failure.log`, `yaml-editor-isolated.log`, `undo-module-probe.log`, `undo-after-ci.log`, `style-contract-red.log`, `style-contract-green.log`, and `unknown-color-guard-probe.log`. The fixture probe and temporary code are absent from the committed source.

### Superseding deterministic gate receipts

| Order | Command | Exit | Seconds | Exact result | Log |
| --- | --- | --- | --- | --- | --- |
| 1 | `npm run format:check` | 0 | 3.001 | All matched files use Prettier code style! | `gate-01-format-check.log` |
| 2 | `npm run lint` | 0 | 3.196 | No ESLint findings. | `gate-02-lint.log` |
| 3 | `npm run check` | 0 | 3.709 | svelte-check found 0 errors and 0 warnings; TypeScript exit 0. | `gate-03-check.log` |
| 4 | `npm run contracts:check` | 0 | 0.365 | Validated bundled authoring contracts and conformance corpora. | `gate-04-contracts-check.log` |
| 5 | `npm run examples:check` | 0 | 0.382 | Validated bundled workflow examples. | `gate-05-examples-check.log` |
| 6 | `npm run resources:verify` | 0 | 0.105 | Verified 40 packaged resource files | `gate-06-resources-verify.log` |
| 7 | `npm run test:unit` | 0 | 15.54 | Test Files  166 passed (166); Tests  1990 passed (1990) | `gate-07-test-unit.log` |
| 8 | `npm run test:rust` | 0 | 18.536 | 246 native unit + 24 local Git integration tests passed, no failures/ignores. | `gate-08-test-rust.log` |
| 9 | `npm run build` | 0 | 1.18 | ✓ built in 801ms | `gate-09-build.log` |
| 10 | `npm run test:e2e` | 0 | 368.442 | 356 passed (6.1m); 178 Chromium + 178 WebKit, no skips/retries. | `gate-10-test-e2e.log` |

Exact unit/Rust summary output:

```text
 Test Files  166 passed (166)
      Tests  1990 passed (1990)
test result: ok. 246 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 11.59s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.98s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The complete run includes the app-capacity oversized boundaries, exact 250-node/500-edge canvas and scoped/indexed-reference fixtures, and both browser engines' capacity/hidden-scope journeys. The post-review caret, two-tone toolbar focus, and CSS-pixel focus-paint assertions passed in both engines.

Vite retained its existing minified-chunk advisory, and Playwright retained the `NO_COLOR`/`FORCE_COLOR` warning. These did not fail any gate. `npm ci` printed its dependency deprecation/audit notices in `npm-ci.log`; no dependency versions or lockfile entries were changed.

### Superseding unsigned native artifact receipts

```text
npx tauri build --no-sign --bundles app,dmg
exit 0; wall time 46.621 seconds
Finished `release` profile [optimized] target(s) in 12.86s
Warn Skipping signing due to --no-sign flag.
Warn Updater signing is skipped due to --no-sign flag.
```

The app bundle is:

```text
/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app
```

Exact `Info.plist` identity:

```json
{
  "CFBundleName": "LOOP24 Workflow Studio",
  "CFBundleDisplayName": "LOOP24 Workflow Studio",
  "CFBundleIdentifier": "com.cmetech.workflowstudio",
  "CFBundleShortVersionString": "2.0.0",
  "CFBundleVersion": "2.0.0",
  "CFBundleExecutable": "workflow-studio"
}
```

`file` reports `Mach-O 64-bit executable arm64`, and `lipo -archs` returns `arm64`. The executable retains linker-generated ad-hoc metadata (`Signature=adhoc`, `TeamIdentifier=not set`, `Sealed Resources=none`); no Developer ID/Apple signing or notarization is claimed. Updater signing was skipped and no `.sig` file was produced.

Use these current artifact identities, replacing all earlier hashes for the same paths:

- `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/dmg/LOOP24 Workflow Studio_2.0.0_aarch64.dmg`
  - Bytes: `6313534`
  - SHA-256: `8d7c85dc8c60312b65dd4889ee374e7915b7fc526be3b193f59f2a8a45af6dee`
- `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio`
  - Bytes: `17724800`
  - SHA-256: `a990fdd49e733f541cfca53dd50dfb2e8dfd94d635bdda97b47691b76f523725`
- `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app.tar.gz`
  - Bytes: `6420159`
  - SHA-256: `256c88ec1aa5b8b9c137d1914767e58dfe9010b6b287bce7fde5cad4077f46e2`
- `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/.superpowers/sdd/2026-09-06-workflow-studio-ui-customization-recovery/task-13-post-review-evidence/app-file-sha256.json`
  - Bytes: `5630`
  - SHA-256: `dd8062765888ea0f58c6a41f8eb4da0cd1d8ae4595b62b85b3ae35e75ad81ac3`

`app-file-sha256.json` is the current 43-file directory manifest; its listed hash identifies the complete set of per-file SHA-256 receipts. The additional tar archive is unsigned and is not a signed updater deliverable.

The committed source integrity manifest verifies all 40 resources in both the built app and the read-only mounted DMG. Both verifier runs returned exactly `Verified 40 packaged resource files`. This covers contracts and paired corpora, examples, LOOP24 resources, and license documentation. All 43 app files in the DMG match the built app by exact SHA-256, and the tar archive matches that same file tree. The temporary worktree-local DMG mount was detached and removed successfully.

The production renderer `App-egT4FJ-7.js` contains all 14 offline guide titles/import keys. Its SHA-256 is `a80bd96a4cfe0b6ea823953ac7bbc50a6452cc285db19d5beead7cefbca94aca` (2584267 bytes). The exact Tauri-generated Brotli asset has SHA-256 `b59c7052b86c385c13bb426fb27c12c2a4ee67d190162c270e3ae14ec78af134` (461011 bytes), decompresses to that renderer byte-for-byte, and its complete compressed contents are embedded in the packaged executable. The guide receipt therefore covers the actual native artifact.

Raw native evidence: `native-build.log`, `native-build-receipt.json`, `native-verification.log`, `native-artifacts.json`, `app-file-sha256.json`, `archive-verification.log`, `embedded-guides.log`, and `embedded-guides.json`, alongside the two retained verification drivers.

### Superseding candidate freeze

The following commands ran after artifact verification and before updating this report:

```text
git merge-base base HEAD
aa91baac4081f0ca585b10fb3fb65b966a7ec24c
git rev-parse HEAD
e5b2a219f1a1822fbb9fc27678a3d811c6381e9a
git status --short --branch
## fix/ui-customization-recovery
git diff --check base...HEAD
(no output; exit 0)
```

The frozen source candidate has exactly 89 changed paths against `base`. The later handoff commit modifies this already-tracked report only, so it adds no path to this inventory. `git diff --name-status base...HEAD` output:

```text
A	.superpowers/sdd/2026-09-06-workflow-studio-ui-customization-recovery/task-13-prep-report.md
M	docs/app-guides/conditions-and-outputs.md
M	docs/app-guides/dag-dependencies.md
M	docs/app-guides/loops-and-approvals.md
A	docs/app-guides/node-types.md
M	docs/app-guides/quick-start.md
M	docs/app-guides/retry-and-triggers.md
M	docs/releasing.md
A	docs/reviews/2026-09-06-ui-customization-recovery-external-review-prompt.md
A	docs/superpowers/plans/2026-09-06-workflow-studio-ui-customization-recovery.md
A	docs/superpowers/specs/2026-09-06-workflow-studio-ui-customization-recovery-design.md
M	src/app.css
M	src/app/ActivityPage.svelte
M	src/app/ActivityPage.test.ts
M	src/app/App.canvas-authoring.test.ts
M	src/app/App.svelte
M	src/app/App.test.ts
M	src/app/StatusBar.svelte
M	src/app/StatusBar.test.ts
M	src/e2e/bootstrap.ts
A	src/features/branding/AccentPicker.svelte
A	src/features/branding/AccentPicker.test.ts
A	src/features/branding/AppearanceSettings.svelte
A	src/features/branding/AppearanceSettings.test.ts
M	src/features/branding/BrandSettings.svelte
M	src/features/branding/BrandSettings.test.ts
A	src/features/branding/Loop24Mark.svelte
A	src/features/branding/Loop24Mark.test.ts
M	src/features/canvas/CanvasToolbar.svelte
M	src/features/canvas/GraphCanvas.svelte
M	src/features/canvas/GraphCanvas.test.ts
M	src/features/canvas/canvas-actions.test.ts
M	src/features/canvas/canvas-actions.ts
M	src/features/canvas/canvas-authoring-coordinator.test.ts
M	src/features/canvas/canvas-authoring-coordinator.ts
M	src/features/documentation/DocumentationArticle.svelte
M	src/features/documentation/DocumentationArticle.test.ts
M	src/features/documentation/DocumentationOverview.test.ts
M	src/features/documents/AuxiliaryPanel.svelte
M	src/features/documents/AuxiliaryPanel.test.ts
M	src/features/documents/ProblemsPanel.svelte
M	src/features/documents/ProblemsPanel.test.ts
M	src/features/documents/document-workspace-controller.test.ts
M	src/features/documents/document-workspace-controller.ts
M	src/features/editor/editor-extensions.test.ts
M	src/features/editor/editor-extensions.ts
M	src/features/examples/ExampleGallery.svelte
M	src/features/examples/ExampleGallery.test.ts
M	src/features/workspace/OpenWorkspace.svelte
M	src/features/workspace/OpenWorkspace.test.ts
A	src/lib/branding/appearance.test.ts
A	src/lib/branding/appearance.ts
M	src/lib/branding/theme-sync.test.ts
M	src/lib/branding/theme-sync.ts
M	src/lib/commands/registry.test.ts
M	src/lib/commands/registry.ts
M	src/lib/commands/types.ts
M	src/lib/docs/build-index.test.ts
M	src/lib/docs/build-index.ts
M	src/lib/docs/navigation.test.ts
M	src/lib/docs/navigation.ts
M	src/lib/documents/transactions.test.ts
M	src/lib/documents/transactions.ts
M	src/lib/layout/layout-store.test.ts
M	src/lib/layout/layout-store.ts
M	src/lib/layout/types.ts
M	src/lib/validation/analyze-workflow.test.ts
M	src/lib/validation/analyze-workflow.ts
M	src/lib/workspace/recent-workspaces.test.ts
M	src/lib/workspace/recent-workspaces.ts
M	src/lib/yaml/patch-document.test.ts
M	src/lib/yaml/patch-document.ts
A	src/main.test.ts
M	src/main.ts
A	src/stores/appearance.test.ts
M	src/stores/branding.ts
M	src/styles/tokens.css
M	tests/accessibility/keyboard-authoring.test.ts
M	tests/e2e/branding.spec.ts
A	tests/e2e/fixtures/problems-panel.html
M	tests/e2e/invalid-yaml-recovery.spec.ts
M	tests/e2e/loop-group-authoring.spec.ts
M	tests/e2e/modal-layout.spec.ts
M	tests/e2e/workbench-containment.spec.ts
M	tests/e2e/workbench-layout.spec.ts
M	tests/e2e/workspace-authoring.spec.ts
M	tests/performance/app-capacity.test.ts
M	tests/project/release-version.test.ts
M	tests/project/style-contract.test.ts
```

`candidate-identity.json`, `candidate-changed-paths.txt`, and `candidate.diff` retain the complete frozen source evidence. The six package/lock/Cargo/Tauri version records are still exactly `2.0.0`; their diff against `base` is empty. The obsolete ProblemsResizeHandle path inventory is empty. These checks are recorded in `version-invariants.log`.

The final handoff commit is report-only; its full identity is returned to the controller. No application/test changes follow the frozen source commit. This task did not write a completion review, dispatch reviewers, merge, change versions, tag, release, modify another worktree/Hermes, or spawn agents. Native launch/install, other-platform packaging, Apple signing/notarization, and updater signature verification remain outside these receipts.
