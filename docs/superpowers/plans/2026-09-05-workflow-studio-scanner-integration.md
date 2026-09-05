# Workflow Studio scanner integration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the paused Task 6 using the reviewed Hermes scanner publication, then complete Tasks 7–14 of the approved loop-group authoring plan.

**Architecture:** Hermes remains the language authority. Studio bundles its declarative metadata and literal corpus and implements a faithful TypeScript scanner. One indexed analysis of the document supplies reference validation and mutation discovery; Unicode code-point spans become UTF-16 only where editor/CST ranges require it. No interpreter, bytecode, executable transition program, or workflow runtime is introduced.

**Tech Stack:** Existing TypeScript/Svelte/Vitest/Playwright/yaml toolchain; Hermes Python is a development-only differential oracle.

**Spec:** `docs/superpowers/specs/2026-08-31-workflow-studio-loop-group-visual-authoring-design.md`, with the user's approved declarative scanner amendment and Hermes `docs/superpowers/specs/2026-09-04-declarative-reference-scanner-design.md` as language publication authority.

## Global constraints and execution boundary

- Continue the existing `feat/loop-group-visual-authoring` worktree, starting at `213cbbe4987bf6fdc6f39d1f8b8ce2e0b3e9d78c`.
- Read Hermes only, pinned to integrated `base` commit `a960d5e7c8158f2ab2c315ab0d406eb81c96e3f6`. Never modify another worktree.
- Archon contract digest: `sha256:f435a385f26c971d37f3c691ed6f42d2aa76e7b0c24b199455f4002b0ab1976f`; corpus digest: `sha256:ebbd30326de23984e254929774b4dd7d7f8a71f59c050da7a3ac9bfe190256a7`.
- Preserve legacy corpus format 1, 11 cases, 7,265 canonical bytes, SHA-256 `c193258148699fbcbc42c909dee10001632377272e57a0ff3b79f3493f158a3b`.
- Preserve YAML, comments, unknown fields, and offline operation. No independent field inventory or regex-only Bash classifier.
- Use only inventory-derived interpolation surfaces: 18 root fields, 18 body fields, two group controls. Contract reader 3 requires the complete scanner capability.
- No runtime execution, authenticated local resource reads, or substitutions of user workflow values in the application. Corpus runtime observations remain explicitly identified characterization; test-only adapters may supply literal values/resources to exercise shared scanner/path behavior. Every case must be accounted for, with no silent skips or expected-output-driven dispatch.
- Fixed Unicode profile selection must be explicit and tested. Unsupported metadata/profile/behavior fails capability activation or produces a blocking authoring diagnostic; it cannot silently pass validation.
- Maintain 250-node/500-edge capacity per graph scope and no heavy work during pointer frames.
- TDD and focused task reviews precede subsequent dependent tasks. No new broad architectural review cycle.
- The user authorized implementation and feature commits. Merge, push, release publication, and installation over an existing user app remain separate approval boundaries.

## Requirements-to-tests traceability

| Requirement / prior finding | Required evidence | Task |
| --- | --- | --- |
| S1 metadata activation | Mutate each required scanner/grammar subtree with a valid recomputed digest; activation fails and previous contract stays active | 6A |
| S2 exact candidates and malformed suffixes | Literal ordinary/previous/span/lazy cases plus differential suffix permutations | 6A |
| S3 Bash states | Literal quoting, escapes, comments, substitutions, arithmetic, arrays, heredocs, here-strings, functions, coprocesses, nesting, EOF cases; differential combinations | 6A |
| S4 structured paths | Corpus containing constraints, local refs with siblings, union and numeric object/array cases through pure path evaluator | 6A, 6B |
| S5 full interpolation inventory | Traverse bundled surface metadata and exercise every applicable field through real analysis | 6B |
| S6 root Phase-4 surfaces | Real systemPrompt, agents and hooks fixtures, including malformed and missing dependencies | 6B |
| S7 diagnostic meaning and precedence | Whole workflow corpus plus body-when quoted RHS, current/outer missing and unknown previous producer witnesses | 6B |
| S8 one index per document/contract | Instrument index construction/traversal; several groups and all surfaces do not multiply full walks | 6B |
| S9 performance | Existing module budgets plus scoped 250/500 pointer isolation and browser journeys | 6B, 13 |
| S10 Unicode offsets | Astral prefixes/combining marks; code-point spans and boundary-only UTF-16 mapping | 6A, 6B, 7 |
| Digest drift and offline packaging | Double generation, embedded/canonical pair hashes, resource integrity, bundled corpus and build checks | 6A, 12, 14 |
| Correct editing and complete product | Original Tasks 7–14 golden/property/component/E2E acceptance | 7–14 |

