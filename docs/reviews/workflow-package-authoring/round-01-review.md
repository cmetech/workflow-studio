# Independent adversarial review — round 01

Verdict: **BLOCK**. Severity counts: **0 Critical, 6 Important, 0 Minor**.

This verdict blocks acceptance on concrete defects. It is not a claim that every line of the 285-path range or every platform interleaving has been exhaustively reviewed; the coverage and declined-to-judge inventory below is part of this verdict.

## Identity and independence

- Feature start: `b79d4b1646cb93b47ddab2bf695fc614caf5814e`.
- Candidate: `8244e8aeda39d7b759a106ca85f5fb5d1cd63193`.
- Candidate tree: `648b99ea6d404ef6844d14c6cf41b376b9ba8060`.
- Read-only upstream source: `3e89c2659b6e9c95a627b8f819ff63a11529d86a`, inspected with `git show`, not its working files.
- `git status --short` showed only the untracked review directory. HEAD/tree matched, and the range's 285 name/status entries matched the binding prompt. All 18 binding SHA-256 entries matched `Get-FileHash` results before substantive review. No scope error was found.
- Required Studio documents were read in the prescribed order. Package/resource contracts, provenance, all package vector families and all resource-resolution vector families were inspected. Authoring-contract reference semantics and relevant corpus cases were additionally inspected.
- No earlier review report, current feature verification receipt, implementation ledger, or explanation of earlier fixes was used to reach these findings. The permitted September 14 baseline final-disposition/release-boundary excerpt was read. Its accepted timing exceptions do not excuse any finding below.
- No production edit, sibling write, dependency installation, network call, Git ref mutation, authored-content execution, or delegation occurred. This report is the only authored repository file. All counterexample payloads remained in memory and were treated as text by production analyzers.

## Findings

### R01-01 — Important — Authenticated command/script bodies bypass workflow reference validation

Candidate locations: `src/features/packages/package-analysis-pure.ts:104` and `:148`; `src/lib/packages/package-references.ts:239`; `src/lib/packages/command-markdown.ts:15`.

The package analyzer validates each definition/companion pair before binding packaged resources. It later analyzes command frontmatter or script syntax, but never validates the bound bodies against the consuming workflow's output-reference rules. `resolvePackageReferences` binds a resource path and records its consumer; it does not pass authenticated body text to the authoring reference validator. A command body containing `$missing.output` is therefore structurally valid Markdown and contributes no blocker.

Production path: Packages → Validate Package → capture exact native inventory → `analyzeCapturedPackage` → definition-only `analyzeWorkflowPair` → resource binding/frontmatter or syntax analysis → readiness → generated package files/local preparation.

Reproduction actually run: start with `examples/packages/command-resources`, omit the old generated `digests.json`, and replace only `commands/summarize.md` with `$missing.output\n`. Run the committed `loadPackageExampleContracts` and `capturePackageExample` helpers. The unchanged baseline returned `ready:true, blockers:[]`; the invalid-body variant also returned **`ready:true, blockers:[]`**.

Pinned agent evidence: `plugins/workflow/dependency_manifest.py` calls `validate_authenticated_resource_references` after obtaining command/named-script bodies. `plugins/workflow/schema.py:2297` validates authenticated bodies using `_validate_v3_static_output_references`, and phase-six scoped rules where applicable. The bundled authoring corpus includes `resource.command-v3-missing`, expecting `output_reference_not_declared_dependency` for a body that references a producer without a declared dependency. This is a static compatibility requirement, not a destination credential/runtime advisory. The demonstrated unknown producer is an even simpler failure.

Impact: Studio marks packages ready and can generate distribution metadata for workflows the pinned compiler rejects. The same missing integration affects dependency, structured-output-path and loop-scope checking in authenticated bodies, although only the command/unknown-producer counterexample was executed here. Named-script and scoped variants are not claimed as independently executed probes.

Missing regression assertion: validate the same resolved body separately for every consuming node/member and assert that invalid references block preparation with consumer and artifact locations; include valid direct-dependency and scoped-body controls.

### R01-02 — Important — Opening a member ignores its manifest-declared companion

Candidate location: `src/app/App.svelte:419`. Relevant consumers: `src/features/packages/package-catalog-controller.ts:100`, `src/lib/workspace/pair-workflows.ts:54`, `src/app/App.svelte:2988` and `:3006`.

