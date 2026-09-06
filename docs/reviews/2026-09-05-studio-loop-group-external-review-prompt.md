# Workflow Studio loop-group compatibility: external adversarial review

This is the common prompt for two independent external review processes, Claude and Codex. The controller launches each through a separate subagent and persists the external model's verbatim report. The reviewer receiving this prompt performs the review itself and does not delegate or launch another model.

## Candidate identity template

- Repository/worktree: `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/loop-group-visual-authoring`
- Branch: `feat/loop-group-visual-authoring`
- Comparison base: `{{COMPARISON_BASE}}`
- Candidate HEAD: `{{CANDIDATE_HEAD}}`
- Full review package: `{{REVIEW_PACKAGE}}`
- Verification receipts: `{{VERIFICATION_RECEIPTS}}`
- Acceptance matrix: `{{REQUIREMENTS_MATRIX}}`
- Read-only upstream authority: `/Users/coreyellis/Developer/personal/github.com/cmetech/hermes-agent`, integrated commit `a960d5e7c8158f2ab2c315ab0d406eb81c96e3f6`.

The controller must copy this template into the ignored review package and replace every `{{...}}` token before dispatch. Do not begin a review while any token remains. Independently verify the branch, commit and changed-path inventory. No production/test changes should occur during the two review lanes.

## Review rules

Read source and test evidence independently. Do not read another review lane's report, previous candidate verdicts, controller reconciliation, or unrelated worktree records. Do not modify candidate source, tests, documents, contracts, corpus, dependency environments or Git state. No merge, push, publication, application installation, runtime workflow execution, credential access or external application/network calls. Read-only upstream inspection is allowed solely for native language comparison.

Use the provided diff once, then inspect relevant full files and callers. Do not dump giant one-line generated JSON into output; parse the required sections and verify exact hashes. Do not claim to have read truncated ranges. Read `AGENTS.md` and its required foundation review, authoritative design, and current implementation plan in order. Then read the loop-group specification and scanner amendment plan completely:

- `docs/superpowers/specs/2026-08-31-workflow-studio-loop-group-visual-authoring-design.md`
- `docs/superpowers/plans/2026-09-05-workflow-studio-scanner-integration.md`
- Original remaining Tasks 7–14 in `docs/superpowers/plans/2026-08-31-workflow-studio-loop-group-visual-authoring.md`.

The scanner amendment supersedes historical VM and upstream integration instructions. No new interpreter, bytecode, executable transition program, workflow runtime or cross-language memory model is allowed or requested. If a proposed correction requires one, report that conflict rather than expanding the architecture.

Test receipts are evidence of executed commands, not proof of every behavior. Do not rerun broad suites already recorded for the exact candidate. Use bounded synthetic probes only to resolve a concrete suspected defect. Keep scratch output in the controller-designated location. Report denials, unsupported tools and unexecuted checks honestly; never evade a denied probe.

## Language and compatibility checks

Hermes remains the sole workflow-language authority; Studio uses a direct TypeScript scanner and declarative metadata. Inspect contract activation, paired corpus loading, scanner/index modules, validation callers and their tests. Compare doubtful behavior against unchanged Python `bash_rendering.py`, `conditions.py`, `resources.py` and `schema.py`, observing caller phases and lazy versus eager API boundaries.

Assess each traceability row with concrete evidence:

| ID | Requirement |
| --- | --- |
| S1 | Reader 3 activates only when every required scanner/grammar/applicability subtree is understood; digest-valid unsupported metadata fails safely. |
| S2 | Ordinary and LOOP_PREV grammar, malformed suffixes and candidate masking match Hermes, including `.outputx`, `.output_`, slash/bracket paths, leading-zero indexes and non-ASCII continuations. |
| S3 | Bash quoting, escaping, comments, substitutions, arithmetic, arrays, heredocs, here-strings, functions, coprocesses, nesting and ambiguous states use faithful classification, not regex-only discovery. |
| S4 | Structured path analysis preserves containing constraints, `$ref` siblings, unions, numeric object/array interpretations and authored integer precision. |
| S5 | Inventory-derived 18 root fields, 18 body fields and both group controls drive real validation and mutation discovery; authored resource-name policies remain literal. |
| S6 | Root Phase-4 `systemPrompt`, agents and hook leaves receive ordered validation. |
| S7 | Current/outer missing dependencies, previous producer failures, malformed conditions and group controls use correct diagnostics and native phase/error precedence. |
| S8 | One prepared contract/document index serves validation; repeated groups/surfaces do not multiply document scans. Later actions reuse resolved scope identities. |
| S9 | Each scope retains 250-node/500-edge visual capacity and performance budgets; hidden scopes and pointer frames perform no parsing, validation, layout, native/file or Git work. |
| S10 | Unicode code-point spans remain scalar offsets until the editor/CST boundary; astral text, repeated occurrences and namespace identity remain unambiguous. |

