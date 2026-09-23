# Adversarial package review 04

You are an adversarial principal-level reviewer of TypeScript/Svelte, Rust/Tauri, YAML syntax-preserving editors, filesystem transactions, local Git, package integrity, accessibility, and offline release packaging. Try to falsify the implementation's claims. Treat test names, checklist completion, commit subjects, green CI, and prior review verdicts as unproved. Do not redesign the product or report personal preference as a defect.

### Immutable scope

- Round: `04`
- Round emphasis: `Local Git and marketplace handoff: exact selected paths, unrelated staged/dirty packages, shared-index consistency, SemVer precedence, repeat preparation, no remote side effects, independently verified agent compatibility and separate trust.`
- Repository/worktree: `C:/Users/ecorell/Developer/work/cmetech/github.com/cmetech/workflow-studio/.worktrees/workflow-package-authoring`
- Feature-start commit: `b79d4b1646cb93b47ddab2bf695fc614caf5814e`
- Candidate commit: `cf1fe25bee98369ed138b8f5dd2206cd830ed4d1`
- Candidate tree: `2220a282762e90394f0a94e2c4612d62f756b18f`
- Read-only agent reference commit: `3e89c2659b6e9c95a627b8f819ff63a11529d86a`
- Review range: `b79d4b1646cb93b47ddab2bf695fc614caf5814e..cf1fe25bee98369ed138b8f5dd2206cd830ed4d1`
- Changed-path inventory and document/artifact checksums: `inventory and SHA-256 table below`
- Required report: `docs/reviews/workflow-package-authoring/round-04-review.md`

Begin with Git status and verify candidate commit/tree/range and the binding checksums. The candidate's tracked files must be clean. Prompt/report artifacts are not production changes. A mismatch is SCOPE ERROR: report it without repairing the checkout or silently reviewing another revision. Review final files and relevant unchanged consumers, not just hunks. Record every unreviewed surface; incomplete coverage cannot receive PASS.

### Independence and permissions

Reach and freeze your findings before reading earlier round reports, reconciliations, progress ledgers, or implementer explanations of fixes. Binding specifications and the plan are required inputs. Use benign synthetic files, repositories, workflows, and credentials in temporary directories for bounded probes. No network, real credentials, workflow/script execution, dependency installation, production edits, ref mutation, merge, push, publication, or release actions. Do not modify the sibling agent. Do not delegate further. Only write your assigned report; test-runner disposable outputs must remain outside production files.

### Binding sources

Read applicable `AGENTS.md` instructions and these Studio documents in order:

1. `docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md`
2. `docs/superpowers/specs/2026-07-25-workflow-studio-design.md`
3. `docs/superpowers/specs/2026-09-03-workflow-package-authoring-and-local-publishing-design.md`
4. `docs/analysis/2026-09-22-workflow-package-marketplace-contract-reconciliation.md`
5. `docs/superpowers/plans/2026-09-03-workflow-package-authoring-local-publishing.md`
6. Pinned package and authoring contracts, provenance, and all shared vector families.

Use pinned agent source as read-only evidence for package acceptance and resource semantics. Explicitly distinguish feature defects, pre-existing upstream limitations, and unverified platform assumptions. Never infer that remote installation works from Studio unit tests alone.

### Non-negotiable invariants

- YAML is the only workflow graph authority; targeted edits preserve unrelated syntax and fields, and visual operations preserve DAG validity.
- Package manifests declare membership/metadata, not an alternate execution model. No invented runtime or independent resolver field inventory.
- Hash exact bytes under contract rules; include all eligible supporting files. Reject unsafe paths, collisions, stale identities, and out-of-budget inputs.
- Failed or racing writes cannot silently lose user data or leave apparently valid mixed-version generated artifacts.
- Local Git preparation preserves unrelated index/worktree state and never accesses a remote or treats a local commit as confirmed publication.
- Studio never executes package content, installs dependencies, or grants agent trust. Invalid artifact drafts remain recoverable; standalone YAML gates stay intact.
- UI copy uses loop24 while technical identifiers, filenames, YAML, and diffs remain accurate.
- Offline assets, keyboard access, focus, reduced motion, bounded analysis, and the existing canvas performance contract are release requirements.

