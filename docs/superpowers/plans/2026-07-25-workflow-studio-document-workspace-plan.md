# Workflow Studio YAML Document and Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the authoritative YAML document engine and safe local workspace experience on which every visual feature depends.

**Architecture:** A pure TypeScript document engine parses and validates exact text revisions, while a Web Worker keeps continuous validation off the UI thread. Visual/form commands create typed syntax-tree transactions. Rust owns the selected workspace root, bounded reads, revision-checked atomic writes, trash, renames, and file watching.

**Tech Stack:** TypeScript 6.0, `yaml` 2.9, Ajv 8, Nanostores, Web Workers, Vitest, fast-check 4.9, Rust/Tauri, notify 8.2, sha2 0.11, tempfile 3.27, trash 5.2.

## Global constraints

- Complete the Native Foundation Plan first.
- YAML text is authoritative even while invalid; projections are derived and replace only on a current valid revision.
- Accept one YAML 1.2 mapping document per file; reject duplicate keys and multi-document streams for save/export.
- Enforce the active contract's document-size limit, currently 2 MiB.
- Preserve comments, ordering, scalar style, anchors, aliases, and unrelated fields wherever a targeted mutation permits it.
- Never silently materialize, normalize, delete, or reorder unrelated YAML.
- Definition and companion have separate text revisions but one pair-level validation/save model.
- Save/export is blocked by syntax, contract, or DAG-semantic errors; operational advisories are non-blocking.
- Use `.yaml` and `.yml` definitions and canonical `.hermes.yaml` companions.
- No user file may be read or mutated outside the selected workspace root.
- External edits must never overwrite dirty in-memory text without an explicit choice.
- Editor recovery/layout files live in application data, not the workspace.

---

### Task 1: Define authoritative document state and revision-safe worker protocol

**Files:**
- Create: `src/lib/documents/types.ts`
- Create: `src/lib/documents/revisions.ts`
- Create: `src/lib/documents/revisions.test.ts`
- Create: `src/workers/document-worker-protocol.ts`
- Create: `src/workers/document-worker.ts`
- Create: `src/workers/document-client.ts`
- Create: `src/workers/document-client.test.ts`
- Create: `src/stores/documents.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `WorkflowProfile` and contract digest from Phase 1.
- Produces: `WorkflowPairText`, `DocumentRevision`, `DocumentAnalysis`, `ValidationIssue`, `DocumentWorkerRequest/Response`, `DocumentClient`, and `$documentSession`.

- [ ] **Step 1: Add fast-check and define domain types**

Install and lock:

```bash
npm install --save-dev fast-check@4.9.0
```

Define these stable public shapes:

```ts
export type DocumentKind = 'definition' | 'companion'
export type IssueLayer = 'syntax' | 'contract' | 'semantic' | 'compatibility' | 'operational'

export interface ValidationIssue {
  code: string
  layer: IssueLayer
  severity: 'error' | 'warning' | 'info'
  blocking: boolean
  message: string
  document: DocumentKind
  path?: string
  line?: number
  column?: number
  nodeId?: string
  field?: string
  documentationId?: string
  quickFixId?: string
}

export interface TextDocumentState {
  id: string
  kind: DocumentKind
  path: string
  text: string
  revision: number
  savedRevision: number
  diskHash: string | null
}

export interface WorkflowPairText {
  workflowId: string
  definition: TextDocumentState
  companion: TextDocumentState | null
}
```

`DocumentAnalysis` contains workflow ID, definition/companion revisions, contract digest, issues, optional projection, and `structurallyValid`.

- [ ] **Step 2: Write failing revision tests**

Test that edits increment only the edited document revision, saved revision changes only after a confirmed write, a removed companion increments the pair generation, and `isAnalysisCurrent(pair, response)` requires exact definition/companion revisions plus contract digest.

Use fast-check to generate response orderings and prove that accepting responses through `acceptAnalysis()` never moves the active analysis backward.

- [ ] **Step 3: Run revision tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/documents/revisions.test.ts src/workers/document-client.test.ts
```

