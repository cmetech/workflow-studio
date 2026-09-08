# Routed Arrange Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the explicit Arrange Graph command produce deterministic left-to-right node placement and complete orthogonal dependency routes that avoid unrelated nodes, remain readable in dense DAGs, and preserve manual layouts and workflow YAML.

**Architecture:** A lazily created dedicated worker owns pinned ELK Layered execution. Pure TypeScript boundaries build immutable requests, normalize and validate complete results, and reject stale or unsafe geometry before GraphCanvas atomically publishes positions and routes. Routes are optional derived data in the existing per-scope layout record and are rendered by the existing Svelte Flow custom edge, with smooth-step fallback after manual changes.

**Status:** Implemented and adversarial-review approved with zero remaining findings. Task 11 automated verification and final documentation/evidence are complete. Task 10's manual native offline UAT, signing, notarization, and release remain outstanding.

**Tech Stack:** Svelte 5, TypeScript 6, Svelte Flow 1.6.2, `elkjs` 0.12.0, Nanostores layout persistence, Web Workers, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-routed-arrange-graph-design.md`

## Global Constraints

- YAML remains the sole workflow source of truth. Routing must never enter YAML, document hashes, undo history, save state, Git state, export output, or Hermes input.
- Preserve DAG validation and the existing 250-node/500-edge visual capacity. Never publish a partial, cyclic, unresolved, duplicate, or self-edge projection.
- Run ELK only after an explicit Arrange Graph command, in a dedicated lazy worker. Never import or invoke ELK during startup, document analysis, scope navigation, pointer movement, or ordinary projection.
- Preserve the current graph while arranging. Apply positions and routes together only after identity, bounds, geometry, and quality validation pass.
- Preserve manual positions until the user explicitly arranges again. A node drag invalidates the active scope's routes at drag start and uses the existing smooth-step preview without worker work.
- Root and each `loop-group:<id>` scope own independent positions, routing, viewport, selection, focus, inspector, and auxiliary-panel state.
- Persist routing as an optional additive field in `ScopeLayoutV1`; keep `LayoutRecordV2.schemaVersion === 2` and accept older records that omit routing.
- Use exact measured node dimensions. Every node must have finite dimensions at least 216 × 104 before arranging; do not substitute 104px for a taller rendered card.
- Treat worker errors, timeouts, malformed results, stale responses, route-quality failures, and missing measurements as safe failures that preserve the current canvas.
- Keep the Svelte Flow attribution visible. This plan neither requires Svelte Flow Pro nor authorizes `proOptions.hideAttribution`.
- Preserve keyboard operation, edge deletion, semantic labels, forced-colors support, and reduced-motion behavior.
- Use `npm`; pin `elkjs` to exactly `0.12.0`; remove `@dagrejs/dagre` after the routed implementation passes its focused tests.
- Follow strict test-driven development for every task: add the behavior test, observe the intended failure, implement the smallest correct change, rerun the focused test, then refactor.
- Preserve the unrelated untracked mockups currently present in the repository:
  - `docs/mockups/ui-collapsed-panels-problems.png`
  - `docs/mockups/ui-expanded-panels-problems.png`
  - `docs/mockups/ui-theme-customization.png`
- After each task, use `superpowers:requesting-code-review` for the listed task files and resolve only validated findings before committing.
- Prefix the principal test title for each traced requirement with `[RG1]` through `[RG14]`; the ID is test metadata and must not appear in product UI.

## Recorded execution adjustments

The committed task reports and review fixes resolve these sequencing and integration details; the acceptance limits remain unchanged:

- Dagre/projector removal moved from Tasks 4–5 to Task 6 so the live Arrange command changed atomically from synchronous Dagre to asynchronous ELK (`f36b1a4`). The Task 4/5 boxes below include that completed deferred work.
- The official `elk-api.js` runs in the application layout worker and creates a locally bundled descendant algorithm worker (`19821c4`). Task 9 adds one bounded preliminary port-ordering pass before final `FIXED_ORDER` routing (`14eb968`); Task 10 selects measured `NODES`/thoroughness-1 tuning and batches 40 offscreen measurements (`3105814`). The design records the final implementation.
- The recorded Tauri command without `--no-sign` produced app/DMG files but exited 1 at updater signing because the private key is unavailable. The established unsigned local command `npm run tauri build -- --bundles app,dmg --no-sign` passed. Do not claim updater signing, release, installation, or other-platform acceptance.
- Browser execution with external requests blocked and native byte/resource inspection are passing evidence. They do not complete packaged macOS WKWebView Arrange UAT with OS networking disabled. Task 10 Step 4 stays unchecked for that manual acceptance item, even though its automated checks and focused review are committed.

## Requirements-to-task traceability

| Requirement | Implementation tasks | Required evidence |
| --- | --- | --- |
| RG1 deterministic placement and complete routes | 1, 3, 4, 6, 9 | adapter determinism, worker identity, three showcase scopes |
| RG2 node avoidance and coincident-segment control | 1, 4, 9 | geometry fixtures and browser SVG geometry |
| RG3 distinct fan-out/fan-in ports | 4, 9 | stable port fixture and showcase lane assertions |
| RG4 readable unavoidable crossings | 5, 8, 9 | casing order, emphasis, crossing fixture |
| RG5 atomic per-scope persistence | 2, 5, 6, 7 | store round-trip, deferred client, scope reopen |
| RG6 drag invalidation without ELK | 7, 9, 10 | pointer metrics and real drag fallback |
| RG7 topology invalidation and content preservation | 2, 7 | reconciliation matrix across three scopes |
| RG8 safe worker failures and stale responses | 1, 3, 4, 6, 9 | malformed output, timeout, races, recovery |
| RG9 no workflow/YAML side effects | 6, 9 | byte, dirty-state, undo, and Git assertions |
| RG10 edge interaction and accessibility | 5, 8, 9 | unit accessibility and cross-browser keyboard tests |
| RG11 independent root/body caches | 2, 7, 9 | root and both loop-body round trips |
| RG12 250-node/500-edge budgets | 1, 3, 4, 7, 10 | bounded output, long-task and worker timing |
| RG13 offline ELK/package availability | 4, 10 | Vite/native asset inspection with networking disabled |
| RG14 unchanged attribution | 5, 9, 10 | component, browser, and production boundary assertions |

---

### Task 1: Define bounded routed-layout data and geometry validation

**Files:**
- Create: `src/lib/layout/routing.ts`
- Create: `src/lib/layout/routing.test.ts`
- Create: `src/features/canvas/routed-layout.ts`
- Create: `src/features/canvas/routed-layout.test.ts`
- Modify: `src/lib/layout/types.ts`

**Interfaces:**

```ts
export const ROUTING_ENGINE = 'elk-layered-orthogonal-v1' as const
export const MAX_ROUTE_POINTS_PER_EDGE = 64
export const MAX_TOTAL_ROUTE_POINTS = 32_000
export const MAX_SERIALIZED_ROUTING_BYTES = 4_194_304

export interface EdgeRoutePointV1 {
  readonly x: number
  readonly y: number
}

export interface EdgeRouteV1 {
  readonly edgeId: string
  readonly points: readonly EdgeRoutePointV1[]
}

export interface ScopeRoutingV1 {
  readonly schemaVersion: 1
  readonly engine: typeof ROUTING_ENGINE
  readonly fingerprint: `sha256:${string}`
  readonly routes: Readonly<Record<string, EdgeRouteV1>>
}

export interface RoutingFingerprintNode {
  readonly id: string
  readonly order: number
  readonly width: number
  readonly height: number
}

