# Task 13 report: loop-group authoring and scoped performance

## Scope and authority

- Implemented only Workflow Studio Task 13 from reviewed commit `caba93eaf54a5107409cc6012d2e33cb67f034a4` on `feat/loop-group-visual-authoring` in the existing worktree.
- Hermes, bundled authoring contracts, conformance corpora, examples, packaged resources, and native Rust code were not changed.
- Playwright now validates `WORKFLOW_STUDIO_E2E_PORT`, binds Vite to that exact port with `--strictPort`, and always sets `reuseExistingServer: false`. Final browser evidence used isolated port `14313`.

## RED/GREEN evidence

The new browser and module witnesses exposed concrete failures before production corrections:

- Empty-body repair admitted the group controls but rejected a newly added body prompt with `minLength`; focused analyzer coverage proved the exact one-level selected-kind draft should remain visually repairable while invalid extras, cycles, nested groups, and topology/reference failures remain blocking.
- Svelte Flow's visible-only mount could not measure the first node created in an empty body. Boundary coverage now proves only the one-node admission uses an unvirtualized first render; 2, 249, and 250 nodes retain visible-only rendering.
- Selecting a 250-child root `loop_group` materialized 1,253 Inspector inputs and 27,785 descendants, and the first root drag produced 505–529 ms renderer work. The root group Inspector now materializes only contract-derived owner controls, and compound canvas projection no longer traverses the raw body value. Focused App and poison-getter tests cover both boundaries.
- The active body reference bar materialized all 250 previous-output rows. It now renders at most 12 searchable results while all 250 tokens remain keyboard discoverable and operable.
- A valid dependency connection produced a 63 ms renderer frame. Stage attribution showed `set-dependencies` cloned and serialized the complete 1,000-node document before final verification. The patcher now clones and serializes only the existing dependency sequence, preserves its flow/block form and scalar nodes, and retains the authoritative final verified parse. The patch golden/property set passes 44 tests.
- A rejected connection initially observed one native call before release. Instrumentation identified a delayed `layoutSave` from `DocumentWorkspaceController` after canvas/recovery readiness had completed. The semantic E2E flush now drains canvas persistence, document layout persistence, and recovery persistence before metrics reset. The strict zero parse/validation/layout/YAML/native/Git assertion remains unchanged.
- The complete browser run caught a guessed field ID in the scoped Problems test. The DOM showed the correct repeated-ID scope, child selection, concrete field pointer, rendered prompt control, and focused textbox. The test now asserts the exact pointer and a nonempty contract-derived field ID.
- Expanding the navigation-state witness first waited for an Inspector control while the editor was still in YAML mode. The corrected journey establishes the unsaved edit, returns to Visual, records the independent root/body state, and then records YAML scroll before traversing all four workbench pages.
- The scoped Problems journey initially assumed every diagnostic exposes documentation. It now keeps its unique synthetic range only for exact focus routing and separately uses a real durable-loop-groups diagnostic for the documented action.
- The accessibility matrix exposed a WebKit-only assertion mismatch when reduced-motion durations were returned as comma-separated all-zero lists. The assertion now validates each computed duration without weakening the all-zero requirement.
- A cold-suite run exposed that the first scoped-draft analyzer predicate accepted a schema-valid throwaway child before checking for additional semantic blockers. The blocker-equality gate now runs first; mixed cycle, reference, topology, compatibility, and arbitrary-invalid cases remain rejected while only the active one-level Add First Node repair draft is admitted.
- Root and body Problems initially shared one DOM scroll position (root 576, body 1,028, returning root 1,028). Layout v2 now stores an optional per-scope `problemsScroll`, defaults older records to zero on read, and restores/captures it through the active scope. Focused layout, panel, App, and full state-restoration tests pass.
- Independent review reproduced a deferred Back-focus fallback stealing focus after the user intentionally advanced during the next animation frame. The fallback now runs only while focus remains on its original owner, and a checked-in two-frame browser regression keeps the user-chosen control focused.
- The final audit review caught four evidence gaps without expanding production scope: the authoring fixture now begins with the exact raw bundled Task 12 definition plus an explicit valid augmentation; root/body Inspector tabs and complete scoped layout snapshots are distinct and exact; outer/previous insertion proves the existing dependency list is unchanged; Back/re-entry have exact byte, zero-work, and Chromium long-task checks; and forced-color/focus assertions use the actual selected outline and every exercised new control. The independent re-review approved the corrected candidate.

The final scoped performance command passes 7 test invocations that consolidate all 8 audit requirements across module and browser witnesses. The `it.each` pointer test covers root and body independently. The final dual-project browser command passes all 16 executions of the 8 journeys.

## Delivered evidence and corrections

