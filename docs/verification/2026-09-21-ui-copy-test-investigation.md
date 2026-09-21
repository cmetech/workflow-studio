# UI copy test-run investigation

The earlier local full-suite result was not comparable with the passing v3.0.2 verification. The verification setup was incorrect; it did not establish that the release had regressed.

## Evidence

| Difference | Earlier local run | Recorded release/CI setup |
| --- | --- | --- |
| Checkout | Main checkout, with pre-existing local build/dependency artifacts | Clean CI checkout; earlier local work in `.worktrees/windows-primary-stabilization` |
| Vitest | Installed 4.1.10 | Lockfile and stabilization worktree specify 4.1.11 |
| Workers | 4; additional focused checks and Rust compilation overlapped | 1 |
| Test timeout | Default 5 seconds | 20 seconds; quality CI also sets a 600-second hook timeout |
| Renderer bundle | `dist/.vite/manifest.json` last written September 14, 2026, 18:39:46 UTC | Fresh `npm run build` before bundle tests |
| Frozen YAML fixture | 218 CRLF line endings, SHA-256 `f8ac2c5c20e70b7e512fa7497b88f394f19f624fbdf87c29a86277fd7003d759` | Committed LF bytes, SHA-256 `1734f0d62a5dbad01dcf6f8ed4a4aed3572c52c0d7b2033fb98157edc57523bc` |
| YAML patch fixtures | Existing CRLF working files | LF source bytes required by `.gitattributes` and the golden assertions |

Sources: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `docs/verification/version-3.0.2-release-acceptance.md`, direct installed-package inspection, and byte comparison with `git show HEAD:<path>`.

The main checkout's config and YAML patch implementation match HEAD after normalizing line endings. All four inspected fixture files match HEAD exactly after removing CRLF conversion. The same was true of `scripts/install.sh` (114 CRLF line endings), which was restored before the installer tests executed. Restoring their committed bytes changes no versioned fixture content or test expectation. Global Git settings are unchanged.

## Failure interpretation

- **Branding expectations:** the old profile labels in documentation and App tests needed updating. The follow-up also caught and fixed the inspector's `sidecar.language_compatibility` display condition. Both profile migration directions pass with the required YAML values preserved.
- **Frozen fixture and nine YAML patch failures:** working-tree newline drift, not changed YAML semantics. The fixtures were restored only after confirming that newline conversion was their sole difference from HEAD.
- **Bundle-budget failure:** inspected stale September 14 output. Its reported 2.93 MB initial bundle and missing deferred chunks/provenance do not measure the current branding change. A fresh build is required for a conclusion.
- **Installer suite import failures:** CRLF in `scripts/verify-release-assets.mjs`, not the Vitest patch mismatch. The clean install still reproduced the import failure. Installed Vite's `hashbangRE = /^#!.*\n/` does not recognize a CRLF hashbang: it matched the committed LF script and failed on the working file. The transform consequently inserted imports before an unrecognized `#!` line and failed to parse. The file matched HEAD after newline normalization and was restored to its exact committed bytes. No dependency patch or installer implementation change is needed.
- **Timeouts and cascading UI/cleanup failures:** the earlier command omitted the repository's established run settings and ran alongside other expensive checks. A serial rerun is required; timeout failures alone are not proof of a regression or proof that no regression exists.

## Correct verification sequence

Use the Node 22 installation (the default system PATH also contains Node 18), then:

```powershell
npm ci --no-audit --no-fund
npm run build
npm run bundle:check
npm run test:unit -- --exclude '**/.worktrees/**' --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1
```

The local worktree exclusion prevents rediscovering another checkout's tests. CI has no nested worktree and does not need it. Do not overlap this run with other test suites or native compilation.

## Corrected results

- `npm ci --no-audit --no-fund`: exit 0, 299 packages installed; Vitest is now 4.1.11. No package or lockfile changes.
- Fresh production build: exit 0. This removed the stale-output provenance/chunk failures but exposed a **real branding-change regression**: initial closure 2,000,113 bytes, 113 bytes above the unchanged 2,000,000-byte limit.
- Bundle correction: documentation-only command wording now stays in the deferred Markdown renderer; neutral conformance and profile-error messages are shorter. No budget or test threshold was changed. Fresh build and `bundle:check` now pass at **1,999,894 bytes minified / 385,127 bytes gzip**.
- Corrected full unit run: **2,365 tests pass across 185 files**; no assertion failures. `install-script.test.ts` is the one suite-load failure, recorded before its imported script's bytes were restored. Duration: 906.40 seconds. All previously failing App, YAML patch, documentation, routed-layout, frozen-fixture, bundle-budget, security, recovery, Git integration, and release-package tests pass. Retained log: `.ui-copy-corrected-full.log`.
- Installer-only follow-up with the same settings: **89 tests pass**, exit 0, 113.23 seconds. Retained log: `.ui-copy-installer-rerun.log`.

Together these runs verify **2,454 passing tests across all 186 files**. This is a main run plus the one corrected installer rerun, not a claim that the earlier full-run process exited successfully. None of the earlier failure categories remains unresolved in these checks. No test assertions were removed and no budget was raised.

Final Svelte/TypeScript checks report zero errors and warnings; changed-code ESLint and formatting checks pass, as does `git diff --check`. Restored fixture/script bytes and refreshed generated-file index metadata produce no staged or unstaged content changes in those files. Dependency manifests remain unchanged.

The Git restore integration case took 7.77 seconds in the corrected run: it legitimately exceeds the earlier 5-second default while passing the declared 20-second budget. The production security test took 12.34 seconds and passed its unchanged 20-second test budget.