export interface RoutingFingerprintEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly order: number
}
```

`ScopeLayoutV1` gains `routing?: ScopeRoutingV1`. `routed-layout.ts` exports pure `normalizeRoute`, `validateRoutedLayout`, `countOrthogonalCrossings`, and the following asynchronous fingerprint functions. Both use `canonicalizeJsonValue` and `sha256Hex` from `src/lib/contract/canonical-json.ts`; do not introduce a custom hash.

```ts
export function graphFingerprint(input: {
  readonly engine: typeof ROUTING_ENGINE
  readonly scopeKey: GraphScopeKey
  readonly nodes: readonly RoutingFingerprintNode[]
  readonly edges: readonly RoutingFingerprintEdge[]
}): Promise<`sha256:${string}`>

export function routingFingerprint(input: {
  readonly graphFingerprint: `sha256:${string}`
  readonly positions: Readonly<Record<string, CanvasPosition>>
}): Promise<`sha256:${string}`>
```

- [x] **Step 1: Write failing route model and validator tests**

Add table-driven tests for duplicate-point removal, collinear-point collapse, the 0.5px geometry tolerance, finite coordinate bounds, 2–64 points per route, the 32,000-point aggregate limit, the 4MiB serialized-routing limit, exact edge membership, exact node-position membership, orthogonal segments, correct source/target rectangle boundaries, node overlap, expanded unrelated-node intersection, and coincident segments longer than 24px outside a 24px endpoint fan zone. Add crossing-count fixtures for a straight chain, diamond, fan-out/fan-in, and one unavoidable crossing.

Add fingerprint tests that reverse object insertion order and expect the same `sha256:<64 lowercase hex>` result. Changing engine, scope, node definition order, dimensions, or topology must change `graphFingerprint`; changing that digest or any arranged position must change `routingFingerprint`. The bounded expanded-spacing retry is an internal strategy of `elk-layered-orthogonal-v1`; the accepted positions already distinguish its result and no second persisted engine identity is introduced.

- [x] **Step 2: Run the tests and confirm the expected RED state**

Run:

```bash
npm test -- src/lib/layout/routing.test.ts src/features/canvas/routed-layout.test.ts
```

Expected: FAIL because routed-layout types, normalization, validation, crossing metrics, and fingerprinting do not exist.

- [x] **Step 3: Implement the pure bounded domain**

Implement the types and constants without ELK imports. `normalizeRoute` must remove only consecutive duplicates and axis-collinear interior points, preserve endpoints, reject diagonals/non-finite points, and never mutate input. `validateRoutedLayout` must return a discriminated result rather than throw:

```ts
export type RoutedLayoutValidation =
  | { readonly ok: true; readonly layout: ValidatedRoutedLayout; readonly crossingCount: number }
  | { readonly ok: false; readonly code: RoutedLayoutFailureCode }
```

Use rectangle/segment math with a small fixed floating-point tolerance declared in the module. Validate the complete result before returning the success branch. Do not partially retain valid routes when another route fails.

- [x] **Step 4: Run focused tests and type checking**

Run:

```bash
npm test -- src/lib/layout/routing.test.ts src/features/canvas/routed-layout.test.ts
npm run check
```

Expected: PASS with no Svelte or TypeScript errors.

- [x] **Step 5: Request focused review and commit**

Review the two new modules and tests for off-by-one boundary errors, mutation, unbounded allocations, hash completeness, and false node-intersection positives. Resolve validated findings, rerun Step 4, then commit:

```bash
git add src/lib/layout/routing.ts src/lib/layout/routing.test.ts src/features/canvas/routed-layout.ts src/features/canvas/routed-layout.test.ts src/lib/layout/types.ts
git commit -m "feat: define validated canvas routes"
```

### Task 2: Persist and invalidate routes per scope

**Files:**
- Modify: `src/lib/layout/layout-store.ts`
- Modify: `src/lib/layout/layout-store.test.ts`
- Modify: `src/lib/layout/place-new-nodes.ts`
- Modify: `src/lib/layout/place-new-nodes.test.ts`
- Modify: `src/lib/layout/routing.ts`
- Modify: `src/lib/layout/routing.test.ts`

**Interfaces:**

`sanitizeScopeRouting(value: unknown): ScopeRoutingV1 | undefined` accepts only schema version 1, the exact engine, a SHA-256 fingerprint, at most 500 routes, at most 64 points per route, no more than 32,000 total points, no more than 4MiB of canonical serialized routing, unique matching record key/`edgeId` values, and coordinates within the existing ±1,000,000 layout bound. `withoutRouting(scope)` returns the original object when routing is absent and a cloned scope without routing when present.

- [x] **Step 1: Write failing persistence and invalidation tests**

Require a valid routing record to survive save/load and cloning byte-for-byte while old v1/v2 records without routing still load. Require malformed schema, engine, digest, record keys, edge IDs, coordinates, per-route point counts, total point counts, and route counts to drop only `routing` while preserving the rest of the valid scope.

In `place-new-nodes.test.ts`, require routing preservation for unchanged projections and selection/focus reconciliation. Require route invalidation when a node is added, removed, automatically placed, or renamed, including `migrateVisualNodeRename`, `migrateManualYamlNodeRename`, and root/body `reconcileWorkflowLayout`. When both projections are available, require dependency-topology changes to invalidate routing even if node IDs and positions are unchanged. Verify an unaffected sibling loop scope retains its route object identity.

- [x] **Step 2: Run the tests and confirm the expected RED state**

Run:

```bash
npm test -- src/lib/layout/layout-store.test.ts src/lib/layout/place-new-nodes.test.ts src/lib/layout/routing.test.ts
```

Expected: FAIL because `ScopeLayoutV1.routing` is not sanitized, cloned, or invalidated.

- [x] **Step 3: Implement additive v2 persistence**

Call `sanitizeScopeRouting` from `sanitizeScopeLayout`; omit a rejected routing field rather than rejecting a valid legacy layout record. Check route/key/point counts and string lengths before canonical serialization so a hostile object cannot force an unbounded intermediate allocation. Preserve valid routing through `structuredClone`. `reconcileLayout` clears routing when its node membership or resulting positions change. `migrateManualYamlNodeRename` and `reconcileWorkflowLayout`, which receive before/after projections, also compare dependency topology and clear only each changed scope. A rename must invalidate instead of rewriting route edge IDs or points.

- [x] **Step 4: Run focused persistence tests**

Run:

```bash
npm test -- src/lib/layout/layout-store.test.ts src/lib/layout/place-new-nodes.test.ts src/lib/layout/routing.test.ts
```

Expected: PASS, including legacy records and independent loop scopes.

- [x] **Step 5: Request focused review and commit**

Review for permissive old-record handling, complete bounds, route-count denial-of-service cases, and accidental cross-scope invalidation. Resolve validated findings, rerun Step 4, then commit:

```bash
git add src/lib/layout/layout-store.ts src/lib/layout/layout-store.test.ts src/lib/layout/place-new-nodes.ts src/lib/layout/place-new-nodes.test.ts src/lib/layout/routing.ts src/lib/layout/routing.test.ts
git commit -m "feat: persist routed scope layouts"
```

### Task 3: Add the layout worker protocol and lifecycle client

**Files:**
- Create: `src/workers/layout-worker-protocol.ts`
- Create: `src/workers/layout-client.ts`
- Create: `src/workers/layout-client.test.ts`

**Interfaces:**

```ts
export interface LayoutRequestIdentity {
  readonly requestId: string
  readonly workflowIdentity: string
  readonly pairGeneration: number
  readonly scopeKey: GraphScopeKey
  readonly graphFingerprint: `sha256:${string}`
  readonly layoutRevision: number
}

export interface LayoutWorkerNode {
  readonly id: string
  readonly order: number
  readonly width: number
  readonly height: number
}

