# Workflow package authoring: five-round adversarial code review

**Status:** Required review protocol; no review round has run yet.

This protocol accompanies the [implementation plan](../superpowers/plans/2026-09-03-workflow-package-authoring-local-publishing.md). It adapts the sibling agent's prompts at commit `748b6c5711bc055449cc245dc4e9800cc6bb0412`:

- `docs/reviews/2026-09-07-workflow-package-marketplace-adversarial-code-review-prompt.md`
- `docs/reviews/2026-07-27-workflow-language-foundation-adversarial-review-prompt.md`
- `docs/reviews/2026-07-17-portable-workflow-orchestration-adversarial-review-prompt.md`

## Controller instructions

Run five sequential rounds after feature implementation and the initial Task 16 verification. Each round uses a fresh reviewer context and the immutable candidate produced after the preceding round's remediation. These are five code reviews, not five passes over the plan and not five simultaneous reviews of an unchanged candidate. Run all five even if earlier rounds report no findings. Round emphasis does not limit a reviewer's ability to report defects elsewhere.

Before dispatch, create `docs/reviews/workflow-package-authoring/round-NN-prompt.md` from the reviewer prompt below. Replace all placeholders with actual values: repository/worktree path, feature-start commit, candidate commit/tree, pinned agent commit, changed-path inventory, applicable verification commands, and the reviewer's output path. Record SHA-256 values for binding documents and both package artifacts. Never dispatch an unfilled template or claim a review of uncommitted production changes.

Keep rounds 01 through 05 and their evidence separate. A fresh reviewer may use the available review agent; do not claim a particular model or independent external review unless it actually ran. Reviewer permissions are narrower than the implementer's. Reviews are read-only apart from the designated report; remediation belongs to the implementer. Do not dispatch reviewers until there is code to assess.

| Round | Primary emphasis | Required adversarial probes |
| --- | --- | --- |
| 01 | Contract fidelity and package compatibility | Exact-byte provenance, all vector families/recipes, semantic validation beyond JSON Schema, Unicode ordering/case folding, manifest/index agreement, resolver/profile coverage and honest unsupported behavior |
| 02 | Native filesystem safety and transactions | Traversal, symlinks/reparse points, directory replacement races, scan budgets, stale revisions, partial writes, rollback failure, crash recovery, and generated-file/source identity consistency |
| 03 | Authoring correctness and recovery | Inline/named scripts, runtime-specific lookup, YAML preservation, reference rewrites, multi-package state isolation, concurrent edits, invalid drafts, external changes, binary handling, and no accidental execution |
| 04 | Local Git and marketplace handoff | Exact selected paths, unrelated staged/dirty packages, shared-index consistency, SemVer precedence, repeat preparation, no remote side effects, independently verified agent compatibility and separate trust |
| 05 | Complete candidate and product/release readiness | Full feature range and unchanged consumers, regressions introduced by remediation, packaged offline assets, accessibility/focus/keyboard/reduced motion, 250-node/500-edge performance, loop24 UI copy, and truthful readiness/publication status |

For each round, freeze the independent report before revealing prior findings or remediation conclusions. Then reconcile it in `round-NN-reconciliation.md`: assign stable finding IDs, accept/reject/duplicate/unverified disposition, evidence, severity, reproduction, fix commit, regression test with observed failing/passing results, and residual limitations. A green suite or another reviewer's clean verdict cannot by itself reject a concrete counterexample.

Accepted Critical and Important findings block progression to the next round until fixed and verified. Minor deferrals need a recorded rationale and concrete user impact; severity follows impact, not the reviewer's label alone. Inaccessible evidence is UNVERIFIED, not PASS. Remediation uses test-first reproduction, focused checks, and affected regression checks. Run the complete Task 16 gate against the final corrected candidate.

If round 05 finds blocking defects, fix them and obtain targeted independent verification of those fixes on the new immutable candidate. This follow-up is additional evidence; it does not replace any of the five required rounds. Further changes after the final review require affected-scope review and verification. Do not merge or claim release readiness with open blocking findings or unverified required acceptance checks.

## Reviewer prompt (instantiate for each round)