`PackageCatalogController.open` correctly supplies the declared companion path, including when the user clicks that companion in the package tree. App names this argument `_companionPath` and ignores it. It finds a conventional Explorer pair by definition path and activates that pair. Explorer pairing derives only `<definition-stem>.hermes.yaml`; `activeContractFor` then chooses the profile using that substituted pair.

Reproduction actually run: take the valid command example, change its manifest member to `{definition:"workflows/command-demo.yaml", companion:"policy/custom.yaml"}`, and move the companion text to that path in the in-memory fixture. Package analysis returned **`ready:true`** and declared `policy/custom.yaml`. Passing the same scan to the production `pairWorkflowFiles` returned **`companionPath:null`** for the definition. Source inspection establishes that App selects this exact conventional entry on either member/companion activation.

Impact: a valid package opens without its actual companion, can select the legacy profile, and cannot edit the companion through the intended workflow surface. If an undeclared conventional companion also exists, App instead opens that unrelated companion. Saving or resource actions can then work against different policy/profile content than package readiness analyzed. The latter variant is a source-derived consequence, not a separately executed browser probe.

This is not an upstream restriction: the package manifest accepts an explicit contained YAML companion path, and the pinned marketplace service loads the member's declared sidecar. Studio's successful analysis of the custom path further demonstrates the internal inconsistency.

Missing regression assertion: App-level activation must use the exact declared companion, including nonconventional paths and an explicit null companion when a conventional-looking undeclared file exists. Assert active text, profile, save destination, and companion-tree navigation.

### R01-03 — Important — Transaction rollback deletes a concurrent in-place edit

Candidate locations: `src-tauri/src/workspace/transaction.rs:578`, `:647`, `:657`, `:666`; `src-tauri/src/workspace/files.rs:2236` and `:1927`.

Installed writes retain file identity but not a hash used by rollback. On failure, rollback calls `transaction_remove` for every installed write. That delegates to `remove_verified_name`, which compares identity and then removes the name; it never verifies that the content is still the transaction's content.

Rigorous invariant counterexample, **not a native test executed in this review**:

1. A valid single-file plan expects `old` containing `A` and writes `B`.
2. Staging completes, the original is moved to its backup, and the staged file is installed at `old`.
3. Another editor opens `old` and writes `C` in place, retaining the installed file identity. This is the ordinary same-file modification already modeled by existing filesystem tests; it does not require a symlink or replacement inode.
4. The post-install hash check at line 579 observes `C != B` and returns `workspace_revision_conflict`.
5. Rollback at line 657 deletes `C` because its file identity still equals the recorded installed identity. The backup `A` is then restored. Recovery remains empty, so the ordinary cause is returned without a recovery record for `C`.

The existing `apply_with_hook` seam provides a deterministic regression recipe: for this one-write/no-move/no-new-directory plan, write `C` with `fs::write` in hook step 2 and return `Ok(())`; step 0 is the pre-mutation hook, step 1 is original backup, step 2 is installation. Then inspect bytes and error/path results. No source was modified to add this test. Existing `transaction_reports_recovery_when_external_file_blocks_rollback` instead creates a different file at the vacated original name and does not cover this interleaving.

Production path: `workspace_apply_transaction` or generated-file replacement → `apply_verified` → installation → a failing postcondition → rollback. A filesystem error after the concurrent write produces the same removal behavior.

Impact: an error can silently destroy another process's saved user content despite revision checking. Retaining file identity is insufficient authority to delete changed bytes.

Missing regression assertion: under the described same-identity write, preserve `C` and preserve/report the original backup if restoration cannot complete safely. Assert both payloads survive and recovery paths are actionable. Exact OS scheduling/locking behavior beyond this source invariant was not exercised.

### R01-04 — Important — Duplicate member workflow names pass package readiness

Candidate locations: `src/features/packages/package-analysis-pure.ts:83` and `:124`; `src/lib/packages/readiness.ts:98` and `:102`.

Members are validated independently and membership paths are checked for uniqueness, but no package-wide workflow-name uniqueness check is performed. Two valid files with distinct manifest paths and the same workflow `name` remain ready.

Reproduction actually run: duplicate the command example's definition and companion as `workflows/second.yaml` and `workflows/second.hermes.yaml`; add the second member to the manifest without changing the copied definition's `name: command-demo`. Keep the shared command once. `capturePackageExample` returned **`ready:true, blockers:[]`**.

