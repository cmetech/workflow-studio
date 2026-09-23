# Workflow package and marketplace contract reconciliation

**Date:** 2026-09-22  
**Scope:** Reconcile the approved September 3 package design and implementation plan with the agent implementation. This is a documentation change, not implementation or authorization to change the sibling repository.

## Decision

Keep the approved division of responsibility: loop24 authors complete packages and prepares local Git versions; the user's Git client pushes them; the agent marketplace discovers, verifies, installs, and requests trust. A package includes its workflows, scripts, command resources, MCP definitions, fixtures, and other supporting files. YAML remains the only workflow graph authority.

The package-format prerequisite is now available. The resource-resolution prerequisite is only partially covered: the package contract's `resource_rules` contains size/count limits, not rules for resolving workflow references. Do not implement a competing Studio-owned inventory of resource fields or claim preparation is complete before that boundary is reconciled.

## Evidence and pin

Reviewed Studio base `b79d4b1646cb93b47ddab2bf695fc614caf5814e` and agent base `748b6c5711bc055449cc245dc4e9800cc6bb0412`. Agent paths below are relative to the sibling `hermes-agent` repository at that immutable commit.

| Artifact | SHA-256 of committed bytes |
| --- | --- |
| `plugins/workflow/contracts/workflow-package-v1.json` | `e728d99608e9186a08fc2b866cdaa9f116d8f51c5cde68930a82ef79d398e30d` |
| `plugins/workflow/contracts/workflow-package-v1-vectors.json` | `644055e4234837f3e42ccaa952ed1622cf67edc96db69e983556580fb6ce82ed` |

Both checkout files match the committed bytes. Store these pins in Studio-owned provenance when importing the artifacts; do not add fields to upstream JSON. This checksum establishes artifact identity, not publisher trust.

Primary implementation evidence:

- `plugins/workflow/marketplace/contract.py` and `models.py`: envelope, schemas, limits, semantic validators, and diagnostics.
- `plugins/workflow/marketplace/package.py`: filesystem checks, hashing, index/package verification, and descriptor-safe traversal requirements.
- `plugins/workflow/marketplace/service.py`, `git.py`, and `trust_binding.py`: marketplace operations, repository access, package compilation, and trust boundaries.
- `plugins/workflow/language_schema.py` and `resources.py`: authored script discriminator and runtime resource lookup.
- `apps/desktop/src/app/workflows/marketplace/index.tsx`: existing marketplace route.
- `website/docs/user-guide/features/workflow-packages.md`: existing package and marketplace documentation.

## Corrections to the old plan

| Previous assumption | Actual boundary and required change |
| --- | --- |
| Envelope has `schema_version`, reader version, and embedded contract digest | Envelope uses `contract_version: 1`. Verify an external exact-byte provenance pin; there is no embedded `contract_digest`. |
| `resource_rules` is an array of resolvers | It is an object containing six limits. Resource resolution needs a separate coverage/export gate. |
| Contract has `limits` and `digest` | Consume `resource_rules` and `digest_rules`; include `path_rules`, `compatibility_rules`, `diagnostic_codes`, and all three schemas. |
| Shared vectors have `cases` | Consume `digestVectors`, `pathVectors`, `validationVectors`, and `boundaryVectors`, with envelope `contractVersion`. |
| Marketplace installer is future upstream work | It exists in the pinned agent. Remaining work is compatibility and deployment-platform verification. |
| Exclude repository/app files while scanning a package | Include all regular package files except exact root-relative `digests.json` in hashing. Reject prohibited repository metadata rather than silently excluding it. Keep editor state outside packages. |

## Package format acceptance

The manifest requires `schemaVersion`, `id`, `version`, `displayName`, `description`, `license`, `publisher`, `tags`, `workflows`, and `externalRequirements`. Tags cannot be empty. Requirements contain the five lists `runtimes`, `tools`, `providers`, `services`, and `secrets`; secrets are names, never values. Definition and optional companion membership must be valid, unique package-relative YAML paths.

