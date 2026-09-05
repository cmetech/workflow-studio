# Task 11 report: scoped authoring controls and reference guidance

## Scope and starting point

- Implemented only Task 11 in the existing `feat/loop-group-visual-authoring` worktree from reviewed commit `58144e021a728ef419de468769029652a0e0ab07`.
- Reused the prepared reader-v3 scanner capability, Task 8's revision-checked YAML mutation path, Task 9's scope/layout authority, and Task 10's active-graph/Inspector target model.
- Did not modify Hermes, bundled resources, Task 12, or the controller-owned review documents under `docs/reviews/`.

## TDD evidence

The first focused RED checkpoint added contract-backed palette, generated-field, exact draft, and Problems behavior witnesses. It reported 4 failing behavior assertions with 10 existing assertions passing. The failures established that body kinds were not queried from scoped capabilities, body fields still used root paths, the generic group draft omitted `nodes: []`, and documented Problems rows diverted to Documentation.

Subsequent narrow RED/GREEN checkpoints covered the remaining seams:

- The initial Inspector target-selection test failed 1 test with 20 skipped because only focus-in was observed; pointer and keyboard selection changes did not refresh the insertion lease. Event capture on the existing Inspector scroller made it pass.
- The workflow-qualified Problems identity test failed 1 test with 3 skipped because accessible names included group/node/field but omitted the workflow. The optional workflow name now prefixes the issue context.
- The root group App journey failed 1 test with 33 skipped after proving the YAML and history were correct: the accepted `visuallyAuthorable` group projection had not crossed the existing canvas publication boundary, so guarded scope entry remained at root. Publishing only an accepted current analysis projection (structurally valid or visually authorable) allowed normal layout reconciliation and guarded entry; exact YAML, one undo item, body scope, and heading focus then passed.
- The first affected regression run reported 1 failure and 133 passes. The new public reference-surface query exposed `nodes[].command`, although its prepared policy declares the authored value a literal resource name. Rejecting literal-only policies made the same 134-test set pass and prevents insertion into an incompatible command-name field.

Every implementation change followed its focused failing witness. Test expectation corrections were limited to reading the actual prepared caller policy name and waiting for the already-asynchronous body-heading focus.

## Requirements-to-tests traceability

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| One contract/scope palette query | `nodeKindDescriptorsForScope` filters normal root applicability and intersects body kinds with prepared `allowedNodeKinds`; App passes that one result to palette, picker, drop, and chords. | `NodePalette.test.ts`, `AddNodePicker.test.ts`, `App.canvas-authoring.test.ts` prove exact body order `command,prompt,bash,script,loop,approval,cancel` and absence of `include,workflow,loop_group`. |
| Exact empty group draft and automatic entry | `addNode` derives the body path from `ScopedDagCapabilities` and creates only `{id, loop_group:{nodes:[]}}`; App waits for accepted projection/layout availability before guarded scope entry. | `canvas-actions.test.ts`, `App.canvas-authoring.test.ts` prove exact parsed YAML, one history item, active body, and heading focus. |
| Generated scoped and owner fields | `fieldsForScopedNode` rebases ordinary node templates through `graph.sourcePath`; `fieldsForLoopGroupOwner` derives controls from `topology.group_fields`, excludes the container/body field, and retains applicable outer-node fields. | `widget-registry.test.ts` proves the full child path and the seven generated controls; App Problems journey proves the concrete body and group pointers. |
| Scope-qualified Inspector behavior | Inspector accepts scope, full pointer, focus path, and text-target hooks; diagnostics require matching scope; binding identity already includes target kind/scope. | `Inspector.test.ts`, `App.canvas-authoring.test.ts` cover repeated IDs, exact focus, controlled scope state, child-selection preservation, and selection-lease refresh. |
| Exact reference guidance | `buildLoopGroupReferenceGuidance` uses active body dependencies, `graph.outerInputs`, definition order, body-shadow suppression, and the prepared `$LOOP_PREV.` prefix. | `loop-group-reference-guidance.test.ts`, `LoopGroupScopeBar.test.ts` cover exact current/direct-outer/previous tokens, shadowing, and missing-dependency explanation. |
| Prepared public surface query | `referenceSurfaceForField` resolves canonical root/body/group paths from the prepared policy map and rejects literal-only authored fields without scanning YAML. | `reference-index.test.ts` proves an absent prompt field is queryable and a literal command-name field is not; inventory metrics remain one build/one traversal. |
| Stale-safe Copy and Insert | `LoopGroupReferenceTargetOwner` owns the connected control and all workflow/generation/revision/digest/profile/scope/binding/path/field/text/selection identities; Insert re-materializes the current field, rechecks the prepared surface, uses `setRangeText` plus `input`, and refocuses. Copy uses the injected writer with exact bytes. | `loop-group-reference-guidance.test.ts` covers successful insertion/copy, clipboard failure, and 14 stale/disconnected identity families without mutation. |
| Explicit dependency mutation | `addLoopGroupDependency` resolves current root group/producer, rejects missing/duplicate/cyclic edges, and uses the existing single `set-dependencies` transaction. The scope bar never inserts after this action. | `canvas-actions.test.ts`, `LoopGroupScopeBar.test.ts` prove one commit, exact dependency, separate action, and no implicit text insertion. |
| One Problems coordinator | Main rows always request focus; Docs is separate. `problem-focus-coordinator.ts` routes exact graph/local node/group owner/YAML, checks revisions around awaited scope entry, preserves YAML-only body scope, falls back to YAML, and acknowledges once. `EditorModes` exposes imperative YAML focus only. | `ProblemsPanel.test.ts`, `problem-focus-coordinator.test.ts`, `EditorModes.test.ts`, and the direct App repeated-ID/group-control journey. |
| Stable/accessibile Problem identity | Names include workflow/group/node/field; keyed duplicate ordinals count only prior identical fingerprints. | `ProblemsPanel.test.ts` proves distinct repeated child names/keys and stable identical duplicate ordinals after unrelated insertion. |
| Bounded and accessible UI | Scope guidance is bounded, wraps at compact widths, uses the existing scroller model, forced-color borders/focus, and reduced-motion rules. Inspector/Problems retain their bounded owners. | `LoopGroupScopeBar.test.ts`, `ProblemsPanel.test.ts`, `tests/accessibility/keyboard-authoring.test.ts`, `tests/accessibility/reduced-motion.test.ts`. |
| No rescans or performance regression | App prepares through the cached contract authority; guidance reads projected/indexed data only. Existing 250-node/500-edge active-graph behavior remains covered. | `reference-index.test.ts` metrics plus `App.canvas-authoring.test.ts` capacity cases; no pointer-path parse, validation, layout, or I/O was added. |

