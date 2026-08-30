# Modern workbench redesign verification

- **Verification date:** 2026-08-30 09:01 EDT
- **Branch:** `feat/modern-workbench-redesign`
- **Task 7 base:** `f268786926385bd63c71bca41ae0925da087fe90`
**Release-readiness status:** **NOT CLAIMED** — installed-application gates remain unperformed.

## Result summary

| Gate | Result | Evidence |
|---|---|---|
| Chromium + WebKit renderer E2E | **PASS** | 52/52 Playwright tests passed with one worker after remediation. |
| 250-node/500-edge browser capacity | **PASS** | Both projects rendered exactly 250 nodes and 500 edges. |
| Real large-canvas node drag | **PASS** | Both projects persisted more than an 80-pixel delta on each axis; authoritative YAML stayed byte-for-byte unchanged. |
| Chromium authoring long tasks | **PASS** | No `PerformanceObserver` long-task entry above 50 ms after startup entries were excluded. |
| ResizeObserver-loop rejection | **PASS** | No matching page, console, or window-error message in either capacity run. |
| Local Geist Sans/Mono browser loading | **PASS** | Both faces loaded through `document.fonts`; computed styles on YAML, shortcut, inspector code, status metadata, Example preview, unified diff, and About digest surfaces resolve to bundled Geist Mono; every observed font request used the Playwright application origin. |
| Pointer-frame prohibited-work unit contract | **PASS** | 1,000 moves recorded zero parse, validation, layout, YAML, native, and Git work, followed by one debounced layout save. |
| TypeScript/Svelte, lint, format, contracts, examples, resources, build | **PASS** | Exact command results are below. |
| Full unit command | **PASS** | 115 files and 1,056 tests passed with the isolated Cargo environment available to native-dependent suites. |
| Rust tests | **PASS** | Rust 1.88.0 isolated under `/tmp/workflow-studio-remediation-toolchain-20260830`; 244 library tests and 24 Git integration tests passed. |
| macOS installed-app smoke | **UNPERFORMED** | No native bundle was packaged, installed, or launched during remediation verification. |
| Windows installed-app smoke | **BLOCKED / UNPERFORMED** | No Windows host or built/installed Windows artifact was available. |

## Environment and artifact identity

- Host: macOS 26.5.1 (build 25F80), arm64.
- Node: v24.20.0; npm: 11.19.0.
- Isolated remediation toolchain: Cargo 1.88.0 and rustc 1.88.0 under `/tmp/workflow-studio-remediation-toolchain-20260830`, with `CARGO_HOME`, `RUSTUP_HOME`, and `PATH` set explicitly per command and no user/system Rust configuration changes.
- Playwright: 1.62.0.
- Playwright Chromium: 151.0.7922.34, using the `Desktop Chrome` project profile.
- Playwright WebKit: 26.5, using the `Desktop Safari` project profile.
- Installed Safari version present on the host: 26.5. Safari itself was not used as a native Workflow Studio smoke artifact.
- Production web build: Vite transformed 853 modules. The remediation build's `dist/index.html` SHA-256 was `32cfebdf10c9b8b631c076d0af53564e34538617f71ce3daa37e14f803ccb89b`.
- The web build emitted 11 local Geist/Geist Mono WOFF2 assets.
- The web build emitted the exact upstream Geist Sans and Geist Mono OFL notices under `dist/licenses`; their SHA-256 values are `71609cbb5c78b5870d712eab73a31d76622635c6ed034ab5cee3b9ecbda8685f` and `cc815ed4fc045f0e991abb10395b7932bd028c6a067deb13316d6002105074e6`.
- Native application artifact: none. No `.app`, DMG, or Windows installer was built or installed during this verification.

Playwright WebKit evidence is renderer coverage, not evidence from an installed Tauri application or the operating system's embedded WebView.

## Remediation TDD evidence

### Native resource integrity

The first real Rust run after adding protected-license behavior tests compiled with the isolated toolchain, then failed 12 of 14 focused tests. Valid, tampered, missing, extra, symlinked, and unexpected-directory cases all stopped at `setup_integrity_manifest_invalid`, proving that `docs/licenses/*` was rejected before traversal. After admitting only `docs/licenses/*` and traversing the manifest-derived `docs` subtree, the same command passed 14/14.

Installed-root discovery had a separate RED/GREEN cycle. Its first Rust compile failed with unresolved production import `resolve_installed_resource_root`; after extracting the resolver and requiring `docs/licenses` in both direct and Tauri `_up_` layouts, the focused test passed 1/1. The complete setup suite then exposed that the committed source-tree fixture included non-packaged documentation. Staging the actual Tauri/Node source roots (`brands`, `contracts`, `docs/licenses`, and `examples`) into a real temporary installed-style tree retained fail-closed extra-path behavior and produced 40/40 passing setup tests with an exact 32-file assertion.

### Responsive Inspector focus

The new Chromium and WebKit regression opened the compact Inspector for `prepare`, resized to docked panels, selected `publish`, focused the Inspector, resized back to drawers, and pressed Escape. Both engines failed with expected `command node publish` but received `prompt node prepare`. After clearing historical drawer ownership while docked and assigning resize-created Inspector drawers to the current selection, both engines passed 2/2; the complete layout/style slice passed 30/30.

### Technical typography

The first computed-style run failed in both engines. Existing YAML, shortcut, inspector code, and status surfaces resolved to `Geist Mono Variable`, while Example preview, unified diff, and About digest each resolved exactly to `monospace`. After applying `var(--font-mono)` globally to semantic `pre`, `code`, `kbd`, and `samp` elements, both engines passed 2/2 without changing ordinary input or textarea typography.

