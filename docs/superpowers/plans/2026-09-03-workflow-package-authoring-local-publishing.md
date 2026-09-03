# Workflow Package Authoring and Local Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Workflow Studio create, edit, validate, prepare, and locally version complete multi-workflow Hermes packages without executing package content or accessing Git remotes.

**Architecture:** A Hermes-owned, versioned portable-package contract drives package discovery, resource resolution, limits, digest generation, and marketplace-index output. Focused TypeScript modules project package state and provide static authoring diagnostics; narrow Rust commands own scoped binary I/O, atomic generated-file replacement, and exact-path Git commits. The existing workflow YAML document path remains authoritative and is composed with separate artifact sessions rather than replaced.

**Tech Stack:** Svelte 5, TypeScript 6, Nanostores, CodeMirror 6, Ajv Draft 2020-12, `yaml`, `marked`, DOMPurify, Tauri 2/Rust, Git CLI, Vitest, Svelte Testing Library, fast-check, Playwright

**Spec:** `docs/superpowers/specs/2026-09-03-workflow-package-authoring-and-local-publishing-design.md`

## Global Constraints

- Execute this plan on an implementation branch created from `base`; create the isolated worktree at execution time with `superpowers:using-git-worktrees`.
- Do not change the sibling `hermes-agent` repository under this plan.
- Hard prerequisite: a separately approved Hermes plan must first publish `plugins/workflow/contracts/workflow-package-v1.json` and `plugins/workflow/contracts/workflow-package-v1-vectors.json` from an immutable Hermes commit. If either artifact is absent, stop before Task 1 and request the separate upstream work; never fabricate a Studio-owned substitute.
- YAML remains the sole authority for workflow graph and node behavior. Package manifests identify membership and publishing metadata only.
- A workspace may contain multiple non-overlapping packages, and each package may contain multiple definition/companion pairs.
- Workflow Studio never executes workflows, command resources, scripts, shell content, MCP servers, compilers, linters, language servers, dependency installers, or package installers.
- Invalid command and script drafts may be saved and recovered. Existing workflow YAML save/export structural gates remain unchanged.
- Package preparation fails closed on package-integrity defects and treats destination runtime availability as advisory.
- All distributable paths must remain inside one package root. Reject absolute paths, traversal, nested package roots, overlapping roots, NUL bytes, backslashes in canonical manifest paths, and every symlink.
- File-count, per-file, total-size, resource-resolution, digest, and index rules come only from the bundled Hermes package contract.
- Generated `digests.json` and `.well-known/hermes-workflows/index.json` are inspectable and read-only in the normal editor.
- Git remains local-only: no remote, authentication, fetch, pull, push, tag, branch mutation, merge, rebase, reset, cherry-pick, or history rewrite.
- Package commits include exact selected package paths plus the generated index path and preserve all unrelated repository state.
- Preserve comments, key order, scalar style, unknown fields, and unrelated YAML during node-to-resource edits.
- Parsing, validation, hashing, Git, and file I/O never run during pointer-move frames.
- Preserve keyboard operation, accessible naming/focus restoration, reduced motion, and the 250-node/500-edge canvas performance contract.
- Every task follows red-green-refactor TDD and ends with a focused commit after its listed verification passes.

---

### Task 1: Consume the Hermes Portable-Package Contract

**Files:**
- Create: `contracts/workflow-package-v1.json`
- Create: `contracts/workflow-package-v1-vectors.json`
- Create: `src/lib/package-contract/types.ts`
- Create: `src/lib/package-contract/package-contract-loader.ts`
- Create: `src/lib/package-contract/package-contract-loader.test.ts`
- Create: `src/lib/package-contract/bundled-package-contract.ts`
- Create: `scripts/sync-package-contracts.ts`
- Create: `scripts/sync-package-contracts.test.ts`
- Modify: `contracts/README.md`
- Modify: `package.json`
- Modify: `scripts/verify-release-assets.mjs`
- Modify: `tests/installers/release-package.test.ts`
- Modify: `src-tauri/resources/setup-integrity-v1.json`

**Interfaces:**
- Consumes: byte-identical contract artifacts from `../hermes-agent/plugins/workflow/contracts/workflow-package-v1.json` and `../hermes-agent/plugins/workflow/contracts/workflow-package-v1-vectors.json` at the separately approved Hermes commit.
- Produces: `loadWorkflowPackageContract(bytes: Uint8Array, source: PackageContractSource): Promise<PackageContractLoadResult>` and `loadBundledWorkflowPackageContract(): Promise<WorkflowPackageContract>`.

- [ ] **Step 1: Write failing loader and sync tests**

```ts
it('loads the bundled Hermes package contract and rejects a changed digest', async () => {
  const contract = await loadBundledWorkflowPackageContract()
  expect(contract.schema_version).toBe(1)
  expect(contract.contract_digest).toMatch(/^sha256:[a-f0-9]{64}$/)
  const changed = new TextEncoder().encode(
    JSON.stringify({ ...contract, contract_digest: `sha256:${'0'.repeat(64)}` }),
  )
  await expect(loadWorkflowPackageContract(changed, source)).resolves.toMatchObject({ ok: false })
})

it('copies only the two approved Hermes artifacts byte-for-byte', async () => {
  const result = await syncPackageContracts({ sourceRoot, destinationRoot })
  expect(result.files).toEqual(['workflow-package-v1.json', 'workflow-package-v1-vectors.json'])
  expect(await readFile(destinationContract)).toEqual(await readFile(sourceContract))
})
```

- [ ] **Step 2: Run the tests and verify the missing contract boundary fails**

Run: `npm run test:unit -- src/lib/package-contract/package-contract-loader.test.ts scripts/sync-package-contracts.test.ts`

Expected: FAIL because the loader, sync function, and bundled artifacts do not exist.

- [ ] **Step 3: Add the package-contract envelope types and fail-closed loader**

```ts
export interface WorkflowPackageContract {
  readonly schema_version: 1
  readonly contract_reader_version: 1
  readonly contract_digest: `sha256:${string}`
  readonly package_manifest_schema: Readonly<Record<string, unknown>>
  readonly marketplace_index_schema: Readonly<Record<string, unknown>>
  readonly resource_rules: readonly PackageResourceRule[]
  readonly limits: PackageLimits
  readonly digest: PackageDigestContract
}

export type PackageContractLoadResult =
  | { readonly ok: true; readonly contract: WorkflowPackageContract }
  | { readonly ok: false; readonly code: 'unsupported_reader' | 'invalid_schema' | 'digest_mismatch'; readonly message: string }
```

Validate both embedded JSON Schemas with Ajv, calculate the canonical envelope digest with the existing canonical JSON helper, reject unknown reader versions, and freeze the accepted value.

- [ ] **Step 4: Add deterministic sync and bundled loading**

Implement `syncPackageContracts({ sourceRoot, destinationRoot })` to require the exact two filenames, reject symlinks, copy their bytes, and verify the copied contract against the vectors. Add scripts:

```json
{
  "package-contracts:sync": "tsx scripts/sync-package-contracts.ts",
  "package-contracts:check": "tsx scripts/sync-package-contracts.ts --check"
}
```

Copy the approved upstream artifacts byte-for-byte. Extend the release-resource allowlist and integrity manifest for both files; do not edit their JSON content in Studio.

- [ ] **Step 5: Run focused and packaged-resource verification**

Run: `npm run test:unit -- src/lib/package-contract/package-contract-loader.test.ts scripts/sync-package-contracts.test.ts tests/installers/release-package.test.ts`

Run: `npm run package-contracts:check`

Run: `npm run resources:verify`

Expected: all commands exit 0 and the loader passes every Hermes vector.

- [ ] **Step 6: Commit**

```bash
git add contracts src/lib/package-contract scripts/sync-package-contracts.ts scripts/sync-package-contracts.test.ts package.json package-lock.json scripts/verify-release-assets.mjs tests/installers/release-package.test.ts src-tauri/resources/setup-integrity-v1.json
git commit -m "feat: consume Hermes workflow package contract"
```

### Task 2: Parse Manifests and Discover Multiple Package Roots

