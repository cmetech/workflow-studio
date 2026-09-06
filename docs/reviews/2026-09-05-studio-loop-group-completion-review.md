# Workflow Studio loop-group completion review

Implementation through Task 13 is complete on `feat/loop-group-visual-authoring`, in the existing worktree. Starting Studio commit: `213cbbe4987bf6fdc6f39d1f8b8ce2e0b3e9d78c`. Hermes is read-only at integrated `base` commit `a960d5e7c8158f2ab2c315ab0d406eb81c96e3f6`. Task 14 verification and independent external review remain before the user's separate integration decision.

The [scanner integration plan](../superpowers/plans/2026-09-05-workflow-studio-scanner-integration.md) extends the approved loop-group authoring plan. Its single independent pre-implementation review found no Important or Critical defects. This record distinguishes task verification from final branch acceptance; no merge, push or publication has occurred.

## Baseline

- Unit suite: 138 files, 1,334 tests passed.
- Resource verification: 34 files passed.
- Rust: 245 passed and one failure. The failure was a stale assertion expecting 32 manifest entries after the bundle had correctly grown to 34. Actual resource-tree integrity verification passed before that assertion.
- Read-only authoring audit identified the remaining Tasks 7–14 integration points, including flat canvas actions/layout state, paired reference mutations, generated body Inspector paths and stale example validation entry points.

## Task 6A: scanner publication and implementation

Implementation commit: `8765d9c8b78f641a9baa2a146a0dcad3f7c3d9c1`. Review correction: `701b6ac9450ef33a8553849a5711b60f0d4587a4`.

The application uses direct TypeScript grammar, condition, Bash-classifier, scalar-discovery and static structured-path modules. It introduces no workflow executor or virtual machine. Reader 3 capability activation independently pins understood metadata and semantic definitions. The corpus reader verifies format-2 content integrity and contract binding; legacy bytes remain unchanged.

The controller generated each Hermes contract/corpus twice and compared all four bundled files byte-for-byte with those emissions. Archon embedded contract digest is `sha256:f435a385f26c971d37f3c691ed6f42d2aa76e7b0c24b199455f4002b0ab1976f`; embedded corpus digest is `sha256:ebbd30326de23984e254929774b4dd7d7f8a71f59c050da7a3ac9bfe190256a7`. Legacy corpus remains format 1, 11 cases, 7,265 canonical bytes and SHA-256 `c193258148699fbcbc42c909dee10001632377272e57a0ff3b79f3493f158a3b`.

### Conformance scope

The explicit supported scanner profile is Python 3.11 / Unicode 14.0.0. The reviewer independently compared every generated alphabetic, digit and whitespace range with the pinned Python interpreter. Other profiles fail safely rather than using the JavaScript engine's Unicode version implicitly.

Of the 190 published observations, 141 directly compare pure authoring outcomes: 120 scanner observations and 21 static-path observations. Another 47 runtime observations have independently authored scanner mappings: 23 rendering/substitution inputs, 16 authenticated resource/package observations and eight runtime output-resolution inputs. Two Unicode-15 variants explicitly exercise unsupported-profile rejection. Runtime rendering, authentication, filesystem decoding and output materialization are not claimed as Studio parity or executed by the app.

The development-only differential runner compared 7,000 observations with pinned Python using seed `1780491785`. Review corrections extended this to 7,090 observations with zero mismatches. Literal expectations are used by assertions only; scanner execution receives inputs and API selectors.

### Review findings and resolution

| Finding | Independent controller reproduction | Correction | Scoped re-review |
| --- | --- | --- | --- |
| Important: `Number` rounded path index `9007199254740995` upward, falsely proving impossibility against `maxItems: 9007199254740996` | Confirmed: Studio true, Hermes false | Keep path indexes as bigint until safe bounded array access; add literal regression and 60 differential variants | Addressed |
| Important: dotted-key detection followed a local `$ref` through an array, unlike the native mapping-only helper, selecting the wrong diagnostic | Confirmed: both prove path impossible, but only Studio reported a dotted key | Separate mapping-only dotted-key resolution from array-capable impossibility resolution; add regression and 30 differential variants | Addressed |

