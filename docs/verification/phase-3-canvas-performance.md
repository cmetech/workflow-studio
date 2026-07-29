# Phase 3 canvas performance and accessibility evidence

Recorded: 2026-07-29

## Deterministic contract evidence

The Task 9 fixture uses seed `0x24c0ffee` and generates exactly 250 nodes and 500 unique edges. Every edge points from a lower fixture index to a higher fixture index, so the generated graph is acyclic by construction. A repeat generation with the same seed produces identical edges and YAML.

The focused performance, accessibility, and App canvas-authoring gate is:

```text
npm run test:unit -- tests/performance tests/accessibility src/app/App.canvas-authoring.test.ts
Test Files  5 passed (5)
Tests       26 passed (26)
```

The deterministic performance test records this metric snapshot after 1,000 drag pointer moves and one completed drag:

| Metric | After pointer moves | After drag debounce |
| --- | ---: | ---: |
| parse requests | 0 | 0 |
| validation passes | 0 | 0 |
| layouts | 0 | 0 |
| YAML transactions | 0 | 0 |
| native calls | 0 | 0 |
| Git calls | 0 | 0 |
| pointer moves | 1,000 | 1,000 |
| drag completions | 0 | 1 |
| layout saves | 0 | 1 |

The layout save occurs once after the 300 ms debounce. Projection is memoized by analysis/layout/options identity, each node receives a bounded render payload of at most 256 serialized bytes, and 100 selection events publish one final selection update. No node subscribes to global document text. Virtualization was not added because the deterministic 250-node boundary passes with bounded data and the native app opens the fixture.

Workflows at the 250-node/500-edge boundary remain visual. Real App tests open a structurally valid 251-node workflow and a structurally valid 33-node/501-edge DAG through the bundled-contract worker lifecycle. In both cases the exact YAML remains unchanged, the canvas is suppressed, the capacity advisory is non-blocking, YAML mode is active, and the save command completes successfully without dropping nodes, edges, or other content.

## Accessibility evidence

The keyboard-only component test performs the full authoring flow through the real application lifecycle:

1. opens the workflow from Explorer;
2. opens Add Node from the command palette and adds a node;
3. selects a node and creates a dependency edge;
4. uses `Shift+N` to add a second dependent node;
5. attempts a cycle and receives meaningful `aria-live` rejection without changing YAML;
6. opens the inspector, edits the required Node ID field, and saves with the platform `Mod+S` binding.

After the single initial jsdom focus seed, the test reaches every later surface through actual `Tab`, arrow, Enter, character, and command-key input; it does not teleport focus with direct `.focus()` calls. It verifies visible focus across Explorer, canvas, command palette, node picker, node selection, edge targeting, cycle rejection, inspector, and save. Add Node launched from the command palette now returns to the live canvas root instead of retaining a disconnected palette input as its opener. Renaming the selected node migrates selection to the new ID and moves focus to the stable active inspector tab while analysis refreshes. Required fields expose `aria-required="true"`.

The reduced-motion harness changes `prefers-reduced-motion` from false to true and back to false at runtime. It verifies `data-motion` and transition-class updates in both directions, confirms keyboard viewport focus remains instant, and proves the exact media-query listener is removed at unmount. Under the reduced preference, animation and transition durations are disabled.

## Fix-round verification gate

```text
npm run contracts:check
Validated bundled authoring contracts.

npm run examples:check
Validated bundled workflow examples.

npm run check
svelte-check found 0 errors and 0 warnings

npm run verify
format: PASS
lint: PASS
Svelte/TypeScript check: 0 errors, 0 warnings
unit: 80 files, 598 tests passed
Rust: 66 tests passed

npm run build
PASS — 4,382 modules transformed
```

The build retains the existing non-blocking warning for a minified chunk above 500 kB.

## Native reference launch

Command:

```text
npm run tauri -- dev -- -- -- <absolute-path>/fixed-250-node-workflow.yaml
```

Observed launch facts:

- Platform: macOS 26.5 (25F71), Darwin 25.5.0, arm64.
- Hardware: Apple M3 Ultra, 96 GiB RAM, 60-core integrated GPU.
- Displays: three 6016×3384 displays, scaled to 3008×1692 at 60 Hz.
- Native host: Tauri CLI 2.11.4; Rust 1.95.0.
- WebView: system WebKit framework version 21624; installed Safari/WebKit release 26.5.
- Fixture: 90,734 bytes, 250 node declarations, and 500 dependency declarations.
- Startup completed and created the native window. The app's native persistence recorded the fixture workspace, visual editor mode, its definition hash, and positions for all 250 nodes.

### Native interaction limitation

Zoom, pan, drag responsiveness and Web Inspector long tasks above 50 ms were **not observed** in this agent session. The native window launched, but macOS Screen Recording and Accessibility access were not available. Both a full-screen capture attempt and System Events window/UI queries stalled at that permission boundary and were terminated. No Web Inspector or native GUI automation channel was available, so this report does not infer frame rate, responsiveness, or long-task counts from the successful launch.

The deterministic tests above remain the automated performance authority. A human with access to the native window and Web Inspector must complete the perceptual zoom/pan/drag and >50 ms long-task observation before release-reference acceptance is claimed.
