# Workflow Studio Implementation Roadmap

> **For agentic workers:** Execute the linked plans in order. Each plan requires `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Do not begin a later plan while an earlier completion gate is open.

**Goal:** Deliver the approved standalone Workflow Studio as four independently reviewable, test-first implementation phases.

**Architecture:** YAML text is the only workflow authority. Pure TypeScript parses, validates, projects, and patches YAML; Svelte renders derived views; a thin Tauri/Rust boundary owns scoped native operations. Hermes supplies a versioned authoring contract but is not a runtime dependency.

**Tech Stack:** Tauri 2.11, Rust 1.88.0+, Svelte 5.56, TypeScript 6.0, Vite 8, Svelte Flow, CodeMirror 6, `yaml`, Ajv 8, Nanostores, Vitest, fast-check, Svelte Testing Library, Playwright.

## Global constraints

- Work from the `base` branch and keep each task as an atomic commit.
- Use Node `>=22.12.0`, npm `>=10`, and Rust `>=1.88.0`.
- Keep the committed npm and Cargo lockfiles authoritative after initial scaffolding.
- YAML is the only workflow input/output format and the sole source of truth.
- Support `.yaml` and `.yml` definitions with canonical `.hermes.yaml` companions.
- Block save/export on syntax, schema, and DAG-semantic errors only.
- Do not block save/export for runtime availability, trust, credentials, or compatibility advisories.
- Never create a cycle, self-edge, duplicate dependency, or missing dependency through the visual editor.
- Work offline with bundled contracts, examples, docs, and LOOP24 branding.
- Preserve unknown YAML content; never silently drop a field.
- Keep canvas positions and UI state outside workflow YAML.
- Do not run parser, validation, layout, Git, or filesystem work during pointer-move frames.
- Support up to 250 visual nodes and 500 edges; preserve larger workflows in YAML-only mode.
- Keep Git local-only in version one.
- Do not add telemetry or analytics.
- Do not add Electron, a local server, a Python runtime, or a Hermes runtime dependency.
- Operating-system binaries are unsigned; updater metadata/artifacts are cryptographically signed.

---

## Phase plans

### Phase 1: Native foundation and contract boundary

Plan: [Native Foundation Plan](2026-07-25-workflow-studio-foundation-plan.md)

Produces:

- reproducible Tauri/Svelte project;
- test/lint/typecheck/CI baseline;
- thin typed native bridge;
- app shell and command registry;
- bundled-contract loader and test fixtures;
- LOOP24 default resources; and
- native development builds.

Completion gate:

```bash
npm run check
npm run test:unit
npm run test:rust
npm run build
npm run tauri -- build --debug
```

All commands pass from a clean clone on at least one development platform, and CI validates the other native build targets.

### Phase 2: YAML document and workspace core

Plan: [YAML Document and Workspace Plan](2026-07-25-workflow-studio-document-workspace-plan.md)

Consumes Phase 1 contract/native interfaces and produces:

- revision-safe YAML parsing worker;
- schema and DAG diagnostics;
- syntax-tree patch transactions and undo/redo;
- workflow-pair discovery and Explorer;
- scoped atomic file operations and conflict handling;
- recovery drafts; and
- persistent canvas layout metadata.

Completion gate:

The document corpus proves that targeted changes survive parse/patch/reparse without losing unrelated fields or comments. External edits cannot silently overwrite dirty text. No invalid document reaches disk through app save/export commands.

### Phase 3: Canvas, forms, docs, examples, and shortcuts

Plan: [Visual Authoring Plan](2026-07-25-workflow-studio-visual-authoring-plan.md)

Consumes Phase 2 document transactions and produces:

- Svelte Flow canvas;
- DAG-safe graph edits;
- Visual/Split/YAML modes;
- complete contract-generated forms;
- searchable offline documentation;
- validated Example Gallery;
- keyboard-first command handling; and
- 250-node performance evidence.

Completion gate:

Every supported contract field maps to a form widget or deliberately structured editor; every visual semantic edit yields one YAML transaction; the 250-node/500-edge fixture remains interactive without high-frequency parser/native work.

### Phase 4: Git, runtime branding, updater, and release

Plan: [Integration and Release Plan](2026-07-25-workflow-studio-integration-release-plan.md)

Consumes the complete editor and produces:

- local Git status/diff/history/init/version creation;
- runtime brand/theme import and validation;
- graphical first-launch and update flows;
- Tauri signed updater integration;
- native release workflows and unsigned-install guidance; and
- cross-platform release acceptance evidence.

Completion gate:

Pair-only commits preserve unrelated repository state, malicious brand assets cannot execute active content, update artifacts verify before installation, and clean-machine installation/UAT is recorded for macOS, Windows, and Linux.

## Upstream Hermes gate

The standalone repository may begin with small contract fixtures used only by tests. Before Phase 3 declares generated forms or documentation complete, Hermes must publish both production profiles through:

```bash
hermes workflow schema --profile hermes-legacy --json
hermes workflow schema --profile archon-2026-07 --json
```

The contract must include the editor metadata and semantic descriptors listed in the design specification. If the sibling Hermes repository has not implemented that amendment, stop at the Phase 3 contract gate and request explicit authority before changing the sibling repository. Do not hand-create a production field inventory in Workflow Studio.

## Design-to-plan traceability

| Approved design capability | Owning plan/task |
|---|---|
| Native lightweight shell and CI | Foundation Tasks 1-3, 7 |
| Central commands and shared shell | Foundation Task 4 |
| Bundled contract boundary | Foundation Task 5 |
| LOOP24 build/default brand | Foundation Task 6 |
| Revision-safe YAML source of truth | Document/Workspace Tasks 1-3 |
| CST-preserving visual/form edits | Document/Workspace Task 4 |
| Paired folder tree | Document/Workspace Task 5 |
| Scoped reads, atomic writes, watcher | Document/Workspace Task 6 |
| Save policy, conflicts, recovery | Document/Workspace Task 7 |
| Same-session canvas restoration | Document/Workspace Task 8 |
| Open/recent/quick-open/new/import/export/trash | Document/Workspace Task 9 |
| Fluid DAG canvas and explicit layout | Visual Authoring Tasks 1-2 |
| Visual/Split/YAML synchronization | Visual Authoring Task 3 |
| Complete schema-generated forms | Visual Authoring Task 4 |
| Optional contract refresh/cache | Visual Authoring Task 5 |
| Embedded searchable documentation | Visual Authoring Task 6 |
| Ten validated examples | Visual Authoring Task 7 |
| Keyboard shortcuts and node chords | Visual Authoring Task 8 |
| 250-node/500-edge accessibility/performance | Visual Authoring Task 9 |
| Git status/diff/history/local versions | Integration/Release Tasks 1-2 |
| Runtime brand/theme packs | Integration/Release Task 3 |
| Graphical first launch | Integration/Release Task 4 |
| Footer/About signed updater | Integration/Release Task 5 |
| Native artifacts and one-command downloads | Integration/Release Task 6 |
| Security/E2E/clean-machine acceptance | Integration/Release Task 7 |

## Task execution protocol

For every task in every phase:

1. Start from the task's listed files and interfaces.
2. Add the failing test first.
3. Run the narrow test and record the expected failure.
4. Implement only the behavior required by the task.
5. Run the narrow test until green.
6. Run the phase regression command.
7. Review the diff against the design invariants.
8. Commit only that task's files with the listed message.
9. Mark the task checkbox complete in the plan as part of a separate progress commit only when requested; do not mix planning churn into product commits by default.

## Release definition of done

All four phase gates and all seventeen release acceptance criteria in the design specification must pass. A green build without clean-machine installation, YAML round-trip evidence, Git isolation evidence, and native 250-node interaction evidence is not a finished release.
