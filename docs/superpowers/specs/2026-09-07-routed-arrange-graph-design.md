# Routed Arrange Graph Design

**Status:** Approved direction; design awaiting user review  
**Date:** 2026-09-07  
**Branch:** `feat/routed-arrange-graph`  
**Base:** `566b9d991399bcf874b02110d68ab1435c26a872` (`base`, local v2.0.1 evidence commit)

## 1. Problem and observed cause

Workflow Studio currently uses Dagre only to position nodes when a user invokes **Arrange Graph**. The adapter in `src/features/canvas/layout-graph.ts` gives Dagre fixed node dimensions, runs the layout, and returns only node coordinates. Dagre's edge geometry is discarded. `src/features/canvas/WorkflowEdge.svelte` then derives every displayed connection independently from its source and target coordinates with Svelte Flow's generic `getSmoothStepPath` helper.

That separation prevents Arrange Graph from guaranteeing a clean diagram:

- every dependency leaving one node starts at the same centered source handle;
- every dependency entering one node ends at the same centered target handle;
- long dependencies spanning multiple ranks do not know that intermediate nodes are obstacles;
- parallel and crossing dependencies do not know about one another; and
- increasing Dagre's node spacing changes available room but does not create routed lanes.

The `loop-group-showcase.yaml` example exposes all of these cases. Its root graph has seven nodes and eleven edges, including long dependencies from `load-brief` and `planning-cycle`. Its two loop bodies include fan-out and fan-in nodes with as many as three outgoing dependencies.

The small **Svelte Flow** box in the canvas is the library's default attribution. It is unrelated to layout quality. This amendment leaves it in place unless a later product/licensing decision authorizes hiding it. Svelte Flow Pro is not required for the routed layout implementation.

## 2. Goals

1. Make Arrange Graph produce a deterministic left-to-right diagram whose connections avoid unrelated nodes.
2. Lay out nodes and route edges as one operation so the two geometries cannot disagree.
3. Give fan-out and fan-in dependencies distinct, readable lanes and attachment points.
4. Minimize crossings and make any unavoidable crossings visually unambiguous.
5. Preserve manual node placement until the user explicitly invokes Arrange Graph again.
6. Preserve independent root and loop-group layouts, selection, focus, viewport, and panel state.
7. Keep layout and routing metadata outside workflow YAML.
8. Keep pointer-move frames free of layout work, persistence, parsing, validation, Git queries, and native I/O.
9. Remain responsive at the existing 250-node/500-edge visual capacity.
10. Preserve keyboard access, forced-colors behavior, reduced motion, edge selection, and edge deletion.

## 3. Non-goals

- Do not change workflow YAML, dependency semantics, Hermes contracts, graph validation, or execution behavior.
- Do not continuously reposition nodes while the user edits or drags them.
- Do not promise zero edge crossings for arbitrary DAGs; some graphs are non-planar.
- Do not add arbitrary persisted canvas groups. Hermes `loop_group` remains a semantic nested scope opened on its own canvas.
- Do not replace Svelte Flow as the interaction and rendering framework.
- Do not purchase or incorporate Svelte Flow Pro examples as a prerequisite.
- Do not hide the Svelte Flow attribution without a separate licensing/product decision.
- Do not run ELK during document analysis, scope navigation, or pointer movement.

## 4. Options considered

### 4.1 Increase Dagre spacing

Changing `ranksep` and `nodesep` would reduce some congestion. It would not stop long edges from crossing nodes or distinguish edges that share the same generic path. This is insufficient.

### 4.2 Retain Dagre and build an obstacle router

A custom Manhattan router could use the existing node positions and allocate its own lanes. It would require a new pathfinding, crossing, port-allocation, and failure-handling subsystem. That duplicates mature graph-layout work and creates an unnecessary maintenance burden.

### 4.3 Use ELK Layered for placement and routing

This is the selected approach. ELK Layered is designed for directed node-link diagrams, supports orthogonal routing and explicit ports, and minimizes crossings while arranging nodes in ranks. One result contains both node coordinates and edge sections, allowing Workflow Studio to render the geometry ELK actually evaluated.

