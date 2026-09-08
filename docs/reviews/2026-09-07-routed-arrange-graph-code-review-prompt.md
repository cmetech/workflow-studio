# Routed Arrange Graph: independent adversarial code review

Use this common prompt for two independent external reviewers: one actual Claude reviewer and one actual Codex reviewer, each in a separate subagent. Each reviewer performs its own review without delegating. The coordinator preserves both verbatim reports outside the candidate diff before consolidating findings. Do not substitute a Codex model for Claude and label it a Claude review; record an unavailable reviewer or launcher honestly.

## Freeze the candidate before dispatch

- Worktree: `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/routed-arrange-graph`
- Branch: `feat/routed-arrange-graph`
- Immutable comparison base: `566b9d991399bcf874b02110d68ab1435c26a872`
- Candidate HEAD: `{{CANDIDATE_HEAD}}`
- Full diff package: `{{REVIEW_PACKAGE}}`
- Exact additional working-tree patch and SHA-256, or `none`: `{{WORKING_TREE_PATCH}}`
- Complete current-file snapshot, status, untracked-file inventory, and per-file SHA-256 manifest: `{{CANDIDATE_SNAPSHOT}}`
- Verification receipts and task evidence: `{{VERIFICATION_RECEIPTS}}`
- Reviewer identity and isolated scratch/report path: `{{REVIEWER_AND_OUTPUT}}`

The coordinator replaces every placeholder in an ignored dispatch copy. Both reviewers receive the identical frozen HEAD and working-tree state. A tracked `git diff` alone is insufficient: include the exact contents of every nonignored untracked deliverable, a machine-readable tracked/untracked/deleted inventory, Git status, and per-file hashes. Restore the complete snapshot into a temporary directory and verify every file against the manifest before dispatch. Keep the package ignored and outside the candidate source snapshot. Include the review prompt itself and any uncommitted consolidated review deliverable; no index mutation is needed to capture them.

Review `git diff 566b9d991399bcf874b02110d68ab1435c26a872...{{CANDIDATE_HEAD}}`, every changed file, and the explicitly supplied uncommitted documentation/test files. Verify the merge base, branch, diff inventory, source snapshot, and supplied artifact hashes independently. Do not use the moving `base` branch as a substitute for this comparison commit. If the source changes during review, stop and report the identity mismatch. Do not call the candidate clean when a patch or untracked deliverable is included.

Read `AGENTS.md`, then its foundation review, authoritative product design, and current plan in that order. Read the routed design completely:

1. `docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md`
2. `docs/superpowers/specs/2026-07-25-workflow-studio-design.md`
3. `docs/superpowers/plans/2026-09-07-routed-arrange-graph.md`
4. `docs/superpowers/specs/2026-09-07-routed-arrange-graph-design.md`
5. `docs/reviews/2026-09-07-routed-arrange-graph-size-and-performance.md`

Read implementation, callers, tests, and measured evidence independently before forming a verdict. Do not read the other reviewer's report or the coordinator's reconciliation. Prior per-task fixes are context, not proof that the complete branch is correct. Account for every changed source, test, resource, configuration, and documentation path. Do not claim to have read truncated output.

Use `superpowers:requesting-code-review` review criteria. Keep source, tests, dependencies, and Git state unchanged. Use bounded read-only probes or scratch fixtures for concrete suspected defects; do not repeatedly rerun complete suites that have receipts for the same candidate. If a probe is unavailable, record that gap. No merge, version change, release, publication, installation, workflow execution, credential access, attribution removal, or Hermes repository modification is authorized.

## Requirement coverage

Review all fourteen requirements and record a separate disposition for each. Test-title tags are traceability metadata, not proof of behavioral coverage.

