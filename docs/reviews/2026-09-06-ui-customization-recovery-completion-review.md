# Workflow Studio UI Customization Recovery Completion Review

**Date:** 2026-09-06
**Branch:** `fix/ui-customization-recovery`
**Comparison base:** `aa91baac4081f0ca585b10fb3fb65b966a7ec24c` (`base`, `v2.0.0`)
**Final verified source:** `fca7f01ff1e6838a9bca4c0ae70e14c96e053874`

## Verdict

The recovery satisfies R1–R19 and preserves the current loop-group, scanner, YAML, DAG, persistence, and offline-resource contracts. No unresolved Critical or Important finding remains after the external reviews, focused fixes, and focused rereviews. The branch is ready for the user's separate integration and release decision.

This review does not authorize or perform a merge, version change, tag, release, publication, installation, or application launch. Package, lockfile, Cargo, and Tauri metadata remain `2.0.0`. The sibling Hermes repository and all other worktrees were left untouched.

## Requirements traceability

| ID | Result | Primary implementation | Meaningful verification |
| --- | --- | --- | --- |
| R1 | Met | `src/app/StatusBar.svelte` | `src/app/StatusBar.test.ts`; `tests/e2e/workbench-containment.spec.ts` |
| R2 | Met | `src/lib/branding/appearance.ts`; `src/stores/branding.ts`; `src/lib/branding/theme-sync.ts`; `src/features/branding/AppearanceSettings.svelte`; `src/features/branding/AccentPicker.svelte` | `src/lib/branding/appearance.test.ts`; `src/stores/appearance.test.ts`; `src/lib/branding/theme-sync.test.ts`; `tests/e2e/branding.spec.ts` |
| R3 | Met | `src/app/App.svelte`; `src/features/branding/BrandSettings.svelte` | `src/app/App.test.ts`; `src/features/branding/BrandSettings.test.ts`; `tests/e2e/modal-layout.spec.ts` |
| R4 | Met | `src/features/branding/Loop24Mark.svelte`; `src/features/branding/BrandSettings.svelte` | `src/features/branding/Loop24Mark.test.ts`; `src/features/branding/BrandSettings.test.ts`; `tests/e2e/branding.spec.ts` |
| R5 | Met | `src/app/App.svelte`; `src/features/documents/document-actions.ts`; `src/features/documents/document-workspace-controller.ts`; `src/lib/commands/registry.ts` | `src/app/App.test.ts`; `src/features/documents/document-actions.test.ts`; `tests/e2e/workspace-authoring.spec.ts`; `tests/performance/app-capacity.test.ts` |
| R6 | Met | `src/features/documents/document-workspace-controller.ts` | `src/features/documents/document-workspace-controller.test.ts`; `tests/e2e/invalid-yaml-recovery.spec.ts` |
| R7 | Met | `src/lib/workspace/recent-workspaces.ts`; `src/features/workspace/OpenWorkspace.svelte` | `src/lib/workspace/recent-workspaces.test.ts`; `src/features/workspace/OpenWorkspace.test.ts`; `src/app/App.test.ts` |
| R8 | Met | `src/lib/layout/types.ts`; `src/lib/layout/layout-store.ts`; `src/app/App.svelte` | `src/lib/layout/layout-store.test.ts`; `src/app/App.test.ts`; `tests/e2e/workbench-layout.spec.ts` |
| R9 | Preserved | `src/features/documents/AuxiliaryPanel.svelte`; `src/features/documents/PanelResizeHandle.svelte` | `src/features/documents/AuxiliaryPanel.test.ts`; `tests/e2e/workbench-layout.spec.ts`; `tests/e2e/loop-group-authoring.spec.ts` |
| R10 | Met | `src/features/documents/ProblemsPanel.svelte` | `src/features/documents/ProblemsPanel.test.ts`; `src/features/documents/AuxiliaryPanel.test.ts`; `tests/e2e/workbench-layout.spec.ts` |
| R11 | Met | `src/app/ActivityPage.svelte`; `src/features/documentation/DocumentationArticle.svelte`; `src/features/examples/ExampleGallery.svelte`; existing loop-scope navigation in `src/app/App.svelte` | Corresponding component tests; `tests/e2e/workbench-layout.spec.ts` |
| R12 | Met | `src/features/canvas/GraphCanvas.svelte`; `src/features/canvas/WorkflowEdge.svelte`; `src/lib/commands/registry.ts` | `src/features/canvas/GraphCanvas.test.ts`; `src/lib/commands/registry.test.ts`; `src/app/App.canvas-authoring.test.ts`; `tests/e2e/workspace-authoring.spec.ts` |
| R13 | Met | `src/lib/validation/analyze-workflow.ts`; `src/lib/documents/transactions.ts`; `src/features/canvas/canvas-actions.ts`; `src/features/canvas/canvas-authoring-coordinator.ts` | Corresponding focused tests; `src/app/App.canvas-authoring.test.ts`; `tests/e2e/invalid-yaml-recovery.spec.ts` |
| R14 | Met | R13 modules plus `src/lib/yaml/patch-document.ts`; strict save guard in `src/features/documents/document-actions.ts` | Corresponding focused tests; `tests/e2e/workspace-authoring.spec.ts`; `tests/performance/app-capacity.test.ts` |
| R15 | Met | `docs/app-guides/node-types.md` and the five updated authoring guides; `src/lib/docs/navigation.ts`; `src/lib/docs/build-index.ts` | `src/lib/docs/navigation.test.ts`; `src/lib/docs/build-index.test.ts`; `npm run resources:verify`; native embedded-guide verification |
| R16 | Met | `src/lib/branding/appearance.ts`; `src/features/editor/editor-extensions.ts`; `src/app.css`; `src/styles/tokens.css` | `src/lib/branding/appearance.test.ts`; `src/features/editor/editor-extensions.test.ts`; `tests/e2e/workspace-authoring.spec.ts`; `tests/project/style-contract.test.ts` |
| R17 | Preserved | Existing contract/scanner/reference modules under `src/lib/contract/` and `src/lib/references/`; scoped canvas implementation | Contract, conformance, scanner, reference, loop-group, layout, and full-suite tests; `tests/performance/canvas-performance.test.ts`, `scoped-canvas-performance.test.ts`, `indexed-reference-validation.test.ts`, and `app-capacity.test.ts` |
| R18 | Met | `docs/releasing.md` | `tests/project/release-version.test.ts` |
| R19 | Met | `src/features/examples/ExampleGallery.svelte`; explicit design exclusion | `src/features/examples/ExampleGallery.test.ts`; repository/history investigation recorded in the recovery design |

