# Workflow Studio loop-group visual authoring design

**Status:** Approved conversational design, pending written-spec review

**Date:** 2026-08-31

**Audience:** Engineers implementing, reviewing, testing, packaging, or maintaining Workflow Studio and the Hermes workflow authoring contract

## 1. Authority and scope

This specification extends Workflow Studio to consume the current Hermes authoring contract and provide full visual authoring for the normalizer-v6 `loop_group` construct.

It amends:

- `docs/superpowers/specs/2026-07-25-workflow-studio-design.md`; and
- `docs/superpowers/specs/2026-08-30-workflow-studio-content-aware-workbench-design.md`.

Hermes remains the workflow-language authority. Workflow Studio consumes generated contracts, diagnostics, documentation, and conformance fixtures. It does not maintain an independent field inventory or reinterpret runtime behavior.

The following invariants remain unchanged:

- YAML is the sole workflow source of truth.
- Definition YAML and optional companion YAML are the only workflow outputs.
- Editor layout, navigation, selection, and viewport state never enter workflow YAML.
- Unknown or unsupported YAML is never silently dropped.
- Targeted edits preserve comments, key order, scalar style, and unrelated content whenever the syntax tree permits it.
- Visual graph operations never commit cycles, self-edges, duplicate dependencies, missing dependencies, or invalid scope crossings.
- Structurally invalid workflows cannot be saved or exported.
- Rust remains limited to privileged native operations; YAML, projection, forms, graph semantics, and layout remain testable TypeScript modules.
- Git remains local-only.
- Parsing, validation, layout, Git, native, and file operations never run during pointer-move frames.
- The application remains usable at 1024 x 700 and 200% zoom in Chromium and WebKit.
- The interactive canvas performance contract remains 250 nodes and 500 edges per graph scope.

## 2. Product outcome

An author can open, understand, create, and edit a Hermes v6 workflow containing `loop_group` without leaving Workflow Studio's visual authoring environment for ordinary supported-size graphs.

The outer workflow renders each group as one compound node. Opening that node drills into a dedicated body canvas. The body uses the same node palette, Inspector, Problems, keyboard commands, DAG-safe gestures, YAML synchronization, and CST-preserving transaction model as the root workflow.

The feature is complete only when Studio also synchronizes the full current Hermes contract. Updating only the `loop_group` field would leave other normalizer-v6 fields unsupported and would not satisfy language compliance.

## 3. Non-goals

This work does not:

- execute or simulate a loop group;
- implement iteration state, scheduling, claims, recovery, approvals, artifacts, or reconciliation;
- resolve runtime values for `$LOOP_PREV` or node outputs;
- add nested `loop_group`, body includes, runtime child workflows, dynamic fan-out, or a `returns` selector;
- increase the interactive canvas guarantee beyond 250 nodes and 500 edges per scope;
- flatten body nodes into the outer workflow graph;
- persist a competing graph model;
- embed body-node positions in workflow YAML; or
- modify the sibling `hermes-agent` repository without separate user authorization.

## 4. Authoritative Hermes v6 semantics

A `loop_group` is one outer workflow node whose payload contains a sealed, one-level body DAG.

The group payload contains:

- nonempty `nodes`;
- required nonblank `until`;
- required integer `max_iterations` from 1 through 100;
- optional `fresh_context`;
- optional `until_bash`;
- optional `interactive`;
- optional `signal_completes`; and
- optional `gate_message`.

The body permits `prompt`, `command`, `bash`, `script`, `approval`, `cancel`, and ordinary `loop` nodes. It rejects includes, nested loop groups, runtime workflow children, and group-level retry.

Body IDs are unique within the group. Body dependencies name siblings only and remain acyclic. Independent body nodes may be topologically parallel at runtime, but Studio does not simulate that runtime behavior.

The first terminal body node in YAML definition order is the primary sink. Its result becomes the outer group output. Studio displays this selection but does not create a second output authority or unsupported selector.

References have distinct scopes:

- `$body-node.output` refers to a valid current-iteration body producer under the published strict dependency rules.
- `$outer-node.output` refers only to an outer node that is a direct dependency of the group.
- `$LOOP_PREV.body-node.output` refers to that body node's immediately previous iteration.
- Structured field traversal follows the producer's published output schema.
- Unknown body IDs, invalid field paths, and invalid scope crossings are blocking errors.