Both controller counterexamples match Hermes after correction. Scoped re-review approved specification compliance and code quality, with no new Important or Critical fix regression.

### Task verification and handoff

- Focused scanner/contract/action/transaction suite: 14 files, 334 tests passed.
- Correction: 31 affected tests passed; reviewer independently ran 24 path tests successfully.
- TypeScript/Svelte checks: zero errors and warnings. Scoped lint, formatting and diff checks passed.
- Contracts and all 34 packaged resources verified.
- Rust: 246 unit and 24 integration tests passed after removing only the redundant fixed-count assertion; actual resource-tree verification remains.
- Full unit suite before the path correction: 1,559 passed, one workflow-corpus test failed. Its five new fixture mismatches belong to Task 6B: Phase-4 traversal/diagnostics and quoted root/body condition references. This is not a green full-suite claim.

Task 6B also owns a confirmed source-boundary issue: YAML currently rounds authored integer `9007199254740993` before static schema validation. The corrected path helper cannot recover digits already lost by its caller. Integration must preserve them or explicitly report unsupported authoring precision, while retaining the exact YAML text.

## Task 6B: indexed validation candidate

Implementation commit: `7ea8b8990bfdb0164a6688eb27316eb53d8ccf26`. Independent specification and quality review found three Important defects. The controller reproduced all four minimal witnesses against Studio and pinned Hermes; correction is underway.

One prepared contract and one reference index now supply root, body and group-control validation. The serializable index is returned on `DocumentAnalysis` for mutation discovery. All 38 inventory policies are prepared, with all 34 authored scanner surfaces exercised and four resource-name policies kept literal. The 71 workflow corpus cases match exact ordered diagnostic codes and paths. Root Phase-4 traversal, condition ownership, eager syntax precedence, previous/current producer distinctions and repeated same-field occurrences have regressions.

The source integer boundary emits blocking `unsupported_authoring_integer_precision` for `9007199254740993` while retaining exactly representable `9007199254740992` and the original YAML. No numeric runtime or global BigInt decoding was added.

- Focused verification: 17 files, 376 tests passed; TypeScript/Svelte checks reported zero errors and warnings; scoped lint, formatting, contract, resource and whitespace checks passed.
- Performance: one analysis/index for a 250-node/500-edge root and three equally sized bodies (1,000 nodes and 2,000 edges total) took 165.02 ms against the unchanged 2,000 ms module budget.
- Full unit suite before final handoff-only index/identity additions: 1,573 passed, four resource tests failed. Faithful scanning exposed trailing punctuation in several example references and structured paths without producer schemas in examples and the conditions guide. Task 12 will correct the actual authored resources and close these failures; this is not a green full-suite claim.

### Review correction requirements

| Finding | Confirmed behavior | Required correction |
| --- | --- | --- |
| Important: condition normalization phase and caller code | A later malformed `when` should produce only native `malformed_condition`; Studio also emitted an earlier reference failure and the scanner's internal condition code | Run condition syntax validation before static references and preserve reference-syntax cause translation |
| Important: root/scoped phase boundary | Root reference failure should prevent the scoped-reference phase; Studio added a body diagnostic | Retain within-phase error collection and stop before scoped references on root failure |
| Important: alternate integer representations | Hexadecimal or aliased `maxItems` bypassed precision checks and falsely proved a valid numeric path impossible | Resolve authored scalar aliases and supported integer spellings, preserving meaning or emitting the explicit precision diagnostic |

The reviewer also identified that the all-surface discovery test did not use full document analysis. That concrete S5 evidence gap is included in the correction. A minor lookup-efficiency observation remains tracked for Task 13/final review: validation filters the full occurrence index per group and searches node arrays, though document indexing occurs once and the measured budget passes. Reports must not describe those lookups as shared maps.

