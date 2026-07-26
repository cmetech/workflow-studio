# Workflow Studio Design Specification

**Status:** Approved  
**Date:** 2026-07-25  
**Audience:** Engineers implementing, reviewing, testing, packaging, or maintaining Workflow Studio  
**Post-read action:** Implement the standalone application without needing the original design conversation and without inventing a second workflow-language authority.

## 1. Product definition

Workflow Studio is an independently installed desktop application for visually building and editing Hermes/co-worker workflows. Users open a local folder, select or create a workflow, and edit the same workflow through a directed-acyclic-graph canvas, generated forms, or YAML text.

YAML is always the source of truth. The application can temporarily hold invalid text while the user is typing, but it saves and exports only structurally valid YAML. It does not execute workflows or claim that they will run successfully.

The application ships as a lightweight Tauri desktop program for macOS, Windows, and Linux. It works offline, requires no Hermes installation, and bundles its workflow contract, examples, documentation, and default LOOP24 brand resources.

## 2. Goals

Version one must:

- open any user-selected local folder as a workspace;
- recognize workflow definition and optional companion-policy pairs;
- create, import, view, edit, save, and export YAML workflows;
- keep visual, form, and YAML views synchronized with YAML authoritative;
- enforce YAML syntax, authoring schema, and DAG structure;
- render forms for every field supported by the bundled contract;
- embed complete searchable node and field documentation;
- remain responsive up to 250 nodes and 500 edges;
- restore canvas layout across sessions on the same computer;
- provide local Git status, diff, history, initialization, and explicit commits;
- ship validated example workflows;
- support data-driven branding and themes with LOOP24 defaults;
- provide keyboard-first authoring;
- provide graphical first-launch and update progress with expandable logs; and
- produce native artifacts from one codebase using native CI runners.

## 3. Non-goals

Version one does not:

- execute, simulate, schedule, admit, trust, or debug workflows;
- verify real tools, scripts, providers, models, credentials, services, or resources;
- install workflows into Hermes automatically;
- support JSON workflow input or output;
- support cyclic, BPMN, or arbitrary freeform graph semantics;
- provide cloud storage, collaboration, telemetry, or analytics;
- perform Git remote, authentication, branch-management, merge, rebase, reset, or history-rewriting operations;
- embed canvas coordinates in workflow YAML;
- share exact canvas layout across computers;
- ship Apple- or Microsoft-signed binaries; or
- execute arbitrary CSS or JavaScript from theme packs.

## 4. Approved technology

### 4.1 Stack

- **Desktop shell:** Tauri 2
- **Native host:** Rust
- **UI:** Svelte 5 and TypeScript
- **Shared UI state:** small feature-owned Nanostores
- **Build:** Vite
- **Graph canvas:** Svelte Flow
- **YAML editor:** CodeMirror 6
- **YAML document engine:** `yaml` Document/CST APIs
- **JSON Schema:** Ajv with Draft 2020-12 support
- **DAG layout:** a small deterministic layered-layout library, initially Dagre
- **Unit/component tests:** Vitest and Svelte Testing Library
- **Property tests:** fast-check
- **UI E2E:** Playwright browser harness plus native Tauri smoke coverage
- **Package management:** npm with a committed lockfile

### 4.2 Alternatives considered

| Option | Advantages | Disadvantages | Decision |
|---|---|---|---|
| Tauri + Svelte | Small native footprint, system WebView, Rust security boundary, mature Svelte graph library | Some platform-specific WebView behavior | Selected |
| Tauri + React | Largest graph-editor ecosystem and easiest Archon UI reuse | More renderer overhead and weaker alignment with the preferred lightweight direction | Rejected |
| Wails + Svelte + Go | Go host, system WebView, cross-platform | Smaller updater/plugin ecosystem for this release model; no benefit to writing language logic twice | Rejected |
| Electron | Existing co-worker familiarity and broad browser consistency | Materially higher memory/distribution footprint | Rejected |

