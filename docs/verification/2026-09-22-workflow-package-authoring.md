# Package authoring implementation evidence

## Task 1: pinned package contract boundary

Implemented the offline package-contract loader, immutable envelope/vector projections, exact-commit sync/check tooling, provenance, and release-resource inclusion. Upstream files remain byte-identical to agent commit `748b6c5711bc055449cc245dc4e9800cc6bb0412`.

Observed test-first evidence:

- Initial loader/sync tests failed because the two modules did not exist. A temporary Node-only Vitest config isolated that boundary while worktree dependency installation completed; subsequent verification used the normal project configuration.
- The offline packaging test failed because package artifacts/provenance were absent from the packaged resource manifest, then passed with the manifest updated.
- A mutable input-buffer regression failed when parsing could observe bytes different from the hashed snapshot, then passed after capturing bytes before asynchronous hashing.

Verification:

- `npm run test:unit -- src/lib/package-contract/package-contract-loader.test.ts scripts/sync-package-contracts.test.ts tests/installers/release-package.test.ts`: 44 passed across 3 files.
- Existing contract-loader and workflow-pairing tests passed alongside the initial new loader/sync tests: 44 passed across 4 files at that stage.
- `npm run package-contracts:check`: pins, envelope, embedded schemas, and vector envelope passed offline.
- `npm run resources:verify`: 45 bundled resources verified.
- Targeted ESLint and `git diff --check` passed.
- `npm run check`: 0 errors and 0 warnings.

Implementation decisions:

- Disable only Ajv's `strictTypes` convention because Pydantic emits `pattern` beside nullable `anyOf`; retain strict keyword/schema validation. This accepts the published schema without modifying upstream bytes. It does not disable instance validation.
- Real temporary-Git integration tests, including the existing autocrlf checkout test, use a 30-second timeout. Concurrent Windows filesystem work exceeded the five-second unit default; assertions and production limits remain unchanged.
- Packaging tests derive the resource count from the integrity manifest and explicitly verify the added artifacts instead of freezing another numeric inventory assertion.

This is foundation work only: vector semantic consumers, package UI, native package preparation, marketplace install interoperability, and all five adversarial review rounds remain pending.

## Task 2: manifests and package discovery

Added pure, immutable package projections; contract-schema and semantic manifest validation; raw document/text retention on invalid input; duplicate JSON key rejection; deterministic discovery; root/member/path checks; and unchanged ordinary workflow pairing. This layer consumes scan metadata and manifest text, with no filesystem I/O or graph persistence.

The manifest/discovery tests first failed at the missing modules. Final behavior tests cover all upstream manifest validation vectors and all path vectors, plus non-NFC names, invalid Unicode, full case folding, file/directory aliases, nested roots, duplicate IDs, symlinked ancestors, missing members, unknown values, code-point ordering, and workspace-root packages. Index/digest validation vectors and native boundary recipes remain assigned to their later consumers.

Verification:

- Package tests plus pairing and workspace-action/coordinator regressions: 79 passed across 6 files.
- Strengthened duplicate-key tests using otherwise-valid manifests and workflow-contract synchronization coexistence tests: 26 passed across 2 files. Existing contract sync preserves both package artifacts and provenance byte-for-byte.
- `npm run check`: 0 errors and 0 warnings; targeted ESLint and diff checks passed.
- Vendored Unicode tables match SHA-256 of the pinned upstream source. Original implementation/table hashes and the small TypeScript adaptations are recorded in `src/lib/packages/unicode/provenance.json`.

Implementation decisions:

- Reuse the agent desktop's Unicode 14 normalization and case-folding algorithm/tables, exporting its NFC helper and adding bounds-established TypeScript assertions. Host JavaScript Unicode versions and lowercasing do not define package identity.
- The existing `WorkspaceFileEntry` interface already supplies the needed metadata, so no redundant workspace type/state change was added.
- The old plan references nonexistent `src/stores/workspace.test.ts`; verification instead runs the current workspace action/coordinator tests plus pairing tests.
- Standalone workspace-root packages can be discovered. Publishing them into a repository index still needs a valid nonempty repository-relative package location under the approved preparation rules; discovery does not imply publish readiness.

Task 3 remains gated on the separately authorized [upstream resource-resolution amendment](../superpowers/plans/2026-09-22-upstream-package-resource-contract-amendment.md). No sibling source was modified. No package editor or preparation UI has been claimed complete, and no adversarial review round has been marked done.

## Task 3 prerequisite: upstream resource-resolution export

The user subsequently authorized the bounded upstream amendment. Its reviewed implementation is pinned at agent commit `3f921ae05c78f1a9488706fa7e452534a18ca39e`; the original package format/vector bytes remain unchanged. Both new artifacts are synchronized from Git objects and included in the 47-file offline resource set. Studio retains compiler, live-runtime, and sealed descriptors separately and preserves explicit coverage limitations.

The upstream independent prerequisite review passed after deterministic byte reproduction, 72 candidate-expression comparisons, and additional pure compiler/resource counterexamples. That review is separate from the five mandatory complete-feature adversarial rounds, which remain pending. Windows could not create the symlink fixture; neither that case nor cross-platform/full-suite success is claimed.

Studio test-first evidence:

- Reader tests initially failed at the missing module; bundled loading failed at the missing bundled API.
- Sync and release-resource tests failed because the new files were not synchronized/packaged, then passed after integration.
- Expanded verification exposed CRLF in Studio-owned provisional provenance and a sync failure path that could return before other Git reads finished. Provenance now uses LF; sync drains all reads with `Promise.allSettled` before reporting a failure or writing destinations.
- The combined loader, sync, offline packaging, and authoring-sync coexistence gate passed: 58 tests across 5 files, run with `--maxWorkers=1 --testTimeout=30000`. Earlier concurrent runs hit the five-second filesystem-test timeout; assertions and production limits were unchanged.
- Added explicit admission/filesystem vector-family rejection tests after the final upstream export: both failed when the families were omitted, then passed. Final reader gate: 19 tests across 2 files. Pin verification, all 47 resource checks, targeted ESLint, and diff checks passed.
- Final `npm run check`: 0 errors and 0 warnings; targeted formatting passed.

Upstream regression receipt (documentation commit `981ba2dd9be77c2f5b7ea62f9fb2681187fd70c0`) records 350 passing tests and 14 failures reproduced on the unchanged baseline. The marketplace package file timed out at 300 seconds; one separately selected package smoke also failed identically on baseline/candidate because descriptor-safe traversal is unavailable. The interrupted broader attempt remains explicitly untriaged. These limitations do not justify a full-suite or cross-platform compatibility claim.

The [surface matrix](../analysis/2026-09-22-package-resource-resolution-coverage.md) defines Task 3's remaining interpreter and shared-vector obligations. No resource graph, full readiness analyzer, package editor, or preparation UI is claimed complete by this prerequisite.
