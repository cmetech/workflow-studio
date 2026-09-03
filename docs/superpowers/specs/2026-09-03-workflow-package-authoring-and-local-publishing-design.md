# Workflow Package Authoring and Local Publishing Design

**Status:** Approved in design discussion; pending written-spec review

**Date:** 2026-09-03

**Audience:** Engineers implementing, reviewing, testing, documenting, or maintaining Workflow Studio package authoring

**Related specification:** `docs/superpowers/specs/2026-07-25-workflow-studio-design.md`

## 1. Product decision

Workflow Studio will support creating and maintaining complete, installable Hermes workflow packages. A package may contain multiple workflow definition/companion pairs plus the command Markdown, scripts, MCP definitions, fixtures, and other resources those workflows require.

A local folder or Git repository may contain multiple independently versioned packages. Workflow Studio prepares and commits a selected package locally. The user remains responsible for pushing that commit with an existing Git client or CLI. This release does not add Git remotes, authentication, fetch, pull, push, tags, or branch operations to Workflow Studio.

Workflow Studio remains an authoring and packaging application. It never executes workflow nodes, scripts, command resources, MCP servers, or package installers and never installs dependencies.

Hermes/co-worker remains authoritative for marketplace discovery, remote Git access, installation, compatibility checks, atomic staging, admission, execution, and trust. A separate Hermes design and implementation plan must define those runtime behaviors before marketplace installation ships.

## 2. Goals

The package-authoring release must:

- recognize multiple workflow packages in one selected workspace;
- support multiple workflow pairs in one package;
- create, inspect, edit, rename, and remove package artifacts safely;
- provide integrated editors for workflow YAML, companion YAML, command Markdown, Python, TypeScript, JavaScript, MCP YAML, JSON, YAML, and plain text;
- import, replace, inspect, reveal, or open binary resources externally without interpreting them as text;
- connect node resource fields to create, select, open, and reveal actions;
- distinguish package-owned resources from external co-worker requirements;
- validate package structure, references, metadata, file limits, and static artifact syntax offline;
- generate deterministic package digests and the repository marketplace index from versioned Hermes-owned contracts;
- show the exact package and trust surface changed since the prior local version;
- prepare new package versions through package-scoped local Git commits without including unrelated changes;
- retain invalid or incomplete artifact drafts for reliable recovery;
- provide complete offline documentation and example packages; and
- preserve current non-package workflow-pair authoring.

## 3. Non-goals

This release does not:

- execute, simulate, debug, benchmark, or preview the runtime behavior of a workflow;
- execute a script, command Markdown resource, shell fragment, or MCP server for validation;
- install Python, Bun, JavaScript, system, plugin, skill, or MCP dependencies;
- establish that a runtime, provider, model, credential, tool, service, or network endpoint exists;
- install a package into a local or remote co-worker;
- grant, preserve, or imply Hermes trust;
- push or otherwise publish a local commit to a remote repository;
- store GitHub, GitLab, SSH, personal-access-token, SSO, or other remote credentials;
- provide a hosted marketplace or repository server;
- turn commands, scripts, or fixtures into workflow YAML fields;
- embed editor layout, application state, Git state, or trust state into workflow YAML; or
- change the existing workflow language independently of the versioned Hermes authoring contract.

## 4. Authority boundaries

### 4.1 Workflow authority

The definition YAML remains the sole authority for the workflow graph and node behavior. Its optional companion YAML remains the authority for Hermes policy and language metadata. Canvas and form operations continue to patch the authoritative YAML syntax tree.

Package files do not create another graph model. A package manifest identifies package membership and publishing metadata; it cannot define nodes, dependencies, conditions, execution policy, or trust.

### 4.2 Artifact authority

Each command, script, MCP definition, fixture, or supporting file is authoritative as its own file. Workflow Studio may derive references, diagnostics, previews, and package summaries from those files, but it does not synthesize hidden resource content.

Generated digest and marketplace files are derived outputs. They are inspectable but not directly editable in the ordinary editor. Preparing a package regenerates them from the current package contents.

### 4.3 Hermes authority

Hermes owns the portable-package schemas, resource-resolution rules, digest algorithm, marketplace-index contract, compatibility semantics, installation policy, and trust model. Workflow Studio consumes a pinned, bundled version of these contracts and test vectors so it works offline.

An unsupported newer package contract may be displayed and edited as ordinary files, but structured package actions and package preparation fail closed. Workflow Studio never guesses how to reinterpret an unsupported package.

