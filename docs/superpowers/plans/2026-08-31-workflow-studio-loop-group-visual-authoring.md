# Workflow Studio loop-group visual authoring implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete, CST-preserving visual authoring for Hermes v6 `loop_group` workflows while keeping Hermes as the sole workflow-language authority and preserving the Studio's per-scope 250-node/500-edge interaction contract.

**Architecture:** First amend Hermes on an isolated branch from its latest `base` so the generated authoring contract describes scoped DAGs and a deterministic conformance corpus proves valid and invalid loop-group behavior. Then branch Workflow Studio from its own `base`, synchronize those exact generated artifacts, and generalize the existing projection, validation, mutation, layout, and canvas pipelines around an explicit graph scope. The outer workflow continues to show each loop group as one compound node; drilling in swaps the active visual scope without flattening or persisting a second graph model.

**Tech Stack:** Python 3.11, JSON Schema, argparse, pytest via `scripts/run_tests.sh`; Tauri 2, Svelte 5, TypeScript 6, Nanostores, Svelte Flow, `yaml` CST documents, Vitest/Svelte Testing Library, fast-check, Playwright Chromium/WebKit.

**Spec:** `docs/superpowers/specs/2026-08-31-workflow-studio-loop-group-visual-authoring-design.md`

## Branches and execution boundaries

- Hermes source: `/Users/coreyellis/Developer/personal/github.com/cmetech/hermes-agent`
- Hermes branch: `feat/workflow-studio-loop-group-contract`, created from the latest `origin/base` in a new isolated Hermes worktree. Do not switch or edit the existing Hermes checkout on `main`.
- Workflow Studio source: `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio`
- Workflow Studio branch: `feat/loop-group-visual-authoring`, created from the latest local `base` after this plan is committed.
- Do not merge the Hermes branch until its complete review and verification gates pass.
- Do not begin Studio contract synchronization until the exact reviewed Hermes contract and corpus outputs have stable digests.
- Do not merge the Studio branch until the Hermes contract branch has been integrated into Hermes `base` and Studio's full verification gates pass against that integrated authority.
- Keep only one implementation task writing shared files at a time. With subagent-driven execution, dispatch a fresh implementation agent per task, then run specification-compliance review followed by code-quality review before committing.
- Use `superpowers:using-git-worktrees` when creating both implementation worktrees, `superpowers:test-driven-development` for every behavior change, `superpowers:systematic-debugging` for unexpected failures, `superpowers:requesting-code-review` at every task boundary, `superpowers:verification-before-completion` before every passing or completion claim, and `superpowers:finishing-a-development-branch` only after all gates pass.
- Use `apply_patch` for hand edits. Preserve unrelated user changes. Do not modify Hermes runtime execution behavior in this project.

## Global invariants

- YAML remains the sole workflow authority. Never persist a competing graph model.
- Workflow output remains definition YAML plus optional companion YAML. Scope, selection, viewport, and editor layout belong only in Studio state.
- Targeted edits preserve comments, key order, scalar style, anchors, aliases, and unrelated or unsupported YAML whenever the CST permits it.
- Never silently drop unknown YAML.
- Never commit a cycle, self-edge, duplicate dependency, unresolved dependency, invalid scoped reference, forbidden body kind, nested group, or out-of-contract work product.
- New groups begin as `loop_group: { nodes: [] }`. This is an intentionally repairable but unsavable draft; no dummy node, `until`, or iteration count is invented.
- Hermes normalizer v6 remains authoritative for loop-group fields, allowed body kinds, reference visibility, primary-sink selection, and language bounds.
- Studio interaction limits remain 250 nodes and 500 edges per visual scope. A valid Hermes scope above those limits is preserved, validated, and editable as YAML while only that visual scope becomes capacity-limited.
- Do not parse YAML, validate graphs, compute layout, query Git, perform native work, or access files during pointer-move frames.
- Rust remains limited to privileged native operations. Scoped language behavior stays in testable TypeScript.
- Git integration remains local-only. Do not add application remotes, authentication, push, pull, merge, rebase, reset, or background commits.
- The application remains usable offline, at 1024x700, at 200% zoom, in Chromium and WebKit, with keyboard navigation, visible focus, reduced motion, and forced colors.
- Retain the 250-node/500-edge performance contract for both root and loop-body scopes.

---

## File structure and responsibilities

### Hermes additions

- `plugins/workflow/language_schema.py` — generated authoring-contract descriptors for scoped DAG topology, scoped references, primary sinks, and bounds.
- `plugins/workflow/language_conformance.py` — deterministic, bounded valid/invalid YAML corpus derived from Hermes language authority.
- `plugins/workflow/schema_cli.py` — shared parser and stable JSON emission for both the contract and corpus.
- `plugins/workflow/cli.py` — registers the new read-only `workflow schema-corpus` command.
- `tests/plugins/workflow/test_language_schema.py` — semantic-rule descriptor shape and profile isolation.
- `tests/plugins/workflow/test_language_conformance.py` — corpus determinism, coverage, and agreement with Hermes validation.
- `tests/plugins/workflow/test_installed_distribution_e2e.py` — installed CLI availability and output identity.

### Workflow Studio additions

- `src/lib/contract/scoped-dag-rule.ts` — typed reader for Hermes scoped graph and reference descriptors; rejects unsupported semantics instead of guessing.
- `src/lib/contract/conformance.ts` — typed reader for the bundled Hermes corpus.
- `src/lib/projection/graph-scopes.ts` — discovers root and loop-body graph scopes from the contract and YAML projection.
- `src/lib/validation/scoped-dag-validator.ts` — validates topology and current/outer/previous-iteration reference visibility per scope.
- `src/lib/validation/loop-group-work-product.ts` — mirrors the contract-declared bounded work calculation without encoding field inventories.
- `src/lib/yaml/graph-scope.ts` — resolves a stable graph scope to its current CST path after reparsing.
- `src/stores/canvas-scope.ts` — active-scope navigation and scope-local selection/viewport state.
- `src/features/canvas/GraphScopeHeader.svelte` — breadcrumb/back control for the drilled-in workspace.
- `src/features/canvas/LoopGroupScopeBar.svelte` — outer-input and `$LOOP_PREV` reference guidance with copy/insert actions.
- `src/features/canvas/LoopGroupEmptyState.svelte` — repair-oriented empty body presentation.
- `tests/e2e/loop-group-authoring.spec.ts` — cross-engine drill-in, editing, restoration, keyboard, zoom, and save-gating behavior.
- `tests/performance/scoped-canvas-performance.test.ts` — root/body scope performance and pointer-frame isolation.

### Existing ownership retained

- `src/lib/contract/types.ts`, `contract-loader.ts`, and sync scripts own contract envelope compatibility and bundled integrity.
- `src/lib/projection/project-workflow.ts` remains the pure YAML-to-projection entry point.
- `src/lib/yaml/patch-document.ts` remains the sole targeted CST mutation entry point.
- `src/lib/validation/analyze-workflow.ts` remains the analysis coordinator and worker boundary.
- `src/features/canvas/GraphCanvas.svelte` renders one supplied `ProjectedGraph`; it does not discover scopes or own YAML.
- `src/app/App.svelte` composes stores and feature components but does not absorb scoped graph business logic.

---

## Phase A — amend the Hermes authoring authority

