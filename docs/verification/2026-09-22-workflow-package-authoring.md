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

## Task 9 follow-up: root packages and lossless membership updates

Import now accepts an existing workspace-root package with canonical relative paths and rejects creating a nested package below it. Membership updates use the shared JSON property editor, preserving unrelated number lexemes, escapes and line endings. The extension preservation test explicitly uses an extension-admitting contract; the pinned strict manifest schema remains unchanged.

Worker reproduced root-path and JSON round-off failures, then verified **15 creation tests passed**. Parent inspected the complete diff and confirmed a subsequent global type check had **0 errors and 0 warnings**. These fixes do not change the requirement to open the repository root for local marketplace preparation.

## Task 12: exact local package Git foundation

Native package context captures the repository baseline, selected package files, current/committed index, and latest reachable manifest version. Preview authorizes the exact selected package union (including ignored files and committed deletions) plus the canonical shared index. Native commit consumes a single-use grant bound to workspace generation, repository baseline, full package source, index, message, and preview. Whole-package deletion is supported by committed context and directory absence. Unrelated staged/worktree paths remain outside the commit.

Package commits write raw blobs and disable configured filters, hooks, signing, textconv, external diff, and fsmonitor execution. Automatic working-tree reads reject applicable executable filters and submodules; historical reads explicitly suppress configured signature verification. The latter regression first executed a benign marker through a configured verifier, then passed after suppression. Existing explicit workflow-pair hook behavior remains intact. Package preparation requires a nonempty package root and a workspace equal to the repository root.

Worker evidence: **79 Git unit tests passed** (1,385 seconds), **12 Windows Git integration tests passed**, native bridge **41 tests passed**, and the complete **78-test workspace suite passed**. The workspace gate includes an eight-file package transaction failing at every staging position with originals retained. Dispatch and exact closed-operation argv checks passed; historical compatibility and **9 history tests** passed after the additional verifier regression. Owned ESLint and staged whitespace checks passed. Updated Unix-only filter tests were not executed on Windows. Parent inspected the exact-path refactor, shared-index authority parser, filter guard, context/preview binding and bridge API.

Optional package snapshot fields are declared for the following complete-inventory mutation amendment; import/text mutation enforcement for those fields remains pending that amendment. They are not counted as implemented native guards by this foundation receipt. Application integration, full release gate and all five adversarial rounds remain pending.

## Preparation policy and complete example-copy integration

Added exact file-change comparison and contract-bound SemVer precedence, including arbitrary-sized numeric identifiers, prereleases and ignored build metadata. Five policy tests passed after the initial missing-module failure. Closed recovery drafts are checked against current package files before preparation; two draft tests passed.

Real browser/App integration exposed an example-copy transaction defect: the planner guarded only the absent destination root, while the transaction authority also requires an explicit absent expectation for every written path. Added those per-file expectations. The regression uses the actual browser transaction authority and verifies every copied file byte-for-byte. That unit regression, the App complete-copy journey, and the targeted Chromium complete-copy journey passed after the correction. This supplements, rather than replaces, the earlier planner/gallery tests.

The full feature gate and five adversarial reviews are still pending. A new real Chromium capacity measurement has correctly failed the existing 50 ms threshold (378 ms cold readiness and 89 ms repeated readiness); worker offloading is in progress. No performance completion claim is made.

## Complete-package mutation and binary import guards

The previously declared optional snapshot tokens are now enforced by native text transactions and binary import/replacement, with equivalent browser behavior. A token binds the full package inventory and identities, is consumed once, and constrains writes, moves and deletions to the captured package. Explicit hash-bound standalone move sources and read-only shared-index expectations remain supported. Native projections enforce the pinned final file, byte and traversal limits before publication; imported bytes stream through tracked staging and rollback.

Nine new real-directory regressions cover stale membership, aggregate overflow, nested parents, outside destinations, standalone adoption, source verification failures, exact 4,096-entry trees, same-byte identity replacement, and changes to outside read-only expectations during final capture. The exact-limit and publication-race regressions failed before their corrections. Final full workspace suite: **87 passed** (139.56 seconds). Native bridge and browser parity: **45 passed across 5 files**. Owned lint and whitespace checks passed. Parent inspected the scope projection, final identity checks, source grant path and browser parity. Verification ran on Windows.