The project is cross-platform, not literally packaged for every operating system from one machine. Release jobs use native macOS, Windows, and Linux runners.

## 5. Authority and contract boundaries

### 5.1 Workflow authority

The authoritative state for each file is its current YAML text. Every other representation is derived:

```text
definition YAML + companion YAML
              |
              v
     parse and validate worker
              |
              v
       immutable projection
       /        |        \
  canvas      forms     docs context
       \        |        /
        CST patch transaction
              |
              v
        authoritative YAML
```

The graph is never independently serialized as the workflow. Forms never hold hidden values that are absent from YAML. Visual mutations patch the syntax tree and then rederive all views.

### 5.2 Hermes authority

Hermes owns the workflow language and runtime. Workflow Studio consumes a versioned authoring contract. It does not copy the Python loader's field lists or compatibility decisions.

The bundled contract must contain separate definition and companion Draft 2020-12 schemas, profile information, node descriptors, semantic-rule descriptors, documentation metadata, compatibility codes, provenance, and a digest.

The editor works from its pinned contract when offline. It may optionally import a newer contract from an installed Hermes CLI or user-selected contract file. An unsupported contract remains cacheable and inspectable, but cannot activate visual editing. The app never silently reinterprets or drops newer fields.

### 5.3 Required upstream contract metadata

The Hermes authoring contract must expose editor descriptions, defaults, examples, constraints, units, section/order/widget hints, status, compatibility codes, migration text, node kinds, reference fields, and semantic graph rules.

This is a prerequisite for generated forms and complete embedded documentation. The YAML/CST foundation, workspace, and graph projection can begin against a checked-in fixture while the upstream amendment lands.

## 6. Workflow document model

### 6.1 Pairing

A workflow is one logical pair:

- `name.yaml` or `name.yml` — required definition;
- `name.hermes.yaml` — optional companion policy and language profile.

Selecting either file activates the pair and opens the corresponding editor tab. The files remain separate on disk and in the YAML view.

A definition without a companion is valid legacy behavior. A companion without a matching definition is shown as an orphan warning and cannot be exported as a complete workflow.

### 6.2 In-memory document state

Each file tracks:

- authoritative text and monotonically increasing revision;
- last successfully parsed syntax tree;
- last structurally valid projection;
- syntax, schema, semantic, compatibility, and operational findings;
- saved-disk revision and external-file identity;
- dirty state;
- undo/redo transaction history; and
- draft-recovery identity.

The definition and companion have separate text revisions but participate in pair-level validation and pair-level save/version operations.

### 6.3 YAML edit state machine

1. A keystroke immediately updates authoritative in-memory text.
2. A short debounce schedules worker parsing for that exact revision.
3. Stale worker responses are discarded.
4. Syntax-valid text produces a syntax tree.
5. Contract and semantic validation run against the pair.
6. A structurally valid result replaces the visual projection.
7. An invalid result preserves text, issues, and the last valid projection.

When the current text is invalid, the canvas is visibly stale and read-only. Forms that depend on an invalid subtree are disabled. Fixing the YAML automatically re-enables synchronized visual editing.

### 6.4 Visual and form mutations

Every mutation is an explicit transaction:

- compute the proposed semantic change;
- validate that it remains representable and DAG-safe;
- patch only the affected syntax-tree nodes;
- serialize the authoritative text;
- reparse and assert the expected invariant;
- update the projection; and
- append one undo record.

Targeted patches preserve comments, key ordering, scalar styles, multiline text, anchors, and unrelated formatting whenever possible.

### 6.5 YAML syntax policy

Workflow files contain one YAML 1.2 document whose root is a mapping. Duplicate mapping keys and multi-document streams block save/export because they make deterministic visual editing unsafe. The editor enforces contract-published document limits, including Hermes's current 2 MiB YAML validation ceiling.

Comments, block/flow collections, multiline scalars, anchors, and aliases are accepted. An edit to an alias-derived value writes an explicit local override rather than unexpectedly changing all consumers. If graph-shaping aliases cannot be changed unambiguously, the file remains editable as YAML while the unsafe visual operation is disabled with a diagnostic.