Hermes admits body graphs up to 512 nodes and 4,096 edges and separately enforces a bounded worst-case work product. Studio validates those language limits from the contract. Its visual capacity remains lower and does not change the validity of otherwise valid YAML.

## 5. Contract boundary and required upstream amendment

### 5.1 Complete contract synchronization

Workflow Studio updates its bundled generated resources to the current Hermes contracts:

- current `archon-2026-07`, using normalizer v6; and
- current `hermes-legacy`, retaining its Hermes-selected normalizer.

Contract synchronization imports the complete contract envelope. Normalizer-v6 additions outside `loop_group`, including any current fields such as `maxTurns`, `tool_call_contract`, and artifact declarations, are supported or safely rejected according to their generated status and widget metadata. Studio does not copy those names into a parallel hand-maintained inventory.

### 5.2 Machine-readable scoped graph semantics

The current Hermes v6 schema publishes the group shape and describes several body rules in documentation metadata, while its semantic-rule inventory still centers on the root DAG. Full safe visual editing requires the contract to publish a versioned scoped-DAG rule.

The upstream generated contract must expose, in machine-readable form:

- the group payload and body-node path templates;
- body ID and dependency fields;
- permitted and prohibited body kinds;
- maximum body depth, nodes, edges, and work product;
- primary-sink selection;
- current-body reference rules;
- direct outer-dependency reference rules;
- previous-iteration reference rules;
- applicable structured-output constraints;
- companion scoped-node reference syntax; and
- stable diagnostics with authored paths.

This is an authoring-contract amendment, not a runtime-language change. Hermes' loader remains authoritative for the behavior it describes.

### 5.3 Reader capability boundary

Studio implements a reader for the published scoped-DAG rule. Contract activation verifies that every requested graph semantic, field widget, reference grammar, and mutation-relevant path is understood.

If a newer contract requests an unsupported semantic capability, Studio may cache and inspect it but cannot activate unsafe visual editing. YAML remains readable and preserved. The app never partially activates a contract while silently omitting a supported Hermes rule.

## 6. Scoped graph architecture

Studio replaces the assumption that a workflow has one flat visual graph with a shared graph-scope abstraction.

A graph scope is either:

- the root workflow; or
- one `loop_group` body owned by a root node.

Every projected scope contains:

- a stable editor-only scope identity;
- its exact YAML source path and source range;
- projected nodes and dependency edges;
- node definition order;
- primary sink when applicable;
- valid outer inputs when applicable;
- contract and semantic findings;
- capacity status; and
- immutable links back to the containing workflow projection.

Editor-only compound identities such as `process-tickets/select-ticket` distinguish body nodes from root nodes and allow different groups to reuse the same child ID. These identities never appear in definition YAML. Scoped companion paths that are part of the Hermes language remain ordinary contract-authored YAML values, not layout identities.

The projection remains immutable and derived from the current YAML revision. No scope is persisted as an independent workflow authority.

The implementation supports exactly the one nesting level described by the active contract. A generic scope interface does not imply recursive runtime or authoring support.

## 7. Analysis and data flow

One document-worker analysis pass performs the following for an exact definition/companion revision and contract digest:

1. Parse definition and companion YAML.
2. Validate syntax and generated schemas.
3. Select the exact active profile and contract.
4. Project the root graph.
5. Discover contract-declared nested graph scopes.
6. Project every group body.
7. Validate root and body topology.
8. Validate current-body, outer, previous-iteration, and companion references.
9. Apply language bounds and visual-capacity classification.
10. Return one immutable document projection and deterministically ordered findings.

Stale worker responses continue to be discarded by document revision, pair generation, profile, and contract digest.

Syntax-invalid text preserves the last usable projection as stale and read-only. Narrow, known incomplete authoring states receive repairable draft projections as described below. Arbitrary schema or semantic failures do not become a second permissive validation mode.

## 8. Drill-in visual authoring

### 8.1 Outer compound node

The root canvas renders a group as one compound node. Its bounded summary includes:

- loop-group identity;
- body-node count;
- maximum iterations when present;
- primary output node when determinable;
- error and required-field status; and
- an explicit Open Body action.

Double-click, Enter, and Open Body enter the body scope. Normal root dependency ports remain attached to the outer node because outer nodes depend on the group as one unit.

### 8.2 Body workspace