Pinned agent evidence: `plugins/workflow/marketplace/service.py`, `_assess_distribution`, captures all member sources with `WorkflowCatalogSnapshot.capture(sources)` and explicitly fails `package_workflow_invalid` when `snapshot.ambiguous_names` is nonempty, with “package contains ambiguous workflow names.” `plugins/workflow/compilation.py` groups same-precedence sources by name. This check occurs before compiling each member; it is not a runtime destination limitation.

Production path: Add Workflow/import or hand-authored manifest → whole-package Validate/Prepare → independent member analyses → ready. The duplicate-path checks do not address the distinct-path/same-name case.

Impact: an ordinary multi-workflow package can be marked ready and locally prepared despite deterministic rejection by the pinned marketplace assessment.

Missing regression assertion: two distinct members with the same accepted catalog name block package readiness, while distinct names sharing the same packaged resource remain valid. Apply the upstream name-identity semantics, not a newly invented normalization rule.

### R01-05 — Important — Required member removal and artifact rename/remove authoring flows are absent

Candidate locations: `src/features/packages/PackageOverview.svelte:63`, `src/features/packages/PackageTree.svelte`, `src/features/packages/PackageAuthoringDialogs.svelte`, `src/features/packages/package-authoring-controller.ts`, `src/lib/packages/creation.ts:308`.

Binding design §2 explicitly includes safe creation, editing, renaming and removal of package artifacts. §8.4 requires membership changes to accompany successful file operations, and removing a workflow must offer remove-membership-only, trash-pair, and cancel while preserving shared resources. Plan Task 9 explicitly calls for those choices and reference-impact preview before artifact rename/trash.

The implemented package tree only opens entries. The overview exposes add/open/validate/prepare actions. Authoring dialogs/controllers implement create/import/add-text/import-artifact; there is no member removal action, no three-choice removal dialog, and no artifact rename/trash plan/reference-impact interaction. The creation plans have empty `trashes`, and repository searches across package UI/controller/domain sources found no alternative removal or rename handler. The move/copy adoption flow **does exist** and is not part of this finding.

Minimal user reproduction, established from the complete package action definitions rather than a browser run: open a package containing two members and a shared script, then attempt to remove one member from package membership while leaving its files, or rename the shared script with a reference-impact preview. Neither action is available. Editing manifest JSON by hand is possible but does not implement the required operation or its trash/cancel alternatives.

Impact: the delivered feature omits explicit supported authoring operations; users must manipulate files/references outside the package workflow. This is a functional scope omission, not merely a missing test or a preference for another menu layout.

Missing regression assertion: exercise all three removal choices, cancellation, shared-resource preservation, membership/file transaction failures, and rename reference-impact preview with actual resulting manifest/resource bytes.

### R01-06 — Important — Preparation UI drops native partial-recovery file locations

Candidate locations: `src/features/packages/prepare-package-controller.ts:34` and `:128`; `src/features/packages/PreparePackageDialog.svelte:124`. Native producer: `src-tauri/src/workspace/transaction.rs:695`. Bridge: `src/lib/native/tauri-bridge.ts:51` and `src/lib/native/types.ts:26`.

On incomplete rollback, Rust returns `workspace_transaction_partial`, a generic message ending “some verified recovery files remain,” and structured `path_results` with the recovery `destination_path`. The Tauri bridge preserves these as `NativeError.pathResults`. The preparation controller's `failure` function extracts only a truncated message and substitutes two generic recovery instructions. The dialog renders only those values. It loses the actual original/destination/status details needed to locate the random backup file.

Reproduction actually run: instantiate the committed `PreparePackageController`, complete validation/review, and make its preparation dependency reject with `NativeError('workspace_transaction_partial', 'Conflict; some verified recovery files remain.', [{relativePath:'packages/demo/digests.json', destinationPath:'packages/demo/.workflow-studio-original-123', status:'partial', message:'Destination changed'}])`. After `prepare`, the published state was exactly:

```json
{"step":"validate","error":{"message":"Conflict; some verified recovery files remain.","recovery":["Inspect saved and generated files before retrying.","Resolve the reported issue, then validate and review a fresh preview."]}}
```

Production path: Prepare preview → generated-file transaction cannot restore an original because a concurrently created destination blocks it → native partial error with recovery backup location → controller → dialog. Existing native rollback tests demonstrate the structured error shape; this review did not execute that Rust fixture. Unlike R01-03, the payload can survive here, but the UI conceals its location.

Impact: users cannot follow the recovery instruction reliably and may retry without knowing which file contains their original data. The binding design explicitly requires partial-recovery details to remain visible.

