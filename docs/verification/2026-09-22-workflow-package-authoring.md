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

## Upstream amendment follow-up and Studio replay

The current artifact pin is `3e89c2659b6e9c95a627b8f819ff63a11529d86a`; upstream documentation is committed at `5c8c4cd4b2a727730b85d6e76cbc603d2125fd01`. The first Studio interpreter replay passed 38 cases and exposed one published MCP fixture-order defect: sorted JSON mapping keys no longer matched the order used to observe expected candidates. Upstream now canonicalizes the fixture before observing it and tests both rendered and committed JSON replay. Runtime lookup behavior is unchanged. Independent targeted follow-up review passed; the original frozen review remains historical evidence.

- Upstream focused test receipt: 12 passed, 1 skip for unavailable Windows symlink privileges.
- Studio candidate lookup, context admission, inline discriminator, and MCP candidate primitives: 39 passed. These are the first interpreter batch, not workflow-level reference graph or readiness completion.
- Combined Studio gate: `npm run test:unit -- src/lib/package-contract src/lib/packages/resource-resolution.test.ts src/lib/native scripts/sync-package-contracts.test.ts tests/installers/release-package.test.ts scripts/sync-contracts.test.ts --maxWorkers=1 --testTimeout=30000`: 127 passed across 9 files.
- `npm run check`: 0 errors and 0 warnings; targeted package-contract/interpreter ESLint passed.
- `npm run package-contracts:check`, `npm run resources:verify` (47 files), and `git diff --check` passed against the corrected pin.

The primitive interpreter files remain Task 3 work in progress. Workflow reference graphs, static analysis integration, readiness, and all five full-feature adversarial rounds remain pending. Upstream broader regression limitations above still apply.

## Task 4 native implementation handoff

The independent native implementation is present in the worktree but has not been committed or accepted as complete by the parent. It adds explicit UTF-8 artifact operations, revision-aware binary import/replacement through single-use dialog grants, streamed hashing/copying, contract limits, and constrained external opening. The existing YAML operations retain their boundaries.

Worker-reported evidence: 28 native TypeScript tests passed; 63 Rust workspace tests passed using Rust 1.88.0; owned-file lint and whitespace checks passed. The parent combined 127-test gate above includes the native TypeScript tests. Windows symlink cases returned early because privileges were unavailable; the passing Rust count does not establish symlink containment coverage. Actual OS reveal/open remains a manual acceptance check.

External opening accepts only bounded, verified PNG data re-encoded into a temporary snapshot; all other artifact types use Reveal. Unicode normalization is pinned to Unicode 14.0.0. Native changes and generated ACL metadata remain isolated from this contract-pin commit for subsequent parent review and integration.

## Task 4 parent integration

The parent inspected the artifact capability/grant flow, passive-image opening, and shared atomic-write refactor, then reran `cargo test --manifest-path src-tauri/Cargo.toml workspace::`: 63 passed, no failures. `npm run check` reported zero errors and warnings; targeted ESLint for package and native modules passed. The earlier combined 127-test gate covers the unchanged native TypeScript files. The implementation is accepted as the Task 4 foundation; OS interaction and privileged symlink acceptance remain Task 16 requirements, not inferred from the passing test count. Generated opener ACL descriptions do not grant renderer opener permissions, and automatic JavaScript link opening is disabled.

## Task 3: resource graph and readiness foundation

Implemented the contract-driven candidate interpreter and derived workflow resource graph, artifact classification, readiness aggregation, and complete synthetic laptop fixture. The graph consumes existing YAML projections and keeps body node identity, shared resources, inline source, and unreferenced payload files distinct. It never persists a competing workflow model. Readiness requires current artifact/inline analysis and completed integrity checks; runtime availability and execution remain advisories.

Test-first checkpoints covered missing modules, stale file inventories, companion identity, incomplete projections, unsupported descriptor changes, missing inline analysis, and incorrectly attaching a script runtime to an MCP resource. Extensionless scripts remain supported as the runtime permits them. The missing laptop fixture test failed before the fixture was added; the finished fixture is checked through real manifest discovery and workflow validation.