Expected: FAIL because revision/client functions are absent.

- [ ] **Step 4: Implement revision-safe client and worker protocol**

Use a protocol union with `contract-register` and `analyze` requests. `contract-register` carries validated contract JSON plus its digest into the worker cache. `analyze` contains request ID, workflow ID, exact texts/revisions, profile, contract digest, and reason (`edit`, `contract-change`, `open`, `explicit-validate`). Responses echo every identity field. An analyze request for an unregistered digest returns `contract_not_registered`; the worker never fetches a contract.

`DocumentClient.schedule(pair, contract)` debounces ordinary edits by 180ms, immediately processes open/explicit validation, and cancels only timers—not already running worker work. Completed stale responses are ignored by identity comparison.

The initial worker calls a temporary `analyzeWorkflowPair()` import that Task 3 completes. Until then, create the function signature returning a failing `analysis_not_implemented` issue so the worker compiles but the Task 3 tests remain red.

- [ ] **Step 5: Verify revision invariants**

Run:

```bash
npm run test:unit -- src/lib/documents/revisions.test.ts src/workers/document-client.test.ts
npm run check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/documents src/workers src/stores/documents.ts
git commit -m "feat: add revision-safe document analysis pipeline"
```

---

### Task 2: Parse YAML 1.2 without losing source information

**Files:**
- Create: `src/lib/yaml/types.ts`
- Create: `src/lib/yaml/parse-document.ts`
- Create: `src/lib/yaml/parse-document.test.ts`
- Create: `tests/fixtures/yaml/comments-and-styles.yaml`
- Create: `tests/fixtures/yaml/anchors-and-aliases.yaml`
- Create: `tests/fixtures/yaml/duplicate-keys.yaml`
- Create: `tests/fixtures/yaml/multiple-documents.yaml`

**Interfaces:**
- Consumes: raw text, document kind, and maximum byte count.
- Produces: `ParsedYamlDocument`, `YamlParseResult`, and `parseWorkflowYaml(text, options)`.

- [ ] **Step 1: Write the parser corpus tests**

Tests must assert:

- an empty file reports `empty_document`;
- a sequence/scalar root reports `root_must_be_mapping`;
- duplicate keys report `duplicate_mapping_key` with line/column;
- multiple documents report `multiple_yaml_documents`;
- invalid UTF-16 surrogate input reports `invalid_unicode`;
- UTF-8 length over `maxBytes` reports `document_too_large`;
- anchors/aliases parse without expansion in the retained document;
- comments, flow collections, quoted scalars, and block scalar kinds remain observable; and
- parser diagnostics are deterministic across two calls.

- [ ] **Step 2: Run parser tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/yaml/parse-document.test.ts
```

Expected: FAIL because `parseWorkflowYaml` is absent.

- [ ] **Step 3: Implement strict source-preserving parsing**

Use `parseAllDocuments(text, { version: '1.2', strict: true, uniqueKeys: true, keepSourceTokens: true, prettyErrors: false })`. Convert library errors/warnings into stable app issues without exposing stack traces. Retain the first `Document` only when exactly one document exists and it has no syntax errors.

Return source ranges through YAML node `range` data and a precomputed line-start table. Do not call `toJS()` until Task 3 requests a semantic value.

- [ ] **Step 4: Verify parser behavior**

Run:

```bash
npm run test:unit -- src/lib/yaml/parse-document.test.ts
npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/yaml tests/fixtures/yaml
git commit -m "feat: add source-preserving yaml parser"
```

---

### Task 3: Implement contract and DAG-semantic analysis

**Files:**
- Create: `src/lib/validation/schema-validator.ts`
- Create: `src/lib/validation/schema-validator.test.ts`
- Create: `src/lib/validation/dag-validator.ts`
- Create: `src/lib/validation/dag-validator.test.ts`
- Create: `src/lib/validation/analyze-workflow.ts`
- Create: `src/lib/validation/analyze-workflow.test.ts`
- Create: `src/lib/projection/types.ts`
- Create: `src/lib/projection/project-workflow.ts`
- Create: `tests/fixtures/workflows/valid-minimal.yaml`
- Create: `tests/fixtures/workflows/invalid-cycle.yaml`
- Create: `tests/fixtures/workflows/invalid-reference.yaml`
- Modify: `src/workers/document-worker.ts`

**Interfaces:**
- Consumes: parsed definition/companion documents and `AuthoringContract`.
- Produces: `WorkflowProjection`, `ProjectedNode`, `ProjectedEdge`, `compileContractValidators(contract)`, `validateDag(projection, rules)`, and `analyzeWorkflowPair(request, contract)`.

- [ ] **Step 1: Define projection types and failing behavior tests**

Use these minimum projection types:

```ts
export interface ProjectedNode {
  id: string
  kind: string
  value: unknown
  dependsOn: readonly string[]
  options: Readonly<Record<string, unknown>>
  source: { path: string; start: number; end: number }
}

