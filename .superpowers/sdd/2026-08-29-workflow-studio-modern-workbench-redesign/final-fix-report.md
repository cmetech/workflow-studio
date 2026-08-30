# Modern workbench final review fix report

- Verification date: 2026-08-30 EDT
- Branch: `feat/modern-workbench-redesign`
- Reviewed starting commit: `fef91ad`
- Scope: the complete final whole-branch review finding list
- Release-readiness status: not claimed; Cargo, Rust/native tests, native packaging, and installed-application smoke remain unavailable on this host

## Outcome

The final review wave fixes responsive focus preservation, Canvas More-menu keyboard behavior, bundled mono typography, complete control variants and interaction states, exact Geist license packaging, port accessibility metadata, current-invalid versus retained-last-valid graph messaging, and exact single-gesture authoring transaction evidence. YAML remains the sole workflow authority; projection, visual authoring, validation, history, persistence, and privileged-operation boundaries were not broadened.

## RED evidence

Each behavioral correction began with a focused failing regression:

1. Real Chromium viewport transitions from 1440 to 1180 moved focus from a focused Explorer/Inspector descendant to `BODY`; compact Split retained Canvas when YAML held focus. The new `workbench-layout.spec.ts` resize regressions failed on the inert drawer and inactive YAML subtab assertions.
2. Opening Canvas More left focus on the trigger/body. The new toolbar keyboard test failed its first-menuitem focus assertion and could not prove immediate focused-menu Escape restoration.
3. Computed-style browser coverage found the Inspector code textarea resolving to `ui-monospace, monospace`; source inspection later found the same platform stack in `ExpandableLog.svelte`. The added source contract failed with that exact remaining path.
4. Computed interaction-style coverage first found Canvas Add Node had no `data-variant`; after the base variants were added it found selected Visual hover indistinguishable from rest.
5. Exact upstream license/resource tests found no Geist Mono documentation notice, no frontend notice directory, no Tauri license resources, and only 30 integrity-manifest resources.
6. Port accessibility coverage found dependency handles had no native `title` and no read-only `aria-disabled` state.
7. Projection synchronization had no way to distinguish a current visually-authorable invalid graph from a retained last-valid projection, so the current invalid graph incorrectly rendered “Last valid graph.”
8. The real port-gesture E2E snapshot exposed neither definition revision nor undo depth, so the test could not durably assert a one-revision/one-undo transaction delta.
9. The first responsive implementation exposed an initialization regression: the compact keyboard-authoring test opened Explorer during its first measurement. The failing test proved focus preservation needed to apply only after the first measured presentation established a baseline.

## GREEN implementation and focused verification

- `App.svelte` now establishes independently measured panel/Split baselines, preserves the focused drawer on later docked-to-drawer transitions, and selects the focused YAML or Canvas pane before a later compact Split transition hides either surface. Existing modal Escape ordering and drawer state are unchanged.
- `CanvasToolbar.svelte` now focuses the first enabled More item after mount, supports Arrow Up/Down, Home, End, immediate Escape dismissal with trigger restoration, and click-away dismissal without stealing the outside target's focus.
- Global buttons now define primary, secondary, ghost, and danger resting/hover/active states. Canvas controls use those variants, including a danger overflow action, while the existing disabled, focus-visible, reduced-motion, and forced-colors rules remain in force.
- All technical source surfaces resolve through `var(--font-mono)`. Real browser assertions cover CodeMirror YAML, shortcut keys, Inspector code, and Status Bar metadata in both engines.
- Sans and Mono notices are byte-identical to the pinned `@fontsource-variable` package licenses. Documentation, frontend public assets, Tauri resources, the integrity manifest, release verifier, release-package tests, and LF checkout rules cover both files. Source and built license SHA-256 values are `71609cbb5c78b5870d712eab73a31d76622635c6ed034ab5cee3b9ecbda8685f` and `cc815ed4fc045f0e991abb10395b7932bd028c6a067deb13316d6002105074e6`.
- Workflow ports expose matching native tooltip/accessibility names and read-only `aria-disabled`; existing non-connectable and tab-order behavior remains intact.
- Editor projection synchronization reports `staleSource: 'current' | 'retained' | null`; Graph Canvas uses it only to choose accurate read-only status copy. It does not change projection acceptance or YAML authoring rules.
- The E2E-only snapshot exposes the active definition revision and current undo depth already held by the document/history stores. The real port gesture now proves exactly `+1` revision and `+1` undo depth.

Focused GREEN results:

- Affected unit/accessibility/style/resource slice: 16 files and 157 tests passed.
- Responsive focus and real port authoring: 6 tests passed across Chromium and WebKit.
- Computed mono/control interaction styles: 6 tests passed across Chromium and WebKit.
- Performance/accessibility: 4 files and 9 tests passed.
- Packaged resources: 32 exact files verified.
- Production output contains both exact notices under `dist/licenses`.

## Final verification

| Command | Result |
|---|---|
| `npm run format:check` | PASS; all files matched Prettier. |
| `npm run lint` | PASS; no ESLint findings. |
| `npm run check` | PASS; Svelte reported 0 errors and 0 warnings, and Node TypeScript completed. |
| `npm run contracts:check` | PASS; bundled authoring contracts validated. |
| `npm run examples:check` | PASS; bundled workflow examples validated. |
| `npm run resources:verify` | PASS; 32 packaged resource files verified. |
| `npm run test:unit -- tests/performance tests/accessibility` | PASS; 4 files and 9 tests. |
| `npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1` | Environment-limited: 114 files and 1,018 tests passed; 38 tests skipped; only `tests/installers/install-script.test.ts` failed in `beforeAll` because `spawnSync('cargo', ...)` returned status `null`. |
| `npm run test:rust` | UNAVAILABLE; exited 127 with `sh: cargo: command not found`. |
| `npm run build` | PASS; 853 modules, with the existing non-blocking large-chunk advisory. |
| `npm run test:e2e` | PASS; 50/50 tests across Chromium and WebKit. |
| `git diff --check` | PASS; no output. |

The web-build hash and expanded resource/license evidence were updated in `docs/verification/2026-08-29-modern-workbench-redesign.md`. Native gaps remain stated there without inference from Playwright WebKit.

## Self-review

- Re-read the complete finding list against the final path set; every important and minor item has a direct production change and regression evidence.
- Re-ran the initialization accessibility case after narrowing responsive preservation; it passes while both real resize regressions remain green.
- Confirmed no `ui-monospace` reference remains in renderer source and the only fallback stack is centralized in `--font-mono` after the bundled Geist Mono face.
- Compared documentation, public, and built license files byte-for-byte with both pinned package notices.
- Confirmed the Canvas More menu click-away path does not restore the trigger over the newly clicked control, while Escape does restore it.
- Confirmed `staleSource` changes copy only; graph/YAML authority and read-only gating are unchanged.
- Confirmed the new authoring counters are E2E bootstrap state only; production transaction code is unchanged.
- Confirmed no unrelated repository path is in the fix delta.

## Remaining concerns and unavailable gates

- `cargo` is not installed. Rust tests, the signature-verifier-backed installer suite, native bundle creation, and installed macOS/Windows smoke were not run and are not claimed.
- The existing Vite chunk-size advisory remains non-blocking and unchanged.
- WebKit evidence is renderer coverage, not an installed Tauri WebView claim.
