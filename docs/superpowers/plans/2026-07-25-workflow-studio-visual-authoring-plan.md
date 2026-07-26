# Workflow Studio Visual Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fluid DAG canvas, bidirectional YAML editor, generated forms, embedded documentation, example gallery, and keyboard-first authoring experience.

**Architecture:** Svelte Flow renders an immutable projection of the current valid YAML revision. Canvas and form actions call the document transaction API; they never mutate a parallel workflow model. CodeMirror edits authoritative text directly. Contract descriptors drive the palette, forms, diagnostics, and documentation.

**Tech Stack:** Svelte Flow 1.6.2, CodeMirror 6, Dagre 3.0.0, Svelte 5, Nanostores, `yaml`, marked 18, DOMPurify 3.4, Vitest, fast-check, Svelte Testing Library.

## Global constraints

- Complete the YAML Document and Workspace Plan first, including the CST go/no-go gate.
- Before generated forms/docs are declared complete, import production authoring contracts from Hermes; do not manually recreate the production field inventory.
- The canvas is a projection. All semantic actions must produce one validated YAML transaction.
- Node movement and viewport changes update local layout only, never YAML.
- Do not parse, validate, lay out, query Git, or call native APIs during pointer movement.
- Visual operations may never commit a cycle, self-edge, duplicate dependency, or missing dependency.
- Show the last valid graph as stale/read-only while current YAML is structurally invalid.
- Render complete forms for every supported field in the active bundled contract.
- Keep all documentation offline and sanitize any contract-provided markup.
- Preserve keyboard behavior inside CodeMirror and form controls; canvas-only shortcuts must be context-gated.
- Respect reduced motion and provide full keyboard/focus semantics.
- Support 250 visual nodes and 500 edges; larger workflows remain safe in YAML-only mode.

---

### Task 1: Render the projected DAG with isolated high-frequency state

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/canvas/types.ts`
- Create: `src/features/canvas/project-canvas.ts`
- Create: `src/features/canvas/project-canvas.test.ts`
- Create: `src/features/canvas/layout-graph.ts`
- Create: `src/features/canvas/layout-graph.test.ts`
- Create: `src/features/canvas/GraphCanvas.svelte`
- Create: `src/features/canvas/GraphCanvas.test.ts`
- Create: `src/features/canvas/WorkflowNode.svelte`
- Create: `src/features/canvas/WorkflowEdge.svelte`
- Create: `src/stores/canvas.ts`
- Modify: `src/app/App.svelte`

**Interfaces:**
- Consumes: `WorkflowProjection`, `LayoutRecordV1`, and layout persistence actions.
- Produces: `CanvasNodeData`, `CanvasEdgeData`, `projectCanvas(projection, layout)`, `$canvasPositions`, `$canvasSelection`, and `GraphCanvas`.

- [ ] **Step 1: Install graph dependencies**

Run:

```bash
npm install @xyflow/svelte@1.6.2 @dagrejs/dagre@3.0.0 lucide-svelte@1.0.1
```

- [ ] **Step 2: Write failing projection and drag-isolation tests**

Test that projection:

- preserves node IDs and stable dependency-edge IDs;
- applies saved positions without modifying `WorkflowProjection`;
- places missing positions through `reconcileLayout()`;
- uses bounded summaries rather than full node values; and
- emits read-only/stale state when requested.

Test that `layoutGraph()` is deterministic for the same node/edge IDs, places dependencies left of consumers, preserves the caller's arrays, and returns finite non-overlapping positions. The explicit Arrange command replaces positions once; an ordinary reopen with saved positions never calls Dagre.

The component test dispatches 100 drag-move events followed by one drag-stop and asserts zero document-analysis calls, zero YAML transactions, zero layout writes during moves, and one debounced layout write after stop.

- [ ] **Step 3: Run canvas tests to verify failure**

Run:

```bash
npm run test:unit -- src/features/canvas
```

Expected: FAIL because canvas modules are absent.

- [ ] **Step 4: Implement projection and stores**

Keep position state in a dedicated Nanostore keyed by node ID. Selection is a separate store. The semantic projection object remains frozen and is never updated by Svelte Flow callbacks.

`WorkflowNode.svelte` renders kind, ID, required-field/error badges, and a bounded one-line summary. It does not render forms. Ports and node hit targets are at least 32px and remain visible in high-contrast/focus states.

- [ ] **Step 5: Implement the Svelte Flow canvas**

Support pan, zoom, box selection, multiple selection, custom nodes/edges, stale overlay, MiniMap toggle, Controls, and explicit Arrange. Implement `layoutGraph()` as the only Dagre adapter with left-to-right rank direction and deterministic node/edge insertion order. Use `onNodeDrag` only for in-memory positions and `onNodeDragStop` for layout persistence.

Do not auto-layout when a saved layout exists. Do not animate keyboard navigation or large graph rearrangements when reduced motion is enabled.

- [ ] **Step 6: Verify canvas behavior**

Run:

```bash
npm run test:unit -- src/features/canvas
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/features/canvas src/stores/canvas.ts src/app/App.svelte
git commit -m "feat: render workflow dag canvas"
```

---

### Task 2: Implement DAG-safe canvas authoring transactions

**Files:**
- Create: `src/features/canvas/canvas-actions.ts`
- Create: `src/features/canvas/canvas-actions.test.ts`
- Create: `src/features/canvas/duplicate-selection.ts`
- Create: `src/features/canvas/duplicate-selection.test.ts`
- Create: `src/features/canvas/DeleteImpactDialog.svelte`
- Create: `src/features/canvas/DeleteImpactDialog.test.ts`
- Create: `src/features/canvas/AddNodePicker.svelte`
- Create: `src/features/canvas/AddNodePicker.test.ts`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/lib/commands/registry.ts`