### Task 1: Publish machine-readable scoped graph semantics

**Repository:** Hermes isolated worktree on `feat/workflow-studio-loop-group-contract`

**Files:**
- Modify: `plugins/workflow/language_schema.py`
- Modify: `tests/plugins/workflow/test_language_schema.py`
- Modify: `tests/plugins/workflow/test_phase6_language.py`

**Interfaces:**
- Produces versioned semantic descriptors consumed by Studio.
- Does not change normalization, admission, scheduling, or execution.

- [ ] **Step 1: Create the Hermes implementation worktree from the latest base**

Use the worktree skill to verify branch state, fetch `origin/base`, and create an isolated checkout without touching the existing `main` checkout:

```bash
git -C /Users/coreyellis/Developer/personal/github.com/cmetech/hermes-agent fetch origin base
git -C /Users/coreyellis/Developer/personal/github.com/cmetech/hermes-agent worktree add \
  /Users/coreyellis/Developer/personal/github.com/cmetech/hermes-agent/.worktrees/workflow-studio-loop-group-contract \
  -b feat/workflow-studio-loop-group-contract origin/base
```

Confirm the worktree is clean and its merge base is `origin/base` before editing.

- [ ] **Step 2: Add failing descriptor tests**

Assert the Archon v6 contract publishes stable, JSON-serializable descriptors equivalent to:

```python
rules = {rule["kind"]: rule for rule in contract["semantic_rules"]}

scoped = rules["scoped-dag-topology-v1"]
assert scoped["group_kind"] == "loop_group"
assert scoped["body_path"] == ["loop_group", "nodes"]
assert scoped["node_id_field"] == "id"
assert scoped["depends_on_field"] == "depends_on"
assert scoped["max_depth"] == 1
assert scoped["max_nodes"] == 512
assert scoped["max_edges"] == 4096
assert scoped["primary_sink"] == "first-terminal-in-definition-order"

references = rules["scoped-output-reference-v1"]
assert references["current_scope"]["requires_direct_dependency"] is True
assert references["outer_scope"]["requires_group_dependency"] is True
assert references["previous_iteration"]["prefix"] == "$LOOP_PREV."

work = rules["loop-group-work-product-v1"]
assert work["limit"] == 4096
assert work["group_iterations_path"] == ["loop_group", "max_iterations"]
assert work["ordinary_loop_multiplier_path"] == ["loop", "max_iterations"]
assert work["command_prompt_default_retries"] == 2
assert work["other_default_retries"] == 0
assert work["approval_default_max_attempts"] == 3
```

Also assert the descriptor publishes:

- the exact body node kinds allowed by Hermes v6;
- explicit rejection of `include`, runtime workflow nodes, nested `loop_group`, and group-level retry;
- the loop-group fields and numeric bounds already enforced by Hermes;
- scoped companion node paths (`group/child`);
- stable validation codes for topology, visibility, nesting, capacity, and work-product failures;
- the two bounded work accumulators and the exact multiplier/retry fields and defaults already used by Hermes admission;
- absence of scoped descriptors from profiles that do not support loop groups.

- [ ] **Step 3: Run the focused tests and confirm red**

```bash
scripts/run_tests.sh \
  tests/plugins/workflow/test_language_schema.py \
  tests/plugins/workflow/test_phase6_language.py -v
```

Expected failure: the current contract exposes loop-group JSON Schema fields but has no complete scoped topology/reference descriptors.

- [ ] **Step 4: Implement the smallest contract-only amendment**

Build descriptor values from existing Hermes constants and schema definitions. Do not restate independent field inventories inside a second subsystem. Keep the output deterministic and compatible with the existing contract envelope.

The consumer-facing shape must be explicit enough that Studio can answer all of these questions without Hermes-specific guesses:

```python
{
    "kind": "scoped-dag-topology-v1",
    "group_kind": "loop_group",
    "body_path": ["loop_group", "nodes"],
    "node_id_field": "id",
    "depends_on_field": "depends_on",
    "allowed_node_kinds": [...],
    "forbidden_node_kinds": [...],
    "max_depth": 1,
    "max_nodes": 512,
    "max_edges": 4096,
    "primary_sink": "first-terminal-in-definition-order",
    "validation_codes": {...},
}
```

Publish `loop-group-work-product-v1` from the constants and calculations that already drive admission. It must describe executions and attempts separately, group-iteration multiplication, ordinary-loop multiplication, retry/on-reject paths and defaults, and the shared 4,096 limit. Studio must not reverse-engineer or independently freeze this arithmetic.

- [ ] **Step 5: Verify determinism, profile isolation, and existing snapshots**

```bash
scripts/run_tests.sh \
  tests/plugins/workflow/test_language_schema.py \
  tests/plugins/workflow/test_phase6_language.py \
  tests/plugins/workflow/test_language_snapshot.py \
  tests/plugins/workflow/test_phase5_provider_snapshot.py -v
```

- [ ] **Step 6: Request two-stage review, address findings, and rerun Step 5**

Specification review must verify every semantic claim against Phase 6 implementation authority. Code-quality review must verify there is no duplicated language inventory, nondeterministic ordering, or runtime behavior change.

- [ ] **Step 7: Commit Task 1**

```bash
git add plugins/workflow/language_schema.py \
  tests/plugins/workflow/test_language_schema.py \
  tests/plugins/workflow/test_phase6_language.py
git commit -m "feat(workflow): publish scoped loop group semantics"
```

---

### Task 2: Publish a deterministic Hermes conformance corpus

**Repository:** Hermes isolated worktree

**Files:**
- Create: `plugins/workflow/language_conformance.py`
- Create: `tests/plugins/workflow/test_language_conformance.py`
- Modify: `plugins/workflow/schema_cli.py`
- Modify: `plugins/workflow/cli.py`
- Modify: `hermes_cli/main.py`
- Modify: `tests/plugins/workflow/test_cli.py`
- Modify: `tests/plugins/workflow/test_installed_distribution_e2e.py`

**Interfaces:**
- Produces a bounded JSON corpus whose expectations come from Hermes normalization/validation.
- The CLI is read-only and deterministic.

- [ ] **Step 1: Add failing corpus behavior tests**

Define a versioned envelope and require stable fixture IDs:

```python
corpus = workflow_language_conformance(WorkflowLanguageProfile.ARCHON_2026_07)
assert corpus["format_version"] == 1
assert corpus["profile"] == "archon-2026-07"

cases = {case["id"]: case for case in corpus["cases"]}
assert cases["loop-group-minimal-valid"]["valid"] is True
assert cases["loop-group-empty-body"]["valid"] is False
assert cases["loop-group-current-ref-needs-dependency"]["codes"] == [
    "scoped-reference-missing-dependency"
]
```

Cover at least:

- minimal valid group and all allowed body kinds;
- empty body, duplicate ID, missing dependency, self-edge, cycle, and excess nodes/edges;
- forbidden include, runtime workflow node, nested group, and group retry;
- current-body reference with and without direct dependency;
- outer reference with and without group dependency;
- valid and unknown `$LOOP_PREV` producer;
- multiple terminals proving first terminal in YAML definition order is primary;
- companion `group/child` references;
- work-product boundary and one-over-boundary cases;
- unknown fields that must be preserved but do not alter the expected decision.

