# Content-aware workbench verification — 2026-08-30

This record verifies the implementation described by the approved
[content-aware workbench design](../superpowers/specs/2026-08-30-workflow-studio-content-aware-workbench-design.md)
and [implementation plan](../superpowers/plans/2026-08-30-workflow-studio-content-aware-workbench.md).

## Candidate identity

- Branch: `fix/native-dialog-and-rail-centering`
- Final whole-branch review-fix parent commit: `5c55a4f1d2f23ea36e5526248cb2c5851c20bc70`
- Parent subject: `fix: address Task 10 review round 2`
- Host: Apple silicon, macOS 26.5.1 (25F80)
- Rust toolchain: `rustc 1.88.0 (6b00bc388 2025-06-23)`, `cargo 1.88.0 (873a06493 2025-05-10)`
- System WebKit framework: `21624`
- Verification date: 2026-08-30

The final whole-branch review-fix commit cannot contain its own hash or encompassing Git tree hash. Its exact,
stable 26-file source/test manifest SHA-256 is
`84ea3ecdca3a7344d9402af8d1d7c504995e67898bab55c7d3b2ae9e145803b2`. Reproduce that production/test tree identity
from the committed review fix with:

```bash
git diff-tree --no-commit-id --name-only -r --diff-filter=ACMR HEAD^ HEAD -- src tests \
  | LC_ALL=C sort \
  | while IFS= read -r manifest_file; do
      printf '%s  %s\n' "$(git rev-parse "HEAD:$manifest_file")" "$manifest_file"
    done \
  | shasum -a 256
```

The final review-fix commit and encompassing Git tree hashes are recorded in the ignored SDD execution report after
commit creation.

## Review-fix coverage

- The 512x350 authoring regression measures editor, graph, pointer viewport, menu, and final menu-item descendants.
  The menu is bounded and scrollable, retains a canvas viewport of at least 44 CSS pixels, stays outside the pointer
  viewport, and exposes a real hittable final action in Chromium and WebKit.
- Repeated identical blocking diagnostics retain occurrence identity. A real 39-diagnostic Export opens and closes
  its blocking dialog with 39 list items and empty complete page-error and console-error collections.
- Controllable deferred-analysis tests prove visual mutation compare-and-swap covers contract digest, workflow and
  pair identity, YAML revisions, saved revisions, saved generation, and disk hashes. Concurrent Save and same-profile
  contract-switch results cannot be overwritten by a stale mutation.
- Position deltas retain a workspace/workflow/path layout lease through the analysis boundary. A delayed mutation for
  workflow A cannot write node positions into workflow B after activation.
- A first non-active Export awaits exact-revision worker analysis and exports the selected pair in one invocation.
  Already-active exact Export continues to preserve its current analysis.
- Page commands use one opener-aware navigation path. Palette navigation from Definition YAML focuses the Settings
  heading after modal teardown and Back returns focus to that exact editor opener.
- Example preview Back restores the automatically captured list scroll and preview opener after remount. Documentation
  transfers selected-result focus to Back on wide-to-narrow reflow and back to the result on narrow-to-wide reflow;
  the Chromium transition passed ten consecutive focused repetitions after the final focus-lease fix.
- Explorer reports collapsed on Welcome at desktop and compact widths, and F1 opens Command Palette from CodeMirror
  while ordinary editable typing/native editing bindings remain protected.
- The prior worker timeout/cleanup, no-main-thread-validation fallback, exact modal matrix, Split threshold, local-only
  Git, port-drag counters, 250-node/500-edge capacity, and modal top-layer/Escape gates remain green.

## Automated gates

Every final gate passed. Rust-dependent commands, including the full unit suite whose installer tests spawn Cargo,
were run with the task-provided `CARGO_HOME`, `RUSTUP_HOME`, and `PATH` values.

