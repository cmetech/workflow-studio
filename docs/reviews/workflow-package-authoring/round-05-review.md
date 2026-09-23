# Independent adversarial review — round 05

Frozen independent report, 2026-09-23. Findings were reached before consulting any prior round findings or implementer remediation explanations.

## Identity and disposition

- Candidate: `a43abc5f067a519820b71a04b6218fdbd7a01dd7`.
- Candidate tree: `e9a28df3d533c90437f37d09c67f970f0e7fba68`.
- Range: `b79d4b1646cb93b47ddab2bf695fc614caf5814e..a43abc5f067a519820b71a04b6218fdbd7a01dd7`.
- Read-only agent reference: `3e89c2659b6e9c95a627b8f819ff63a11529d86a`.
- Verdict: **BLOCK**. Critical: 0; Important: 2; Minor: 0.
- Initial Git identity/range and all 18 binding SHA-256 entries matched. Tracked candidate files were clean; only the assigned prompt was untracked. No earlier review findings, reconciliations, progress ledgers, or current implementation verification receipts were consulted before reaching these findings.

## Findings

### R05-01 — Important — A missing declared member removes the manifest's repair path

Locations: `src/lib/packages/discovery.ts:94` (missing-member rejection), `src/features/packages/PackageTree.svelte:216` (repair affordance), `src/features/packages/package-catalog-controller.ts:63` (repair selection admission), and unchanged Explorer entry opening through `src/app/App.svelte:3236`.

A normal external rename/deletion of a declared definition or companion, or a saved typo in the manifest's Advanced Source member path, makes a schema-valid manifest disappear with its entire package from the Packages tree. Discovery emits `package_member_missing` against the missing member path and immediately skips the projection. The tree provides Repair manifest only when the finding path itself ends in `workflow-package.json`. The controller also refuses an explicit selection of the actual manifest because there is no finding at that path. Refresh clears the active package selection. This is not merely correct blocking of preparation: Studio also removes the existing, safe source file needed to fix the blocker.

The ordinary Explorer cannot provide a workaround: its catalog contains YAML workflow pairs, not arbitrary JSON artifacts; `packageMemberFor` rejects opening even the surviving workflow under the enclosing rejected package with “Repair the package manifest before opening or changing its workflow files.” The user must leave Studio and edit the manifest or restore the missing file externally. The approved integrated manifest source/recovery behavior and troubleshooting instruction to repair in source mode do not hold for this routine invalid state.

An independent production-module probe used the bundled laptop manifest and a synthetic ordinary-file scan, invoked `buildPackageCatalog`, then `PackageCatalogController.refresh/open` for the manifest. Actual result: `packages: []`, missing-member findings, `opened: []`, and `active: null`, exit 0. No authored content was executed. A second independent browser probe reproduced this with all original files still present and only the manifest's companion declaration changed; see check 5 below.

Missing regression assertion: start with a discoverable valid package, change one declaration to an absent path (or remove one member), refresh, and assert that the existing manifest remains explicitly openable/editable while preparation stays blocked. Correct the path through that editor and assert that membership/navigation recovers. Include a still-existing workflow and verify Explorer does not strand the user behind an unavailable repair action.

### R05-02 — Important — Existing artifact saves require the workspace to share the app-data volume

Locations: `src-tauri/src/workspace/mod.rs:192`, `src-tauri/src/workspace/transaction_recovery.rs:130` and `:209`, `src-tauri/src/workspace/files.rs:750`; caller `src/features/artifacts/artifact-workspace-controller.ts:134`.

Production workspace setup always selects `app_data_dir()/transaction-recovery` as the retention store. Saving an existing script, command, or manifest calls `workspaceWriteTextArtifact` → native `artifacts::write_text` → the artifact write path. Before replacing the existing file, that path must hard-link the original inode into the fixed app-data store; any failure is returned immediately. There is no same-volume placement or alternate retained-inode destination. Hard links cannot cross filesystem volumes.

Consequently, the ordinary supported use of a writable repository on `D:` with application data on `C:` cannot save an edit to an existing package artifact. The workspace can open and read, and an initial newly created artifact can appear usable, but subsequent Save fails with `workspace_recovery_unavailable`. The user cannot complete normal package editing/preparation in that workspace through Studio. This is a functional availability regression, **not a claim that the failed save loses the original**. Preserving the original is the correct safety behavior; the defect is making every existing-file edit depend on an unrelated fixed-volume storage location.

The invariant follows directly from the production call chain. The selected native `workspace::transaction_recovery::tests::recovery_cross_volume_and_link_failure_preserve_source_without_copy_fallback` test passed: injected Windows cross-device error 17 is propagated as `workspace_recovery_unavailable`, source bytes remain `C`, and the retention directory stays empty. This confirms the relevant error branch, not a physical two-volume UI trial. Physical second-volume end-to-end behavior remains UNVERIFIED in this round.

