# Independent adversarial review 03

Candidate: `bda0d2ca00b60d5228b2b0b023389f5668c3b44f`; tree: `02ee6335d1f21e27982922212f6d9657ba68c221`.
Range: `b79d4b1646cb93b47ddab2bf695fc614caf5814e..bda0d2ca00b60d5228b2b0b023389f5668c3b44f`.
Pinned agent reference: `3e89c2659b6e9c95a627b8f819ff63a11529d86a`.

Verdict: **BLOCK**. Findings: **0 Critical, 3 Important, 1 Minor**. These are Studio feature defects, not upstream exceptions. This review does not certify a release or remote installation. The explicit coverage limits below would also prevent a clean PASS.

## Identity and independence

Initial Git status showed only the untracked round-03 prompt; tracked candidate files were clean. HEAD, tree, and base-to-candidate changed-path inventory matched the assigned prompt. All 18 binding SHA-256 values matched. An independent Node probe compared the two package/resource contracts and both vector files byte-for-byte by SHA-256 against `git show` at the pinned agent commit: all four matched. Final identity was rechecked and `git diff --check` passed. A PowerShell unquoted `HEAD^{tree}` attempt produced an argument error; the quoted retry returned the exact tree above.

No earlier review reports, reconciliations of those reports, progress ledger, or current feature verification receipt were used to reach these findings. Binding specifications, contract reconciliation, plan, and the permitted earlier baseline disposition were inputs. No delegation, network access, dependency installation, authored workflow/script execution, production edits, sibling writes, or Git ref mutation occurred. Only this assigned report was written. Existing runners used disposable test artifacts. The parent granted an exclusive test window; selections ran serially with one worker/thread.

## Findings

### R03-001 — Important — A valid extensionless loop command is treated as an unsupported script

**Location:** `src/features/packages/package-analysis-pure.ts:139`; related classifier `src/lib/packages/artifact-kind.ts:28`.

**Trigger and production chain:** A declared workflow contains `loop.command: review`, and the package contains valid command Markdown at `commands/review`. The exported compiler-source command lookup permits the identity candidate, so this is not limited to `.md` filenames. App Validate/Prepare captures the package, the analysis worker calls `analyzeCapturedPackage`, and resource resolution correctly returns a packaged `loop_command` consumer of `commands/review`. The classifier only recognizes command-directory files with `.md`; the consumer override checks only `r.kind === 'command'`. The loop resource therefore falls through to script-language selection, with no runtime or script suffix, and receives unsupported analysis.

**Observed result:** A benign synthetic package analyzed using the actual pinned loaders and production pure analyzer produced no blockers when its single node used `command: review`. Changing only the node to `loop: { command: review, max_iterations: 2, until: done }` resolved the same file but produced `package_analysis_required` (“A supported runtime is required for static script analysis.”) and `package_artifact_invalid` (“Artifact contains static syntax errors.”). This prevents preparation of an accepted command resource and gives a misleading script error.

**Reproduction:** Run an inline `node --import tsx --input-type=module` probe loading `contracts/archon-2026-07-v6.json` through `loadAuthoringContract`, the two pinned package/resource contracts, and `analyzeCapturedPackage`. Use one manifest member `workflows/demo.yaml` with the explicit Archon companion. Definition: name `demo`, description `Synthetic review probe.`, one node `check`, and the loop above. Resource bytes: `---\ndescription: Review data\n---\nReview supplied data.\n`. Build snapshot entries and SHA-256 hashes from those exact bytes, use null committed/working index state, and analyze. The control node `command: review` has `blockers: []`; the loop has the two blockers above. No command body was executed. Early probe setup attempts using an unnormalized authoring contract and then a definition without the required description were corrected before the controlled comparison; they are not defect evidence.

**Authority:** Pinned `plugins/workflow/resource_rules.py` includes identity command candidates; pinned marketplace service treats both `command` and `loop_command` as command bodies. This is Studio analyzer dispatch divergence, not an upstream Windows traversal limitation.

**Missing regression:** A loop-only reference to extensionless/non-`.md` command Markdown must receive the same body analysis and readiness as an ordinary command reference, including scoped candidates and a resource shared by both consumer kinds. Dispatch should follow the authenticated contract semantics.