The body replaces the active canvas rather than expanding inside the root canvas or sharing a permanent split view. A breadcrumb such as `Workflow > Process tickets` returns to the root.

The body reuses:

- Canvas toolbar and commands;
- Nodes palette;
- Inspector;
- Problems;
- selection and edge gestures;
- copy, paste, duplicate, rename, and delete transactions;
- keyboard navigation; and
- YAML and Split synchronization.

The active scope is presentation state. Switching scopes does not save, serialize, run layout, query Git, or perform native/file work.

### 8.3 Empty group authoring draft

Adding a group creates only the minimum container:

```yaml
loop_group:
  nodes: []
```

Studio does not invent a child command, prompt, completion condition, or iteration count. It immediately opens an empty body canvas with Add First Node and Edit Group Settings actions.

The empty body and missing required controls are a known repairable draft. Problems and Inspector identify the missing values. Save and export remain blocked until strict validation succeeds.

### 8.4 Group and child Inspector contexts

Edit Group Settings selects the compound container and exposes the group fields generated by the contract. Selecting a body child binds the Inspector to that child's scoped YAML path and applicable node-kind fields.

The Inspector never stores hidden form state as workflow authority. Each commit patches YAML and rederives the projection.

### 8.5 Body palette

The body palette derives availability from the contract's scoped-DAG rule. For v6 it offers prompt, command, Bash, script, approval, cancel, and ordinary loop nodes. Prohibited constructs never become enabled drop targets or keyboard choices.

## 9. Scope and reference guidance

A compact scope bar sits above the body canvas. It makes hidden outer context visible without drawing fake graph nodes or misleading dependency edges.

The bar contains:

- available outer values from direct dependencies of the group;
- available `$LOOP_PREV` producers from the body;
- exact copy-reference actions; and
- insertion actions for compatible focused fields.

Current-body references remain governed by actual body dependencies and selected-node context. The bar never implies that an outer input is a body dependency.

Insertion actions use contract-published syntax and field applicability. They are disabled when focus, schema, or scope makes insertion ambiguous. Authors can always type YAML directly.

The primary sink receives a Group Output badge. If several terminal nodes exist, Studio explains that Hermes selects the first terminal node in YAML definition order. Canvas position does not change definition order.

## 10. DAG safety and semantic validation

Root and body scopes use one topology engine with explicit scope inputs.

Before changing YAML, graph operations reject:

- missing endpoints;
- self-dependencies;
- duplicate dependencies;
- cycles within the active scope;
- body dependencies that target outer nodes or another group;
- outer dependencies that target body nodes;
- prohibited node kinds; and
- operations that exceed contract or visual-authoring bounds.

Reference validation distinguishes:

- current body references;
- direct outer dependency references;
- previous-iteration references;
- outer downstream references to the group output; and
- companion scoped-node references.

Diagnostics include document, stable code, severity, YAML path, line/column, scope identity, outer group ID, body node ID, field identity, and documentation topic when available.

Selecting a finding opens the correct graph scope and focuses the most specific node, field, or YAML range.

## 11. CST-preserving mutations

Every visual or form mutation is one document transaction:

1. Resolve the target scope to its exact YAML path.
2. Compute the proposed semantic change.
3. Reject invalid DAG or scope behavior before patching.
4. Patch retained CST source ranges only.
5. Reparse the complete pair under the same contract.
6. Confirm the expected scoped semantic result.
7. Commit one undo record or reject the complete operation.

Scoped mutations support:

- add body node;
- change group controls;
- connect and disconnect body dependencies;
- rename body or outer nodes;
- delete body nodes or complete groups;
- duplicate and copy/paste within a scope; and
- validated copy/paste into another compatible scope.

Renaming a body node updates recognized sibling and `$LOOP_PREV` references in that group. Renaming an outer node updates recognized root references and permitted outer references. Contract-identified scoped companion entries are updated transactionally.

Deleting or renaming previews impacted dependencies and recognized references. Ambiguous textual references must be resolved by the user. Alias-derived graph changes that cannot be localized safely remain unavailable. Unknown YAML and unrelated content are preserved.

Pasting into another scope is a semantic copy. Studio remaps IDs, dependencies, and recognized references entirely within the copied selection. Any dependency or reference to a source-scope node outside that selection requires an explicit destination mapping or user resolution before commit; Studio never drops or redirects it silently.