**Interfaces:**
- Consumes: `applyWorkflowMutation()`, current analysis, contract node descriptors, selection, and layout actions.
- Produces: `connectNodes()`, `disconnectNodes()`, `addNode()`, `deleteNodes()`, `renameNode()`, `duplicateSelection()`, `copySelection()`, and `pasteSelection()`.

- [ ] **Step 1: Write failing edge/action tests**

Test successful edge creation translates to the target node's dependency list; duplicate/self/cycle connections return typed rejection without a YAML transaction; disconnect removes only the exact dependency; add generates a valid collision-free ID; and adding after selection creates a right-side position plus one dependency.

Test deletion previews affected dependency entries and recognized textual references. A delete with ambiguous references returns `resolution_required` and never changes YAML.

- [ ] **Step 2: Write duplication invariant tests**

For a multi-node selection, assert:

- every copied ID is unique;
- internal dependencies/references point to copied IDs;
- external incoming dependencies remain external;
- existing downstream nodes are unchanged;
- one YAML transaction contains the complete duplicate; and
- new positions are offset without overlap.

Cross-workflow paste must reject profile-disallowed fields before mutation and preserve unknown YAML in the destination.

- [ ] **Step 3: Run action tests to verify failure**

Run:

```bash
npm run test:unit -- src/features/canvas/canvas-actions.test.ts src/features/canvas/duplicate-selection.test.ts
```

Expected: FAIL because authoring actions are absent.

- [ ] **Step 4: Implement action adapters**

Actions construct `WorkflowMutation` objects, call the transaction engine, and commit returned text/revisions through document-store actions. They never edit projected node objects.

Use contract node descriptors to create the smallest new node mapping: generated `id`, exactly one node-kind field with descriptor default/empty value, and optional dependency. Incomplete required values remain blocking diagnostics rather than synthetic valid content.

- [ ] **Step 5: Implement dialogs and picker**

Delete impact lists exact nodes/fields. Add Node picker is searchable, shows descriptions and profile status, places at current selection/right or viewport center, and supports node chords registered in Task 8.