### R03-002 — Important — Valid-UTF-8 binary data enters the editable text path

**Location:** `src/app/App.svelte:521`–524; native reader `src-tauri/src/workspace/artifacts.rs:279`; browser reader `src/lib/native/browser-artifacts.ts:103`; editor serialization `src/features/artifacts/TextArtifactEditor.svelte:98`.

**Trigger and production chain:** Select a supporting binary artifact whose bytes happen to be valid UTF-8, for example a `.bin` containing NUL/control bytes. Package selection calls App's artifact opener. It always attempts `artifactController.open(..., 'text')`; the binary metadata/Replace path is reached only when decoding throws `invalid_utf8`. Both native and browser readers equate successful UTF-8 decoding with text. `ArtifactEditor` consequently renders CodeMirror instead of `BinaryArtifactView`. Text edits go through `doc.toString()` into the artifact controller and Save.

**Observed result and reproducible byte probe:** An inline tsx probe constructed `browserArtifacts` with `fixtures/sample.bin` bytes `[0,13,10,1,2,3]`, read it through `workspaceReadTextArtifact`, and initialized the actual CodeMirror `EditorState`. It accepted the bytes as text. Appending `x` and serializing the document yielded `[0,10,1,2,3,120]`: the unrelated embedded CR byte was lost. Output was `acceptedAsText: true`, `readBytes: [0,13,10,1,2,3]`, `afterEditorEdit: [0,10,1,2,3,120]`. No binary was written to the checkout. The native `String::from_utf8` predicate accepts the same sequence, so the dispatch defect is not browser-only.

**Impact:** Such binary resources cannot use the intended metadata/replacement interface and are interpreted as editable text. A subsequent text edit/save can rewrite binary bytes beyond the requested edit. Opening alone did not write or corrupt the file. The package specification explicitly requires managing binary artifacts without interpreting them as text.

**Missing regression:** Open a NUL/control-containing but valid-UTF-8 binary via the real App selection path; assert metadata/Replace UI and absence of the text editor. Replacement must retain exact bytes. Invalid-UTF-8-only fixtures do not cover this case. A content/type-aware binary policy must preserve ordinary UTF-8 text support.

### R03-003 — Important — Add Workflow cannot select noncolliding destination paths

**Location:** `src/features/packages/ImportWorkflowPackageDialog.svelte:29`; fixed blank destinations `src/features/packages/package-authoring-sources.ts:63` and `:69`; flattened example destination `:79`; rejection `src/lib/packages/creation.ts:121`.

**Trigger and production chain:** Create a package from a blank workflow, then choose Add Workflow and another blank workflow. The source builder assigns every blank `workflows/main.yaml` (and the same companion path). The dialog offers a source selector and, for workspace sources, copy/move; it has no destination controls and submits the selected source unchanged. The controller admits the offered source identity and calls `planWorkflowImport`, which correctly rejects the already-declared definition path. Most ordinary gallery examples similarly flatten to `workflows/workflow.yaml`, so adding a second such example collides even when its source identity differs.

**Observed result:** An independent inline tsx probe invoked `planWorkflowImport` using an existing manifest member at the built-in blank paths and the same blank source paths. It returned `package_member_duplicate`, “This workflow is already a package member.” Reading the complete dialog and source builder establishes that the production UI cannot change those destinations. The collision guard itself is correct; the authoring UI supplies no way to satisfy it during this operation.

**Impact:** The common multi-workflow creation flow stops after the first blank or colliding example. Renaming the first member separately can work around the issue, but Add Workflow cannot perform the promised operation with chosen unique paths. `docs/app-guides/multiple-workflows-per-package.md:5` expressly instructs users to choose destinations such as `workflows/diagnose.yaml` and `workflows/report.yaml`; those controls do not exist.

**Missing regression:** Starting with a blank-created package, add a second blank with a distinct definition/companion destination; add two distinct gallery examples with identical source basenames. Verify both members, distinct workflow names as required by readiness, exact transaction preview, preserved source identities, and collision/revision rejection without having to move the original member first.

### R03-004 — Minor — Command References always reports no consumers in the actual App

