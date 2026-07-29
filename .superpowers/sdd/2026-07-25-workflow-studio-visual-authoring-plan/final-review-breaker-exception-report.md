# Phase 3 final-review breaker exception report

## Scope and authority

- Base commit: `a3aeaf83beba02253fa1199f090f4c4f440054c7`.
- Branch/worktree: `feature/workflow-studio-v1` in `.worktrees/workflow-studio-v1`.
- Implemented only the authorized real Inspector `language_compatibility` profile-migration fix.
- Did not modify the sibling `hermes-agent` repository, reopen the other five review findings, or touch deferred structured-schema validation.
- Preserved YAML as the sole workflow authority; no field inventory or persisted graph model was added.

## TDD behavior boundary

The new tests render the production `App` and production `Inspector` enum widget. They open real YAML pairs through the App workspace controller, use both bundled production contracts, run the real YAML patch and analysis implementations through an in-process worker endpoint, and assert the real session, history, contract digest, analysis, comments, and browser persistence boundaries. They do not call `DocumentWorkspaceController.changed()` directly and do not assert a mocked forwarding call.

The production mutation that makes the migration tests fail is changing `App.svelte` back to validating the proposed companion YAML with the current document contract. The missing-contract test fails if the App proceeds to patch/registration or does not surface the bounded Settings recovery action.

## RED evidence

Before production edits:

1. `npm run test:unit -- src/app/App.profile-migration.test.ts -t "commits hermes-legacy to archon-2026-07"`
   - Exit: 1.
   - Result: 1 failed, 2 skipped.
   - Observed real behavior: Inspector selection produced `The proposed YAML mutation would make the workflow structurally invalid.`
   - The companion remained `language_compatibility: hermes-legacy`; history and the document contract did not switch.
2. `npm run test:unit -- src/app/App.profile-migration.test.ts -t "commits archon-2026-07 to hermes-legacy"`
   - Exit: 1.
   - Result: 1 failed, 2 skipped.
   - Observed real behavior: the same old-contract structural-validation alert appeared.
   - The companion remained `language_compatibility: archon-2026-07`; history and the document contract did not switch.
3. `npm run test:unit -- src/app/App.profile-migration.test.ts -t "fails closed when the proposed profile"`
   - Exit: 1.
   - Result: 1 failed, 2 skipped.
   - Observed real behavior: the generic old-contract mutation error appeared instead of the required actionable missing-exact-contract message.

These were expected behavior failures after correcting initial test-environment issues (`Range` geometry stubs and the analysis projection assertion); neither production file had been edited at the time of the recorded RED runs.

## Implementation

### `src/app/App.svelte`

- Detects only the concrete companion root field `/language_compatibility` on the real Inspector commit path.
- Derives the proposed profile from the field operation, including the legacy default for removal.
- Resolves the exact active contract for the proposed supported profile before patching or structural validation.
- Fails closed with an actionable Settings message when no exact active contract exists or the worker cannot prepare it.
- Pre-registers a different proposed contract, then calls `applyWorkflowMutation()` with that proposed contract.
- Leaves every unrelated Inspector mutation on the existing current-contract path.

### `src/features/documents/document-workspace-controller.ts`

- Tracks contract digests whose worker registration completed successfully.
- When a changed pair selects an already registered exact active contract, adopts the pair, document digest, and target analysis synchronously in the same App commit turn instead of publishing an intermediate unavailable-contract state.
- Retains the existing asynchronous registration path for direct YAML migrations whose target has not already been registered.
- Keeps cross-profile Settings activation isolated: registration of a different profile does not rebind the currently open pair until its YAML selects that profile.

### `src/app/App.profile-migration.test.ts`

- Covers real rendered Inspector migration from `hermes-legacy` to `archon-2026-07`.
- Covers real rendered Inspector migration from `archon-2026-07` to `hermes-legacy`.
- Verifies one history transaction, exact target digest/analysis, CST-preserved leading and inline comments, unchanged definition YAML, and subsequent successful persistence.
- Verifies missing-exact-contract failure preserves the same pair, analysis object, digest, empty history, and exact persisted companion bytes.