export interface WorkflowProjection {
  name: string
  description: string
  profile: WorkflowProfile
  nodes: readonly ProjectedNode[]
  edges: readonly { id: string; source: string; target: string }[]
  definition: Readonly<Record<string, unknown>>
  companion: Readonly<Record<string, unknown>> | null
}
```

Schema tests assert Draft 2020-12 behavior, Archon additional-property errors, legacy unknown-field warning projection, required fields, and stable YAML-path mapping. DAG tests assert duplicate IDs, missing/self/duplicate dependencies, cycles, missing references, non-upstream references, and deterministic topological order.

Property tests generate arbitrary acyclic dependency lists and assert every emitted edge references existing nodes and that adding an ancestor-to-descendant back edge is rejected.

- [ ] **Step 2: Run validation tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/validation
```

Expected: FAIL because validators and projector are absent.

- [ ] **Step 3: Implement schema validation**

Use `Ajv2020` with `allErrors: true`, `strict: true`, and format validation limited to formats actually declared by the contract. Compile validators once per contract digest and cache the pair.

Map Ajv instance paths to YAML source nodes. Contract status annotations produce compatibility issues; only actual schema violations are blocking. Never infer runtime availability from schema success.

- [ ] **Step 4: Implement projection and semantic rules**

Project exactly one node kind using the contract's node-kind descriptors. Use a Kahn topological pass for cycle detection and a memoized ancestor set for upstream-reference validation. Reference parsing uses contract-published rule parameters; the app may support the Hermes `$ID.output(.path)*` rule ID but may not hard-code a second field inventory.

Edges use stable ID `dependency:<source>-><target>`.

- [ ] **Step 5: Wire pair analysis into the worker**

The worker loads the active contract by digest from the cache populated by `contract-register`, parses both files, validates each schema, validates pair/profile rules, then validates/projects the DAG. A missing companion selects `hermes-legacy`; an explicit companion profile must match the registered contract profile or emit `contract_profile_mismatch`. It returns a projection only when syntax, contract, and semantic layers have no blocking issue.

- [ ] **Step 6: Verify analysis behavior**

Run:

```bash
npm run test:unit -- src/lib/validation src/workers/document-client.test.ts
npm run check
```

Expected: PASS, including stale-response suppression.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation src/lib/projection src/workers/document-worker.ts tests/fixtures/workflows
git commit -m "feat: validate and project workflow dag yaml"
```

---

### Task 4: Add source-preserving YAML transactions and undo/redo

**Files:**
- Create: `src/lib/yaml/mutations.ts`
- Create: `src/lib/yaml/patch-document.ts`
- Create: `src/lib/yaml/patch-document.test.ts`
- Create: `src/lib/documents/transactions.ts`
- Create: `src/lib/documents/transactions.test.ts`
- Create: `src/stores/history.ts`
- Create: `tests/fixtures/yaml/patch-golden/`

**Interfaces:**
- Consumes: current `WorkflowPairText`, active contract, and typed mutation.
- Produces: `WorkflowMutation`, `YamlTransaction`, `applyWorkflowMutation(pair, mutation, contract)`, `undoTransaction()`, and `redoTransaction()`.

- [ ] **Step 1: Define mutation union and golden tests**

Define:

```ts
export type WorkflowMutation =
  | { type: 'set-field'; document: DocumentKind; path: readonly (string | number)[]; value: unknown }
  | { type: 'delete-field'; document: DocumentKind; path: readonly (string | number)[] }
  | { type: 'add-node'; node: Record<string, unknown>; afterNodeId?: string }
  | { type: 'delete-node'; nodeId: string }
  | { type: 'rename-node'; from: string; to: string }
  | { type: 'set-dependencies'; nodeId: string; dependsOn: readonly string[] }
  | { type: 'replace-document'; document: DocumentKind; text: string }
