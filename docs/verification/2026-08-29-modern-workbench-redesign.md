# Modern workbench redesign verification

- **Verification date:** 2026-08-30 02:45 EDT
- **Branch:** `feat/modern-workbench-redesign`
- **Task 7 base:** `f268786926385bd63c71bca41ae0925da087fe90`
**Release-readiness status:** **NOT CLAIMED** — Rust/native and installed-application gates remain unpassed.

## Result summary

| Gate | Result | Evidence |
|---|---|---|
| Chromium + WebKit renderer E2E | **PASS** | 40/40 Playwright tests passed with one worker. |
| 250-node/500-edge browser capacity | **PASS** | Both projects rendered exactly 250 nodes and 500 edges. |
| Real large-canvas node drag | **PASS** | Both projects persisted more than an 80-pixel delta on each axis; authoritative YAML stayed byte-for-byte unchanged. |
| Chromium authoring long tasks | **PASS** | No `PerformanceObserver` long-task entry above 50 ms after startup entries were excluded. |
| ResizeObserver-loop rejection | **PASS** | No matching page, console, or window-error message in either capacity run. |
| Local Geist Sans/Mono browser loading | **PASS** | Both faces loaded through `document.fonts`; every observed font request used the Playwright application origin. |
| Pointer-frame prohibited-work unit contract | **PASS** | 1,000 moves recorded zero parse, validation, layout, YAML, native, and Git work, followed by one debounced layout save. |
| TypeScript/Svelte, lint, format, contracts, examples, resources, build | **PASS** | Exact command results are below. |
| Full unit command | **FAIL** | 114 files passed; one native-dependent suite failed because `cargo` is absent. |
| Rust tests | **FAIL / unavailable** | `sh: cargo: command not found`. |
| macOS installed-app smoke | **BLOCKED / UNPERFORMED** | No native bundle could be built or installed without Cargo. |
| Windows installed-app smoke | **BLOCKED / UNPERFORMED** | No Windows host or built/installed Windows artifact was available. |

## Environment and artifact identity

- Host: macOS 26.5.1 (build 25F80), arm64.
- Node: v24.20.0; npm: 11.19.0.
- Playwright: 1.62.0.
- Playwright Chromium: 151.0.7922.34, using the `Desktop Chrome` project profile.
- Playwright WebKit: 26.5, using the `Desktop Safari` project profile.
- Installed Safari version present on the host: 26.5. Safari itself was not used as a native Workflow Studio smoke artifact.
- Production web build: Vite transformed 853 modules. `dist/index.html` SHA-256 was `3f83b5ba5ae1b4fa546294f28929823839e986dbd35939c0a39c2b77277d2a77`.
- The web build emitted 11 local Geist/Geist Mono WOFF2 assets.
- Native application artifact: none. No `.app`, DMG, or Windows installer was built or installed during this verification.

Playwright WebKit evidence is renderer coverage, not evidence from an installed Tauri application or the operating system's embedded WebView.

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
| `npm run resources:verify` | **PASS** | Verified 30 packaged resource files. |
| `npm run test:unit -- tests/performance tests/accessibility` | **PASS** | 4 files passed; 9 tests passed. |
| `npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1` | **FAIL** | 114 files passed and 1 suite failed; 1,014 tests passed and 38 skipped. The failing `tests/installers/install-script.test.ts` `beforeAll` invokes `spawnSync('cargo', ...)`, which returned status `null` because Cargo is not installed. |
| `npm run test:rust` | **FAIL / unavailable** | `cargo test --manifest-path src-tauri/Cargo.toml` could not start: `sh: cargo: command not found`. |
| `npm run build` | **PASS with advisory** | Vite built 853 modules in 616 ms. It retained the documented non-blocking warning that `App` exceeds 500 kB after minification. |
| `npm run test:e2e` | **PASS** | Final run: 40/40 tests passed across named Chromium and WebKit projects. |
| `git diff --check` | **PASS** | No output. |
| `git diff --check base...HEAD` | **PASS after mechanical cleanup** | The first branch-wide check found one inherited Markdown hard-break on the redesign spec's status line. Removing those two trailing spaces changed no text or behavior; the rerun produced no output. |
| `git status --short` | **PASS as evidence, dirty before commit** | Listed the expected Task 7 implementation/tests plus the five required formatter-only files; no unrelated path appeared. A clean post-commit status is recorded in the Task 7 report. |

The existing `npm install` audit reported four advisories (one moderate and three high). Dependency upgrades are outside Task 7 scope and were not attempted.

The controller-required inherited formatter cleanup changed only line wrapping/whitespace in `BrandSettings.svelte`, `DeleteImpactDialog.svelte`, `Inspector.svelte`, `Explorer.svelte`, and `ImportExportDialog.svelte`. The final branch-wide diff gate additionally removed the redesign spec status line's inherited trailing Markdown spaces. None of these mechanical changes alter behavior or prose.

## CI coverage

The renderer E2E job now installs both browser engines with:

```text
npx playwright install --with-deps chromium webkit
```

It then runs the existing `npm run test:e2e`, which executes both named projects.

## Installed-application smoke checks

### macOS arm64 — BLOCKED / UNPERFORMED

Host identity was available, but there was no built and installed Workflow Studio artifact. Cargo is unavailable and the controller explicitly prohibited installing a system-wide Rust toolchain. Therefore none of the following installed-app observations was performed or marked as passing:

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

- Rust/native tests and the signature-verifier-backed installer suite remain unverified on this host.
- Native bundle production, installation, first launch, filesystem capabilities, and Tauri WebView integration remain unverified.
- Local font loading is proven in Playwright Chromium and WebKit, but not in installed macOS or Windows application WebViews.
- Native platform keyboard settings, 200-percent zoom, reduced motion, and ResizeObserver behavior still need installed-artifact evidence on macOS and Windows.
- The Vite chunk-size advisory remains non-blocking and unchanged.

These open gates prevent a release-readiness claim.