- [ ] **Step 6: Wire canvas events and verify**

Run:

```bash
npm run test:unit -- src/features/canvas
npm run check
```

Expected: PASS. Rejected edges are announced through one polite live region and leave document/layout history unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/features/canvas src/lib/commands/registry.ts
git commit -m "feat: add dag-safe visual authoring"
```

---

### Task 3: Add authoritative CodeMirror YAML and Visual/Split/YAML modes

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/editor/YamlEditor.svelte`
- Create: `src/features/editor/YamlEditor.test.ts`
- Create: `src/features/editor/editor-extensions.ts`
- Create: `src/features/editor/diagnostics.ts`
- Create: `src/features/editor/diagnostics.test.ts`
- Create: `src/features/editor/EditorModes.svelte`
- Create: `src/features/editor/EditorModes.test.ts`
- Modify: `src/stores/documents.ts`
- Modify: `src/stores/shell.ts`
- Modify: `src/app/App.svelte`

**Interfaces:**
- Consumes: authoritative document text, analyses/issues, projection source ranges, and editor mode store.
- Produces: `YamlEditor`, `issuesToCodeMirrorDiagnostics()`, definition/companion tabs, and synchronized selection/focus commands.

- [ ] **Step 1: Install CodeMirror dependencies**

Run:

```bash
npm install codemirror@6.0.2 @codemirror/lang-yaml@6.1.3 @codemirror/state@6.7.1 @codemirror/view@6.43.6 @codemirror/lint@6.9.7
```

- [ ] **Step 2: Write failing editor synchronization tests**

Test that typing updates authoritative text immediately, schedules one debounced analysis, does not replace the graph until the current revision is valid, marks the previous graph stale/read-only on invalid text, and restores the graph when corrected.

Test that selecting a graph node focuses its YAML range, a cursor inside a projected node selects that node, companion tab edits only the companion revision, and changing Visual/Split/YAML mode does not recreate or lose CodeMirror history.

- [ ] **Step 3: Run editor tests to verify failure**

Run:

```bash
npm run test:unit -- src/features/editor
```

Expected: FAIL because CodeMirror integration is absent.

- [ ] **Step 4: Implement the controlled editor**

Create one CodeMirror `EditorView` per open document tab and bridge transactions to document actions. External store updates dispatch a non-user replacement annotation so they do not loop back as edits.

Add YAML language, line numbers, folding, search, bracket matching, indentation, lint gutter, current-line highlighting, and theme tokens. Do not add a formatter-on-save.

- [ ] **Step 5: Map diagnostics and synchronized selection**

Clamp line/column/source ranges to the current revision. Diagnostics from stale analyses do not render. Clicking a diagnostic dispatches focus through the command registry. Node selection/focus has a loop-suppression token so canvas and cursor updates do not bounce.

- [ ] **Step 6: Verify all modes**

Run:

```bash
npm run test:unit -- src/features/editor src/features/canvas
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/features/editor src/stores/documents.ts src/stores/shell.ts src/app/App.svelte
git commit -m "feat: add synchronized yaml editing modes"
```

---

### Task 4: Import production contracts and generate complete inspector forms

**Files:**
- Create: `scripts/sync-contracts.ts`
- Create: `scripts/validate-contracts.ts`
- Create: `contracts/hermes-legacy-v1.json` (generated)
- Create: `contracts/archon-2026-07-v1.json` (generated)
- Create: `contracts/manifest.json` (generated)
- Create: `src/lib/forms/types.ts`
- Create: `src/lib/forms/widget-registry.ts`
- Create: `src/lib/forms/widget-registry.test.ts`
- Create: `src/features/inspector/Inspector.svelte`
- Create: `src/features/inspector/Inspector.test.ts`
- Create: `src/features/inspector/widgets/TextField.svelte`
- Create: `src/features/inspector/widgets/TextAreaField.svelte`
- Create: `src/features/inspector/widgets/CodeField.svelte`
- Create: `src/features/inspector/widgets/NumberField.svelte`
- Create: `src/features/inspector/widgets/BooleanField.svelte`
- Create: `src/features/inspector/widgets/EnumField.svelte`
- Create: `src/features/inspector/widgets/ArrayField.svelte`
- Create: `src/features/inspector/widgets/MapField.svelte`
- Create: `src/features/inspector/widgets/ObjectField.svelte`
- Create: `src/features/inspector/widgets/JsonSchemaField.svelte`
- Modify: `package.json`
- Modify: `src/app/App.svelte`