The generic transaction operation retains its separate 8 MiB byte cap. A single batch replacing an entire 8 MiB payload plus a root digest can therefore exceed that operation cap even when the final package is valid; ordinary artifact changes and separate generated metadata writes remain supported. The complete feature gate and five full-feature reviews remain pending.

## Package authoring sessions and dialogs

The authoring controller captures current contracts, complete package sources and exact text identities for blank, bundled-example and saved-workspace choices. Sources include their required resource closure. Dirty sources, changed contracts and stale workspace sessions are rejected before publication. Existing-package imports and artifact additions use the complete snapshot guards; file import cancellation preserves the user's chosen filename. The dialog exposes pending publication to the workspace-close guard and reports a successful commit separately from a failed view refresh.

Controller/dialog verification: **17 tests passed** (13 controller, 4 dialog), with owned lint passing. A subsequent Help regression reproduced the modal remaining above the destination page; closing the authoring modal before navigation passed the added test. Actual App journeys passed for creating a package, adding a text artifact and copying every file of a bundled package. Browser binary replacement and malformed draft restoration also passed individually. Full combined browser and release gates remain pending.

Copying a saved workflow whose required closure contains binary files is explicitly disabled because the current text transaction has no binary-copy primitive. Binary artifact import/replacement remains supported through the native source grant. This limitation is shown to the user rather than dropping required files.

## Integration checks before the initial full gate

Reproduced and corrected three slow-close navigation races: a delayed Back to Workflow recovery flush must not override a newer overview, artifact or workspace selection. All three real-App regressions passed. Finding focus requests carry one-based line/column coordinates through text, command and manifest editors, with six failing cases followed by fifteen passing component cases. Shared-index navigation is explicitly read-only and preserves the actual workspace-relative technical path. Tree readiness and Help dismissal checks passed after their regressions.

Twelve package browser journeys were exercised in Chromium and WebKit: node resource creation/editing/return focus, binary replacement, package creation, complete multi-workflow example copying, keyboard/reduced motion, missing resources with non-blocking destination advisories, shared-index conflict after preview, exact-preview commit, generated-write rollback, malformed recovery draft restoration, saved malformed script blocking, and explicit external-change choice. The combined 24-case run had 23 passes and one WebKit timeout during cleanup after all commit/layout assertions passed. That extended journey now uses a 30-second total budget, matching the existing CI budget; no product assertion or interaction-performance threshold changed. Its rerun passed in both engines. The saved-malformed-script journey was then strengthened to open the blocking finding at line 2; its missing-action regression failed, and the integrated fix passed in both engines.

Global type checks reported zero errors and warnings; lint, format, authoring/package contract checks, examples validation and integrity verification of all 72 protected resources passed. Byte-frozen package examples and fixtures are excluded from automatic formatting because their exact bytes are verified by package digests and upstream parity; source code formatting remains enforced.

Production build passed, but startup bundle verification failed: 3,052,963 minified bytes / 725,184 gzip bytes exceeded the existing 2,000,000 / 450,000 budgets and included eager CodeMirror. Lazy-loading remediation is in progress. The full functional browser gate was stopped after its first three passes to avoid validating a changing integration candidate. The full Rust gate is running. All five full-feature adversarial reviews remain pending until the initial complete gate and immutable candidate are ready.

## Package analysis worker and diagnostic identity

Moved pure package analysis to a packaged module worker. The main thread retains native capture and exact-byte verification; the worker receives bounded captured inputs and returns structured-clone-safe projections and findings. Requests bind both request ID and native snapshot token. Failure, timeout and disposal reject pending work, with a fresh worker only on a subsequent explicit retry. Production has no main-thread fallback. Build-time Node example validation explicitly supplies the pure adapter. The execution audit traverses the worker and permits only its fixed local module constructor.

