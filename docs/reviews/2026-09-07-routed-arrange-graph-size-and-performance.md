# Routed Arrange Graph size and performance evidence

Date: 2026-09-07. Feature: `feat/routed-arrange-graph`. Task 10 starts at `0786e5023c38347d43302a99477ec1917ff8bb19`. This evidence covers the Task 10 source committed with this document; final whole-branch verification remains Task 11.

## Host and method

The verification host is an Apple M5 Pro MacBook Pro, arm64, 64 GiB RAM (`68,719,476,736` bytes), macOS 26.5.1 / Darwin 25.5.0. Tools: Node 24.20.0, npm 11.19.0, Rust 1.98.0, Playwright 1.62.0, Chromium 151.0.7922.34, WebKit 26.5, Vite 8.1.5, and exact `elkjs@0.12.0`.

The Arrange benchmark imports the existing `createLargeWorkflowFixture()` with seed `0x24c0ffee` and asserts byte equality of the opened YAML. It has 250 nodes, 500 unique forward dependencies, a full chain, and additional seeded long-range edges. The older `large-canvas` E2E scenario is a different, simpler topology used for existing editing/dragging tests; its times are not the fixed-seed Arrange acceptance evidence.

Four explicit Arrange requests use one actual browser layout worker and its locally bundled ELK descendant. Run 0 is cold; runs 1–3 are warmed. The worker's `durationMs` includes request validation, the preliminary port-ordering pass, final routing, any spacing retry, and geometry validation. The independent round-trip measurement spans `postMessage` to the raw result message. Raw messages are counted separately from UI completion; exactly four requests and four responses occur. Each accepted result has 2,086 route points, below the unchanged 32,000-point limit.

Chromium's Long Tasks observer runs during measurement, request construction, publication, fitting, and completion. A separate CDP `toplevel` trace records complete `ThreadControllerImpl::RunTask` durations for `CrRendererMain`; the test requires actual trace samples and also checks their maximum against 50 ms. DOM snapshot tracing is disabled because it contaminates renderer measurements. WebKit runs the functional/worker assertions but does not claim Chromium Long Tasks or CDP evidence.

## Observed acceptance run

Command:

```sh
WORKFLOW_STUDIO_E2E_PORT=1480 npm run test:e2e -- tests/e2e/canvas-capacity.spec.ts tests/e2e/routed-arrange-graph.spec.ts tests/e2e/routed-geometry.spec.ts --project=chromium --project=webkit
```

Chromium evidence, milliseconds:

| Measure | Cold | Warm 1 | Warm 2 | Warm 3 |
| --- | ---: | ---: | ---: | ---: |
| Complete worker duration | 1,289.5 | 981.0 | 960.8 | 956.6 |
| Raw message round trip | 1,306.6 | 981.8 | 961.6 | 957.3 |

Warmed worker median: **960.8 ms**; worst: **981.0 ms**, versus the unchanged **3,000 ms** requirement. Maximum observed renderer task: **48.684 ms** across **890** traced tasks, versus **50 ms**. No observer long task exceeded 50 ms. Timings are host-specific measurements, not a guarantee for every machine or every possible 250/500 graph.

The capacity browser tests also prove the real 5,000 ms default timeout, preserve positions/viewport/selection on timeout, observe worker termination, and successfully Arrange with a replacement worker. Existing root and loop-body 1,000-pointer-move tests retain zero parse, validation, layout, YAML transaction, Git/native work, and persistence during movement. A new component regression cancels a partial measurement batch without posting a request or persisting anything.

The same 24-test matrix passed in Chromium and WebKit (24/24 total). WebKit observed cold 1,413 ms and warmed 1,117 / 1,068 / 1,047 ms (median 1,068 ms, worst 1,117 ms), with the same 2,086 points.

Raw browser evidence is attached as `arrange-capacity.json` in the Playwright test output and copied to the ignored Task 10 evidence directory during execution.

## Measured defects and fixes

1. The original fixed-seed request exceeded the 5-second browser timeout. A direct real-ELK run took approximately 10,054 ms. ELK's own stage logging attributed most of the cost to sorting long-edge dummy chains under `NODES_AND_EDGES`. Retaining explicit sorted nodes/edges/ports and fixed seeds while setting model-order consideration to `NODES` and `thoroughness` to `1` brings the complete two-pass request within budget. Both internal spacing profiles share these settings. No geometry acceptance rule or hard limit changed; all reviewed zero-crossing showcase and routing-fixture assertions still pass.
2. Mounting every offscreen card and edge at once produced 55–61 ms renderer tasks. Arrange now measures offscreen cards in batches of 40, keeps the full bound topology and existing visible connections, and restores visibility/culling before the worker result is published. Cancellation restores temporary visibility. Final positions and routes still publish together once.
3. Geometry validation repeatedly allocated right-route segments and expanded node rectangles inside edge-pair loops. Caching each once per validation call removed redundant allocation without changing intersection, coincident-lane, crossing, or boundary semantics. The actual fixed-seed publication initially reproduced 51–52 ms tasks before this additional allocation fix.
4. Three renderer consumers imported canvas dimension constants through the ELK adapter, retaining its option metadata in the App asset. They now import the existing constants directly from `types.ts`. ELK engine identifiers remain confined to the two lazy worker assets.
5. Production builds now emit Vite's manifest so the asset boundary test can inspect the actual entry/import closure. No additional runtime loader or network dependency was introduced.

## Exact byte comparison