**Files:**
- Create: `src/lib/packages/types.ts`
- Create: `src/lib/packages/manifest.ts`
- Create: `src/lib/packages/manifest.test.ts`
- Create: `src/lib/packages/discovery.ts`
- Create: `src/lib/packages/discovery.test.ts`
- Create: `tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json`
- Create: `tests/fixtures/workflow-packages/multiple/packages/productivity/workflow-package.json`
- Modify: `src/lib/workspace/types.ts`

**Interfaces:**
- Consumes: `WorkflowPackageContract` and `WorkspaceFileEntry`.
- Produces: `parsePackageManifest(text: string, path: string, contract: WorkflowPackageContract): PackageManifestResult`, `findPackageManifestPaths(files: readonly WorkspaceFileEntry[]): readonly string[]`, and `buildPackageCatalog(input: PackageCatalogInput): PackageCatalog`.

- [ ] **Step 1: Write failing behavior and property tests**

```ts
it('discovers two independent package roots and preserves non-package workflows', () => {
  const catalog = buildPackageCatalog(fixtureInput('multiple'))
  expect(catalog.packages.map(({ id }) => id)).toEqual(['diagnostics', 'productivity'])
  expect(catalog.findings).toEqual([])
})

it.prop([fc.array(canonicalRelativePathArbitrary(), { maxLength: 40 })])(
  'never accepts nested or overlapping package roots',
  (paths) => expectNoOverlappingAcceptedRoots(paths),
)
```

Cover malformed JSON, schema errors, duplicate IDs, nested roots, unsafe/safe symlinks, case-distinct paths, workflow membership outside the root, missing members, and unsupported contract versions.
Define `fixtureInput`, `canonicalRelativePathArbitrary`, and `expectNoOverlappingAcceptedRoots` as local test helpers in `discovery.test.ts`; they construct only `WorkspaceFileEntry` metadata and manifest-text maps and never touch the real filesystem.

- [ ] **Step 2: Run tests and verify discovery fails**

Run: `npm run test:unit -- src/lib/packages/manifest.test.ts src/lib/packages/discovery.test.ts`

Expected: FAIL because package domain types and discovery do not exist.

- [ ] **Step 3: Implement immutable manifest and catalog types**

```ts
export interface WorkflowPackageProjection {
  readonly id: string
  readonly root: string
  readonly manifestPath: string
  readonly manifest: WorkflowPackageManifest
  readonly workflows: readonly PackageWorkflowMember[]
  readonly artifacts: readonly PackageArtifactEntry[]
}

export interface PackageCatalog {
  readonly packages: readonly WorkflowPackageProjection[]
  readonly findings: readonly PackageFinding[]
}
```

Use Ajv with the contract-provided manifest schema. Preserve unknown manifest values in the raw parsed document while exposing only contract-known projection fields.

- [ ] **Step 4: Implement deterministic package discovery**

Derive roots only from canonical `workflow-package.json` files, sort by code point, reject nested/overlapping roots, and associate scan entries without reading non-manifest file content. Keep ordinary workflow pairing unchanged.

- [ ] **Step 5: Run focused tests and workspace regression tests**

Run: `npm run test:unit -- src/lib/packages/manifest.test.ts src/lib/packages/discovery.test.ts src/lib/workspace/pair-workflows.test.ts src/stores/workspace.test.ts`

Expected: all tests pass; non-package pairing behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/packages src/lib/workspace/types.ts tests/fixtures/workflow-packages/multiple
git commit -m "feat: discover workflow package roots"
```

### Task 3: Resolve Package Resources and Classify Readiness

**Files:**
- Create: `src/lib/packages/artifact-kind.ts`
- Create: `src/lib/packages/artifact-kind.test.ts`
- Create: `src/lib/packages/resource-resolution.ts`
- Create: `src/lib/packages/resource-resolution.test.ts`
- Create: `src/lib/packages/readiness.ts`
- Create: `src/lib/packages/readiness.test.ts`
- Create: `tests/fixtures/workflow-packages/laptop-diagnostic/workflows/laptop-diagnostic.yaml`
- Create: `tests/fixtures/workflow-packages/laptop-diagnostic/workflows/laptop-diagnostic.hermes.yaml`
- Create: `tests/fixtures/workflow-packages/laptop-diagnostic/commands/interpret-report.md`
- Create: `tests/fixtures/workflow-packages/laptop-diagnostic/scripts/analyze-snapshot.py`
- Create: `tests/fixtures/workflow-packages/laptop-diagnostic/scripts/render-report.py`
- Create: `tests/fixtures/workflow-packages/laptop-diagnostic/fixtures/laptop-snapshot.json`
- Create: `tests/fixtures/workflow-packages/laptop-diagnostic/workflow-package.json`

**Interfaces:**
- Consumes: `WorkflowPackageProjection`, current workflow `DocumentAnalysis` values, package scan entries, `ArtifactStaticAnalysis` values supplied by artifact analyzers, and `WorkflowPackageContract.resource_rules`.
- Produces: `resolvePackageReferences(input: PackageReferenceInput): PackageReferenceGraph` and `analyzePackageReadiness(input: PackageReadinessInput): PackageAnalysis`.

- [ ] **Step 1: Write failing rule-driven resolution tests**

```ts
it('resolves uv and command references through contract rules without a Studio field inventory', () => {
  const graph = resolvePackageReferences(laptopDiagnosticInput())
  expect(graph.forNode('analyze-cpu')).toContainEqual(expect.objectContaining({ path: 'scripts/analyze-snapshot.py' }))
  expect(graph.forNode('interpret-report')).toContainEqual(expect.objectContaining({ path: 'commands/interpret-report.md' }))
})

it('blocks a missing package-owned script but advises on unavailable uv', () => {
  const analysis = analyzePackageReadiness(missingScriptInput())
  expect(analysis.blockers.map(({ code }) => ({ code }))).toContainEqual({ code: 'package_resource_missing' })
  expect(analysis.advisories.map(({ code }) => ({ code }))).toContainEqual({ code: 'runtime_unverified' })
})
```

Also test Bun `.ts`/`.js` precedence, explicit extension mismatch, unreferenced files, shared resources, external requirements, unknown fields, and lossless preservation.

- [ ] **Step 2: Run tests and verify the resolver fails**

Run: `npm run test:unit -- src/lib/packages/artifact-kind.test.ts src/lib/packages/resource-resolution.test.ts src/lib/packages/readiness.test.ts`

Expected: FAIL because the resource graph and readiness analyzer do not exist.

- [ ] **Step 3: Implement contract-driven artifact classification and resolution**

```ts
export interface PackageReference {
  readonly workflowPath: string
  readonly nodeId: string
  readonly fieldPath: string
  readonly ownership: 'packaged' | 'external'
  readonly artifactPath: string | null
  readonly ruleId: string
}

export interface PackageAnalysis {
  readonly ready: boolean
  readonly findings: readonly PackageFinding[]
  readonly references: PackageReferenceGraph
  readonly executionSurface: PackageExecutionSurface
}

export interface ArtifactStaticAnalysis {
  readonly path: string
  readonly structurallyValid: boolean
  readonly findings: readonly PackageFinding[]
}
```

Iterate only the contract's resource rules. Do not add hard-coded command/script field lists.

- [ ] **Step 4: Implement deterministic blocking/advisory classification**

Make manifest, path, resource, static-syntax, digest, and index integrity blocking. Keep runtime, dependency, provider, credential, tool, service, MCP reachability, and execution outcome advisory. Sort findings by package path, source location, stable code, and message.

- [ ] **Step 5: Run focused and workflow-analysis regression tests**

Run: `npm run test:unit -- src/lib/packages src/lib/validation/analyze-workflow.test.ts`

Expected: all tests pass and existing workflow issue severities are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/packages tests/fixtures/workflow-packages/laptop-diagnostic
git commit -m "feat: resolve workflow package resources"
```

### Task 4: Add Scoped Artifact and Binary Native Operations