Worker identity/parity/security checks: **15 tests passed** (19.20 seconds), following missing-module and retry-after-failure regressions. Parent standard `examples:check` passed without an environment workaround. Real quiet Chromium measurement retained the unchanged 50 ms threshold: before offloading, cold readiness caused a 378 ms long task and repeated readiness an 89 ms long task; after offloading, both phases recorded zero long tasks. The worker-backed total analysis times were 801.1 ms cold and 167 ms repeated, with 250 nodes, 500 edges, 104 package files, and zero authority work across 30 pointer frames. The test body passed in 8.3 seconds, but its runner hung during teardown and was interrupted; no JSON attachment survived. A completed exit-zero browser performance rerun is required in the initial full gate.

A real nested-workflow companion type error also exposed a diagnostic identity bug: the finding used the workspace-prefixed companion path while package navigation expects package-relative paths. The mapper now uses declared package membership. The regression failed with `packages/nested/main.hermes.yaml`, then all **8 readiness tests passed** with `main.hermes.yaml` and the original line/column preserved.

## Resumed initial verification

The parent reran the package no-execution, contract parity, and 250-node/500-edge pointer-frame project checks: **12 tests across 3 files passed**, exit 0, 58.98 seconds. The pointer test exercises real package discovery, complete analysis, and native hashing between movement batches, and verifies no parsing, hashing, Git, or native calls during the callbacks. This unit gate does not replace the required completed browser Long Tasks measurement.

The startup-bundle remediation preserves the existing 2,000,000-byte / 450,000-gzip static import-closure limits. The production build and budget check passed at **1,294,657 bytes / 337,370 gzip**. Required authoring resources are still dynamically requested by startup readiness (approximately 760 KB additional uncompressed data); the static closure figure is not total startup transfer. Package editors, package contracts, and browser package capabilities load on demand. Focused evidence: three actual-App cold creation/preparation/manifest cases, 28 browser capability cases, and 16 contract/bundle cases passed; type checks reported zero errors/warnings and owned lint passed. The cold creation regression exposed an asynchronous catalog refresh race, corrected before the passing rerun. The independent full formatting gate also passed.

The complete Windows Rust gate exited 0: **299 tests passed** (286 library, one dispatch, 12 Git integration), with zero failures, ignored tests, or filtered tests. Main and documentation targets contain zero tests. The command was cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1. Test execution took 1,798.65 seconds plus 18.39 seconds compilation. A static inventory identifies 58 Unix/non-Windows-gated tests excluded from this Windows build (44 unit, 14 integration); they were not runtime skips and have not been verified by this run. Existing compiler warnings remain unchanged. No native source or test assertion changed during the gate.

## Initial full-suite findings and verified corrections

The initial full Vitest sweep completed in 2,531.48 seconds: **2,871 passed, seven failed across 250 files**, plus one unhandled environment-teardown rejection. The failures were two stale immutable lockfile baselines, three stale gallery/dialog text expectations, the old exact Git-operation allowlist, and the production distribution build exceeding its explicit 20-second test timeout. The companion-contract test ended while real lazy canvas imports were still loading.

Corrections preserve exact assertions: the lockfiles are pinned byte-for-byte to npm commit 5daa1702fe0f65c5ff71273be005cc97ef57fec0 and Cargo commit 1aa3420000fda855d0ca0a28f18fb30898a57ddc. Inspection found 12 npm and 37 Cargo additions, no dependency upgrades/removals, and no orphan additions; existing npm changes only reconcile development classifications. The existing devalue security patch remains intact. The Git allowlist remains strict and ordered, with four additional Rust exact-argument assertions covering filter inspection and names-only package diffs, including literal pathspec syntax and spaces. Both Rust mapping tests passed after an observed counterexample.

Workflow-copy tests now select workflow cards or named workflow examples, retaining their original copy-count, navigation, file-preservation, and font assertions. Dialog tests now expect the already-corrected readable punctuation. The companion-contract test finishes opening the created pair and verifies its real canvas node before teardown. The production distribution security test retains its no-fixture assertions, additionally rejects both package test-control globals, and uses a 60-second whole-build budget; the observed cold build had taken 24.34 seconds. No UI interaction threshold changed.