| ID | Required behavior and adversarial focus |
| --- | --- |
| RG1 | Deterministic left-to-right placement with exactly one complete normalized route per dependency; repeated/reordered equivalent requests and all three literal showcase scopes. |
| RG2 | No unrelated-node intersection or long unintended coincident lane; correct 0.5px tolerance, expanded rectangles, segment normalization, corner geometry, raw/normalized bounds, and an independent browser oracle. |
| RG3 | Distinct stable fan-out/fan-in ports; correct EAST/WEST ownership, ordering-pass intake, final fixed order, and lanes at joins. |
| RG4 | Unavoidable crossings remain readable through casing, active-edge stacking, endpoint emphasis, and non-color selection/focus cues. |
| RG5 | Positions/routes publish atomically and persist with the fitted viewport once; old layout versions still load; asynchronous echoes cannot resurrect stale geometry. |
| RG6 | Drag start invalidates the active cache immediately; pointer movement, held-drag auto-pan, and ordinary pan preserve their correct publication/persistence boundaries without ELK work. |
| RG7 | Topology, identity, definition/dependency order, dimensions, and position changes invalidate only affected scope caches; content/UI-only changes preserve matching routes. |
| RG8 | Malformed/oversized requests and responses, engine failures, stale identity, cancellation, missing measurements, destruction, five-second timeout, and retries fail safely and recover. |
| RG9 | Arrange has no YAML-byte, document-revision, undo, dirty/save/export, Git, or workflow-behavior side effect. |
| RG10 | Selection, deletion, keyboard focus, accessible names, stale/read-only states, reduced motion, forced colors, contrast, and connection-handle hit targets remain usable. |
| RG11 | Root and both loop bodies own independent caches, positions, viewport, selection, focus, inspector, and panel state across navigation and reopen. |
| RG12 | The actual fixed-seed 250-node/500-edge graph satisfies <=32,000 points, <=3,000ms warmed worker, <=50ms measured main-thread tasks, and the unchanged pointer-frame contract. |
| RG13 | Actual emitted workers, contract/resources, and ELK notices remain available offline in renderer and native packages; lazy isolation and the distinction between package inspection and native execution are truthful. |
| RG14 | Svelte Flow attribution stays visible and unobscured; no Pro dependency, hiding option, or CSS bypass was introduced. |

## Inspect the boundaries, not only happy paths

- **Authority and scope:** Follow Arrange and drag from toolbar/registry through App, GraphCanvas, projection, route activation, and layout persistence. YAML remains authoritative. Layout metadata must not enter workflow output, document hashes, undo, Git, or Hermes. Preserve DAG rejection, loop/reference authoring, panel controls, footer version, appearance/brand-pack entry points, and unrelated user state.
- **Worker isolation and ELK options:** Verify exact `elkjs@0.12.0`, official option keys, stable sorted inputs, and exact natural measured dimensions. The renderer lazily creates an outer validation worker, which uses official `elk-api.js` and a locally bundled algorithm descendant; no ELK runtime or option metadata belongs in renderer imports. Verify startup, malformed-message recovery, termination/replacement, and cleanup across both worker levels. The bounded preliminary `FIXED_SIDE` seed-2 pass may supply validated port order only; final routing uses `FIXED_ORDER`, seed 1, `NODES` model order, thoroughness 1, and the versioned spacing options. Permit only one preliminary ordering call, one final routing call, and one expanded retry for the two designated quality failures. Preliminary geometry never publishes.
- **Geometry and bounds:** Independently check exact node/edge membership, prototype-safe keyed records, source/target side attachment, finite coordinate and rectangle bounds, unrelated-node clearance, overlap, routes with reversals/duplicates/collinear points, short corner radii, and subdivided SVG crossing/coincidence detection. Inspect limits before allocation: 250 nodes, 500 edges, 2–64 normalized points per edge, <=32,000 raw/normalized aggregate points, and <=4,194,304 canonical routing bytes. Include escaped/multibyte identifiers and exact-limit cases. No partial route set may publish.
- **Async races and measurement:** Follow every await through frame scheduling, hashing, worker completion, accepted positions/routes, fitting, saved-route activation, and cleanup. Check complete request identity, workflow/pair/scope changes, layout revisions, changed measurements, concurrent edits, persistence echoes, cancellation, destruction, and retry. Batched offscreen measurement must preserve topology/visible connections and restore virtualization after cancel. The initial two-frame saved-cache activation must not invalidate natural taller cards based on a temporary footprint. An obsolete request cannot fit the viewport, persist old geometry, clear newer busy state, or leave an indefinite announcement.
- **Persistence and invalidation:** Verify additive optional `ScopeLayoutV1.routing` within record version 2, acceptance of older records, bounded sanitization that drops only invalid routing, exact fingerprint scope/order/topology/dimensions/position coverage, and clone ownership. Drag-start invalidation, keyboard nudge, node add/delete/duplicate/rename, dependency changes, and scope owner rename must never rewrite old routes into apparent validity. A held drag including Svelte Flow auto-pan must not publish/save per pointer frame; its completion saves final positions and live viewport together once.
- **Usability and accessibility:** Check casing/semantic/marker/focus order, readable crossings, keyboard parity with hover, Escape/delete/scope cleanup, endpoint emphasis that changes paint rather than measured dimensions, selected-edge stacking without stealing node handle hits, and full text/graphical contrast for subdued states. Screen-reader labels remain `Dependency from SOURCE to TARGET`. Arrange stays visibly focused and programmatically busy while only relevant mutations are locked; pan, zoom, selection, Copy, and Cancel remain available. Reduced motion has no route or fit animation; forced colors retains semantic routes, arrows, and focus.
- **Offline and packaging:** Inspect the actual production Vite manifest import closure and emitted worker URLs, not just source imports. External executable/worker/CSS loads must be absent; inert documentation/license URLs are allowed. Verify exact local emitted-worker execution and native compressed-payload/resource matching. ELK EPL-2.0 text, upstream copyright notices, and truthful pinned source-acquisition information must ship in public/dist/native resources and the integrity manifest. Never repeat the superseded claim that minification preserved the complete upstream notice inside the engine. Check Dagre removal and existing Svelte Flow attribution.
- **Performance evidence:** Confirm the opened YAML equals the fixed-seed capacity fixture, including its chain and long edges; the simpler old `large-canvas` fixture is not the Arrange timing oracle. Worker duration includes both ELK passes, validation, and any retry. Check raw request/response counts, cold/warm separation, actual Chromium top-level task trace samples as well as the Long Tasks observer, correct measurement interval, <=50ms publication preparation, and the 5,000ms timeout with worker replacement. All accepted showcase planar fixtures retain zero crossings and the deliberate non-planar fixture retains its reviewed maximum of one. Verify byte arithmetic against the immutable base and state host-specific limits honestly.