**Interfaces:**
- Consumes: production Hermes CLI contracts and `applyWorkflowMutation()`.
- Produces: pinned production contracts, `FieldDescriptor`, `WidgetDefinition`, `resolveWidget(field)`, and the General/Execution/Advanced inspector.

- [ ] **Step 1: Enforce the upstream contract gate**

Run from the sibling Hermes checkout using its preferred virtual environment:

```bash
hermes workflow schema --profile hermes-legacy --json
hermes workflow schema --profile archon-2026-07 --json
```

Expected: both commands exit zero and include contract reader version, digest, schemas, node descriptors, semantic rules, limits, compatibility catalog, and editor metadata.

If either command or required metadata is absent, stop this task and request explicit authority for the sibling Hermes amendment. Do not substitute hand-authored production field metadata.

Install the TypeScript script runner used by contract/example resource checks:

```bash
npm install --save-dev tsx@4.23.1
```

- [ ] **Step 2: Write failing sync and widget-coverage tests**

`sync-contracts.ts` invokes an explicitly supplied Hermes command/path, captures stdout only, validates each envelope/digest, writes deterministic pretty JSON, and writes a manifest containing profile, normalizer, schema, digest, and generated timestamp supplied through an argument for reproducible tests.

Coverage tests iterate every field descriptor from both contracts and assert exactly one compatible widget. They fail on an unknown widget ID, unsupported nested shape, duplicate field path/order, or documentation-less field.

- [ ] **Step 3: Run coverage tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/forms/widget-registry.test.ts
npx tsx scripts/validate-contracts.ts
```

Expected: FAIL until contracts, scripts, and widget registry exist.

- [ ] **Step 4: Implement contract synchronization**

Add scripts:

```json
{
  "contracts:sync": "tsx scripts/sync-contracts.ts",
  "contracts:check": "tsx scripts/validate-contracts.ts"
}
```

The sync script never searches arbitrary PATH executables silently; accept `--hermes-command` or `--contract-file` explicitly. Validate before replacing committed files. No network is required.

- [ ] **Step 5: Implement the exhaustive widget registry**

Map contract widget IDs and schema shapes to typed Svelte widgets. Known fields never fall back to raw JSON. Optional fields distinguish absent from explicit defaults. Delete optional values through `delete-field`; changes use `set-field`. Nested arrays/maps/objects validate locally but rely on pair analysis for authoritative blocking status.

If a loaded contract needs a widget the app does not support, keep YAML intact and disable affected visual/form mutation with `contract_reader_unsupported_widget`.

- [ ] **Step 6: Implement inspector sections**

Render General, Execution, Advanced, and Docs tabs. Required markers, inherited/default states, compatibility badges, field issues, reset/remove actions, units, and examples come from descriptors. Selection changes never commit edits.

- [ ] **Step 7: Verify full field coverage**

Run:

```bash
npm run contracts:check
npm run test:unit -- src/lib/forms src/features/inspector
npm run check
```

Expected: PASS for every field in both production contracts.

- [ ] **Step 8: Commit generated contracts and forms**

```bash
git add scripts contracts package.json package-lock.json src/lib/forms src/features/inspector src/app/App.svelte
git commit -m "feat: generate complete workflow inspector"
```

---

### Task 5: Add optional runtime contract refresh and safe caching

**Files:**
- Create: `src/lib/contract/contract-cache.ts`
- Create: `src/lib/contract/contract-cache.test.ts`
- Create: `src/features/settings/ContractSettings.svelte`
- Create: `src/features/settings/ContractSettings.test.ts`
- Create: `src-tauri/src/contracts.rs`
- Modify: `src/lib/native/types.ts`
- Modify: `src/lib/native/tauri-bridge.ts`
- Modify: `src/lib/native/browser-bridge.ts`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: bundled contracts, `loadAuthoringContract()`, a user-selected contract JSON file, or a user-selected Hermes executable.
- Produces: `ContractCacheEntry`, `listCachedContracts()`, `activateContract()`, Rust commands `contract_read_file`, `contract_run_hermes_cli`, `contract_cache_write`, and Settings contract management.

- [ ] **Step 1: Write failing cache/activation tests**

Test that bundled contracts always remain available; a valid imported contract caches by profile/schema/digest; duplicate digest does not duplicate; unsupported reader versions remain listed but cannot activate; digest mismatch never writes cache; newer normalizer within a supported reader remains selectable only for its exact profile; and deleting an active cached contract first reverts to the bundled contract.

- [ ] **Step 2: Write failing fixed-CLI invocation tests**

Rust tests use a fixture executable and assert the command receives exactly `workflow schema --profile hermes-legacy --json` or `workflow schema --profile archon-2026-07 --json`, no renderer-provided extra arguments, no shell, a 10-second timeout, and a 512 KiB output ceiling. Non-zero exit, stderr-only output, oversized output, and invalid UTF-8 return typed errors.

- [ ] **Step 3: Run contract settings tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/contract/contract-cache.test.ts src/features/settings/ContractSettings.test.ts
npm run test:rust -- contracts
```