Schema validation alone is insufficient. Match agent semantic validation for canonical paths, cleaned/unique strings, case-folded membership collisions, sorted and unique index records, non-overlapping package paths, and manifest/index metadata agreement. Preserve upstream diagnostic codes in technical results while keeping user-facing brand copy loop24.

The repository index is `.well-known/hermes-workflows/index.json`, with `schemaVersion: 1` and sorted package entries. Each entry carries repository-relative `packagePath`, `contractVersion`, `packageDigest`, and the manifest's public metadata. Validate that metadata against the actual package, not just against the index schema. The index is outside package roots in the supported layout.

| Limit field in `resource_rules` | Value |
| --- | ---: |
| `max_files` | 512 |
| `max_file_bytes` | 1,048,576 |
| `max_total_bytes` | 8,388,608 |
| `max_index_bytes` | 1,048,576 |
| `max_catalog_entries` | 4,096 |
| `max_traversal_entries` | 4,096 |

The per-file package limit also applies to packaged workflow YAML. This must not reduce the existing standalone workflow save/export limit. Supporting files count toward package limits; declaring dependencies does not install them or make the package a self-contained runtime.

Paths must already be NFC, use `/`, and be relative, without empty/dot/traversal segments, backslashes, NUL, or drive-prefixed segments. Reject invalid Unicode, full Unicode case-fold collisions, symlinks, nested roots, and repository metadata. Do not silently normalize unsafe names. JavaScript `toLowerCase()` is not equivalent to Python Unicode case folding. The agent desktop's generated case-fold implementation is a reference for a versioned equivalent; fixture parity must include file/directory aliases and ancestor collisions.

### Digest bytes and vectors

Hash exact file bytes: no YAML formatting, text decoding/re-encoding, or newline normalization. Include unreferenced and Git-ignored supporting files. Exclude only root-relative `digests.json`; a nested `fixtures/digests.json` is included. Digest exclusion is not permission to bypass filesystem safety checks.

Sort canonical paths by Unicode code point, not locale collation or JavaScript's default UTF-16 ordering. Start the composite hash with the contract's base64-decoded domain (`hermes.workflow-package.v1` followed by NUL). Append, for every sorted file, the unsigned 64-bit big-endian UTF-8 path byte length, path bytes, unsigned 64-bit big-endian file size, and raw 32-byte SHA-256. The result is 64 lowercase hexadecimal characters without a `sha256:` prefix.

`digests.json` uses `contractVersion`, `algorithm`, sorted `files` records (`path`, `size`, `sha256`), and `packageDigest`. Its schema and semantic invariants must both be checked.

The reviewed vectors contain 7 digest, 11 path, 7 validation, and 12 boundary cases. These counts describe this revision, not acceptance assertions to freeze into tests. Decode UTF-8/base64 file inputs and execute boundary recipes, including generated file sets and filesystem-entry limits. Do not silently skip large recipes or assume every case is a digest input.

## Resource resolution and script editors

The current authoring export includes the inline-versus-resource script discriminator. Studio already bundles it in `contracts/archon-2026-07-v6.json` under `reference_scanner_v1.interpolation_surface.value_discriminators_v1`; the legacy contract lacks that descriptor. Reuse the applicable profile's declared behavior; whitespace/punctuation code-point rules are broader than a newline or filename-extension heuristic. The package contract does not export runtime lookup, extension fallback, or transitive-resource resolution rules.

| Surface | Inspected runtime behavior | Portable coverage still needed |
| --- | --- | --- |
| Inline/named script | Authoring discriminator; `uv`/`bun` lookup in `ResourceResolver.script` | Ordered candidates, extensions, ownership, and profile-specific fixtures |
| Command resource | `ResourceResolver.command` resolves contained command names to `commands/<name>.md` | Name validation, suffix handling, loop-command references, and fixtures |
| MCP definition | `ResourceResolver.mcp_servers` tries package-relative, `mcp/`-relative, then `.yaml` candidates | Candidate precedence, definition-specific limits/normalization, and transitive file dependencies |
| Compiler dependency bindings | Marketplace service collects command, loop-command, named-script, MCP, and MCP-resource bindings | Exported mapping from all applicable authoring fields, including nested/composed workflows, to these bindings |

