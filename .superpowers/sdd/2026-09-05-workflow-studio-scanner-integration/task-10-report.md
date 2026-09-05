# Task 10 report: compound loop groups and scoped canvases

## Scope and starting point

- Implemented only Task 10 from reviewed commit `9197f641fde0e4790d5aee5094cd925da5cd6b10` in the existing `feat/loop-group-visual-authoring` worktree.
- Reused Task 9's scope/layout stores and Task 8's scoped YAML transaction path. No second graph authority, scope store, persistence model, layout pass, native call, or reference scanner was added.
- Did not modify Hermes or the controller-owned review documents under `docs/reviews/`.

## TDD evidence

The first focused RED run covered `project-canvas.test.ts`, `GraphCanvas.test.ts`, `GraphScopeHeader.test.ts`, and `LoopGroupEmptyState.test.ts`. It failed because compound summaries and scoped diagnostics were absent, group activation and boolean Escape ownership were absent, and both new components did not exist. After the smallest component/projection implementation, the same focused group was GREEN with 43 tests.

The Inspector control test was then added and run alone. Its controlled tab/scroll assertions failed against the component-local tab authority. Adding the controlled props and callbacks made that focused test GREEN.

The App/resolver RED cases failed for three missing integration behaviors and the missing target resolver: one active drilled-in flow with focus restoration, body-local capacity isolation, and Escape ownership. The implementation connected the existing scope store, active graph projection, focus handoff, capacity mode, and explicit Inspector target union. A later compound-badge RED assertion proved that body diagnostics were not visible on the owning group; projecting the compound counts into the rendered node fixed it.

Two useful regression failures were resolved before the final run:

- Relaxing stale/read-only state for every visually-authorable draft incorrectly made an ordinary incomplete root node editable. The relaxation is now limited to the exact current empty loop-body repair draft; the root remains read-only while its Open action stays available.
- The shared-history reader-v3 fixture discarded the analyzer's `referenceIndex` and bypassed `DocumentWorkspaceController.openDraft`, so a post-mutation analysis could not retain the next action lease. The fixture now preserves the complete initial analysis and republishes the fresh worker result between two valid dependency edits, matching the real workspace controller's scheduled analysis boundary. Production revision and exact-analysis checks were not weakened.

## Delivered behavior and acceptance trace

| Task 10 acceptance item | Implementation | Automated evidence |
| --- | --- | --- |
| Compound root node summary | Body count, finite `max_iterations`, projection-provided primary sink, error count, and required count are immutable projected data; definition order is preserved. | `project-canvas.test.ts`, `GraphCanvas.test.ts` |
| Complete activation paths | A bounded button plus guarded root-node double-click and Enter share the same callback. Interactive descendants, ports, selection, and Inspect remain usable. | `GraphCanvas.test.ts` |
| Exactly one active flow | App resolves by `scope.key` and passes only that graph to one `GraphCanvas`. | `App.canvas-authoring.test.ts` |
| Scope header and focus | Body header identifies workflow/group; entry focuses its heading; Back restores root scope then focuses the compound node. | `GraphScopeHeader.test.ts`, `App.canvas-authoring.test.ts` |
| Empty-body repair | Exact `loop_group:` / `nodes: []` explanation, Add First Node, Edit Group Settings, no invented settings, and structurally invalid save state retained. | `LoopGroupEmptyState.test.ts`, `App.canvas-authoring.test.ts` |
| Inspector target/state | Qualified workflow/node/group union resolves the owning root group without replacing body selection; binding identity includes target kind/scope; tab and scroll use Task 9 scope layout state. | `inspector-target.test.ts`, `Inspector.test.ts`, `App.canvas-authoring.test.ts` |
| Body-local capacity | Active graph capacity controls a local YAML surface and exact 250-node/500-edge guidance without changing the persisted editor mode or supported root canvas. | `project-canvas.test.ts`, `App.canvas-authoring.test.ts` |
| Escape precedence | `GraphCanvas.cancel()` reports ownership for edge gestures and real selection; App leaves the body only after overlays/drawers/canvas decline Escape. | `GraphCanvas.test.ts`, `App.canvas-authoring.test.ts` |
| One YAML history | Body and root dependency edits produce two entries in the existing document history; entry and Back produce none. | `App.canvas-authoring.test.ts` |
| Lightweight switching | UI handlers call Task 9 navigation/focus only; the existing scope-switch metrics assertion remains at zero for parse, validation, layout, YAML transaction, native, Git, and layout-save work. | `App.canvas-authoring.test.ts` |

## Changed paths

- `src/app/App.svelte`
- `src/app/App.canvas-authoring.test.ts`
- `src/features/canvas/types.ts`
- `src/features/canvas/project-canvas.ts`
- `src/features/canvas/project-canvas.test.ts`
- `src/features/canvas/GraphCanvas.svelte`
- `src/features/canvas/GraphCanvas.test.ts`
- `src/features/canvas/WorkflowNode.svelte`
- `src/features/canvas/GraphScopeHeader.svelte`
- `src/features/canvas/GraphScopeHeader.test.ts`
- `src/features/canvas/LoopGroupEmptyState.svelte`
- `src/features/canvas/LoopGroupEmptyState.test.ts`
- `src/features/inspector/inspector-target.ts`
- `src/features/inspector/inspector-target.test.ts`
- `src/features/inspector/Inspector.svelte`
- `src/features/inspector/Inspector.test.ts`