Missing regression assertion: inject a real-shaped native partial error into preparation and assert the UI displays each affected source and recovery destination, status and bounded reason. Do not flatten this to the generic top-level message.

## Checks and reproductions actually performed

1. Read-only Git identity/status/range inspection and exact SHA-256 checks described above; repeated `git status --short` during review still showed only the review directory.
2. Read-only pinned-source inspections using `git show <pin>:<path>`, including package models/acceptance, compilation/catalog behavior, authenticated-resource validation and compiler/resource binding. No upstream Python module was imported or executed.
3. In-memory Node probes, invoked from this worktree with PowerShell here-strings piped to `C:/Users/ecorell/AppData/Local/loop24/node/node.exe --import tsx --input-type=module`. They imported committed helpers, read bundled fixture bytes and changed copies only. No package payload was executed.
4. Selected existing tests:

```text
npx.cmd --no-install vitest run src/lib/packages/manifest.test.ts src/lib/packages/marketplace-index.test.ts src/lib/packages/resource-resolution.test.ts src/lib/packages/package-references.test.ts src/features/packages/package-analysis.test.ts tests/project/package-contract-parity.test.ts --maxWorkers=1 --testTimeout=30000
```

Actual result: **6 files passed, 99 tests passed**, exit 0, 44.35 seconds. A passing existing suite does not falsify the independent counterexamples.

The first combined Node probe exited 1 only after printing the successful reproductions for R01-01/02/04: the proposed index-newline counterexample was rejected during reconciliation. A separate follow-up exited 0 and established that both `version:"1.0.0\n"` and `tags:["support\n"]` are rejected with `package_index_invalid`, while the control index is accepted. **The index suspicion is withdrawn and is not a finding.** The R01-06 controller probe separately exited 0 and printed the state above.

For reproducibility, the main fixture probe used these committed entry points and transformations:

```ts
const contracts = await loadPackageExampleContracts()
const files = (await readPackageExampleFiles('examples/packages/command-resources'))
  .filter(f => f.path !== 'digests.json')
const example = { id: 'command-resources', title: 'probe', summary: 'probe', readOnly: true, files }
await capturePackageExample(example, contracts) // baseline ready
// R01-01: replace commands/summarize.md text with '$missing.output\n'.
// R01-04: clone both workflows/command-demo.* files as workflows/second.*;
// append that definition/companion member without changing the copied workflow name.
// R01-02: change the member companion to policy/custom.yaml and move its text there;
// compare capture.package.workflows[0].companion with pairWorkflowFiles('w', capture.snapshot.entries).
```

The controller's quiet-browser gate was respected: no runner/probe began until it explicitly released the window. No test thresholds or retry settings were relaxed. The controller's full Windows browser outcome is not counted as independent reviewer execution.

## Coverage inventory and limits

The entire 285-path range was inventoried; review was not restricted to contract fidelity. The following behavioral surfaces were traced across final implementation and relevant callers:

| Surface | Review coverage |
| --- | --- |
| Contracts/provenance/vectors | Package and resource loaders, raw bundled loading, sync tooling, source pins, digest/path/validation/boundary recipes; compiler lookup, admission, discriminator, MCP and filesystem-recipe families; selected existing conformance tests executed. Relevant authoring scanner publication/corpus and pinned agent acceptance read. |
| Package domain | Manifest semantics/unique JSON, Unicode wrapper/path collisions, discovery/nesting, exact-byte digest composition, artifact classification, resource binding/closure, readiness, index reconciliation, creation/import plans, targeted manifest editing and resource actions. |
| Coordinator/state lifecycle | Capture/hash correlation, pure analyzer/worker protocol, catalog activation, authoring sources/controller, resource transaction publication, preparation controller/backend, closed recovery drafts, package/artifact stores and workspace identity barriers. |
| Editors/UI/accessibility | Package tree/overview/inspector/manifest source, creation/import/add dialogs, preparation/diff UI, artifact/editor lifecycle, command preview/frontmatter, binary actions, external-change UI, resource-field dialogs, keyboard/tab/focus logic and return navigation; App package wiring and relevant conventional workflow activation. Static inspection, not a fresh interactive accessibility audit. |
| Native filesystem | Artifact grants/read/write/import/replace/passive-open boundaries, complete package snapshots and revalidation, generated-write authority, multi-file staging/install/rollback, narrow identity primitives and relevant pre-existing workflow file consumers. Reviewed failure and external-edit paths; no new native runner/interleaving execution. |
| Native/local Git | Package context/preview/token/commit paths, index authority guard, raw-object/tree/index operations, filter suppression, hooks/signing policy and relevant unchanged mutation/runner consumers. No remote operation or real-user repository mutation. |
| Offline/docs/examples/release | New guides and navigation/anchor/branding integration, package gallery/copy/capture, command/multi-workflow examples, release resource allowlist/integrity wiring, bundle cold-source grouping, security boundary changes and performance/no-execution test intent. No fresh release build. |

