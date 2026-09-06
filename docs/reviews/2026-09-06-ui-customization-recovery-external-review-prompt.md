# Workflow Studio UI customization recovery: external adversarial review

This is the common prompt for two independent external review lanes, Claude and Codex. The controller provides each lane the same frozen candidate, diff, requirements matrix, and verification receipts and persists each verbatim report outside the candidate diff before reconciliation. The reviewer receiving this prompt performs the review itself and does not delegate or launch another model.

## Candidate identity template

- Repository/worktree: `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery`
- Branch: `fix/ui-customization-recovery`
- Comparison base: `aa91baac4081f0ca585b10fb3fb65b966a7ec24c` (`base`, immutable `v2.0.0`)
- Candidate HEAD: `{{CANDIDATE_HEAD}}`
- Full review package and changed-path diff: `{{REVIEW_PACKAGE}}`
- Verification receipts: `{{VERIFICATION_RECEIPTS}}`
- Acceptance matrix: `{{REQUIREMENTS_MATRIX}}`
- Scratch output: `{{SCRATCH_DIRECTORY}}`

The controller must copy this template into the ignored review package and replace every `{{...}}` token before dispatch. Do not begin while any token remains. Independently verify branch, commit, merge base, clean status, and the complete changed-path inventory. No candidate changes may occur during the two review lanes. Versions must remain `2.0.0`.

## Review rules and required reading

Read source and test evidence independently. Do not read the other lane's report, previous verdicts, controller reconciliation, or unrelated worktree records. Do not modify candidate source, tests, documents, contracts, corpus, dependency environments, or Git state. Do not touch the historical dirty worktree or Hermes repository. No merge, version change, tag, push, publication, release workflow dispatch, app installation, workflow execution, credential access, or external application/network calls.

Read `AGENTS.md`, then its foundation review, authoritative product design, and current recovery implementation plan in order. Read the recovery design completely:

- `docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md`
- `docs/superpowers/specs/2026-07-25-workflow-studio-design.md`
- `docs/superpowers/plans/2026-09-06-workflow-studio-ui-customization-recovery.md`
- `docs/superpowers/specs/2026-09-06-workflow-studio-ui-customization-recovery-design.md`

For preserved behavior, read the loop-group design and scanner amendment:

- `docs/superpowers/specs/2026-08-31-workflow-studio-loop-group-visual-authoring-design.md`
- `docs/superpowers/plans/2026-09-05-workflow-studio-scanner-integration.md`

Use the full diff once, then inspect every changed path, relevant full files, callers, and tests. Report path coverage explicitly, including documentation, resources, tests, and process records. Do not claim to have read truncated output. Parse generated JSON selectively rather than dumping giant lines. Receipts prove executed commands, not every behavior. Do not rerun broad suites recorded for this exact candidate; use bounded synthetic probes only to resolve concrete suspected defects. Keep scratch output in the designated location. Report unexecuted checks and denied or unavailable probes honestly.

## Recovery acceptance matrix

Evaluate every R1–R19 row against source and behavioral evidence. “Current status” below records the original recovery baseline, not the candidate verdict.


| ID | Required behavior | Current status | First focused evidence | Broader acceptance |
| --- | --- | --- | --- | --- |
| R1 | Footer shows the package version in neutral updater states and preserves active updater labels. | Missing | `src/app/StatusBar.test.ts` | `tests/e2e/workbench-containment.spec.ts` |
| R2 | Palette, brightness, and custom accent choices apply immediately and survive reload. | Missing | new `appearance.test.ts`, `appearance` store tests, and component tests | `tests/e2e/branding.spec.ts` |
| R3 | Existing brand-pack import remains reachable under an explained Advanced disclosure. | Partially present: importer exists | `BrandSettings.test.ts` and `App.test.ts` | branding, modal-layout, and containment E2E |
| R4 | The built-in LOOP24 mark follows the accent while imported marks remain validated assets. | Missing | `BrandSettings.test.ts` and `theme-sync.test.ts` | branding E2E |
| R5 | Dirty, saving, and saved state are visible; Save remains explicit and accessible. | Missing | `App.test.ts` | workspace-authoring E2E |
| R6 | Revert restores exact verified disk text, clears recovery/history, and refuses to overwrite an external change. | Missing | `document-workspace-controller.test.ts` | invalid-YAML recovery and workspace-authoring E2E |
| R7 | A user can remove one recent folder or clear only unavailable folders. | Missing | recent-workspaces and OpenWorkspace component tests | App integration test |
| R8 | Docked panels collapse independently and their state survives workflow reopen without changing compact drawers. | Partial: controls exist, persistence does not | layout-store and App tests | workbench-layout E2E |
| R9 | Lower-panel pointer/keyboard resizing and loop Problems/References tabs remain intact. | Present; preserve | existing `PanelResizeHandle` and `AuxiliaryPanel` tests | existing workbench-layout E2E |
| R10 | Problems layers have counted, keyboard-operable tabs and stable initial selection. | Missing | `ProblemsPanel.test.ts` | App and loop auxiliary-panel E2E |
| R11 | Back controls have an icon and visible button treatment across activity, docs, examples, and loop scope. | Partial: loop scope only | component tests for each back control | activity/examples/docs E2E |
| R12 | Node context actions and Command/Control multi-selection work accessibly. | Partial: multi-selection key configuration exists; context actions and focused coverage do not | `GraphCanvas.test.ts` | workspace-authoring E2E |
| R13 | Incomplete projected nodes can be deleted while unsafe mutations remain paused. | Partial: current scoped draft support | analyzer, transactions, canvas actions, coordinator, and App canvas tests | invalid-YAML recovery E2E |
| R14 | An exact root `nodes: []` is visually rebuildable but remains blocked from save until valid. | Missing | analyzer, transactions, canvas actions, and App canvas tests | workspace-authoring E2E |
| R15 | Node-type and execution guides are complete, contract-derived where applicable, and searchable offline. | Missing | docs build-index/navigation tests and resource checks | examples/docs E2E |
| R16 | The YAML caret remains visible in all supported appearance modes. | Missing | editor-extension test | workspace-authoring E2E |
| R17 | Loop-group editing, reference insertion, scoped persistence, and 250-node/500-edge performance do not regress. | Present; preserve | existing loop/scanner/layout/performance suites | full unit, E2E, Rust, resources, and native build gates |
| R18 | Release preflight reports every local worktree and flags unresolved dirty feature work before tagging. | Missing process guard | release-version/release-state tests where automatable | documented v2.0.1 release checklist |
| R19 | User templates are not silently inferred from Examples. | No implementation evidence | repository/history search recorded in this design | user clarification required for any later template feature |