Correction commit `5248526ad13679ad4bc37cd4c390a3eb36b2083d` addressed the root/scoped phase boundary, hexadecimal and aliased precision, and real-analysis coverage for every surface. Its scoped review confirmed those items, then found the condition phase still translated body errors incorrectly and ran after root topology. The controller reproduced both differences.

Second correction commit `235905f21d6ffae2c6893cc2f392a5fcca1044fd` now validates conditions through the existing index before root topology. Root conditions retain native generic/reference-cause diagnostics; body condition failures are wrapped as `loop_group_shape_invalid`. Focused verification passed 80 tests, the broader affected set passed 384 tests, and static checks passed. Scoped re-review found every original finding addressed, one additional mixed-order Studio/Hermes probe matched, and approved both specification compliance and code quality with no new Important or Critical issue.

## Task 7: scoped CST mutation candidate

Implementation commit: `71c1d724f06ade7ebfe32d611aa52dbeac2d0fd8`. Independent specification and quality review is pending.

Node mutations now carry stable scope identity and resolve the current CST immediately before editing. Reader-3 rename uses the existing indexed producer identity for current, previous, outer and group-control references, converting code-point spans only at the retained scalar source boundary. Pair mutations prepare definition and companion changes together, then run one analysis and create one undo record. Missing, duplicate, malformed, conflicting-kind or alias-derived scopes reject without changing bytes.

The explicit empty group and required-control/first-child/final-child repair sequence remain blocking until valid. Draft admission uses strict contract validation against a throwaway candidate made only from published schema examples; it is never persisted or used as workflow authority. Property and exact-byte tests found and corrected block-sequence newline loss, flow-style sibling normalization, dependency quote/comment loss, outer-option draft rejection and unresolved-alias failures.

- Broader verification: 9 files, 197 tests passed, including 126 focused mutation/analysis tests.
- TypeScript/Svelte checks reported zero errors and warnings; whole-repository formatting, scoped lint and whitespace checks passed.
- No layout, runtime, native, contract/corpus, example or Hermes files changed.

### Task 7 review findings

| Finding | Independent controller reproduction | Required correction |
| --- | --- | --- |
| Important: flow deletion consumes a surviving item's comment | Confirmed: deleting the second body child succeeded but removed the comment following the first child | Locate collection delimiters from CST ranges/tokens and retain intervening comment trivia; cover sequence and mapping comments containing commas |
| Important: body scope misses an anchor on the root nodes sequence | Confirmed: `nodes: &all [...]` resolved successfully and child insertion also appeared through `metadata: *all` | Reject anchors/shared graph ancestors starting at the root sequence, with unchanged source |

The reviewer approved pair/index identity, one-analysis/undo behavior and draft rejection of new missing references and cycles. One focused correction round is underway.

Correction commit `2ea875a31319367c46ebbefcb87e10913d05d0a3` uses actual CST comma-token offsets and separate trivia-preserving source edits for flow mappings and sequences. It checks anchors on every graph ancestor from the root node sequence downward. Focused verification passed 140 tests; the affected set passed 211 tests with static checks clean. Scoped re-review found both Important findings addressed, no new Important or Critical issue, and approved Task 7 specification compliance and code quality.

## Task 8: scoped action and clipboard candidate

Implementation commit: `ae33ff4a01e9df4f30c8a4958cd6d3b108a54791`. Independent specification and quality review is pending.

Canvas actions now bind an explicit active scope and exact current analysis/index. Delete confirmation consumes a saved, scope-qualified impact preview and rechecks workflow, generation, document paths/revisions, contract, active scope and saved hashes around asynchronous analysis. Rename, delete and prepared paste commit both documents through one final analysis and one undo entry. Definition, companion, current, previous, outer and group-control impacts carry complete producer/consumer identities; repeated local IDs do not collide.

Clipboard snapshots authenticate their source workflow/scope/revision and indexed dependency/reference evidence. Same-scope copies remap only selected producers. Cross-scope external dependencies or references require resolution even when a destination ID has the same spelling. A narrow copied-CST insertion path preserves comments, quotes, block scalars/chomping, CRLF and safe flow formatting, rejects anchors/aliases or evidence mismatch, and verifies the inserted raw value before final analysis.

