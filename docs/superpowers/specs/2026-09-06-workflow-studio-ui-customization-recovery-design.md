# Workflow Studio UI Customization Recovery Design

**Status:** Draft for review
**Date:** 2026-09-06
**Branch:** `fix/ui-customization-recovery`
**Base:** `aa91baac4081f0ca585b10fb3fb65b966a7ec24c` (`base`, tagged `v2.0.0`)
**Recovery source:** the uncommitted state in `.worktrees/ui-customization-panels` at `716096e944161eac1995aff8698ab78cf302f833`

## 1. Problem and root cause

The UI customization work was never committed. The worktree branch still points to `716096e`, while its intended implementation exists only as 63 modified tracked files and 11 untracked files. `base` advanced by 50 commits after that branch point and received the loop-group feature through separate committed branches. Git therefore had no customization commit to merge and did not delete any committed customization code.

During v2.0.0 preparation, Vitest run from the main checkout also discovered tests inside the nested dirty worktree. Excluding `.worktrees/**` fixed that test-discovery contamination, but the release preparation did not separately identify the dirty worktree as unfinished user-facing work. The resulting v2.0.0 source is internally consistent and fully tested, but it does not contain several intended customization behaviors.

The `v2.0.0` tag and its verified GitHub draft remain immutable and unpublished. Recovery will produce a new `v2.0.1` candidate after implementation and verification. The old dirty worktree remains untouched until recovery is complete.

## 2. Current evidence

- The clean recovery branch starts from the exact v2.0.0 source commit.
- The current baseline passes `svelte-check` with zero errors and warnings and passes all 1,837 unit tests in 160 files.
- The dirty source worktree independently passes its 1,283 tests on its older baseline, plus its focused appearance tests and static checks. This establishes that it contains coherent behavior, not that its files can be copied onto v2.
- Thirty-five of the 74 dirty paths also changed between `716096e` and current `base`.
- The current branch already contains newer implementations for loop-group authoring, docked panel controls, the Problems/References lower panel, vertical lower-panel resizing, and the styled loop-group back button.
- No user-facing template feature appears in the dirty diff, any commit, stash, reflog, or repository search. The approved product design calls user templates a deferred extension. The only dirty Example Gallery behavior is improved Back-to-Examples presentation.

## 3. Goals

1. Restore every supported, still-relevant behavior evidenced by the dirty customization worktree.
2. Preserve all current loop-group behavior, scanner compatibility, reference guidance, panel resizing, and scoped layout state.
3. Reimplement each behavior against the current architecture, with a failing current-baseline test before production changes.
4. Preserve YAML as the only workflow authority and keep UI preferences outside workflow YAML.
5. Keep the current Examples gallery intact. Do not invent a user-template system without a separate product definition.
6. Add a release preflight record that makes unfinished worktrees visible before future version tags are created.

## 4. Non-goals

- Do not merge, rebase, reset, clean, stash, or commit the old dirty worktree.
- Do not copy whole files from the old baseline over current files.
- Do not change Hermes contracts, workflow syntax, reference semantics, or runtime behavior.
- Do not recreate the old v1.0.8 version edits.
- Do not move, delete, or repoint `v2.0.0`, and do not publish its draft.
- Do not replace the current `AuxiliaryPanel` or `PanelResizeHandle` with the older Problems-only resize implementation.
- Do not add a templates feature based only on the word “templates”; no recoverable design or implementation defines its behavior.

## 5. Recovery architecture

Recovery proceeds as behavior-level forward ports from current `base`. The old worktree supplies UI intent, copy, and test evidence. Current modules and current contracts supply the implementation boundary.

### 5.1 Appearance and product identity

Settings > Appearance gains three contract-independent palette choices—LOOP24 Indigo, Ocean Blue, and Emerald—and System, Light, and Dark brightness choices. An accent picker in the footer accepts a six-digit hexadecimal color, exposes a native color input, and can reset to the chosen palette. Preferences persist locally under the versioned key `workflow-studio.appearance.v1` and never enter workflow YAML.

The existing runtime brand-pack importer remains available under an **Advanced brand packs** disclosure with explanatory copy. The built-in LOOP24 mark becomes an inline, accent-aware SVG; imported brand packs continue to use their validated assets. A custom palette may override semantic accent tokens, while the default LOOP24 palette preserves the active brand pack's own theme accents.