**Location:** `src/app/App.svelte:4078` (artifact editor props); defaults `src/features/artifacts/ArtifactEditor.svelte:27`, `src/features/artifacts/CommandEditor.svelte:24`; false empty statement `CommandEditor.svelte:85`.

**Trigger and complete invariant argument:** Open a referenced command, for example the bundled laptop package's `commands/interpret-report.md`, and choose References. App's entire `loadArtifactEditor` props object supplies the document, metadata, command flag, callbacks and focus request, but never supplies `references`. `ArtifactEditor` defaults that prop to `[]` and forwards it to `CommandEditor`. Nothing in either component derives package references. Therefore the branch necessarily renders “No workflow references this command.” even for the known consumer. Static inspection establishes the result without relying on an unexecuted browser assertion.

**Impact:** The shipped reference-inspection surface gives a false result and hides consumers users need to inspect before changing shared resources. Resolver tests and component tests that inject references do not establish that the App supplies them. Native mutation safeguards may still reject unsafe deletion; this finding does not allege those safeguards are bypassed.

**Missing regression:** Open a known referenced command through App, select References, and assert its workflow/node consumer appears. Recheck after a YAML reference edit and switching packages with similarly named artifacts, to cover refresh and isolation.

## Coverage inventory

The review covered the whole feature, with extra attention to authoring/recovery rather than limiting itself to that emphasis:

| Surface | Production/evidence inspected and conclusions |
| --- | --- |
| Contract authority and interoperability | Binding design/plan/reconciliation, pinned provenance/contracts, all shared vector families (package digest/path/validation/boundary and resource admission/compilation/discriminator/filesystem/lookup/MCP), loaders and parity selection; selected pinned upstream resolver/marketplace source. Contract/vector bytes match the pin. Actual remote install and destination trust were not exercised. |
| Catalog, manifest and workflow membership | Discovery, manifest parse/edit, explicit companion activation, creation/import source generation, authoring controller, copy/move/remove and dialogs. Fixed destination collision is R03-003. Existing workflow pairing and YAML controller gates were traced as unchanged consumers. |
| Resources and syntax-preserving actions | References, authenticated references, contract lookup, runtime discrimination, create/select/extract, rename/trash mutations, YAML transaction guards and readiness. Checked root/scoped resolution, inline source preservation, unknown/ambiguous references, external advisories and stale snapshots. Loop-only command dispatch is R03-001. |
| Artifacts, drafts and UI | Artifact session/controller/store, manifest/text/command/binary editors, save/external-change/recovery flow, App selection and flush callbacks, package switching and generation checks. Invalid drafts remain separate from saved valid YAML; binary routing and missing reference props are R03-002/004. |
| Hashes, paths and preparation | Exact-byte digest and index modules; bounded snapshot capture, Unicode/collision/path/link checks; preparation backend, source tokens, generated-file writer and conflict guards. Readiness is based on complete snapshots rather than ordinary discovery. |
| Native mutation and recovery | Artifact read/write/import/grants, package capture, transaction publication/rollback, generated-file writes, transaction recovery entry points and recovery UI. Selected real-filesystem tests exercised races, rollback and explicit partial outcomes. Not all OS-specific error branches were independently induced. |
| Local Git | Package context/preview/commit, exact path staging, runner arguments, filter guard, shared-index structural guard and commit index handling; all 13 native package Git tests ran against real temporary repositories. Reviewed selected-package index ownership and unrelated state preservation. No remote action ran. |
| Execution boundary | Native opener restrictions, package bridge surfaces, static-only analyzers, preview sanitation, Git hooks/filters/signing restrictions, package no-execution tests and security documentation. No authored content was executed. General pre-existing selected-agent contract-export invocation is separate from package execution. |
| Offline/product quality | Package examples and bundled guides, sanitized Markdown, resource manifest/bundle script, modal/tab keyboard/focus code, package tree/inspector/overview/editor views and lazy analysis worker. Selected tests cover docs/assets and the 250-node/500-edge pointer-work boundary. This is not a real-browser frame-time or screen-reader certification. |

## Commands and observed verification