### Evidence and required output

For each finding provide: stable ID, Critical/Important/Minor severity, exact candidate file/line, realistic trigger and complete production path, observed wrong result/user impact, minimal reproduction or rigorous invariant argument, commands and actual results, and the missing regression assertion. Separate demonstrated defects from UNVERIFIED concerns. Do not equate a missing test with a demonstrated defect.

The report must contain candidate identity, verdict (`PASS`, `BLOCK`, or `INCOMPLETE`), severity counts, coverage inventory, findings, tests/probes actually run with outcomes, skipped checks with reasons, and residual risks. A clean verdict must identify the boundaries and interleavings checked. Do not modify code to make a probe pass. Stop only after covering the full assigned scope, not after the first finding.

## Verification commands and local reference

- Node path: `C:/Users/ecorell/AppData/Local/loop24/node`; use `npm.cmd` and `npx.cmd` on Windows.
- Read-only upstream checkout: `C:/Users/ecorell/Developer/work/cmetech/github.com/cmetech/hermes-agent-resource-contract`. Read production files at the pinned commit with `git show`; its working HEAD includes later documentation only.
- Relevant commands: `npm.cmd run check`, `npm.cmd run lint`, `npm.cmd run contracts:check`, `npm.cmd run package-contracts:check`, `npm.cmd run examples:check`, `npm.cmd run resources:verify`, `npm.cmd run build`, `npm.cmd run bundle:check`.
- Bounded unit probes: `npx.cmd --no-install vitest run <specific test files> --maxWorkers=1 --testTimeout=30000`. Do not start an additional full suite; report exact selected probes and results.
- Bounded Rust probes: `cargo test --manifest-path src-tauri/Cargo.toml <specific filter> -- --test-threads=1`. Identify platform exclusions explicitly.
- Browser verification uses the repository CI timeout profile, one worker, and zero retries. Coordinate with the parent before starting a browser server or timing-sensitive probe. No timing thresholds may be relaxed.
- The round emphasis is not a scope restriction. Cover the full feature and relevant unchanged callers; be explicit about any unreviewed surface. Freeze the report before asking for prior findings or implementer explanations.

- Baseline scope: read only the final disposition and release boundary of `docs/verification/2026-09-14-windows-primary-stabilization.md` for previously accepted user exceptions. These do not permit new regressions or new waivers. The current feature verification receipt is an implementer explanation: do not read it before freezing your independent report.
- Request an exclusive test window before any test runner, build, browser, or CPU-heavy probe so verification remains coordinated. Begin with bounded read-only file and Git inspection. Do not infer that an earlier gate applies to this candidate; report the exact checks you run.

## Binding SHA-256 inventory

