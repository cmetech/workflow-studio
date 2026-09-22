# Upstream package resource-resolution contract amendment

**Status:** Authorized by the user on 2026-09-22; implemented upstream and independently reviewed with a PASS verdict. Current artifact pin: `3e89c2659b6e9c95a627b8f819ff63a11529d86a`, including the independently reviewed serialized-fixture correction. Studio pins the exported artifacts; the Task 3 workflow-level interpreter/parity work remains separate. Merge, push, and release are outside this amendment.

**Goal:** Let offline Studio consumers resolve package resources using agent-owned descriptors and parity vectors, rather than copying Python field lists or guessing lookup behavior.

**Reference:** Agent commit `748b6c5711bc055449cc245dc4e9800cc6bb0412`; [Studio package plan](2026-09-03-workflow-package-authoring-local-publishing.md), Task 3 entry gate; [contract reconciliation](../../analysis/2026-09-22-workflow-package-marketplace-contract-reconciliation.md).

## Verified gap

The published package contract exposes format, path, digest, and budget rules only. The current Archon authoring export supplies command/script/loop-command interpolation surfaces and the inline script discriminator, but not ordered filesystem lookup, full MCP reference coverage, or transitive resource closure. The legacy export does not contain the same discriminator descriptor.

The compiler and runtime have distinct lookup paths that must not be conflated:

- `plugins/workflow/dependency_manifest.py`, `_source_command_path`: first the authored path under `commands/`, then `Path.with_suffix('.md')`.
- `_source_script_path`: the authored path under `scripts/`, followed by runtime-specific `with_suffix` candidates; Bun includes `.ts` and `.js` candidates in order.
- `_source_mcp_path`: package-relative, `mcp/`-relative, then `.yaml` suffix replacement.
- `_source_resource_path`: first existing, cached, or symlink candidate is selected for subsequent safety validation; it does not simply skip an unsafe higher-priority candidate.
- `plugins/workflow/resources.py`, `ResourceResolver`: runtime and sealed-snapshot behavior, including suffix validation and command `.md` handling. These methods alone are not the compiler's package-preparation contract.
- `dependency_manifest.py` also binds loop commands, origin-scoped included workflows, named scripts, effective MCP options, and local MCP resource files. `compilation.py` and `includes.py` own source composition and package origins.

The export must identify applicable profile/compiler mode and preserve these distinctions. A Studio-only extension table would be insufficient.

## Bounded upstream work

1. Read upstream AGENTS.md and applicable plans, establish an isolated branch from upstream `base`, and run the relevant existing resolution/compiler baseline tests. Do not alter the shared checkout or release state.
2. Add a versioned declaration of resource-reference surfaces and lookup operations owned by the workflow language/compiler. Reuse existing field/discriminator identifiers. Where candidate generation is presently hard-coded, extract the smallest shared declaration/helper consumed by both the existing resolver and exporter; preserve behavior with test-first parity checks. Do not introduce a second field inventory solely for Studio.
3. Publish two proposed artifacts under `plugins/workflow/contracts/`: `workflow-package-resource-resolution-v1.json` and `workflow-package-resource-resolution-v1-vectors.json`. Final names and envelope should follow upstream conventions. Export deterministically from the declarations, with no environment paths, credentials, execution, or network dependence.
4. Describe, at minimum: contract/version/profile identity; authored reference selectors and nested scope traversal; existing inline/literal discriminator identity; owning source-package root; ordered candidate operations including append versus replace-suffix; allowed runtime/suffix rules; first-candidate and unsafe-candidate behavior; packaged versus external ownership; dependency/closure relationships; and stable missing/invalid/unsupported diagnostics. Use a finite declarative vocabulary, not executable expressions shipped to Studio.
5. Generate shared fixtures from actual compiler/resolver behavior. Cover top-level and nested nodes, included workflow origins, uv/bun scripts, inline single-line/punctuation/Unicode whitespace cases, explicit and missing extensions, competing candidates, unsafe first candidates, commands and loop commands, MCP definitions/local closure, missing external requirements versus missing packaged files, path escape, and unsupported profile/version. No user script or MCP process is executed to generate these fixtures.
6. Verify deterministic export, all relevant language/compiler/marketplace regression gates, and exact behavior preservation. Record unsupported surfaces explicitly rather than claiming a complete portable resolver. Commit upstream changes separately; do not merge, push, or release as part of this amendment.
7. In Studio, pin the resulting immutable artifacts, prove coverage of every supported resource surface, implement a bounded interpreter and shared-vector adapters, and then resume Task 3. Full preparation and Tasks 10-13 remain gated until coverage and parity pass. The five mandatory Studio adversarial rounds include this cross-repository boundary.

## Explicit scope limits

This amendment does not add Bash as a script runtime, change workflow execution semantics, install dependencies, add remote Git operations to Studio, implement a new marketplace, grant trust, or publish a release. Any newly discovered need to change runtime behavior is a separate design decision, not an implicit part of exporting the current contract.

## Acceptance evidence

The upstream report is `docs/reviews/2026-09-22-package-resource-resolution-contract-review.md` in the agent repository. It independently reproduced committed bytes and checked 72 candidate combinations plus compiler/runtime/sealed/MCP/admission counterexamples. Symlink creation was unavailable on this Windows host and is explicitly unverified here. Broader upstream regression failures are recorded separately from the focused export checks; no full-suite success is claimed.

Studio's first interpreter replay subsequently exposed a serialized MCP fixture-order defect. The corrected fixture now observes its canonicalized published input. The separate `2026-09-22-package-resource-resolution-contract-vector-followup-review.md` reproduces the old defect and records PASS for the correction; runtime lookup code is unchanged. The prior frozen report remains intact. Upstream focused tests now report 12 passed and 1 symlink-capability skip.

Studio's [coverage matrix](../../analysis/2026-09-22-package-resource-resolution-coverage.md) records the remaining consumer obligations. Artifact verification and offline inclusion do not by themselves complete the semantic parity gate below.

- Every supported authored resource surface has an authoritative descriptor and executable parity fixture; unsupported surfaces fail closed.
- Published JSON is reproducible from the pinned upstream revision and can be bundled offline.
- Runtime/compiler lookup behavior before and after extraction is unchanged for existing fixtures, including unsafe and missing candidates.
- Studio tests consume exported descriptors and generated vectors, not a manually duplicated field/extension inventory.
- Each repository has separate commits, test evidence, and an unchanged unrelated working state.
