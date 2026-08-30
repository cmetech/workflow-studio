# Content-aware workbench verification — 2026-08-30

This record verifies the implementation described by the approved
[content-aware workbench design](../superpowers/specs/2026-08-30-workflow-studio-content-aware-workbench-design.md)
and [implementation plan](../superpowers/plans/2026-08-30-workflow-studio-content-aware-workbench.md).

## Candidate identity

- Branch: `fix/native-dialog-and-rail-centering`
- Review-fix parent commit: `61066248fd8e0f43c0547116dc1ceb4447bd4a8c`
- Parent subject: `test: verify content-aware workbench release`
- Host: Apple silicon, macOS 26.5.1 (25F80)
- Rust toolchain: `rustc 1.88.0 (6b00bc388 2025-06-23)`, `cargo 1.88.0 (873a06493 2025-05-10)`
- System WebKit framework: `21624`
- Verification date: 2026-08-30

The review-fix commit cannot contain its own hash. Its stable 20-file source/test manifest SHA-256 is
`3d3aaccb3364432dce206dbf16909826c824f5c023e20b6b9bd4f15e2bd71ad8`. Reproduce that identity from the committed
review fix with:

```bash
git diff-tree --no-commit-id --name-only -r --diff-filter=ACMR HEAD^ HEAD -- src tests \
  | LC_ALL=C sort \
  | while IFS= read -r manifest_file; do
      printf '%s  %s\n' "$(git rev-parse "HEAD:$manifest_file")" "$manifest_file"
    done \
  | shasum -a 256
```

The final review-fix commit hash is also recorded in the ignored SDD execution report after commit creation.

## Review-fix coverage

- Controllable deferred-analysis tests prove overlapping visual mutations and intervening authoritative YAML edits
  cannot overwrite the current workflow. Commit compare-and-swap covers workflow ID, generation, definition and
  companion paths, companion presence, and both revisions.
- Worker unavailable, runtime `error`, `messageerror`, and bounded no-response timeout paths settle as visible canvas
  rejections. Worker listeners, timers, and registration waiters are cleaned up. No main-thread validation fallback
  was added.
- One shared exact-geometry helper now checks Welcome, authoring, Settings, Examples, Documentation, Git,
  Inspector/Problems, and every modal at all four geometries in both configured engines.
- Port-drag counters are reset and inspected before mouse-up for the rejected and valid gestures. Repeated diagnostics
  assert the complete page-error and console-error collections are empty. The long Windows selected workspace and Git
  repository roots are identical, while the entire prior path, long ref, commit subject, and containment are asserted.

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
| `CARGO_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo RUSTUP_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup PATH=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo/bin:/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1` | PASS; 121 files, 1,125 tests |
| `CARGO_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo RUSTUP_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup PATH=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo/bin:/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH npm run test:rust` | PASS; 245 library tests and 24 Git integration tests |
| `npm run build` | PASS; 874 modules transformed |
| `npm run test:e2e` | PASS; 222 tests across Chromium and Playwright WebKit |
| `git diff --check` | PASS |

The original focused adversarial matrix was exactly 104/104 at parent `6106624` with this command:

```bash
npx playwright test tests/e2e/activity-pages.spec.ts tests/e2e/canvas-capacity.spec.ts \
  tests/e2e/modal-layout.spec.ts tests/e2e/workbench-containment.spec.ts \
  tests/e2e/workbench-layout.spec.ts --project=chromium --project=webkit --workers=1
```

After the review-strengthened modal/surface matrix expanded those same files, the exact same command passed 184/184.
The exact geometry-only command also passed 120/120:

```bash
npx playwright test tests/e2e/workbench-containment.spec.ts tests/e2e/modal-layout.spec.ts \
  --project=chromium --project=webkit --workers=1
```

The coverage includes all four exact geometries, effective 200% reflow, active-page hit testing, repeated diagnostics
with empty page-error and console-error collections, long bounded content, real modality, focus restoration,
authoring-state preservation, and compact Split behavior. The capacity test uses a semantic 250-node/500-edge
projection and performs real drag, valid connection, rejected cycle, navigation, Inspector, and Problems actions.
Chromium recorded no authoring long task over 50 ms and zero parse, validation, layout, Git, native, or file work
during node pointer movement and before mouse-up on both port drags.

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
| `src-tauri/target/debug/bundle/dmg/LOOP24 Workflow Studio_1.0.3_aarch64.dmg` | macOS arm64, app 1.0.3, debug/unsigned DMG; review source manifest above | `ce2bdce743839b13a2648e082291ed2365bec64f0d020a52e4bbaae1a66319c1` |
| `src-tauri/target/debug/bundle/macos/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio` | Mach-O arm64 executable, ad-hoc linker signature; review source manifest above | `3c8cc5adea2b62f93697ec28abf03b246c6c918286565844582c03e5fef23acc` |

The checksums, mount, copy, detach, launch, and temporary install identity are reproducible from these exact commands:

```bash
shasum -a 256 \
  'src-tauri/target/debug/bundle/dmg/LOOP24 Workflow Studio_1.0.3_aarch64.dmg' \
  'src-tauri/target/debug/bundle/macos/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio'

mktemp -d /private/tmp/workflow-studio-task10-review.XXXXXX
# Result: /private/tmp/workflow-studio-task10-review.n1CZwn

hdiutil attach -readonly -nobrowse \
  'src-tauri/target/debug/bundle/dmg/LOOP24 Workflow Studio_1.0.3_aarch64.dmg'
# Existing unrelated volume occupied the base name; this image mounted as disk7 at
# /Volumes/LOOP24 Workflow Studio 1 and passed image CRC verification.

ditto '/Volumes/LOOP24 Workflow Studio 1/LOOP24 Workflow Studio.app' \
  '/private/tmp/workflow-studio-task10-review.n1CZwn/LOOP24 Workflow Studio.app'
shasum -a 256 \
  '/private/tmp/workflow-studio-task10-review.n1CZwn/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio'
hdiutil detach /dev/disk7

env HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 \
  ALL_PROXY=http://127.0.0.1:9 NO_PROXY= \
  '/private/tmp/workflow-studio-task10-review.n1CZwn/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio'
ps -ax -o pid=,command= \
  | rg '/private/tmp/workflow-studio-task10-review\.n1CZwn/LOOP24 Workflow Studio\.app/Contents/MacOS/workflow-studio'
```

The copied review artifact launched and remained alive after the deliberately dead proxy produced the expected
updater network failure. It was then terminated with `Ctrl-C`, and a repeated `ps`/`rg` check returned no process.
No extended installed interaction matrix was repeated for this review artifact.

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

Windows artifact creation and installed-app checks were not performed. The Task 10 commit was not remotely
reachable, and pushing or dispatching the authenticated Windows workflow was expressly out of scope. No existing
Windows artifact at this exact candidate was available for non-mutating verification. Playwright Chromium/WebKit
results are not substituted for Windows WebView2 evidence.

## Advisories and open gates

- The production build retains the previously documented non-blocking warning for chunks larger than 500 kB.
- The local artifacts are debug bundles with an ad-hoc linker signature, not notarized release artifacts.
- Full installed macOS interaction/media coverage and all installed Windows coverage remain open as detailed above.
- No remote workflow was dispatched, and no artifact was pushed or published.