Verification: `npm run test:unit -- src/lib/packages src/lib/validation/analyze-workflow.test.ts --maxWorkers=1 --testTimeout=30000` passed 173 tests across 9 files. Global type checking reported zero errors/warnings; package ESLint and diff checks passed. All 15 compilation fixtures are accounted for: supported single-source fixtures replay bindings (including substituted host interpreter identity); include fixtures fail closed because catalog-selected origins are unavailable; rejected-source fixtures remain blocked. This is not a claim of implementing upstream include expansion or replacing the compiler's structural diagnostics.

Remaining integration obligations: Tasks 6-7 must provide real static analyzers; Task 11 must supply a complete native package scan, exact snapshot identity and digest/index verification. Caller-supplied analyses are not authorization to commit bytes. Cross-origin include preparation remains unavailable without authoritative source expansion. The five full-feature adversarial rounds remain pending.

## Task 5: artifact sessions and recovery

Artifact sessions preserve exact editable text independently of workflow YAML, with scoped native writes, revision checks, and recovery keys containing workspace and path identity. Recovery storage retains compatibility with existing workflow drafts and shares the bounded inventory. External changes require comparison before overwriting; deleted files can be recreated with an absence check or accepted while retaining the recovery draft. Asynchronous navigation, save, discard, and recovery operations check captured sessions before publishing results.

Worker verification passed 35 focused tests, including application disposal regression tests; owned ESLint, Prettier, and whitespace checks passed. The parent inspected the controller and reran sessions, recovery, editors, and command analysis together: 69 tests across 13 files passed. Test-first cases included deleted-file recovery after restart, navigation/edit races, and discard serialization. Full application prompts and lifecycle wiring belong to Task 8 and remain in progress.

## Tasks 6-7: text artifacts and command Markdown

Added bundled CodeMirror languages for Python, JavaScript/TypeScript, and JSON alongside existing YAML and Markdown support. Text editing exposes line numbers, search, folding, undo/redo, focusable syntax diagnostics, and exact invalid-draft saves. Language/access changes reconfigure the existing editor. Diagnostics are bounded local parser checks; they do not start runtimes, language servers, or compiler processes. Binary views show metadata and scoped replace/reveal actions; external opening remains restricted by the native verified-PNG operation. Generated metadata is read-only.

Command resources expose keyboard-operable Edit, Preview, and References tabs. The Markdown preview uses DOMPurify with passive tags and no attributes, removing remote images, navigation, styles, and script/event surfaces. The pinned contracts have no command-frontmatter schema: YAML mapping validation preserves unknown keys, and schema validation is conditional on an authoritative supplied schema. This reconciliation is recorded in Task 7 rather than inventing a key inventory.

Initial missing-module/editor-routing tests failed before implementation. The combined 69-test artifact run passed, covering editor controls, invalid saves, command parsing, malicious HTML, and references. An additional cyclic-YAML regression reproduced a stack overflow in the shared freeze helper; iterative cycle-aware freezing and invalid-Unicode checks passed the new command test and existing contract-loader tests. Full application integration, complete readiness wiring, and the five adversarial review rounds remain pending.

## Task 8: package navigation and artifact integration

Added the package catalog store/controller, navigation tree with resource categories, overview, manifest source/form editing, and application routing to workflow, text, command, or binary editors. Companion files route through the existing paired workflow editor. Invalid manifests remain accessible through a repair action. Targeted JSON field changes retain unrelated source bytes, including unknown large numeric literals.

Artifact lifecycle integration includes recovery prompts, comparison before Keep Mine, deletion/reload behavior, workspace watcher rereads, and awaited close/disposal recovery flushes. Integration exposed two cross-controller races: an old controller clearing a newer session, and an expected old-session close aborting a new controller's open. Both were reproduced and corrected with ownership-aware publication.

Worker evidence: full App and inspector run 80 passed; subsequent package-only App checks 5 passed; categorized tree/keyboard checks 2 passed; controller/inspector checks 7 passed. Parent inspected controller/session boundaries and relevant workbench components. Final worker type check reported zero errors/warnings and owned ESLint/whitespace checks passed. Windows edit tooling introduced UTF-8 and CRCRLF test-file damage during work; original text and LF encoding were restored. The final release gate must rerun the integrated application after subsequent resource/preparation wiring.

Creation, validation, preparation callbacks and Git version details remain integration work; the overview does not claim readiness or publication prematurely. Five full-feature adversarial review rounds remain pending.