- Affected verification: 17 files, 493 tests passed; an additional CST/clipboard run passed 67 tests.
- TypeScript/Svelte checks reported zero errors and warnings; scoped lint, formatting and whitespace checks passed.

### Task 11 review findings

| Finding | Confirmed effect | Required correction |
| --- | --- | --- |
| Important: reference insertion loses applicability | Group controls are excluded, previous tokens are not checked per field, and named scripts can be treated as inline | Carry actual surface, namespace and current-value discriminator through the lease and exact eligibility query |
| Important: root Problem does not leave body | A root node ID is applied while the body graph remains active | Navigate whenever target scope differs, including explicit return to root |
| Important: Inspector focus can become stale after awaits | Later tab/focus ticks mutate UI without another revision check | Recheck request and revision after each awaited render and immediately before mutations |
| Important: dropped group does not auto-open | Drag/drop commits the draft but duplicates result handling without scheduling body entry | Share one add-result handler across click, picker and drop paths |

Controller inspection of the frozen candidate confirmed every control-flow path. One focused correction round is underway.

Correction commit `4c453be68c0ea4525d364fb74aa5541723d36c03` carries exact reference surface/value/namespace applicability, disables incompatible Insert, returns to root for root Problems, adds live revision guards around App's awaited focus work, and shares add-result handling across picker, palette, drop and chords. The original reference, root-route and group-add findings closed in scoped re-review. Two Important issues remain: Inspector's final queued DOM focus lacks the live guard, and group-control guidance uses the preserved child selection instead of the active owner target. A second bounded correction is underway.

Second correction commit `95a5bd3afcd7caab16de33039c1321766b7bd74b` passes the live request/revision guard into Inspector's queued focus callback and derives current-output guidance from the active field and Inspector target. Body fields use direct dependencies, group `until_bash` uses body producers in definition order, and `gate_message` exposes no current-body producer. The required suite passed 88 tests, the affected/accessibility suite passed 140, and static gates were clean. Final scoped re-review found both remaining findings addressed, no new Important or Critical issue, and approved Task 11 specification compliance and code quality.

## Task 12: offline resources and drift gates candidate

Implementation commit: `caba93eaf54a5107409cc6012d2e33cb67f034a4`. Independent specification and quality review is pending.

The existing examples and conditions guide now match the Hermes scanner and published output schemas. Three offline loop-group pairs cover current body output, outer plus previous-iteration context, and definition-order primary sink with scoped companion policy. Their intents resolve graphs by stable scope and node namespace.

Contract and corpus selection now comes from one browser/Node-neutral manifest loader with safe basenames, unique pairing and exact identity/digest checks. Example validation traverses every projected graph. Documentation and drift tests derive supported fields and corpus feature tags from bundled authority. The native package allowlist explicitly includes the six new YAML files; a deterministic writer hashes only that fixed list and produces the verified 40-file integrity manifest.

- Focused resource/loader/docs/drift verification: 110 tests passed.
- Contract, example, resource, type, lint, formatting and whitespace checks passed.
- Full unit: 1,792 of 1,798 passed. All four prior Task 12 resource failures are closed. Five persistent App/capacity failures and one isolated timing flake are recorded for Task 13/final verification; Task 12 changed none of their files or authorities.
- Contract, corpus and contract-manifest Git object identities are unchanged.

Independent review found no Critical, Important or Minor issue and approved Task 12 specification compliance and code quality. A possible corpus activation gap was investigated and rejected: the shared loader validates pair identities and hashes, every corpus consumer then runs the full conformance reader, and contract activation separately validates the scanner metadata. Independent focused tests and contract/example/resource/diff checks passed.

### Task 10 review findings