## 5. User experience

### 5.1 Arrange Graph

Arrange Graph remains an explicit command. Invoking it:

1. disables a second arrangement request for the active scope;
2. announces `Arranging graph…` through the existing authoring feedback/status path;
3. sends one immutable layout request for the active root or loop-group scope to a dedicated worker;
4. keeps the current diagram visible and interactive for pan, zoom, and selection while temporarily disabling node dragging, connection changes, and topology mutations;
5. atomically applies node positions and routed edges only after the complete response is current and valid;
6. fits the completed graph into the viewport without animation when reduced motion is requested; and
7. persists the active scope's node positions and routed-edge cache through the existing layout persistence queue.

On success, focus remains on the Arrange Graph command and the application announces `Graph arranged: N nodes and M dependencies.` No YAML edit, undo entry, dirty-document transition, or file save occurs.

### 5.2 Manual edits

Dragging a node continues to update its incident connections cheaply during pointer movement. It never starts ELK. At drag start, the active scope's persisted routed-edge cache is treated as stale and the canvas uses the current smooth-step edge preview. Drag completion persists the manual positions with no route cache.

Adding, deleting, duplicating, renaming, or reconnecting nodes and dependencies invalidates the active scope's route cache when its graph fingerprint changes. Content-only YAML edits that do not affect node identity, dimensions, dependency topology, or positions retain the arranged routes.

The next explicit Arrange Graph invocation creates a new clean layout. Root and loop-group scopes invalidate and arrange independently.

### 5.3 Layout failure

A worker error, timeout, malformed result, stale response, or route-quality failure leaves the current node positions, routes, selection, and viewport unchanged. The command becomes available again and the application reports `Arrange Graph could not produce a safe routed layout. Your current layout was preserved.` Technical details may be logged locally, but raw worker errors do not replace user-facing copy.

## 6. Layout engine boundary

### 6.1 Dedicated worker

Add a canvas-layout worker with the same narrow request/client discipline used by the document-analysis worker:

- `src/workers/layout-worker-protocol.ts` defines serializable request, success, and failure messages.
- `src/workers/layout-worker.ts` owns the ELK instance and validates every request before calling it.
- `src/workers/layout-client.ts` owns request identity, stale-response rejection, error handling, timeout, and termination.
- `src/features/canvas/layout-graph.ts` becomes the pure conversion and result-validation boundary rather than calling Dagre synchronously.

The worker is created lazily on the first Arrange Graph invocation. The ELK worker asset and all configuration are bundled with Workflow Studio so arranging remains fully offline. There is one in-flight request per client. A newer request supersedes an older one, and leaving a workflow or destroying the canvas prevents its response from publishing.

Each request carries:

- request ID;
- workflow identity and pair generation;
- scope key;
- graph fingerprint covering the engine version, topology, definition order, and measured node dimensions;
- active layout revision;
- ordered nodes with exact rendered width and height; and
- ordered binary dependency edges.

Each success carries the same identity plus node positions, complete routed-edge sections, bounds, and measured worker duration. Responses apply only when every identity field still matches the active projection.

### 6.2 Stable ELK input

The initial ELK configuration is versioned as `elk-layered-orthogonal-v1`:

| Concern | Configuration |
| --- | --- |
| Algorithm | `org.eclipse.elk.layered` |
| Direction | `RIGHT` |
| Edge routing | `ORTHOGONAL` |
| Node dimensions | Exact dimensions measured by Svelte Flow; 216 × 104 remains the minimum card footprint |
| Port constraints | `FIXED_ORDER`, with incoming ports on `WEST` and outgoing ports on `EAST` |
| Model order | Prefer YAML definition order when it does not add crossings |
| Port order | Stable dependency order, then edge ID |
| Node spacing | 64 px within a layer |
| Layer spacing | 136 px between node ranks |
| Edge-to-node spacing | At least 24 px |
| Edge-to-edge spacing | At least 14 px |
| Graph padding | 32 px |
| Random seed | Fixed |