export interface LayoutWorkerEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly order: number
}
```

`LayoutWorkerNode` and `LayoutWorkerEdge` structurally extend the `RoutingFingerprintNode` and `RoutingFingerprintEdge` inputs created in Task 1, keeping hashing independent of worker lifecycle code.

The request is `{ type: 'layout', identity, nodes, edges }`. Success repeats the exact identity and returns the accepted internal spacing profile, finite node positions, complete normalized routes, bounds, and `durationMs`. Raw ELK sections never cross the worker boundary. Failure repeats identity and uses a stable code from `invalid_request`, `layout_failed`, `invalid_result`, `worker_runtime_error`, `worker_message_error`, or `worker_timeout`.

`LayoutClient` lazily creates an endpoint through an injected `workerFactory`, permits one current request, rejects superseded responses, terminates and replaces a timed-out worker, and exposes `arrange(request): Promise<LayoutWorkerResult>` plus `destroy()`.

- [x] **Step 1: Write failing fake-endpoint lifecycle tests**

Copy the narrow fake endpoint pattern from `document-client.test.ts`. Require: no worker before first Arrange; exact immutable request posting; success identity passthrough; older response rejection after a newer request; rejection after workflow, generation, scope, fingerprint, or revision mismatch; stable runtime/message error mapping; 5,000ms timeout; termination on timeout; a fresh endpoint for the next request; all pending work rejected on `destroy`; and listener removal.

- [x] **Step 2: Run the client test and confirm the expected RED state**

Run:

```bash
npm test -- src/workers/layout-client.test.ts
```

Expected: FAIL because the protocol and client do not exist.

- [x] **Step 3: Implement the protocol and client without ELK**

Keep the protocol structured-clone-safe and free of functions, DOM objects, Svelte Flow values, and YAML content. Freeze or clone caller-owned arrays at the boundary. Use one timer per request. Clear timers and listeners along every completion/failure path. Never publish an event whose complete identity differs from the current request.

- [x] **Step 4: Run focused tests and type checking**

Run:

```bash
npm test -- src/workers/layout-client.test.ts
npm run check
```

Expected: PASS with no leaked fake-worker listeners or timers.

- [x] **Step 5: Request focused review and commit**

Review race handling, cleanup, timeout recovery, identity comparison, and request mutation. Resolve validated findings, rerun Step 4, then commit:

```bash
git add src/workers/layout-worker-protocol.ts src/workers/layout-client.ts src/workers/layout-client.test.ts
git commit -m "feat: add canvas layout worker client"
```

### Task 4: Integrate pinned ELK Layered in the dedicated worker

**Files:**
- Create: `src/workers/layout-worker.ts`
- Create: `src/workers/layout-worker.test.ts`
- Modify: `src/features/canvas/layout-graph.ts`
- Modify: `src/features/canvas/layout-graph.test.ts`
- Modify: `src/workers/layout-worker-protocol.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

`layout-graph.ts` becomes the pure adapter and exports `buildElkGraph(request)`, `readElkResult(request, result)`, and `arrangeWithElk(request, elk)`; it no longer records an editor metric or invokes layout synchronously. `layout-worker.ts` owns the `ELK` instance and message handler. Stable engine options are declared once in `layout-graph.ts` under `ROUTING_ENGINE`.

- [x] **Step 1: Write failing dependency and ELK adapter tests**

Replace the Dagre-only test with fixtures that require:

- `org.eclipse.elk.layered`, `RIGHT`, `ORTHOGONAL`, fixed seed, graph padding, 64px node spacing, 136px layer spacing, 24px edge/node spacing, and 14px edge/edge spacing;
- exact measured width/height and stable YAML node order;
- WEST input ports and EAST output ports with `FIXED_ORDER`;
- distinct per-edge port IDs ordered by dependency order then edge ID;
- deterministic positions and complete edge sections when request arrays arrive in the same semantic order;
- safe rejection of unknown endpoints, duplicates, self-edges, over-capacity requests, missing edge sections, unknown IDs, NaN/Infinity, or malformed ELK output; and
- one expanded-spacing retry only for validator codes `route_intersects_node` and `coincident_route_segment`.

Add a package assertion that `elkjs` equals `0.12.0`. Initially retain the Dagre absence assertion as RED until the last step of this task. Assert that raw ELK sections are normalized and validated inside the worker and that only bounded positions/routes cross its response boundary.

- [x] **Step 2: Run the tests and confirm the expected RED state**

Run:

```bash
npm test -- src/features/canvas/layout-graph.test.ts src/workers/layout-worker.test.ts
```

Expected: FAIL because ELK conversion, routing, worker handling, and the pinned dependency do not exist.

- [x] **Step 3: Install ELK and implement stable conversion**

Run:

```bash
npm install --save-exact elkjs@0.12.0
```

Implement input validation before ELK. Give each edge its own stable source and target port so fan-out/fan-in routes do not share the centerline. Convert every ELK section and bend point to one continuous source-to-target point list, then pass the complete result to `validateRoutedLayout`. Retry once with the versioned expanded profile only for the two allowed quality failures. Return `invalid_result` for all other unsafe output.

The browser worker entry must instantiate ELK within the worker bundle and must not fetch a CDN or runtime network asset. Use an injectable `ElkLike` interface in unit tests rather than mocking global module behavior.

- [x] **Step 4: Remove Dagre and prove focused GREEN**

Run:

```bash
npm uninstall @dagrejs/dagre
npm test -- src/features/canvas/layout-graph.test.ts src/workers/layout-worker.test.ts src/features/canvas/routed-layout.test.ts
npm run check
```

Expected: PASS; `package.json` and `package-lock.json` contain pinned `elkjs` and no `@dagrejs/dagre`; no main-thread module imports ELK.

- [x] **Step 5: Request focused review and commit**

Review official ELK option names, port ownership, section concatenation, deterministic ordering, bounded retry, error exposure, and offline worker bundling. Resolve validated findings, rerun Step 4, then commit:

```bash
git add package.json package-lock.json src/features/canvas/layout-graph.ts src/features/canvas/layout-graph.test.ts src/workers/layout-worker-protocol.ts src/workers/layout-worker.ts src/workers/layout-worker.test.ts
git commit -m "feat: route arranged graphs with ELK"
```

### Task 5: Project persisted routes into Svelte Flow edges

**Files:**
- Modify: `src/features/canvas/types.ts`
- Modify: `src/features/canvas/project-canvas.ts`
- Modify: `src/features/canvas/project-canvas.test.ts`
- Create: `src/features/canvas/edge-route-path.ts`
- Create: `src/features/canvas/edge-route-path.test.ts`
- Modify: `src/features/canvas/WorkflowEdge.svelte`
- Create: `src/features/canvas/WorkflowEdge.test.ts`

**Interfaces:**

`CanvasEdgeData` gains `route?: EdgeRouteV1` and `emphasized?: boolean`. `ProjectCanvasOptions` gains `routing?: ScopeRoutingV1`; remove `arrange` and `layoutGraph`. `edge-route-path.ts` exports `roundedOrthogonalPath(points, radius = 8): string`, producing a bounded SVG path without mutating the route.

- [x] **Step 1: Write failing projection, path, and component tests**

Require `projectCanvas` to attach routes only when the route record contains every current edge and each route's `edgeId` matches its map key. Require `sameCanvasEdge` to detect route point or emphasis changes while preserving object identity for unchanged edges. Require ordinary projection to keep persisted positions and perform no layout work.

For the path helper, assert exact `M`, `L`, and quadratic corner commands for horizontal/vertical turns, radius clamping on short segments, duplicate-free output, and a maximum derived from 64 points. In `WorkflowEdge.test.ts`, require a valid route to replace `getSmoothStepPath`, a missing route to retain smooth-step fallback, a casing path below the semantic edge, the unchanged `Dependency from SOURCE to TARGET` label, selected/focused state hooks, and forced-colors CSS.