## 5. Repository and package layout

The conventional repository layout is:

```text
repository/
├── packages/
│   ├── laptop-support/
│   │   ├── workflow-package.json
│   │   ├── workflows/
│   │   │   ├── laptop-diagnostic.yaml
│   │   │   ├── laptop-diagnostic.hermes.yaml
│   │   │   └── collect-support-bundle.yaml
│   │   ├── commands/
│   │   │   └── interpret-report.md
│   │   ├── scripts/
│   │   │   ├── analyze-snapshot.py
│   │   │   └── render-report.py
│   │   ├── mcp/
│   │   ├── fixtures/
│   │   └── digests.json
│   └── inbox-productivity/
│       └── ...
└── .well-known/
    └── hermes-workflows/
        └── index.json
```

`packages/` is the recommended repository convention, not the only accepted workspace location. A package root is identified by `workflow-package.json`. Package roots may not overlap or nest. All member paths resolve within the package root, and distributable packages contain no symlinks.

The repository marketplace index is rooted at `.well-known/hermes-workflows/index.json`. It contains discovery metadata and package-relative paths. It does not contain credentials or declare trust.

## 6. Package manifest

`workflow-package.json` is the package-membership and publishing source of truth. Version one contains:

```json
{
  "schemaVersion": 1,
  "id": "laptop-support",
  "version": "1.1.0",
  "displayName": "Laptop Support",
  "description": "Diagnostic and support-bundle workflows for laptops.",
  "license": "MIT",
  "publisher": "example-company",
  "tags": ["diagnostics", "support"],
  "workflows": [
    {
      "definition": "workflows/laptop-diagnostic.yaml",
      "companion": "workflows/laptop-diagnostic.hermes.yaml"
    },
    {
      "definition": "workflows/collect-support-bundle.yaml"
    }
  ],
  "externalRequirements": {
    "runtimes": ["uv"],
    "tools": [],
    "providers": [],
    "services": [],
    "secrets": []
  }
}
```

The canonical Hermes schema controls exact field constraints. IDs are repository-unique, versions are valid semantic versions, member paths use workspace-independent forward slashes, and list order is stable. Package metadata cannot include a trusted flag, admitted digest, local installation path, remote credential, or editor-only state.

All regular files under the package root are package-owned unless the canonical contract excludes them. A workflow reference that Hermes resolves within a package must resolve to a package-owned file before preparation. External runtime capabilities are declared under `externalRequirements`; declaration makes them visible and diagnosable but does not prove availability.

## 7. Digest and marketplace outputs

Hermes will publish a versioned digest specification and shared test vectors. At minimum, the digest contract defines:

- the included and excluded paths;
- path normalization and ordering;
- file-byte hashing;
- composite package hashing;
- file-count and per-file/total-size limits; and
- behavior for unsupported file types, path encodings, and symlinks.

Studio calculates hashes from the exact saved bytes. It does not normalize line endings or reformat files as part of preparation. `digests.json` and the repository marketplace index are excluded from self-referential hashing exactly as the Hermes contract prescribes.

The marketplace index is deterministic and derived from package manifests and digests. Entries are sorted by package ID. It contains no timestamp and no self-referential commit SHA. The co-worker records the exact fetched Git commit as provenance during installation and independently recalculates the package digest.

Any included workflow, companion, command, script, MCP definition, fixture, package manifest, or supporting-resource byte change changes the package digest. A co-worker update therefore requires trust review whenever the exact trusted package bytes change.

## 8. Workspace experience

### 8.1 Packages activity

The activity rail adds **Packages** alongside Explorer, Nodes, Examples, Git, and Settings. Explorer remains the unopinionated view of every workspace file. Packages is a derived, structured view grouped by package root, workflow pair, resource category, and generated metadata.

Each package row shows its ID, version, readiness, and local change count. Selecting a package opens its overview. Selecting an artifact opens the appropriate editor.

### 8.2 Package overview

The overview shows:

- package identity and publishing metadata;
- included workflow pairs;
- command, script, MCP, fixture, and other resources;
- references from workflows to resources;
- unreferenced package files;
- current working changes compared with the last local Git version;
- package readiness and operational advisories;
- execution and trust surface; and
- current and proposed semantic versions.

The overview provides **Open Workflow**, **Add Workflow**, **Add Artifact**, **Validate Package**, and **Prepare Package** actions.

### 8.3 Creating and adopting packages

