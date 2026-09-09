# Workflow Studio v3.0.1 release acceptance

Version/tag: `3.0.1` / `v3.0.1`
**Approved:** 2026-09-09
**Reviewed hotfix source:** `79e04d61b7b235eaf7135f0bd9b1707117d5730c`
**Release commit:** `7608947b4d17e49cd064fc978d330c76aab8c281`

## Release scope

This patch release corrects native state persistence on Windows. In v3.0.0, Arrange Graph could complete its layout and then report `The parameter is incorrect. (os error 87)` while saving the private layout file. The shared Windows replacement helper now uses the operating-system-compatible absolute destination form while retaining capability-bound path validation and atomic replacement.

The same helper covers layout state, active branding, setup readiness, and updater preferences. The release does not change workflow YAML, graph layout results, Hermes compatibility, or supported operating systems.

## Review and verification before release preparation

The complete hotfix received an adversarial code review with no remaining Critical or Important findings. GitHub Actions run `34399215034` passed the quality, renderer E2E, macOS bundle, Windows bundle, and Ubuntu bundle jobs. Its Windows job independently exercised layout, branding, setup, and updater persistence before building the native debug bundle.

The merged `base` tree passed formatting, lint, Svelte/TypeScript checks, 2,302 frontend tests across 175 files, 270 Rust tests, bundled contract and example validation, all 42 packaged resources, and the production renderer build. The focused version-footer browser check passed in Chromium and WebKit.

## Published release boundary

The v3.0.1 annotated tag peels to exact release commit `7608947b4d17e49cd064fc978d330c76aab8c281`, which is contained in `origin/base`. Protected CI run `34406142397` passed all five jobs. Protected release workflow run `34408692126` built all three native targets and completed the whole-draft verifier against the same immutable tag.

GitHub release `385868225` was published on 2026-09-09 at <https://github.com/cmetech/workflow-studio/releases/tag/v3.0.1>. It is the latest release, is not a prerelease, targets the exact tagged commit, and contains exactly ten verified assets.

An independent authenticated download of the draft passed the repository release verifier and `shasum -a 256 -c SHA256SUMS` before publication. The public `latest.json` reports version 3.0.1 and points its Windows x64 updater entry to the exact v3.0.1 installer.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `LOOP24-Workflow-Studio_3.0.1_macos_aarch64.app.tar.gz` | 6,805,413 | `e9c73ddc246eb4483e7253477a73e16a7aea510ce96837c6f364be258dc1e436` |
| `LOOP24-Workflow-Studio_3.0.1_macos_aarch64.app.tar.gz.sig` | 424 | `2d469b754b5841e8f6acd79bc9a756b490a1796094ed3678c2ed2c4d5bb36e44` |
| `LOOP24-Workflow-Studio_3.0.1_macos_aarch64.dmg` | 6,706,594 | `6338aa74b3387406c674a428a20fa9f0f7249ed6782fcb2d68125411604a8745` |
| `LOOP24-Workflow-Studio_3.0.1_macos_x86_64.app.tar.gz` | 6,911,392 | `c12721f0d98f2b139ed98fbb6c5d7189f1e8f9d13b28dd7f36f52835c67a0b7f` |
| `LOOP24-Workflow-Studio_3.0.1_macos_x86_64.app.tar.gz.sig` | 424 | `09ae3a82523a1d5fe003e79e01344bb9e56d89945d5e92db911698401f667118` |
| `LOOP24-Workflow-Studio_3.0.1_macos_x86_64.dmg` | 6,865,292 | `28ec6e5306c7659bc7699ae766dd669217e5e5f878e120da3ac6fb18efecf4e5` |
| `LOOP24-Workflow-Studio_3.0.1_windows_x86_64-setup.exe` | 4,982,112 | `500306ff03c375fbfed9a7b80d4a386d78b6c9449d96b79297379a0d0b16b3ef` |
| `LOOP24-Workflow-Studio_3.0.1_windows_x86_64-setup.exe.sig` | 436 | `54deb71deec939b235598b972e6ecdbe4d4e338b8cf3751e677a4a89ea286c22` |
| `latest.json` | 3,920 | `dafaecbc9babe6b29f6d76f8b384157a26b657dd557bd493ea1875baa47d5a29` |
| `SHA256SUMS` | 1,033 | `96c98e0c1c6d5e373223e4681548cc289a5001bfb2ce9d82b3c183c91a86096c` |

The public Windows installer was downloaded to `~/Downloads/LOOP24-Workflow-Studio_3.0.1_windows_x86_64-setup.exe`; its SHA-256 matches the published manifest.

## Worktree preflight

| Worktree | State | Disposition |
| --- | --- | --- |
| Primary `base` checkout | Contains only the v3.0.1 release preparation plus the user's pre-existing untracked mockups and `tests/scripts/` directory | Preserve the unrelated files unchanged. |
| `workflow-studio-modern-workbench` | Clean | Unrelated branch; preserve unchanged. |
| `.worktrees/ui-customization-recovery` | Clean | Historical merged branch; preserve unchanged. |
| `.worktrees/ui-customization-panels` | Known modified and untracked files from superseded UI work | Preserve unchanged; it contains no intended v3.0.1 release work. |

## Release gates

- [x] Final v3.0.1 candidate passes every local release verification command.
- [x] Final candidate commit is contained in pushed `origin/base`.
- [x] Annotated `v3.0.1` tag resolves to the exact candidate commit.
- [x] Protected GitHub Actions release workflow succeeds for all three native targets.
- [x] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures are verified from downloaded v3.0.1 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [x] Release approved for publication after protected workflow verification.
- [x] Verified draft is published as the latest GitHub release.
- [x] Public `latest.json`, checksum, and installer links resolve.

Clean-machine Windows installation and the Arrange Graph persistence exercise remain required post-publication UAT. Linux and Windows ARM64 packaging remain deferred. Apple Developer ID/notarization and Microsoft Authenticode signing are not included.