Base is commit `566b9d991399bcf874b02110d68ab1435c26a872`, extracted with `git archive` into an independent temporary directory. It was built with its own lockfile and native target directory; no shared checkout was switched or modified. Both native candidates retain application version 2.0.1 because this task does not make a release.

Commands in each candidate directory:

```sh
npm ci --ignore-scripts                  # base extraction only
npm run build
npm run tauri build -- --bundles app,dmg --no-sign
```

A separate `npm run build -- --manifest` in the base extraction obtains its import closure. That measurement-only base manifest is excluded from base `dist` totals because the actual base production build did not emit it. The current build's 5,088-byte manifest is included because it now ships normally. All byte counts are uncompressed logical file lengths (`stat.size`), not filesystem allocation, unless a row explicitly says compressed. The bootstrap entry is separate from the dynamically loaded App chunk; total renderer JS includes every non-worker JavaScript chunk.

| Artifact / measure | Base bytes | Current bytes | Difference |
| --- | ---: | ---: | ---: |
| Bootstrap entry/static-import JS closure | 2,866 | 2,866 | 0 |
| Main App JavaScript chunk | 2,585,101 | 2,571,977 | −13,124 |
| All renderer JavaScript, excluding workers | 2,826,831 | 2,813,787 | −13,044 |
| Existing document worker | 635,744 | 635,744 | 0 |
| Lazy layout/validation worker | 0 | 20,828 | +20,828 |
| Lazy ELK algorithm worker | 0 | 1,426,474 | +1,426,474 |
| All CSS | 114,128 | 116,168 | +2,040 |
| Complete production `dist` | 3,749,434 | 5,190,820 | +1,441,386 |
| Native app contents, 43 regular files | 18,596,956 | 18,960,220 | +363,264 |
| Native executable | 17,724,816 | 18,088,080 | +363,264 |
| DMG | 6,314,730 | 6,691,399 | +376,669 |

The raw renderer arithmetic is exact:

```text
−13,044 renderer JS + 20,828 layout worker + 1,426,474 algorithm worker
+ 2,040 CSS + 5,088 manifest = +1,441,386 total dist bytes
```

Fonts, the document worker, index HTML, and other assets are unchanged. The app embeds compressed frontend assets, explaining why its increase is much smaller than raw `dist`. Both Vite candidates emit the existing large-App-chunk warning; no arbitrary byte-growth threshold was used to waive a performance limit.

Base DMG SHA-256: `402ad7017067ff8c8a3450227cdc6ed97f543b55d2adcaa0f3ed8d9d840e3c05`.

Current DMG SHA-256: `79140aaa652f5a4e44704bc95e32a6c7e793e544e1995d479428221c0a717df5`.

## Offline and native package boundary

`tests/project/routed-layout-boundary.test.ts` builds the real production renderer into a fresh temporary directory. It checks the manifest's initial static-import closure, keeps algorithm implementation identifiers in the descendant worker only, excludes ELK metadata from all renderer chunks, verifies the outer-to-descendant asset link, rejects external executable import/worker/CSS resource URLs, verifies the pinned dependency/removal of Dagre, and rejects attribution hiding. Inert documentation, schema, and license URLs remain legitimate offline text.

The browser production-assets test builds the complete application, serves only the exact emitted outer and descendant worker files from a local origin, blocks external requests, and completes the seeded 250/500 request with no external attempts. It makes no development-worker substitution or source rewrite. This demonstrates that Arrange needs only local bundled files; localhost transport is a browser-test substitute for Tauri's application asset protocol.

Native inspection verifies each emitted worker byte-for-byte against a Brotli-decompressed Tauri codegen asset and confirms the compressed payload physically exists in the packaged executable:

| Emitted asset | Source bytes | Embedded compressed bytes | Source SHA-256 |
| --- | ---: | ---: | --- |
| `layout-worker-Bk-P3caT.js` | 20,828 | 6,804 | `6764674da696a4fe081dc3cc7499652dfaa9dc5a59bb7d087af7f2ee9edd131c` |
| `elk-engine-worker-Csg8cUd2.js` | 1,426,474 | 369,797 | `7bbf686d45d9d4624f567ff7f2a27e43635780c1f7cbe3c5b895dc70e9ff418c` |

The current DMG was mounted read-only without opening the app; its complete 43-file app tree matched the built `.app` by per-file SHA-256. It was detached after inspection.

The exact requested `npm run tauri build -- --bundles app,dmg` produced the app and DMG, then exited 1 at updater signing: “A public key has been found, but no private key.” The established local `--no-sign` variant subsequently completed with exit 0. These are unsigned local arm64 build artifacts; no release publication, notarization, updater signature, installation, or other-platform acceptance is claimed.

There is no callable macOS packaged-WebView automation driver in this environment (`tauri-driver` is absent). Therefore automated clicking of Arrange inside the installed/packaged WKWebView with operating-system networking disabled remains an explicit native UAT limitation. Browser local-asset execution and native payload inspection must not be described as that completed manual test.

## Verification commands

```sh
npm test -- tests/performance/canvas-performance.test.ts tests/performance/scoped-canvas-performance.test.ts src/features/canvas/GraphCanvas.test.ts src/features/canvas/layout-graph.test.ts src/features/canvas/routed-layout.test.ts tests/project/routed-layout-boundary.test.ts
npm run check
npm run lint
npm run format:check
npm run build
npm run tauri build -- --bundles app,dmg --no-sign
```

Focused verification: 225 tests across six files; full unit verification: 2,284 tests across 174 files; Svelte/TypeScript reports zero errors and zero warnings. Complete branch review, release gates, and any final documentation changes remain Task 11.