## TDD evidence

### RED — missing deterministic large-canvas scenario

```text
$ npx playwright install chromium webkit
PASS (browsers were already present; command produced no output)

$ npx playwright test tests/e2e/canvas-capacity.spec.ts
2 failed
Chromium: expected 250 [data-node-id] elements, received 2.
WebKit: expected 250 [data-node-id] elements, received 2.
```

The failure showed that `scenario=large-canvas` still received the normal two-node release-demo fixture in both engines.

### GREEN — E2E-only fixture and boundary behavior

```text
$ npx playwright test tests/e2e/canvas-capacity.spec.ts
2 passed (4.3s)

$ npm run test:unit -- tests/performance/canvas-performance.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
```

The production runtime bootstrap does not import the performance fixture. Only the Vite `e2e` bootstrap recognizes `scenario=large-canvas`, serves the fixed-seed YAML, and seeds local editor layout metadata for a deterministic real drag.

### RED/GREEN — inherited cross-browser test assumptions

The first complete dual-project run produced 38 passes and two WebKit failures:

- one accessibility assertion called Chromium-only `newCDPSession()`;
- macOS WebKit required Option+Tab, rather than plain Tab, to traverse native buttons under the platform keyboard-navigation behavior.

The accessibility assertion now uses Playwright's cross-browser ARIA snapshot while still requiring a named expanded button. The keyboard test uses the platform-appropriate traversal chord and still requires focus to reach YAML before Space activates it.

```text
$ npx playwright test tests/e2e/workbench-layout.spec.ts --grep "compact Inspector|keyboard-only"
4 passed (Chromium and WebKit)

$ npm run test:e2e
40 passed (40.5s)
```

## Exact automated verification

| Command | Result | Output summary |
|---|---|---|
| `npm run format:check` | **PASS** | All matched files use Prettier code style. |
| `npm run lint` | **PASS** | ESLint completed with no findings. |
| `npm run check` | **PASS** | `svelte-check` found 0 errors and 0 warnings; Node TypeScript check completed. |
| `npm run contracts:check` | **PASS** | Validated bundled authoring contracts. |
| `npm run examples:check` | **PASS** | Validated bundled workflow examples. |
| `npm run resources:verify` | **PASS** | Verified 32 packaged resource files, including both exact upstream font-license notices. |
| `npm run test:unit -- tests/performance tests/accessibility` | **PASS** | 4 files passed; 9 tests passed. |
| `npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1` | **PASS** | 115 files passed; 1,056 tests passed with zero failures or skips. |
| `npm run test:rust` | **PASS** | 244 library tests and 24 real Git integration tests passed; doc-test targets contained no tests. |
| `npm run build` | **PASS with advisory** | Vite built 853 modules in 621 ms. It retained the documented non-blocking warning that `App` exceeds 500 kB after minification. |
| `npm run test:e2e` | **PASS** | Remediation run: 52/52 tests passed across named Chromium and WebKit projects. |
| `git diff --check` | **PASS** | No output. |
| `git diff --check base...HEAD` | **PASS** | Pre-commit branch-wide check produced no output; the post-commit result is recorded in the remediation report. |
| `git status --short` | **PASS as pre-commit evidence** | Listed exactly the seven expected remediation implementation, tests, and verification paths; no unrelated tracked path appeared. |

The existing `npm install` audit reported four advisories (one moderate and three high). Dependency upgrades are outside Task 7 scope and were not attempted.

The controller-required inherited formatter cleanup changed only line wrapping/whitespace in `BrandSettings.svelte`, `DeleteImpactDialog.svelte`, `Inspector.svelte`, `Explorer.svelte`, and `ImportExportDialog.svelte`. The final branch-wide diff gate additionally removed the redesign spec status line's inherited trailing Markdown spaces. None of these mechanical changes alter behavior or prose.

## CI coverage

The renderer E2E job now installs both browser engines with:

```text
npx playwright install --with-deps chromium webkit
```

It then runs the existing `npm run test:e2e`, which executes both named projects.

## Installed-application smoke checks

### macOS arm64 — UNPERFORMED

Host identity and the isolated remediation Rust toolchain were available, but no Workflow Studio artifact was packaged, installed, or launched. Therefore none of the following installed-app observations was performed or marked as passing:

- offline startup;
- local font resolution inside the installed WebView;
- dark/light theme switching;
- 1024×700 layout;
- drawer keyboard behavior;
- compact Canvas/YAML Split switching;
- palette drop;
- node drag and persisted reopen position;
- valid port connection and rejected cycle;
- keyboard-equivalent authoring;
- 200-percent zoom;
- reduced motion;
- absence of ResizeObserver-loop messages in the native WebView.

### Windows — BLOCKED / UNPERFORMED

No Windows host and no built/installed NSIS artifact were available. The same checklist above remains wholly unperformed on Windows.

## Remaining risk

- Native bundle production, installation, first launch, filesystem capabilities, and Tauri WebView integration remain unverified.
- Local font loading is proven in Playwright Chromium and WebKit, but not in installed macOS or Windows application WebViews.
- Native platform keyboard settings, 200-percent zoom, reduced motion, and ResizeObserver behavior still need installed-artifact evidence on macOS and Windows.
- The Vite chunk-size advisory remains non-blocking and unchanged.

These open gates prevent a release-readiness claim.