## Consolidated findings and dispositions

| ID | Severity/status | Validity and disposition | Fix and review evidence |
| --- | --- | --- | --- |
| CODEX-001 | Important, resolved | Confirmed that allowed custom accents could erase the caret or keyboard focus against supported and imported theme surfaces. Focus colors now model actual translucent paint stacks and use a two-tone indicator where one color cannot satisfy every host. | `760eaff`, `c28dc21`, `b7bbd78`, `588faee`, `fd67343`; WebKit CSS-pixel test correction `8d6def0`; focused Chromium/WebKit rereviews passed. |
| CODEX-002 | Important, resolved | Confirmed that a throwing `window.localStorage` getter could stop application mount. Storage acquisition is guarded and the application continues with in-memory defaults. | `760eaff`; startup/storage tests and focused rereview passed. |
| INT-001 | Important, resolved | Internal review confirmed that generic focus CSS did not establish painted focus on every structural host, including the canvas and SVG dependency edges. | `d37b338` extends two-tone structural-host treatment; `f2bf00f` adds an explicit SVG edge halo and inner stroke; focused browser paint and forced-colors checks passed. |
| INT-002 | Important, resolved | Internal review confirmed that save returned no outcome when the authoring contract was unavailable, hiding the actual blocker. | `b1b85fd` returns a stable `contract_unavailable` blocked result with diagnostics; controller/App tests passed. |
| N1 | Lower severity, resolved | Valid Codex review found that Mod+S on repair/blank canvases was gated by canvas mutation availability and could report a generic unavailable command instead of the persistence blocker. Save command availability is now independent of graph mutation and reaches the shared guarded save path. | Initial separation in `19007e6`; clean/dirty/invalid/read-only refinement and command-palette coverage in `1f449dc`; focused rereview passed. |
| CODEX-003 | Important, resolved | Valid immutable Codex review confirmed that custom accents could hide node-kind text, selected edges, and some primary-button states. Exact user accent remains available for decorative use; renderer-derived semantic foreground, primary-state, selection, node-kind, and edge colors now protect their actual surfaces. | `19007e6`, followed by the complete semantic matrix in `4dd18ac`, `9ac5423`, `92b4907`, and `f7b26bb`; focused unit/style/browser rereviews passed. |
| INT-003 | Important, resolved | Follow-up review found incomplete semantic-theme validation for production hosts, translucent nested surfaces, rail/YAML gutters, and the deepest CodeMirror gutter. The validator and renderer now use the same composited surface families. | `4dd18ac`, `9ac5423`, `92b4907`, `f7b26bb`; validator-backed hostile-theme tests cover the final matrix. |
| CLAUDE-001 | Low, resolved | Valid immutable Claude review confirmed that the AccentPicker dialog was nested inside the footer-wide `role="status"`, creating incorrect live-region structure and possible duplicate screen-reader announcements. Live semantics now wrap status text only. | `19007e6`; StatusBar and containment tests passed. |
| U1 / INT-004 | Unresolved suspicion, then confirmed and resolved | Codex could not settle whether an inactive References panel restored its saved scroll after switching scope/tab. Focused Svelte/browser reproduction confirmed the gap: restoration ran while the panel was hidden. Restoration now runs when its panel becomes active. This closes final R9 uncertainty. | `fca7f01`; `AuxiliaryPanel.test.ts` and Chromium/WebKit loop-group round-trip coverage passed. |
| U2 | Evidence limitation, closed | Codex found no structural-focus defect but could not prove every painted host from static review. Focused real-browser pixel checks covered toolbar, canvas, dependency-edge, hostile-theme, and forced-colors paint, and the final Chromium/WebKit suite passed. | `d37b338` and `f2bf00f`; final source verification at `fca7f01`. |
| CLAUDE-002 | Observation, accepted | Structural companion add/remove state keeps Revert unavailable because R6 restores verified disk text, while Undo remains available. Claude judged this consistent with the approved design and found no data-loss path. | No fix required. Existing controller guards and tests remain authoritative. |
| CLAUDE-003 | Cosmetic observation, accepted | The release checklist's numbered preconditions are interrupted by the Local worktree preflight heading. Required preflight content and ordering remain explicit and test-protected. | No behavior fix required; `tests/project/release-version.test.ts` passed. |