| Finding | Confirmed effect | Required correction |
| --- | --- | --- |
| Important: Arrange loses compound metadata | Reprojection omits group summaries, so the group becomes ordinary until refresh | Preserve the normal summary/status/accessibility options through Arrange |
| Important: Escape consumes two layers | Edge-mode cancellation also clears selection in one keypress | Consume only edge mode, then selection, then body Back on successive presses |
| Important: real empty draft omits required status | Native `loop_group_shape_invalid` prose does not match the summary heuristic | Compare authored payload with contract-derived required group fields |
| Important: removed active group fallback is silent | Store returns to root and emits an event, but App does not explain or focus a valid target | Consume the one-shot event, surface its message and restore root focus without work/persistence |

The reviewer also asked that the compound accessible label include the visible maximum-iteration value and that unused edit-group callback plumbing be removed or justified. One focused correction round is underway.

Correction commit `58144e021a728ef419de468769029652a0e0ab07` preserves compound projection options during Arrange, consumes one Escape layer per keypress, derives required-state counts from prepared scoped-DAG metadata and the exact authored payload, and handles Task 9's removed-scope event with explanation and valid root focus. It also removes the dead edit callback and adds maximum iterations to the accessible summary. The exact four review witnesses passed, the combined changed-module suite passed 149 tests, and static gates were clean. Scoped re-review found every finding addressed, no new Important or Critical issue, and approved Task 10 specification compliance and code quality.

## Task 11: generated controls, scoped guidance and Problems candidate

Implementation commit: `61144ab1ddf1637e5f785d84366251e680e15c4c`. Independent specification and quality review is pending.

The root and body add surfaces share one contract/scope query; body choices are the exact published allowed kinds, and root loop-group creation emits the approved `nodes: []` draft before opening its body. Form descriptors rebase through each graph's source path. Owner group settings use generated contract descriptors for the seven controls while structural container fields remain on the canvas/YAML path.

Reference eligibility uses the prepared reference-index authority. The scope bar derives current, direct outer and previous-iteration tokens, suppresses shadowed outer IDs, copies exact text and inserts only into a remembered field whose document, revision, contract, scope, binding, path, text and selection still match. Missing root dependencies require a separate explicit acyclic one-transaction action and never insert automatically.

App is the sole Problems focus coordinator. It resolves scope before local IDs, distinguishes repeated children, focuses the most specific generated field or exact YAML fallback, preserves child selection for owner group controls, and rechecks revisions after awaited renders. Problem documentation is a separate action, while the main row always focuses the issue.

- Required Task 11 behavior suite: 84 tests passed.
- Affected action/reference/coordinator/editor/forms and accessibility suite: 135 tests passed.
- TypeScript/Svelte checks reported zero errors and warnings; scoped lint, formatting and whitespace checks passed.

Correction commit `3e47e87944475eb42b85fd81235b4964f6b977ca` adds copy-source provenance, suppresses navigation debounce scheduling, and restores mounted viewport/scroll through a qualified one-shot signal. Scoped re-review closed all three original findings. It found one related Important regression: the navigation-origin filter also suppresses an explicit save or close snapshot, so a navigation-only latest scope may remain absent from persisted state. A second bounded correction must keep navigation free of background saves while allowing explicit flush/close to persist the current layout.

Second correction commit `9197f641fde0e4790d5aee5094cd925da5cd6b10` separates explicit snapshot enqueueing from navigation debounce filtering. Navigation still produces no background save; explicit flush, close and disposal persist the latest body-active record exactly once. Its focused suite passed 96 tests. Final scoped re-review found the remaining finding addressed, no new Important or Critical issue, and approved Task 9 specification compliance and code quality.

## Task 10: compound nodes and canvas drill-in candidate

Implementation commit: `f86435dbc8e261cb8de29672f16a1e1c47224c39`. Independent specification and quality review is pending.

The root canvas renders loop groups as compound nodes with bounded summaries, scoped issue status and explicit activation through the Open action, focused Enter and guarded double-click. App resolves the active graph by scope key and mounts one Svelte Flow. Body entry and Back use Task 9 state restoration and focus the scope heading or owning root node. Empty bodies expose repair actions without inventing values, and oversized bodies fall back to YAML within that scope while root availability remains independent.