```

Golden tests must cover set/delete nested fields, append node, delete node, rename dependency/reference occurrences, quoted IDs, multiline strings, flow collections, comments before/after edited keys, aliases, and ambiguous alias refusal.

For every golden case, assert reparsed semantics plus byte equality of designated untouched source slices. Do not assert full-file snapshots when only an invariant matters.

- [ ] **Step 2: Run patch tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/yaml/patch-document.test.ts src/lib/documents/transactions.test.ts
```

Expected: FAIL because mutation support is absent.

- [ ] **Step 3: Prove `yaml` Document mutation fidelity**

Implement the smallest set/delete patch through retained `Document` nodes and serialization. Run the golden tests before building graph UI.

If serialization changes designated untouched slices, do not weaken the tests. Replace whole-document serialization for that mutation with source-range edits derived from CST ranges, applied from highest offset to lowest. Record the chosen patch strategy in a module comment and the design's risk table.

- [ ] **Step 4: Implement semantic node transactions**

`rename-node` updates the node ID, exact dependency entries, and contract-recognized reference fields in one proposed document, then analyzes the result before returning it. `delete-node` returns a typed `mutation_requires_resolution` result when unresolved textual references remain. `set-dependencies` rejects a proposed invalid DAG before returning text.

Transactions contain before/after text for both documents, revisions, mutation label, and selection hints. One user command yields one transaction even if both files change.

- [ ] **Step 5: Implement bounded undo/redo**

Keep at most 200 transactions or 16 MiB of before/after text, whichever is reached first. A new transaction clears redo. Undo/redo applies exact text only when current revisions match the transaction boundary; otherwise it returns `history_revision_conflict`.

- [ ] **Step 6: Verify mutation invariants**

Run:

```bash
npm run test:unit -- src/lib/yaml/patch-document.test.ts src/lib/documents/transactions.test.ts src/lib/validation
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit the CST go/no-go gate**

```bash
git add src/lib/yaml src/lib/documents/transactions.ts src/lib/documents/transactions.test.ts src/stores/history.ts tests/fixtures/yaml/patch-golden
git commit -m "feat: add source-preserving yaml transactions"
```

Do not start canvas implementation unless this commit's corpus passes without weakened preservation assertions.

---

### Task 5: Discover and pair workflows in a deterministic workspace tree

**Files:**
- Create: `src/lib/workspace/types.ts`
- Create: `src/lib/workspace/pair-workflows.ts`
- Create: `src/lib/workspace/pair-workflows.test.ts`
- Create: `src/lib/workspace/build-tree.ts`
- Create: `src/lib/workspace/build-tree.test.ts`
- Create: `src/features/workspace/Explorer.svelte`
- Create: `src/features/workspace/Explorer.test.ts`
- Create: `src/stores/workspace.ts`
- Modify: `src/app/App.svelte`

**Interfaces:**
- Consumes: normalized relative file entries from the native bridge.
- Produces: `WorkspaceEntry`, `WorkflowPairEntry`, `OrphanCompanionEntry`, `pairWorkflowFiles(entries)`, `buildWorkspaceTree(entries)`, and `$workspace`.

- [ ] **Step 1: Write pairing and ordering tests**

Test `.yaml`/`.yml` definitions, canonical `.hermes.yaml` companions, orphan companions, same-stem files in different folders, case-sensitive names on case-sensitive platforms, platform-normalized `/` separators, deterministic locale-independent ordering, excluded `.git`/dependency/build directories, and symlink entries already marked unsafe by native scanning.

The canonical pair for `flows/a.yml` is `flows/a.hermes.yaml`, not `flows/a.hermes.yml`.

- [ ] **Step 2: Run workspace tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/workspace src/features/workspace/Explorer.test.ts
```