No formatter runs automatically. An explicit Format command may be added later only if it clearly explains that formatting can alter style.

## 7. Validation model

Validation has four layers:

1. **Syntax:** YAML decoding, duplicate keys, document count, scalar and collection syntax.
2. **Contract:** required fields, types, enums, ranges, patterns, and profile field policy.
3. **DAG semantics:** unique IDs, valid dependencies, no self-edges or cycles, valid static references, and upstream-only constraints.
4. **Operational advisories:** missing external tools, scripts, providers, services, secrets, trust, or runtime capabilities.

Layers one through three block save and export. Layer four never blocks them.

Every issue should include file, severity, stable code, plain-language message, YAML path, line/column when available, node and field identity when available, documentation topic, and a deterministic quick fix only when lossless.

Issues appear in the Problems panel, CodeMirror diagnostics, inspector fields, canvas nodes/edges, and status bar. Selecting an issue focuses the most specific applicable surface.

## 8. Workspace and file navigation

### 8.1 Opening a workspace

The launch screen provides Open Folder, recent folders, and folder drag/drop. A command-line path may open the app directly into that workspace.

The Rust host grants dynamic filesystem scope only to the chosen root and required app-data locations. The renderer never receives unrestricted filesystem access.

### 8.2 Explorer

The Explorer activity view shows a deterministic nested folder tree and groups definition/companion pairs as one workflow item. Built-in examples, contracts, and brand resources appear in separate read-only sections.

The scanner excludes Git internals, dependency/build directories, application run state, and recursive symlink traversal. Symlinked files are resolved and accepted only when the resolved target remains inside the allowed root.

### 8.3 File operations

The app supports New Workflow, New From Example, Duplicate Pair, Rename Pair, Create/Remove Companion, and Move to Trash. Required confirmations show the exact files involved.

Rename updates both files and migrates local layout metadata. When the pair is tracked in Git, the native Git adapter performs exact-path `git mv` operations so status and history represent the move immediately. Untracked files use the same scoped filesystem rename path.

Deletion uses the operating-system trash/recycle bin where supported. It is never an unqualified recursive delete.

### 8.4 External changes

Clean files reload automatically when changed outside the app. Dirty files present Keep Mine, Reload Disk, and Compare choices. Save uses an expected file identity/revision so a race between the watcher prompt and write cannot overwrite a newer external edit.

Atomic writes use a same-directory temporary file, flush, and replace sequence appropriate to the platform. Pair saves report partial failure explicitly and retain recovery data; they never pretend two independent filesystem replacements are a globally atomic transaction.

## 9. Application layout

The approved workspace has five primary regions:

1. **Activity rail:** Explorer, Nodes, Examples, Git, Settings.
2. **Left panel:** folder tree, node palette, gallery, Git view, or settings for the active activity.
3. **Center:** Visual, Split, or YAML workflow view.
4. **Right inspector:** General, Execution, Advanced, and Docs tabs.
5. **Footer/status bar:** Git branch/status, YAML/DAG validity, node/edge counts, active profile, and update state.

The YAML view exposes separate Definition and Companion tabs. Split view keeps the active YAML file beside the graph. Selecting a node focuses its YAML location and inspector; moving the YAML cursor to a recognized node highlights that node.

## 10. Visual DAG editor

### 10.1 Graph constraints

Only DAG operations are permitted. A proposed connection is checked before it changes YAML. Self-edges, duplicates, missing endpoints, and cycles are rejected immediately with an accessible explanation.

Loops remain loop nodes inside an acyclic orchestration graph. They do not create a graph back-edge.

### 10.2 Node creation and editing

Dragging a palette item creates a lightweight drag ghost. Dropping creates a node draft with a generated collision-free ID and selects its inspector. A visually incomplete node is allowed while authoring, but required-field diagnostics block save/export.