The corpus is profile-complete, not loop-only: publish cases for both current profiles, cover every supported node kind and field family, and include the distributed Jira Defect Loop definition/companion as a provenance-tagged Archon case. Legacy cases must prove that v6-only syntax is rejected under the legacy profile.

- [ ] **Step 2: Add failing CLI tests**

Require both direct and installed entry points to support:

```bash
hermes workflow schema-corpus --profile archon-2026-07 --json
```

The output must be byte-stable across two invocations, valid UTF-8 JSON, bounded in case count and byte size, and must identify the exact contract normalizer/version it tests.

Extend the dependency-free early-startup tests in `tests/plugins/workflow/test_cli.py`: both `workflow schema` and `workflow schema-corpus` must bypass recovery, workflow discovery, provider startup, and plugin runtime initialization while preserving global-option parsing, `--help`, invalid-profile errors, and installed invocation behavior.

- [ ] **Step 3: Run focused tests and confirm red**

```bash
scripts/run_tests.sh \
  tests/plugins/workflow/test_language_conformance.py \
  tests/plugins/workflow/test_cli.py \
  tests/plugins/workflow/test_installed_distribution_e2e.py -v
```

Expected failure: no corpus producer or `schema-corpus` command exists.

- [ ] **Step 4: Implement corpus generation and CLI registration**

Keep fixtures deterministic and data-only. Each case must contain definition YAML, optional companion YAML, expected validity, stable diagnostic codes with authored document/path/scope, feature tags, and optional expected projection facts. Obtain expected decisions by calling existing Hermes language authorities in tests; do not add a second validator to the corpus module.

Share profile argument and JSON output helpers with `schema_cli.py`. Register `schema-corpus` beside `schema` in `plugins/workflow/cli.py` and route it through a bounded emitter. Generalize the exact-action parsing and read-only startup path in `hermes_cli/main.py` so the two authoring-data commands share the same dependency-neutral boundary; do not broaden the bypass to any other workflow action.

- [ ] **Step 5: Verify corpus authority and installed distribution**

```bash
scripts/run_tests.sh \
  tests/plugins/workflow/test_language_conformance.py \
  tests/plugins/workflow/test_language_schema.py \
  tests/plugins/workflow/test_phase6_language.py \
  tests/plugins/workflow/test_cli.py \
  tests/plugins/workflow/test_installed_distribution_e2e.py -v
```

Generate reviewed artifacts into a temporary directory, never into tracked source by shell redirection:

```bash
.venv/bin/python ./hermes workflow schema --profile archon-2026-07 --json
.venv/bin/python ./hermes workflow schema --profile hermes-legacy --json
.venv/bin/python ./hermes workflow schema-corpus --profile archon-2026-07 --json
.venv/bin/python ./hermes workflow schema-corpus --profile hermes-legacy --json
```

- [ ] **Step 6: Request two-stage review, address findings, and rerun Step 5**

The specification reviewer must compare every case with the Phase 6 design and current validator. The quality reviewer must challenge fixture independence, expected-code stability, bounds, installed packaging, and accidental runtime coupling.

- [ ] **Step 7: Commit Task 2**

```bash
git add plugins/workflow/language_conformance.py \
  plugins/workflow/schema_cli.py \
  plugins/workflow/cli.py \
  hermes_cli/main.py \
  tests/plugins/workflow/test_language_conformance.py \
  tests/plugins/workflow/test_cli.py \
  tests/plugins/workflow/test_installed_distribution_e2e.py
git commit -m "feat(workflow): publish language conformance corpus"
```

---

### Task 3: Gate the Hermes contract branch for Studio consumption

**Repository:** Hermes isolated worktree

**Files:**
- Verify only unless review findings require a targeted correction.

- [ ] **Step 1: Run language and compatibility gates**

```bash
scripts/run_tests.sh \
  tests/plugins/workflow/test_language_schema.py \
  tests/plugins/workflow/test_language_conformance.py \
  tests/plugins/workflow/test_phase3_language.py \
  tests/plugins/workflow/test_phase4_language.py \
  tests/plugins/workflow/test_phase4_snapshot.py \
  tests/plugins/workflow/test_phase5_language.py \
  tests/plugins/workflow/test_phase5_provider_snapshot.py \
  tests/plugins/workflow/test_phase6_language.py \
  tests/plugins/workflow/test_cli.py \
  tests/plugins/workflow/test_installed_distribution_e2e.py -v
```

- [ ] **Step 2: Run Hermes repository-required static and full-test gates**

Read the Hermes worktree's `AGENTS.md` and current repository scripts before execution. Use the repository-prescribed formatter, linter, type checker, and:

```bash
scripts/run_tests.sh
```

- [ ] **Step 3: Capture immutable consumer inputs**

Record in review evidence:

- Hermes commit SHA;
- canonical contract SHA-256;
- canonical corpus SHA-256;
- contract `normalizer_version` and profile;
- exact successful generation commands.

- [ ] **Step 4: Review the complete Hermes branch diff and history**

Verify only contract publication, corpus publication, tests, and CLI exposure changed. Confirm no scheduler, executor, admission, persistence, or runtime semantics changed.

- [ ] **Step 5: Request final branch review and address every finding**

Rerun Steps 1-4 after the final correction. Do not merge yet; the reviewed commit and digests are the fixed authority used by the Studio branch.

---

## Phase B — consume the contract in Workflow Studio

### Task 4: Synchronize the complete Hermes contract and corpus

**Repository:** Workflow Studio isolated worktree on `feat/loop-group-visual-authoring`

**Files:**
- Modify: `src/lib/contract/types.ts`
- Modify: `src/lib/contract/contract-loader.ts`
- Modify: `src/lib/contract/bundled-contracts.ts`
- Create: `src/lib/contract/bundled-contracts.test.ts`
- Create: `src/lib/contract/scoped-dag-rule.ts`
- Create: `src/lib/contract/scoped-dag-rule.test.ts`
- Create: `src/lib/contract/conformance.ts`
- Create: `src/lib/contract/conformance.test.ts`
- Modify: `scripts/sync-contracts.ts`
- Modify: `scripts/sync-contracts.test.ts`
- Modify: `scripts/validate-contracts.ts`
- Modify: `scripts/verify-release-assets.mjs`
- Modify: `contracts/manifest.json`
- Modify: `contracts/README.md`
- Modify: `src-tauri/resources/setup-integrity-v1.json`
- Create or replace: generated files under `contracts/`
- Create: `contracts/archon-2026-07-v6.json`
- Create: `contracts/archon-2026-07-v6.corpus.json`
- Create: `contracts/hermes-legacy-v2.json`
- Create: `contracts/hermes-legacy-v2.corpus.json`
- Delete after manifest migration: `contracts/archon-2026-07-v1.json`
- Delete after manifest migration: `contracts/hermes-legacy-v1.json`

**Interfaces:**
- Consumes only the reviewed Hermes Task 3 outputs.
- Produces typed, capability-checked contract readers and offline bundled artifacts.

- [ ] **Step 1: Create the Studio implementation worktree from `base`**

Use the worktree skill after confirming this design and plan are present on a clean local `base`:

```bash
git worktree add \
  /Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/loop-group-visual-authoring \
  -b feat/loop-group-visual-authoring base
```

- [ ] **Step 2: Add failing reader and synchronization tests**

Require the reader to accept the exact Hermes descriptors and reject incomplete or future-incompatible semantics:

