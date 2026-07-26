# Hermes Workflow Language and Foundation Review

**Date:** 2026-07-25  
**Audience:** Engineers implementing Workflow Studio or evolving the Hermes workflow authoring contract  
**Post-read action:** Determine which behavior belongs in the standalone editor, which behavior must remain owned by Hermes, and which upstream contract additions must land before schema-driven editor work begins.

## 1. Executive conclusion

The standalone editor is feasible and fits Hermes's architecture cleanly. Hermes already owns workflow loading, strict field validation, DAG validation, compatibility reporting, discovery, trust, admission, scheduling, and execution. Workflow Studio should not reproduce the runtime. It should consume a bounded, versioned authoring contract and implement only authoring-time syntax, structure, projection, and editing behavior.

The July 25 workflow-language foundation plan provides most of the boundary the editor needs:

- explicit language profiles;
- versioned normalization;
- normalized-definition digests and durable snapshot binding;
- stable compatibility findings;
- separate definition and companion Draft 2020-12 schemas; and
- a machine-readable CLI contract available without workflow discovery or network access.

One addition is necessary before the contract is a complete visual-authoring authority: it must include editor-quality field metadata and machine-readable semantic DAG rules. Without those additions, Workflow Studio would have to duplicate descriptions, defaults, field grouping, widget choices, and graph-validation rules, creating an avoidable drift boundary.

## 2. Review scope

The review covered the current workflow loader and model contracts, compatibility analysis, topology projection, executor/scheduler dispatch, discovery rules, workflow-builder documentation, the July 25 language-foundation plan, its umbrella language-compatibility design, the existing co-worker theming/update/bootstrap patterns, and Archon's visual builder.

This document describes the observed contract rather than promising that every planned Hermes change has already landed. Workflow Studio must pin a generated contract version and fail closed when it encounters a newer unsupported contract.

## 3. Current Hermes authoring model

### 3.1 Package shape

A workflow package is logically a pair:

- `name.yaml` or `name.yml`: the DAG definition and execution-facing node settings;
- `name.hermes.yaml`: optional Hermes policy and language metadata.

The companion file is metadata and policy. It cannot define graph nodes or override trust. Workflow Studio must therefore expose two coordinated editors rather than flattening the files into one synthetic document.

### 3.2 Definition requirements

The current definition requires:

- a non-empty `name`;
- a non-empty `description`; and
- a non-empty `nodes` sequence.

Current top-level settings cover provider/model selection, reasoning and search modes, interactivity, requirements, worktree behavior, tags, session persistence, fallback behavior, beta flags, and sandbox configuration.

The loader currently recognizes seven node kinds:

1. `command`
2. `prompt`
3. `bash`
4. `script`
5. `loop`
6. `approval`
7. `cancel`

Every node must declare exactly one node-kind field and a valid identifier. The older `kind:` representation is explicitly rejected.

Common node settings include dependencies, conditions, trigger rules, context behavior, timeouts, retry policy, always-run behavior, output typing/formatting, session persistence, model/provider selection, tool allow/deny lists, hooks, MCP configuration, skills, inline agents, reasoning controls, budgets, system prompts, fallbacks, beta flags, sandbox settings, runtime/dependency declarations, and node timeouts.

The supported trigger rules are:

- `all_success`
- `one_success`
- `none_failed_min_one_success`
- `all_done`

Context values are `fresh` and `shared`; current script runtimes are `bun` and `uv`.

### 3.3 Structural and graph validation

Hermes already performs deterministic DAG checks:

- duplicate node identifiers;
- missing dependencies;
- dependency cycles;
- malformed conditional expressions;
- references to missing nodes; and
- references to nodes that are not upstream.

Workflow Studio should provide equivalent authoring feedback, but the backend remains the execution authority. The editor's semantic validator should be driven by contract-published rules and parity fixtures rather than copied Python constants.

### 3.4 Companion policy

The current companion surface covers delivery defaults, required services, retention, tags, outward-action declarations and policy, execution environment, overlap and pause-lane policy, concurrency, execution/resource limits, required secrets, and scheduling.

