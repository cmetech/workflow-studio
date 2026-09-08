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

## Published release boundary

The v3.0.0 annotated tag peels to exact release commit `1cd6a8d323bb408bef394e5b20be5aed75bd6d12`, which is contained in `origin/base`. Protected CI run `34242821519` passed every quality, renderer, and native debug job against that commit. Protected release workflow run `34245992410` built and verified all supported native targets against the same immutable tag.

GitHub release `384861987` was published on 2026-09-08 at <https://github.com/cmetech/workflow-studio/releases/tag/v3.0.0>. v3.0.0 is the latest published release, is not a prerelease, targets the exact tagged commit, and contains exactly ten verified assets.

The local baseline used the protected release profile and passed 2,302 tests across 175 files. The focused release tests were changed first and failed against the existing v2.0.1 metadata before the synchronized version update.

## Worktree preflight

| Worktree | State | Disposition |
| --- | --- | --- |
| Primary `base` checkout | Matched `origin/base` at tag creation; `docs/mockups/ui-collapsed-panels-problems.png`, `docs/mockups/ui-expanded-panels-problems.png`, `docs/mockups/ui-theme-customization.png`, and `tests/scripts/test_whole_branch_fix_process_probe.py` remain untracked | Preserve the unrelated files unchanged. |
| `workflow-studio-modern-workbench` | Clean | Unrelated branch; preserve unchanged. |
| `.worktrees/ui-customization-recovery` | Clean | Merged historical recovery branch; preserve unchanged. |
| `.worktrees/ui-customization-panels` | Superseded branch with known modified and untracked files | Preserve unchanged; it contains no intended v3.0.0 release work. |
| `.worktrees/release-v3.0.0` | Clean at tag creation; active for the post-release evidence commit | Remove after the evidence commit is merged and pushed. |

## Local candidate verification

The release candidate passed formatting, lint, Svelte/TypeScript checks with zero errors and warnings, bundled contract and example validation, all 42 packaged resources, 2,302 unit tests in 175 files, 270 Rust tests, and the production renderer build. Protected CI repeated the full renderer matrix with 398 passed and 4 skipped across 402 cases, including the 250-node/500-edge capacity checks.

A local unsigned Apple Silicon package was built with `npm run tauri build -- --bundles app,dmg --no-sign`. Its app metadata reports version/build 3.0.0, its executable is ARM64, and all 42 packaged resources verify:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `LOOP24 Workflow Studio_3.0.0_aarch64.dmg` | 6,706,734 | `af910bba6e031b3e6eb276efc47c75010976180fe85a9c561d762e7228f18176` |
| `LOOP24 Workflow Studio.app.tar.gz` | 6,805,757 | `b5507a4e3e2061711238b7e0e68247b8c3bfe6e3ca0b322ca9898a62e458c6d4` |
| `workflow-studio` executable | 18,104,592 | `4bec52e14e631fbd916e2663bea2b775e3a348261de0770b63fdb6b46e1f8d8c` |

The local `--no-sign` package is supporting evidence only. The protected GitHub Actions artifacts and updater signatures remain the publication authority.

## Protected release artifacts

Release workflow `34245992410` verified the extracted contents of both DMGs and the Windows NSIS installer before completing. A separate local download of the draft ran the repository verifier with an independently built signature checker, then ran `shasum -a 256 -c SHA256SUMS`; all checks passed before publication.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `LOOP24-Workflow-Studio_3.0.0_macos_aarch64.app.tar.gz` | 6,805,839 | `65fcacf7e6731034d291eead9f5d7458f09b52ea3d171f020fdfae34f2942b32` |
| `LOOP24-Workflow-Studio_3.0.0_macos_aarch64.app.tar.gz.sig` | 424 | `ed84887c8b90a7ce2eee143665484377ab9e68d48524b4a9e0cc16bb252ed23a` |
| `LOOP24-Workflow-Studio_3.0.0_macos_aarch64.dmg` | 6,706,036 | `5a7d6e4da38736bfccc694020661e5773080040c5dc8656c25ecb571004b0f10` |
| `LOOP24-Workflow-Studio_3.0.0_macos_x86_64.app.tar.gz` | 6,911,286 | `e841afc77e1368ae985ac447bac8e0bb0a6be45bf21714454a77ce282f714814` |
| `LOOP24-Workflow-Studio_3.0.0_macos_x86_64.app.tar.gz.sig` | 424 | `9a100b6603b7cddd4d0e9a317efbba2673eda3ab137ee603927038468974bbaa` |
| `LOOP24-Workflow-Studio_3.0.0_macos_x86_64.dmg` | 6,864,969 | `d4881a0dd331010960b88ee051b539bd97258823a430f9818b3b78fc9ab9f082` |
| `LOOP24-Workflow-Studio_3.0.0_windows_x86_64-setup.exe` | 4,990,121 | `604792a1e83a7f88b3dbcaf1db8c6619021438fb951a3845bdfed64ffca05379` |
| `LOOP24-Workflow-Studio_3.0.0_windows_x86_64-setup.exe.sig` | 436 | `8c196a243cc6d7d62f0319e6a7cf1667be5eec60cb9a2b5c92fa5d2036cfb5fe` |
| `latest.json` | 3,920 | `7829b537d1e99754abfb95668c040cd5801548c28b35f4e20919e9648d7c0a41` |
| `SHA256SUMS` | 1,033 | `fa69a2253e2062a1e5ec8d1ba41717cb08b5476023b646f5d7f267ca8d1d48fb` |

The public latest-release API reports v3.0.0 with ten assets. Public `latest.json` bytes match the verified draft bytes, and the public Windows installer URL returns HTTP 200. The downloaded Apple Silicon DMG was copied to `~/Downloads/LOOP24-Workflow-Studio_3.0.0_macos_aarch64.dmg`; its SHA-256 matches the published manifest.

## Release gates

- [x] All local format, lint, Svelte/TypeScript, contract, example, resource, unit, Rust, renderer E2E, and production build checks pass on the final candidate.
- [x] Final candidate commit is contained in pushed `origin/base`.
- [x] Annotated `v3.0.0` tag resolves to the exact candidate commit.
- [x] Protected GitHub Actions release workflow succeeds for all three native targets.
- [x] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v3.0.0 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [x] Release approved for publication after protected workflow verification.
- [x] Verified draft is published as the latest GitHub release.
- [x] Public `latest.json`, checksum, and installer links resolve.

Clean-machine installation and staged updater exercises remain required follow-up acceptance after publication. Linux and Windows ARM64 packaging remain deferred. Apple Developer ID/notarization and Microsoft Authenticode signing are not included.