```ts
const capabilities = readScopedDagCapabilities(contract)
expect(capabilities.groupKind).toBe('loop_group')
expect(capabilities.bodyPath).toEqual(['loop_group', 'nodes'])
expect(capabilities.primarySink).toBe('first-terminal-in-definition-order')

expect(() => readScopedDagCapabilities(contractWithoutReferenceRule)).toThrow(
  /scoped output reference capability/i,
)
```

Require synchronization to install the contract and matching corpus atomically, update manifest digests, reject mismatched profile/normalizer identities, and produce no diff on a second run.

Add cache-boundary tests proving a digest, reader-version, widget, semantic-capability, or profile failure leaves the previously active contract intact and returns a specific activation reason. Add coverage that every supported contract field has either a usable widget and documentation topic or an explicit generated non-visual status.

- [ ] **Step 3: Run focused tests and confirm red**

```bash
npm run test:unit -- \
  src/lib/contract/bundled-contracts.test.ts \
  src/lib/contract/scoped-dag-rule.test.ts \
  src/lib/contract/conformance.test.ts \
  scripts/sync-contracts.test.ts
```

- [ ] **Step 4: Implement capability readers and artifact synchronization**

Keep raw extensions forward-compatible, but gate visual authoring on exact understood semantic-rule kinds and versions. A missing or unsupported scoped capability must preserve YAML and select YAML-only mode with a clear reason; it must never infer Hermes rules.

Extend the manifest so every bundled corpus is cryptographically paired with its contract. Update `contracts:check` to validate canonical JSON, digests, identity, deterministic case IDs, size bounds, and offline availability.

- [ ] **Step 5: Import only reviewed generated artifacts**

Use the Task 3 Hermes commit and generation commands. Confirm the resulting SHA-256 values match the recorded review evidence exactly.

- [ ] **Step 6: Verify focused and contract gates**

```bash
npm run test:unit -- \
  src/lib/contract/contract-loader.test.ts \
  src/lib/contract/contract-cache.test.ts \
  src/lib/contract/bundled-contracts.test.ts \
  src/lib/contract/scoped-dag-rule.test.ts \
  src/lib/contract/conformance.test.ts \
  scripts/sync-contracts.test.ts
npm run contracts:check
npm run check
```

- [ ] **Step 7: Request two-stage review, address findings, and rerun Step 6**

- [ ] **Step 8: Commit Task 4**

```bash
git add src/lib/contract scripts contracts src-tauri/resources/setup-integrity-v1.json
git commit -m "feat: synchronize scoped Hermes contract"
```

---

### Task 5: Project explicit root and loop-body graph scopes

**Files:**
- Modify: `src/lib/projection/types.ts`
- Create: `src/lib/projection/graph-scopes.ts`
- Create: `src/lib/projection/graph-scopes.test.ts`
- Modify: `src/lib/projection/project-workflow.ts`
- Create: `src/lib/projection/project-workflow.test.ts`
- Modify: `src/features/canvas/types.ts`
- Modify: `src/features/canvas/project-canvas.ts`
- Modify: `src/features/canvas/project-canvas.test.ts`

**Interfaces:**
- Produces structured-clone-safe `ProjectedGraph[]`; no `Map`, CST node, or Svelte object crosses the worker boundary.
- `GraphCanvas` eventually consumes one `ProjectedGraph`, not the whole workflow.

- [ ] **Step 1: Add failing projection tests**

Lock the public types and lookup behavior:

```ts
export type GraphScopeKey = 'root' | `loop-group:${string}`

export interface ProjectedGraph {
  scope: GraphScope
  editorNodePrefix: string
  sourcePath: readonly (string | number)[]
  sourceRange: { start: number; end: number }
  nodes: readonly ProjectedNode[]
  edges: readonly ProjectedEdge[]
  definitionOrder: readonly string[]
  primarySinkId?: string
  outerInputs: readonly string[]
  issues: readonly ValidationIssue[]
  capacity: { status: 'visual' | 'yaml-only'; nodeCount: number; edgeCount: number }
}

export interface WorkflowProjection {
  name: string
  description?: string
  profile: string
  graphs: readonly ProjectedGraph[]
  definition: unknown
  companion?: unknown
}
```

Test root-only compatibility, one group, several sibling groups, exact source paths/ranges, deterministic editor-only compound IDs, stable keys after reparsing, first terminal selection in YAML order, local child IDs reused across different groups, scope-local findings, immutable workflow identity links without circular objects, unknown fields, and a valid body above Studio's visual capacity.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
npm run test:unit -- \
  src/lib/projection/graph-scopes.test.ts \
  src/lib/projection/project-workflow.test.ts \
  src/features/canvas/project-canvas.test.ts
```

- [ ] **Step 3: Implement the smallest scoped projection**

Discover scopes from the contract's declared group kind/body path. Scope keys use the owning top-level group ID, not array indexes. Preserve the current top-level fields for one compatibility refactor only if necessary, then remove them before this task is committed so there is one graph collection authority.

`projectCanvas` accepts a `ProjectedGraph` and applies the 250/500 interaction limit to that graph only. It returns a typed capacity result instead of truncating nodes or edges.

- [ ] **Step 4: Verify projection and worker serialization**

```bash
npm run test:unit -- \
  src/lib/projection/graph-scopes.test.ts \
  src/lib/projection/project-workflow.test.ts \
  src/features/canvas/project-canvas.test.ts \
  src/lib/validation/analyze-workflow.test.ts
npm run check
```

- [ ] **Step 5: Request two-stage review, address findings, and rerun Step 4**

- [ ] **Step 6: Commit Task 5**

```bash
git add src/lib/projection src/features/canvas/types.ts \
  src/features/canvas/project-canvas.ts src/features/canvas/project-canvas.test.ts
git commit -m "refactor: project workflow graph scopes"
```

---

### Task 6: Validate scoped topology, references, and work bounds

**Files:**
- Create: `src/lib/validation/scoped-dag-validator.ts`
- Create: `src/lib/validation/scoped-dag-validator.test.ts`
- Create: `src/lib/validation/loop-group-work-product.ts`
- Create: `src/lib/validation/loop-group-work-product.test.ts`
- Modify: `src/lib/validation/dag-validator.ts`
- Modify: `src/lib/validation/dag-validator.test.ts`
- Modify: `src/lib/validation/analyze-workflow.ts`
- Modify: `src/lib/validation/analyze-workflow.test.ts`
- Modify: `src/lib/documents/types.ts`
- Modify: `src/features/documents/issue-view-key.ts`
- Modify: `src/features/documents/issue-view-key.test.ts`

**Interfaces:**
- Adds `scopeKey?: GraphScopeKey` and `groupId?: string` to diagnostics while retaining local `nodeId`.
- Uses contract values for paths, kinds, codes, and bounds.

- [ ] **Step 1: Add failing table and property tests**

Drive the validator with the bundled conformance corpus and assert Studio agrees on validity and stable codes for every case:

```ts
for (const testCase of corpus.cases) {
  const result = analyzeFixture(testCase.yaml, contract)
  expect(result.canSave, testCase.id).toBe(testCase.valid)
  expect(result.issues.map(({ code }) => code).sort(), testCase.id).toEqual(
    [...testCase.codes].sort(),
  )
}
```

Add fast-check properties for duplicate IDs, dependency permutations, acyclic ordering, cycle insertion rejection, current-scope direct dependencies, outer group dependencies, outer downstream references to the group output, `$LOOP_PREV` producer membership, and structured output paths. Test all numeric boundaries, including nested work product.

Require every scoped issue to carry document, stable code, severity, blocking state, YAML path, line/column, scope key, group ID, local node ID, field identity, and documentation topic when available. Equivalent repeated issues must receive deterministic occurrence identities that remain unique in the Problems view.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
npm run test:unit -- \
  src/lib/validation/scoped-dag-validator.test.ts \
  src/lib/validation/loop-group-work-product.test.ts \
  src/lib/validation/analyze-workflow.test.ts
```