Check conformance accounting, literal expected outcomes, seed/count/differential evidence and unsupported profile behavior. Runtime-only observations must be explicitly characterized or independently mapped to authoring behavior; the app must not execute workflows or authenticate resources to satisfy fixtures. Expected outcomes cannot drive the observation implementation.

Archon contract digest is `sha256:f435a385f26c971d37f3c691ed6f42d2aa76e7b0c24b199455f4002b0ab1976f`; corpus digest is `sha256:ebbd30326de23984e254929774b4dd7d7f8a71f59c050da7a3ac9bfe190256a7`. Legacy corpus remains format 1, 11 cases, 7,265 canonical bytes, SHA-256 `c193258148699fbcbc42c909dee10001632377272e57a0ff3b79f3493f158a3b`. Verify paired, offline availability and drift checks without modifying upstream files.

## Authoring acceptance checks

Trace actual user actions through components, state, transactions, CST edits, analysis and persistence. YAML is the sole workflow authority. Export contains definition and optional companion only; layout stays in app data. Unknown YAML, comments, key order, scalar style, aliases and unrelated nodes must survive targeted edits whenever safely localizable; ambiguous graph aliases must reject without changing bytes.

- Scope identity resolves against the current CST. Stale, removed, duplicated, malformed or reordered groups cannot redirect an edit.
- New groups contain exactly `loop_group: {nodes: []}` without invented command, condition or iteration count. Only the explicitly known incomplete draft remains visually repairable; saving/exporting stay blocked until valid. Adding required controls or first child and deleting the last child work transactionally without admitting arbitrary invalid changes.
- Body/root rename, delete, duplicate, copy/paste and dependency edits preserve current, previous, outer and companion references, including repeated local IDs and body shadowing. Group rename migrates unambiguous layout identity. Pair changes produce one analysis and one undo record. Cancel and stale confirmations preserve exact bytes and selection.
- Cross-scope paste does not silently drop dependencies or redirect references to a coincidentally named destination node. External source-scope dependencies/references require explicit resolution before commit.
- V1 layout records migrate to V2 scope records. Root/body positions, viewport, selection, focus and Inspector context remain independent. Scope changes do not run layout or persist workflow YAML. Removed active scopes return to root; unambiguous renames retain local metadata.
- One active canvas renders compound group summaries, Open Body/keyboard navigation, body breadcrumbs, empty repair actions, first-terminal primary output and per-scope capacity fallback. Hidden bodies do not mount canvas/layout work.
- Generated Inspector/palette fields respect scope capability and full YAML paths. Group settings target the owner while retaining body selection. Scope reference Copy/Insert checks a current compatible field target and never invents dependencies. Problems opens the correct scope/node/field or YAML without ID ambiguity.
- Offline examples and documentation exercise current, outer, previous, primary-sink and companion behavior through the ordinary loader. Supported generated fields have widget/documentation coverage or an explicit generated nonvisual status.
- Chromium and WebKit evidence covers complete create/edit/save/undo/reopen journeys, keyboard/focus, modal Escape priority, reduced motion, forced colors, minimum viewport and effective 200% geometry. Distinguish CSS viewport evidence from native zoom. macOS build/launch evidence and Windows limitations are reported accurately.

## Required report

Return a standalone Markdown report with candidate identity and actual reviewer/model identity available to you. Launcher provenance supplies CLI argv, version, exit code and actual model identifiers that you cannot observe yourself.

List findings by severity using stable reviewer-prefixed identifiers. For each provide the violated requirement, file/line, minimal concrete trigger, expected versus actual behavior, user impact, reproduction evidence and smallest correction direction. Distinguish confirmed defects from unresolved suspicions or unavailable evidence. Do not manufacture findings to fill a quota.

Include an S1–S10 and Tasks7–14 coverage matrix, explicit specification approval and code-quality approval, executed checks with outcomes, and material limitations. State whether the candidate is ready for the user's separate integration decision. Do not approve merge/push/publication on the user's behalf.