**Files:**
- Modify: `src/lib/native/types.ts`
- Modify: `src/lib/native/bridge.ts`
- Modify: `src/lib/native/browser-bridge.ts`
- Modify: `src/lib/native/tauri-bridge.ts`
- Modify: `src/lib/native/bridge.test.ts`
- Create: `src/lib/native/artifact-api.test.ts`
- Create: `src-tauri/src/workspace/artifacts.rs`
- Modify: `src-tauri/src/workspace/mod.rs`
- Modify: `src-tauri/src/workspace/tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

**Interfaces:**
- Consumes: the active workspace capability root and canonical relative paths.
- Produces: `workspaceReadArtifact`, `workspaceImportArtifact`, `workspaceReplaceArtifact`, `workspaceRevealArtifact`, and `workspaceOpenArtifact` on `NativeBridge`.

- [ ] **Step 1: Write failing TypeScript and Rust containment tests**

```ts
await expect(bridge.workspaceReadArtifact('packages/diagnostics/logo.png')).resolves.toMatchObject({
  relativePath: 'packages/diagnostics/logo.png',
  mediaType: 'image/png',
  size: 68,
  sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
})
```

```rust
#[test]
fn artifact_operations_reject_traversal_symlinks_and_stale_replacements() {
    assert_code(read_artifact(&scope, "../secret"), "workspace_path_invalid");
    assert_code(read_artifact(&scope, "packages/p/link"), "workspace_symlink_unsupported");
    assert_code(replace_artifact(&scope, stale_request()), "workspace_revision_conflict");
}
```

- [ ] **Step 2: Run tests and verify missing bridge methods fail**

Run: `npm run test:unit -- src/lib/native/bridge.test.ts src/lib/native/artifact-api.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace::tests::artifact`

Expected: TypeScript compilation or tests fail for missing bridge methods; Rust test target fails for missing artifact operations.

- [ ] **Step 3: Implement narrow native artifact commands**

```ts
export interface WorkspaceArtifactMetadata {
  readonly relativePath: string
  readonly mediaType: string
  readonly size: number
  readonly sha256: string
  readonly modifiedAt: string
  readonly readOnly: boolean
}

export interface WorkspaceReplaceArtifactRequest {
  readonly relativePath: string
  readonly sourcePath: string
  readonly expectedCurrentHash: string | null
}
```

Resolve and recheck source/destination containment immediately before access. Stream binary hashing/copying with the contract maximum, write through a same-directory temporary file, flush, and atomically replace. Reject all package symlinks. Use the Tauri opener API for reveal/open; never interpolate a shell command.

- [ ] **Step 4: Wire browser and Tauri adapters**

The browser adapter stores binary fixture bytes in memory and records open/reveal requests. The Tauri adapter invokes typed commands with exact payloads. Keep existing text `workspaceRead`/`workspaceWrite` behavior unchanged.

- [ ] **Step 5: Run native, bridge, and workspace regression tests**

Run: `npm run test:unit -- src/lib/native`

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace::`

Expected: all artifact containment, stale-write, binary-size, and existing workspace tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/native src-tauri/src/workspace src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add scoped package artifact operations"
```

### Task 5: Add Recoverable Text Artifact Sessions

**Files:**
- Create: `src/lib/artifacts/types.ts`
- Create: `src/lib/artifacts/artifact-session.ts`
- Create: `src/lib/artifacts/artifact-session.test.ts`
- Create: `src/features/artifacts/artifact-workspace-controller.ts`
- Create: `src/features/artifacts/artifact-workspace-controller.test.ts`
- Create: `src/features/artifacts/ArtifactExternalChangeDialog.svelte`
- Create: `src/features/artifacts/ArtifactExternalChangeDialog.test.ts`
- Modify: `src/lib/recovery/types.ts`
- Modify: `src/lib/recovery/recovery-store.ts`
- Modify: `src/lib/recovery/recovery-store.test.ts`
- Create: `src/stores/artifacts.ts`
- Create: `src/stores/artifacts.test.ts`

**Interfaces:**
- Consumes: existing recovery native storage plus text `workspaceRead`/`workspaceWrite` revision checks.
- Produces: `ArtifactDocument`, `ArtifactRecoveryDraft`, `$artifactSession`, and `ArtifactWorkspaceController.open/edit/save/recover/discard/close`.

- [ ] **Step 1: Write failing recovery and concurrency tests**

```ts
it('saves an invalid Python draft and offers it after restart', async () => {
  await controller.open('packages/diagnostics/scripts/analyze.py', 'python')
  controller.edit('def broken(:\n')
  await controller.save()
  await controller.close()
  expect((await restarted.recoveryOffers())[0]?.text).toBe('def broken(:\n')
})

it('does not overwrite a concurrently changed external artifact', async () => {
  await expect(controller.save()).rejects.toMatchObject({ code: 'workspace_revision_conflict' })
  expect(state.externalChange).toMatchObject({ choices: ['keep-mine', 'reload-disk', 'compare'] })
})
```

- [ ] **Step 2: Run tests and verify artifact recovery fails**

Run: `npm run test:unit -- src/lib/artifacts src/features/artifacts/artifact-workspace-controller.test.ts src/lib/recovery/recovery-store.test.ts`

Expected: FAIL because generic artifact sessions and recovery records do not exist.

- [ ] **Step 3: Extend recovery with a backward-compatible record union**

```ts
export type RecoveryRecord = RecoveryDraft | ArtifactRecoveryDraft

export interface ArtifactRecoveryDraft {
  readonly schemaVersion: 2
  readonly recordType: 'artifact'
  readonly artifactId: string
  readonly path: string
  readonly language: ArtifactLanguage
  readonly text: string
  readonly revision: number
  readonly savedRevision: number
  readonly diskHash: string | null
  readonly updatedAt: string
}
```

Retain and parse existing schema-version-1 workflow records. Namespace artifact keys as `artifact:<workspace-id>:<relative-path>` so they cannot collide with workflow recovery.

- [ ] **Step 4: Implement the artifact session/controller**

Permit saving any text content, including invalid content. Track monotonic revisions, disk hashes, dirty state, sync origin, external changes, and debounced recovery. Use the same close/dispose retry semantics as workflow recovery.

Render **Keep Mine**, **Reload Disk**, and **Compare** through `ArtifactExternalChangeDialog`. Bind its authorization to the exact artifact path, disk hash, and session revision and restore focus to the editor after resolution.

- [ ] **Step 5: Run recovery, controller, and disposal tests**

Run: `npm run test:unit -- src/lib/artifacts src/features/artifacts src/lib/recovery src/app/application-disposal.test.ts`

Expected: all tests pass, including backward compatibility with workflow recovery records.

- [ ] **Step 6: Commit**

```bash
git add src/lib/artifacts src/features/artifacts src/stores/artifacts.ts src/stores/artifacts.test.ts src/lib/recovery
git commit -m "feat: recover package text artifact drafts"
```

### Task 6: Add the Static Script and Structured-Text Editor

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/artifacts/artifact-editor-extensions.ts`
- Create: `src/features/artifacts/artifact-editor-extensions.test.ts`
- Create: `src/features/artifacts/static-diagnostics.ts`
- Create: `src/features/artifacts/static-diagnostics.test.ts`
- Create: `src/features/artifacts/TextArtifactEditor.svelte`
- Create: `src/features/artifacts/TextArtifactEditor.test.ts`
- Create: `src/features/artifacts/BinaryArtifactView.svelte`
- Create: `src/features/artifacts/BinaryArtifactView.test.ts`
- Create: `src/features/artifacts/ArtifactEditor.svelte`
- Create: `src/features/artifacts/ArtifactEditor.test.ts`

**Interfaces:**
- Consumes: `ArtifactDocument`, `WorkspaceArtifactMetadata`, and `ArtifactWorkspaceController` callbacks.
- Produces: `analyzeArtifactSyntax(path: string, language: ArtifactLanguage, text: string): ArtifactStaticAnalysis` plus one `ArtifactEditor` surface for Python, TypeScript, JavaScript, Markdown, JSON, YAML, plain text, generated files, and binaries.

- [ ] **Step 1: Write failing editor and parser-error tests**

```ts
it.each([
  ['python', 'def broken(:\n'],
  ['typescript', 'const value: = 1'],
  ['javascript', 'function broken( {'],
  ['json', '{"broken":}'],
])('reports offline %s parser errors without invoking native execution', (language, text) => {
  expect(analyzeArtifactSyntax(`broken.${language}`, language, text).structurallyValid).toBe(false)
  expect(nativeInvoke).not.toHaveBeenCalled()
})
```

Component tests must cover line numbers, visible caret/focus, search, folding, read-only generated files, dirty status, Save, Replace, Reveal, Open Externally, and accessible diagnostic navigation.