## Known evidence limits requiring an honest disposition

The Task 10 evidence has successful local-asset production worker execution in Chromium and WebKit with external requests blocked, plus byte-level inspection of native app/DMG payloads and notices. It does **not** include a packaged macOS WKWebView Arrange click-through with operating-system networking disabled. No callable packaged-WebView automation driver is available; this remains manual native UAT. Do not mark it passed based on browser or archive inspection.

The exact Tauri app/DMG command produced artifacts but exited 1 at updater signing without a private key. The established local `--no-sign` command passed. The candidate remains an unsigned local arm64 build at version 2.0.1; no updater signature, notarization, release publication, installation, or other-platform native acceptance is claimed. Final verification receipts must preserve actual exits and any skipped tests. The recorded 48.729ms maximum main-thread task is close to the 50ms boundary and must remain visible in the assessment; do not relax the limit.

## Finding format and final report

Return a standalone report with actual reviewer/model identity, frozen HEAD and patch hash, covered files, executed commands/results, and unavailable checks. State specification compliance and code-quality verdicts separately. For each RG1–RG14 row cite inspected implementation and behavioral evidence, and label it supported, defective, or evidence incomplete.

Use reviewer-prefixed IDs (`CLAUDE-001`, `CODEX-001`, etc.) and order findings by **Critical**, **Important**, then **Minor**. Each finding must include:

1. Violated requirement/invariant and concrete user impact.
2. Exact file and line; include caller/context when the defect crosses a boundary.
3. Smallest reproducible input or event sequence, with expected versus observed behavior.
4. Evidence from source and an executed probe when feasible; distinguish a confirmed defect from an untested suspicion.
5. The smallest correction direction and a proposed regression test that fails before the correction.

Do not manufacture findings to satisfy a quota. Do not propose a new interpreter, runtime, layout language, VM, bytecode, cross-language memory model, generic grouping feature, routing rewrite, or unrelated canvas expansion. Escalate any claim that the approved architecture cannot meet a demonstrated in-scope requirement; do not automatically broaden it.

The coordinator then consolidates duplicates in `docs/reviews/2026-09-07-routed-arrange-graph-adversarial-code-review.md`, retains both reviewer IDs, and independently marks every finding **valid**, **invalid**, or **out of scope** with reproduction evidence. Every valid defect gets a failing behavior test under `superpowers:systematic-debugging`/`superpowers:test-driven-development`, the smallest fix, focused verification, and focused re-review. Invalid/out-of-scope findings retain the reason and evidence. Complete-branch verification runs only after resolution. Report remaining acceptance limits and whether the branch is ready for the user's separate integration decision; never approve merge or release on the user's behalf.