Expected: FAIL because pairing/tree/UI are absent.

- [ ] **Step 3: Implement pure pairing and tree construction**

Never use host path APIs in renderer pairing; accept normalized relative paths from Rust. Exclude companions from definition candidates before pairing. Produce stable IDs from workspace ID plus relative definition path, not content hash.

- [ ] **Step 4: Render keyboard-accessible Explorer**

Use tree semantics, roving focus, expand/collapse via arrows, Enter to open, and distinct paired/legacy/orphan/read-only resource states. Do not load file content merely to render the tree.

- [ ] **Step 5: Verify workspace UI**

Run:

```bash
npm run test:unit -- src/lib/workspace src/features/workspace/Explorer.test.ts
npm run check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace src/features/workspace src/stores/workspace.ts src/app/App.svelte
git commit -m "feat: add paired workflow explorer"
```

---

### Task 6: Implement scoped native file operations and watching

**Files:**
- Create: `src-tauri/src/workspace/mod.rs`
- Create: `src-tauri/src/workspace/paths.rs`
- Create: `src-tauri/src/workspace/files.rs`
- Create: `src-tauri/src/workspace/watcher.rs`
- Create: `src-tauri/src/workspace/tests.rs`
- Create: `src/lib/native/workspace-api.ts`
- Create: `src/lib/native/workspace-api.test.ts`
- Modify: `src/lib/native/types.ts`
- Modify: `src/lib/native/tauri-bridge.ts`
- Modify: `src/lib/native/browser-bridge.ts`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: selected folder from Tauri dialog and exact relative paths.
- Produces Rust commands `workspace_set_root`, `workspace_scan`, `workspace_read`, `workspace_write`, `workspace_rename_pair`, `workspace_trash_paths`; events `workspace://changed`; bridge methods with matching camel-case TypeScript results.

- [ ] **Step 1: Add native dependencies and write failing Rust path tests**

Add `notify = "8.2.0"`, `serde = { version = "1", features = ["derive"] }`, `sha2 = "0.11"`, `tempfile = "3.27"`, and `trash = "5.2.6"`.

Tests must reject absolute relative paths, `..`, NUL, empty paths, symlink escape, a root that disappears, and rename destination collisions. Tests must accept Unicode and spaces inside the root.

- [ ] **Step 2: Run Rust tests to verify failure**

Run:

```bash
npm run test:rust -- workspace
```

Expected: FAIL because workspace modules are absent.

- [ ] **Step 3: Implement workspace state and bounded scan/read**

Keep the canonical selected root in managed Rust state. Re-resolve containment immediately before every operation. Scan returns normalized relative entries, kind, size, modified timestamp, and safe symlink status; it skips excluded directories without following directory symlinks.

Read accepts only `.yaml`/`.yml`, refuses files above the contract/global ceiling, decodes UTF-8, and returns SHA-256 content hash plus metadata.

- [ ] **Step 4: Implement revision-checked atomic writes**

`workspace_write` accepts relative path, text, and expected current hash (`null` for create). Re-read/hash immediately before write. On mismatch return `external_revision_conflict` without changing disk.

Write a same-directory temporary file, flush it, atomically replace the target with the platform-appropriate operation, then return the new hash. Preserve permissions where meaningful. Pair save calls this per file and reports exact per-file results; do not claim cross-file atomicity.

- [ ] **Step 5: Implement rename, trash, and watcher events**

Rename validates both exact source/destination paths and moves the definition plus existing companion. Git-aware rename is added in Phase 4; this task uses filesystem behavior for untracked/no-repository workspaces.