Deleting a referenced node shows impacted dependencies and output references. Dependency edges may be removed transactionally; ambiguous textual references must be resolved by the user rather than silently erased.

Renaming a node previews and rewrites its dependency and recognized output references as one undoable transaction.

### 10.3 Duplicate and clipboard semantics

Duplicating one or more selected nodes:

- creates collision-free IDs;
- offsets positions;
- preserves external incoming dependencies;
- remaps dependencies and recognized references within the copied selection; and
- does not redirect existing downstream nodes.

Copy/paste uses the same semantic transform. Cross-workflow paste validates destination-profile support before committing.

### 10.4 Layout and performance

The supported maximum is 250 nodes and 500 edges. Pointer movement updates only canvas-position state. YAML parsing, schema validation, DAG validation, layout, Git queries, and filesystem access never run per frame.

If an externally authored workflow exceeds the visual capacity, the app preserves and validates its YAML but opens it in YAML-only mode with a clear capacity advisory. Node-count capacity alone does not corrupt the file or turn an otherwise valid Hermes workflow into invalid YAML.

YAML is patched once on semantic operations. Node movement does not patch YAML because position is editor metadata.

Auto-layout runs only for a previously unseen workflow or an explicit Arrange command. The layout is deterministic for the same graph and stable node ordering.

Forms live outside node components in the inspector. Nodes render bounded summaries. Off-screen and expensive decorations are minimized, and reduced-motion preferences are honored.

## 11. Layout persistence

Canvas layout is durable editor metadata stored in the platform application-data directory, not the workspace.

A versioned record contains workspace identity, workflow-relative path, node positions keyed by node ID, viewport and zoom, panel dimensions, collapsed UI state, and the last Visual/Split/YAML mode.

Layout writes are debounced after completed drags and flushed on close. Reopening restores positions and viewport. Existing nodes keep their positions; new nodes are placed near dependencies without moving existing nodes; removed-node positions are pruned.

Visual renames migrate the node-position key transactionally. A manual YAML rename migrates only when the old/new match is unambiguous. App-driven workflow moves migrate the document record; external unchanged moves can be recognized by content identity. Otherwise the deterministic first-open layout is used.

On another computer or after application-data deletion, the workflow remains complete and receives a fresh deterministic layout. Portable layout sidecars are deferred beyond version one.

## 12. Schema-driven forms

The inspector is generated from the active contract with a small, exhaustive widget registry. Known fields may not fall back to an untyped blob editor.

Widgets cover:

- strings, identifiers, paths, and resource references;
- multiline and code text;
- numbers with range and unit display;
- booleans and enums;
- ordered scalar/object arrays;
- maps with duplicate-key prevention;
- discriminated node-kind forms;
- retry and hook structures;
- tool, skill, MCP, and agent collections;
- JSON output schemas;
- loop and approval structures; and
- companion policy and resource limits.

The inspector groups fields into General, Execution, and Advanced sections. Required fields are visibly marked and validated while editing. Defaults distinguish "absent and inherited" from "explicitly set to the default." Removing an optional value removes the YAML key rather than writing a synthetic null unless the schema explicitly supports null.

## 13. Embedded documentation

The application includes a searchable offline reference generated from the same authoring contract plus curated conceptual guides.

For each node and field, documentation includes purpose, required/optional status, applicable node kinds, type, default, range/unit, profile status, compatibility code, migration guidance, valid examples, and related concepts.

Curated guides cover workflow pairs, DAG dependencies, trigger rules, conditions and outputs, context, retry, loops, approvals, hooks, tools/agents, companion policies, profiles, validation layers, examples, Git, and troubleshooting.

The inspector Docs tab resolves directly to the selected field. Problems link to the relevant topic. The user never needs network access or an external website to understand a supported field.

## 14. Example Gallery

The immutable built-in gallery contains:

- minimal;
- sequential;
- parallel fan-out/fan-in;
- conditional branch;
- approval;
- Bash/script;
- AI prompt/command with tools;
- retry/trigger;
- bounded loop; and
- comprehensive advanced reference workflows.