**New Package** collects package ID, version, display name, description, license, publisher, tags, destination, and the first workflow source. The first workflow may be blank, copied from an example, or adopted from an existing pair.

Adopting an existing pair offers **Move into package** and **Copy into package** with an exact file preview. The operation checks collisions and updates both definition and companion paths transactionally. A workflow outside any package remains supported and is not silently converted.

### 8.4 Multiple workflows

A package may include multiple workflow pairs. Adding, renaming, or removing membership updates the manifest only after the filesystem and workflow-pair transaction succeeds.

Removing a workflow presents three explicit choices:

- remove the pair from package membership and leave its files in place;
- remove the pair and move its files to the operating-system trash; or
- cancel.

No option silently deletes referenced resources shared by other workflows.

## 9. Artifact editors

### 9.1 Workflow and companion YAML

Definition YAML retains Visual, Split, Form, and YAML modes. Companion YAML retains Form and YAML modes. Package awareness adds resource-reference actions and diagnostics without changing YAML authority.

### 9.2 Command Markdown

Command resources open in a CodeMirror Markdown editor with:

- YAML-frontmatter highlighting and validation;
- Markdown syntax highlighting;
- rendered preview;
- workflow and node references;
- recognized Hermes environment-variable documentation;
- Problems integration; and
- draft recovery and external-change conflict handling.

### 9.3 Script resources

Python, TypeScript, and JavaScript resources open in CodeMirror with language highlighting, matching-bracket behavior, search, folding, cursor visibility, line numbers, and diagnostics from bundled offline parsers. Parser error nodes provide static syntax diagnostics.

The editor displays the runtime inferred from the workflow reference and checks the canonical extension/runtime mapping. It shows all referencing workflows and nodes. It does not invoke Python, uv, Bun, Node, a compiler, a linter executable, or a language server process.

### 9.4 Structured and supporting resources

MCP YAML and recognized JSON/YAML resources use schema-aware editors when the canonical package contract supplies a schema. Plain-text resources use the text editor. Binary files expose filename, media type, size, digest inclusion, reference information, and **Replace**, **Reveal**, and **Open Externally** actions.

Generated digest and marketplace files open read-only with provenance explaining how to regenerate them.

### 9.5 Node-to-resource actions

Resource fields in the node inspector expose **Select**, **Create**, **Open**, and **Reveal in Package**. Creating a resource proposes the canonical path and extension, checks collisions, creates the artifact, patches the workflow YAML reference, reparses both, and records one undoable semantic transaction.

## 10. Validation and readiness

### 10.1 Save behavior

Users may save incomplete or statically invalid commands and scripts so they can recover and continue editing. Diagnostics do not trap an artifact in memory. Workflow definition/companion saving retains the existing syntactic and structural safety rules.

### 10.2 Preparation blockers

The following block **Prepare Package**:

- invalid definition or companion YAML;
- contract or DAG errors;
- invalid or unsupported package manifest;
- duplicate package or workflow identity;
- missing definition or companion declared by the manifest;
- a missing package-owned resource required by canonical resolution;
- invalid command frontmatter;
- statically invalid packaged Python, TypeScript, or JavaScript;
- runtime/extension mismatch;
- escaping, absolute, ambiguous, overlapping, or nested package paths;
- a symlink anywhere in the distributable package;
- file-count, per-file-size, or total-size violation;
- digest-generation or verification failure;
- marketplace-index schema or package-ID conflict; or
- a source revision changing during preparation.

### 10.3 Operational advisories

The following never block saving. They remain non-blocking package advisories unless the canonical Hermes contract classifies a specific declaration as structural:

- runtime availability;
- provider, model, tool, skill, credential, or service availability;
- dependency installation;
- network and MCP reachability;
- external co-worker requirements; and
- predicted execution success.

Studio labels these findings as destination-dependent and never claims that the package will run.

## 11. Preparation and update flow

Studio uses the terms **Saved**, **Prepared locally**, and **Available from repository**. It never labels a commit published because it does not inspect or change the remote.

### 11.1 New package

```text
save all package artifacts
  -> validate workflows and package
  -> review advisories and execution surface
  -> choose semantic version
  -> stage deterministic generated files
  -> verify source revisions and computed digest
  -> review exact package and index diff
  -> create a package-scoped local Git version
  -> show commit identity and external push guidance
```

### 11.2 Package update

Studio compares the working package with its most recent reachable local Git version. It reports added, modified, removed, and renamed workflows and resources; metadata-only changes; new external requirements; and changes that affect trust.