- [ ] **Step 3: Implement contract-driven validation**

Validate each `ProjectedGraph` independently, then validate cross-scope visibility:

- `$child.output` is local and requires a direct body dependency;
- `$outer.output` names a top-level node that the owning group directly depends on;
- `$LOOP_PREV.child.output` names a known body node and refers only to the previous iteration;
- companion paths use `group/child` exactly as the contract declares;
- the first terminal body node in YAML order is the group output;
- forbidden kinds, nesting, and group retry are blocking errors;
- valid scopes over 250/500 receive a non-blocking visual-capacity advisory, not a language error.

Mirror Hermes work-product arithmetic from declared contract parameters and existing field values. Do not execute scripts or resolve providers.

Keep one worker analysis pass per exact pair revision and contract digest. Test that stale results are discarded across definition revision, companion revision, pair generation, profile, and contract-digest changes; syntax-invalid text retains only the last usable projection as stale/read-only, while only the explicit group draft receives a repairable projection.

- [ ] **Step 4: Verify parity and ordinary DAG regression tests**

```bash
npm run test:unit -- \
  src/lib/validation/dag-validator.test.ts \
  src/lib/validation/scoped-dag-validator.test.ts \
  src/lib/validation/loop-group-work-product.test.ts \
  src/lib/validation/analyze-workflow.test.ts \
  src/lib/contract/conformance.test.ts
npm run check
```

- [ ] **Step 5: Request two-stage review, address findings, and rerun Step 4**

- [ ] **Step 6: Commit Task 6**

```bash
git add src/lib/validation src/lib/documents/types.ts \
  src/features/documents/issue-view-key.ts src/features/documents/issue-view-key.test.ts
git commit -m "feat: validate scoped loop group graphs"
```

---

### Task 7: Make CST mutations scope-aware

**Files:**
- Modify: `src/lib/yaml/mutations.ts`
- Create: `src/lib/yaml/graph-scope.ts`
- Create: `src/lib/yaml/graph-scope.test.ts`
- Modify: `src/lib/yaml/patch-document.ts`
- Modify: `src/lib/yaml/patch-document.test.ts`
- Create: `src/lib/yaml/scoped-mutations.property.test.ts`
- Add fixtures: `tests/fixtures/yaml/patch-golden/loop-group-*.yaml`

**Interfaces:**
- Every node mutation includes a stable `scopeKey`.
- Scope resolution occurs against the current CST immediately before mutation; indexes are not persisted.

- [ ] **Step 1: Add failing golden mutation tests**

Extend graph mutations:

```ts
type ScopedNodeMutation =
  | { type: 'add-node'; scopeKey: GraphScopeKey; node: NewNode; afterNodeId?: string }
  | { type: 'delete-node'; scopeKey: GraphScopeKey; nodeId: string }
  | { type: 'rename-node'; scopeKey: GraphScopeKey; from: string; to: string }
  | { type: 'set-dependencies'; scopeKey: GraphScopeKey; nodeId: string; dependsOn: string[] }
```

Require exact preservation of comments, key order, scalar styles, flow/block collections, multiline values, anchors, aliases, unknown group fields, unrelated outer nodes, sibling groups, and companion YAML. Add bounded mutation-sequence properties for add, group settings, connect, disconnect, rename, delete, duplicate, copy, and paste, asserting acyclicity, scope identity uniqueness, dependency containment, parse/patch/reparse equivalence, and no unrelated CST change. Cover adding an empty group as exactly:

```yaml
- id: repeat_work
  loop_group:
    nodes: []
```

Assert it is representable as a repairable draft but save/export remains blocked until the body becomes valid.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
npm run test:unit -- \
  src/lib/yaml/graph-scope.test.ts \
  src/lib/yaml/patch-document.test.ts \
  src/lib/yaml/scoped-mutations.property.test.ts
```

- [ ] **Step 3: Implement stable scope resolution and targeted patches**

Resolve `loop-group:<groupId>` by finding the current top-level group node through contract-declared paths, then descend to its declared body path. If the group is absent, duplicated, malformed, or no longer a group, fail without changing text and surface a stale-scope diagnostic.

Recognize only the contract-shaped incomplete group as a repairable draft. Permit adding the group, setting either required control, adding its first body node, and deleting its final body node even while other required group pieces remain absent, provided the transaction introduces no unrelated blocking issue and does not worsen scoped topology/reference validity. Every intermediate draft remains visibly invalid and unsavable. Dependency, rename, delete, and reference changes remain transactional: patch a clone/current CST, analyze, and commit text only when permitted. Arbitrary invalid YAML never enters this narrow draft mode.

- [ ] **Step 4: Verify golden files and invalid-operation rollback**

```bash
npm run test:unit -- \
  src/lib/yaml/graph-scope.test.ts \
  src/lib/yaml/patch-document.test.ts \
  src/lib/yaml/scoped-mutations.property.test.ts \
  src/lib/validation/analyze-workflow.test.ts
npm run format:check
npm run check
```

- [ ] **Step 5: Request two-stage review, address findings, and rerun Step 4**

- [ ] **Step 6: Commit Task 7**

```bash
git add src/lib/yaml tests/fixtures/yaml/patch-golden
git commit -m "feat: patch loop group scopes in YAML"
```

---

### Task 8: Preserve scoped referential integrity for rename, delete, and clipboard

**Files:**
- Modify: `src/features/canvas/canvas-actions.ts`
- Modify: `src/features/canvas/canvas-actions.test.ts`
- Modify: `src/features/canvas/duplicate-selection.ts`
- Modify: `src/features/canvas/duplicate-selection.test.ts`
- Modify: `src/features/canvas/DeleteImpactDialog.svelte`
- Modify: `src/features/canvas/DeleteImpactDialog.test.ts`
- Modify: `src/app/App.canvas-authoring.test.ts`

**Interfaces:**
- All impact analysis is scope-qualified.
- Cross-scope paste requires explicit resolution when dependencies or references cannot remain valid.

- [ ] **Step 1: Add failing impact tests**

Cover:

- renaming a body node rewrites local dependencies, `$child.output`, `$LOOP_PREV.child.output`, and companion `group/child` references;
- renaming a group rewrites scope-qualified companion paths and layout scope keys without losing the body;
- deleting a body producer lists all local/current/previous/companion impacts before confirmation;
- deleting a group lists outer dependents and all companion impacts;
- duplicate within one scope rewrites selection-internal dependencies and references;
- paste from root to body or body to another group blocks when incoming edges or scoped references need a user decision;
- cancel leaves exact YAML bytes and selection unchanged.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
npm run test:unit -- \
  src/features/canvas/canvas-actions.test.ts \
  src/features/canvas/duplicate-selection.test.ts \
  src/features/canvas/DeleteImpactDialog.test.ts
```

