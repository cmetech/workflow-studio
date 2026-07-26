# Workflow Studio Development Guide

These instructions apply to the entire repository.

## Read before changing code

Read these documents in order:

1. `docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md`
2. `docs/superpowers/specs/2026-07-25-workflow-studio-design.md`
3. The current plan under `docs/superpowers/plans/`

The design specification is authoritative for product behavior. The implementation plan controls sequencing, test-first checkpoints, and verification commands.

## Core invariants

- YAML is the sole workflow source of truth. Never introduce a competing graph model as an independently persisted authority.
- Workflow output consists only of the definition YAML and optional companion YAML. Editor layout and application state do not belong in workflow YAML.
- The visual editor supports directed acyclic graphs only. Never commit a visual operation that creates a cycle, self-edge, duplicate dependency, or unresolved dependency.
- Saving and exporting require syntactically and structurally valid YAML. Missing runtime tools, providers, credentials, scripts, services, or trust remain non-blocking advisories.
- Workflow-language behavior comes from the versioned Hermes authoring contract. Do not hand-maintain a second field inventory.
- The app must work fully offline with its bundled contract, examples, documentation, and LOOP24 brand pack.
- Rust owns privileged native operations only. YAML language rules, projections, forms, and DAG semantics remain testable TypeScript modules.
- Git integration is local-only in version 1. Do not add remotes, authentication, push, pull, merge, rebase, reset, or background commits.
- Preserve comments, key order, scalar style, and unrelated YAML content during targeted visual edits whenever the syntax tree permits it.
- Never silently drop an unknown or unsupported YAML field.
- Do not parse YAML, validate the graph, run layout, query Git, or perform file I/O during pointer-move frames.

## Engineering workflow

- Use test-driven development: write the failing behavior test, verify the failure, implement the smallest correct behavior, verify the pass, then refactor.
- Prefer behavior and invariant tests over snapshots or enumeration-count tests.
- Use real temporary directories and real temporary Git repositories for filesystem and Git integration tests.
- Keep route and shell components thin. Shared state belongs in small feature-owned Nanostores; ephemeral component interaction may use Svelte rune state.
- Keep native commands narrow, capability-scoped, and free of shell interpolation.
- Use atomic writes and revision checks for user files.
- Treat accessibility, keyboard operation, and reduced motion as release requirements.
- Verify the 250-node/500-edge performance contract before claiming the canvas is complete.

## Git

The development branch for this repository is `base`. Create implementation branches from `base` and return the working checkout to `base` after release work.

Do not modify the sibling `hermes-agent` repository unless a plan task explicitly calls for the upstream authoring-contract amendment and the user has authorized that separate change.