- [x] **Step 2: Run focused tests and confirm the expected RED state**

Run:

```bash
npm test -- src/features/canvas/project-canvas.test.ts src/features/canvas/edge-route-path.test.ts src/features/canvas/WorkflowEdge.test.ts
```

Expected: FAIL because projected routes, rounded orthogonal paths, and edge casing do not exist.

- [x] **Step 3: Implement route projection and rendering**

Keep route validation upstream; the projector performs only exact membership checks and cloning/reuse. Render casing, semantic path, focus halo, and the existing 32px interaction path in a stable order. The casing uses the canvas background color and does not carry the arrow marker. The semantic path retains the arrow marker and stale/read-only/selected classes. Avoid animated path interpolation.

- [x] **Step 4: Run focused tests and flow boundary checks**

Run:

```bash
npm test -- src/features/canvas/project-canvas.test.ts src/features/canvas/edge-route-path.test.ts src/features/canvas/WorkflowEdge.test.ts src/features/canvas/GraphCanvas.flow-boundary.test.ts
npm run check
```

Expected: PASS; generic smooth-step remains available only as the fallback path.

- [x] **Step 5: Request focused review and commit**

Review SVG safety, route clone/reuse behavior, marker placement, z-order, interaction width, accessible names, and forced-colors treatment. Resolve validated findings, rerun Step 4, then commit:

```bash
git add src/features/canvas/types.ts src/features/canvas/project-canvas.ts src/features/canvas/project-canvas.test.ts src/features/canvas/edge-route-path.ts src/features/canvas/edge-route-path.test.ts src/features/canvas/WorkflowEdge.svelte src/features/canvas/WorkflowEdge.test.ts
git commit -m "feat: render routed workflow edges"
```

### Task 6: Make Arrange Graph asynchronous, measured, stale-safe, and atomic

**Files:**
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `src/workers/layout-client.ts`
- Modify: `src/workers/layout-client.test.ts`
- Modify: `src/lib/commands/types.ts`
- Modify: `src/lib/commands/registry.ts`
- Modify: `src/lib/commands/registry.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`

**Interfaces:**

`GraphCanvas` accepts optional injectable `layoutClient?: LayoutClientLike`, `pairGeneration?: number`, and `onArrangeBusyChange?: (busy: boolean, identity: string) => void` props for tests and App coordination, and exports `arrange(): Promise<void>`. `pairGeneration` defaults to zero in isolated component tests; App must pass `$documentSessionStore.pair?.generation ?? 0`. Production creates the client lazily with:

```ts
() => new Worker(new URL('../../workers/layout-worker.ts', import.meta.url), { type: 'module' })
```

`CommandContext` gains `arrangeBusy?: boolean`; only topology-mutating canvas commands use it as a disable condition during arrangement. App keeps the busy value only while the callback identity equals its active canvas identity, so stale callbacks cannot lock a later workflow or scope. Pan, zoom, selection, and cancel remain available. The active request identity includes `workflowIdentity`, `pairGeneration`, scope key, graph fingerprint, and a monotonically increasing layout revision.

- [x] **Step 1: Write failing GraphCanvas and App tests**

Use a deferred fake layout client. Require Arrange to:

- await one rendered frame for current Svelte Flow measurements;
- send exact finite measured sizes, preserving taller loop-group cards;
- refuse a request if any node is unmeasured, below the 216 × 104 minimum, or non-finite after that frame;
- keep current nodes/edges visible while pending;
- disable Arrange, drag, connect, delete, add, duplicate, paste, and reconnect while keeping pan, zoom, selection, and Cancel available;
- set polite feedback to `Arranging graph…` without moving focus;
- atomically publish positions and routes only on a current valid success;
- preserve selection and then fit the graph, using zero duration under reduced motion;
- announce `Graph arranged: N nodes and M dependencies.`;
- leave positions, routes, selection, viewport, YAML text, dirty state, and undo history unchanged on rejection; and
- announce the approved safe failure message without raw worker details.

Add identity-race cases for projection replacement, workflow replacement, pair generation change, scope navigation, layout revision change, component destruction, and two rapid arrange attempts.

- [x] **Step 2: Run the tests and confirm the expected RED state**

Run:

```bash
npm test -- src/features/canvas/GraphCanvas.test.ts src/workers/layout-client.test.ts src/lib/commands/registry.test.ts src/app/App.test.ts
```

Expected: FAIL because Arrange is synchronous, dimensions are fixed, there is no worker lifecycle, and command busy state is absent.

- [x] **Step 3: Implement measured asynchronous orchestration**

Remove the `projectCanvas(..., { arrange: true })` path. Build the request from active `flowNodes`, using each node's Svelte Flow `measured` dimensions and current projection edge order. Compute the request fingerprint asynchronously, recheck identity after every `await`, and pass an immutable request to `LayoutClient`.

On success, validate the final arranged-position fingerprint, build one next `ScopeLayoutV1` containing positions and routing, then update `flowNodes`, `flowEdges`, the canvas position store, and persistence from that same accepted object. No intermediate position-only publication is allowed. Use the existing Svelte Flow viewport API for fit-to-graph only after publication. Always clear busy state in `finally` when the matching request owns it.

Call `recordEditorMetric('layouts')` exactly once immediately before posting an accepted, fully measured Arrange request. Missing measurements and pointer movement must not increment the layout metric.

- [x] **Step 4: Run focused tests and type checking**

Run:

```bash
npm test -- src/features/canvas/GraphCanvas.test.ts src/workers/layout-client.test.ts src/lib/commands/registry.test.ts src/app/App.test.ts
npm run check
```

Expected: PASS with deterministic fake-client behavior and no unhandled promises.

- [x] **Step 5: Request focused review and commit**

Review every async boundary for stale publication, focus loss, incomplete mutation locks, layout/YAML separation, cleanup, and fit-view timing. Resolve validated findings, rerun Step 4, then commit:

```bash
git add src/features/canvas/GraphCanvas.svelte src/features/canvas/GraphCanvas.test.ts src/workers/layout-client.ts src/workers/layout-client.test.ts src/lib/commands/types.ts src/lib/commands/registry.ts src/lib/commands/registry.test.ts src/app/App.svelte src/app/App.test.ts
git commit -m "feat: arrange canvas asynchronously"
```

### Task 7: Enforce route-cache validity across drag, topology, dimensions, and scopes

**Files:**
- Modify: `src/features/canvas/routed-layout.ts`
- Modify: `src/features/canvas/routed-layout.test.ts`
- Modify: `src/features/canvas/canvas-projection-refresh.ts`
- Modify: `src/features/canvas/canvas-projection-refresh.test.ts`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `src/features/canvas/project-canvas.ts`
- Modify: `src/features/canvas/project-canvas.test.ts`
- Modify: `src/lib/layout/place-new-nodes.ts`
- Modify: `src/lib/layout/place-new-nodes.test.ts`

**Interfaces:**

Add `resolveCurrentRouting(projection, positions, measuredNodes, routing)` to `routed-layout.ts`. This pure asynchronous helper returns the complete routing only when its recomputed fingerprint matches; otherwise it returns `undefined`. `CanvasProjectionRefreshSnapshot` records the routing fingerprint so a persistence echo does not spuriously refresh the canvas.

- [x] **Step 1: Write failing invalidation and preservation tests**

Require drag start, node dimension change, edge add/remove/reconnect, node add/delete/duplicate/rename, route sanitizer rejection, and engine-version mismatch to clear the active scope's complete route cache. Require content-only edits, selection, focus, viewport, panel state, auxiliary tab, navigation, and persistence echoes to preserve a matching cache.