Each resource has valid definition YAML, an optional companion file, profile/features/difficulty metadata, explanation, highlighted concepts, and documentation links.

Create Editable Copy writes a collision-safe pair into the workspace. CI validates every example against every profile it claims to support. User templates live separately from bundled resources and survive updates.

## 15. Branding and themes

LOOP24 assets and palette are the build-time and runtime default. Runtime brand packs are data files containing a manifest, logo, compact mark/favicon, window icon, and optional light/dark theme definitions.

Brand packs affect in-app names, welcome screens, activity rail, About/update views, logos, compact marks, supported runtime window icons, and all semantic editor colors.

The installed executable, application bundle, DMG, and Windows installer retain build-time LOOP24 identity. Runtime packs do not rewrite signed/package metadata or permanently change the operating-system application icon.

Themes use a fixed semantic token schema. They cannot inject CSS or JavaScript. Assets are size/type checked; SVG is sanitized; external references are rejected; contrast is evaluated during preview. Invalid packs remain inspectable but cannot activate.

## 16. Keyboard and command model

One command registry owns command IDs, labels, categories, context predicates, default platform shortcuts, enablement, and handlers. Menus, tooltips, command palette, context menus, and shortcut help derive from it.

`Mod` means Command on macOS and Control on Windows/Linux.

| Action | Default shortcut |
|---|---|
| Save pair | `Mod+S` |
| Undo / redo | `Mod+Z` / `Mod+Shift+Z`; `Ctrl+Y` also redoes on Windows/Linux |
| Quick open | `Mod+P` |
| Command palette | `Mod+Shift+P` or `F1` |
| Find | `Mod+F` |
| Select canvas nodes | `Mod+A` |
| Copy / paste | `Mod+C` / `Mod+V` |
| Duplicate | `Mod+D` |
| Delete | `Delete` or `Backspace` |
| Add node | `N` |
| Add after selection | `Shift+N` |
| Zoom in / out | `+` / `-` |
| Actual size | `0` |
| Fit graph / selection | `F` / `Shift+F` |
| Pan | hold `Space` and drag |
| Nudge / larger nudge | Arrow / `Shift+Arrow` |
| Open inspector | `Enter` |
| Cancel or clear selection | `Escape` |
| Visual / Split / YAML | `Mod+1` / `Mod+2` / `Mod+3` |
| Toggle Explorer | `Mod+B` |

The Add Node picker supports `N` followed by `C`, `P`, `B`, `S`, `L`, `A`, or `X` for command, prompt, Bash, script, loop, approval, or cancel. The picker displays the chord choices. `Shift+N` positions the new node after the selection and adds a valid dependency.

Canvas shortcuts never intercept form or CodeMirror typing. Keyboard navigation is immediate rather than animated. The canvas supports keyboard selection and edge creation, visible focus, accessible rejection announcements, and reduced motion.

Bindings remain fixed in version one; the registry permits later rebinding without redesign.

## 17. Local Git integration

Git is optional per workspace but assumed available on the computer. The Rust host invokes the system Git executable directly with argument arrays, exact literal paths, and no shell.

Opening a workspace detects repository root, current branch, and status. The Git view provides workflow-pair status, unified/side-by-side diff, history touching either file, commit details, comparison, and historical preview.

If no repository exists, the app may offer an explicit confirmed initialization at the selected root. It never initializes automatically.

Create Version requires a saved structurally valid pair. The confirmation displays exact files, combined diff, editable message, and findings. The commit includes only the pair and must preserve unrelated staged and unstaged changes. Tests use real repositories to prove that invariant.

Missing identity may be configured as repository-local name/email. The app never silently alters global Git configuration.

A historical version can be loaded as an unsaved editor draft. The app does not run checkout/reset for restoration.

Version one excludes push, pull, fetch, remotes, credentials, branch mutations, merge, rebase, cherry-pick, reset, automatic commits, and history rewriting.

## 18. Native host and security boundary