## Final verification

- Required focused command: 4 files, 68 tests passed.
- Required Task 10 regression command: 6 files, 119 tests passed.
- Final combined changed-module/regression command: 9 files, 147 tests passed.
- `npm run check`: passed; `svelte-check` reported 0 errors and 0 warnings, and Node TypeScript compilation passed.
- Scoped ESLint over all Task 10 source/tests: passed.
- Scoped Prettier check over all Task 10 source/tests: passed.
- `git diff --check`: passed.

The full repository suite was not rerun because the required Task 10 regression set and every directly changed module passed, and no failure indicated wider impact.

## Deferred scope

Task 11 remains responsible for scoped palette filtering, generated body-field rebasing, reference insertion/guidance, group-dependency actions, and Problems navigation. This task only supplies the explicit Inspector target and controlled per-scope Inspector state that Task 11 consumes.

## Fix round 1: scoped interaction-state review

### Review findings and RED evidence

The correction started from reviewed candidate `f86435dbc8e261cb8de29672f16a1e1c47224c39`. Exact behavior witnesses were added before production changes and run with:

```bash
npm run test:unit -- src/features/canvas/GraphCanvas.test.ts src/features/canvas/project-canvas.test.ts src/app/App.canvas-authoring.test.ts -t 'opens a compound|prepared contract|lets canvas gestures|removed active-scope'
```

That RED run reported 4 failed tests and 71 skipped tests across 3 files:

- arranging a compound node lost its summary/status/Open behavior, and its accessible label omitted maximum iterations;
- the first node-targeted Escape cleared both an active edge gesture and the selected body node;
- production analysis of the literal minimum `loop_group` draft produced `loop_group_shape_invalid`, while the diagnostic-prose heuristic reported zero required fields instead of the three fields published by the prepared contract;
- removing the active group left Task 9's navigation event unconsumed, so no explanation or root fallback focus appeared.

### Bounded correction

- `GraphCanvas.arrange()` now reprojects with the same group summaries, issues, stale/read-only state, and transition lock as the normal projection path. The existing compound action and visible/accessibility state therefore survive arranging.
- Edge-mode Escape cancels only the edge gesture. The next Escape clears the selected child, and a third otherwise-unhandled Escape returns to the root scope through App's existing precedence chain.
- Compound required status now counts the authored group payload against `required_group_fields`, `body_path`, and `min_nodes` from the prepared `ScopedDagCapabilities`. It no longer examines diagnostic codes/messages and does not contain a second field inventory. Compound summaries remain available while contract state initializes; required status appears when the prepared capability is present.
- App consumes Task 9's one-shot scope navigation event, exposes its explanation through the existing workspace status surface, awaits the root render, validates the recorded root node target against the new projection, and focuses that node or the canvas fallback. The path does not parse, analyze, lay out, mutate YAML, call native/Git services, or save layout.
- The unused GraphCanvas-to-node group-settings callback was removed. The active empty-body settings action still uses App's `editLoopGroupSettings` directly. Compound accessible labels now announce finite maximum iterations.

During the combined regression run, two old expectations failed after the intended behavior became active. The real Archon capability publishes `nodes`, `until`, and `max_iterations` as required, with `min_nodes: 1`; the fixture `{ nodes: [], max_iterations: 4 }` therefore has two required issues, not one. The accessible-name fixture also needed to include its already-visible maximum of seven iterations. Correcting those assertions made the tests agree with the independently loaded contract and visible UI; production code was unchanged for this regression.

### GREEN and regression evidence

- Exact review witnesses: 3 files, 4 passed and 71 skipped.
- Required Task 10 focused command: 4 files, 69 passed.
- Required Task 10 shell/gesture regression command: 6 files, 120 passed.
- Combined changed-module/regression command: 9 files, 149 passed.
- `npm run check`: passed; `svelte-check` reported 0 errors and 0 warnings, and Node TypeScript compilation passed.
- Scoped ESLint over the 7 changed Task 10 source/test paths: passed.
- Scoped Prettier write/check over the same paths: unchanged and passed.
- `git diff --check`: passed.

The full repository suite was not repeated because the accepted candidate already had a full Task 10 receipt, all directly affected modules and required regressions passed, and no failure suggested wider impact.

### Fix-round self-review

All four Important findings and both Minor findings have direct tests and implementation coverage. Arrange preserves the compound summary, required/error state, accessible identity, and Open action. Escape ownership consumes one interaction layer per keypress. Required status is contract-derived and covers a real production-analyzed invalid draft. Removed-scope recovery consumes exactly one event, renders only the root flow, explains the fallback, focuses a valid recorded root node, and records zero navigation work. The settings action needed by empty-body repair remains live, while the dead GraphCanvas plumbing is gone. No Task 11 palette, reference, dependency, or Problems behavior was added.