Open root, arrange it, open each loop body, arrange each, navigate among all three, and require independent exact route restoration. Mutate only one body topology and require root and the sibling body caches to survive. During 1,000 pointer moves, require zero worker requests, layouts, persistence calls, parsing, validation, Git queries, native calls, and file operations; only drag completion persists positions, with no routing.

- [x] **Step 2: Run focused tests and confirm the expected RED state**

Run:

```bash
npm test -- src/features/canvas/canvas-projection-refresh.test.ts src/features/canvas/GraphCanvas.test.ts src/features/canvas/project-canvas.test.ts src/lib/layout/place-new-nodes.test.ts tests/performance/canvas-performance.test.ts
```

Expected: FAIL because routing validity and drag/topology invalidation are not yet coordinated.

- [x] **Step 3: Implement complete-cache activation and invalidation**

At drag start, publish the active scope without routing before the first pointer-move update and switch every edge to smooth-step fallback. On a projection/layout refresh, activate routes only after exact asynchronous fingerprint comparison; guard that comparison with the same workflow/scope/revision identity rules as Arrange. Never mix individual old routes with current edges. Keep unaffected scopes unchanged by reference where possible.

- [x] **Step 4: Run focused invalidation and performance tests**

Run:

```bash
npm test -- src/features/canvas/canvas-projection-refresh.test.ts src/features/canvas/GraphCanvas.test.ts src/features/canvas/project-canvas.test.ts src/lib/layout/place-new-nodes.test.ts tests/performance/canvas-performance.test.ts
```

Expected: PASS; pointer-move metrics remain at zero for every prohibited operation.

- [x] **Step 5: Request focused review and commit**

Review route activation races, drag-start persistence timing, topology coverage, sibling-scope identity preservation, and the absence of worker work in pointer frames. Resolve validated findings, rerun Step 4, then commit:

```bash
git add src/features/canvas/routed-layout.ts src/features/canvas/routed-layout.test.ts src/features/canvas/canvas-projection-refresh.ts src/features/canvas/canvas-projection-refresh.test.ts src/features/canvas/GraphCanvas.svelte src/features/canvas/GraphCanvas.test.ts src/features/canvas/project-canvas.ts src/features/canvas/project-canvas.test.ts src/lib/layout/place-new-nodes.ts src/lib/layout/place-new-nodes.test.ts
git commit -m "fix: invalidate stale canvas routes"
```

### Task 8: Add dense-graph edge emphasis and accessible route states

**Files:**
- Modify: `src/features/canvas/types.ts`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `src/features/canvas/WorkflowEdge.svelte`
- Modify: `src/features/canvas/WorkflowEdge.test.ts`
- Modify: `src/features/canvas/WorkflowNode.svelte`
- Create: `src/features/canvas/WorkflowNode.test.ts`
- Modify: `tests/accessibility/keyboard-authoring.test.ts`
- Modify: `tests/accessibility/reduced-motion.test.ts`

**Interfaces:**

`CanvasNodeData` gains `edgeEmphasized?: boolean` and `edgesDeemphasized?: boolean`. GraphCanvas derives these flags from the hovered, focused, or selected edge's source/target IDs. Svelte Flow edge pointer/focus/selection events update ephemeral component state only; these flags are never persisted.

- [x] **Step 1: Write failing interaction and accessibility tests**

Require hover, keyboard focus, and selection to raise the active routed edge, preserve its casing/semantic/focus layers, emphasize both endpoint cards, and reduce other edges without hiding them. Require pointer leave, focus leave, Escape, deletion, and scope change to clear emphasis. Require stale, read-only, selected, hover, focus-visible, and forced-colors classes to remain distinct. Require screen-reader labels to remain independent of route shape and reduced motion to avoid path or fit-view animation.

- [x] **Step 2: Run focused tests and confirm the expected RED state**

Run:

```bash
npm test -- src/features/canvas/GraphCanvas.test.ts src/features/canvas/WorkflowEdge.test.ts src/features/canvas/WorkflowNode.test.ts tests/accessibility/keyboard-authoring.test.ts tests/accessibility/reduced-motion.test.ts
```

Expected: FAIL because dense-edge emphasis and endpoint state do not exist.

- [x] **Step 3: Implement ephemeral emphasis state**

Use Svelte Flow edge events at the canvas boundary so `WorkflowEdge` remains a pure renderer. Derive endpoint node data from the current edge IDs and reuse unchanged nodes. Use CSS custom properties for normal, casing, selected, subdued, focus, and forced-colors states. Never use color or endpoint emphasis as the sole selected/focused indication.

- [x] **Step 4: Run focused accessibility tests**

Run:

```bash
npm test -- src/features/canvas/GraphCanvas.test.ts src/features/canvas/WorkflowEdge.test.ts src/features/canvas/WorkflowNode.test.ts tests/accessibility/keyboard-authoring.test.ts tests/accessibility/reduced-motion.test.ts
npm run check
```

Expected: PASS with no accessibility warnings.

- [x] **Step 5: Request focused review and commit**

Review event ownership, keyboard equivalence, focus visibility, contrast, forced-colors behavior, selection deletion, and object reuse. Resolve validated findings, rerun Step 4, then commit:

```bash
git add src/features/canvas/types.ts src/features/canvas/GraphCanvas.svelte src/features/canvas/GraphCanvas.test.ts src/features/canvas/WorkflowEdge.svelte src/features/canvas/WorkflowEdge.test.ts src/features/canvas/WorkflowNode.svelte src/features/canvas/WorkflowNode.test.ts tests/accessibility/keyboard-authoring.test.ts tests/accessibility/reduced-motion.test.ts
git commit -m "feat: clarify dense graph connections"
```

### Task 9: Prove routed layout on the root and both loop-group showcase scopes

**Files:**
- Create: `tests/e2e/routed-arrange-graph.spec.ts`
- Create: `tests/e2e/fixtures/loop-group-showcase.yaml`
- Modify: `tests/e2e/support.ts`
- Modify: `tests/e2e/loop-group-authoring.spec.ts`
- Modify: `src/features/canvas/layout-graph.test.ts`
- Create: `src/features/canvas/fixtures/routed-layout-cases.ts`

**Interfaces:**

The fixture module exports deterministic chain, diamond, fan-out/fan-in, long-edge, disconnected, unavoidable-crossing, showcase-root, planning-body, and implementation-body cases. The accepted maximum is zero crossings for every case except the deliberately unavoidable fixture, whose accepted maximum is one. E2E helpers read node rectangles and SVG path geometry without screenshots or pixel-color heuristics.

- [x] **Step 1: Add failing acceptance tests against the real showcase**

Copy `/Users/coreyellis/Workflows/loop-group-showcase.yaml` byte-for-byte into `tests/e2e/fixtures/loop-group-showcase.yaml` and assert its SHA-256 remains `1734f0d62a5dbad01dcf6f8ed4a4aed3572c52c0d7b2033fb98157edc57523bc`. Open the repository fixture through the existing browser bridge so CI does not depend on the user's home directory. In Chromium and WebKit, explicitly arrange:

1. the seven-node root;
2. the four-node `planning-cycle` body; and
3. the six-node `implementation-cycle` body.

For each scope, assert every edge has an orthogonal routed path, its endpoints lie on the correct source/target boundaries, no segment enters an unrelated expanded node rectangle, fan-out lanes are distinct, and crossing count is zero. Navigate away and back and assert exact path restoration.

Add failure recovery with a test-injected malformed response, then arrange successfully. Add manual drag: confirm immediate smooth-step fallback, no YAML byte change, persistence without routes, and a later Arrange restoring valid routes. Assert the Svelte Flow attribution remains visible.