All commands used the candidate worktree. Node was the configured `C:/Users/ecorell/AppData/Local/loop24/node` toolchain. No tests were run concurrently with native checks/builds; parent only retained an idle Vite server.

1. `git status --short`, `git rev-parse HEAD 'HEAD^{tree}'`, base-to-candidate path inventory, 18 `Get-FileHash -Algorithm SHA256` binding comparisons, and four inline Node pinned-object hash comparisons: identities matched. `git diff --check`: passed.
2. `npx.cmd --no-install vitest run src/features/artifacts/artifact-workspace-controller.test.ts src/features/packages/package-authoring-controller.test.ts src/features/packages/package-preparation.test.ts src/features/packages/resource-action-coordinator.test.ts src/lib/packages/package-mutations.test.ts src/lib/packages/resource-actions.test.ts src/lib/packages/resource-resolution.test.ts src/lib/packages/digest.test.ts tests/project/package-contract-parity.test.ts tests/project/package-no-execution.test.ts --maxWorkers=1 --testTimeout=30000`: **10 files, 129 tests passed**, 92.18 seconds.
3. `cargo test --offline --manifest-path src-tauri/Cargo.toml workspace::package_mutation_tests -- --test-threads=1`: **9 passed**, 36.41 seconds test duration. Existing platform-unused import/variable warnings were emitted.
4. An initial mistaken Rust filter `git::package_tests` selected **0 tests** and supplies no coverage. Corrected command `cargo test --offline --manifest-path src-tauri/Cargo.toml git::tests::package_tests -- --test-threads=1`: **13 passed**, 463.70 seconds. Covered automatic context/status/history, membership changes, concurrent HEAD/index, exact commit preservation, filter/hook/signer suppression, literal paths, foreign-index rejection, absent repository/no-op, shared-index ambiguity, unborn identity/commit and whole-package deletion.
5. Independent inline production-module probes: command versus loop-command comparison, valid-UTF-8 binary/CodeMirror byte comparison, and duplicate blank import. Outcomes are recorded with the findings. The References finding is a complete props/default invariant, not a claimed browser run.
6. `npx.cmd --no-install vitest run src/app/App.resource-navigation.test.ts src/features/packages/PackageAuthoringDialogs.test.ts src/features/packages/PackageTree.test.ts src/features/packages/PackageManifestEditor.test.ts src/features/packages/package-analysis-client.test.ts tests/project/package-performance.test.ts tests/project/package-documentation.test.ts tests/project/resource-boundary.test.ts src/lib/docs/render-markdown.test.ts src/lib/examples/package-examples.test.ts --maxWorkers=1 --testTimeout=30000`: **10 files, 37 tests passed**, 100.31 seconds. Combined TypeScript selections: **20 files, 166 tests passed**; selected native tests: **22 passed**. No test timeout or timing threshold was relaxed.

## Skipped checks and residual limits

No full Vitest/Rust suites were started; the prompt specifically calls for bounded selections. No browser server was started and no Playwright/native GUI, actual clipboard/dialog/file-association behavior, screen-reader, reduced-motion visual observation, or wall-clock canvas frame benchmark was run. The pointer-boundary unit fixture is not evidence of browser frame timing. No `check`, lint, full build, bundle-budget, installer extraction, signing/update, or full release-assets command was independently run in this round. Existing generated build output was not accepted as fresh evidence. Full dependency/lockfile changes and unrelated release infrastructure were not exhaustively audited. Some large plan/foundation and native recovery/helper files were inspected by relevant sections rather than line-by-line; this report makes no exhaustive line-audit claim.

Windows was the only executed host. Unix-only symlink/mode branches, macOS Trash behavior, hostile reparse-point interleavings outside the selected Windows tests, process-kill/power-loss durability, and installer clean-machine behavior remain unverified. Static pinned-agent source and shared vectors establish reviewed semantic agreement only; no public agent install, remote acquisition, actual compilation execution, credential use, or destination trust operation was performed. Do not infer those outcomes from the green Studio tests. The earlier baseline exceptions do not waive these new feature defects or these release evidence gaps.

Report frozen after the final selected test results, before accessing any prior-round findings or implementer responses. Candidate production files were unchanged.