## Tasks 9 and 11: native transactions and complete snapshots

Added capability-scoped package transactions, complete file/directory capture, and atomic generated digest/index replacement. Native source tokens bind workspace generation, complete membership, file identities, and exact bytes. Tokens are bounded and single-use for generated replacement. Transactions preflight revision/absence expectations, preserve writable permission bits, reject read-only targets and hardlinks, and report partial rollback with precise retained recovery locations. The browser fixture mirrors these contracts but cannot represent empty directories.

Parent inspection and worker red/green checks corrected root-digest exclusion accounting, case-folded nested manifests, projected traversal overflow, temporary/backup entry interference at exactly 4,096 entries, and Trash secondary-quarantine reporting. Integration then reproduced incorrect joins for a valid workspace-root package; capture and revalidation now support that editing case. Generated marketplace preparation still requires a nonempty package subfolder so the shared repository index stays outside its payload. Repository metadata remains prohibited package content.

Final worker verification: Rust 1.88.0 `cargo test --locked workspace:: -- --test-threads=1`: **77 passed**, 0 failed. Native bridge tests: **39 passed**. Focused root regression: **1 passed**. Owned ESLint and whitespace checks passed. POSIX permission preservation was not exercised on Windows; privileged symlink/manual OS checks remain acceptance limitations. These focused results do not replace the final integrated release gate or any of the five adversarial rounds.

## Task 11: deterministic metadata and static analysis coordination

Pure digest generation replays all seven exported exact-byte digest vectors, all six package-file limit recipes, and publisher-claim diagnostics. Index generation replays both byte-boundary and both catalog-boundary recipes, rejects duplicate keys and ambiguous paths, and preserves committed metadata for unselected packages. A selected-only interrupted generated update can be regenerated; unrelated shared-index changes block preparation. Generation requests bind the exact analyzed native payload hashes and account for a newly created digest file in the final traversal limit.

The analysis coordinator combines complete native capture with the real workflow, Python/JavaScript/TypeScript, structured-text, and command Markdown analyzers. Text must match captured native hashes. Binary files remain in the snapshot and digest. Missing repository-index context explicitly blocks readiness, and unknown include/runtime context stays fail-closed. A root-package path regression was observed failing before correcting the workspace-relative prefix. Readiness limit codes now match the exported marketplace diagnostics.

Verification: combined package generation/manifest checks **44 passed**; subsequent digest/coordinator checks **18 passed**; projected-traversal preparation checks **6 passed**; readiness checks **7 passed**. The final broader documentation/coordinator run passed **68 tests across 10 files**, including the workspace-root regression. Owned ESLint passed; the integration type check reported zero errors/warnings. Native-backed local Git preparation and final application acceptance remain subsequent tasks.

## Task 14: offline package guidance

Added fifteen bundled guides covering package structure, creation, multiple workflows, command/script/MCP resources, external requirements, readiness, digests/trust, local preparation, updates, Git handoff, destination installation, and recovery. Technical YAML values and real filenames remain accurate; application prose uses loop24. Preparation requires opening the repository root with the selected package in a subfolder, keeping the shared index inside the workspace capability and outside package payloads.

Documentation navigation includes the package group and preparation task. Context help can target a validated topic heading, focuses that heading after rendering, and consumes the complete topic/heading request. Markdown remains sanitized; arbitrary fragments and active content are rejected. Tests exercise guide discovery/search/related links, local-only completion language, exact heading navigation, focus, and preservation of existing documentation behavior.

Observed missing-guide and missing-task failures before implementation. Focused documentation/preparation checks **35 passed**, heading/render/article checks **24 passed**, and the final broader docs/coordinator run **68 passed across 10 files**. Owned ESLint and integration type check passed (zero errors/warnings). Context links from subsequently integrated preparation/resource controls remain part of the final application gate.

## Task 9: creation and membership planning foundation

Added pure creation/import transaction planning and package/workflow selection dialogs. The planner validates manifest and workflow structure, authoritative resource resolution, package identities, canonical destinations, complete projected payload/traversal limits, source hashes and higher-priority candidate absences. Copy preserves source resources; move is restricted to a saved standalone workflow pair. The resulting native transaction includes the exact manifest and file operations. Existing package membership is preserved during import.