- [ ] **Step 3: Implement scope-qualified impact analysis**

Reuse the scoped validator/reference parser. Never remove incoming dependencies or rewrite a reference to a different namespace silently. The dialog must name the group and local node for repeated child IDs.

- [ ] **Step 4: Verify action regressions and accessibility**

```bash
npm run test:unit -- \
  src/features/canvas/canvas-actions.test.ts \
  src/features/canvas/duplicate-selection.test.ts \
  src/features/canvas/DeleteImpactDialog.test.ts \
  src/features/inspector/Inspector.test.ts
npm run check
```

- [ ] **Step 5: Request two-stage review, address findings, and rerun Step 4**

- [ ] **Step 6: Commit Task 8**

```bash
git add src/features/canvas src/features/inspector src/app/App.canvas-authoring.test.ts
git commit -m "feat: preserve scoped graph references"
```

---

### Task 9: Migrate layout and canvas state to per-scope records

**Files:**
- Modify: `src/lib/layout/types.ts`
- Modify: `src/lib/layout/layout-store.ts`
- Modify: `src/lib/layout/layout-store.test.ts`
- Modify: `src/stores/canvas.ts`
- Modify: `src/stores/canvas.test.ts`
- Create: `src/stores/canvas-scope.ts`
- Create: `src/stores/canvas-scope.test.ts`
- Modify: `src/stores/layout.ts`

**Interfaces:**
- Migrates layout schema v1 to v2 in application state only.
- Workflow YAML is untouched.

- [ ] **Step 1: Add failing migration and restoration tests**

Define a v2 record equivalent to:

```ts
interface ScopeLayoutV1 {
  nodePositions: Record<string, { x: number; y: number }>
  viewport: { x: number; y: number; zoom: number }
  selectedNodeIds: string[]
  focusTarget?: { kind: 'canvas' | 'node' | 'scope-heading'; nodeId?: string }
  inspector: { tab: string; scrollTop: number }
  canvasScroll: { left: number; top: number }
}

interface LayoutRecordV2 {
  schemaVersion: 2
  workspaceId: string
  workflowPath: string
  activeScopeKey: GraphScopeKey
  scopeLayouts: Record<GraphScopeKey, ScopeLayoutV1>
  panels: PanelLayout
  editorMode: EditorMode
  updatedAt: string
}
```

Test v1-to-v2 migration into `root`, exact independent root/group viewport, selection, focus, Inspector, and scroll restoration, renamed/deleted group cleanup, missing active scope fallback to root with an explanation event, corrupt record recovery, workbench-page round trips, and no layout state written into YAML.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
npm run test:unit -- \
  src/lib/layout/layout-store.test.ts \
  src/stores/canvas.test.ts \
  src/stores/canvas-scope.test.ts
```

- [ ] **Step 3: Implement v2 migration and scope controller**

The controller exposes explicit `enterLoopGroup(groupId)` and `returnToRoot()` operations, stores the outgoing scope before switching, restores the incoming scope after its nodes are projected, and resets only stale identities. Scope switches perform no YAML parse, validation, file I/O, or layout work in pointer handlers.

- [ ] **Step 4: Verify persistence and identity changes**

```bash
npm run test:unit -- \
  src/lib/layout/layout-store.test.ts \
  src/stores/canvas.test.ts \
  src/stores/canvas-scope.test.ts \
  src/features/canvas/reconcile-canvas-selection.test.ts
npm run check
```

- [ ] **Step 5: Request two-stage review, address findings, and rerun Step 4**

- [ ] **Step 6: Commit Task 9**

```bash
git add src/lib/layout src/stores
git commit -m "feat: preserve canvas state by graph scope"
```

---

### Task 10: Render loop groups as compound nodes and drill into bodies

**Files:**
- Modify: `src/features/canvas/WorkflowNode.svelte`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Create: `src/features/canvas/GraphScopeHeader.svelte`
- Create: `src/features/canvas/GraphScopeHeader.test.ts`
- Create: `src/features/canvas/LoopGroupEmptyState.svelte`
- Create: `src/features/canvas/LoopGroupEmptyState.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.canvas-authoring.test.ts`

**Interfaces:**
- Outer canvas renders one group node with status/summary and one activation action.
- Inner canvas receives only the selected `ProjectedGraph`.

- [ ] **Step 1: Add failing component tests**

Require:

- a `loop_group` node announces itself as a group and exposes `Open loop body`;
- its bounded summary reports body-node count, maximum iterations when present, primary output when known, and missing/error status;
- double activation and Enter open the body without initiating a drag;
- the body header identifies workflow and group, with a keyboard-operable Back control;
- Back restores the root scope's prior viewport and selection;
- an empty body renders a repair explanation and Add node action while save remains blocked;
- `Edit group settings` focuses the owning compound container's generated controls;
- a capacity-limited body shows exact YAML-only guidance without affecting the root canvas;
- focus moves to the scope heading on entry and returns to the compound node on exit;
- Escape follows modal/overlay priority before leaving the scope.
- root and body edits share the document's existing single undo/redo history.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
npm run test:unit -- \
  src/features/canvas/GraphCanvas.test.ts \
  src/features/canvas/GraphScopeHeader.test.ts \
  src/features/canvas/LoopGroupEmptyState.test.ts \
  src/app/App.canvas-authoring.test.ts
```

- [ ] **Step 3: Implement the presentational scope switch**

Pass `activeGraph` and callbacks down from the scope store. Keep `App.svelte` thin. The compound node must retain ordinary selection, edge ports, and context actions; its open affordance must not cover ports or intercept permitted node gestures.

- [ ] **Step 4: Verify component, shell, and gesture regressions**

```bash
npm run test:unit -- \
  src/features/canvas/GraphCanvas.test.ts \
  src/features/canvas/GraphScopeHeader.test.ts \
  src/features/canvas/LoopGroupEmptyState.test.ts \
  src/features/canvas/canvas-activation-barrier.test.ts \
  src/app/App.canvas-authoring.test.ts \
  src/app/App.test.ts
npm run check
```

- [ ] **Step 5: Request two-stage review, address findings, and rerun Step 4**

- [ ] **Step 6: Commit Task 10**

```bash
git add src/features/canvas src/app/App.svelte src/app/App.canvas-authoring.test.ts
git commit -m "feat: drill into loop group canvases"
```

---

### Task 11: Add group Inspector, filtered palette, and scope reference guidance

**Files:**
- Modify: `src/features/inspector/Inspector.svelte`
- Modify: `src/features/inspector/Inspector.test.ts`
- Modify: `src/features/canvas/NodePalette.svelte`
- Modify: `src/features/canvas/NodePalette.test.ts`
- Modify: `src/features/canvas/AddNodePicker.svelte`
- Modify: `src/features/canvas/AddNodePicker.test.ts`
- Modify: `src/features/canvas/node-kind-options.ts`
- Create: `src/features/canvas/LoopGroupScopeBar.svelte`
- Create: `src/features/canvas/LoopGroupScopeBar.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.canvas-authoring.test.ts`
- Modify: `src/features/documents/ProblemsPanel.svelte`
- Modify: `src/features/documents/ProblemsPanel.test.ts`