| Command | Result |
| --- | --- |
| `npm run format:check` | PASS; all matched files formatted |
| `npm run lint` | PASS |
| `npm run check` | PASS; 0 Svelte errors and 0 warnings |
| `npm run contracts:check` | PASS; bundled contracts validated |
| `npm run examples:check` | PASS; bundled examples validated |
| `npm run resources:verify` | PASS; 32 packaged files verified |
| `npm run test:unit -- tests/performance tests/accessibility` | PASS; 4 files, 12 tests |
| `CARGO_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo RUSTUP_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup PATH=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo/bin:/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1` | PASS; 121 files, 1,141 tests, no unhandled errors |
| `CARGO_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo RUSTUP_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup PATH=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo/bin:/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH npm run test:rust` | PASS; 245 library tests and 24 Git integration tests |
| `npm run build` | PASS; 874 modules transformed |
| `npm run test:e2e` | PASS; 276 tests across Chromium and Playwright WebKit |
| `git diff --check` | PASS |

The final whole-branch adversarial matrix passed exactly 266/266 with this command:

```bash
npx playwright test tests/e2e/activity-pages.spec.ts tests/e2e/examples-and-docs.spec.ts \
  tests/e2e/modal-layout.spec.ts tests/e2e/workbench-containment.spec.ts \
  tests/e2e/workbench-layout.spec.ts tests/e2e/workspace-authoring.spec.ts \
  tests/e2e/canvas-capacity.spec.ts tests/e2e/workbench-style.spec.ts \
  --project=chromium --project=webkit --workers=1
```

After the continuous-height canvas adjustment, the new 512x350 descendant test and the pre-existing pointer-viewport
invariant passed 4/4 in both engines with:

```bash
npx playwright test tests/e2e/workbench-layout.spec.ts tests/e2e/workspace-authoring.spec.ts \
  --project=chromium --project=webkit --workers=1 \
  --grep 'usable canvas|canvas menu stays outside'
```

The matrix includes all four exact geometries, effective 200% descendant containment and hit testing, repeated Export
diagnostics, responsive master-detail restoration, opener-aware palette navigation, long bounded content, real
modality, authoring-state preservation, and compact Split behavior. The capacity test uses a semantic
250-node/500-edge projection and performs real drag, valid connection, rejected cycle, navigation, Inspector, and
Problems actions. Chromium recorded no authoring long task over 50 ms and zero parse, validation, layout, Git, native,
or file work during node pointer movement and before mouse-up on both port drags.

Playwright WebKit is browser-engine evidence. It is not described here as an installed Tauri/WebView result.

## macOS artifacts

The existing CI native command was run locally with the pinned Rust environment:

```bash
CARGO_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo \
RUSTUP_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup \
PATH=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo/bin:/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH \
npx --no-install tauri build --debug --config src-tauri/tauri.ci.conf.json
```

| Artifact | Identity | SHA-256 |
| --- | --- | --- |
| `src-tauri/target/debug/bundle/dmg/LOOP24 Workflow Studio_1.0.3_aarch64.dmg` | macOS arm64, app 1.0.3, debug/unsigned DMG; final source manifest above | `65a39d27149334e180cf48b1201e3d125a60429c277cd09eb1555a13af3b7435` |
| `src-tauri/target/debug/bundle/macos/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio` | Mach-O arm64 executable, ad-hoc linker signature; final source manifest above | `41b64131aa76a8393a379de597b2925d984c4b4e0a26d5aca08dd3373a37b080` |

The checksums, mount, copy, detach, launch, and temporary install identity are reproducible from these exact commands:

```bash
shasum -a 256 \
  'src-tauri/target/debug/bundle/dmg/LOOP24 Workflow Studio_1.0.3_aarch64.dmg' \
  'src-tauri/target/debug/bundle/macos/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio'

mktemp -d /private/tmp/workflow-studio-final-fix.XXXXXX
# Result: /private/tmp/workflow-studio-final-fix.AA441f

hdiutil attach -readonly -nobrowse \
  'src-tauri/target/debug/bundle/dmg/LOOP24 Workflow Studio_1.0.3_aarch64.dmg'
# Existing unrelated volume occupied the base name; this image mounted as disk7 at
# /Volumes/LOOP24 Workflow Studio 1 and passed image CRC verification.

ditto '/Volumes/LOOP24 Workflow Studio 1/LOOP24 Workflow Studio.app' \
  '/private/tmp/workflow-studio-final-fix.AA441f/LOOP24 Workflow Studio.app'
shasum -a 256 \
  '/private/tmp/workflow-studio-final-fix.AA441f/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio'
hdiutil detach /dev/disk7

env HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 \
  ALL_PROXY=http://127.0.0.1:9 NO_PROXY= \
  '/private/tmp/workflow-studio-final-fix.AA441f/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio'
ps -ax -o pid=,command= \
  | rg '/private/tmp/workflow-studio-final-fix\.AA441f/LOOP24 Workflow Studio\.app/Contents/MacOS/workflow-studio'
```