Projection definition order is an explicit input. IDs break ties so repeated arrangements of identical content return byte-equivalent results. The configuration version is part of the fingerprint; future tuning intentionally invalidates older route caches.

Arrange waits until every active node has a finite measured width and height. It does not substitute the minimum height for a taller loop-group or issue-bearing card. If measurements are not ready after the next rendered frame, the request fails safely and preserves the current layout.

Every dependency receives a stable source and target port. ELK may distribute these ports along the correct side of the node, preventing three fan-out edges from occupying the same centerline. The existing large centered handles remain the pointer targets for creating a dependency. Published dependencies render from their computed visual ports, so readable edge endpoints do not make connection gestures smaller.

After routed Arrange Graph passes all acceptance tests, remove `@dagrejs/dagre` and the synchronous Dagre execution path. Workflow Studio keeps one automatic arrangement authority rather than shipping two layout engines.

## 7. Routed geometry and rendering

### 7.1 Route model

Introduce a renderer-owned route model:

```ts
interface EdgeRoutePointV1 {
  readonly x: number
  readonly y: number
}

interface EdgeRouteV1 {
  readonly edgeId: string
  readonly points: readonly EdgeRoutePointV1[]
}

interface ScopeRoutingV1 {
  readonly schemaVersion: 1
  readonly engine: 'elk-layered-orthogonal-v1'
  readonly fingerprint: string
  readonly routes: Readonly<Record<string, EdgeRouteV1>>
}
```

An accepted ELK edge must resolve to one continuous source-to-target point sequence. Consecutive duplicate points are removed. Collinear intermediate points are collapsed. Routes remain orthogonal after normalization.

`CanvasEdgeData` gains an optional validated route. `WorkflowEdge.svelte` renders that route with a small corner radius. When no valid route is available, it retains the existing smooth-step path so saved manual layouts and in-progress node drags continue to work.

### 7.2 Visual separation

Every normal edge gains a canvas-colored casing below its semantic stroke. At a crossing, the upper edge therefore appears to bridge cleanly across the lower edge instead of merging with it. Selected and keyboard-focused edges keep the existing two-color accessible treatment above the casing.

Hovering or selecting an edge raises it above ordinary edges and emphasizes its source and target nodes. Other edges remain visible at reduced emphasis. This interaction supplements routing for dense graphs where some crossings cannot be eliminated.

Arrowheads remain visible and use the same semantic edge color. Stale, read-only, selected, hover, focus, forced-colors, and reduced-motion states must remain distinguishable.

## 8. Route validation and safe publication

Workflow Studio validates ELK output rather than trusting it blindly. A result is publishable only when:

1. it contains exactly one finite position for every requested node and no unknown node;
2. node rectangles do not overlap and remain inside the coordinate bound already accepted for layout state;
3. it contains exactly one route for every requested edge and no unknown edge;
4. every route has between 2 and 64 normalized points;
5. every segment is horizontal or vertical;
6. the first and last points terminate on the correct source and target boundaries;
7. no segment enters an unrelated node rectangle expanded by the edge-to-node clearance;
8. separate routes do not contain long coincident segments outside a short endpoint fan zone; and
9. graph bounds, total point count, and serialized size remain bounded for 250 nodes and 500 edges.

Crossing count is recorded as a quality metric rather than a universal pass/fail condition. The fixture corpus establishes maximum crossing counts for representative fan-out, fan-in, diamond, long-edge, disconnected, and nested-scope graphs. A regression above those reviewed baselines fails tests.

If the first ELK result violates node-clearance or coincident-segment rules, the worker may retry once with the versioned expanded-spacing profile. If that result also fails, nothing is published. There is no unbounded retry or silent partial routing.

## 9. Persistence and invalidation

`ScopeLayoutV1` gains an optional `routing?: ScopeRoutingV1`. This is an additive field inside the existing layout record version 2. Older records omit it and remain valid. Older application builds ignore it. Sanitization applies the same finite-coordinate rules used for node positions plus the route-count and point-count limits above.