- A shared deterministic fixture produces exactly one 250-node/500-edge root plus three 250-node/500-edge bodies, with unique forward-only edges, a document below 2 MiB, and preseeded v2 layouts for every scope.
- Eight bounded Playwright journeys cover the real bundled example bytes and all three body-entry methods; complete child authoring, current/outer/previous references, accepted/rejected real port gestures, save/reopen, and exact definition/companion preservation; independent root/body/YAML/workbench unsaved state across Settings, Examples, Documentation, and Git; child field, group-control, YAML-fallback, and documented scoped Problems routing; real-palette empty repair and final-child deletion; 251-node capacity isolation; keyboard, Escape, focus, accessible names, live explanations, reduced motion, forced colors, 1024x700, and 512x350 behavior; and scoped gesture/performance evidence.
- Browser gesture helpers verify truthful `elementFromPoint` node/port targets. Pointer phases retain zero YAML parse, validation, layout, YAML transaction, native/file, and Git work before release.
- Only one Svelte Flow is mounted. Hidden scopes neither mount nodes nor invoke layout. Root and body persistence remain separate and active-scope-only.
- The five persistent Task 12 full-suite failures are closed: authoritative capacity fixture counts, App capacity Visual state, the separate Docs selector, and asynchronous Problem-focus acknowledgment. The earlier compact-drawer timing failure also passes in the cold suite.

## Scoped performance acceptance matrix

| Requirement | Direct or consolidated witness |
| --- | --- |
| 1. Deterministic root plus three body scopes at exact 250/500 | `scoped-canvas-performance.test.ts` fixture/count/uniqueness/forward-edge test |
| 2. One index and under 2,000 ms | Module analysis test; final verbose run was 152 ms with one index build, one definition traversal, four graph visits, and 1,000 node visits |
| 3. One mounted flow; hidden scopes do no layout | Module mount/scope-rerender test plus journey 8 exact `data-scope-key`, hidden-node, and single-mount assertions |
| 4. 1,000 root and body moves; one named-scope save | Two module cases assert 1,000 moves, zero authority work, no save at 299 ms, and one save at 300 ms; journey 8 proves real node gestures and active-only persistence |
| 5. Pan, zoom, and batched selection isolate active scope | Module 1,000-event selection batch plus journey 8 real pan/zoom/selection and unchanged sibling/root snapshots |
| 6. Truthful body ports; accepted and rejected connections | Module connection dispatch plus journey 8 `elementFromPoint` port proof, strict pre-release metrics, one accepted YAML transaction, and zero rejected transactions |
| 7. Bounded Inspector/Problems; entry and Back do no authority work | Journey 8 bounded internal scrollers, Inspector commit, Problems scroll, single-flow scope entry/Back/re-entry, exact definition/companion bytes, exact metrics, and Chromium long-task phases around both switches |
| 8. 251-node body isolation | Module projection classification plus journey 6 root/large/small scope navigation, nonblocking YAML-only advisory, saveability, and exact retained bytes |

## Verification

- Exact Task 13 regression list: 15 files, 210 tests passed.
- All additionally touched focused suites: 13 files, 335 tests passed.
- Scoped performance: 1 file, 7 invocations covering all 8 audit requirements passed; final verbose durations were 57, 152, 384, 183, 156, 146, and 13 ms.
- Journey 8 stability: Chromium 3/3 repeated executions passed, followed by WebKit 1/1. No measured Chromium interaction phase recorded a long task greater than 50 ms after the final fixes.
- Final browser matrix: `WORKFLOW_STUDIO_E2E_PORT=14313 npx playwright test tests/e2e/loop-group-authoring.spec.ts --workers=1 --reporter=line`; Chromium 8/8 and WebKit 8/8, 16/16 total, completed in 39.5 seconds. Both named projects enforce the 15-second per-journey bound.
- Cold full TypeScript suite: `npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1`; 159 files and 1,818 tests passed in 93.67 seconds.
- `npm run format:check`, `npm run lint`, and `npm run check`: passed; Svelte reported 0 errors and 0 warnings.
- `npm run contracts:check`, `npm run examples:check`, and `npm run resources:verify`: passed; resource verification retained exactly 40 files.
- `git diff --check` and the focused skip/only/debug/placeholder scan passed.

## Known limits

- WebKit runs every functional and editor-metric assertion, but its browser environment does not expose Chromium's `longtask` observer entry. No WebKit long-task claim is made.
- The 512x350 journey is effective 200% CSS reflow evidence. Native operating-system zoom, Tauri/WKWebView behavior, reference-hardware frame pacing, Windows behavior, packaging, installation, and release smoke remain Task 14 or native/manual gates.
- The performance fixture intentionally uses compact one-character prompt payloads so its fixed 250/500 topology measures the editor's scoped graph behavior rather than prose size. Document size limits and larger textual payloads remain covered by the existing analysis/resource suites.