- [x] **Step 2: Run Chromium and confirm the expected RED state**

Run:

```bash
npm run test:e2e -- tests/e2e/routed-arrange-graph.spec.ts tests/e2e/loop-group-authoring.spec.ts --project=chromium
```

Expected: FAIL until real worker routing, route persistence, and E2E geometry helpers satisfy all three scopes.

- [x] **Step 3: Correct only browser-proven integration defects**

Adjust ELK port/options, Svelte Flow measurement timing, route SVG data hooks, or viewport timing only when a failing assertion proves the need. Do not raise the stated crossing maxima or relax node-intersection rules, capacity, timeout, identity checks, or pointer-frame invariants without amending the approved design and obtaining user approval.

- [x] **Step 4: Run both browser engines**

Run:

```bash
npm run test:e2e -- tests/e2e/routed-arrange-graph.spec.ts tests/e2e/loop-group-authoring.spec.ts --project=chromium
npm run test:e2e -- tests/e2e/routed-arrange-graph.spec.ts tests/e2e/loop-group-authoring.spec.ts --project=webkit
```

Expected: PASS for root, both loop bodies, persistence, drag fallback, safe failure, and attribution.

- [x] **Step 5: Request focused review and commit**

Review E2E determinism, geometry math, fixture baselines, platform timing, test-only injection containment, and whether any assertion can pass with missing edges. Resolve validated findings, rerun Step 4, then commit:

```bash
git add tests/e2e/routed-arrange-graph.spec.ts tests/e2e/fixtures/loop-group-showcase.yaml tests/e2e/support.ts tests/e2e/loop-group-authoring.spec.ts src/features/canvas/layout-graph.test.ts src/features/canvas/fixtures/routed-layout-cases.ts
git commit -m "test: verify routed loop group layouts"
```

### Task 10: Verify the 250-node/500-edge and offline bundle contracts

**Files:**
- Modify: `tests/performance/canvas-performance.test.ts`
- Modify: `tests/performance/scoped-canvas-performance.test.ts`
- Modify: `tests/e2e/canvas-capacity.spec.ts`
- Create: `tests/project/routed-layout-boundary.test.ts`
- Create: `docs/reviews/2026-09-07-routed-arrange-graph-size-and-performance.md`

**Interfaces:**

The project-boundary test reads the production Vite manifest and emitted assets. It proves ELK appears only in the lazy layout-worker asset, that no worker or renderer asset references a network URL, that the initial renderer asset does not contain ELK's module identifiers, that Dagre is absent, and that Svelte Flow attribution hiding is not configured.

- [x] **Step 1: Add failing capacity, long-task, and package tests**

Extend the fixed-seed 250/500 fixture to make one explicit worker Arrange request. Require at most 32,000 returned route points, one response per request, no main-thread task above 50ms while constructing/publishing the request/result, and a warmed worker duration no greater than 3,000ms on the release verification host. Retain the existing 1,000-pointer-move zero-work contract.

Add a 5,000ms timeout/recovery browser case. Add production-build assertions for lazy worker isolation, offline assets, pinned `elkjs@0.12.0`, removed Dagre, and visible attribution. Capture pre-feature evidence from base commit `566b9d991399bcf874b02110d68ab1435c26a872` using a temporary checkout or existing artifact, then compare initial renderer, worker, total `dist`, and native bundle sizes.

- [x] **Step 2: Run the focused checks and confirm the expected RED state**

Run:

```bash
npm test -- tests/performance/canvas-performance.test.ts tests/performance/scoped-canvas-performance.test.ts tests/project/routed-layout-boundary.test.ts
npm run test:e2e -- tests/e2e/canvas-capacity.spec.ts --project=chromium
npm run build
```

Expected: FAIL until performance instrumentation and build-boundary assertions see the completed lazy worker bundle.

- [x] **Step 3: Fix measured capacity or bundling defects and record evidence**

Make only changes required by measured failures. Keep ELK in the worker; if request/result publication exceeds 50ms, reduce redundant cloning or chunk non-atomic preparation across event-loop turns while retaining one atomic visual publication. Do not move layout to the main thread or relax the 250/500, 3,000ms, 5,000ms, 32,000-point, or 50ms limits.

Write the evidence document with exact commands, machine/runtime context, median and worst warmed worker time, maximum main-thread task, route-point total, base/current initial renderer bytes, base/current total renderer bytes, lazy worker bytes, and native bundle bytes. Explain size changes without setting an arbitrary pass/fail byte delta.

- [ ] **Step 4: Run capacity and production checks**

Run:

```bash
npm test -- tests/performance/canvas-performance.test.ts tests/performance/scoped-canvas-performance.test.ts tests/project/routed-layout-boundary.test.ts
npm run test:e2e -- tests/e2e/canvas-capacity.spec.ts --project=chromium
npm run build
npm run tauri build -- --bundles app,dmg
```

Expected: PASS; the evidence document contains observed values from these runs and the packaged app can arrange with networking disabled.

- [x] **Step 5: Request focused review and commit**

Review measurement validity, warmed/cold distinction, long-task instrumentation, output bounds, asset inspection, offline proof, and recorded byte arithmetic. Resolve validated findings, rerun Step 4, then commit:

```bash
git add tests/performance/canvas-performance.test.ts tests/performance/scoped-canvas-performance.test.ts tests/e2e/canvas-capacity.spec.ts tests/project/routed-layout-boundary.test.ts docs/reviews/2026-09-07-routed-arrange-graph-size-and-performance.md
git commit -m "test: verify routed layout capacity"
```

### Task 11: Update user guidance, run adversarial review, and complete verification

**Files:**
- Modify: `docs/app-guides/dag-dependencies.md`
- Modify: `docs/superpowers/specs/2026-09-07-routed-arrange-graph-design.md`
- Modify: `docs/superpowers/plans/2026-09-07-routed-arrange-graph.md`
- Modify: `src/lib/docs/build-index.test.ts`
- Modify: `tests/project/routed-layout-boundary.test.ts`
- Modify: `src/features/canvas/WorkflowEdge.test.ts` (RG10 metadata on existing behavior test only)
- Create: `docs/reviews/2026-09-07-routed-arrange-graph-code-review-prompt.md`
- Create: `docs/reviews/2026-09-07-routed-arrange-graph-adversarial-code-review.md`

**Interfaces:**

The user guide explains that Arrange Graph lays out only the active root or loop-body canvas, routes dependencies around nodes, saves canvas-only layout metadata, and can be rerun after manual edits. It must not imply that arrangement changes workflow behavior or YAML.

**Current checkpoint:** Steps 1–5 are recorded in the final `docs: verify routed arrange graph` evidence commit. Both reviewers approved corrections through `da22a07` and the frozen documentation delta with zero findings; late verification fixes through `dcb6551` also received clean focused review. Fresh automated verification and unsigned local packaging are recorded below. The exact ordinary packaging command generated artifacts but exited 1 for the unavailable updater private key; signed-package acceptance and manual native offline UAT remain open.

- [x] **Step 1: Add failing documentation and traceability assertions**

Extend the existing docs-index test to require the routed Arrange Graph explanation offline. Add a plan/spec traceability check in `tests/project/routed-layout-boundary.test.ts` that references RG1–RG14 and confirms every ID appears in either a focused unit test description or an E2E/performance test title.

- [x] **Step 2: Run the checks and confirm the expected RED state**

Run:

```bash
npm test -- src/lib/docs/build-index.test.ts tests/project/routed-layout-boundary.test.ts
```

Expected: FAIL because final offline guidance and traceability evidence are not yet present.

- [x] **Step 3: Update documentation and create the adversarial review prompt**

