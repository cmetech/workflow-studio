# Workflow Studio version 3 release acceptance

Version/tag: `3.0.0` / `v3.0.0`
**Approved:** 2026-09-08
**Initial reviewed source:** `5cad28d843b83456b013d076786aa52ff2259135`

## Release scope

Version 3 combines the complete loop-group authoring and Hermes compatibility work with the restored customization experience and routed graph layout:

- visually create, edit, inspect, and navigate multiple `loop_group` scopes;
- validate workflow references with the versioned Hermes scanner contract and conformance corpus;
- preserve the footer version, imported brand packs, appearance settings, and collapsible side panels;
- resize the lower Problems/Scope References panel and use the visibly styled back button;
- arrange complex graphs with deterministic left-to-right placement and orthogonal dependency routes that avoid unrelated nodes;
- retain YAML as the sole workflow authority and keep routing/layout state outside workflow files; and
- preserve the 250-node/500-edge visual performance contract and offline bundled resources.

The v2.0.1 recovery candidate was superseded without a tag or release. Historical v2.0.0 draft evidence remains unchanged in the version-2 acceptance record.

## Candidate state before remote release operations

The v3.0.0 tag does not exist. A v3.0.0 draft or release does not exist. The exact release commit is the commit containing this candidate record after review and verification; its SHA is recorded below after the commit is created.

The local baseline used the protected release profile and passed 2,299 tests across 174 files. The focused release tests were changed first and failed against the existing v2.0.1 metadata before the synchronized version update.

## Worktree preflight

| Worktree | State | Disposition |
| --- | --- | --- |
| Primary `base` checkout | Ahead of `origin/base`; `docs/mockups/ui-collapsed-panels-problems.png`, `docs/mockups/ui-expanded-panels-problems.png`, `docs/mockups/ui-theme-customization.png`, and `tests/scripts/test_whole_branch_fix_process_probe.py` are untracked | Preserve unchanged. Release preparation occurs in the clean isolated worktree. |
| `workflow-studio-modern-workbench` | Clean | Unrelated branch; preserve unchanged. |
| `.worktrees/ui-customization-recovery` | Clean | Merged historical recovery branch; preserve unchanged. |
| `.worktrees/ui-customization-panels` | Superseded branch with known modified and untracked files | Preserve unchanged; it contains no intended v3.0.0 release work. |
| `.worktrees/release-v3.0.0` | Active release preparation | Contains only the reviewed v3.0.0 release changes before commit. |

## Local candidate verification

The release candidate passed formatting, lint, Svelte/TypeScript checks with zero errors and warnings, bundled contract and example validation, all 42 packaged resources, 2,299 unit tests in 174 files, 270 Rust tests, and the production renderer build. The complete renderer E2E rerun passed 399 tests with three documented WebKit skips across the 402-case matrix, including the 250-node/500-edge capacity checks.

A local unsigned Apple Silicon package was built with `npm run tauri build -- --bundles app,dmg --no-sign`. Its app metadata reports version/build 3.0.0, its executable is ARM64, and all 42 packaged resources verify:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `LOOP24 Workflow Studio_3.0.0_aarch64.dmg` | 6,706,734 | `af910bba6e031b3e6eb276efc47c75010976180fe85a9c561d762e7228f18176` |
| `LOOP24 Workflow Studio.app.tar.gz` | 6,805,757 | `b5507a4e3e2061711238b7e0e68247b8c3bfe6e3ca0b322ca9898a62e458c6d4` |
| `workflow-studio` executable | 18,104,592 | `4bec52e14e631fbd916e2663bea2b775e3a348261de0770b63fdb6b46e1f8d8c` |

The local `--no-sign` package is supporting evidence only. The protected GitHub Actions artifacts and updater signatures remain the publication authority.

## Release gates

- [x] All local format, lint, Svelte/TypeScript, contract, example, resource, unit, Rust, renderer E2E, and production build checks pass on the final candidate.
- [ ] Final candidate commit is contained in pushed `origin/base`.
- [ ] Annotated `v3.0.0` tag resolves to the exact candidate commit.
- [ ] Protected GitHub Actions release workflow succeeds for all three native targets.
- [ ] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v3.0.0 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [x] Release approved for publication after protected workflow verification.
- [ ] Verified draft is published as the latest GitHub release.
- [ ] Public `latest.json`, checksum, and installer links resolve.

Clean-machine installation and staged updater exercises remain required follow-up acceptance after publication. Linux and Windows ARM64 packaging remain deferred. Apple Developer ID/notarization and Microsoft Authenticode signing are not included.