When no update operation is active, the footer shows the package version. Checking, available, downloading, ready-to-restart, deferred, and failed updater states continue to replace that neutral label with actionable update status.

### 5.2 Visible document state and safe revert

The editor toolbar shows **Saved**, **Unsaved changes**, or **Saving…**, plus a visible Save button. Dirty writable documents also expose Revert. Revert rereads both files, verifies their saved hashes, and either restores the exact disk text or enters the existing external-change conflict flow. A successful revert clears undo history and recovery data, then schedules normal current-contract analysis.

Save and revert remain disabled for read-only or unavailable documents. Existing keyboard save behavior stays intact.

### 5.3 Workspace history controls

Each recent folder gains an accessible remove action. When unavailable folders exist, the list gains **Clear unavailable**. Store operations remain serialized through the existing queue and retain available entries and ordering.

### 5.4 Panel state and navigation

The current docked panel toggle buttons remain the implementation. Their open/closed state becomes an optional workflow layout preference at the record level, with old and malformed records defaulting both panels to open. Compact drawer behavior remains ephemeral and must not overwrite docked preferences.

The current lower-panel resize implementation remains unchanged except for any tests needed to prove compatibility. The obsolete dirty `ProblemsResizeHandle` files are not recovered.

Back controls on activity pages, documentation articles, and Example previews gain the same always-visible secondary-button treatment and left-arrow cue already used for loop-group scope navigation.

### 5.5 Problems presentation

The current outer **Problems / References** tabs remain authoritative for loop-group scope. Inside Problems, validation layers become counted tabs: Syntax, Contract, Semantic, Compatibility, and Operational. The first populated layer is selected when analysis first arrives; later issue updates do not unexpectedly move a user's explicit selection. Arrow, Home, and End keys follow standard tab behavior. The total/blocking summary remains visible, and the hosted Problems view continues to delegate scrolling to the current auxiliary panel.

### 5.6 Canvas repair and node actions

Current loop-group draft and reference behavior remains the foundation. Recovery adds these missing interactions through the current scoped graph APIs:

- a mouse and keyboard accessible node context menu;
- Open Inspector, Duplicate Selection, Select All Nodes, Delete Selection, and Delete All Nodes;
- platform multi-selection with Command or Control;
- deletion of a structurally incomplete projected node while unrelated mutations remain paused;
- deletion of all root nodes as one undoable blank draft that remains unsaveable until rebuilt; and
- adding the first node back to an exact root `nodes: []` draft.

The strict contract still blocks save/export for an empty root graph or incomplete nodes. “Visually authorable” remains a narrow editing allowance, not a second validity definition. Delete operations preserve comments, unrelated YAML, and final-newline style, and they use current scope leases and current reference-impact previews.

Context-menu labels, enablement, and actions come from the existing command registry wherever a matching command exists. This keeps toolbar, keyboard, command-palette, and context-menu behavior aligned.

### 5.7 Documentation and editor polish

Recover the node-type chooser guide and the clearer explanations for dependencies, output references, loops, approvals, cancellation, retries, and trigger rules. Merge the wording with current loop-group/reference documentation rather than replacing it. Node topics link to the chooser using the contract-derived node inventory.

The YAML editor caret uses the active focus token so it remains visible across palettes. No parsing or validation work is added to pointer-move frames.

## 6. Requirements-to-tests traceability matrix