`workspace_trash_paths` accepts one or two already contained exact relative file paths and uses the OS trash/recycle API. It supports removing only a companion as well as a complete pair. Watcher events are debounced/coalesced by relative path and include create/modify/remove/rename hints. The renderer always re-reads before accepting content.

- [ ] **Step 6: Extend bridge tests**

Browser bridge uses an in-memory deterministic workspace fixture for E2E. Tauri bridge maps structured native errors to `NativeError { code, message }`; it never parses error strings to determine behavior.

- [ ] **Step 7: Verify native workspace behavior**

Run:

```bash
npm run test:rust
npm run test:unit -- src/lib/native/workspace-api.test.ts
npm run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/workspace src-tauri/src/lib.rs src/lib/native
git commit -m "feat: add scoped atomic workspace operations"
```

---

### Task 7: Add open/save, external-conflict, and recovery flows

**Files:**
- Create: `src/features/documents/document-actions.ts`
- Create: `src/features/documents/document-actions.test.ts`
- Create: `src/features/documents/ExternalChangeDialog.svelte`
- Create: `src/features/documents/ExternalChangeDialog.test.ts`
- Create: `src/features/documents/ProblemsPanel.svelte`
- Create: `src/features/documents/ProblemsPanel.test.ts`
- Create: `src/lib/recovery/types.ts`
- Create: `src/lib/recovery/recovery-store.ts`
- Create: `src/lib/recovery/recovery-store.test.ts`
- Create: `src-tauri/src/recovery.rs`
- Modify: `src/stores/documents.ts`
- Modify: `src/lib/native/types.ts`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: document analysis, native workspace API, and app-data recovery commands.
- Produces: `openWorkflowPair()`, `saveWorkflowPair()`, `resolveExternalChange()`, `RecoveryDraft`, and UI conflict/problem flows.

- [ ] **Step 1: Write failing save-policy tests**

Test that save is disabled for blocking syntax/contract/semantic issues, remains enabled for compatibility/operational warnings, sends expected disk hashes, updates saved revisions only for successful file writes, and reports partial pair failure without discarding either text.

Test clean external changes auto-reload, dirty changes create a three-choice conflict, Keep Mine updates the expected disk baseline only after the user has viewed the diff, Reload Disk replaces text as one history transaction, and Compare is non-mutating.

- [ ] **Step 2: Run document-action tests to verify failure**

Run:

```bash
npm run test:unit -- src/features/documents src/lib/recovery
```

Expected: FAIL because actions and recovery are absent.

- [ ] **Step 3: Implement pair open/save actions**

Open reads both files, creates revision zero, schedules immediate analysis, and does not mark dirty. Save requires a current structurally valid analysis and writes definition first, then companion/create/delete as needed. If the second operation fails, surface exact disk/in-memory state and keep a recovery draft; do not roll back the successful file using stale content.

- [ ] **Step 4: Implement application-data recovery**

Persist dirty drafts after 750ms idle and on close. Records contain app schema version, workflow ID/path, texts/revisions, saved disk hashes, and timestamp. Never write recovery files into the workspace. On successful save remove the matching draft. On launch, offer Recover/Discard only when draft text differs from disk identity.

Keep at most 50 workflow drafts and 64 MiB total, pruning oldest cleanly superseded entries first.

- [ ] **Step 5: Implement conflict and Problems UI**

Conflict choices show exact relative files and timestamps. Problems group by file/layer, expose blocking status, and dispatch focus commands through the central registry. Use `aria-live="polite"` for validation summary changes, not every keystroke diagnostic.

- [ ] **Step 6: Verify open/save/recovery behavior**

Run:

```bash
npm run test:unit -- src/features/documents src/lib/recovery
npm run test:rust
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/documents src/lib/recovery src/stores/documents.ts src-tauri/src/recovery.rs src-tauri/src/lib.rs src/lib/native/types.ts
git commit -m "feat: add safe workflow save and recovery flows"
```

---

### Task 8: Persist canvas and workspace layout outside YAML