Expected: FAIL because runtime import/cache support is absent.

- [ ] **Step 4: Implement exact file and CLI readers**

`contract_read_file` reads one user-selected JSON file with a 512 KiB limit. `contract_run_hermes_cli` accepts only an explicitly selected executable path and profile enum, then supplies the fixed arguments above. Neither command decides whether the contract is valid.

The renderer validates shape/digest/widget support first. Only validated supported contracts may activate. Unsupported but well-formed contracts may be copied to app data for inspection after an explicit confirmation and remain inactive.

- [ ] **Step 5: Implement app-data cache and settings UI**

Store immutable contract JSON under app data by digest and a small atomic index by profile/version. Settings shows source, profile, schema/normalizer/reader versions, digest, active/bundled/cached status, Import Contract File, Refresh From Hermes CLI, Activate, and Remove.

Activation registers the contract with the worker before scheduling pair reanalysis. If registration or widget coverage fails, retain the previous active contract and current YAML.

- [ ] **Step 6: Verify offline and refresh behavior**

Run:

```bash
npm run test:unit -- src/lib/contract src/features/settings/ContractSettings.test.ts
npm run test:rust
npm run check
```

Expected: PASS with network APIs disabled.

- [ ] **Step 7: Commit**

```bash
git add src/lib/contract src/features/settings/ContractSettings.svelte src/features/settings/ContractSettings.test.ts src-tauri/src/contracts.rs src-tauri/src/lib.rs src/lib/native
git commit -m "feat: refresh cached workflow contracts"
```

---

### Task 6: Build searchable offline documentation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/docs/types.ts`
- Create: `src/lib/docs/build-index.ts`
- Create: `src/lib/docs/build-index.test.ts`
- Create: `src/lib/docs/render-markdown.ts`
- Create: `src/lib/docs/render-markdown.test.ts`
- Create: `src/features/documentation/DocumentationView.svelte`
- Create: `src/features/documentation/DocumentationView.test.ts`
- Create: `src/features/documentation/ContextDocs.svelte`
- Create: `docs/app-guides/workflow-pairs.md`
- Create: `docs/app-guides/dag-dependencies.md`
- Create: `docs/app-guides/conditions-and-outputs.md`
- Create: `docs/app-guides/retry-and-triggers.md`
- Create: `docs/app-guides/loops-and-approvals.md`
- Create: `docs/app-guides/companion-policies.md`
- Create: `docs/app-guides/profiles-and-compatibility.md`
- Create: `docs/app-guides/git-versions.md`
- Create: `docs/app-guides/troubleshooting.md`
- Modify: `src/features/inspector/Inspector.svelte`