| ID | Required behavior | Current status | First focused evidence | Broader acceptance |
| --- | --- | --- | --- | --- |
| R1 | Footer shows the package version in neutral updater states and preserves active updater labels. | Missing | `src/app/StatusBar.test.ts` | `tests/e2e/workbench-containment.spec.ts` |
| R2 | Palette, brightness, and custom accent choices apply immediately and survive reload. | Missing | new `appearance.test.ts`, `appearance` store tests, and component tests | `tests/e2e/branding.spec.ts` |
| R3 | Existing brand-pack import remains reachable under an explained Advanced disclosure. | Partially present: importer exists | `BrandSettings.test.ts` and `App.test.ts` | branding, modal-layout, and containment E2E |
| R4 | The built-in LOOP24 mark follows the accent while imported marks remain validated assets. | Missing | `BrandSettings.test.ts` and `theme-sync.test.ts` | branding E2E |
| R5 | Dirty, saving, and saved state are visible; Save remains explicit and accessible. | Missing | `App.test.ts` | workspace-authoring E2E |
| R6 | Revert restores exact verified disk text, clears recovery/history, and refuses to overwrite an external change. | Missing | `document-workspace-controller.test.ts` | invalid-YAML recovery and workspace-authoring E2E |
| R7 | A user can remove one recent folder or clear only unavailable folders. | Missing | recent-workspaces and OpenWorkspace component tests | App integration test |
| R8 | Docked panels collapse independently and their state survives workflow reopen without changing compact drawers. | Partial: controls exist, persistence does not | layout-store and App tests | workbench-layout E2E |
| R9 | Lower-panel pointer/keyboard resizing and loop Problems/References tabs remain intact. | Present; preserve | existing `PanelResizeHandle` and `AuxiliaryPanel` tests | existing workbench-layout E2E |
| R10 | Problems layers have counted, keyboard-operable tabs and stable initial selection. | Missing | `ProblemsPanel.test.ts` | App and loop auxiliary-panel E2E |
| R11 | Back controls have an icon and visible button treatment across activity, docs, examples, and loop scope. | Partial: loop scope only | component tests for each back control | activity/examples/docs E2E |
| R12 | Node context actions and Command/Control multi-selection work accessibly. | Partial: multi-selection key configuration exists; context actions and focused coverage do not | `GraphCanvas.test.ts` | workspace-authoring E2E |
| R13 | Incomplete projected nodes can be deleted while unsafe mutations remain paused. | Partial: current scoped draft support | analyzer, transactions, canvas actions, coordinator, and App canvas tests | invalid-YAML recovery E2E |
| R14 | An exact root `nodes: []` is visually rebuildable but remains blocked from save until valid. | Missing | analyzer, transactions, canvas actions, and App canvas tests | workspace-authoring E2E |
| R15 | Node-type and execution guides are complete, contract-derived where applicable, and searchable offline. | Missing | docs build-index/navigation tests and resource checks | examples/docs E2E |
| R16 | The YAML caret remains visible in all supported appearance modes. | Missing | editor-extension test | workspace-authoring E2E |
| R17 | Loop-group editing, reference insertion, scoped persistence, and 250-node/500-edge performance do not regress. | Present; preserve | existing loop/scanner/layout/performance suites | full unit, E2E, Rust, resources, and native build gates |
| R18 | Release preflight reports every local worktree and flags unresolved dirty feature work before tagging. | Missing process guard | release-version/release-state tests where automatable | documented v2.0.1 release checklist |
| R19 | User templates are not silently inferred from Examples. | No implementation evidence | repository/history search recorded in this design | user clarification required for any later template feature |

## 7. Conflict and migration rules

1. Every production change starts with a failing test against the current v2 branch.
2. For the 35 overlapping paths, use the current file and current types as the edit base. Do not apply the old patch wholesale.
3. Current scoped layout schema version 2 remains the persisted format. New collapsed-panel state is optional, validated, cloned, and defaulted; no version bump is needed for an additive local preference.
4. Existing per-scope `auxiliaryTab`, Problems scroll, References scroll, positions, viewport, selection, and inspector state remain unchanged.
5. Current `AuxiliaryPanel` and `PanelResizeHandle` own lower-panel sizing. The old Problems-specific component is historical evidence only.
6. Current reference indexing and validation run once per document analysis. Recovery must not reintroduce rescanning per group or surface.
7. Appearance preferences are renderer-local settings. Brand-pack manifests remain the only source for imported brand identity and neutral tokens.
8. The package remains `2.0.0` throughout implementation. Version records change together only in the separately reviewed v2.0.1 release task.

## 8. Complete 74-path recovery ledger

“Overlap” means the path also changed on `base` after the dirty worktree branch point. All overlapping files require manual reconciliation.