The Rust host owns:

- scoped folder selection and filesystem access;
- atomic read/write and operating-system trash;
- file watching;
- Git subprocesses;
- application-data settings and layout persistence;
- brand asset intake;
- local logs;
- native menus and window integration; and
- updater download/application.

It does not own YAML schema or workflow semantics.

All renderer-to-host commands use typed payloads. Host paths are resolved and checked against the active capability root immediately before use. Symlink containment is rechecked for mutations. Git output is bounded and parsed as bytes where path-safe formats require it. Logs are bounded and avoid recording workflow secret values.

No outbound telemetry or analytics are included.

## 19. First launch, installation, and updates

### 19.1 Platform artifacts

- macOS: Apple Silicon and Intel artifacts, or a universal DMG if size remains acceptable;
- Windows: x64 and supported ARM64 NSIS installers;
- Linux: x64 and ARM64 AppImages, with optional Debian packages.

Native CI runners build each platform. Operating-system signing/notarization is out of scope, so documentation must explain Gatekeeper and SmartScreen warnings honestly.

### 19.2 Graphical first launch

After native installation/launch, the LOOP24-branded setup surface reports real stages:

- prepare application-data directories;
- install bundled contract/examples/default resources;
- detect Git;
- restore or select a workspace; and
- verify readiness.

It shows stage states, total progress, elapsed time, cancellation where safe, and an expandable live log. Failures auto-expand the log and provide copy/open/retry actions. Unlike co-worker, Workflow Studio has no Python/Node/backend bootstrap.

### 19.3 Updater

The footer and Settings > About expose update state. The updater resolves the exact OS/architecture release, shows bytes/total/speed/progress, verifies the Tauri updater signature, stages the installation, and guides relaunch.

Update logs persist locally and are expandable/copyable. Users may retry or defer. Checks are manual and optionally bounded at startup; they never block offline authoring.

Updater cryptographic signing is required even though the operating-system binaries are unsigned. The updater key exists only in release CI secrets.

## 20. Repository architecture

The repository is organized by product feature with pure language modules separated from native capabilities:

```text
src/
  app/
  features/
    workspace/
    documents/
    canvas/
    inspector/
    documentation/
    examples/
    version-control/
    branding/
    updates/
  lib/
    contract/
    yaml/
    dag/
    paths/
  stores/
  workers/
src-tauri/
  src/
    filesystem/
    watcher/
    git/
    updater/
    logging/
  capabilities/
contracts/
examples/
brands/loop24/
tests/
  fixtures/
  integration/
  e2e/
  performance/
scripts/
.github/workflows/
```

Route/shell components compose features and do not become controllers. Shared state uses small feature-owned stores. Pure modules do not import Svelte or Tauri, allowing fast deterministic tests.

## 21. Test strategy

Development follows red-green-refactor for every behavior.

### 21.1 TypeScript unit and property tests

Tests cover contract envelopes, syntax/AST conversion, revisions, stale-worker suppression, diagnostics, projections, DAG rules, condition references, pair validation, CST patches, comments/style preservation, rename/duplicate transforms, deterministic layout inputs, and layout-record migration.

Property generators create valid DAGs and mutations. Invariants include acyclicity, identity uniqueness, dependency existence, parse/patch/reparse equivalence, and no unrelated syntax-tree changes.

### 21.2 Component tests

Svelte tests cover Explorer pairing, view synchronization, stale-canvas states, forms, Problems navigation, examples, docs, theme preview, Git confirmations, updater progress, command contexts, and keyboard-only flows.

### 21.3 Rust and integration tests

Rust tests cover scope containment, symlinks, atomic replacement, trash, watcher events, settings/layout persistence, Git arguments/output bounds, log redaction, and updater transitions.

Integration tests use temporary folders and real Git repositories. They prove external-edit conflict behavior, pair-only commits, unrelated-index preservation, rename/delete status, missing identity, and history queries.

### 21.4 End-to-end and release tests