**Files:**
- Create: `src/lib/layout/types.ts`
- Create: `src/lib/layout/layout-store.ts`
- Create: `src/lib/layout/layout-store.test.ts`
- Create: `src/lib/layout/place-new-nodes.ts`
- Create: `src/lib/layout/place-new-nodes.test.ts`
- Create: `src/stores/layout.ts`
- Create: `src-tauri/src/layout.rs`
- Modify: `src/lib/native/types.ts`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: workflow ID/path, node IDs/dependencies, viewport, and native app-data commands.
- Produces: `LayoutRecordV1`, `loadLayout()`, `saveLayout()`, `reconcileLayout(projection, saved)`, and `$activeLayout`.

- [ ] **Step 1: Define layout schema and failing reconciliation tests**

Use:

```ts
export interface LayoutRecordV1 {
  schemaVersion: 1
  workspaceId: string
  workflowPath: string
  nodePositions: Record<string, { x: number; y: number }>
  viewport: { x: number; y: number; zoom: number }
  panels: { left: number; right: number; problems: number }
  editorMode: 'visual' | 'split' | 'yaml'
  updatedAt: string
}
```

Tests assert existing nodes retain positions, removed nodes are pruned, new root nodes enter the first free column, new dependent nodes enter to the right of their deepest positioned dependency, invalid numeric positions are ignored, an externally moved unchanged pair can reclaim its unique old layout by saved content hashes, ambiguous hash matches are not guessed, and no layout field appears in serialized workflow YAML.