The Inspector now has an explicit owner-group target and controlled tab/scroll state, so group settings can open without replacing body selection. Canvas cancellation reports ownership to preserve the established Escape order before body Back. Root and body edits use the same document history, and navigation remains free of YAML, analysis, layout, Git/native and background persistence work.

- Focused Task 10 suite: 68 tests passed.
- Required regression suite: 119 tests passed; combined changed-module verification passed 147 tests.
- TypeScript/Svelte checks reported zero errors and warnings; scoped lint, formatting and whitespace checks passed.

### Task 9 review findings

| Finding | Confirmed behavior | Required correction |
| --- | --- | --- |
| Important: cross-workflow group copy lacks layout provenance | A copied `first-2` scope received destination `first` state and omitted the copied body's actual node position | Distinguish source workflow; copy layout only for same-workflow duplication, otherwise keep deterministic new-scope placement |
| Important: navigation schedules persistence | Entering a body after baseline flush caused one additional native layout save after the 500 ms debounce | Publish navigation in memory without scheduling persistence |
| Important: same-scope history does not update mounted viewport | Stored viewport restored, while mounted Svelte Flow retained its pre-undo coordinates | Add a bounded restoration signal consumed by the mounted canvas for matching history restoration |

The complete v1 migration, opaque entry retention, immutable scope updates and accepted-analysis pruning boundary were approved. One correction round is underway.
- Task 9 receives explicit node/scope rename, copy and removal mappings; persisted Layout V2 remains outside Task 8.

### Task 8 review findings

| Finding | Validation | Required correction |
| --- | --- | --- |
| Important: exported paste trusts caller-provided derived clipboard evidence | Controller temporary test confirmed an honest cross-scope clipboard blocks, while removing its reference/dependency evidence commits unchanged source text | Recompute or authenticate selection, dependency, reference, group and source-path evidence from the captured source snapshot |
| Important: flow-node copy loses attached comments | Reviewer probe and CST range inspection confirmed the copied range excludes leading/trailing comments | Preserve comment tokens and association for flow-to-block and flow-to-flow, or reject unsafe transplantation |
| Minor: copied `|+` CRLF blank lines become LF | Reviewer probe and deindent source inspection confirmed line-ending loss on blank lines | Preserve line terminators during indentation adjustment |

The controller treats the CRLF issue as an in-task requirement gap because the approved byte-preservation requirements and Task 8 report explicitly claim CRLF preservation. It is included in the same bounded correction. Scope leases, one-pass prepared analysis, descendant impacts, atomic undo and cancellation were approved.

Correction commit `a4affc2f1bf1ae622d95ff95040f2418aa14a0b2` admits only the exact deeply frozen, module-registered clipboard handle; structural clones, spreads and changed evidence reject. It preserves CRLF blank lines during indentation changes and conservatively rejects flow boundaries where comments cannot be reassociated safely. Its re-review closed provenance and CRLF, then found one remaining inline-flow-map comment variant.

Second correction `1301e5ab4fc472ae48f819fd99eaf030029aa0af` covers flow mappings nested in block sequences while distinguishing parent-key and preceding-item comments. It passed 93 focused tests and static checks. Scoped re-review found the remaining finding addressed, no new Important or Critical issue, and approved Task 8 specification compliance and code quality.

## Task 9: per-scope layout candidate

Implementation commit: `3671bcc1d4eb55115d788b2bace111c1d07fa306`. Independent specification and quality review is pending.

Layout schema v2 is the only live/persisted authority and owns independent root/body positions, viewport, selection, focus, Inspector and scroll state. Complete v1 envelopes migrate into root scope in memory and write v2 only on a later real save or path migration. The modern projection reconciles every graph only after accepted current analysis; stale/invalid results never prune state. Scope switches use projected state and perform no parsing, validation, placement, YAML transaction, file/native/Git call or persistence save.