The routing fingerprint covers:

- routing engine/configuration version;
- scope key;
- nodes in definition order with IDs and rendered dimensions;
- sorted edge IDs with source and target IDs; and
- the complete arranged node-position record.

The canvas uses persisted routes only when the fingerprint recomputed from the active projection and positions matches exactly. Any mismatch discards the complete scope route set; it never mixes old and new routes.

Manual drag, accepted topology change, node-dimension change, route sanitizer rejection, or engine-version change clears routing for that scope in the same layout publication that changes positions or projection. Navigating between scopes, changing selection, changing panels, editing node content, and changing the viewport do not clear valid routes.

Routing is derived application state. It never enters YAML, workflow hashes, Git changes, save/export eligibility, or Hermes execution input.

## 10. Performance and resource limits

- ELK runs only in its dedicated worker and only after an explicit Arrange Graph request.
- No ELK module is imported into the initial renderer path; its worker is loaded lazily.
- Pointer-move metrics must continue to report zero layouts, persistence calls, parsing, validation, Git queries, native calls, and file operations.
- Request construction and result publication on the main thread must not create a Chromium long task above the existing 50 ms threshold at 250 nodes and 500 edges.
- A warmed worker must complete the reviewed 250-node/500-edge layered fixture within 3 seconds on the release verification host. The threshold is deliberately generous enough for stable CI and strict enough for an explicit user command.
- One request contains at most 250 nodes, 500 edges, 32,000 route points, and the existing coordinate bounds. Larger projections remain YAML-only under the current canvas contract.
- Worker timeout is 5 seconds. Timeout terminates and replaces the worker before a later request.

The implementation plan must include a dependency-size measurement for `elkjs`, the worker asset, and the final renderer/native bundles. Size growth is recorded as evidence; it does not justify moving layout onto the main thread.

## 11. Accessibility and feedback

- Arrange Graph retains its command-registry label, keyboard access, and placement in the More menu.
- Busy state is programmatic and does not move focus.
- Completion and failure messages use a polite live region.
- Edge casing must not reduce semantic contrast or obscure focus indicators.
- Edge hover has an equivalent keyboard-focus presentation.
- Connected-node emphasis cannot be the only indication of edge selection.
- Forced-colors mode uses system colors for the route, casing separation, arrow, and focus treatment.
- Reduced motion disables fit-view and route-transition animation.
- Screen-reader edge labels remain `Dependency from SOURCE to TARGET`, independent of route shape.

## 12. Attribution and Pro policy

The default Svelte Flow attribution remains visible in this amendment. The library exposes `proOptions.hideAttribution`, but hiding it is a product and licensing decision, not a routing feature.

Svelte Flow's current public guidance says personal projects may remove the attribution and asks organizational or revenue-producing users to keep it or support the project. Its Pro offering includes attribution removal, advanced examples, and support. Workflow Studio does not need Pro code for this design: Svelte Flow publishes a free ELK integration example, and ELK computes the routed geometry independently of Svelte Flow.

If the user later authorizes attribution removal, that change must record the applicable subscription, sponsorship, or personal-project basis and receive its own small design/release check. Dynamic visual grouping likewise remains a separate feature because arbitrary canvas groups do not correspond to Hermes workflow syntax.

References:

- <https://svelteflow.dev/learn/layouting/overview>
- <https://svelteflow.dev/examples/layout/elkjs>
- <https://svelteflow.dev/learn/customization/handles>
- <https://svelteflow.dev/learn/troubleshooting/remove-attribution>
- <https://svelteflow.dev/pro>
- <https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html>
- <https://github.com/kieler/elkjs>

## 13. Requirements-to-tests matrix