The troubleshooting guide acknowledges that another volume may prevent retention. That documentation is not an approved product restriction: the binding design supports local folders/repositories and integrated artifact saving, and the prior accepted baseline exceptions are four specific performance exceptions, not a same-volume filesystem requirement. Retention must continue to preserve open-handle writes; a naive copy-and-unlink fallback would not satisfy that invariant.

Missing regression assertion: bind production-equivalent recovery storage on a different volume from a writable workspace, edit and save an existing artifact, and assert successful exact-byte save with durable same-inode recovery and truthful receipt. Also cover an unavailable app-data volume without sacrificing the original-data protection.

## Coverage and evidence boundaries

Reviewed the foundation/design documents, package design and contract reconciliation, implementation plan, applicable repository instructions, pinned contracts/provenance and vector families, and only the baseline receipt's final disposition/release boundary. Read pinned upstream marketplace path/digest/acceptance and compiler resource behavior as read-only source evidence. No remote installation, trust, or execution success is inferred from Studio tests.

Coverage across the full feature, not just round emphasis:

- Contract loading and pinning; manifest schema/unique-key/canonical metadata; Unicode/path normalization, nested/overlapping roots, declaration pairing, catalog races and invalid-source recovery; exact-byte digests and index reconciliation.
- Resolver compiler-source admission, discriminators, command/script/loop-node references, scoped MCP candidate closure, extension/runtime ambiguity, unsupported includes/host contexts, authenticated output references, static diagnostics and frontmatter parsing. Runtime lookup vectors outside Studio's compiler-source authority are not claimed as implemented runtime behavior.
- Creation/adoption/copy/move/removal, existing/example source selection, artifact rename/trash/replace previews, consumer rewrites, source-origin ambiguity, captured hashes and no-clobber/stale checks; node Create/Select/Open/Reveal/Extract and YAML-authoritative mutation coordination.
- Text/command/manifest/binary editors, recovery drafts, external Compare/Keep Mine/Reload, asynchronous identity handling, generated metadata read-only treatment, sanitized Markdown, passive reencoded PNG opening, native chooser grants, and no authored-content execution.
- Native scoped artifact reads/writes/imports, exact-byte package hashing and complete inventory, symlink/reparse/hardlink/path checks, staging/rollback, source-generation and identity revalidation, original-inode retention and recovery receipts; unchanged YAML-write and workspace scope callers.
- Package-scoped Git context, committed baseline/index isolation, raw object/index operations, literal paths, executable-filter/hook/signing/fsmonitor suppression, no lazy-fetch policy, temporary index/HEAD authorization, exact final preview, unrelated staged/unstaged preservation, version suggestions and local-only completion copy.
- App integration, activity/shell navigation, existing Explorer workflow pairing/opening, package-to-workflow companion selection, inspector resource actions, watcher coordination, drafts before preparation, documentation index/rendering, example/contract/release asset paths, modal focus/keyboard/reduced motion, and worker/performance boundaries.

Selected tests are evidence for their exercised paths, not proof of every interleaving. Deliberately unverified: macOS/Linux native runs and platform-specific cfg branches, physical cross-volume/UNC/network filesystems, OS crash/power-loss durability, real native GUI/file chooser/opener/trash UX, full assistive-technology and DPI/theme matrix, complete unchanged workflow/Git test suites, full release installer and clean-machine offline smoke, and actual agent admission/installation against a prepared output. No signed release/install or remote operation was permitted. Upstream native Windows safe-install capability remains distinct from Windows authoring support. Unsupported resolver origins and destination dependencies remain explicit fail-closed/advisory boundaries, respectively.

## Checks actually run

All runners were coordinated through the parent's exclusive lane. PowerShell used `login:false`; Node came from `C:/Users/ecorell/AppData/Local/loop24/node`. No dependencies were installed and no external network was used. Browser tests reused the parent-owned idle Vite server at port 1433. Test outputs were disposable; this report is the only authored review file.