| Path | Primary recovery slice | Overlap | Decision |
| --- | --- | --- | --- |
| `docs/app-guides/conditions-and-outputs.md` | Documentation | Yes | Merge with current reference guidance |
| `docs/app-guides/dag-dependencies.md` | Documentation | No | Recover copy |
| `docs/app-guides/loops-and-approvals.md` | Documentation | No | Recover and extend without changing loop-group semantics |
| `docs/app-guides/node-types.md` | Documentation | No | Recover new offline guide |
| `docs/app-guides/quick-start.md` | Documentation | No | Recover chooser links |
| `docs/app-guides/retry-and-triggers.md` | Documentation | No | Recover copy |
| `package-lock.json` | Release metadata | Yes | Discard old 1.0.8 edit |
| `package.json` | Release metadata | Yes | Discard old 1.0.8 edit |
| `src-tauri/Cargo.lock` | Release metadata | Yes | Discard old 1.0.8 edit |
| `src-tauri/Cargo.toml` | Release metadata | Yes | Discard old 1.0.8 edit |
| `src-tauri/tauri.conf.json` | Release metadata | Yes | Discard old 1.0.8 edit |
| `src/app/ActivityPage.svelte` | Navigation | No | Recover visible back control |
| `src/app/ActivityPage.test.ts` | Navigation test | No | Adapt and recover |
| `src/app/App.canvas-authoring.test.ts` | Canvas integration test | Yes | Recreate against current scoped canvas |
| `src/app/App.svelte` | Cross-cutting shell | Yes | Manually integrate all approved slices |
| `src/app/App.test.ts` | Shell integration test | Yes | Recreate focused behavior tests |
| `src/app/StatusBar.svelte` | Version and appearance | No | Recover version and accent entry point |
| `src/app/StatusBar.test.ts` | Version test | No | Adapt to 2.0.0 during implementation |
| `src/e2e/bootstrap.ts` | E2E fixtures | Yes | Add only required current-shape scenarios |
| `src/features/branding/AccentPicker.svelte` | Appearance | No | Recover after component test fails |
| `src/features/branding/AccentPicker.test.ts` | Appearance test | No | Recover and review popup accessibility |
| `src/features/branding/AppearanceSettings.svelte` | Appearance | No | Recover after component test fails |
| `src/features/branding/AppearanceSettings.test.ts` | Appearance test | No | Recover keyboard radio behavior |
| `src/features/branding/BrandSettings.svelte` | Advanced brand packs | No | Recover built-in mark handling |
| `src/features/branding/BrandSettings.test.ts` | Branding test | No | Recover |
| `src/features/branding/Loop24Mark.svelte` | Appearance | No | Recover inline mark |
| `src/features/canvas/GraphCanvas.svelte` | Canvas interactions | Yes | Reimplement on current scoped canvas |
| `src/features/canvas/GraphCanvas.test.ts` | Canvas interaction test | Yes | Recreate context-menu and multi-select tests |
| `src/features/canvas/canvas-actions.test.ts` | Canvas action test | Yes | Recreate root blank/delete behavior |
| `src/features/canvas/canvas-actions.ts` | Canvas actions | Yes | Extend current scoped/prevalidated pipeline |
| `src/features/canvas/canvas-authoring-coordinator.ts` | Canvas coordination | Yes | Add narrow repair-delete context |
| `src/features/documentation/DocumentationArticle.svelte` | Navigation | No | Recover visible back control |
| `src/features/documentation/DocumentationArticle.test.ts` | Navigation test | No | Recover |
| `src/features/documentation/DocumentationOverview.test.ts` | Documentation test | No | Recover node chooser coverage |
| `src/features/documents/ProblemsPanel.svelte` | Problems layers | Yes | Integrate within hosted auxiliary panel |
| `src/features/documents/ProblemsPanel.test.ts` | Problems test | Yes | Preserve current scoped issue identity tests |
| `src/features/documents/ProblemsResizeHandle.svelte` | Obsolete resize component | No | Do not recover; current `PanelResizeHandle` supersedes it |
| `src/features/documents/ProblemsResizeHandle.test.ts` | Obsolete resize test | No | Do not recover; current resize tests supersede it |
| `src/features/documents/document-workspace-controller.test.ts` | Revert test | Yes | Recreate against current controller |
| `src/features/documents/document-workspace-controller.ts` | Revert behavior | Yes | Add hash-gated revert to current lifecycle |
| `src/features/editor/editor-extensions.ts` | Editor appearance | No | Recover focus-token caret styling |
| `src/features/examples/ExampleGallery.svelte` | Navigation | No | Recover back control only; no template behavior exists |
| `src/features/examples/ExampleGallery.test.ts` | Navigation test | Yes | Adapt to current gallery tests |
| `src/features/workspace/OpenWorkspace.svelte` | Recent folders | No | Recover remove/clear controls |
| `src/features/workspace/OpenWorkspace.test.ts` | Recent-folder test | No | Recover |
| `src/lib/branding/appearance.test.ts` | Appearance test | No | Recover and extend for brand interaction |
| `src/lib/branding/appearance.ts` | Appearance model | No | Recover with current token invariants |
| `src/lib/branding/theme-sync.test.ts` | Appearance test | No | Recover |
| `src/lib/branding/theme-sync.ts` | Appearance synchronization | No | Recover subscriptions with one cleanup owner |
| `src/lib/commands/registry.ts` | Repair commands | No | Add delete-only repair capability |
| `src/lib/commands/types.ts` | Repair commands | No | Add narrow optional capability |
| `src/lib/docs/build-index.test.ts` | Documentation test | Yes | Merge with current contract/scoped docs tests |
| `src/lib/docs/navigation.test.ts` | Documentation test | Yes | Merge with current navigation inventory |
| `src/lib/docs/navigation.ts` | Documentation | Yes | Add node chooser to current task navigation |
| `src/lib/documents/transactions.ts` | Repair mutations | Yes | Adapt root delete allowance to current safeguards |
| `src/lib/layout/layout-store.test.ts` | Panel persistence test | Yes | Add v2 additive-field migration tests |
| `src/lib/layout/layout-store.ts` | Panel persistence | Yes | Add validated optional collapsed state to v2 |
| `src/lib/layout/types.ts` | Panel persistence | Yes | Extend current v2 record, not old v1 shape |
| `src/lib/layout/workbench-layout.test.ts` | Lower-panel resize test | No | Keep current equivalent coverage |
| `src/lib/layout/workbench-layout.ts` | Lower-panel sizing | Yes | Keep current implementation unless a focused test exposes a gap |
| `src/lib/validation/analyze-workflow.test.ts` | Blank-root repair test | Yes | Recreate within current contract/reference phases |
| `src/lib/validation/analyze-workflow.ts` | Blank-root repair | Yes | Extend narrow authorability predicate only |
| `src/lib/workspace/recent-workspaces.test.ts` | Recent-folder test | No | Recover serialized mutations |
| `src/lib/workspace/recent-workspaces.ts` | Recent folders | No | Recover remove/clear operations |
| `src/main.ts` | Appearance startup | No | Initialize preferences before theme synchronization |
| `src/stores/appearance.test.ts` | Appearance store test | No | Recover |
| `src/stores/branding.ts` | Appearance and branding store | No | Integrate preferences without weakening brand validation |
| `tests/e2e/branding.spec.ts` | Branding E2E | No | Recover with v2 selectors |
| `tests/e2e/invalid-yaml-recovery.spec.ts` | Repair/revert E2E | No | Recover against current canvas |
| `tests/e2e/modal-layout.spec.ts` | Advanced-brand modal E2E | Yes | Open disclosure before existing modal assertions |
| `tests/e2e/workbench-containment.spec.ts` | Version/branding E2E | Yes | Adapt while preserving current containment cases |
| `tests/e2e/workbench-layout.spec.ts` | Panel E2E | Yes | Retain current resize/toggle tests and add persistence |
| `tests/e2e/workspace-authoring.spec.ts` | Save and canvas E2E | Yes | Recreate missing flows on current fixtures |
| `tests/project/release-version.test.ts` | Release metadata | Yes | Discard old 1.0.8 assertions; add preflight rules separately |