Update the guide, mark the design status `Implemented pending review`, and mark completed plan checkboxes only after their commits exist. Create a reusable review prompt that instructs two independent external reviewers, one Claude and one Codex, to inspect the complete `base...HEAD` diff and verify RG1–RG14, worker isolation, ELK option correctness, geometry math, async races, scope invalidation, persistence bounds, accessibility, offline packaging, and performance evidence. The prompt must require file/line evidence, severity, reproducible failure, and a proposed test; it must reject suggestions for a new layout language, VM, or unrelated canvas feature.

Run the two reviewers in separate subagents using `superpowers:requesting-code-review`. Consolidate duplicate findings in `docs/reviews/2026-09-07-routed-arrange-graph-adversarial-code-review.md`. For every finding, independently reproduce it and record `valid`, `invalid`, or `out of scope` with evidence. Use `superpowers:systematic-debugging` and a new failing test before fixing every valid defect. Request focused re-review after fixes.

- [x] **Step 4: Run complete verification**

Run sequentially against the reviewed implementation HEAD plus the intended uncommitted documentation, traceability tests, and review documents. Preserve unrelated files. The current worktree has five intended tracked modifications and two untracked review deliverables; the final commit follows verification.

```bash
npm run format:check
npm run lint
npm run check
npm run contracts:check
npm run examples:check
npm run resources:verify
npm run test:unit
npm run test:rust
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=webkit
npm run build
npm run tauri build -- --bundles app,dmg
git status --short
```

Expected: Svelte check reports 0 errors and 0 warnings; all unit, Rust, Chromium, and WebKit tests and production build pass. Record the actual exit of every command and preserve the distinction between native artifact generation and updater signing: the known absent updater private key must not be relabeled as successful signing; record the established local `--no-sign` build separately if needed. Git status must list only the intended documentation/test/review changes plus any independently preserved user files before the final commit. Browser/package inspection does not satisfy the manual native offline UAT item.

- [x] **Step 5: Commit final evidence and stop before integration or release**

```bash
git add docs/app-guides/dag-dependencies.md docs/superpowers/specs/2026-09-07-routed-arrange-graph-design.md docs/superpowers/plans/2026-09-07-routed-arrange-graph.md docs/reviews/2026-09-07-routed-arrange-graph-code-review-prompt.md docs/reviews/2026-09-07-routed-arrange-graph-adversarial-code-review.md src/lib/docs/build-index.test.ts tests/project/routed-layout-boundary.test.ts
git commit -m "docs: verify routed arrange graph"
```

Use `superpowers:verification-before-completion` to inspect the final commands and artifacts, then explain the delivered behavior and material limitations in plain language. Do not merge to `base`, change the application version, create a release, or hide the Svelte Flow attribution until the user separately approves those actions. Use `superpowers:finishing-a-development-branch` only after that approval.

## Completion evidence

This records task evidence and the final automated verification gate through implementation HEAD `dcb6551`, followed by the final `docs: verify routed arrange graph` documentation/traceability commit. Each focused review ended with zero open findings. Reports with RED logs and exact commands are under `.superpowers/sdd/2026-09-07-routed-arrange-graph/task-N-report.md`; review corrections are in the same report or separate fix reports. Native manual UAT and signed-release acceptance remain open.

| Task | Commits, including review corrections | Observed RED → final focused GREEN | Focused review findings resolved |
| --- | --- | --- | --- |
| 1 | `b437f78`, `3fe01ab`, `52cbd34` | Missing domain; diagonal/endpoint/prototype/allocation regressions → 47 tests | 4 Important |
| 2 | `58a3166`, `ad312c0` | 27 missing persistence/invalidation behaviors → 90 tests | 1 Minor coverage gap; production already passed the new byte tests |
| 3 | `b8a7c38`, `ecea18c` | Missing client; undeclared fields posted → 15 tests | 1 Important |
| 4 | `3637b4b`, `19821c4` | Missing adapter; actual worker startup and malformed identities failed → 99 focused tests and 3 Chromium worker tests | 1 Important, 1 Minor |
| 5 | `7aa46e3` | Missing projection/path/casing; zero-length path command → 27 tests | 0 findings |
| 6 | `f36b1a4`, `e733222` | Async locks/publication absent; fitted-camera persistence and superseded fit failed → 199 tests and Chromium smoke | 2 Important |
| 7 | `dc487ba`, `e01e665` | Cache activation/invalidation absent; 20 auto-pan publications during held drag → 215 tests | 1 Important |
| 8 | `a0281da`, `13aa885` | Missing emphasis; size/contrast/stacking/cancel defects reproduced → 118 tests and 2 Chromium emphasis tests | 4 Important |
| 9 | `14eb968`, `0786e50` | Showcase routing/caching/focus failed; SVG subdivision oracle missed crossings/coincidence → 67 adapter/worker tests and 34 Chromium/WebKit browser tests | 1 Minor |
| 10 | `3105814`, `01236d5` | Manifest/isolation/capacity failed; emitted/native license notices absent → 253 focused tests and 24 Chromium/WebKit browser tests | 1 Important |
| 11 | `e9a30d1`, `da22a07`, `03d75b7`, `0c6a1c3`, `468dd05`, `dcb6551`; final `docs: verify routed arrange graph` evidence commit | Offline guidance/traceability and independent reviewer regressions confirmed RED; final source passes 2,299 unit, 270 Rust, 201 Chromium, and 198 WebKit tests with 3 documented skips | Claude/Codex original and follow-up reviews approved; late oracle/stale-paint/specificity corrections reviewed clean |

The historical Task 10 complete unit run passed **174 files / 2,287 tests**. Its Svelte/TypeScript check reported **0 errors / 0 warnings**; lint and formatting passed. Native resource verification covered **42 files**, and focused Rust setup verification passed **40 tests**. These historical receipts are preserved separately from Task 11's fresh full verification below.

### Concrete requirement evidence

These file links identify the behavior tests behind the requirement tags. The traceability check parses active test declarations and excludes its own project-test strings; tags alone do not prove test quality or a passing run.

| Requirement | Focused behavior evidence | Broader evidence |
| --- | --- | --- |
| RG1 | `src/features/canvas/layout-graph.test.ts`; `src/lib/layout/routing.test.ts` | `tests/e2e/routed-arrange-graph.spec.ts` |
| RG2 | `src/features/canvas/routed-layout.test.ts`; `src/lib/layout/routing.test.ts` | `tests/e2e/routed-geometry.spec.ts`; `tests/e2e/routed-arrange-graph.spec.ts` |
| RG3 | `src/features/canvas/layout-graph.test.ts` | `tests/e2e/routed-arrange-graph.spec.ts` |
| RG4 | `src/features/canvas/WorkflowEdge.test.ts`; `src/features/canvas/GraphCanvas.test.ts` | `tests/e2e/routed-edge-emphasis.spec.ts`; `tests/e2e/routed-geometry.spec.ts` |
| RG5 | `src/lib/layout/layout-store.test.ts`; `src/features/canvas/GraphCanvas.test.ts` | `tests/e2e/routed-arrange-graph.spec.ts` |
| RG6 | `src/features/canvas/GraphCanvas.test.ts`; `src/features/canvas/GraphCanvas.flow-boundary.test.ts` | `tests/e2e/routed-arrange-graph.spec.ts`; root/scoped performance suites |
| RG7 | `src/lib/layout/place-new-nodes.test.ts`; `src/features/canvas/routed-layout.test.ts`; `src/features/canvas/GraphCanvas.test.ts` | `tests/e2e/loop-group-authoring.spec.ts` |
| RG8 | `src/workers/layout-client.test.ts`; `src/workers/layout-worker.test.ts`; `src/features/canvas/GraphCanvas.test.ts` | `tests/e2e/layout-worker.spec.ts`; `tests/e2e/canvas-capacity.spec.ts`; `tests/e2e/routed-arrange-graph.spec.ts` |
| RG9 | `src/app/App.test.ts`; `tests/performance/canvas-performance.test.ts` | `tests/e2e/routed-arrange-graph.spec.ts` |
| RG10 | `src/features/canvas/WorkflowEdge.test.ts`; `tests/accessibility/keyboard-authoring.test.ts`; `tests/accessibility/reduced-motion.test.ts` | `tests/e2e/routed-edge-emphasis.spec.ts`; `tests/e2e/loop-group-authoring.spec.ts` |
| RG11 | `src/features/canvas/GraphCanvas.test.ts`; `src/lib/layout/place-new-nodes.test.ts` | `tests/e2e/routed-arrange-graph.spec.ts` |
| RG12 | `tests/performance/canvas-performance.test.ts`; `tests/performance/scoped-canvas-performance.test.ts` | `tests/e2e/canvas-capacity.spec.ts` and recorded timings below |
| RG13 | `tests/project/routed-layout-boundary.test.ts`; `tests/installers/release-package.test.ts` | Production assets in `tests/e2e/canvas-capacity.spec.ts`, native payload inspection; packaged WKWebView manual UAT outstanding |
| RG14 | `tests/project/routed-layout-boundary.test.ts` | `tests/e2e/routed-arrange-graph.spec.ts` |