You are an adversarial principal-level reviewer of TypeScript/Svelte, Rust/Tauri, YAML syntax-preserving editors, filesystem transactions, local Git, package integrity, accessibility, and offline release packaging. Try to falsify the implementation's claims. Treat test names, checklist completion, commit subjects, green CI, and prior review verdicts as unproved. Do not redesign the product or report personal preference as a defect.

### Immutable scope

- Round: `<01..05>`
- Round emphasis: `<table row above>`
- Repository/worktree: `<absolute path>`
- Feature-start commit: `<full SHA>`
- Candidate commit: `<full SHA>`
- Candidate tree: `<full tree SHA>`
- Read-only agent reference commit: `<full SHA>`
- Review range: `<feature-start>..<candidate>`
- Changed-path inventory and document/artifact checksums: `<attached verified inventory>`
- Required report: `docs/reviews/workflow-package-authoring/round-<NN>-review.md`

Begin with Git status and verify candidate commit/tree/range and the binding checksums. The candidate's tracked files must be clean. Prompt/report artifacts are not production changes. A mismatch is SCOPE ERROR: report it without repairing the checkout or silently reviewing another revision. Review final files and relevant unchanged consumers, not just hunks. Record every unreviewed surface; incomplete coverage cannot receive PASS.

### Independence and permissions

Reach and freeze your findings before reading earlier round reports, reconciliations, progress ledgers, or implementer explanations of fixes. Binding specifications and the plan are required inputs. Use benign synthetic files, repositories, workflows, and credentials in temporary directories for bounded probes. No network, real credentials, workflow/script execution, dependency installation, production edits, ref mutation, merge, push, publication, or release actions. Do not modify the sibling agent. Do not delegate further. Only write your assigned report; test-runner disposable outputs must remain outside production files.

### Binding sources

Read applicable `AGENTS.md` instructions and these Studio documents in order:

1. `docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md`
2. `docs/superpowers/specs/2026-07-25-workflow-studio-design.md`
3. `docs/superpowers/specs/2026-09-03-workflow-package-authoring-and-local-publishing-design.md`
4. `docs/analysis/2026-09-22-workflow-package-marketplace-contract-reconciliation.md`
5. `docs/superpowers/plans/2026-09-03-workflow-package-authoring-local-publishing.md`
6. Pinned package and authoring contracts, provenance, and all shared vector families.

Use pinned agent source as read-only evidence for package acceptance and resource semantics. Explicitly distinguish feature defects, pre-existing upstream limitations, and unverified platform assumptions. Never infer that remote installation works from Studio unit tests alone.

### Non-negotiable invariants

- YAML is the only workflow graph authority; targeted edits preserve unrelated syntax and fields, and visual operations preserve DAG validity.
- Package manifests declare membership/metadata, not an alternate execution model. No invented runtime or independent resolver field inventory.
- Hash exact bytes under contract rules; include all eligible supporting files. Reject unsafe paths, collisions, stale identities, and out-of-budget inputs.
- Failed or racing writes cannot silently lose user data or leave apparently valid mixed-version generated artifacts.
- Local Git preparation preserves unrelated index/worktree state and never accesses a remote or treats a local commit as confirmed publication.
- Studio never executes package content, installs dependencies, or grants agent trust. Invalid artifact drafts remain recoverable; standalone YAML gates stay intact.
- UI copy uses loop24 while technical identifiers, filenames, YAML, and diffs remain accurate.
- Offline assets, keyboard access, focus, reduced motion, bounded analysis, and the existing canvas performance contract are release requirements.

### Evidence and required output

For each finding provide: stable ID, Critical/Important/Minor severity, exact candidate file/line, realistic trigger and complete production path, observed wrong result/user impact, minimal reproduction or rigorous invariant argument, commands and actual results, and the missing regression assertion. Separate demonstrated defects from UNVERIFIED concerns. Do not equate a missing test with a demonstrated defect.

The report must contain candidate identity, verdict (`PASS`, `BLOCK`, or `INCOMPLETE`), severity counts, coverage inventory, findings, tests/probes actually run with outcomes, skipped checks with reasons, and residual risks. A clean verdict must identify the boundaries and interleavings checked. Do not modify code to make a probe pass. Stop only after covering the full assigned scope, not after the first finding.