Studio suggests a patch, minor, or major increment based on deterministic rules and explains the suggestion. The user chooses the final version. A changed digest requires a version greater than the local baseline. Preparing an unchanged package version is rejected.

Because Studio does not fetch, it cannot prove that the local baseline is the newest remote version. The preparation screen states this constraint.

### 11.3 Two-phase generation

Preparation writes generated candidates into an app-controlled temporary staging directory, validates them, rechecks every source identity/revision, and then atomically replaces generated workspace files. It recalculates the resulting workspace package digest before invoking Git.

A failure before replacement leaves the workspace untouched. A partial replacement failure restores the prior generated files from the staging transaction or reports an explicit recovery action; it never creates a Git version from a partially generated package.

## 12. Local Git behavior

Package version creation extends the existing exact-path Git mechanism. The confirmation lists every package file and the single marketplace-index path included in the commit. The operation preserves unrelated staged changes, unstaged changes, untracked files, and Git configuration outside that generated index path.

The marketplace index is shared repository state. Studio computes the expected index from a captured file identity and refuses preparation if the index has any concurrent or manually authored change that would overlap the generated replacement. The user may prepare all affected packages together or resolve the index changes first; Studio never attempts to commit selected hunks from an ambiguously modified generated file.

On success Studio displays the commit ID, package ID/version, included files, and generic commands or guidance for pushing with the user's existing Git tooling. Studio does not create or update local tags automatically.

Git remains optional for ordinary artifact saving. A Git repository is required for **Prepare Package Version** because a version must have immutable local provenance. A user without Git may export a package directory for review, but Studio labels it **Unversioned package export**, not prepared or published.

## 13. Recovery and external changes

Draft recovery expands from workflow YAML to every editable text artifact. Recovery records are keyed by workspace, package-relative path, saved identity, and artifact type and are stored in app data rather than package output.

Clean externally changed artifacts reload automatically. Dirty artifacts use the existing **Keep Mine**, **Reload Disk**, and **Compare** choices. Package preparation snapshots file identities and stops if a watcher, editor, or external process changes any included source.

Rename and move operations update recognized references only when the canonical resource resolver proves the rewrite is unambiguous. Unknown textual references are preserved and reported for manual review. No unknown or unsupported content is silently dropped.

## 14. Security boundary

All paths are resolved immediately before native access and must remain inside the selected workspace and package roots. Package scans are bounded, do not traverse symlinks, exclude Git internals and app state, and reject distributable symlinks even when their targets remain inside the package.

The renderer cannot invoke arbitrary executables. Native commands remain narrow and accept typed argument arrays without shell interpolation. Static script parsing uses bundled libraries in the renderer/worker boundary and never imports or executes the script.

Package manifests, marketplace metadata, commands, and scripts are untrusted content. Their displayed names, descriptions, and previews are escaped and cannot inject HTML, CSS, JavaScript, Tauri commands, or filesystem paths.

Private/public remote access is outside Studio. No remote URL or credential is necessary to prepare a package locally.

## 15. Co-worker handoff

The companion Hermes marketplace implementation will support public and authenticated private Git repositories. Its installer must:

1. resolve an index/package selection to a Git repository and exact commit;
2. fetch into bounded temporary staging using the user's configured Git credential path;
3. reject unsafe paths, symlinks, sizes, and counts;
4. validate the package and its workflows against the installed Hermes contracts;
5. independently compute and compare digests;
6. run compatibility and risk analysis;
7. present scripts, commands, MCP resources, requirements, and outward-action risk;
8. atomically install the package under the active profile;
9. record source and exact commit provenance outside the package; and
10. request explicit trust for the exact installed package/risk digest.

An update repeats the full process. Package metadata cannot grant or carry trust. Any covered byte change invalidates prior trust according to Hermes policy.

No sibling `hermes-agent` source is changed under the Workflow Studio implementation plan. The Hermes contract and installer require a separately approved upstream specification and plan.

## 16. Documentation

The following offline guides are required:

- Workflow Packages Overview
- Package Folder Structure
- Creating Your First Package
- Adding Multiple Workflows
- Command Markdown Resources
- Python, TypeScript, and JavaScript Resources
- MCP and Supporting Resources
- Packaged Versus External Requirements
- Package Validation and Readiness
- Versions, Digests, and Trust
- Preparing a New Package
- Updating an Existing Package
- Publishing Through Git
- Installing and Updating from the Co-worker
- Package Troubleshooting