The focused rerun passed **101 tests across six files**, exit 0, in 155.24 seconds, with no unhandled teardown errors. This includes all 80 App tests, eight security tests, ten release-provenance tests, both dialog tests, and the companion-contract test. Existing jsdom geometry/Svelte diagnostic console output does not represent an unhandled Vitest error. A complete corrected Vitest rerun is in progress with a saved JSON report; no full pass is inferred from this focused result.

The first full functional browser attempt was stopped after 204 Chromium cases: 201 passed and three failed because former first-card selectors selected newly added package examples. WebKit had not started. The corrected four-journey regression passed seven of eight cases; the remaining WebKit all-workflow-copy journey completed its assertions around the 15-second whole-test timeout. It now receives the existing CI 30-second budget. An additional run exposed the separate default 15-second page-setup budget, so broad browser verification uses the repository's existing CI profile with one worker and zero retries. The final two-engine copy rerun passed both cases and exited naturally in 41.5 seconds.

A child-owned Vite server prevented a completed browser runner from exiting. Stopping that verified owned server released the failed-run summary. Subsequent runs use the existing server-reuse option with a parent-managed local Vite process and explicit cleanup. This changes test-server ownership, not assertions or application behavior. The complete corrected 426-case functional run is in progress. Quiet reference-performance verification and all five adversarial rounds remain pending.

## Corrected full unit result and browser failure classification

Candidate `9e1a59b80781e71e0a7a7f7e2965775d4c1133a1` completed the corrected full unit gate with exit 0: **2,878 tests across 250 files passed**, no failed or pending tests and no unhandled errors, in 2,401.73 seconds. Command: `npx.cmd vitest run --maxWorkers=1 --testTimeout=30000 --reporter=default --reporter=json --outputFile.json=.superpowers/sdd/2026-09-03-workflow-package-authoring-local-publishing/initial-full-unit-corrected.json`. The retained JSON SHA-256 is `527de450f186c255cab73f88aff8cfcac96ca08efd348b325ffdf068cfc64862`. Its nested suite count is not the test-file count reported above.

The corrected two-engine functional browser run completed naturally with exit 1: **419 passed, four failed, three configured skips**, 426 collected, 52.7 minutes. All package authoring, preparation and recovery journeys passed in both engines. The failures were capacity Arrange in both engines, plus WebKit's Escape-selection and palette-drag cases. The three existing WebKit skips require Chromium CDP worker inspection or forced-colors/native measurement probes. Evidence is retained in `test-results-package-full-corrected`.

After the unit run ended, the same three scenarios were repeated without a competing owned suite. All three Chromium cases passed; all three WebKit cases failed again (six cases, exit 1). Capacity diagnostics show the five-second worker deadline and no missing handles. The WebKit selection failure occurs after a YAML edit selects `publish` through the editor cursor; the previously selected `prepare` node and edge remain cleared. The neighboring picker-priority test explicitly clears the YAML cursor selection before asserting empty canvas selection. The palette trace records a completed drag without a new node; it does not itself record DataTransfer contents.

For a baseline comparison, the parent served root checkout `955499dde9eb29c3dd2b06fdcbb26022ab4d1ccf` on port 1434. Its `src`, E2E tests, package manifests and Vite/Playwright configuration have no diff from feature-start `b79d4b1646cb93b47ddab2bf695fc614caf5814e`. All three WebKit failures reproduced with the same assertions against that pre-feature application. Baseline and candidate artifacts remain separate in `test-results-package-baseline-webkit` and `test-results-package-quiet-repro`; both runs exited 1. The temporary baseline server was stopped explicitly.

The established CI platform split uses Chromium for Windows functional acceptance and Chromium/WebKit on Linux. The [Windows stabilization receipt](2026-09-14-windows-primary-stabilization.md) already documents Windows WebKit losing custom drag MIME data in a minimal browser reproduction. This baseline comparison supports a pre-existing platform/test classification; it is not Linux WebKit acceptance. No application fallback, test skip, timeout increase or changed assertion was introduced. Linux WebKit and installed native WebView acceptance remain distinct, unverified boundaries for this candidate.