This is the initial coverage map, not a replacement resolver inventory. Complete it against compiler behavior and shared fixtures before implementing Task 3; do not translate this prose into hard-coded field lists.

The inspected runtime supports script resources for `uv` (Python) and `bun` (TypeScript/JavaScript). Named resources resolve under `scripts/`; suffixless lookup includes the runtime's ordered extension candidates. Package compilation resolves from the package root, not from the workflow YAML's directory. An external-requirement declaration cannot excuse a missing package-owned script.

Before Task 3, map each authoring-contract reference surface to the agent resolver, including commands, MCP definitions, nested/composed workflows, transitive dependencies, ambiguous/missing files, and package versus external ownership. Record which existing machine-readable descriptors suffice. Where coverage is missing, obtain a separately authorized upstream export with shared resolution vectors, pin it, and add consumption tests. Do not infer the missing inventory in Studio or alter the sibling repository under this task.

The approved editor scope includes Python, JavaScript, and TypeScript artifact editors. Bash is a separate inline node in the current workflow language. A packaged `.sh` file may be supporting text, but that does not establish a script-node runtime or a valid external shell-script reference. A richer inline Bash editor is a scope clarification for subsequent design work; do not silently introduce `runtime: bash`, change node semantics, or promise execution support. All editors remain static and offline.

## Publishing handoff and remaining acceptance

1. Edit and save package files in loop24; validate format and resolved package resources.
2. Prepare the selected version: manifest, exact-byte digests, repository index, and an exact-path local Git commit.
3. Push with the user's existing Git client. Studio can explain the handoff but cannot claim remote availability from local preparation alone.
4. Refresh the configured repository source in the agent marketplace; inspect and install the selected package at an exact commit.
5. Review and grant trust separately in the destination agent profile. Updates repeat verification and trust evaluation.

Shared-index generation must not publish an unrelated dirty package's working-tree digest in a commit that excludes its files. Preserve unselected entries against the committed repository snapshot or stop with an explicit conflict. Test selected and unselected dirty packages together. Changed package bytes require an advancing SemVer version under agent precedence; build metadata alone does not advance precedence.

The agent requires descriptor-safe filesystem traversal (`_HAS_DESCRIPTOR_WALK`) and fails closed when it is unavailable. Verify the actual destination backend/OS; do not equate Windows Studio authoring support with native Windows agent marketplace installation support. Remote credentials belong to the configured agent backend, not implicitly to the Studio laptop.

Cross-repository acceptance must exercise a Studio-produced multi-workflow package with scripts, commands, MCP/supporting files through the pinned agent's index/package validators and compile/review/install flow, plus changed bytes, metadata mismatch, version update, and trust invalidation. This reconciliation does not establish that those integration tests pass.

## Implementation readiness and verification performed

- Tasks 1–2 can start with the pinned format artifacts and semantic-validation fixtures. Scoped I/O and editor work can proceed when their declared dependencies are available.
- Task 3 is gated on demonstrated resource-contract coverage; dependent node-reference actions and full preparation in Tasks 10–13 must not claim completion before that gate passes. Define analyzer interfaces/fixtures in Task 3 and integrate real analyzers from Tasks 6–7 before readiness acceptance.
- Keep all implementation checkboxes unchecked. No Studio feature or sibling agent source was changed by this reconciliation.
- Verified both artifact SHA-256 pins against Git object bytes and checkout bytes. An independent Node byte-level probe passed all seven upstream digest vectors, including LF/CRLF, binary, Unicode, empty content, and ordering. This was not the full path/validation/boundary suite or a marketplace installation test.

Related documents: [design](../superpowers/specs/2026-09-03-workflow-package-authoring-and-local-publishing-design.md), [implementation plan](../superpowers/plans/2026-09-03-workflow-package-authoring-local-publishing.md).