- [ ] **Step 2: Run tests and verify the editor surface fails**

Run: `npm run test:unit -- src/features/artifacts/artifact-editor-extensions.test.ts src/features/artifacts/static-diagnostics.test.ts src/features/artifacts/TextArtifactEditor.test.ts src/features/artifacts/BinaryArtifactView.test.ts src/features/artifacts/ArtifactEditor.test.ts`

Expected: FAIL because the editor extensions, diagnostics, and components do not exist.

- [ ] **Step 3: Install exact CodeMirror language packages**

Run: `npm install --save-exact @codemirror/lang-javascript @codemirror/lang-markdown @codemirror/lang-python @codemirror/lang-json`

Expected: `package.json` and `package-lock.json` contain exact resolved versions; no executable language server is installed.

- [ ] **Step 4: Implement language compartments and parser diagnostics**

```ts
export function languageExtension(language: ArtifactLanguage): Extension
export function staticDiagnostics(language: ArtifactLanguage, text: string): readonly ArtifactDiagnostic[]
export function analyzeArtifactSyntax(path: string, language: ArtifactLanguage, text: string): ArtifactStaticAnalysis
```

Use CodeMirror/Lezer syntax trees and error nodes for static syntax findings. Reconfigure read-only and language compartments without recreating the editor. Do not call the native bridge from diagnostic functions.

- [ ] **Step 5: Implement text, generated, and binary surfaces**

Text artifacts bind to the artifact session and allow invalid saves. Generated artifacts are read-only and explain regeneration. Binary artifacts display metadata and invoke only the scoped import/replace/reveal/open bridge methods.

- [ ] **Step 6: Run focused, static, and accessibility tests**

Run: `npm run test:unit -- src/features/artifacts`

Run: `npm run check`

Expected: all tests and Svelte/TypeScript checks pass with no native execution calls.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/features/artifacts
git commit -m "feat: edit package scripts and resources"
```

### Task 7: Add Command Markdown Frontmatter and Preview

**Files:**
- Create: `src/lib/packages/command-markdown.ts`
- Create: `src/lib/packages/command-markdown.test.ts`
- Create: `src/features/artifacts/CommandEditor.svelte`
- Create: `src/features/artifacts/CommandEditor.test.ts`
- Create: `src/features/artifacts/CommandPreview.svelte`
- Create: `src/features/artifacts/CommandPreview.test.ts`
- Modify: `src/features/artifacts/ArtifactEditor.svelte`
- Modify: `src/features/artifacts/ArtifactEditor.test.ts`

**Interfaces:**
- Consumes: command Markdown text and the contract's command-frontmatter schema.
- Produces: `analyzeCommandMarkdown(path: string, text: string, schema: object): CommandMarkdownAnalysis`, compatible `ArtifactStaticAnalysis` findings, and sanitized preview rendering.

- [ ] **Step 1: Write failing frontmatter, preview, and reference tests**

```ts
it('separates YAML frontmatter from the command body and validates known keys', () => {
  expect(analyzeCommandMarkdown('commands/interpret-report.md', validCommand, schema)).toMatchObject({
    structurallyValid: true,
    frontmatter: { description: 'Interpret the report', 'argument-hint': '<report-path>' },
  })
})

it('sanitizes HTML and never executes command body content', async () => {
  render(CommandPreview, { markdown: '<script>window.pwned = true</script>Safe' })
  expect(screen.getByText('Safe')).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
})
```

- [ ] **Step 2: Run tests and verify Markdown analysis fails**

Run: `npm run test:unit -- src/lib/packages/command-markdown.test.ts src/features/artifacts/CommandEditor.test.ts src/features/artifacts/CommandPreview.test.ts`

Expected: FAIL because command analysis and preview components do not exist.

- [ ] **Step 3: Implement bounded frontmatter parsing**

Accept either no frontmatter or one opening/closing `---` block at the start of the file. Parse the block with the existing YAML library, reject duplicates/multi-documents, validate against the contract schema, and map diagnostics to source lines without rewriting the body.

- [ ] **Step 4: Implement accessible edit/preview/reference tabs**

Use the text artifact session for editing, `marked` plus DOMPurify for preview, and the package reference graph for workflow/node references. Keyboard arrow/Home/End behavior follows the existing YAML tablist.

- [ ] **Step 5: Run focused tests**

Run: `npm run test:unit -- src/lib/packages/command-markdown.test.ts src/features/artifacts/CommandEditor.test.ts src/features/artifacts/CommandPreview.test.ts src/features/artifacts/ArtifactEditor.test.ts`

Expected: all tests pass, including malicious HTML fixtures.

- [ ] **Step 6: Commit**

```bash
git add src/lib/packages/command-markdown.ts src/lib/packages/command-markdown.test.ts src/features/artifacts
git commit -m "feat: edit command Markdown resources"
```

### Task 8: Add Package Catalog State, Navigation, and Overview

**Files:**
- Create: `src/stores/packages.ts`
- Create: `src/stores/packages.test.ts`
- Create: `src/features/packages/package-catalog-controller.ts`
- Create: `src/features/packages/package-catalog-controller.test.ts`
- Create: `src/features/packages/PackageTree.svelte`
- Create: `src/features/packages/PackageTree.test.ts`
- Create: `src/features/packages/PackageOverview.svelte`
- Create: `src/features/packages/PackageOverview.test.ts`
- Create: `src/features/packages/PackageInspector.svelte`
- Create: `src/features/packages/PackageInspector.test.ts`
- Create: `src/features/packages/PackageManifestEditor.svelte`
- Create: `src/features/packages/PackageManifestEditor.test.ts`
- Modify: `src/lib/commands/types.ts`
- Modify: `src/lib/commands/registry.ts`
- Modify: `src/lib/commands/registry.test.ts`
- Modify: `src/stores/shell.ts`
- Modify: `src/stores/shell.test.ts`
- Modify: `src/app/ActivityRail.svelte`
- Modify: `src/app/ActivityRail.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`

**Interfaces:**
- Consumes: workspace scans, manifest/artifact reads, `buildPackageCatalog`, `analyzePackageReadiness`, `analyzeArtifactSyntax`, `analyzeCommandMarkdown`, and artifact/workflow open callbacks.
- Produces: `$packageCatalog`, `$activePackageSelection`, `PackageCatalogController.refresh/select/open`, and the contextual `packages` activity.

- [ ] **Step 1: Write failing catalog race and navigation tests**

```ts
it('keeps the newest workspace package scan when an older refresh completes later', async () => {
  const older = controller.refresh(workspaceA)
  const newer = controller.refresh(workspaceB)
  resolveB(twoPackages)
  resolveA(onePackage)
  await Promise.all([older, newer])
  expect($packageCatalog.get().workspaceId).toBe('workspace-b')
})