The companion loader rejects attempts to place graph structure or trust controls in this file. The language-foundation plan adds `language_compatibility` to select the effective profile.

### 3.5 Discovery

Hermes discovery resolves `.yaml` and `.yml` definitions through explicit paths, project workflow directories, and profile workflow directories. Files ending in `.hermes.yaml` are companion files rather than definitions. Workflow Studio does not need Hermes installed to reproduce discovery. It needs a generic folder workspace that recognizes these conventional locations when present and otherwise treats any selected folder as an authoring workspace.

### 3.6 Runtime versus authoring responsibility

The editor must block only authoring defects it can establish locally:

- invalid YAML;
- invalid schema shape;
- missing required values;
- profile-disallowed fields;
- invalid node identity or dependency topology; and
- invalid statically resolvable graph references.

The following remain advisories because they require an actual Hermes environment or execution:

- missing commands, scripts, providers, models, tools, MCP services, or skills;
- credentials and secrets;
- trust and package admission;
- network/service availability;
- actual model output shape;
- runtime resource availability; and
- operational success.

This distinction satisfies the product requirement: Workflow Studio emits syntactically and structurally correct YAML but does not claim the workflow will work.

## 4. July 25 language-foundation plan review

### 4.1 Strong foundations

The plan correctly makes language selection explicit in the companion file while preserving all unversioned workflows as `hermes-legacy`. New first-party workflows select `archon-2026-07`.

It also creates a normalization boundary whose identity is part of durable workflow state. The normalized digest intentionally excludes source paths and diagnostic line data, then binds normalized semantics to the trusted package digest. Resume verifies the pinned profile, normalizer, digest, and fingerprint instead of reopening mutable installed source.

This is runtime integrity behavior. Workflow Studio should display contract provenance and compatibility status but must not attempt to calculate or promise admission fingerprints.

### 4.2 Planned authoring contract

The plan adds a bounded contract envelope containing:

- schema version;
- profile;
- normalizer version;
- definition schema;
- companion schema; and
- compatibility-code catalog.

Both schemas use JSON Schema Draft 2020-12. The Archon profile rejects additional properties. Legacy preserves unknown-field warning behavior. Deferred fields carry Hermes status and compatibility-code annotations.

The CLI command can emit the contract without discovering workflows, accessing models, contacting MCP services, or making network calls. That makes it suitable as an optional refresh source for an offline application.

### 4.3 Required amendment for Workflow Studio

The contract inventory should add the following standard and extension metadata wherever applicable:

```text
title
description
default
examples
minimum
maximum
pattern
x-hermes-unit
x-hermes-section
x-hermes-order
x-hermes-widget
x-hermes-status
x-hermes-compatibility-code
x-hermes-migration
```

The contract envelope should also include:

- stable node-kind descriptors for palette generation;
- graph rule identifiers and parameters;
- condition/reference syntax descriptors;
- which fields contain node references;
- which node values are code, paths, resources, secrets, or multiline text;
- documentation topics and example fragments;
- contract provenance and digest; and
- the minimum editor contract-reader version;
- document-size limits, including Hermes's current 2 MiB YAML validation limit; and
- canonical filename and definition/companion pairing rules.

These annotations must remain descriptive. They must never imply that a deferred field is executable merely because a form can render it.

### 4.4 Recommended contract envelope

```json
{
  "schema_version": 1,
  "contract_reader_version": 1,
  "profile": "archon-2026-07",
  "normalizer_version": 1,
  "contract_digest": "sha256:...",
  "definition_schema": {},
  "sidecar_schema": {},
  "node_kinds": [],
  "semantic_rules": [],
  "compatibility_codes": {},
  "documentation": {}
}
```

Workflow Studio should bundle this exact envelope as a committed resource. Optional refresh accepts only envelopes with supported reader/schema versions and a verified digest.

## 5. Archon builder assessment

Archon's builder is useful interaction inspiration but not a suitable codebase or document model for Workflow Studio.