**Interfaces:**
- Consumes: contract documentation descriptors and curated guides.
- Produces: `DocumentationTopic`, `buildDocumentationIndex()`, `searchDocumentation()`, safe Markdown rendering, activity view, and contextual Docs tab.

- [ ] **Step 1: Install and test safe Markdown dependencies**

Run:

```bash
npm install marked@18.0.7 dompurify@3.4.12
```

Write tests proving scripts, event attributes, iframes, forms, external images, `javascript:` URLs, and SVG active content are removed. Preserve headings, lists, code, tables, and safe internal topic links.

- [ ] **Step 2: Write failing documentation-index tests**

Assert every contract node kind and field produces a searchable topic containing purpose, type, required/optional state, default, profile status, examples, and compatibility/migration content when supplied. Search must rank exact field/node labels before body matches and operate without native/network calls.

- [ ] **Step 3: Run documentation tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/docs src/features/documentation
```

Expected: FAIL because documentation modules are absent.

- [ ] **Step 4: Implement safe indexing and rendering**

Build an in-memory token index per active contract. Preserve code identifiers during tokenization. Render Markdown to DOMPurify-sanitized HTML with a policy that permits only the elements needed by bundled guides. External HTTP links require an explicit open-external action; documentation remains fully useful without them.

- [ ] **Step 5: Write curated guides for a fresh workflow author**

Each guide must state what the user can do, show valid YAML sourced from production contract examples, explain structural versus operational validation, and link to relevant contract topics. Do not describe execution guarantees the editor cannot make.

- [ ] **Step 6: Implement documentation surfaces**

The activity view supports search, node/field/guide filters, keyboard result navigation, and history. The inspector Docs tab opens the exact selected field topic. Problems navigate to topic IDs.

- [ ] **Step 7: Verify offline completeness**

Run:

```bash
npm run test:unit -- src/lib/docs src/features/documentation src/features/inspector
npm run contracts:check
npm run check
```

Expected: PASS, with a test that disables `fetch` and native bridge calls.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/docs src/features/documentation src/features/inspector/Inspector.svelte docs/app-guides
git commit -m "feat: embed workflow authoring documentation"
```

---

### Task 7: Add the validated Example Gallery

**Files:**
- Create: `examples/catalog.yaml`
- Create: `examples/minimal/`
- Create: `examples/sequential/`
- Create: `examples/parallel-fan-in/`
- Create: `examples/conditional/`
- Create: `examples/approval/`
- Create: `examples/bash-script/`
- Create: `examples/ai-tools/`
- Create: `examples/retry-trigger/`
- Create: `examples/bounded-loop/`
- Create: `examples/advanced-reference/`
- Create: `scripts/validate-examples.ts`
- Create: `src/lib/examples/types.ts`
- Create: `src/lib/examples/load-examples.ts`
- Create: `src/lib/examples/load-examples.test.ts`
- Create: `src/features/examples/ExampleGallery.svelte`
- Create: `src/features/examples/ExampleGallery.test.ts`
- Modify: `package.json`
- Modify: `src/app/App.svelte`

**Interfaces:**
- Consumes: production contracts, bundled YAML pairs, and native create-file actions.
- Produces: `ExampleDescriptor`, `loadExampleCatalog()`, `createExampleCopy()`, validation script, and Gallery UI.

- [ ] **Step 1: Write failing resource and copy tests**