it('opens package roots in Overview and workflow members in the existing workflow editor', async () => {
  await user.click(screen.getByRole('treeitem', { name: /laptop-support package/i }))
  expect(screen.getByRole('heading', { name: /laptop support/i })).toBeVisible()
  await user.click(screen.getByRole('treeitem', { name: /laptop-diagnostic.yaml/i }))
  expect(openWorkflow).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: expect.any(String) }))
})
```

- [ ] **Step 2: Run tests and verify package activity fails**

Run: `npm run test:unit -- src/stores/packages.test.ts src/features/packages src/app/ActivityRail.test.ts src/app/App.test.ts`

Expected: FAIL because `packages` is not an activity and catalog components do not exist.

- [ ] **Step 3: Implement feature-owned package state and refresh controller**

```ts
export interface PackageCatalogState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly workspaceId: string | null
  readonly catalog: PackageCatalog
  readonly active: PackageSelection | null
  readonly error: string | null
}
```

Discard stale async reads by workspace ID and monotonic refresh generation. Keep workspace pairing state independent.

- [ ] **Step 4: Implement the Packages activity and approved overview**

Add `packages` to contextual activities, the command registry, and Activity Rail using a package icon. Render the keyboard-operable Package Tree in the left panel. Render Package Overview or Artifact Editor in the center and Package Inspector on the right while preserving collapsible-panel behavior.

Package Inspector edits known publishing fields without removing unknown JSON properties. **Advanced Source** opens `PackageManifestEditor` with JSON diagnostics and lossless recovery; switching between form and source reparses the current manifest instead of keeping a hidden form model.

- [ ] **Step 5: Run navigation, shell, and app tests**

Run: `npm run test:unit -- src/stores/packages.test.ts src/features/packages src/lib/commands/registry.test.ts src/stores/shell.test.ts src/app/ActivityRail.test.ts src/app/App.test.ts`

Expected: all tests pass; Explorer, Nodes, and full-page activities retain their existing behavior.

- [ ] **Step 6: Commit**

```bash
git add src/stores/packages.ts src/stores/packages.test.ts src/features/packages src/lib/commands src/stores/shell.ts src/stores/shell.test.ts src/app/ActivityRail.svelte src/app/ActivityRail.test.ts src/app/App.svelte src/app/App.test.ts
git commit -m "feat: add workflow packages workbench"
```

### Task 9: Create, Adopt, and Change Package Membership Safely

**Files:**
- Create: `src/features/packages/package-actions.ts`
- Create: `src/features/packages/package-actions.test.ts`
- Create: `src/features/packages/NewPackageDialog.svelte`
- Create: `src/features/packages/NewPackageDialog.test.ts`
- Create: `src/features/packages/AdoptWorkflowDialog.svelte`
- Create: `src/features/packages/AdoptWorkflowDialog.test.ts`
- Create: `src/features/packages/RemoveWorkflowDialog.svelte`
- Create: `src/features/packages/RemoveWorkflowDialog.test.ts`
- Create: `src/features/packages/PackageArtifactDialog.svelte`
- Create: `src/features/packages/PackageArtifactDialog.test.ts`
- Create: `src/features/packages/PackageArtifactContextMenu.svelte`
- Create: `src/features/packages/PackageArtifactContextMenu.test.ts`
- Create: `src-tauri/src/workspace/transaction.rs`
- Modify: `src-tauri/src/workspace/mod.rs`
- Modify: `src-tauri/src/workspace/tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/native/types.ts`
- Modify: `src/lib/native/browser-bridge.ts`
- Modify: `src/lib/native/tauri-bridge.ts`
- Modify: `src/lib/native/artifact-api.test.ts`

**Interfaces:**
- Consumes: package contract schemas, workspace scan identities, workflow pairs, and safe native file primitives.
- Produces: `planPackageMutation(request, snapshot): PackageMutationPlan`, `workspaceApplyTransaction(plan): Promise<WorkspaceTransactionResult>`, and create/adopt/remove coordinators.

- [ ] **Step 1: Write failing transaction and dialog tests**

```ts
it('creates one package and first workflow as an all-or-nothing transaction', async () => {
  const plan = planPackageMutation(newPackageRequest, emptySnapshot)
  expect(plan.writes.map(({ relativePath }) => relativePath)).toEqual([
    'packages/laptop-support/workflow-package.json',
    'packages/laptop-support/workflows/laptop-diagnostic.yaml',
  ])
  await expect(native.workspaceApplyTransaction(plan)).resolves.toMatchObject({ status: 'committed' })
})

it('offers remove-only, trash-pair, and cancel without deleting shared resources', async () => {
  expect(screen.getByRole('button', { name: 'Remove from package only' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Move workflow files to Trash' })).toBeVisible()
  expect(native.workspaceTrashPaths).not.toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ relativePath: expect.stringContaining('/scripts/') })]))
})

it('previews reference impact before renaming or trashing a package artifact', async () => {
  const plan = planPackageMutation(renameCommandRequest, packageSnapshot)
  expect(plan.referenceChanges).toEqual([
    expect.objectContaining({ nodeId: 'interpret-report', from: 'interpret-report', to: 'interpret-summary' }),
  ])
  expect(plan.moves).toContainEqual(
    expect.objectContaining({
      sourcePath: 'packages/laptop/commands/interpret-report.md',
      destinationPath: 'packages/laptop/commands/interpret-summary.md',
    }),
  )
})
```

Rust tests inject failure before and after each rename to prove rollback or explicit partial recovery.

- [ ] **Step 2: Run tests and verify transaction support fails**

Run: `npm run test:unit -- src/features/packages/package-actions.test.ts src/features/packages/NewPackageDialog.test.ts src/features/packages/AdoptWorkflowDialog.test.ts src/features/packages/RemoveWorkflowDialog.test.ts src/lib/native/artifact-api.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace::tests::transaction`

Expected: FAIL because package plans and native transactions do not exist.

- [ ] **Step 3: Implement validated mutation plans and atomic native transactions**

```ts
export interface PackageMutationPlan {
  readonly workspaceId: string
  readonly expectedEntries: readonly ExpectedWorkspaceEntry[]
  readonly writes: readonly WorkspaceWriteRequest[]
  readonly moves: readonly WorkspaceMoveRequest[]
  readonly trashes: readonly WorkspaceTrashRequest[]
}
```

Revalidate all expected hashes and destination absence before the first mutation. Stage writes, order moves without collisions, and record rollback results. Never accept a package root or path directly from unvalidated UI text.

- [ ] **Step 4: Implement create/adopt/remove UI flows**

New Package collects every required manifest field and a blank/example/existing first workflow choice. Adopt offers exact move/copy previews. Remove offers the three approved choices and reports references without trashing shared resources.

Add Artifact creates canonical text resources or imports binary resources under an allowed package directory. The artifact context menu supports Rename, Replace, Reveal, Open Externally, and Move to Trash. Rename updates contract-recognized references only when unambiguous; otherwise the dialog refuses the automatic rewrite and lists manual references. Trash requires exact path/hash confirmation and never removes shared resources as a side effect.

- [ ] **Step 5: Run focused TypeScript and Rust tests**

Run: `npm run test:unit -- src/features/packages src/lib/native/artifact-api.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace::`

Expected: all collision, rollback, stale-revision, and dialog focus tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/packages src/lib/native src-tauri/src/workspace src-tauri/src/lib.rs
git commit -m "feat: create and manage workflow packages"
```

### Task 10: Connect Workflow Nodes to Package Resources

**Files:**
- Create: `src/lib/packages/resource-actions.ts`
- Create: `src/lib/packages/resource-actions.test.ts`
- Create: `src/features/inspector/ResourceFieldActions.svelte`
- Create: `src/features/inspector/ResourceFieldActions.test.ts`
- Modify: `src/features/inspector/Inspector.svelte`
- Modify: `src/features/inspector/Inspector.test.ts`
- Modify: `src/lib/yaml/mutations.ts`
- Modify: `src/lib/yaml/patch-document.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.canvas-authoring.test.ts`

**Interfaces:**
- Consumes: active package, workflow CST, contract resource rule, workspace snapshot, and artifact/package open callbacks.
- Produces: `planResourceCreation(input): ResourceCreationPlan` and inspector actions **Select**, **Create**, **Open**, and **Reveal in Package**.

- [ ] **Step 1: Write failing single-transaction and preservation tests**

```ts
it('creates a uv script and patches only the selected node resource field', async () => {
  const result = planResourceCreation({
    package: laptopPackage,
    workflow: laptopWorkflow,
    nodeId: 'analyze',
    ruleId: 'script-uv',
    basename: 'analyze-snapshot',
    workspace: cleanWorkspaceSnapshot,
  })
  expect(result.artifactPath).toBe('packages/laptop/scripts/analyze-snapshot.py')
  expect(result.yamlMutation.nextText).toContain('script: analyze-snapshot')
  expect(result.yamlMutation.nextText).toContain('# preserve this comment')
})
```

Cover collisions, Bun extension selection, an invalid/stale YAML projection, aliases that cannot be patched safely, shared references, and ambiguous unknown textual references.

- [ ] **Step 2: Run tests and verify resource actions fail**

Run: `npm run test:unit -- src/lib/packages/resource-actions.test.ts src/features/inspector/ResourceFieldActions.test.ts src/features/inspector/Inspector.test.ts src/lib/yaml/patch-document.test.ts src/app/App.canvas-authoring.test.ts`

Expected: FAIL because resource transactions and inspector actions do not exist.

- [ ] **Step 3: Implement contract-driven resource plans**

