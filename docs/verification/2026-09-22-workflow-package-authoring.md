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

Implementation decisions:

- Disable only Ajv's `strictTypes` convention because Pydantic emits `pattern` beside nullable `anyOf`; retain strict keyword/schema validation. This accepts the published schema without modifying upstream bytes. It does not disable instance validation.
- Real temporary-Git integration tests, including the existing autocrlf checkout test, use a 30-second timeout. Concurrent Windows filesystem work exceeded the five-second unit default; assertions and production limits remain unchanged.
- Packaging tests derive the resource count from the integrity manifest and explicitly verify the added artifacts instead of freezing another numeric inventory assertion.

This is foundation work only: vector semantic consumers, package UI, native package preparation, marketplace install interoperability, and all five adversarial review rounds remain pending.