Playwright runs the renderer against a deterministic browser/native adapter. Native smoke tests launch packaged apps where runner support permits. Clean-machine/manual acceptance covers platform warnings, install, first launch, folder access, updates, and relaunch.

Every bundled contract, example, documentation field reference, and brand pack validates in CI.

### 21.5 Performance contract

A 250-node/500-edge fixture verifies:

- no parser, validator, layout, Git, or I/O calls during pointer movement;
- one position persistence update per completed drag debounce;
- one YAML transaction per semantic graph operation;
- bounded projection and issue rendering; and
- interactive zoom, pan, selection, and dragging on release reference machines.

Timing assertions use generous deterministic module budgets in CI; perceptual frame-rate acceptance runs on native reference hardware to avoid flaky shared-runner thresholds.

## 22. Delivery sequence

1. Amend and fixture the Hermes authoring contract.
2. Create the native application/CI/brand shell.
3. Prove YAML CST round-trip behavior.
4. Implement workspace pairing, file safety, recovery, and layout persistence.
5. Implement graph projection and DAG-safe mutations.
6. Implement contract-generated forms and documentation.
7. Add examples, themes, commands, and shortcuts.
8. Add local Git.
9. Add installation, first-launch, update, and release pipelines.
10. Complete accessibility, security, performance, and clean-machine acceptance.

The CST document engine is the first go/no-go gate. Generated forms cannot be declared complete until the editor-grade authoring contract exists.

## 23. Release acceptance criteria

Version one is releasable only when a user can:

1. install and launch the app independently on each supported operating system;
2. open a folder and navigate definition/companion pairs;
3. import an existing workflow and receive a stable DAG view;
4. reopen it later with the same local canvas placement;
5. edit YAML and observe the visual/forms projection update;
6. edit graph/forms and observe targeted YAML updates without unrelated loss;
7. configure every bundled-contract field through a suitable form;
8. understand every node/field through offline documentation;
9. build only DAG topology through visual actions;
10. save/export only syntactically and structurally valid YAML;
11. retain non-blocking operational advisories;
12. start from each bundled example;
13. activate a valid runtime brand/theme pack;
14. inspect local history and create a pair-only Git version;
15. complete common authoring flows with keyboard controls;
16. graphically check, download, verify, and apply an update; and
17. work fluidly at 250 nodes and 500 edges.

## 24. Principal risks and mitigations

| Risk | Mitigation |
|---|---|
| CST patches alter formatting or comments | Build the document engine first; maintain golden and property-based round-trip corpora |
| Contract drifts from Hermes | Generate/pin from the CLI, verify digest, and keep parser-parity tests upstream |
| Advanced YAML cannot be mutated safely | Preserve it; disable only the ambiguous visual operation; never normalize silently |
| Large graphs become sluggish | Isolate drag state and prohibit high-frequency parser/layout/native work |
| File watcher races overwrite edits | Expected-revision writes, atomic replacement, and explicit conflict resolution |
| Git commits unrelated changes | Exact pair pathspecs and real-repository staged/unstaged preservation tests |
| Theme resources inject active content | Token-only themes, SVG sanitization, CSP, and no external asset references |
| Unsigned artifacts reduce install trust | Clear platform instructions, published checksums, and signed updater metadata |
| Platform WebViews differ | Native CI builds, platform smoke tests, and conservative browser feature usage |

## 25. Deferred extensions

The architecture leaves room for portable layout sidecars, shortcut rebinding, additional profiles, contract-delivered examples, signed OS packages, remote Git, collaboration, and runtime validation adapters. None should be implemented until a concrete versioned requirement is approved.

## 26. External references

- [Hermes workflow language and foundation review](../../analysis/2026-07-25-hermes-workflow-language-foundation-review.md)
- [Tauri 2 documentation](https://v2.tauri.app/)
- [Svelte Flow documentation](https://svelteflow.dev/)
- [YAML Document API](https://eemeli.org/yaml/)
- [CodeMirror documentation](https://codemirror.net/docs/guide/)
