# Task 12 report: offline loop-group resources and drift gates

## Scope and authority

- Implemented only Workflow Studio Task 12 from reviewed commit `95a5bd3afcd7caab16de33039c1321766b7bd74b`.
- The bundled Hermes contract, corpus, and manifest bytes remain identical to the starting commit. Git object IDs are `0e6d591af47256e97489e605b01e7e1a646005c5` (Archon contract), `4104136bf856228c803ce9ba39782726ea84c87b` (Archon corpus), `5b8b7aa630b255ef919fb98c8bf3ad8fc426039a` (legacy contract), `40a8104dc64c689de43bdb9834108a65ad2e7bd4` (legacy corpus), and `13497c2dc56a581c0b5eca935d70a71b7395b359` (contract manifest).
- No Hermes repository, canvas/App production behavior, Task 13 tests, release artifact, merge, push, or installed application was changed.

## TDD evidence

The initial neutral-loader RED failed one suite at module resolution because `bundled-resource-manifest.ts` did not exist. Its GREEN checkpoint passed 7 tests. The focused bundled loader/contract/conformance set then passed 34 tests.

The Node adapter/resource RED failed 3 tests because it constructed nonexistent `*-v1.json` paths. After manifest selection was introduced, the resource failures exposed the exact invalid examples inherited from Task 6B. The example/intent/gallery GREEN checkpoint passed 12 tests across 3 files.

The documentation RED failed 2 of 18 tests because `loop-groups.md` and its journey metadata did not exist. The new guide, generated field/widget/status assertions, and corpus tag assertions made the docs/navigation/corpus set pass 66 tests across 3 files.

The integrity RED failed 4 of 25 tests: the old resource hashes/count, the absent writer export, and the six new YAML files being rejected as extras. The GREEN checkpoint passed all 25 installer/resource tests. Two generations are byte-identical, a changed source byte changes its digest, and unknown source paths remain rejected by the fixed allowlist.

Final focused verification passed 110 tests across the 8 prescribed Task 12 files.

## Delivered behavior

- Corrected five existing example definitions and the conditions guide without weakening reference validation: punctuation now terminates outside references, the conditional producer declares and demonstrates matching JSON output, approval uses dependency gating, and the advanced example uses whole captured approval output.
- Added exactly 3 offline example pairs and catalog intents: `loop-group-current-output`, `loop-group-iteration-context`, and `loop-group-primary-sink`. Intent checks resolve body graphs by `scope.key`, assert current/outer/previous reference behavior, assert definition order and first-terminal `primarySinkId`, and assert `summarize/publish` companion policy.
- Added the searchable Loop groups guide with the final UI labels: **Open loop body**, **Back**, **Add First Node**, **Edit Group Settings**, **Copy**, **Insert**, and **Add group dependency**. It documents repairable empty drafts, save/export blocking, namespace rules and shadowing, first-terminal output, scoped companion paths, the 250-node/500-edge per-scope visual limit, YAML-only preservation, and the non-execution boundary.
- Added a browser/Node-neutral manifest loader. It accepts manifest text and a basename-only read callback, limits manifests to 128 KiB, resources to 2 MiB each, and manifests to 16 entries, and validates safe basenames, unique profiles/files, contract identity, canonical corpus digest, and paired corpus identity. The Vite and tsx callers supply bytes without crossing their environment boundary.
- Removed v6/v2/profile filename selection from production TypeScript. Both adapters now use `entry.file` and `entry.corpus_file`; the Node example gate also parses each selected corpus through the production conformance reader.
- Example highlights now use all `projection.graphs` and each graph's `editorNodePrefix`; intents use stable scope keys rather than graph array positions.
- Extended generated drift coverage through `collectContractFields` and `resolveWidget` without a field inventory. Corpus coverage derives all tags, classifies every prefix, records 70 Archon tags across 13 prefixes, and separately proves the single `projection:primary-sink` case from dependency edges and YAML definition order.
- Extended the predeclared release allowlist by exactly 6 YAML paths and added `resources:sync-integrity`. The writer rejects extra/missing paths before hashing, emits sorted schema-version-1 JSON with two-space indentation and one LF, and assigns the existing 2 MiB maximum to all 40 resources.

## Changed paths

- Examples: `examples/README.md`, `examples/catalog.yaml`, the five corrected example definitions, and the six new loop-group YAML files.
- Guides: `docs/app-guides/conditions-and-outputs.md`, `docs/app-guides/loop-groups.md`, `src/lib/docs/navigation.ts`, and their tests.
- Contract resources: `src/lib/contract/bundled-resource-manifest.ts`, `bundled-contracts.ts`, `conformance.ts`, and their tests.
- Validation/examples: `scripts/validate-examples.ts`, `scripts/validate-examples.test.ts`, `src/lib/examples/load-examples.test.ts`, `validate-example-intents.ts`, `ExampleGallery.test.ts`, and `analyze-workflow.test.ts`.
- Packaging: `package.json`, `scripts/verify-release-assets.mjs`, `src-tauri/resources/setup-integrity-v1.json`, and `tests/installers/release-package.test.ts`.

## Verification

- Focused Task 12 set: 8 files, 110 tests passed.
- `npm run contracts:check`: passed.
- `npm run examples:check`: passed.
- `npm run resources:sync-integrity`: wrote exactly 40 files.
- `npm run resources:verify`: verified exactly 40 files.
- `npm run check`: passed with 0 errors and 0 warnings.
- Scoped ESLint, scoped Prettier, and `git diff --check`: passed.

The required complete unit run executed 158 files and 1,798 tests: 1,792 passed and 6 failed. All four inherited Task 12 resource failures are closed. An isolated rerun left five failures outside this task: one stale capacity fixture that adds a node without updating the projection's authoritative capacity, two App YAML-only tab-state assertions, one App test whose selector now matches both a Problem row and Task 11's separate Docs button, and one App problem-focus acknowledgment assertion. A compact-drawer focus timing failure passed in isolation. Task 12 changed none of those test files or App/canvas authorities; they remain Task 13/final regression work.

## Self-review

- The fixed allowlist remains the resource security boundary; generation never discovers and admits paths.
- Vite-only `import.meta.glob` remains in `bundled-contracts.ts`; the pure conformance reader and shared manifest loader are safe under tsx.
- No `graphs[0]`/`graphs[1]` assumption remains in Task 12 example validation or intent code.
- Contract and corpus filenames occur only in literal test fixtures and immutable manifest data, not production selection logic.
- Documentation makes no execution or runtime-success claim.