| File | SHA-256 |
| --- | --- |
| `AGENTS.md` | `a7f4073ff9b9cfb35363d675845a7782e82349af9e9fc28dff5e03d6bc9c3842` |
| `docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md` | `d427b752b63388f84bbfaef307d829162c8beaedf4a6779bae19a2a1a973608f` |
| `docs/superpowers/specs/2026-07-25-workflow-studio-design.md` | `1068e0cfdeac4d0a6d21e5337b6e94ce769f4b549097a2553b812235ca49bcc0` |
| `docs/superpowers/specs/2026-09-03-workflow-package-authoring-and-local-publishing-design.md` | `f0944dd3f80ca13b0c3683dea21cf6e456266e668fa17600989df19e0fa5a4fb` |
| `docs/analysis/2026-09-22-workflow-package-marketplace-contract-reconciliation.md` | `6b181bba39301a402765a0ad1a401d99e4f571ae51cdc2b8e2bc000b69421630` |
| `docs/superpowers/plans/2026-09-03-workflow-package-authoring-local-publishing.md` | `90c0b8f117470ee3aeb27025850fedb7e16c0f7f8e4f200fd394304c64a407bd` |
| `docs/reviews/2026-09-22-workflow-package-authoring-adversarial-review-prompt.md` | `e804b7ac36d7c520ff34e69022347eb6a57cc98629518ce4e0a212a14cd9adb5` |
| `docs/verification/2026-09-14-windows-primary-stabilization.md` | `f40ac29dbb48fe61905eaae5b455580a6ac770c60744d05f94c9aac2e6c53190` |
| `contracts/archon-2026-07-v6.corpus.json` | `e05802457acfc4d3e05ec7601e2ab821a47c689bd0eac1fb04da6fb9e4452ecb` |
| `contracts/archon-2026-07-v6.json` | `2f04e90bc70fc8d3e6100d1badbe655ea63d59ba06f350f083c9734bc8a2b770` |
| `contracts/hermes-legacy-v2.corpus.json` | `1c48b9f28fde6bcaa6761b23b57b03ec6309b9ea5404bf26c6075c6d1a115ee9` |
| `contracts/hermes-legacy-v2.json` | `437703ed8a23ee4d8fb6bfc05c2bd0b3450dfa67e8d3044c8077e8842d58bc41` |
| `contracts/manifest.json` | `3cd392306c45e66b26df2671853e9e02ff73c59be0c68087a002bea0dcdfaf8b` |
| `contracts/workflow-package-provenance.json` | `8eba4e7caef978fe92fe968003720f24d87ab23eec58fcba63777346d436b3ef` |
| `contracts/workflow-package-resource-resolution-v1-vectors.json` | `0dd7dbb7573ffc3f4e9fa6f9791b1393486481cfaad1ee0c52c5c86d91420ae7` |
| `contracts/workflow-package-resource-resolution-v1.json` | `edf34f7fd0e06d5d8f5b2f6b90d3686a50c73253d796372f5df424748e364e68` |
| `contracts/workflow-package-v1-vectors.json` | `644055e4234837f3e42ccaa952ed1622cf67edc96db69e983556580fb6ce82ed` |
| `contracts/workflow-package-v1.json` | `e728d99608e9186a08fc2b866cdaa9f116d8f51c5cde68930a82ef79d398e30d` |

## Changed paths

