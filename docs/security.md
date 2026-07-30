# Workflow Studio security model

Workflow Studio treats every workspace file, Git repository, imported contract, brand pack, release response, and recovery record as untrusted input. The renderer is not a general-purpose command shell, YAML remains the only workflow authority, and version 1 makes no telemetry or analytics requests.

## Trust boundaries and mitigations

| Untrusted input | Boundary and mitigation | Behavior and regression evidence |
| --- | --- | --- |
| Workspace paths and files | The user grants one workspace root. Native path resolution rejects traversal and rechecks canonical/symlink containment immediately before reads and mutations. Writes use expected hashes and same-directory atomic replacement. | `src-tauri/src/workspace/`, `src-tauri/src/recovery.rs`, workspace and recovery Rust tests, `tests/security/security-boundaries.test.ts` |
| YAML text, aliases, and graph references | TypeScript parses bounded YAML 1.2, rejects duplicate keys/multiple documents, validates against the bundled contract, and permits only DAG-safe visual transactions. Invalid text remains recoverable while save/export and stale visual mutations are blocked. Ambiguous alias-derived edits remain YAML-only. | `src/lib/yaml/`, `src/lib/validation/`, `src/lib/dag/`, `tests/e2e/invalid-yaml-recovery.spec.ts`, canvas/property tests |
| Local Git repository, hooks, and output | Rust constructs a closed Git command set with exact argument arrays, literal pathspecs, bounded output, timeouts, and no shell. Pair versions preserve unrelated staged, unstaged, and untracked work. Hooks may run and reject a user-confirmed commit. Remote, branch, reset, merge, rebase, and history-rewrite operations are absent. | `src-tauri/src/git/`, `src-tauri/tests/git_integration.rs`, `tests/e2e/git-version.spec.ts`, `tests/security/security-boundaries.test.ts` |
| Selected Hermes executable | A one-shot native dialog grant binds the exact regular file and parent identity. The only invocation is the fixed `workflow schema --profile <closed enum> --json` argument sequence with bounded output. Renderer-provided executable arguments are not accepted. | `src-tauri/src/contracts.rs`, contract Rust tests, `tests/security/security-boundaries.test.ts` |
| Brand manifests and assets | Manifests reject unknown active-content sections, duplicates, unsafe paths, and excessive sizes. SVG uses an allowlist plus independent XML checks; PNG is fully decoded and dimension-limited. Validated bytes are copied atomically under app data before rendering. Runtime packs cannot change installed bundle identity. | `src/lib/branding/`, `src-tauri/src/branding.rs`, branding malicious corpora, `tests/e2e/branding.spec.ts` |
| Embedded Markdown | Markdown is rendered offline through a fixed tag/attribute allowlist. Remote images and active HTML are removed; external documentation links become explicit inert buttons handled by the application. | `src/lib/docs/render-markdown.ts`, `src/lib/docs/render-markdown.test.ts`, `tests/security/security-boundaries.test.ts` |
| Setup/update events and logs | Native run IDs and monotonic sequences prevent stale completion. Logs are redacted, line/byte bounded, stored only in application data, and never include workflow bodies. UI progress reflects native stages/bytes instead of timers. | `src-tauri/src/setup.rs`, `src-tauri/src/updater.rs`, progress reducer/controller tests, `tests/e2e/update-progress.spec.ts` |
| Recovery, recents, layout, settings | Native code enforces schema and byte/entry limits and stores these records only below the platform application-data directory. Workspace YAML never receives editor layout/application state. | `src-tauri/src/recovery.rs`, `startup.rs`, `layout.rs`, setup/updater specifications, workspace integration tests |
| Release metadata and artifacts | Installers require an exact OS/architecture match and published SHA-256 manifest. In-app updates additionally require the committed first-party Minisign public key; a release build fails closed on an empty or documented test key. Release verification compares companion signatures with `latest.json` and cryptographically verifies artifact bytes before checksums pass. | `scripts/verify-release-assets.mjs`, installer tests, `src-tauri/build.rs`, `src-tauri/src/updater_key.rs`, updater Rust tests |

## Renderer and native capability policy

The configured CSP permits local application resources, Tauri IPC, local asset protocols, and blob URLs needed for already-sanitized preview assets. It forbids `unsafe-eval`, remote renderer resources, objects, frames, and a wildcard source. Tauri capabilities grant core window lifecycle, logging, and native file-dialog access; shell and blanket filesystem permissions are not granted. Updater and relaunch behavior is exposed through narrow typed Rust commands rather than renderer-controlled process arguments.

The production build uses an inert runtime bootstrap. The deterministic browser fixture and its readback controls are selected only by Vite `e2e` mode, before application modules load. The security suite builds production output and rejects its fixture marker, seed paths, and fixture messages.

## Network and privacy

Workflow authoring, bundled contracts, examples, documentation, and LOOP24 resources work offline. Version 1 contains no telemetry, analytics, crash-report upload, remote Git, collaboration, or cloud persistence. The updater is the sole intended application network feature and contacts the configured public GitHub Releases endpoint only for a user-requested or bounded optional startup check. The installer scripts contact the same public repository release API when the user runs them.

## Unsigned operating-system packages

macOS and Windows packages are intentionally not signed by Apple or Microsoft. Gatekeeper or SmartScreen warnings therefore remain expected and are documented in `docs/installing.md`; Workflow Studio never disables or weakens those controls. This is separate from the mandatory first-party Tauri updater signature, which protects update metadata and bytes after installation.

## Reporting and release posture

Do not include workflow YAML, credentials, updater private-key material, or saved logs in a public report. Record the affected version, platform, reproducible boundary behavior, and a minimal redacted fixture. A release remains blocked until the clean-machine and staged-updater rows in `docs/verification/version-1-release-acceptance.md` contain real evidence.
