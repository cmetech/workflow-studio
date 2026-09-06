# Loop Group References Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move loop-group reference guidance from the permanent strip above the canvas into a clear, accessible References tab beside Problems without changing reference eligibility or YAML mutation behavior.

**Architecture:** `LoopGroupScopeBar.svelte` becomes the content view for a grouped, plain-language reference panel while continuing to consume the existing contract-derived suggestions and action callbacks. A small auxiliary-panel shell owns Problems/References tab semantics and App owns the per-scope selected-tab and scroll state. The current reference scanner, eligibility builder, insertion owner, and dependency mutation remain authoritative and unchanged.

**Tech Stack:** Svelte 5, TypeScript 6, Nanostores layout persistence, Testing Library/Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-workflow-studio-loop-group-visual-authoring-design.md` section 9 and acceptance criterion 8.

## Global Constraints

- YAML remains the sole workflow source of truth.
- Derive reference eligibility from the active Hermes contract and existing reference index; do not add a handwritten field inventory or regex scanner.
- Preserve existing copy, insertion identity/revision checks, explicit dependency mutation, error precedence, and per-scope 250-node/500-edge behavior.
- Keep Problems issue and blocking counts visible while References is active.
- References exists only in loop-body scope and does not add permanent canvas chrome.
- Preserve accessibility, keyboard operation, reduced motion, 1024 x 700 layout, and 200% zoom behavior.
- Use `npm`, not another package manager.

---

### Task 1: Plain-language reference content

**Files:**
- Modify: `src/features/canvas/LoopGroupScopeBar.svelte`
- Modify: `src/features/canvas/LoopGroupScopeBar.test.ts`

**Interfaces:**
- Consumes: `LoopGroupReferenceSuggestion`, `status`, `onCopy`, `canInsert`, `onInsert`, and `onAddDependency` exactly as today, plus optional `insertionTargetLabel?: string`.
- Produces: A scrollable `References for <groupId>` region grouped by namespace and availability, with existing exact action callbacks unchanged.

- [x] **Step 1: Write failing component tests**

Add tests that require the introduction to explain reuse, Copy, and Inspector insertion; require headings `Earlier nodes in this iteration`, `Inputs from the main workflow`, `Outputs from the previous iteration`, and `More workflow outputs`; require current, outer, previous, and unavailable suggestions to appear under the correct heading; require `Allow this loop to use later` to call `onAddDependency('later')`; and require the insertion banner to show either `Insert target: Review Prompt` or `Focus a compatible Inspector text field to enable Insert. Copy works at any time.` Keep the existing 12-result/search bound test.

- [x] **Step 2: Run the tests and confirm the expected failure**

Run: `npm test -- src/features/canvas/LoopGroupScopeBar.test.ts`

Expected: FAIL because the current component has one ungrouped suggestion row, technical namespace labels, and no insertion-target explanation.

- [x] **Step 3: Implement the grouped panel content**

Partition the existing suggestions without changing them: available `current`, available `outer`, available `previous`, and unavailable `outer`. Render plain-language headings and short explanations, retain exact `<code>` tokens, Copy and Insert accessible names, retain disabled Insert behavior from `canInsert`, and change only the unavailable action label to `Allow this loop to use <producerId>`. Render empty guidance for a current group when no current producer is available rather than implying every body node is readable. Preserve search and cap the total rendered suggestion articles at 12 across groups after filtering.

- [x] **Step 4: Run focused tests and refactor while green**

Run: `npm test -- src/features/canvas/LoopGroupScopeBar.test.ts`

Expected: PASS with no warnings.

- [x] **Step 5: Commit**

```bash
git add src/features/canvas/LoopGroupScopeBar.svelte src/features/canvas/LoopGroupScopeBar.test.ts
git commit -m "feat: clarify loop reference guidance"
```

### Task 2: Problems and References auxiliary tabs

**Files:**
- Create: `src/features/documents/AuxiliaryPanel.svelte`
- Create: `src/features/documents/AuxiliaryPanel.test.ts`
- Modify: `src/features/documents/ProblemsPanel.svelte`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `src/lib/layout/types.ts`
- Modify: `src/lib/layout/layout-store.ts`
- Modify: `src/lib/layout/layout-store.test.ts`

**Interfaces:**
- Consumes: Problems content and optional loop reference content as Svelte snippets; issue totals; controlled `activeTab: 'problems' | 'references'`; `onTabChange`; independent scroll callbacks.
- Produces: One accessible tablist and tabpanel in the existing bottom-panel grid row. `ScopeLayoutV1` gains optional `auxiliaryTab?: 'problems' | 'references'` and `referencesScroll?: number`, defaulting safely for old layout files.

- [x] **Step 1: Write failing shell, App, and persistence tests**

Require standard `tab`/`tabpanel` semantics and ArrowLeft/ArrowRight/Home/End keyboard behavior. In App tests, open a loop body and require Problems and References tabs, require the old reference region not to precede the canvas, select References and see the region, return to root and require no References tab, then re-enter and require the per-scope choice to restore. Require first-visit selection to be Problems with a blocking issue and References without blockers. Require old layout records to load with a valid default and new `auxiliaryTab`/`referencesScroll` values to round-trip.

- [x] **Step 2: Run the tests and confirm the expected failure**

Run: `npm test -- src/features/documents/AuxiliaryPanel.test.ts src/app/App.test.ts src/lib/layout/layout-store.test.ts`

Expected: FAIL because the auxiliary shell and persisted fields do not exist and App still mounts references above the canvas.

- [x] **Step 3: Implement the tab shell and integrate App**

Create the accessible controlled shell. Make `ProblemsPanel` render problems content without creating a second outer landmark when hosted. Remove `LoopGroupScopeBar` from `.editor-region`; render it as References content inside `AuxiliaryPanel` beside Problems. Keep issue and blocker counts in the Problems tab label or adjacent visible summary. Derive an insertion target label from the currently valid remembered Inspector field without weakening `LoopGroupReferenceTargetOwner`. Store tab and reference scroll in the active scope layout. Initialize an unset loop tab once from blocking-issue presence, then preserve explicit user selection without switching on later analysis or selection changes.

- [x] **Step 4: Run focused tests and affected component tests**

Run: `npm test -- src/features/documents/AuxiliaryPanel.test.ts src/features/documents/ProblemsPanel.test.ts src/features/canvas/LoopGroupScopeBar.test.ts src/app/App.test.ts src/lib/layout/layout-store.test.ts`

Expected: PASS with no warnings.

- [x] **Step 5: Commit**

```bash
git add src/features/documents/AuxiliaryPanel.svelte src/features/documents/AuxiliaryPanel.test.ts src/features/documents/ProblemsPanel.svelte src/app/App.svelte src/app/App.test.ts src/lib/layout/types.ts src/lib/layout/layout-store.ts src/lib/layout/layout-store.test.ts
git commit -m "feat: move loop references beside problems"
```

### Task 3: Browser behavior, documentation, and verification

**Files:**
- Modify: `src/features/canvas/GraphScopeHeader.svelte` (browser-proven compact header correction)
- Modify: `src/features/documents/AuxiliaryPanel.svelte` (browser-proven tab activation correction)
- Modify: `src/app/App.canvas-authoring.test.ts` (full-suite compatibility assertions)
- Modify: `src/lib/docs/build-index.test.ts` (offline guide labels)
- Modify: `tests/e2e/loop-group-authoring.spec.ts`
- Modify: `tests/e2e/workbench-layout.spec.ts`
- Modify: `docs/app-guides/loop-groups.md`
- Modify: `docs/superpowers/specs/2026-08-31-workflow-studio-loop-group-visual-authoring-design.md`
- Modify: `docs/superpowers/plans/2026-09-06-loop-group-references-panel.md`

**Interfaces:**
- Consumes: Completed auxiliary panel and unchanged copy/insert/dependency actions.
- Produces: Cross-engine evidence that the panel preserves canvas space, reference actions, responsive layout, focus, and keyboard tab operation, plus accurate offline guidance.

- [x] **Step 1: Write failing browser assertions before any browser-facing adjustment**

Update the loop authoring test to open References before using Copy/Insert and assert the three available plain-language groups. Add a geometry assertion that the loop scope header is immediately followed by the canvas surfaces rather than a permanent reference strip. Add a tab keyboard test and verify Problems count remains visible while References is selected at 1024 x 700 and at the existing 200% zoom emulation.

- [x] **Step 2: Run the focused Chromium browser tests and confirm the expected failure**

Run: `npm run test:e2e -- tests/e2e/loop-group-authoring.spec.ts tests/e2e/workbench-layout.spec.ts --project=chromium`

Observed RED: 5 failed / 31 passed in Chromium. Four existing tests assumed permanently mounted Problems or the old reference introduction. The new 512 x 350 assertion measured a 16.40625px canvas, below the existing 44px usability floor, because the group settings button wrapped in the scope header.

- [x] **Step 3: Make only the browser-facing corrections proven necessary and update documentation**

Correct responsive CSS or focus behavior identified by the failing tests without altering scanner or mutation semantics. Keep native Enter/Space tab activation from reaching global canvas shortcuts. Keep scope-header buttons on one line and remove vertical header padding at heights up to 500px so the compact body canvas retains at least 44px. Update the loop-group guide to say References is beside Problems, explain the four groups in plain language, and document the insertion-target banner. Ensure the design and plan describe final behavior and mark completed plan steps.

- [x] **Step 4: Run focused and complete verification**

Run sequentially:

```bash
npm test -- src/features/canvas/LoopGroupScopeBar.test.ts src/features/documents/AuxiliaryPanel.test.ts src/features/documents/ProblemsPanel.test.ts src/app/App.test.ts src/lib/layout/layout-store.test.ts
npm run test:e2e -- tests/e2e/loop-group-authoring.spec.ts tests/e2e/workbench-layout.spec.ts --project=chromium
npm run test:e2e -- tests/e2e/loop-group-authoring.spec.ts tests/e2e/workbench-layout.spec.ts --project=webkit
npm run format:check
npm run lint
npm run check
npm run test:unit
```

Expected: every command exits 0 with no unexpected warnings. Rust is unaffected by this TypeScript/Svelte-only change and remains covered by the release branch's existing v1.0.8 verification evidence.

- [x] **Step 5: Commit**

```bash
git add src/features/canvas/GraphScopeHeader.svelte src/features/documents/AuxiliaryPanel.svelte src/app/App.canvas-authoring.test.ts src/lib/docs/build-index.test.ts tests/e2e/loop-group-authoring.spec.ts tests/e2e/workbench-layout.spec.ts docs/app-guides/loop-groups.md docs/superpowers/specs/2026-08-31-workflow-studio-loop-group-visual-authoring-design.md docs/superpowers/plans/2026-09-06-loop-group-references-panel.md
git commit -m "test: verify loop references panel"
```

## Completion evidence

Tasks 1 and 2 were completed in `44df5d2` and `31fe9dc`. Task 3 completed browser-first corrections for compact scope-header height and tab activation, migrated affected browser/unit locators, and updated the offline guide. Final checks: 93 focused unit tests, 36 Chromium tests, 36 WebKit tests, format, lint, check (0 errors / 0 warnings), and 1,834 full unit tests all passed. An earlier Chromium body-entry timing outlier (59ms against the unchanged 50ms gate) is recorded with subsequent passing runs in the Task 3 report; no threshold was relaxed. Full RED/GREEN logs and detailed self-review are in `.superpowers/sdd/2026-09-06-loop-group-references-panel/task-3-report.md`.