Explicitly **unreviewed or only partially reviewed surfaces**, so this report must not be used as a blanket clean bill of health:

- Generated `src/lib/packages/unicode/workflow-marketplace-casefold.generated.ts` table entries were not independently regenerated or exhaustively compared code point by code point. Wrapper/provenance and representative vector behavior were reviewed. Rust Unicode library compatibility with every Unicode-14 edge case was not independently established.
- `package-lock.json`, `src-tauri/Cargo.lock`, and generated `src-tauri/gen/schemas/{acl-manifests,desktop-schema,windows-schema}.json` were inventoried; dependency/registration changes were inspected, but transitive dependency code and every generated schema field were not audited.
- `src-tauri/resources/setup-integrity-v1.json` and generated example digest files were considered through their loaders/verification wiring and selected tests; their complete installed-resource payload was not independently extracted or rebuilt in this round.
- All changed test paths were inventoried, but not every assertion in every component/native/E2E/installer/security test was read. The six named Vitest files are the only tests executed by this reviewer. Fixture and E2E bootstrap/performance instrumentation code was inspected selectively, not exhaustively.
- Large unchanged application/editor/native implementations were followed at the relevant feature call sites; not every unrelated line of `App.svelte`, workflow document lifecycle, `files.rs`, `git/mutate.rs`, validation/scanner internals, canvas, or native setup/recovery was rereviewed. Relevant App package/resource sections and activation consumers were inspected; this is not whole-application certification.
- Authoring-contract/corpus artifacts had their binding hashes verified and relevant resource-reference/schema behavior inspected; every unrelated authoring conformance case was not individually reread or rerun. The complete package/resource vector families were inspected, but all upstream runtime lookup modes were not executed—Studio explicitly supports the compiler-source subset and fails closed for unsupported origin/include contexts.
- Pinned upstream models/package/resources/compiler/service source was inspected at relevant acceptance and resource paths; the entire upstream repository was not reviewed. No public marketplace install/review/update/runtime flow was run.
- `docs/analysis/2026-09-22-package-resource-resolution-coverage.md`, current feature/interoperability verification receipts, previous review outputs and implementation histories were not used as proof. Current verification receipts and prior findings remained unread before this report was frozen. The upstream-amendment plan was inventoried rather than independently verifying that separate implementation effort. Changes in `docs/verification/version-1-release-acceptance.md` were not accepted as fresh evidence.

## Skipped checks and declined-to-judge claims

- No full suite, lint/typecheck, production build, installer extraction, release signing/integrity run, standalone contract/example CLI sweep, or bundle-budget run was started. The bounded independent probes and focused tests were sufficient to establish BLOCK without occupying the shared machine for duplicate release gates. These gates remain unverified by this reviewer.
- No Rust test or live race injection was run: only the report may be authored, and no new native regression was added. R01-03 is explicitly a source-level invariant counterexample; Windows/macOS/Linux scheduling, link/reparse behavior and OS Trash handoff need focused execution in a subsequent verification window.
- No fresh browser performance/250-node/500-edge timing or screen-reader/keyboard session was run. Existing performance test source and pointer-frame separation were reviewed, but neither the 50 ms requirement nor the allowed baseline timing exceptions were independently remeasured here.
- No network or destination installation was attempted. Windows Studio authoring does not establish native Windows marketplace installation support; descriptor-safe installation/platform limits are upstream/platform boundaries, not automatically Studio defects. No remote availability, trust granting, credential availability or execution success is asserted.
- Static script parsing is not a language compiler or a runtime guarantee. This review did not classify unsupported execution semantics as new defects solely because a parser might accept them. Likewise, explicit unsupported include origins and unsupported resolver contexts are honest fail-closed behavior rather than findings by themselves.
- Potential new-driver Git-configuration races, whole-Unicode normalization equivalence, very large artifact/Trash boundary behavior and all post-publication parent-directory replacement interleavings were not reproduced or fully resolved. They remain **UNVERIFIED concerns**, not additional findings or implicit passes.

Findings were frozen independently on 2026-09-22. No production fix was made in this round.