Task-level reviews also resolved the concrete preparation failures without changing intended product semantics: compact reflow retained the 44px canvas floor (`31420cd`); oversized-document tests now perform a real edit before expecting Save (`2292667`); keyboard resize setup measures the docked layout and moves focus before compacting (`e6ec543`); pending layout persistence is flushed before menu performance accounting (`c45bdf1`). Each correction kept its original behavioral limit.

The first final Codex attempt under `external-reviews/codex-final-e5b2a219/` is explicitly invalidated: a concurrent edit caused its working-tree reads to mix source states, so it contributes no verdict or finding. The successful final Codex lane reviewed an immutable `git archive` of `f2bf00f` with Codex CLI 0.153.4, `gpt-6-astra`, max reasoning, read-only sandbox, and reported CODEX-003, N1, and U1. The successful Claude lane independently reviewed the same immutable candidate with Claude Opus 4.8 at max effort and a second 91-path coverage pass; it reported only CLAUDE-001 at Low severity. The earlier Claude authentication failure at `38906b4` produced no model review and is retained only as provenance. Focused independent rereviews of every subsequent fix through `fca7f01` found no remaining Critical or Important defect.

## Definitive verification

The final ordered run used source `fca7f01ff1e6838a9bca4c0ae70e14c96e053874` and passed:

| Gate | Result |
| --- | --- |
| Format, lint, static checking | Passed; Svelte check reported 0 errors and 0 warnings |
| Contract, examples, resources | Passed; 40 packaged resources verified |
| Unit | 166 files, 2,010 tests passed |
| Rust | 246 library plus 24 Git integration tests passed; 270 total |
| Renderer build | Passed |
| E2E | 364 tests passed: 182 Chromium and 182 WebKit |
| Embedded documentation | 14 offline guide titles and import keys verified in the packaged renderer |

The first final E2E attempt could not bind port 1420 because a stale Vite process group from a previously cancelled candidate run still held it. Process identity, command, working directory, ancestry, socket, and start time tied it to that cancelled run. Only that stale process group was terminated; the port was confirmed free; source and dependencies remained unchanged; the complete 364-test suite then passed cleanly. This was an environmental listener conflict, not an application or test failure.

## Unsigned local artifacts

All artifacts came from the final verified source and version `2.0.0`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/dmg/LOOP24 Workflow Studio_2.0.0_aarch64.dmg` | 6,315,021 | `090c8ba1db7ffb61817eb2a88fc8442c75a8311c5159188534db239b1884b446` |
| `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio` | 17,724,800 | `46e163dc03a16a50af83d1a1f00af8c8d4f4b5123b987087bf62450b58ee5a42` |
| `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app.tar.gz` | 6,420,502 | `02462912cec1130077ee2943a5471ccbbdb618e92c2931803a6e0cd4f92c7abf` |
| `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/.superpowers/sdd/2026-09-06-workflow-studio-ui-customization-recovery/task-13-definitive-fca7f01-evidence/app-file-sha256.json` | 5,630 | `c97f66d066c13706e32882bf2720626dd7cfb0a08a654b207afa1151daf4dc9e` |

The app bundle is `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery/src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app`. The built `.app`, read-only mounted DMG payload, and extracted app archive have identical 43-file trees by per-file SHA-256. The `.app` and DMG each passed the exact 40-resource integrity manifest.

These are local macOS arm64 artifacts. `file` and `lipo` report arm64 only. The build used `--no-sign`; `codesign` reports linker-created ad-hoc metadata, no TeamIdentifier, and no sealed resources. No Developer ID signing, notarization, updater signature, clean-machine installation, Intel build, or non-macOS package is claimed.

## Remaining product decision

The only product ambiguity is user templates. No recoverable user-template behavior, design, commit, stash, reflog entry, or dirty-worktree implementation was found. This recovery therefore did not invent a template system. The existing Examples gallery and editable example-copy behavior remain intact; a user-template feature requires its own product definition.