1. `npx.cmd --no-install vitest run src/lib/packages src/lib/package-contract src/features/packages src/features/artifacts src/lib/artifacts src/stores/artifacts.test.ts src/stores/packages.test.ts tests/project/package-contract-parity.test.ts tests/project/package-no-execution.test.ts tests/project/package-performance.test.ts --maxWorkers=1 --testTimeout=30000` — **56 files, 419 tests passed**, exit 0, 367.85 seconds. This includes compiler-source resource vector families, manifest/digest/path/index vectors, mutations, drafts, controllers, editors, and unit performance/no-execution boundaries.
2. `CI=true WORKFLOW_STUDIO_E2E_PORT=1433 WORKFLOW_STUDIO_E2E_REUSE_SERVER=true npx.cmd --no-install playwright test tests/e2e/package-authoring.spec.ts tests/e2e/package-recovery.spec.ts tests/e2e/package-preparation.spec.ts tests/e2e/package-performance.spec.ts --project=chromium --workers=1 --retries=0 --reporter=list` — **14 passed**, exit 0, 1.5 minutes. Disposable output directory: `%TEMP%/workflow-review05-playwright`. Existing CI timeout profile; no threshold relaxation. The 250-node/500-edge test recorded cold readiness 702.5 ms, concurrent readiness 175.6 ms, 104 files, no >50 ms long tasks, 30 pointer frames and no authority work in pointer frames. This is one measured run, not a claim of full baseline performance reacceptance.
3. `npm.cmd run check`, `npm.cmd run lint`, `npm.cmd run contracts:check`, `npm.cmd run package-contracts:check`, `npm.cmd run examples:check`, and `npm.cmd run resources:verify` — all exit 0. Svelte check: 0 errors/0 warnings. Contracts/corpora validated; package resources matched pinned upstream bytes; workflow/package examples validated; 72 packaged resource files verified.
4. Serial `cargo test --offline --manifest-path src-tauri/Cargo.toml <filter> -- --test-threads=1`: `workspace::tests::artifact_` **14 passed**; `workspace::tests::transaction_` **13 passed**; `workspace::tests::package_` **11 passed** (61.51 seconds); `workspace::transaction_recovery::tests::` **7 passed**; `git::tests::package_tests` **17 passed** (417.12 seconds). **62 total**, all invocations exit 0. The Git group includes the child fixture entry (no-op when independently invoked) plus three actual parent-driven missing-promisor scenarios. It verifies no authored filter/hook/textconv/fsmonitor/signer execution, exact payload including ignored binary bytes, staged/unstaged preservation, changed HEAD/index/generation rejection, shared-index scope, first commit/local identity, and whole-package deletion. Windows cfg-selected tests only; Unix-only symlink/permission paths excluded. The Windows conditional symlink probe can return when symlink privilege is unavailable. Compiler emitted unused-import/variable/dead-code warnings; no warning fix was made.
5. Independent browser regression probe, `node --input-type=module` from PowerShell stdin, using installed `@playwright/test` Chromium, one browser, no retries, 30-second page timeout, existing `http://127.0.0.1:1433/?scenario=package-authoring`: open Folder, choose Packages, await the laptop package row, read fixture files, change only `manifest.workflows[0].companion` from `workflows/laptop-diagnostic.hermes.yaml` to `workflows/missing.hermes.yaml` using the fixture's native-write/watcher control, await “No packages discovered in this workspace.” Actual output, exit 0:

   ```json
   {
     "changed": {
       "path": "packages/laptop-diagnostic/workflow-package.json",
       "oldPath": "workflows/laptop-diagnostic.hermes.yaml"
     },
     "packageRows": 0,
     "repairButtons": 0,
     "alerts": [
       "packages/laptop-diagnostic/workflows/missing.hermes.yaml: Declared workflow member is missing."
     ],
     "manifestStillOnDisk": true
   }
   ```

   The first production-module probe used `node --import tsx --input-type=module`, imported `buildPackageCatalog` and `PackageCatalogController`, read the bundled contract/example manifest, supplied synthetic file metadata, refreshed the controller, then attempted `open({packageId:'manifest:'+manifestPath,kind:'artifact',path:manifestPath})`; its callback was never invoked. The browser probe establishes the same defect through App and the real tree render; neither probe exercised native OS I/O.
6. `npx.cmd --no-install vitest run src/app/App.test.ts src/app/App.canvas-authoring.test.ts src/features/inspector/Inspector.test.ts src/features/inspector/ResourceFieldActions.test.ts src/features/inspector/ResourceActionDialog.test.ts src/lib/native/artifact-api.test.ts src/lib/native/package-api.test.ts src/lib/native/git-package-api.test.ts src/lib/git/package-version-actions.test.ts src/lib/recovery/recovery-store.test.ts src/lib/docs/build-index.test.ts tests/project/package-documentation.test.ts --maxWorkers=1 --testTimeout=30000` — **12 files, 237 tests passed**, exit 0, 162.16 seconds. This supplies additional unchanged App/canvas/inspector/recovery/docs consumer and native-bridge regression evidence. Across the two bounded unit selections: **68 files, 656 tests passed**.
7. `npm.cmd run build -- --outDir "$env:TEMP/workflow-review05-dist"`, followed by `node scripts/check-bundle-budget.mjs "$env:TEMP/workflow-review05-dist/.vite/manifest.json"` — both exit 0. Production build transformed 1,115 modules and completed in 8.89 seconds. Bundle gate: **1,400,924 bytes minified / 374,972 bytes gzip**, beneath the unchanged 2,000,000/450,000 limits; cold artifact/editor/documentation/worker boundaries accepted by the checker. Vite emitted plugin-timing, external-output-directory-not-emptied, and ineffective dynamic import warnings for the existing bundled contract manifest import. No dependency/network/install action was performed. This checks the newly built frontend, not an installed native release.
8. Final Git identity and all 18 binding file hashes rechecked: exact candidate commit/tree unchanged, zero hash mismatches, no tracked changes. Only round-05 prompt/report artifacts were untracked. All reviewer runners finished and the exclusive lane was released before report freezing.

No additional full test suite was started. Failed read-only inspection commands caused by a mistyped plan/controller filename and Windows rg glob syntax were corrected using actual paths; these were not product/test failures.