| ID | Requirement | Focused verification | Broader verification |
| --- | --- | --- | --- |
| RG1 | Arrange returns deterministic left-to-right node positions and complete orthogonal routes. | Layout conversion and worker tests with reversed input order | Chromium/WebKit arrange test on root and both showcase loop scopes |
| RG2 | No arranged route crosses an unrelated node or contains a long unintended coincident segment. | Geometry validator fixtures and property tests | Pixel-independent DOM/SVG geometry assertions on showcase and adversarial graphs |
| RG3 | Fan-out and fan-in edges receive stable distinct ports and lanes. | Port allocation fixtures for 1–16 incident edges | Showcase visual geometry test |
| RG4 | Unavoidable crossings remain readable through edge casing and selection emphasis. | Edge component style and state tests | Chromium/WebKit computed-style and interaction tests |
| RG5 | Arrange publishes positions and routes atomically and persists them per scope. | Layout store, sanitizer, clone, and GraphCanvas tests | Reopen root/body scopes and compare exact SVG paths |
| RG6 | Manual dragging invalidates routes without running ELK during pointer movement. | Drag and metric tests | Real pointer drag followed by reopen and Arrange |
| RG7 | Topology changes invalidate only the affected scope; content and selection changes preserve routes. | Workflow-layout reconciliation tests | Root/body mutation and navigation test |
| RG8 | Stale, failed, timed-out, oversized, and malformed worker results preserve the current layout. | Protocol/client race and failure tests | App feedback and recovery test |
| RG9 | Arrange does not alter YAML, undo history, save state, or Git state. | Controller/App integration assertions | Real workflow byte comparison before and after Arrange |
| RG10 | Edge selection, deletion, labels, focus, stale/read-only states, reduced motion, and forced colors remain correct. | WorkflowEdge, GraphCanvas, and accessibility tests | Chromium/WebKit keyboard and forced-colors tests |
| RG11 | Root and loop-group route caches remain independent across navigation and reopen. | Scoped layout/store tests | `loop-group-showcase.yaml` round-trip test |
| RG12 | 250-node/500-edge Arrange meets worker and main-thread budgets. | Deterministic worker benchmark and bounded-output test | Existing capacity E2E extended with explicit Arrange |
| RG13 | ELK and its worker are available offline in installed packages. | Production-build asset and package-boundary tests | Unsigned native package inspection |
| RG14 | Attribution behavior is unchanged unless separately authorized. | GraphCanvas boundary assertion | Production renderer containment check |

## 14. Acceptance scenarios

### 14.1 Showcase root

Arrange the seven-node root of `loop-group-showcase.yaml`. `load-brief` fans out cleanly, long edges route around `inspect-workspace` and both loop-group nodes, every dependency remains individually traceable, and no line enters another node.

### 14.2 Planning loop body

Arrange the four-node planning body. The three edges leaving `draft-plan` use distinct lanes, the join at `review-plan` is readable, and the long dependency into `publish-plan` avoids both intervening nodes.

### 14.3 Implementation loop body

Arrange the six-node implementation body. `unit-tests` and `accessibility-check` form a balanced parallel branch, their join at `validate-change` is clear, and the direct `implement-change` to `iteration-summary` edge does not cross either branch node.

### 14.4 Manual override

Drag one arranged node. Nodes remain where the user places them, edges follow using the live preview, no worker request occurs, and only that scope's saved route cache is removed. Arrange Graph restores a clean routed layout on demand.

### 14.5 Dense capacity graph

Arrange a deterministic 250-node/500-edge fixture. The UI remains responsive, the request is bounded, the worker completes within the accepted budget, the result passes geometry validation, and no layout work occurs in pointer frames.

## 15. Delivery sequence

1. Freeze current Dagre and smooth-step behavior in failing routed-layout tests.
2. Introduce route types, bounds, normalization, geometry validation, and optional layout persistence.
3. Add the layout worker protocol/client with stale-response and timeout behavior.
4. Integrate pinned `elkjs` layered orthogonal layout and stable ports.
5. Render routed paths, casing, hover/focus emphasis, and fallback previews.
6. Make Arrange Graph asynchronous and atomic with accessible status feedback.
7. Add root, loop-body, manual-drag, failure, persistence, accessibility, and capacity coverage.
8. Verify production and native bundles remain offline and record dependency-size impact.
9. Perform focused code review followed by full release verification.