### Capacity and package receipts

The [committed Task 10 evidence](../../reviews/2026-09-07-routed-arrange-graph-size-and-performance.md) includes machine/runtime context, exact commands, fixture identity, raw message counts, byte arithmetic, and SHA-256 values. On its Apple M5 Pro verification host:

- Chromium warmed worker median **973.8ms**, worst **988.8ms**; WebKit median **1,080ms**, worst **1,137ms**. The maximum remains **3,000ms**.
- **2,086 route points**, with four raw responses for four requests, below **32,000** points. The actual fixed-seed 250-node/500-edge YAML is asserted byte-identical to its fixture.
- Maximum observed Chromium renderer task **48.729ms** across **892** samples; no Long Tasks observer entry exceeded **50ms**. WebKit does not claim CDP/Chromium task measurements.
- Two lazy workers total **1,447,302** raw bytes. Compared with the immutable feature base, all renderer JavaScript decreases **13,044** bytes; complete `dist` grows **1,461,521** bytes; native app grows **399,911** bytes; DMG grows **391,144** bytes. Exact bundled ELK notices account for **20,135** raw resource bytes.
- Real production workers execute with external requests blocked. Both worker payloads and notices match native embedded bytes, and all 45 app files match the read-only mounted DMG. The mount was detached.

### Final review and verification evidence

The reusable [Claude/Codex review prompt](../../reviews/2026-09-07-routed-arrange-graph-code-review-prompt.md) and [consolidated validity report](../../reviews/2026-09-07-routed-arrange-graph-adversarial-code-review.md) are prepared. Independent reviewers inspected `566b9d9...01236d5` plus the documented working-tree patch. Their ten IDs consolidate to six valid groups, one invalid group, and two out-of-scope groups. Five product fixes and their failing-first regressions are committed in `e9a30d1`; the remaining valid process issue is corrected by an untracked-aware complete source snapshot and verified restoration before re-review.

Post-fix focused verification passed 267 tests in 12 files and 28 Chromium/WebKit browser tests, with two existing Chromium-only cases skipped in WebKit. Check reported 0 errors / 0 warnings; lint and formatting passed. The unchanged 250/500 capacity gate now proves all 500 accepted routes render: Chromium's worst warmed worker was 986.4ms, maximum Arrange task 47.305ms, and content-edit maximum task 16.932ms; WebKit's worst warmed worker was 1,221ms. Both recorded no path changes during the content-only edit. These are additional focused receipts; the historical Task 10 package-byte table above remains unchanged and does not describe a rebuilt post-fix native artifact.

Both focused reviewers approve the original corrections and uphold all original no-change dispositions. Codex reports zero remaining findings; Claude's two Minor follow-ups were independently reproduced. Design §5.3 and offline guidance now define post-publication interruption, with a failing-first feedback-boundary test. Commit `da22a07` gates measured-footprint carryover by workflow identity and scope topology, with two failing-first delayed-measurement cases proving valid caches survive colliding IDs across navigation. Follow-up verification passes 237 focused tests and four Chromium/WebKit capacity/scope-restoration checks; check, lint, and format pass. The consolidated review and ignored `task-11-followup-report.md` retain exact evidence and measured limits.

Both final focused reviews now approve CLAUDE-R1 and CLAUDE-R2 with **0 Critical / 0 Important / 0 Minor** findings. Codex independently passed 201 tests in five files and four Chromium/WebKit browser checks, with no skips; its fresh maximum Chromium Arrange/content tasks were 48.37ms / 17.99ms, worst warmed workers 1,026.8ms (Chromium) and 1,110ms (WebKit), all 500 routes renderable, and no content-edit path changes. Claude independently checked actual modules, documentation mutation sensitivity, pinned Svelte Flow remeasurement, and complete archive reconstruction; its write-denial sandbox still prevented suite/browser execution. Both verified all 665 source files and 70 artifact hashes. The [consolidated review](../../reviews/2026-09-07-routed-arrange-graph-adversarial-code-review.md#final-focused-approvals) records the exact report hashes and launcher receipt.

Fresh verification at implementation HEAD `dcb65517503226ef47a01eab623ea872777d7ff7` passed format, lint, Svelte/TypeScript check (0 errors / 0 warnings), contracts, examples, 42 bundled resources, **2,299 unit tests in 174 files**, **270 Rust tests** (246 library plus 24 integration), **201/201 Chromium tests**, **198 WebKit tests with three documented skips out of 201**, and `npm run build`. Each automated command exited 0. The [final-source verification record](../../reviews/2026-09-07-routed-arrange-graph-adversarial-code-review.md#final-source-verification-and-rebuilt-native-artifacts) lists exact commands, skip names, rebuilt artifact sizes/hashes, and provenance.

The ordinary `npm run tauri build -- --bundles app,dmg` command rebuilt app/DMG/updater artifacts, then exited 1 solely for unavailable `TAURI_SIGNING_PRIVATE_KEY`. The established local `--no-sign` command exited 0. These post-fix version 2.0.1 artifacts are separate from the unchanged historical Task 10 size table: DMG **6,706,497 bytes**, updater archive **6,805,822 bytes**, and app **18,700 KiB** by `du -sk`. Their existence and local-build success do not establish signing, notarization, installation, or native offline click-through acceptance.

Review acceptance and remaining delivery checks:

- [x] Independent Claude approves committed corrections through `da22a07` plus the frozen documentation delta; zero remaining findings.
- [x] Independent Codex approves the same candidate; zero remaining findings.
- [x] Late full-suite oracle, stale-opacity, and specificity findings independently reproduced, fixed, and reviewed clean through `dcb6551`.
- [x] Full Task 11 verification commands and current packaging evidence, including the ordinary packaging exit 1 and separate unsigned exit 0.
- [x] Final documentation, traceability, and evidence in the `docs: verify routed arrange graph` commit after verification.
- [ ] Task 10 manual packaged macOS WKWebView offline click-through.
- [ ] Updater signing and signed-package acceptance with the required private key.
- [ ] Notarization, installation acceptance, and separately approved integration/version/release work.

Task 11 implementation, review, and automated-verification evidence are complete. Task 10 Step 4 remains unchecked for its manual packaged WKWebView offline click-through; the unavailable updater private key is an explicit signing limitation. Neither browser tests nor `--no-sign` packaging silently satisfy those checks. Integration, version changes, and release remain outside this completed implementation checkpoint and require separate user approval.