Assert catalog IDs/paths are unique and relative; every example's files exist; profile tags match the companion declaration; highlighted node/field IDs exist; every pair passes syntax/contract/DAG analysis; built-ins are read-only; and Create Editable Copy chooses `name.yaml`, then `name-2.yaml`, without overwriting.

- [ ] **Step 2: Run example tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/examples src/features/examples
npx tsx scripts/validate-examples.ts
```

Expected: FAIL because resources and loaders are absent.

- [ ] **Step 3: Author examples from production contract data**

Each example contains `workflow.yaml`, optional `workflow.hermes.yaml`, and catalog metadata for title, summary, difficulty, profiles, concepts, highlighted nodes/fields, and documentation topics.

Use these exact structural intents:

| ID | Required graph |
|---|---|
| minimal | one prompt node |
| sequential | three nodes in a chain |
| parallel-fan-in | root, two parallel children, one join |
| conditional | upstream output plus two valid `when` consumers |
| approval | work, approval, accepted continuation |
| bash-script | one Bash and one script-runtime node |
| ai-tools | prompt/command nodes with allowed tools |
| retry-trigger | failing-work candidate plus retry/trigger settings |
| bounded-loop | loop node with contract-supported bounded controls |
| advanced-reference | all seven node kinds and major common/companion structures |

Do not invent fields absent from the contract. Runtime-dependent fields may yield non-blocking advisories but no blocking issue.

- [ ] **Step 4: Implement validation and Gallery**

The validation script loads the same production contract files as the app. Gallery cards show profile, difficulty, nodes, concepts, preview, and Create Editable Copy. Preview never mutates the built-in source. Copy writes exact YAML text and then opens/analyzes the new pair.

- [ ] **Step 5: Verify all resources**

Run:

```bash
npm run examples:check
npm run test:unit -- src/lib/examples src/features/examples
npm run check
```

Expected: PASS for all ten examples.

- [ ] **Step 6: Commit**

```bash
git add examples scripts/validate-examples.ts package.json package-lock.json src/lib/examples src/features/examples src/app/App.svelte
git commit -m "feat: add validated workflow examples"
```

---

### Task 8: Implement contextual keyboard shortcuts and command palette

**Files:**
- Create: `src/lib/commands/keybindings.ts`
- Create: `src/lib/commands/keybindings.test.ts`
- Create: `src/lib/commands/node-chords.ts`
- Create: `src/lib/commands/node-chords.test.ts`
- Create: `src/features/commands/CommandPalette.svelte`
- Create: `src/features/commands/CommandPalette.test.ts`
- Create: `src/features/commands/KeyboardShortcuts.svelte`
- Create: `src/features/commands/KeyboardShortcuts.test.ts`
- Modify: `src/lib/commands/registry.ts`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/editor/YamlEditor.svelte`
- Modify: `src/app/App.svelte`

**Interfaces:**
- Consumes: central command registry, editor/canvas contexts, and canvas/document actions.
- Produces: `normalizeKeybinding()`, `dispatchKeybinding()`, `NodeChordController`, command palette, and searchable shortcut reference.

- [ ] **Step 1: Write failing context/collision tests**

Test platform Mod normalization, fixed default bindings from the design, no canvas single-key command inside inputs/contenteditable/CodeMirror, native text undo/find behavior, Escape cancellation priority, disabled command behavior, and collision diagnostics.

Node chord tests cover `N` then `C/P/B/S/L/A/X`, visible pending choices, 1.5-second timeout, Escape, focus loss, unknown second key, and `Shift+N` add-after-selection.

- [ ] **Step 2: Run keybinding tests to verify failure**

Run:

```bash
npm run test:unit -- src/lib/commands src/features/commands
```

Expected: FAIL because dispatch/palette UI is absent.

- [ ] **Step 3: Register the approved commands**

Register Save, Undo/Redo, Quick Open, Command Palette, Find, Select All, Copy/Paste, Duplicate, Delete, Add, Add After, Zoom In/Out, Actual Size, Fit Graph/Selection, Nudge, Inspector, Cancel, Visual/Split/YAML, Explorer, Arrange, Validate, and Keyboard Shortcuts.