Useful patterns include:

- a React Flow-style canvas;
- a node palette;
- a property inspector;
- undo support;
- client-side validation; and
- deterministic DAG layout.

Material gaps include:

- only a subset of Hermes node kinds is editable;
- YAML is a generated, read-only preview;
- graph state is authoritative;
- YAML is emitted through hand-written serialization; and
- no separate companion-policy model exists.

The repository's MIT license permits inspiration and reuse where attribution obligations are followed, but adopting the builder would require replacing its central state and serialization assumptions. A purpose-built Svelte/Tauri editor is lower risk.

## 6. Technology feasibility

### 6.1 Tauri 2 and Svelte 5

Tauri uses each platform's system WebView and a Rust host, producing a materially smaller idle footprint than Electron for this application class. Svelte is a good match for a highly interactive editor without requiring React solely to use a graph library.

### 6.2 Svelte Flow

Svelte Flow provides the required canvas primitives: custom nodes, ports, edges, selection, zoom, pan, drag, and viewport control. It is not the workflow model; it renders a projection. Restricting high-frequency drag updates to position state makes the 250-node target reasonable.

### 6.3 YAML CST editing

The `yaml` TypeScript package exposes document and concrete-syntax structures suitable for preserving comments, ordering, and scalar style during targeted mutations. This is the highest-risk technical assumption and must be proven before the canvas and forms are built.

The editor should accept normal YAML 1.2 constructs, block duplicate keys and multi-document workflow files, and preserve anchors/aliases. When an alias-derived graph structure cannot be patched unambiguously, YAML editing remains available while only the unsafe visual mutation is disabled.

### 6.4 CodeMirror 6

CodeMirror provides a mature embeddable editor with incremental documents, diagnostics, search, folding, keyboard support, and accessibility. It should receive validation diagnostics from the document worker rather than own workflow validation.

### 6.5 Git CLI

Assuming Git is installed, invoking it through Rust is the smallest and most compatible local-versioning solution. It avoids bundling libgit2 or a JavaScript Git implementation. Exact path arguments, no shell, and real-repository integration tests contain the risk.

## 7. Architectural fit with Hermes

The language-foundation umbrella design intentionally keeps the existing co-worker Desktop definition view operational and read-only. A standalone editor therefore does not compete with or expand the core agent. It lives at the product edge, carries no prompt/tool-schema footprint, and remains independently releasable.

The only long-term coupling is a versioned data contract. That is a healthy boundary:

```text
Hermes workflow language authority
        |
        | generated, versioned authoring contract
        v
Workflow Studio bundled contract
        |
        +--> YAML syntax/schema diagnostics
        +--> DAG semantic diagnostics
        +--> forms and field documentation
        +--> profile compatibility display
```

No Python imports, co-worker runtime, backend process, API server, model connection, or workflow executor is required.

## 8. Findings and recommendations

1. Proceed with a standalone Tauri/Svelte repository.
2. Amend the Hermes authoring-contract task before implementing generated forms.
3. Make YAML CST round-tripping the first technical gate.
4. Treat definition and companion files as a coordinated pair without merging them.
5. Keep visual positions in local editor metadata for version one.
6. Use the installed Git executable and keep all version-one operations local.
7. Build and package on native CI runners; do not promise literal one-host cross-compilation.
8. Keep operating-system code signing out of scope while signing updater manifests/artifacts.
9. Validate all examples and documentation claims against the bundled contract.
10. Preserve Hermes's runtime authority: structural validity is not operational validity.

## 9. Official technology references

- [Tauri prerequisites and system WebViews](https://v2.tauri.app/start/prerequisites/)
- [Tauri distribution](https://v2.tauri.app/distribute/)
- [Tauri filesystem plugin](https://v2.tauri.app/plugin/file-system/)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [Svelte Flow](https://svelteflow.dev/)
- [YAML Document API](https://eemeli.org/yaml/)
- [CodeMirror system guide](https://codemirror.net/docs/guide/)
- [Wails introduction](https://wails.io/docs/introduction/)