The copied final-review artifact's Mach-O checksum exactly matched the bundled app. It launched and remained alive
after the deliberately dead proxy produced the expected updater network failure. It was then terminated with
`Ctrl-C`, and a repeated `ps`/`rg` check returned no process. No extended installed interaction matrix was repeated
for this review artifact.

### Initial Task 10 installed macOS smoke observations

The following detailed observations were performed on initial Task 10 candidate `6106624` and its prior DMG
checksum `6625c501c6dc65e94b6dca9ffa1160dc2de0a752383612c6def96f28bf71a0cf`. They are retained as historical evidence
and are not relabeled as observations of the review artifact above.

| Check | Installed observation |
| --- | --- |
| Offline startup, Welcome, status bar | PASS: the installed copy rendered Welcome at 1440x900 in dark mode and kept the full status bar visible after the updater failure. |
| Bundled resources and Geist | PASS for packaging (`resources:verify`, contracts, examples, and the bundled font build output). Geist visibly rendered in the installed UI; exact computed-family assertions were performed in Playwright WebKit rather than through installed WebView introspection. |
| Folder picker open/cancel | PASS: `Cmd+O` opened the native macOS folder picker and Escape returned to Welcome. |
| Real workspace open | PASS: a temporary local Git workspace opened through the native picker; Quick Open selected its YAML workflow. |
| Explorer, canvas, Inspector, Problems | PASS smoke: the 2-node/1-edge graph, Explorer pair, Inspector fields, Problems region, toolbar, and status bar rendered together. |
| Settings | PASS smoke: Appearance, Workflow Contracts, Updates, and About categories rendered in the installed app. Adversarial long values and final-action reachability are automated browser evidence only. |
| Examples and Documentation | PASS smoke: bundled examples and the bundled searchable documentation catalog rendered offline. Detail focus/navigation is automated browser evidence only. |
| Git | PASS smoke: the installed app displayed the exact temporary repository path, `master`, clean pair status, and commit history. Long diffs and version-dialog reachability are automated browser evidence only. |
| Split | PASS smoke for installed side-by-side Canvas/YAML rendering. Exact 721 px classification and effective 200% reflow are automated browser evidence only. |
| Canvas gestures | Toolbar and graph rendered. Installed node drag, valid port connection, and rejected cycle were not manually performed; the real-pointer automated capacity and authoring tests cover them in both configured engines. |
| Modals and focus | Native folder-picker modality/cancel passed. Installed 200% focus-isolation coverage was not manually performed; the full modal matrix is automated browser evidence. |
| Setup/update logs | Offline updater failure was non-blocking. Installed long-log interaction was not manually performed; the bounded long-log scenarios passed in both browser engines. |
| Themes and accessibility media | Installed dark theme rendered. Light theme, reduced motion, and forced-colors checks are automated browser evidence only. |

These limitations keep the installed-platform gate open; this record does not claim release readiness.

## Windows status

Windows artifact creation and installed-app checks were not performed. The final review-fix commit was not pushed,
and dispatching the authenticated Windows workflow was expressly out of scope. No existing Windows artifact at this
exact candidate was available for non-mutating verification. Playwright Chromium/WebKit results are not substituted
for Windows WebView2 evidence.

## Advisories and open gates

- The production build retains the previously documented non-blocking warning for chunks larger than 500 kB.
- The local artifacts are debug bundles with an ad-hoc linker signature, not notarized release artifacts.
- Full installed macOS interaction/media coverage and all installed Windows coverage remain open as detailed above.
- No remote workflow was dispatched, and no artifact was pushed or published.
