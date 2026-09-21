# Workflow Studio v3.0.3 release acceptance

Version/tag: `3.0.3` / `v3.0.3`

Recorded September 21, 2026. Status: preparing; not yet tagged or published.

The user authorized committing, merging, pushing and releasing v3.0.3. Publication requires passing CI, native builds and independent draft integrity verification. No installation over the user's current application is performed.

## Scope and evidence

This release replaces application-facing Hermes branding with loop24 or neutral wording. Raw YAML, technical profile identifiers, filenames, paths and Git diffs remain accurate. Dependencies, persisted workflow semantics, installer behavior and updater signing keys remain unchanged.

- [UI copy audit](../analysis/2026-09-21-ui-brand-copy-audit.md).
- [Test investigation](2026-09-21-ui-copy-test-investigation.md): 2,365 passing tests in the corrected full run plus 89 installer tests in the isolated rerun after restoring canonical LF bytes. This is combined evidence from two runs, not a claim of a single green full run.
- Existing v3.0.2 accepted performance exceptions remain recorded in its acceptance document; this patch makes no new performance claim.

## Gates

- [x] Release authorized.
- [x] Metadata RED/GREEN and local static/resource/bundle verification.
- [x] Independent source review completed.
- [ ] Preparation PR and merged base CI passed.
- [ ] Every linked worktree inspected immediately before tagging.
- [ ] Immutable annotated tag points to tested origin/base commit.
- [ ] Three native jobs and final draft verifier passed.
- [ ] Ten downloaded assets, nine checksums and updater signatures independently verified.
- [ ] Extracted Windows payload and protected macOS payload checks passed.
- [ ] Published as latest and anonymous public downloads verified.
- [ ] Development checkout returned to base.

Clean-machine functional installation and staged-update exercises remain post-publication follow-up.

## Local preparation

The new release expectations first failed five assertions against 3.0.2, then passed all ten metadata tests after synchronization. Eight direct presentation-copy tests additionally pass, including filename, Windows/Unix path, technical profile and mixed-case prose preservation. Independent read-only review found no critical or important issues; its non-blocking boundary-test suggestion is addressed by these tests.

Changed-file formatting and lint, Svelte/TypeScript checks, bundled contracts/examples, all 42 resource checks and the freshly built production bundle budget pass. The repository-wide local formatting command encountered existing CRLF checkout differences; a broad local test filter also discovered the retained nested worktree's older tests. The focused rerun explicitly excludes `.worktrees/**`. Clean CI remains the full committed-tree gate.