```text
M	.prettierignore
M	contracts/README.md
A	contracts/workflow-package-provenance.json
A	contracts/workflow-package-resource-resolution-v1-vectors.json
A	contracts/workflow-package-resource-resolution-v1.json
A	contracts/workflow-package-v1-vectors.json
A	contracts/workflow-package-v1.json
A	docs/analysis/2026-09-22-package-resource-resolution-coverage.md
A	docs/analysis/2026-09-22-workflow-package-marketplace-contract-reconciliation.md
A	docs/app-guides/command-resources.md
A	docs/app-guides/coworker-package-installation.md
A	docs/app-guides/creating-a-package.md
A	docs/app-guides/mcp-and-supporting-resources.md
A	docs/app-guides/multiple-workflows-per-package.md
A	docs/app-guides/package-folder-structure.md
A	docs/app-guides/package-readiness.md
A	docs/app-guides/package-troubleshooting.md
A	docs/app-guides/package-versions-digests-trust.md
A	docs/app-guides/packaged-and-external-requirements.md
A	docs/app-guides/preparing-packages.md
M	docs/app-guides/problems-and-validation.md
A	docs/app-guides/publishing-packages-with-git.md
M	docs/app-guides/quick-start.md
A	docs/app-guides/script-resources.md
A	docs/app-guides/updating-packages.md
A	docs/app-guides/workflow-packages.md
A	docs/reviews/2026-09-22-workflow-package-authoring-adversarial-review-prompt.md
A	docs/reviews/workflow-package-authoring/round-01-prompt.md
A	docs/reviews/workflow-package-authoring/round-01-reconciliation.md
A	docs/reviews/workflow-package-authoring/round-01-review.md
A	docs/reviews/workflow-package-authoring/round-02-prompt.md
A	docs/reviews/workflow-package-authoring/round-02-reconciliation.md
A	docs/reviews/workflow-package-authoring/round-02-review.md
A	docs/reviews/workflow-package-authoring/round-03-prompt.md
A	docs/reviews/workflow-package-authoring/round-03-reconciliation.md
A	docs/reviews/workflow-package-authoring/round-03-review.md
M	docs/security.md
M	docs/superpowers/plans/2026-09-03-workflow-package-authoring-local-publishing.md
A	docs/superpowers/plans/2026-09-22-upstream-package-resource-contract-amendment.md
M	docs/superpowers/specs/2026-09-03-workflow-package-authoring-and-local-publishing-design.md
A	docs/verification/2026-09-22-package-marketplace-interop.md
A	docs/verification/2026-09-22-workflow-package-authoring.md
M	docs/verification/version-1-release-acceptance.md
A	examples/packages/catalog.yaml
A	examples/packages/command-resources/commands/summarize.md
A	examples/packages/command-resources/digests.json
A	examples/packages/command-resources/workflow-package.json
A	examples/packages/command-resources/workflows/command-demo.hermes.yaml
A	examples/packages/command-resources/workflows/command-demo.yaml
A	examples/packages/external-requirements/digests.json
A	examples/packages/external-requirements/workflow-package.json
A	examples/packages/external-requirements/workflows/external-tool.hermes.yaml
A	examples/packages/external-requirements/workflows/external-tool.yaml
A	examples/packages/laptop-diagnostic/commands/interpret-report.md
A	examples/packages/laptop-diagnostic/digests.json
A	examples/packages/laptop-diagnostic/fixtures/laptop-snapshot.json
A	examples/packages/laptop-diagnostic/scripts/analyze-snapshot.py
A	examples/packages/laptop-diagnostic/scripts/render-report.py
A	examples/packages/laptop-diagnostic/workflow-package.json
A	examples/packages/laptop-diagnostic/workflows/laptop-diagnostic.hermes.yaml
A	examples/packages/laptop-diagnostic/workflows/laptop-diagnostic.yaml
A	examples/packages/multi-workflow-support/digests.json
A	examples/packages/multi-workflow-support/scripts/shared-support.py
A	examples/packages/multi-workflow-support/workflow-package.json
A	examples/packages/multi-workflow-support/workflows/collect-bundle.hermes.yaml
A	examples/packages/multi-workflow-support/workflows/collect-bundle.yaml
A	examples/packages/multi-workflow-support/workflows/diagnose.hermes.yaml
A	examples/packages/multi-workflow-support/workflows/diagnose.yaml
M	package-lock.json
M	package.json
M	scripts/check-bundle-budget.mjs
M	scripts/sync-contracts.test.ts
A	scripts/sync-package-contracts.test.ts
A	scripts/sync-package-contracts.ts
M	scripts/validate-examples.ts
A	scripts/validate-package-examples.test.ts
A	scripts/validate-package-examples.ts
M	scripts/verify-release-assets.mjs
M	src-tauri/Cargo.lock
M	src-tauri/Cargo.toml
M	src-tauri/gen/schemas/acl-manifests.json
M	src-tauri/gen/schemas/desktop-schema.json
M	src-tauri/gen/schemas/windows-schema.json
M	src-tauri/resources/setup-integrity-v1.json
A	src-tauri/src/git/filter_guard.rs
M	src-tauri/src/git/mod.rs
M	src-tauri/src/git/mutate.rs
A	src-tauri/src/git/package.rs
A	src-tauri/src/git/package_index.rs
A	src-tauri/src/git/package_tests.rs
M	src-tauri/src/git/runner.rs
M	src-tauri/src/git/tests.rs
M	src-tauri/src/lib.rs
A	src-tauri/src/workspace/artifact_write_tests.rs
A	src-tauri/src/workspace/artifacts.rs
M	src-tauri/src/workspace/files.rs
A	src-tauri/src/workspace/generated_write.rs
M	src-tauri/src/workspace/mod.rs
A	src-tauri/src/workspace/package_hash.rs
A	src-tauri/src/workspace/package_mutation_tests.rs
M	src-tauri/src/workspace/tests.rs
A	src-tauri/src/workspace/transaction.rs
A	src-tauri/src/workspace/transaction_recovery.rs
M	src-tauri/tests/git_integration.rs
M	src/app/ActivityRail.svelte
M	src/app/ActivityRail.test.ts
M	src/app/App.canvas-authoring.test.ts
M	src/app/App.companion-contract-readiness.test.ts
A	src/app/App.resource-navigation.test.ts
M	src/app/App.svelte
M	src/app/App.test.ts
M	src/app/StatusBar.svelte
M	src/e2e/bootstrap.ts
A	src/e2e/package-performance-fixture.ts
A	src/e2e/package-scenarios.ts
A	src/features/artifacts/ArtifactEditor.svelte
A	src/features/artifacts/ArtifactEditor.test.ts
A	src/features/artifacts/ArtifactExternalChangeDialog.svelte
A	src/features/artifacts/ArtifactExternalChangeDialog.test.ts
A	src/features/artifacts/BinaryArtifactView.svelte
A	src/features/artifacts/BinaryArtifactView.test.ts
A	src/features/artifacts/CommandEditor.svelte
A	src/features/artifacts/CommandEditor.test.ts
A	src/features/artifacts/CommandPreview.svelte
A	src/features/artifacts/CommandPreview.test.ts
A	src/features/artifacts/TextArtifactEditor.svelte
A	src/features/artifacts/TextArtifactEditor.test.ts
A	src/features/artifacts/artifact-editor-extensions.test.ts
A	src/features/artifacts/artifact-editor-extensions.ts
A	src/features/artifacts/artifact-workspace-controller.test.ts
A	src/features/artifacts/artifact-workspace-controller.ts
A	src/features/artifacts/static-diagnostics.test.ts
A	src/features/artifacts/static-diagnostics.ts
M	src/features/documentation/DocumentationArticle.svelte
M	src/features/documentation/DocumentationOverview.test.ts
M	src/features/documentation/DocumentationView.svelte
M	src/features/documentation/DocumentationView.test.ts
M	src/features/examples/ExampleGallery.svelte
M	src/features/examples/ExampleGallery.test.ts
M	src/features/inspector/Inspector.svelte
M	src/features/inspector/Inspector.test.ts
A	src/features/inspector/ResourceActionDialog.svelte
A	src/features/inspector/ResourceActionDialog.test.ts
A	src/features/inspector/ResourceFieldActions.svelte
A	src/features/inspector/ResourceFieldActions.test.ts
A	src/features/packages/CreatePackageDialog.svelte
A	src/features/packages/CreatePackageDialog.test.ts
A	src/features/packages/ImportWorkflowPackageDialog.svelte
A	src/features/packages/ImportWorkflowPackageDialog.test.ts
A	src/features/packages/PackageAuthoringDialogs.svelte
A	src/features/packages/PackageAuthoringDialogs.test.ts
A	src/features/packages/PackageChangeList.svelte
A	src/features/packages/PackageChangeList.test.ts
A	src/features/packages/PackageInspector.svelte
A	src/features/packages/PackageInspector.test.ts
A	src/features/packages/PackageManifestEditor.svelte
A	src/features/packages/PackageManifestEditor.test.ts
A	src/features/packages/PackageMutationDialog.svelte
A	src/features/packages/PackageMutationDialog.test.ts
A	src/features/packages/PackageOverview.svelte
A	src/features/packages/PackageOverview.test.ts
A	src/features/packages/PackageReadiness.svelte
A	src/features/packages/PackageReadiness.test.ts
A	src/features/packages/PackageTree.svelte
A	src/features/packages/PackageTree.test.ts
A	src/features/packages/PackageWorkflowPicker.svelte
A	src/features/packages/PackageWorkflowPicker.test.ts
A	src/features/packages/PreparePackageDialog.svelte
A	src/features/packages/PreparePackageDialog.test.ts
A	src/features/packages/TransactionRecoveryDetails.svelte
A	src/features/packages/package-analysis-client.test.ts
A	src/features/packages/package-analysis-client.ts
A	src/features/packages/package-analysis-pure.ts
A	src/features/packages/package-analysis-worker.ts
A	src/features/packages/package-analysis.test.ts
A	src/features/packages/package-analysis.ts
A	src/features/packages/package-authoring-controller.test.ts
A	src/features/packages/package-authoring-controller.ts
A	src/features/packages/package-authoring-sources.ts
A	src/features/packages/package-catalog-controller.test.ts
A	src/features/packages/package-catalog-controller.ts
A	src/features/packages/package-drafts.test.ts
A	src/features/packages/package-drafts.ts
A	src/features/packages/package-preparation.test.ts
A	src/features/packages/package-preparation.ts
A	src/features/packages/package-semantic-readiness.test.ts
A	src/features/packages/prepare-package-controller.test.ts
A	src/features/packages/prepare-package-controller.ts
A	src/features/packages/prepare-package-view.ts
A	src/features/packages/resource-action-coordinator.test.ts
A	src/features/packages/resource-action-coordinator.ts
A	src/lib/artifacts/artifact-session.test.ts
A	src/lib/artifacts/artifact-session.ts
A	src/lib/artifacts/types.ts
M	src/lib/commands/registry.ts
M	src/lib/commands/types.ts
M	src/lib/contract/bundled-contracts.ts
M	src/lib/docs/build-index.test.ts
M	src/lib/docs/navigation.test.ts
M	src/lib/docs/navigation.ts
M	src/lib/docs/render-markdown.test.ts
M	src/lib/docs/render-markdown.ts
M	src/lib/docs/types.ts
M	src/lib/examples/load-examples.ts
A	src/lib/examples/package-example-analysis.ts
A	src/lib/examples/package-examples.test.ts
A	src/lib/examples/package-examples.ts
M	src/lib/examples/types.ts
M	src/lib/git/git-api.ts
A	src/lib/git/package-version-actions.test.ts
A	src/lib/git/package-version-actions.ts
M	src/lib/git/types.ts
A	src/lib/native/artifact-api.test.ts
A	src/lib/native/browser-artifacts.ts
M	src/lib/native/browser-bridge.ts
A	src/lib/native/browser-package-facilities.ts
A	src/lib/native/browser-package-loading.test.ts
A	src/lib/native/browser-packages.ts
A	src/lib/native/git-package-api.test.ts
A	src/lib/native/package-api.test.ts
M	src/lib/native/tauri-bridge.ts
A	src/lib/native/transaction-recovery.test.ts
A	src/lib/native/transaction-recovery.ts
M	src/lib/native/types.ts
M	src/lib/native/workspace-api.test.ts
A	src/lib/package-contract/bundled-package-contract.ts
A	src/lib/package-contract/package-contract-loader.test.ts
A	src/lib/package-contract/package-contract-loader.ts
A	src/lib/package-contract/resource-contract-loader.test.ts
A	src/lib/package-contract/resource-contract-loader.ts
A	src/lib/package-contract/types.ts
A	src/lib/packages/artifact-kind.test.ts
A	src/lib/packages/artifact-kind.ts
A	src/lib/packages/authenticated-references.ts
A	src/lib/packages/command-markdown.test.ts
A	src/lib/packages/command-markdown.ts
A	src/lib/packages/creation.test.ts
A	src/lib/packages/creation.ts
A	src/lib/packages/digest.test.ts
A	src/lib/packages/digest.ts
A	src/lib/packages/discovery.test.ts
A	src/lib/packages/discovery.ts
A	src/lib/packages/manifest-edit.test.ts
A	src/lib/packages/manifest-edit.ts
A	src/lib/packages/manifest.test.ts
A	src/lib/packages/manifest.ts
A	src/lib/packages/marketplace-index.test.ts
A	src/lib/packages/marketplace-index.ts
A	src/lib/packages/marketplace-path.ts
A	src/lib/packages/package-fixture.test.ts
A	src/lib/packages/package-mutations-performance.test.ts
A	src/lib/packages/package-mutations.test.ts
A	src/lib/packages/package-mutations.ts
A	src/lib/packages/package-references.test.ts
A	src/lib/packages/package-references.ts
A	src/lib/packages/paths.test.ts
A	src/lib/packages/paths.ts
A	src/lib/packages/preparation.test.ts
A	src/lib/packages/preparation.ts
A	src/lib/packages/readiness.test.ts
A	src/lib/packages/readiness.ts
A	src/lib/packages/resource-actions.test.ts
A	src/lib/packages/resource-actions.ts
A	src/lib/packages/resource-resolution.test.ts
A	src/lib/packages/resource-resolution.ts
A	src/lib/packages/types.ts
A	src/lib/packages/unicode/README.md
A	src/lib/packages/unicode/provenance.json
A	src/lib/packages/unicode/workflow-marketplace-casefold.generated.ts
A	src/lib/packages/unicode/workflow-marketplace-casefold.ts
M	src/lib/recovery/recovery-store.test.ts
M	src/lib/recovery/recovery-store.ts
M	src/lib/recovery/types.ts
M	src/lib/references/reference-index.ts
M	src/lib/validation/analyze-workflow.ts
A	src/stores/artifacts.test.ts
A	src/stores/artifacts.ts
A	src/stores/package-preparation.ts
A	src/stores/packages.test.ts
A	src/stores/packages.ts
M	src/stores/shell.ts
M	tests/e2e/examples-and-docs.spec.ts
A	tests/e2e/package-authoring.spec.ts
A	tests/e2e/package-performance.spec.ts
A	tests/e2e/package-preparation.spec.ts
A	tests/e2e/package-recovery.spec.ts
A	tests/e2e/package-support.ts
M	tests/e2e/workbench-style.spec.ts
M	tests/e2e/workspace-authoring.spec.ts
A	tests/fixtures/workflow-packages/laptop-diagnostic/commands/interpret-report.md
A	tests/fixtures/workflow-packages/laptop-diagnostic/fixtures/laptop-snapshot.json
A	tests/fixtures/workflow-packages/laptop-diagnostic/scripts/analyze-snapshot.py
A	tests/fixtures/workflow-packages/laptop-diagnostic/scripts/render-report.py
A	tests/fixtures/workflow-packages/laptop-diagnostic/workflow-package.json
A	tests/fixtures/workflow-packages/laptop-diagnostic/workflows/laptop-diagnostic.hermes.yaml
A	tests/fixtures/workflow-packages/laptop-diagnostic/workflows/laptop-diagnostic.yaml
A	tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json
A	tests/fixtures/workflow-packages/multiple/packages/productivity/workflow-package.json
M	tests/installers/release-package.test.ts
M	tests/project/bundle-budget.test.ts
A	tests/project/package-contract-parity.test.ts
A	tests/project/package-documentation.test.ts
A	tests/project/package-execution-audit.ts
A	tests/project/package-no-execution.test.ts
A	tests/project/package-performance.test.ts
M	tests/project/release-version.test.ts
M	tests/security/security-boundaries.test.ts
M	vitest.setup.ts
```