Bindings are context predicates, not global document event condition ladders. Use the central registry as the only command source for buttons, menus, tooltips, palette, and help.

- [ ] **Step 4: Implement palette, shortcuts view, and chords**

Palette supports fuzzy search, category grouping, enabled/disabled explanations, arrow navigation, Enter, and Escape. Keyboard Shortcuts displays platform-correct symbols and searchable command labels. Node-chord overlay is instantaneous and has no entrance animation.

- [ ] **Step 5: Add keyboard edge creation**

With a canvas node selected, an Edge command enters target-selection mode. Tab/arrow navigation moves among valid targets, Enter connects, and Escape cancels. Invalid targets remain announced but cannot commit.

- [ ] **Step 6: Verify complete keyboard flows**

Run:

```bash
npm run test:unit -- src/lib/commands src/features/commands src/features/canvas src/features/editor
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/commands src/features/commands src/features/canvas/GraphCanvas.svelte src/features/editor/YamlEditor.svelte src/app/App.svelte
git commit -m "feat: add keyboard-first workflow authoring"
```

---

### Task 9: Prove accessibility and 250-node performance contracts

**Files:**
- Create: `tests/performance/large-workflow.ts`
- Create: `tests/performance/canvas-performance.test.ts`
- Create: `tests/accessibility/keyboard-authoring.test.ts`
- Create: `tests/accessibility/reduced-motion.test.ts`
- Create: `src/lib/metrics/editor-metrics.ts`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/app.css`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: complete Phase 3 editor.
- Produces: test-only `EditorMetrics`, deterministic large graph fixture, and Phase 3 evidence.

- [ ] **Step 1: Write failing instrumentation tests**

`EditorMetrics` counts parse requests, validation passes, layouts, YAML transactions, native calls, Git calls, pointer moves, drag completions, and layout saves. Production builds may retain no-op counters; tests inject a collector.

Generate exactly 250 nodes and 500 unique DAG-safe edges using a fixed seed. Assert 1,000 pointer moves trigger zero parse/validation/layout/native/Git/YAML calls and one drag completion triggers one debounced layout save.

- [ ] **Step 2: Write failing keyboard/reduced-motion tests**

Complete a workflow using only keyboard actions: open Add Node, add two nodes, connect them, open inspector, edit a required field, save. Assert visible focus throughout and meaningful live-region rejection for an attempted cycle.

With reduced motion enabled, assert no canvas transition class and instant keyboard viewport focus. Progress indicators may remain linear.

- [ ] **Step 3: Run performance/accessibility tests to verify failure**

Run:

```bash
npm run test:unit -- tests/performance tests/accessibility
```

Expected: FAIL until instrumentation and remaining accessibility behavior are complete.

- [ ] **Step 4: Implement only the needed performance fixes**

Memoize projection by analysis identity, keep node render data bounded, batch selection updates, and avoid subscribing every node to global document text. Do not add virtualization unless native reference testing proves it necessary at 250 nodes.

- [ ] **Step 5: Run the Phase 3 gate**

Run:

```bash
npm run contracts:check
npm run examples:check
npm run verify
npm run build
```

Expected: PASS.

- [ ] **Step 6: Record native interaction evidence**

Launch:

```bash
npm run tauri -- dev
```

Open the fixed 250-node/500-edge fixture and record platform, hardware, WebView version, zoom/pan/drag responsiveness, and any long task above 50ms in `docs/verification/phase-3-canvas-performance.md`. Do not replace deterministic tests with subjective evidence; both are required.

- [ ] **Step 7: Commit**

```bash
git add tests/performance tests/accessibility src/lib/metrics src/features/canvas/GraphCanvas.svelte src/app.css .github/workflows/ci.yml docs/verification/phase-3-canvas-performance.md
git commit -m "test: verify accessible large-dag authoring"
```