Deleting the final body node may return the group to the explicit repairable empty draft, but it cannot be saved or exported in that state.

## 12. Navigation, layout, and state restoration

The document retains one authoritative revision and one undo/redo history across all scopes.

Application-data layout records store scope-owned editor metadata:

- node positions;
- viewport and zoom;
- selection;
- focus target;
- Inspector state; and
- relevant canvas scroll state.

Scope layout keys are editor-only and derived from workspace, workflow path, outer group identity, and body node identity. Visual renames migrate unambiguous keys transactionally. Removed scopes and nodes are pruned.

Returning to the root restores its exact selection and viewport. Reopening a group restores the body's exact selection and viewport. Workbench page navigation continues to preserve both.

If YAML editing, undo, or an external change removes the active group, Studio returns to the root and explains that the previous scope no longer exists. An unambiguous rename follows the group and migrates local metadata.

## 13. Capacity and performance

The interactive limit remains 250 nodes and 500 edges per graph scope.

Capacity is classified independently:

- an oversized root retains the existing YAML-only workflow behavior;
- an oversized body opens that body in YAML-only mode;
- an oversized body does not disable the root canvas or other supported-size groups; and
- Hermes' larger language bounds remain contract validation rules, not Studio visual limits.

Hidden scopes do not render Svelte Flow surfaces or run layout. Only the active scope owns live pointer interaction. Projection may validate all bounded scopes in the worker, but pointer movement updates only ephemeral position state.

Performance verification covers a 250-node/500-edge active body, a 250-node/500-edge root, several hidden groups, scope navigation, and YAML-only classification at larger valid bounds.

## 14. Error handling and resilience

Known incomplete group drafts remain visually repairable. All other invalid-text behavior follows the existing document state machine.

Errors never cause Studio to:

- discard YAML;
- replace the active contract silently;
- flatten nested nodes;
- synthesize runtime behavior;
- normalize unrelated formatting;
- leave the user trapped in a removed scope; or
- report an oversized valid body as invalid Hermes YAML.

Repeated equivalent scoped diagnostics receive deterministic occurrence identities and cannot trigger duplicate-key rendering errors.

Contract import or activation failure leaves the previous active contract intact and explains whether the failure is digest, reader, widget, semantic-capability, or profile related.

## 15. Documentation and examples

Offline documentation derives group fields and compatibility status from the current contract. Curated guidance explains:

- outer versus body scope;
- current and previous iteration references;
- direct outer dependency requirements;
- primary-sink behavior;
- prohibited nested constructs;
- repairable drafts;
- visual versus Hermes language capacity; and
- YAML-only fallback.

The built-in examples add a valid multi-node loop group and retain the ordinary single-node loop example as a distinct construct. The representative Hermes Jira Defect Loop is included in compatibility verification and may be exposed in the gallery only when its complete definition, companion, required resources, and explanation meet the existing offline example contract.

## 16. Conformance corpus and drift prevention

Hermes publishes a bounded authoring-conformance corpus with its generated contract. Each case contains:

- profile and normalizer version;
- definition and optional companion YAML;
- expected valid or invalid result;
- expected stable diagnostic codes for invalid cases; and
- feature tags.

The corpus covers every supported node kind and field family, with dedicated positive and negative loop-group cases. It also includes selected real distributed workflow packages such as Jira Defect Loop.

Workflow Studio's synchronization process records contract digest, source revision, and corpus provenance. Its release gate requires:

- Hermes and Studio agreement on validity;
- agreement on relevant stable diagnostic codes and authored scope;
- projection of every valid visually supported scope;
- safe YAML-only classification beyond visual capacity;
- Inspector widget coverage for every supported field;
- documentation coverage; and
- byte preservation for unsupported or oversized fixtures.

This parity gate replaces one-off compatibility checking with an authoritative matrix that runs before release.

## 17. Test strategy

Implementation follows strict red-green-refactor.

### 17.1 Contract and projection tests

Tests cover:

- current contract envelope, digest, provenance, and normalizer selection;
- scoped-DAG rule activation and unsupported-reader refusal;
- root and body projection;
- permitted body-ID reuse across different groups and duplicate-ID rejection within one group;
- primary-sink selection by YAML definition order;
- body and outer scope identities;
- visual-capacity classification; and
- complete contract field/widget/documentation coverage.

### 17.2 Semantic and property tests