## Task 6A: Bundle and implement the scanner capability

**Files:** `src/lib/contract/{contract-loader,scoped-dag-rule,conformance,contract-cache}.ts` and tests; new focused modules under `src/lib/references/`; `scripts/{sync-contracts,validate-contracts}.ts` and tests; generated `contracts/` pair/manifest; resource integrity manifest.

**Interfaces:** Export `scanReferences(text, mode, options)` with ordinary/previous tokens containing producer ID, path segments and half-open code-point spans; explicit syntax/context errors retain native identifiers and authored offsets. Export `outputPathImpossible(schema, path)` and code-point/editor offset conversion. Keep lower-level generators and classifier callable for conformance observation. Document exact exported types in the task report before Task 6B.

- [ ] Add and run failing reader-3/pair tests using exact generated Hermes output and mutation-based unsupported capability cases.
- [ ] Synchronize deterministic files from the pinned read-only Hermes CLI; compare two emissions and digest/legacy baselines.
- [ ] Add literal corpus observation tests before the scanner implementation. Iterate real failing families to green, retaining lazy partial outputs and error precedence.

```ts
for (const fixture of corpus.scannerCases) {
  test(fixture.id, () => {
    expect(observeScannerCase(fixture)).toEqual(expectedForSelectedProfile(fixture))
  })
}
```

The observation adapter dispatches on documented API names and inputs only. Expected values enter assertions only. Authenticated-resource and runtime-output cases must state their test-only boundary and exercise the same production scanner/path functions, or be reported explicitly as Hermes-only observations with authoring coverage mapped separately.

- [ ] Implement direct TypeScript state handling from the unchanged Python authority and declarative description; split grammar, Bash classification, Unicode predicates, conditions, and structured paths by responsibility. No VM.
- [ ] Run deterministic adversarial differential inputs against the pinned Python scanner; save seed/command/count and any counterexamples. Correct mismatches with independent regression literals.
- [ ] Run focused unit tests, `npm run check`, `npm run contracts:check`, `npm run resources:verify`; review spec compliance and code quality, fix findings, commit exact paths.

## Task 6B: Integrate indexed reference validation

**Files:** `src/lib/validation/{scoped-dag-validator,dag-validator,analyze-workflow}.ts` and tests; focused new reference surface/index module; editor diagnostics where span conversion belongs; relevant performance tests.

**Interfaces:** One reference index per analysis contains resolved field occurrences grouped by graph scope/consumer and scan mode, including group controls; one prepared contract capability is reused. Both validation and later scoped mutation discovery consume these shared routines.

- [ ] Write failing tests for all ten traceability rows not already closed by 6A, plus all workflow corpus expectations.

```ts
for (const fixture of corpus.cases) {
  const result = await analyzeFixture(fixture, contract)
  expect(result.structurallyValid, fixture.id).toBe(fixture.valid)
  expect(portableDiagnostics(result), fixture.id).toEqual(fixture.diagnostics)
}
```

- [ ] Replace regex-only discovery with the scanner. Resolve ordinary, previous, outer and group policy from the published surface, preserving quoted body-when two-stage behavior and diagnostic ordering.
- [ ] Share maps for nodes/scopes/producer schemas and one surface traversal. Preserve containing-schema constraints rather than flattening `$ref` or unions.
- [ ] Check root/body 250/500 analysis costs and confirm editor offsets with astral text. Run focused and complete unit suites plus static checks.
- [ ] Review both compliance and quality once for the completed Task 6 correction; resolve confirmed findings with scoped re-review and commit.

## Tasks 7–14: Resume the approved visual-authoring plan

Execute the complete task definitions and tests in `2026-08-31-workflow-studio-loop-group-visual-authoring.md` in order: scoped CST mutations (7), reference-safe actions/clipboard (8), scoped layout and navigation state (9), compound canvas/drill-in (10), generated controls/palette/guidance/Problems navigation (11), offline examples/docs (12), cross-engine/performance acceptance (13), full gates and final review (14).

Task 14's Hermes reimplementation/merge/push instructions are historical and already superseded by the separately completed upstream work. Recompare the bundled bytes against the pinned integrated authority, without modifying Hermes. Complete local builds and feasible smoke checks; document unavailable native evidence. Stop before Studio merge/push/publication for the user's approval.