- [ ] **Step 2: Run layout tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/layout
```

Expected: FAIL because layout support is absent.

- [ ] **Step 3: Implement versioned app-data persistence**

Rust stores `layouts-v1.json` under the application data directory through a serialized command queue and atomic replace. Renderer validates every loaded record. Unknown future versions remain on disk but are not interpreted.

Debounce position persistence 300ms after drag completion; flush on close. Viewport/panel changes persist at 500ms. Do not write during pointer movement.

- [ ] **Step 4: Implement reconciliation and migration actions**

Visual node rename migrates the exact position key. App-driven pair rename migrates workflow path. A watcher-detected external move migrates only when definition/companion saved hashes uniquely match one missing prior pair record. Manual YAML rename migrates position only when one removed and one added node have identical kind/value/options/dependency shape after replacing the ID; ambiguous matches use new-node placement.

- [ ] **Step 5: Verify layout persistence**

Run:

```bash
npm run test:unit -- src/lib/layout
npm run test:rust
npm run check
```

Expected: PASS.

- [ ] **Step 6: Run the Phase 2 gate and commit**

Run:

```bash
npm run verify
npm run build
```

Expected: PASS.

Commit:

```bash
git add src/lib/layout src/stores/layout.ts src-tauri/src/layout.rs src-tauri/src/lib.rs src/lib/native/types.ts
git commit -m "feat: persist workflow canvas layout"
```

---

### Task 9: Complete folder, workflow-pair, import, and export UX

**Files:**
- Create: `src/features/workspace/workspace-actions.ts`
- Create: `src/features/workspace/workspace-actions.test.ts`
- Create: `src/features/workspace/OpenWorkspace.svelte`
- Create: `src/features/workspace/OpenWorkspace.test.ts`
- Create: `src/features/workspace/QuickOpen.svelte`
- Create: `src/features/workspace/QuickOpen.test.ts`
- Create: `src/features/workspace/NewWorkflowDialog.svelte`
- Create: `src/features/workspace/NewWorkflowDialog.test.ts`
- Create: `src/features/workspace/WorkflowContextMenu.svelte`
- Create: `src/features/workspace/ImportExportDialog.svelte`
- Create: `src/lib/workspace/recent-workspaces.ts`
- Create: `src/lib/workspace/recent-workspaces.test.ts`
- Create: `src-tauri/src/workspace/dialogs.rs`
- Create: `src-tauri/src/startup.rs`
- Modify: `src-tauri/src/workspace/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/native/types.ts`
- Modify: `src/lib/native/tauri-bridge.ts`
- Modify: `src/lib/native/browser-bridge.ts`
- Modify: `src/lib/commands/registry.ts`
- Modify: `src/features/workspace/Explorer.svelte`
- Modify: `src/app/App.svelte`

**Interfaces:**
- Consumes: native workspace primitives, production contract defaults, pair analysis, and command registry.
- Produces: `openWorkspace()`, `createWorkflow()`, `duplicateWorkflow()`, `renameWorkflow()`, `createCompanion()`, `removeCompanion()`, `trashWorkflow()`, `importWorkflow()`, `exportWorkflow()`, recent workspace state, Quick Open, folder drop, and startup-path handling.

- [ ] **Step 1: Write failing workflow-action tests**

Test:

- Open Folder updates the scoped root only after selection;
- cancelled selection leaves the current workspace unchanged;
- recent folders are deduplicated, missing folders are marked unavailable, and no more than 20 persist;
- New Workflow requires name, description, profile, first node kind, unique first node ID, and all required first-node values before writing;
- Duplicate copies exact definition/companion text to collision-safe names;
- Rename changes both canonical files and migrates document/layout identities;
- Create Companion writes only contract-supported metadata and selected profile;
- Remove Companion previews the effective-profile change and trashes only that file;
- Trash Workflow names both exact files and closes the document only after success;
- importing invalid YAML opens an unsaved draft and does not copy it into the workspace;
- importing valid YAML copies a collision-safe pair;
- export refuses blocking issues, confirms collisions, and writes only YAML pair files; and
- a startup folder/file argument is accepted only after the same containment/selection flow.

- [ ] **Step 2: Run action tests to verify failure**

Run:

```bash
npm run test:unit -- src/features/workspace src/lib/workspace/recent-workspaces.test.ts
```

Expected: FAIL because the full workspace action surface is absent.

- [ ] **Step 3: Implement folder selection, recent workspaces, and startup paths**

Native dialog commands return selected paths but do not grant permanent broad capabilities. `workspace_set_root` performs canonical validation. Register Open Folder and Quick Open commands. Accept Tauri file-drop events for folders and process startup arguments only when they resolve to a directory or `.yaml`/`.yml` file; never treat other arguments as commands.

Persist recent roots in app data with last-opened timestamp. Opening a definition file selects its parent as workspace and activates the pair. Opening a companion activates its matching definition or shows the orphan state.

- [ ] **Step 4: Implement create, duplicate, rename, companion, and trash actions**

Generate New Workflow through the active contract so the first disk write is syntactically and structurally valid. Default to `archon-2026-07` when its production contract is available; otherwise offer legacy explicitly. Use `.yaml` for newly created definitions.

Duplicate preserves exact YAML/comments. Rename uses scoped filesystem rename in this phase and delegates to exact-path `git mv` after Phase 4 detects tracked files. Every destructive action shows exact affected paths and uses OS trash.

- [ ] **Step 5: Implement import and export**

Import reads a user-selected definition and canonical companion through one-time exact file permissions, analyzes them against the chosen profile, and either copies a valid pair or opens invalid content as an unsaved recovery-backed draft. It never rewrites imported syntax during copy.

Export requires current structurally valid analysis, lets the user select an exact destination directory, confirms existing filename collisions, and writes only the definition plus optional companion. Layout, settings, logs, contracts, and brand data are never exported.

- [ ] **Step 6: Implement Quick Open and context menus**

Quick Open searches paired workflow name/path without reading contents. Context commands derive from the central registry and include Open, Duplicate Pair, Rename Pair, Create/Remove Companion, Export, and Move Pair to Trash. Context menus have no entrance animation and remain keyboard-operable.

- [ ] **Step 7: Verify workspace UX and phase gate**

Run:

```bash
npm run test:unit -- src/features/workspace src/lib/workspace src/lib/layout
npm run test:rust
npm run verify
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/workspace src/lib/workspace src-tauri/src/workspace src-tauri/src/startup.rs src-tauri/src/lib.rs src/lib/native src/lib/commands/registry.ts src/app/App.svelte
git commit -m "feat: complete workflow workspace actions"
```