```ts
export interface ResourceCreationPlan {
  readonly packageId: string
  readonly artifactPath: string
  readonly initialText: string
  readonly yamlMutation: WorkflowMutation
  readonly expectedWorkspaceEntries: readonly ExpectedWorkspaceEntry[]
}
```

Derive directory, suffix, and YAML reference value exclusively from the matched contract rule. Reparse and revalidate the patched YAML before committing the artifact/YAML operation.

- [ ] **Step 4: Add inspector actions and navigation**

Render actions only for contract-declared resource fields. Disable Create when the canvas is stale/read-only or the workflow is outside a package. After success, open the new artifact and restore focus to the originating action when the editor closes.

- [ ] **Step 5: Run focused and YAML preservation tests**

Run: `npm run test:unit -- src/lib/packages/resource-actions.test.ts src/features/inspector src/lib/yaml src/app/App.canvas-authoring.test.ts`

Expected: all tests pass and no unknown YAML content changes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/packages/resource-actions.ts src/lib/packages/resource-actions.test.ts src/features/inspector src/lib/yaml src/app/App.svelte src/app/App.canvas-authoring.test.ts
git commit -m "feat: link workflow nodes to package resources"
```

### Task 11: Generate Deterministic Digests and Marketplace Index Atomically

**Files:**
- Create: `src/lib/packages/digest.ts`
- Create: `src/lib/packages/digest.test.ts`
- Create: `src/lib/packages/marketplace-index.ts`
- Create: `src/lib/packages/marketplace-index.test.ts`
- Create: `src/lib/packages/preparation.ts`
- Create: `src/lib/packages/preparation.test.ts`
- Create: `src-tauri/src/workspace/package_hash.rs`
- Create: `src-tauri/src/workspace/generated_write.rs`
- Modify: `src-tauri/src/workspace/mod.rs`
- Modify: `src-tauri/src/workspace/tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/native/types.ts`
- Modify: `src/lib/native/browser-bridge.ts`
- Modify: `src/lib/native/tauri-bridge.ts`
- Modify: `src/lib/native/artifact-api.test.ts`

**Interfaces:**
- Consumes: package contract digest rules/vectors, a ready `PackageAnalysis`, native exact-byte per-file hashes, captured source identities, and all repository package manifests.
- Produces: `composePackageDigest`, `generateMarketplaceIndex`, `prepareGeneratedPackageFiles`, `workspaceHashPackage`, and `workspaceReplaceGeneratedFiles`.

- [ ] **Step 1: Write failing Hermes-vector and atomicity tests**

```ts
it.each(hermesVectors.cases)('matches Hermes package vector $id', async ({ input, expected }) => {
  expect(await composePackageDigest(input, contract.digest)).toEqual(expected)
})

it('sorts marketplace entries and emits no timestamp or commit SHA', () => {
  const text = generateMarketplaceIndex([productivity, diagnostics], contract)
  expect(JSON.parse(text).packages.map(({ id }: { id: string }) => id)).toEqual(['diagnostics', 'productivity'])
  expect(text).not.toMatch(/generatedAt|commit|timestamp/i)
})
```

Rust failure-injection tests cover hash-time changes, size overflow, symlinks, a changed index revision, failure between generated replacements, rollback failure reporting, and post-replacement verification.

- [ ] **Step 2: Run tests and verify digest/generation fails**

Run: `npm run test:unit -- src/lib/packages/digest.test.ts src/lib/packages/marketplace-index.test.ts src/lib/packages/preparation.test.ts src/lib/native/artifact-api.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace::tests::package_`

Expected: FAIL because digest composition, index generation, and native operations do not exist.

- [ ] **Step 3: Implement exact-byte hashing and TypeScript composition**

```ts
export interface PackageFileHash {
  readonly relativePath: string
  readonly size: number
  readonly sha256: string
  readonly identity: WorkspaceFileIdentity
}

export function composePackageDigest(
  files: readonly PackageFileHash[],
  contract: PackageDigestContract,
): PackageDigestResult
```

Rust streams each file once under contract limits and returns hashes plus identities. TypeScript sorts and composes strictly according to the Hermes contract. Reject any vector mismatch.

- [ ] **Step 4: Implement deterministic generated output and atomic replacement**

Generate `digests.json` for the selected package and the complete repository index in memory. Pass both texts, expected existing hashes, and the captured source identities to one native command. Stage, flush, replace, rehash, and roll back on failure.

- [ ] **Step 5: Run contract vectors, native tests, and repeatability check**

Run: `npm run test:unit -- src/lib/packages/digest.test.ts src/lib/packages/marketplace-index.test.ts src/lib/packages/preparation.test.ts src/lib/native/artifact-api.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace::`

Run twice: `npm run package-contracts:check`

Expected: all commands pass and repeated generation produces byte-identical output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/packages src/lib/native src-tauri/src/workspace src-tauri/src/lib.rs
git commit -m "feat: generate workflow package metadata"
```

### Task 12: Create Exact Package-Scoped Git Versions

**Files:**
- Modify: `src/lib/git/types.ts`
- Modify: `src/lib/git/git-api.ts`
- Create: `src/lib/git/package-version-actions.ts`
- Create: `src/lib/git/package-version-actions.test.ts`
- Create: `src/lib/git/package-version-actions.integration.test.ts`
- Modify: `src/lib/native/types.ts`
- Modify: `src/lib/native/browser-bridge.ts`
- Modify: `src/lib/native/tauri-bridge.ts`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/git/mutate.rs`
- Modify: `src-tauri/src/git/tests.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: prepared package paths, generated index path/hash, semantic version, commit message, and captured `GitBase`/file identities.
- Produces: `previewPackageVersion(request): Promise<GitPackageVersionPreview>` and `createPackageVersion(request, authorizationToken): Promise<GitPackageVersionResult>`.

- [ ] **Step 1: Write failing real-repository preservation tests**

```ts
it('commits one package and generated index while preserving unrelated staged and unstaged changes', async () => {
  const result = await createPackageVersion(requestFor('diagnostics'))
  expect(result.outcome).toBe('committed')
  expect(gitShowNames(result.committedOid)).toEqual([
    '.well-known/hermes-workflows/index.json',
    'packages/diagnostics/digests.json',
    'packages/diagnostics/scripts/analyze.py',
    'packages/diagnostics/workflow-package.json',
    'packages/diagnostics/workflows/diagnostic.yaml',
  ])
  expect(await indexContains('unrelated-staged.txt')).toBe(true)
  expect(await readFile('unrelated-unstaged.txt', 'utf8')).toBe('mine')
})
```

Add cases for unborn HEAD, missing local identity, package deletion, concurrent HEAD movement, concurrent package/index edit, manually modified shared index, non-repository workspace, and no-op version.

- [ ] **Step 2: Run focused TypeScript and Rust Git tests**

Run: `npm run test:unit -- src/lib/git/package-version-actions.test.ts src/lib/git/package-version-actions.integration.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::tests::package_`

Expected: FAIL because package path-set previews and commits do not exist.

- [ ] **Step 3: Generalize the proven pair-only index transaction internally**

```rust
pub struct PackageVersionRequest {
    pub root: PathBuf,
    pub package_root: String,
    pub paths: Vec<String>,
    pub marketplace_index_path: String,
    pub message: String,
}
```

Validate every path, require package containment except for the one canonical index path, preserve the user's real index with the existing temporary-index approach, and bind preview authorization to HEAD, path set, hashes, diff, and message.

- [ ] **Step 4: Add baseline comparison and semantic-version suggestion**

```ts
export function suggestPackageVersion(change: PackageChangeSummary, baseline: string): VersionSuggestion
```

Use deterministic rules: metadata/docs/fixture-only changes suggest patch; added compatible workflow/resource capability suggests minor; removed workflow or changed declared compatibility suggests major. Label the result a suggestion and require an explicit user-selected valid version greater than the reachable local baseline.

- [ ] **Step 5: Run all Git mutation tests**

Run: `npm run test:unit -- src/lib/git`

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::`

Expected: all existing pair-version and new package-version tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/git src/lib/native src-tauri/src/git src-tauri/src/lib.rs
git commit -m "feat: create local workflow package versions"
```

### Task 13: Add the Guided Prepare and Update Experience