## Adversarial authoring and preservation checks

Trace real user actions through components, stores, command handlers, transactions, CST edits, current analysis, and persistence. YAML remains the sole workflow authority. Export contains only definition and optional companion YAML; appearance and layout remain local application data. Unknown fields, comments, key order, scalar style, aliases, unrelated content, and final-newline style must survive safely localizable edits. Ambiguous mutations reject without changing bytes.

- Appearance: validate normalized six-digit accents, invalid storage/input, persistence failure, System changes, palette/reset behavior, semantic contrast, built-in accent-aware mark, and unchanged imported asset validation. Advanced brand packs must remain reachable and usable. Neutral footer version must yield to active updater states.
- Save/revert: inspect dirty, clean, saving, read-only, unavailable, invalid and oversized states; button and keyboard share one guarded path. Verify paired exact-hash rereads, revision/activation races, serialization with save, cleanup failures, and existing external-change conflict handling. Revert must never discard edits created after its confirmation snapshot.
- Recent folders: preserve serialized mutation order and retained ordering; storage/availability failures cannot erase history or poison the queue.
- Panels/navigation: preserve optional record-level docked visibility defaults, independent scoped layout state, ephemeral compact drawers, lower-panel resizing, outer Problems/References ownership and scrolling. Inner Problems tabs must have counted labels, keyboard behavior, complete tab relationships, and stable explicit selection. Back controls retain their destinations and focus behavior.
- Repair: only known incomplete projected nodes admit delete repair; only an exact root `nodes: []` admits first-node rebuilding. Other stale mutations remain blocked. Delete-all is one undoable blank draft with strict save/export rejection. Verify reference-impact previews, stale confirmations, indentless sequences, aliases, and scope leases.
- Context actions: mouse and keyboard open/close/focus behavior, Arrow/Home/End navigation, viewport containment and resize, Meta/Control multi-selection, mixed edge/node selection, and consistent command labels/enablement. Menu navigation and pointer frames must not parse, validate, run layout, query Git, or perform I/O.
- Offline guidance/caret: examples match the active contract, links/search cover all contract-derived node topics, retry/profile distinctions are accurate, and focus-token caret remains visible across supported modes.
- Preserve current loop-group/scanner behavior: scope identity and leases, root/body references and shadowing, current/previous/outer references, Unicode offsets, paired contract/corpus activation and digest checks, one prepared reference index, and no new interpreter or runtime authority. Hidden scopes do not mount canvases or do layout work.
- Verify meaningful 250-node/500-edge coverage per tested scope in app-capacity, canvas-performance, scoped-canvas-performance, and indexed-reference-validation evidence, plus YAML-only fallback above capacity without making structurally valid documents unsaveable.
- Browser evidence must distinguish effective 200% CSS reflow from actual native zoom and cover Chromium/WebKit, keyboard, reduced motion, forced colors, containment, and the preserved 44px minimum canvas contract. Native candidate evidence must distinguish unsigned local macOS packaging from Apple signing, updater signing, installation, or multi-platform acceptance.
- Release preflight must expose unresolved intended work in linked worktrees before tagging. Old 1.0.8 metadata and obsolete ProblemsResizeHandle must not be resurrected. Do not invent user templates: existing Examples and editable copies remain the evidenced feature; any later template system requires a separate product definition.

## Required report

Return a standalone Markdown report with candidate identity and actual reviewer/model identity available to you. Launcher provenance supplies CLI argv, version, exit code, and model identifiers you cannot observe yourself.

Use stable reviewer-prefixed findings (`CLAUDE-001`, `CODEX-001`, and so on), ordered by severity. Each finding must state the violated R requirement or invariant, file/line, smallest concrete trigger, expected versus actual behavior, user impact, reproduction evidence, and smallest correction direction. Distinguish confirmed defects, unresolved suspicions, duplicate observations, and unavailable evidence. Do not manufacture a quota.

Include an R1–R19 coverage matrix, every-changed-path inspection accounting, explicit specification approval and code-quality approval, executed checks with outcomes, and material limitations. State whether the frozen candidate is ready for the user's separate integration decision. Do not approve integration or publication on the user's behalf.
