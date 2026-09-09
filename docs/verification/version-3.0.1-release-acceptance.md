# Workflow Studio v3.0.1 release acceptance

Version/tag: `3.0.1` / `v3.0.1`
**Approved:** 2026-09-09
**Reviewed hotfix source:** `79e04d61b7b235eaf7135f0bd9b1707117d5730c`

## Release scope

This patch release corrects native state persistence on Windows. In v3.0.0, Arrange Graph could complete its layout and then report `The parameter is incorrect. (os error 87)` while saving the private layout file. The shared Windows replacement helper now uses the operating-system-compatible absolute destination form while retaining capability-bound path validation and atomic replacement.

The same helper covers layout state, active branding, setup readiness, and updater preferences. The release does not change workflow YAML, graph layout results, Hermes compatibility, or supported operating systems.

## Review and verification before release preparation

The complete hotfix received an adversarial code review with no remaining Critical or Important findings. GitHub Actions run `34399215034` passed the quality, renderer E2E, macOS bundle, Windows bundle, and Ubuntu bundle jobs. Its Windows job independently exercised layout, branding, setup, and updater persistence before building the native debug bundle.

The merged `base` tree passed formatting, lint, Svelte/TypeScript checks, 2,302 frontend tests across 175 files, 270 Rust tests, bundled contract and example validation, all 42 packaged resources, and the production renderer build. The focused version-footer browser check passed in Chromium and WebKit.

## Worktree preflight

| Worktree | State | Disposition |
| --- | --- | --- |
| Primary `base` checkout | Contains only the v3.0.1 release preparation plus the user's pre-existing untracked mockups and `tests/scripts/` directory | Preserve the unrelated files unchanged. |
| `workflow-studio-modern-workbench` | Clean | Unrelated branch; preserve unchanged. |
| `.worktrees/ui-customization-recovery` | Clean | Historical merged branch; preserve unchanged. |
| `.worktrees/ui-customization-panels` | Known modified and untracked files from superseded UI work | Preserve unchanged; it contains no intended v3.0.1 release work. |

## Release gates

- [x] Final v3.0.1 candidate passes every local release verification command.
- [ ] Final candidate commit is contained in pushed `origin/base`.
- [ ] Annotated `v3.0.1` tag resolves to the exact candidate commit.
- [ ] Protected GitHub Actions release workflow succeeds for all three native targets.
- [ ] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures are verified from downloaded v3.0.1 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [x] Release approved for publication after protected workflow verification.
- [ ] Verified draft is published as the latest GitHub release.
- [ ] Public `latest.json`, checksum, and installer links resolve.

Clean-machine Windows installation and the Arrange Graph persistence exercise remain required post-publication UAT. Linux and Windows ARM64 packaging remain deferred. Apple Developer ID/notarization and Microsoft Authenticode signing are not included.