**Interfaces:**
- The group Inspector edits the owning outer node; the body Inspector edits the selected child.
- Allowed body kinds and loop-group fields come from the contract.

- [ ] **Step 1: Add failing behavior tests**

Require:

- adding a group from the root palette creates only the approved empty draft;
- the body palette includes prompt, command, bash, script, approval, cancel, and ordinary loop as declared by the contract;
- it excludes include, runtime workflow, and nested loop group;
- the group Inspector renders `until`, `max_iterations`, `fresh_context`, `until_bash`, `interactive`, `signal_completes`, and `gate_message` from generated descriptors;
- child Inspector paths target the active body's current CST location;
- the scope bar lists valid outer inputs and known `$LOOP_PREV` producers;
- Copy writes the exact reference text, and Insert modifies only the focused compatible field;
- unavailable outer references explain the missing group dependency and offer an explicit dependency change rather than silently creating one;
- repeated IDs in separate groups remain unambiguous to assistive technology.
- selecting a scoped Problem opens its graph, selects its node, focuses its most specific Inspector field or YAML range, and preserves modal/overlay Escape priority.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
npm run test:unit -- \
  src/features/inspector/Inspector.test.ts \
  src/features/canvas/NodePalette.test.ts \
  src/features/canvas/AddNodePicker.test.ts \
  src/features/canvas/LoopGroupScopeBar.test.ts \
  src/features/documents/ProblemsPanel.test.ts
```

- [ ] **Step 3: Implement contract-filtered authoring controls**

Use existing generated field widgets. Resolve wildcard body descriptors against the active scope. Keep reference suggestions advisory until the user explicitly inserts text or approves a dependency mutation. Maintain bounded internal scrolling in Inspector and Problems.

- [ ] **Step 4: Verify authoring and accessibility regressions**

```bash
npm run test:unit -- \
  src/features/inspector/Inspector.test.ts \
  src/features/inspector/widgets/StructuredWidgets.test.ts \
  src/features/canvas/NodePalette.test.ts \
  src/features/canvas/AddNodePicker.test.ts \
  src/features/canvas/LoopGroupScopeBar.test.ts \
  src/features/documents/ProblemsPanel.test.ts \
  src/app/App.canvas-authoring.test.ts
npm run check
```

- [ ] **Step 5: Request two-stage review, address findings, and rerun Step 4**

- [ ] **Step 6: Commit Task 11**

```bash
git add src/features/inspector src/features/canvas src/features/documents \
  src/app/App.svelte src/app/App.canvas-authoring.test.ts
git commit -m "feat: author loop group fields and references"
```

---

### Task 12: Bundle examples, documentation, and drift checks

**Files:**
- Create: `examples/loop-group-current-output/workflow.yaml`
- Create: `examples/loop-group-current-output/workflow.hermes.yaml`
- Create: `examples/loop-group-iteration-context/workflow.yaml`
- Create: `examples/loop-group-iteration-context/workflow.hermes.yaml`
- Create: `examples/loop-group-primary-sink/workflow.yaml`
- Create: `examples/loop-group-primary-sink/workflow.hermes.yaml`
- Modify: `examples/catalog.yaml`
- Modify: `examples/README.md`
- Create: `docs/app-guides/loop-groups.md`
- Modify: `docs/app-guides/conditions-and-outputs.md`
- Modify: `scripts/validate-examples.ts`
- Modify: `src/lib/examples/load-examples.test.ts`
- Modify: `src/features/examples/ExampleGallery.test.ts`
- Modify: `scripts/verify-release-assets.mjs`
- Modify: `src-tauri/resources/setup-integrity-v1.json`

**Interfaces:**
- Examples are offline, contract-valid, and load through the ordinary document path.
- Documentation describes visual and YAML-only capacity behavior honestly.

- [ ] **Step 1: Add failing resource and intent tests**

Add examples for:

- a minimal group with a current-scope output reference;
- an outer input plus `$LOOP_PREV` reference;
- multiple terminal children demonstrating the primary sink;
- a companion using `group/child` paths.

Require every example to validate against the bundled contract/corpus authority and declare an intent that tests its semantic purpose, not merely its presence. Extend the contract drift gate so every supported field has generated widget/documentation coverage or an explicit generated non-visual status, and every corpus feature tag is represented by validation/projection assertions.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
npm run test:unit -- \
  src/lib/examples/load-examples.test.ts \
  src/features/examples/ExampleGallery.test.ts
npm run examples:check
npm run resources:verify
```

- [ ] **Step 3: Implement offline resources and documentation**

Document drill-in navigation, empty repairable drafts, reference namespaces, first-terminal output, capacity limits, save blocking, and YAML fallback. Do not imply Studio can execute workflows or resolve runtime advisories.

- [ ] **Step 4: Verify resources and contract drift**

```bash
npm run contracts:check
npm run examples:check
npm run resources:verify
npm run test:unit -- \
  src/lib/examples/load-examples.test.ts \
  src/features/examples/ExampleGallery.test.ts
```

- [ ] **Step 5: Request two-stage review, address findings, and rerun Step 4**

- [ ] **Step 6: Commit Task 12**

```bash
git add examples docs/app-guides src-tauri/resources \
  src/lib/examples src/features/examples scripts
git commit -m "docs: add loop group authoring resources"
```

---

### Task 13: Prove full authoring, cross-engine behavior, and scoped performance

**Files:**
- Create: `tests/e2e/loop-group-authoring.spec.ts`
- Create: `tests/performance/scoped-canvas-performance.test.ts`
- Modify: `tests/e2e/support.ts`
- Modify: `playwright.config.ts` only if existing project coverage needs correction
- Modify: focused unit/component files only for issues proven by new tests

**Interfaces:**
- Provides release evidence across Chromium and WebKit.
- Does not weaken timeouts, skip failures, or lower existing performance limits.

- [ ] **Step 1: Add failing end-to-end tests**

Exercise the actual UI to:

1. open a bundled loop-group workflow;
2. see a compound outer node;
3. drill in by mouse and keyboard;
4. add, rename, connect, configure, duplicate, and delete children;
5. insert current, outer, and previous-iteration references;
6. return to root and prove exact viewport/selection restoration;
7. reopen the body and prove body viewport/selection restoration;
8. switch through full-workbench pages and preserve exact unsaved YAML, both scopes' state, Inspector state, Problems state, and YAML scroll position;
9. navigate a scoped Problem back to its graph, node, field, and YAML range;
10. preserve comments, key order, scalar style, and unknown fields in resulting YAML;
11. create an empty group, observe blocked save/export, repair it, then save;
12. observe YAML-only mode only for an oversized body scope;
13. retain Inspector and Problems bounded scrolling;
14. verify visible focus, reduced motion, forced colors, screen-reader names, and operability at 1024x700 and 200% zoom.

Run both Chromium and WebKit. Use semantic roles and stable test hooks, not pixel snapshots.

- [ ] **Step 2: Add failing scoped performance and gesture tests**

Measure root and body scopes independently at 250 nodes/500 edges with several hidden groups. Exercise pan, zoom, selection, drag, connect, invalid-connect rejection, Inspector, Problems, and scope navigation within the existing budgets. Assert hidden scopes do not mount Svelte Flow or run layout, and pointer-move frames call none of the YAML parse, validation, layout, Git, native, or file authorities. Add port/node gesture coverage ensuring no canvas control overlays a permitted gesture target.