## GREEN and adjacent regression evidence

1. `npm run test:unit -- src/app/App.profile-migration.test.ts`
   - Exit: 0; 1 file, 3 tests passed.
2. `npm run test:unit -- src/app/App.profile-migration.test.ts src/features/inspector/Inspector.test.ts src/lib/documents/transactions.test.ts src/features/documents/document-workspace-controller.test.ts src/app/App.test.ts src/app/App.canvas-authoring.test.ts src/app/App.companion-contract-readiness.test.ts src/app/App.contract-cache-boundary.test.ts`
   - Exit: 0; 8 files, 129 tests passed.
3. `npm run test:unit -- src/app/App.profile-migration.test.ts src/features/documents/document-workspace-controller.test.ts`
   - Exit: 0; 2 files, 58 tests passed after the final small refactor.

The adjacent matrix covers ordinary Inspector edits, transaction validation/CST behavior, direct YAML profile migration, controller switching, cross-profile Settings isolation, App canvas/form history, companion readiness, and cache boundaries.

## Required gates

- `npm run contracts:check` — exit 0; bundled authoring contracts validated.
- `npm run examples:check` — exit 0; bundled workflow examples validated.
- `npm run check` — exit 0; Svelte check reported 0 errors and 0 warnings.
- `npm run verify` — final exit 0:
  - format check passed;
  - ESLint passed;
  - Svelte/TypeScript checks passed with 0 errors and 0 warnings;
  - 83 unit/component files passed, 620 tests passed;
  - 68 Rust tests passed, 0 failed;
  - Rust main/doc test targets passed with 0 failures.
- `npm run build` — exit 0; 4,385 modules transformed and production assets emitted.
- `git diff --check` — exit 0.

## Whole-suite timeout investigation

The first `npm run verify` attempt reached 618/620 unit passes but timed out in two unchanged suites:

- `src/app/App.disposal.test.ts` at its 15-second limit;
- `tests/accessibility/keyboard-authoring.test.ts` at its 20-second limit.

Systematic-debugging Phase 1 evidence:

- Running both together passed 2/2.
- Running disposal alone passed in about 10.4 seconds.
- Running keyboard authoring alone passed in about 9.7 seconds.
- Neither path invokes the changed companion profile field branch or cross-profile contract activation: disposal only mounts/unmounts; keyboard authoring edits a companion-less legacy workflow.
- The full suite runs 83 files in parallel; the first run's transform/import totals were materially higher and pushed these already slow tests to their existing ceilings.
- A repeated unmodified full `npm run verify` passed all 620 unit/component and all 68 Rust tests.

Conclusion: load-dependent timing in two pre-existing slow suites, not an assertion or changed-path regression. No timeout, test, or unrelated production behavior was changed.

## Self-review

- The target contract is selected by exact supported profile and active cache selection; no lexical same-profile fallback was introduced.
- The target is resolved/prepared before the proposed YAML is structurally validated.
- Failure before preparation or validation produces no YAML, history, document-contract, analysis, recovery, or disk mutation.
- Successful migration produces one CST patch and one history transaction; definition YAML and unrelated companion comments remain unchanged.
- Already registered targets avoid an intermediate user-visible unavailable-contract publication.
- Direct YAML migration retains its existing fail-closed asynchronous resolution behavior.
- Ordinary Inspector edits still validate with the current document contract.
- The mutation check is covered: using the current contract for `applyWorkflowMutation()`, omitting target registration/adoption, or permitting a missing target each fails at least one new test.

## Concerns

- No remaining functional concern in the authorized scope.
- The production build retains the repository's existing large-chunk warning (`index` minified chunk above 500 kB); this fix does not materially add bundled runtime code or change chunking.
- Two existing integration-heavy component tests are close to their time limits when run alone and can time out under cold parallel load; repeated full verification passed without changing their limits.