Worker evidence: creation **13 tests** and dialogs **5 tests** passed within the 91-test focused regression run; subsequent resource integration gates retained the stable foundation. Parent inspected destination, resource and limit guards and reran owned ESLint successfully. Three dialog files contained replacement characters introduced by Windows edit tooling; visible punctuation was restored with explicit UTF-8 and ASCII text before commit. Application creation/import callbacks, root-package membership handling, and end-to-end transaction acceptance remain integration work.

## Task 13: preparation controller and presentation foundation

Added the Validate, Review Changes, and Version & Commit presentation and its controller. Relevant drafts flush before validation. Blockers retain the validation report; cancellation invalidates pending read results. Mutation operations reject duplicate actions and cannot be dismissed while pending. Failed source preparation requires fresh validation. Completion is shown only after a committed native result and retains post-commit warnings.

The final step separates **Prepare preview** from **Commit local version**. Generated bytes and native authorization are obtained first; the exact diff is displayed as text. The final commit requires matching version/message and a single-use authorization. Editing either input requires a new preview. Rejected or expired authorization is never retried silently. This makes the final approval concrete while preserving the approved three-step flow.

Evidence: initial component/controller missing-module failures observed; presentation **9 tests** passed. The final-preview amendment produced **3 expected failures**, then **6 dialog tests passed**. Controller **8 tests passed**, including failed saves, blockers, stale results, changed inputs, expired authorization, recoverable source errors and duplicate commit prevention. Owned ESLint passed after correcting a test-only unused argument. An integration type check reported zero errors/warnings before the next native/example task introduced its intentional test-first gaps. Native-backed preparation adapter and App integration remain in progress.

## Task 10: node-to-resource actions

Connected supported script/command/MCP contract fields to resource creation, selection, inline extraction, open/reveal and contextual guidance. Preview planning uses a complete hash-verified package capture and the existing YAML mutation engine. Clean saved pairs are required. The native transaction commits the resource and YAML reference together; only then does the document coordinator publish one saved semantic-history operation. Native watcher events are queued during that transaction so the app's own write cannot race history publication. Newer user drafts remain protected if the open document changes mid-commit.

Create/select/extract open the resulting artifact editor. Back to Workflow flushes recovery and restores the originating resource field action, falling back to Open when extraction removes the inline action. Undo restores the YAML through existing history; the created artifact remains an unreferenced file.

Worker evidence: **40 domain/component tests passed**, then **3 real-App integration cases passed** for create, select and extract, including exact saved bytes, one saved history step, artifact navigation and return focus. Earlier 91-test regression covered the underlying planners, dialogs and saved-pair behavior. Owned ESLint passed. Fixture failures were traced to invalid empty tags, a spy installed after bridge cloning, and clicking confirmation before asynchronous preview readiness; tests were corrected without relaxing application validation. Full App regression, rapid navigation during return-focus recovery, and the five adversarial rounds remain final-gate work.

## Task 15: complete bundled package examples

Added four synthetic package examples with 25 bundled files, covering laptop diagnostics, multiple workflows, command resources and external requirements. Production digest generation created their checked-in claims. The catalog exposes immutable source text; complete editable copy validates workflows, static artifacts, references, limits and digests, allocates an unoccupied canonical root and ID, regenerates claims after ID changes, then submits one native transaction. The gallery distinguishes Workflow and Package and retains errors without pretending a rejected copy opened successfully.

Build validation counts implicit directories, rejects unsupported empty directories, checks every catalog-path ancestor for links, and preserves exact UTF-8 bytes including a BOM. The shared manifest property helper validates unique JSON keys and changes only the selected existing value, preserving unrelated lexical content. Release inventory now verifies 72 protected resource files.

Worker evidence: initial missing-loader/validator/gallery/resource failures observed; full scoped examples/gallery/release regression **45 tests across 5 files passed**. Manifest helper **2 tests passed** after a missing-module failure. Traversal and empty-directory regressions produced **2 expected failures**, then **8 tests passed**. An actual temporary-directory junction ancestor regression failed before correction; the final loader/validator **9 tests passed**. `examples:check`, `resources:verify` (72 files), owned ESLint and whitespace checks passed. A global type check passed before other tasks' active test-first changes; subsequent diagnostics were outside this scope. No example script was executed. App callback wiring and native staged-file rollback acceptance remain integration gates.