## Changed paths

- `src/app/App.svelte`
- `src/app/App.canvas-authoring.test.ts`
- `src/features/canvas/node-kind-options.ts`
- `src/features/canvas/NodePalette.test.ts`
- `src/features/canvas/AddNodePicker.test.ts`
- `src/features/canvas/canvas-actions.ts`
- `src/features/canvas/canvas-actions.test.ts`
- `src/features/canvas/LoopGroupScopeBar.svelte`
- `src/features/canvas/LoopGroupScopeBar.test.ts`
- `src/features/canvas/loop-group-reference-guidance.ts`
- `src/features/canvas/loop-group-reference-guidance.test.ts`
- `src/features/inspector/Inspector.svelte`
- `src/features/inspector/Inspector.test.ts`
- `src/features/documents/ProblemsPanel.svelte`
- `src/features/documents/ProblemsPanel.test.ts`
- `src/features/documents/problem-focus-coordinator.ts`
- `src/features/documents/problem-focus-coordinator.test.ts`
- `src/features/editor/EditorModes.svelte`
- `src/features/editor/EditorModes.test.ts`
- `src/lib/forms/widget-registry.ts`
- `src/lib/forms/widget-registry.test.ts`
- `src/lib/references/reference-index.ts`
- `src/lib/references/reference-index.test.ts`

## Final verification

- Required Task 11 behavior command: 7 files, 84 tests passed.
- Affected action/reference/coordinator/editor/forms and accessibility command: 8 files, 135 tests passed.
- `npm run check`: passed; `svelte-check` reported 0 errors and 0 warnings, and Node TypeScript compilation passed.
- Scoped ESLint over all 23 Task 11 source/test paths: passed.
- Scoped Prettier write/check over all 23 Task 11 source/test paths: passed.
- `git diff --check`: passed.

The full repository suite was not run because the required Task 11 suite, every directly affected authority, and the relevant keyboard/reduced-motion regressions passed without evidence of wider impact.

## Self-review and limits

All Task 11 audit RED items have direct implementation and test coverage. The scope bar intentionally offers whole-output tokens only; users may type contract-valid structured suffixes in the field. Insert changes only the widget draft and still requires the existing explicit Apply action to mutate YAML. Adding a missing outer dependency remains a separate explicit mutation and never inserts text automatically. No unsupported contract behavior is inferred: palette, fields, reference eligibility, previous prefix, and dependency rules come from the prepared pinned capability.