Existing node documentation links to the relevant artifact guide. Contextual findings link to a precise topic and, when safe, a deterministic action such as **Create Command**, **Create Script**, or **Reveal Resource**.

Studio bundles complete validated example packages for laptop diagnostics, multiple workflows in one package, command resources, and external requirements. **Create Editable Copy** writes the entire package rather than extracting only a YAML pair.

Documentation tests verify search indexing, internal links, context targets, schema/path accuracy, example-package validity, and language that distinguishes local preparation from remote publication and runtime execution.

## 17. Component boundaries

TypeScript modules own:

- package discovery projections;
- manifest and marketplace schema validation;
- workflow/resource reference resolution;
- command and script static parsing;
- package readiness and risk presentation;
- update comparison and semantic-version suggestions; and
- deterministic digest/index composition against Hermes test vectors.

Feature-owned stores hold shared package-selection, readiness, and preparation state. Ephemeral editor interaction remains component-local.

Rust owns only privileged operations:

- scoped package file reads and atomic writes;
- bounded directory metadata and hashing access where required;
- binary import/replacement and external-open requests;
- watcher integration;
- temporary staging and atomic generated-file replacement; and
- exact-path Git preparation and commits.

Package parsing, static validation, Git queries, hashing, and file I/O never occur during pointer-move frames.

## 18. Verification

### 18.1 Unit and property tests

Tests cover package discovery, nested/overlapping package rejection, manifest validation, semantic versions, resource resolution, reference rewrites, parser diagnostics, deterministic sorting and hashing, marketplace generation, operational/blocking classification, and trust-impact summaries.

Property tests cover path traversal, Unicode and separator handling, collision generation, symlink-shaped inputs, manifest ordering, digest determinism, and arbitrary unknown-field preservation.

### 18.2 Component and accessibility tests

Tests cover Packages navigation, overview status, every artifact editor, node-to-resource actions, Problems navigation, generated-file read-only behavior, keyboard flows, focus restoration, accessible names, high contrast, and reduced motion.

### 18.3 Filesystem and Git integration tests

Tests use real temporary directories and Git repositories. They prove multi-package discovery, package creation/adoption, atomic generation, rollback, external-change conflicts, package-only commits, unrelated-change preservation, shared-index conflict refusal, missing identity handling, and recovery after interrupted preparation.

### 18.4 End-to-end and cross-repository fixtures

End-to-end tests cover creating a package, adding multiple workflows, creating command/script resources from nodes, editing artifacts, resolving readiness findings, preparing a new version, updating a package, and recovering from invalid or externally changed resources.

Hermes-owned cross-repository fixtures prove that Studio and the co-worker resolve resources and compute package/index digests identically on macOS, Windows, and Linux. A test spy and native-command allowlist prove that no artifact editor or validator invokes an executable.

The existing 250-node/500-edge canvas performance contract remains required; package background work must not degrade canvas interaction.

## 19. Delivery sequence

1. Specify and version the Hermes portable-package, digest, resource-resolution, and marketplace-index contracts with shared fixtures.
2. Add read-only package discovery, multi-package projection, and package overview to Studio.
3. Add command, script, structured-resource, text, and binary artifact handling.
4. Add node-to-resource transactions, reference validation, draft recovery, and external-change support.
5. Add readiness, deterministic generation, and package update comparison.
6. Add package-scoped Git preparation and version creation.
7. Add offline documentation and complete example packages.
8. Run cross-platform and cross-repository compatibility verification.
9. Design and implement the separate Hermes public/private marketplace installer.

## 20. Acceptance criteria

The feature is complete when a user can:

1. open a repository containing multiple package roots;
2. create or adopt a package without losing an existing workflow pair;
3. include multiple definition/companion pairs in one package;
4. create and edit all supported text artifacts inside Studio;
5. import and manage binary resources without executing them;
6. navigate between nodes and referenced package resources;
7. distinguish package blockers from destination-dependent advisories;
8. recover incomplete or invalid artifact edits;
9. inspect package contents, resource references, execution surface, and trust impact;
10. generate the canonical manifest, digests, and marketplace entry deterministically;
11. prepare a semantic package version as a package-scoped local Git commit;
12. preserve unrelated repository changes;
13. receive accurate instructions to push outside Studio;
14. find complete offline documentation and package examples; and
15. verify through automated evidence that Studio never executed package content.
