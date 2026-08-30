# Content-aware workbench verification — 2026-08-30

This record verifies the implementation described by the approved
[content-aware workbench design](../superpowers/specs/2026-08-30-workflow-studio-content-aware-workbench-design.md)
and [implementation plan](../superpowers/plans/2026-08-30-workflow-studio-content-aware-workbench.md).

## Candidate identity

- Branch: `fix/native-dialog-and-rail-centering`
- Verification parent commit: `2459006d2b651602c5f9881d3b35ef688dfcc14d`
- Parent subject: `fix: address Task 9 review findings`
- Host: Apple silicon, macOS 26.5.1 (25F80)
- Rust toolchain: `rustc 1.88.0 (6b00bc388 2025-06-23)`, `cargo 1.88.0 (873a06493 2025-05-10)`
- System WebKit framework: `21624`
- Verification date: 2026-08-30

The final Task 10 commit hash is recorded in the ignored SDD execution report because a commit cannot contain its
own hash.

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
| `CARGO_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo RUSTUP_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup PATH=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo/bin:/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1` | PASS; 121 files, 1,109 tests |
| `CARGO_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo RUSTUP_HOME=/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup PATH=/private/tmp/workflow-studio-remediation-toolchain-20260830/cargo/bin:/private/tmp/workflow-studio-remediation-toolchain-20260830/rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH npm run test:rust` | PASS; 245 library tests and 24 Git integration tests |
| `npm run build` | PASS; 874 modules transformed |
| `npm run test:e2e` | PASS; 142 tests across Chromium and Playwright WebKit |
| `git diff --check` | PASS |

The focused adversarial Chromium/WebKit matrix also passed 104/104. It covers all approved geometries, effective
200% reflow, active-page hit testing, repeated diagnostics, long bounded content, real modality, focus restoration,
authoring-state preservation, and compact Split behavior. The capacity test uses a semantic 250-node/500-edge
projection and performs real drag, valid connection, rejected cycle, navigation, Inspector, and Problems actions.
Chromium recorded no authoring long task over 50 ms and zero parse, validation, layout, Git, native, or file work
during pointer movement.

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
| `src-tauri/target/debug/bundle/dmg/LOOP24 Workflow Studio_1.0.3_aarch64.dmg` | macOS arm64, app 1.0.3, debug/unsigned DMG | `6625c501c6dc65e94b6dca9ffa1160dc2de0a752383612c6def96f28bf71a0cf` |
| `src-tauri/target/debug/bundle/macos/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio` | Mach-O arm64 executable, ad-hoc linker signature | `ff7882c6beaf11cdd034cdc75b118c3b911e9df9a2c97ece414d475a6099ffd2` |

`hdiutil attach -readonly -nobrowse` verified the DMG CRC, the app was copied from the mounted image to an isolated
temporary install directory, the image was detached, and the copied executable was launched. Network access was
made unavailable to the process with a deliberately unreachable proxy. The updater reported its expected network
failure while the application remained usable.

### Installed macOS smoke observations

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