**Files:**
- Create: `src/features/packages/prepare-package-controller.ts`
- Create: `src/features/packages/prepare-package-controller.test.ts`
- Create: `src/features/packages/PreparePackageDialog.svelte`
- Create: `src/features/packages/PreparePackageDialog.test.ts`
- Create: `src/features/packages/PackageChangeList.svelte`
- Create: `src/features/packages/PackageChangeList.test.ts`
- Create: `src/features/packages/PackageReadiness.svelte`
- Create: `src/features/packages/PackageReadiness.test.ts`
- Modify: `src/features/packages/PackageOverview.svelte`
- Modify: `src/features/packages/PackageOverview.test.ts`
- Modify: `src/app/StatusBar.svelte`
- Modify: `src/app/StatusBar.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`

**Interfaces:**
- Consumes: artifact/workflow save coordinators, `PackageAnalysis`, generated-file preparation, package Git preview/commit, and local baseline comparison.
- Produces: `PreparePackageController.validate/review/prepare/commit/cancel` and the approved three-step dialog.

- [ ] **Step 1: Write failing state-machine and accessibility tests**

```ts
it('moves through validate, review changes, and version/commit without claiming remote publication', async () => {
  await controller.validate(packageId)
  expect(controller.state.step).toBe('review')
  await controller.acceptReview()
  await controller.prepare({ version: '1.1.0', message: 'feat(workflow): update diagnostics' })
  expect(controller.state).toMatchObject({ phase: 'complete', statusLabel: 'Prepared locally' })
  expect(controller.state.statusLabel).not.toMatch(/publish/i)
})
```

Test blocking findings, advisories, unsaved artifact flush, save failure, changed source revision, digest rollback, Git authorization expiry, missing identity, cancel/focus restoration, and shared-index conflict.

- [ ] **Step 2: Run tests and verify the preparation UI fails**

Run: `npm run test:unit -- src/features/packages/prepare-package-controller.test.ts src/features/packages/PreparePackageDialog.test.ts src/features/packages/PackageChangeList.test.ts src/features/packages/PackageReadiness.test.ts src/app/StatusBar.test.ts src/app/App.test.ts`

Expected: FAIL because the prepare state machine and components do not exist.

- [ ] **Step 3: Implement the explicit preparation state machine**

```ts
export type PreparePackageState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'validating'; readonly packageId: string }
  | { readonly phase: 'blocked'; readonly analysis: PackageAnalysis }
  | { readonly phase: 'review'; readonly preview: PackagePreparationPreview }
  | { readonly phase: 'committing'; readonly authorizationToken: string }
  | { readonly phase: 'complete'; readonly statusLabel: 'Prepared locally'; readonly commitOid: string }
  | { readonly phase: 'error'; readonly code: string; readonly message: string; readonly recovery: readonly string[] }
```

Flush all relevant sessions before capture, discard stale async results by generation, and keep generated files recoverable when Git identity is the only remaining issue.

- [ ] **Step 4: Implement the approved visual flow**

Render Validate, Review Changes, and Version & Commit steps; total blockers/advisories; execution/trust changes; exact file list; version suggestion; editable message; and local-only explanation. The completion view shows commit OID and generic external push guidance.

- [ ] **Step 5: Run package UI and app regression tests**

Run: `npm run test:unit -- src/features/packages src/app/StatusBar.test.ts src/app/App.test.ts`

Run: `npm run check`

Expected: all tests pass and no UI text claims a remote publish occurred.

- [ ] **Step 6: Commit**

```bash
git add src/features/packages src/app/StatusBar.svelte src/app/StatusBar.test.ts src/app/App.svelte src/app/App.test.ts
git commit -m "feat: prepare workflow packages locally"
```

### Task 14: Add Complete Offline Package Documentation

**Files:**
- Create: `docs/app-guides/workflow-packages.md`
- Create: `docs/app-guides/package-folder-structure.md`
- Create: `docs/app-guides/creating-a-package.md`
- Create: `docs/app-guides/multiple-workflows-per-package.md`
- Create: `docs/app-guides/command-resources.md`
- Create: `docs/app-guides/script-resources.md`
- Create: `docs/app-guides/mcp-and-supporting-resources.md`
- Create: `docs/app-guides/packaged-and-external-requirements.md`
- Create: `docs/app-guides/package-readiness.md`
- Create: `docs/app-guides/package-versions-digests-trust.md`
- Create: `docs/app-guides/preparing-packages.md`
- Create: `docs/app-guides/updating-packages.md`
- Create: `docs/app-guides/publishing-packages-with-git.md`
- Create: `docs/app-guides/coworker-package-installation.md`
- Create: `docs/app-guides/package-troubleshooting.md`
- Modify: `docs/app-guides/quick-start.md`
- Modify: `docs/app-guides/problems-and-validation.md`
- Modify: `src/lib/docs/guide-sources.ts`
- Modify: `src/lib/docs/types.ts`
- Modify: `src/lib/docs/build-index.ts`
- Modify: `src/lib/docs/build-index.test.ts`
- Modify: `src/features/documentation/DocumentationOverview.svelte`
- Modify: `src/features/documentation/DocumentationOverview.test.ts`
- Create: `tests/project/package-documentation.test.ts`

**Interfaces:**
- Consumes: approved package contract vocabulary, stable finding codes, resource rule IDs, and UI action labels.
- Produces: searchable offline package topics and exact context targets such as `guide:script-resources#runtime-resolution`.

- [ ] **Step 1: Write failing documentation completeness tests**

```ts
it('indexes every required package guide and resolves context targets', () => {
  const index = buildDocumentationIndex(contract)
  expect(index.byId.has('guide:workflow-packages')).toBe(true)
  expect(index.byId.has('guide:script-resources')).toBe(true)
  for (const topicId of ['guide:command-resources', 'guide:script-resources', 'guide:package-readiness']) {
    expect(index.byId.has(topicId)).toBe(true)
  }
})

it('never describes Studio as executing, trusting, pushing, or remotely publishing a package', async () => {
  expect(await prohibitedPackageDocumentationClaims()).toEqual([])
})
```

Also validate Markdown links, headings used by contextual navigation, command/script examples against contract resource rules, and the phrases **Saved**, **Prepared locally**, and **Available from repository**.

- [ ] **Step 2: Run tests and verify package documentation is absent**

Run: `npm run test:unit -- src/lib/docs/build-index.test.ts src/features/documentation/DocumentationOverview.test.ts tests/project/package-documentation.test.ts`

Expected: FAIL listing every missing required guide and context target.

- [ ] **Step 3: Write the fifteen focused guides**

Each guide includes purpose, when to use it, exact folder examples, authoring steps, package/runtime boundary, diagnostics, recovery, and related topics. The Git guide states that Studio creates a local commit and the user pushes externally. The co-worker guide describes install/update/trust conceptually and links its behavior to the installed co-worker version rather than promising unavailable commands.

- [ ] **Step 4: Wire documentation groups and contextual links**

Add a **Workflow packages** guide group. Connect package findings, node command/script fields, package overview actions, preparation steps, and completion guidance to exact topic IDs. Preserve current workflow-node documentation ordering.

- [ ] **Step 5: Run documentation, static, and packaged-resource checks**

Run: `npm run test:unit -- src/lib/docs src/features/documentation tests/project/package-documentation.test.ts`

Run: `npm run format:check`

Expected: all guide presence, link, search, and prohibited-claim tests pass.

- [ ] **Step 6: Commit**

```bash
git add docs/app-guides src/lib/docs src/features/documentation tests/project/package-documentation.test.ts
git commit -m "docs: explain workflow package authoring"
```

### Task 15: Bundle Complete Example Packages and Copy Them Atomically

