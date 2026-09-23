# Workflow Studio v3.1.0 release acceptance

Version/tag: `3.1.0` / `v3.1.0`

Status: preparing; not yet merged, tagged, built, or published. The user authorized merge, push, and release on September 23, 2026 after the feature verification summary. No installed application is replaced by this release process.

## Delivered behavior

| Area | Delivery and boundary |
| --- | --- |
| Complete packages | Discover/create packages containing multiple workflow/companion pairs, command resources, scripts, MCP/configuration files, fixtures, and binary assets. `workflow-package.json` declares membership; YAML remains workflow authority. |
| Code editors | Integrated CodeMirror editors for Python, TypeScript, JavaScript, Markdown commands, JSON, YAML, and plain text; syntax highlighting where supported, search, folding, bracket matching, line numbers, save shortcuts, and offline parser diagnostics. Bash remains inline workflow content or plain text, without a bundled Bash parser. No execution, debugger, runtime installation, or language-server process. |
| Node-to-resource authoring | Open/create referenced resources; show consumers; preview rename/delete changes and preserve unrelated YAML. Binary assets use explicit replacement and native Open/Reveal actions. |
| Preparation | Validate the complete package against bundled agent-owned schemas and resource rules; generate deterministic `digests.json` and `.well-known/hermes-workflows/index.json`; review exact files and create a local Git version while preserving unrelated work. |
| Publishing handoff | Use an external Git client to push the prepared commit, configure that repository/ref in the agent marketplace, and review/install there. Studio accurately reports **Prepared locally** and does not push or claim remote publication. |
| Marketplace interoperability | Fresh Studio-produced versions passed pinned agent distribution/index validation, compilation, installation, explicit trust, and update; changed payload invalidated trust. Verified on the descriptor-safe Linux backend against agent `3e89c2659b6e9c95a627b8f819ff63a11529d86a`. This is contract-specific compatibility, not universal runtime/platform certification. |
| Recovery and safety | Revision-checked file operations, explicit external-change choices, retained recovery provenance, path/link containment, no authored-content execution, and no implicit remote Git operations. |

Package contents are the full distributable directory, not merely YAML. Generated metadata stays inspectable and read-only in the ordinary editor. Missing destination credentials, providers, runtimes, services, or trust remain destination admission concerns; local readiness does not promise successful execution.

## Existing feature evidence and limits

The [final feature receipt](2026-09-23-package-final-gate.md) records 3,002 passing unit tests, 216 passing Windows functional cases, 343 Windows and 380 Linux native tests, four strict reference-performance passes, five frozen adversarial rounds with reconciled corrections, and fresh marketplace install/update/trust interoperability.

The earlier full Linux run had 427 passes, two failures, and three configured skips. Its selection-test precondition was corrected and all 48 affected Chromium/WebKit cases passed. The other failure was a five-second WebKit capacity-worker deadline; isolated baseline and candidate checks passed. The full-run failure remains preserved and is not relabeled as a pass. Fresh release CI results will be recorded separately.

Installed-app keyboard/screen-reader, native picker/Open/Reveal, restart recovery, physical cross-volume, and crash/power-loss observations remain unverified. Automated browser/native tests do not replace these observations. macOS builds must pass the native release pipeline before artifacts are accepted.

## Release gates

- [x] Merge, push, and release authorized.
- [x] Metadata RED/GREEN and local static/contract/resource/build verification.
- [x] Independent release preparation review.
- [ ] Preparation PR and merged-base CI pass.
- [ ] Every linked worktree inspected immediately before tagging.
- [ ] Immutable annotated tag resolves to the verified `origin/base` commit.
- [ ] Three native builds and final draft verification pass.
- [ ] Ten downloaded assets, nine checksums, updater signatures, and extracted Windows payload independently verified.
- [ ] Release published and anonymous public downloads/updater metadata verified.
- [ ] Development checkout returned to `base` and final evidence committed.

Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication.

Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.

## Preparation and execution receipts

Preparation began from feature commit `93aa45878bfacc09d8bd1c774894ec8b0a887c5b`. The focused version suite first failed five assertions against 3.0.3, then passed all ten after synchronization. Frozen dependency baselines allow only application-version changes. Repository-wide formatting and lint, Svelte/TypeScript checks (zero errors or warnings), authoring/package contract checks, examples, and all 72 resource checks passed. A fresh production build passed: initial renderer closure 1,401,105 bytes minified / 375,037 bytes gzip, within its unchanged limits. Independent read-only release-preparation review found no issues. Fresh CI and release artifacts remain pending.
