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