Ledger totals: 74 paths, including 35 overlapping paths and 11 files absent from current `base`.

## 9. Implementation order after approval

1. Freeze current v2 behavior with regression tests for loop scope, panel resize, reference tabs, and release identity.
2. Add appearance primitives, stores, components, version display, and advanced brand-pack presentation.
3. Add visible save state and hash-gated revert.
4. Add recent-folder removal and cleanup.
5. Persist docked panel visibility and align all back controls.
6. Add Problems layer tabs within the current auxiliary panel.
7. Add scoped node context actions and root repair/blank-draft behavior.
8. Merge documentation and caret improvements.
9. Run focused reviews per slice, then one complete adversarial branch review.
10. Run formatting, lint, type checking, contract/example/resource checks, all unit/E2E/Rust/performance suites, and an unsigned native build.
11. Commit the completed recovery branch and explain the result for review.
12. After separate release approval, merge to local `base`, prepare `2.0.1`, create a new immutable tag, and build a new unpublished draft.

## 10. Acceptance boundary

The recovery is complete when every R1–R18 test is green, the current loop-group/reference suite remains green, the 250-node/500-edge contract remains satisfied, the package builds with all offline resources, and an adversarial review has no unresolved valid finding. The old dirty worktree may then be archived or removed only with explicit user direction. Any future user-template work requires its own behavior definition because no such implementation can be recovered from repository evidence.