Tests cover valid and invalid body DAGs, prohibited constructs, bounds, current-body references, direct outer references, `$LOOP_PREV`, structured fields, and scoped companion paths.

Property generators produce bounded nested DAGs and mutation sequences. Invariants include acyclicity, identity uniqueness within each scope, dependency containment, parse/patch/reparse equivalence, and no unrelated syntax-tree change.

### 17.3 CST mutation tests

Golden and property tests cover add, settings edits, connect, disconnect, rename, delete, duplicate, copy, and paste while preserving comments, ordering, scalar styles, flow/block collections, multiline values, anchors, aliases, unknown fields, and unrelated nodes.

### 17.4 Component and accessibility tests

Tests cover compound-node summaries, keyboard and pointer entry, breadcrumbs, empty states, Add First Node, group settings, body palette filtering, scope bar reference actions, primary-output badges, Inspector binding, Problems navigation, focus restoration, reduced motion, forced colors, and screen-reader naming.

### 17.5 Cross-engine end-to-end tests

Chromium and WebKit prove:

- create an empty group and make it valid visually;
- drill into and return from several groups;
- preserve unsaved YAML and scope state across workbench pages;
- connect valid body edges and reject cycles and scope crossings;
- rename and delete with reference impact;
- navigate scoped diagnostics;
- retain viewport, selection, Inspector, and YAML scroll state;
- keep the status bar and all actions within 1024 x 700 and 200% zoom; and
- isolate an oversized body without disabling the outer graph.

### 17.6 Performance tests

Tests retain the existing zero parse, validation, layout, Git, native, and file-I/O pointer-frame invariant. A 250-node/500-edge body supports pan, zoom, selection, drag, connect, rejection, Inspector, Problems, and scope navigation within the existing performance budgets.

## 18. Delivery boundaries and sequence

Implementation proceeds in these architectural slices:

1. Amend the Hermes authoring contract and publish its conformance corpus.
2. Synchronize and validate the complete current contracts and fixtures in Studio.
3. Introduce scoped projection, identity, topology, and reference validation.
4. Extend CST mutations and repairable draft analysis to scoped paths.
5. Add scope-owned layout, selection, viewport, and navigation state.
6. Implement the compound node, drill-in canvas, empty state, palette, Inspector, and scope bar.
7. Add documentation, examples, parity, accessibility, cross-engine, and performance gates.
8. Run complete build and installed-app verification before release.

The upstream Hermes work is a separate repository change. It requires explicit user authorization, its own branch/plan/review, and its own verification. Studio must not ship a hand-authored substitute when that work is unavailable.

## 19. Acceptance criteria

This design is complete only when:

1. Studio bundles and activates the complete current generated Hermes contracts.
2. A valid v6 `loop_group` loads without contract or projection errors.
3. The root displays one compound node rather than flattening body children.
4. Authors can drill into, create, edit, connect, rename, delete, duplicate, copy, and paste supported body nodes visually.
5. New groups begin as explicit empty repairable drafts without invented semantics.
6. Save and export remain blocked until strict contract and semantic validation pass.
7. Group controls are fully Inspector-editable from contract descriptors.
8. The scope bar exposes valid outer and previous-iteration references without fake graph nodes.
9. Body, outer, previous-iteration, and companion references are validated in their correct scopes.
10. Primary-sink behavior is visible and matches Hermes definition-order semantics.
11. CST mutations preserve comments, key order, scalar style, aliases where safe, unknown fields, and unrelated content.
12. Invalid visual DAG operations never change YAML.
13. Root and body layout, selection, viewport, Inspector, and focus state survive navigation and restart where already persisted by Studio.
14. Removing the active group returns safely to the root.
15. Each supported-size scope remains responsive at 250 nodes and 500 edges.
16. Larger valid Hermes bodies remain preserved, validated, and YAML-editable without disabling other scopes.
17. No pointer-move frame performs parsing, validation, layout, Git, native, or file work.
18. Chromium and WebKit pass at 1024 x 700 and 200% zoom.
19. Hermes and Studio pass the generated conformance corpus and selected real distributed workflows.
20. No unperformed platform check is represented as passing.

## 20. Authorization gate

Approval of this Workflow Studio design does not itself authorize edits to the sibling `hermes-agent` repository. Before implementation planning assigns the upstream contract amendment, the user must explicitly authorize that separate repository change.