**Files:**
- Create: `examples/packages/catalog.yaml`
- Create: `examples/packages/laptop-diagnostic/workflow-package.json`
- Create: `examples/packages/laptop-diagnostic/workflows/laptop-diagnostic.yaml`
- Create: `examples/packages/laptop-diagnostic/workflows/laptop-diagnostic.hermes.yaml`
- Create: `examples/packages/laptop-diagnostic/commands/interpret-report.md`
- Create: `examples/packages/laptop-diagnostic/scripts/analyze-snapshot.py`
- Create: `examples/packages/laptop-diagnostic/scripts/render-report.py`
- Create: `examples/packages/laptop-diagnostic/fixtures/laptop-snapshot.json`
- Create: `examples/packages/laptop-diagnostic/digests.json`
- Create: `examples/packages/multi-workflow-support/workflow-package.json`
- Create: `examples/packages/multi-workflow-support/workflows/diagnose.yaml`
- Create: `examples/packages/multi-workflow-support/workflows/collect-bundle.yaml`
- Create: `examples/packages/command-resources/workflow-package.json`
- Create: `examples/packages/command-resources/workflows/command-demo.yaml`
- Create: `examples/packages/command-resources/commands/summarize.md`
- Create: `examples/packages/external-requirements/workflow-package.json`
- Create: `examples/packages/external-requirements/workflows/external-tool.yaml`
- Modify: `scripts/validate-examples.ts`
- Create: `scripts/validate-package-examples.test.ts`
- Modify: `src/lib/examples/types.ts`
- Modify: `src/lib/examples/load-examples.ts`
- Modify: `src/lib/examples/load-examples.test.ts`
- Modify: `src/features/examples/ExampleGallery.svelte`
- Modify: `src/features/examples/ExampleGallery.test.ts`
- Modify: `scripts/verify-release-assets.mjs`
- Modify: `tests/installers/release-package.test.ts`
- Modify: `src-tauri/resources/setup-integrity-v1.json`

**Interfaces:**
- Consumes: package contract, readiness analyzer, digest vectors, and `workspaceApplyTransaction`.
- Produces: `validatePackageExamples(): Promise<readonly string[]>`, `loadPackageExampleCatalog()`, and `createPackageExampleCopy(example, destination): Promise<WorkflowPackageProjection>`.

- [ ] **Step 1: Write failing package-example validation and copy tests**

```ts
it('validates every bundled package with the production package contract', async () => {
  expect(await validatePackageExamples()).toEqual([])
})

it('copies the complete laptop package or leaves no destination files', async () => {
  const result = await createPackageExampleCopy(example, dependencies)
  expect(result.artifacts.map(({ relativePath }) => relativePath)).toContain('scripts/analyze-snapshot.py')
  expect(result.artifacts.map(({ relativePath }) => relativePath)).toContain('commands/interpret-report.md')
})
```

Inject a failure after each staged file to prove all-or-nothing copy and collision-safe package IDs/paths.

- [ ] **Step 2: Run tests and verify package examples are absent**

Run: `npm run test:unit -- src/lib/examples/load-examples.test.ts src/features/examples/ExampleGallery.test.ts scripts/validate-package-examples.test.ts`

Expected: FAIL because package catalogs and complete package copying do not exist.

- [ ] **Step 3: Add synthetic, portable example packages**

Use only synthetic data and contract-supported node fields. The laptop example demonstrates shared Python script resolution and a command resource without making hardware or execution claims. Generate its committed digest through the Task 11 implementation.

- [ ] **Step 4: Extend validation, gallery presentation, and editable copy**

Validate every workflow, manifest, reference, static artifact, limit, and digest. Display examples as **Workflow** or **Package**. Package **Create Editable Copy** writes the entire package with one native transaction and opens its overview.

- [ ] **Step 5: Update release integrity and run example/resource checks**

Run: `npm run examples:check`

Run: `npm run test:unit -- src/lib/examples src/features/examples scripts/validate-package-examples.test.ts tests/installers/release-package.test.ts`

Run: `npm run resources:verify`

Expected: all bundled workflow and package examples validate and release integrity includes every package example file.

- [ ] **Step 6: Commit**

```bash
git add examples/packages scripts/validate-examples.ts scripts/validate-package-examples.test.ts src/lib/examples src/features/examples scripts/verify-release-assets.mjs tests/installers/release-package.test.ts src-tauri/resources/setup-integrity-v1.json
git commit -m "feat: bundle complete workflow package examples"
```

### Task 16: Verify End-to-End Package Authoring, Security, and Performance

**Files:**
- Modify: `src/e2e/bootstrap.ts`
- Create: `tests/e2e/package-authoring.spec.ts`
- Create: `tests/e2e/package-recovery.spec.ts`
- Create: `tests/e2e/package-preparation.spec.ts`
- Create: `tests/project/package-no-execution.test.ts`
- Create: `tests/project/package-contract-parity.test.ts`
- Create: `tests/project/package-performance.test.ts`
- Modify: `docs/security.md`
- Modify: `docs/verification/version-1-release-acceptance.md`

**Interfaces:**
- Consumes: the complete Studio package feature and Hermes contract vectors.
- Produces: release evidence for creation, editing, recovery, deterministic preparation, local versioning, no execution, accessibility, and performance.

- [ ] **Step 1: Write failing full-journey and forbidden-execution tests**

```ts
test('creates, edits, and prepares one package without remote or execution calls', async ({ page }) => {
  await createPackage(page, 'laptop-support')
  await createScriptFromNode(page, 'analyze', 'analyze-snapshot')
  await editArtifact(page, 'scripts/analyze-snapshot.py', 'print("artifact only")\n')
  await preparePackage(page, '1.0.0')
  await expect(page.getByText('Prepared locally')).toBeVisible()
  expect(await recordedNativeCalls(page)).not.toContainEqual(expect.stringMatching(/execute|spawn|push|fetch|pull/))
})
```

Add journeys for multiple packages, multiple workflows, malformed saved script recovery, external change choices, missing packaged resource, external advisory, shared-index conflict, binary replacement, keyboard-only navigation, reduced motion, and preparation rollback.

- [ ] **Step 2: Run focused E2E/project tests and verify missing coverage fails**

Run: `npm run test:e2e -- tests/e2e/package-authoring.spec.ts tests/e2e/package-recovery.spec.ts tests/e2e/package-preparation.spec.ts`

Run: `npm run test:unit -- tests/project/package-no-execution.test.ts tests/project/package-contract-parity.test.ts tests/project/package-performance.test.ts`

Expected: FAIL because the scenarios and security/performance assertions are not wired into the browser harness.

- [ ] **Step 3: Add deterministic browser scenarios and no-execution allowlist**

Extend the browser bridge with package fixture state, fault injection, captured typed native calls, and real revision changes. The no-execution test statically and behaviorally allows only declared workspace, recovery, hashing, generated-write, Git, reveal, and external-open commands from package features.

- [ ] **Step 4: Add performance and cross-platform parity verification**

Measure package refresh and readiness outside pointer frames while a 250-node/500-edge workflow is active. Require no long task above the existing interaction threshold and no package parsing/hash/Git call during pointer movement. Run all Hermes vectors on Node and Rust-capable CI targets.

- [ ] **Step 5: Update security and acceptance documentation**

Document untrusted package display, no execution, path/symlink policy, generated-file atomicity, local-only Git, private credential exclusion, digest independence, and the remaining co-worker-installer dependency. Record exact automated/manual evidence without claiming the co-worker marketplace exists.

- [ ] **Step 6: Run the full release-quality gate**

Run: `npm run format:check`

Run: `npm run lint`

Run: `npm run check`

Run: `npm run contracts:check`

Run: `npm run package-contracts:check`

Run: `npm run examples:check`

Run: `npm run resources:verify`

Run: `npm run test:unit`

Run: `npm run test:e2e`

Run: `npm run test:rust`

Run: `npm run build`

Expected: every command exits 0; package tests prove no execution or remote Git behavior.

- [ ] **Step 7: Commit**

```bash
git add src/e2e tests/e2e tests/project docs/security.md docs/verification/version-1-release-acceptance.md
git commit -m "test: verify workflow package authoring"
```

## Implementation Completion Gate

Before requesting final review:

- [ ] Confirm every task commit is contained in the implementation branch and no unrelated user file is committed.
- [ ] Confirm the two bundled package-contract files are byte-identical to the approved Hermes commit and record that commit in the verification document.
- [ ] Confirm the full Task 16 gate passes from a clean checkout.
- [ ] Confirm manual keyboard, screen-reader labeling, reduced-motion, binary-open, external-change, rollback, and 250-node/500-edge checks are recorded.
- [ ] Confirm the UI uses **Prepared locally**, never **Published**, after local version creation.
- [ ] Confirm documentation and examples ship in the native package integrity manifest.
- [ ] Confirm the worktree returns to `base` only after the approved branch integration/release workflow.