Task 8 identity mappings migrate or prune scoped metadata, with explicit action mappings taking precedence over provisional reconciliation. Layout history snapshots attach to the existing YAML transaction and restore only after the matching accepted analysis. Canvas, analysis reconciliation and close share one persistence controller.

- Focused layout/canvas/controller/App suites passed, including 409-test and 95-test broad checkpoints; final focused sets passed 70 and 26 tests.
- Full unit: 1,715 passed; exactly four known Task 12 resource failures remain.
- TypeScript/Svelte checks reported zero errors and warnings; scoped lint, formatting and whitespace checks passed.

## Task 13: cross-engine authoring and scoped performance

Implementation commit: `84e2505ec0b317af10c4f7299125c222d5ebc3fe`.

The browser harness now binds a validated, task-specific port with strict ownership. Shared deterministic fixtures cover the exact bundled loop-group example, scoped Problems, a valid oversized body beside visual root/sibling scopes, and one 250-node/500-edge root plus three 250-node/500-edge bodies. The eight journeys exercise the ordinary Examples path, all body-entry methods, body editing and references, exact save/reopen, independent root/body/workbench state, scoped diagnostics, empty-draft repair, per-scope capacity, keyboard and Escape order, forced colors, reduced motion, compact geometry, real pointer targets and release-bound authority work.

Performance fixes stay within existing product boundaries. Compound projection no longer traverses a large raw body merely to draw its owner. The root group Inspector materializes only contract-derived owner controls. The active reference bar renders a bounded searchable window while preserving keyboard access to all tokens. Dependency patching serializes only its local YAML sequence before the existing final document verification. Root and body Problems scroll positions persist independently, and deferred focus restoration no longer steals focus after the user moves it.

Task 13's independent review first identified incomplete evidence in six journeys and three scoped-performance rows. The corrected tests use the real Examples page and bundled bytes; establish exact distinct state and companion retention; create a real empty group and prove save/export blocking; route both focused and documented Problems; preserve bytes across the 251-node fallback; cover every requested accessibility state; and observe body pan/zoom, selection batching, hidden-scope identity, Problems scroll, navigation metrics and unchanged saves. Final scoped re-review approved the acceptance coverage and the bounded production corrections with no remaining Important or Critical finding.

- Exact Task 13 regression list: 15 files and 210 tests passed.
- All additionally touched focused suites: 13 files and 335 tests passed.
- Scoped performance: seven invocations covering all eight audit requirements passed; measured durations were 57, 152, 384, 183, 156, 146 and 13 ms.
- Chromium journey 8 passed three repeated executions and WebKit passed once. The complete browser matrix passed all 16 executions of the eight journeys in 39.5 seconds.
- Cold full unit suite: 159 files and 1,818 tests passed in 93.67 seconds.
- Formatting, lint, TypeScript/Svelte checks, contracts, examples, 40 packaged resources, whitespace and focused-test hygiene passed.

Browser limits remain explicit. WebKit executes the functional and editor-metric assertions but does not expose Chromium's `longtask` observer entry. A 512x350 viewport proves CSS reflow, not native zoom. Packaged WKWebView behavior, local app/DMG construction, signing/quarantine facts, native smoke and Windows evidence belong to Task 14.

## Task 14: final verification and external review

The final gate order is frozen in the scanner-integration audit: read-only Hermes regeneration and byte comparison; Studio static/resources; focused performance and both browser projects; cold full TypeScript; Rust; production renderer; full browser matrix; isolated macOS app/DMG build and honest smoke; candidate hygiene; then separate Claude and Codex review lanes. Evidence is retained outside Git under the ignored Task 14 package and names the exact candidate commit.

No Task 14 result is claimed in this tracked preparation record. Any source, test or resource correction found by a gate or reviewer changes the candidate and requires refreshed affected/full evidence. Merge, push, publication, release dispatch, installation into `/Applications`, Hermes changes and claims about unperformed Windows behavior remain outside this work.