- [ ] **Step 3: Run focused tests and confirm red**

```bash
npm run test:unit -- tests/performance/scoped-canvas-performance.test.ts
npm run test:e2e -- tests/e2e/loop-group-authoring.spec.ts --project=chromium
npm run test:e2e -- tests/e2e/loop-group-authoring.spec.ts --project=webkit
```

- [ ] **Step 4: Implement only behavior required by proven failures**

Use systematic debugging for every unexpected failure. Correct root causes in feature-owned modules. Do not add arbitrary waits, broaden selectors, increase timeouts, serialize independent assertions, or update expected output without proving the implementation is correct.

- [ ] **Step 5: Run the loop-group regression set**

```bash
npm run test:unit -- \
  src/lib/contract/scoped-dag-rule.test.ts \
  src/lib/contract/conformance.test.ts \
  src/lib/projection/graph-scopes.test.ts \
  src/lib/validation/scoped-dag-validator.test.ts \
  src/lib/validation/loop-group-work-product.test.ts \
  src/lib/yaml/graph-scope.test.ts \
  src/lib/yaml/patch-document.test.ts \
  src/lib/yaml/scoped-mutations.property.test.ts \
  src/lib/layout/layout-store.test.ts \
  src/stores/canvas-scope.test.ts \
  src/features/canvas/GraphCanvas.test.ts \
  src/features/canvas/LoopGroupScopeBar.test.ts \
  src/features/inspector/Inspector.test.ts \
  src/features/documents/ProblemsPanel.test.ts \
  tests/performance/scoped-canvas-performance.test.ts
npm run test:e2e -- tests/e2e/loop-group-authoring.spec.ts
```

- [ ] **Step 6: Request two-stage review, address findings, and rerun Step 5**

- [ ] **Step 7: Commit Task 13**

```bash
git add tests src playwright.config.ts
git commit -m "test: prove loop group visual authoring"
```

---

## Phase C — final verification and integration

### Task 14: Run complete gates and review both branches

**Repositories:** Hermes and Workflow Studio isolated worktrees

**Files:**
- Verify only unless a failure is reproduced and corrected through a new red-green cycle.

- [ ] **Step 1: Re-verify Hermes authority from a clean worktree**

```bash
scripts/run_tests.sh \
  tests/plugins/workflow/test_language_schema.py \
  tests/plugins/workflow/test_language_conformance.py \
  tests/plugins/workflow/test_phase6_language.py \
  tests/plugins/workflow/test_installed_distribution_e2e.py -v
scripts/run_tests.sh
```

Run the Hermes diff lint workflow used by the branch's current CI for the changed Python files, then regenerate both profiles' contracts and corpora twice through `.venv/bin/python ./hermes workflow ...`; prove byte identity and the reviewed digests. If `origin/base` changes its checked-in gate scripts before execution, update this command list in a plan-only commit before implementation rather than improvising a release gate.

- [ ] **Step 2: Run all Workflow Studio static/resource gates**

```bash
npm run format:check
npm run lint
npm run check
npm run contracts:check
npm run examples:check
npm run resources:verify
```

- [ ] **Step 3: Run all Workflow Studio automated suites**

```bash
npm run test:unit
npm run test:rust
npm run build
npm run test:e2e
```

Confirm the full Playwright invocation actually includes Chromium and WebKit projects. Run any repository-prescribed installed-app or packaging checks not covered by these scripts.

- [ ] **Step 4: Perform installed-app smoke checks honestly**

Build the macOS app and DMG through the repository's release workflow. Install or launch the built application and verify opening, drilling into, editing, saving, closing, and reopening a loop-group workflow. Record signing/quarantine details and exact artifact paths.

Do not claim Windows installed-app behavior passed unless the checks were actually run on Windows. Report unavailable platform evidence as not performed, not as a failure and not as a pass.

- [ ] **Step 5: Review complete diffs and histories**

For Hermes, compare `origin/base...feat/workflow-studio-loop-group-contract`. For Studio, compare `base...feat/loop-group-visual-authoring`. Confirm:

- every acceptance criterion maps to an automated or explicit installed-app check;
- no runtime Hermes files changed;
- no hand-maintained Studio loop field inventory exists;
- generated contract and corpus digests match;
- no YAML content, comments, or unknown fields are silently dropped;
- no skipped/focused tests, weakened assertions, timeout inflation, debug output, or placeholder text remains;
- commit boundaries match the tasks and both worktrees are clean.

- [ ] **Step 6: Request final cross-repository review**

The specification reviewer checks both complete diffs against the approved design and Hermes Phase 6 authority. The quality reviewer checks architecture, test independence, security boundaries, accessibility, performance, packaging, and migration safety. Address every finding through a focused red-green task and rerun all affected gates plus Steps 1-5.

- [ ] **Step 7: Integrate in dependency order**

Use `superpowers:finishing-a-development-branch` for each repository.

1. Merge the reviewed Hermes feature branch into Hermes `base`, rerun its full gates on the integrated commit, and push `base` only after success.
2. Regenerate and compare the Studio inputs against the integrated Hermes `base`; they must be byte-identical to the reviewed artifacts.
3. Merge the reviewed Studio feature branch into Workflow Studio `base`, rerun all Studio gates on the integrated commit, and push `base` only after success.
4. Return each ordinary working checkout to its repository's `base` branch and remove worktrees only when the branch workflow says it is safe.

- [ ] **Step 8: Produce the release artifact**

Only after both integrated bases pass, follow the Workflow Studio release procedure to build the installable artifact. Publish or attach it only if the user has authorized that exact release operation and signing credentials are available. Report the final commit SHAs, tags, artifact path/URL, checksum, macOS installed-app result, and honest Windows status.

---

## Acceptance checklist

- [ ] Hermes publishes complete, versioned scoped topology/reference semantics without runtime behavior changes.
- [ ] Hermes publishes a deterministic, bounded conformance corpus and installed CLI command.
- [ ] Studio consumes the reviewed generated contract and corpus, and refuses unsupported semantic versions safely.
- [ ] Outer loop groups render as single compound nodes; bodies use a drill-in nested canvas.
- [ ] A new group contains exactly `loop_group.nodes: []` and remains an explicitly repairable unsavable draft.
- [ ] Body palette, group Inspector, references, primary sink, validation, and companion paths match Hermes v6.
- [ ] Rename, delete, duplicate, copy, paste, and dependency edits preserve scoped referential integrity.
- [ ] Comments, key order, scalar style, anchors, aliases, and unrelated/unknown YAML survive targeted edits.
- [ ] Root and every loop body retain independent selection, viewport, and node positions; v1 layout records migrate safely.
- [ ] Valid Hermes scopes above Studio's 250/500 visual limit remain preserved and YAML-editable without disabling other scopes.
- [ ] Root and body scopes meet the 250-node/500-edge performance contract, with no heavy work in pointer-move frames.
- [ ] Keyboard, focus, modal Escape priority, reduced motion, forced colors, 1024x700, and 200% zoom remain usable.
- [ ] Chromium and WebKit suites pass; macOS installed-app evidence is recorded; Windows is only claimed if actually run.
- [ ] Both complete branch diffs and histories pass two-stage review before dependency-ordered integration and release.