The same prior receipt's final disposition records user-accepted Back-to-root pauses and rare capacity Arrange timeouts. These remain explicit limitations, never strict performance passes. Other interactions retain the 50 ms limit. The first quiet reference run passed the general canvas and new package performance scenarios, but failed warmed Arrange at 52 ms and Back to root at 53/54 ms. The baseline passed Arrange and failed Back to root at 51/51 ms. No new performance waiver is inferred.

The completed package measurement recorded 104 files alongside 250 nodes/500 edges, 714.7 ms first readiness and 174 ms repeated readiness, zero long tasks in either phase, and zero authority work in 30 pointer frames. This is a passing test inside an exit-one four-test run, not a passing whole reference gate.

The subsequent five-repeat command was `npm.cmd run test:e2e:performance:windows -- --workers=1 --retries=0 --repeat-each=5 --reporter=list`, with CI timeouts, perceptual enforcement left enabled, reused port 1433 and output `test-results-package-performance-repeat`. It completed naturally in 4.2 minutes, exit 1: **18 passed, two failed**. General canvas, Arrange (including all five warmed phases per case), and package performance each passed **5/5**. Scoped gestures passed **3/5**; the only failures were Back to root at 64 and 65 ms, within the previously accepted exception. The earlier isolated 52 ms Arrange sample is retained as a variability observation, not erased by the five subsequent strict passes.

Across all five package cases, first readiness took 636.5–831.1 ms and repeated readiness 167.2–174.5 ms; each had 104 files, zero long tasks, 30 pointer frames and zero authority work during those frames. The repeat command did not pass as a whole because accepted baseline exceptions remain visible to its strict assertions. No thresholds, retries, assertions, skips or application code changed during this investigation.

The subsequent complete Windows functional gate exited zero: **213/213 passed in 21.7 minutes**, with zero retries or skips. Command: `npm run test:e2e:functional:windows -- --workers=1 --retries=0 --reporter=list`, CI enabled, reused port 1433, output `test-results-package-windows-functional`. The capacity Arrange, forced worker-timeout recovery and offline production-worker cases all passed. This verifies the pre-remediation candidate; it does not establish results for subsequent review fixes.

Round 01 reviewed immutable candidate `8244e8aeda39d7b759a106ca85f5fb5d1cd63193` and returned **BLOCK** with six Important findings. Its frozen report and reconciliation are in `docs/reviews/workflow-package-authoring/`. Remediation is active; rounds 02–05 and the final corrected-candidate gate remain pending.

## Round 01 remediation verification

All six accepted Important findings have corrections in `b958591` (authenticated-body reference validation and exact workflow-name uniqueness), `9f340e6` (durable recovery retention and end-to-end receipts), and `05d851f` (exact declared pairing and guarded package mutations). The frozen independent report remains BLOCK for its original candidate; the separate reconciliation records observed failures, corrections and limits. Rounds 02�05 and final full verification remain pending.

Affected gates: 65 semantic/reference tests; 21 focused native transaction tests and 103 workspace tests; 30 native bridge boundary tests plus receipt extraction/controller/dialog gates; 55 unfiltered package/resource tests and 11 affected App tests. Six Chromium authoring journeys passed in 1.3 minutes with no retries, including cancellation without byte changes, two-consumer script rename through the real worker setup and binary replacement only after preview confirmation. No authored content executed.

Global formatting and lint passed. Svelte/TypeScript checks reported zero errors and warnings. Authoring contracts, exact pinned package resources, bundled examples and 72 packaged resources passed. The production build passed in 16.40 seconds; the startup static import closure was 1,302,503 bytes / 339,052 gzip under the unchanged limits. Neither these affected gates nor the prior baseline full run substitute for the final full gate after round 05. See round-01-reconciliation.md for exact evidence and recovery-platform limitations.
