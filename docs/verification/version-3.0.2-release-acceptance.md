# Workflow Studio v3.0.2 release acceptance

Version/tag: `3.0.2` / `v3.0.2`

Recorded: September 21, 2026. Status: published as latest at 15:51:15 UTC; public downloads verified.

The user approved the official release and requested the Windows install/upgrade command. Publication is authorized only after protected CI, all native builds and exact draft integrity verification pass. No installation over the user's current app is authorized or performed.

## Source boundary

- Stabilized application: `baf04fe8763d06478e77a08284b6f7d6eb88e237`.
- Verification handoff: `b1147a7962fb10a3e0ec96edfb9ea9cb6f96a3c2`.
- Independent source review covered `7a7c19b26a58d428ac0a3d854105a97a1cd68918..5ccbe5327243e46b04f6bd2d597e1815c11616d3`; subsequent single-worker and keyboard fixes have test-first, full CI and packaged verification.
- [Stabilization evidence](2026-09-14-windows-primary-stabilization.md) records all Windows tests, backups, restoration and limitations. Its pre-release authority notes are historical; the user's later official-release approval supersedes them, not its measurements.
- Release preparation changes only application version identity, corresponding tests and documentation. Dependency versions remain identical to their reviewed provenance.

## Accepted exceptions

Startup p50 2.9249 seconds / p95 7.8437 seconds; Back to root 61–85 ms; rare 250-node/500-edge Arrange timeout; Git Create Version approximately 30 seconds (latest 25.537 seconds with responsive window). Other measured interactions retain the strict 50 ms limit. No YAML or native safety invariant was waived.

## Release gates

- [x] Official release authorized by the user.
- [x] Stabilization code CI run `35590210035` passed all seven jobs.
- [x] Release metadata RED/GREEN and static checks passed.
- [x] Exact release-preparation and merged `base` CI passed.
- [x] Every local worktree inspected immediately before tagging.
- [x] Annotated tag resolves to the tested commit on `origin/base`.
- [x] All three protected native builds and final draft verifier passed.
- [x] Downloaded ten-asset draft independently verified with nine checksum entries and updater signatures.
- [x] Windows extracted installer payload verified; protected macOS extracted DMG payloads verified.
- [x] Verified draft published as latest, with public installer/updater/checksum URLs confirmed.
- [x] Main development checkout returned to `base`.

## Verified release identity and CI

Release-preparation commit: `8ecd1986db1bf0552aa5662fa11a3b28bfa21137`.
The metadata gate first failed five assertions against 3.0.1, then passed all ten
tests after the bounded version update. Format, lint, Svelte/TypeScript checks,
contracts, examples and 42 source resources passed locally. An unused variable
in the ignored capacity-UAT driver caused the first local lint attempt to fail;
the scratch-only correction passed the rerun and did not alter shipped code.

[Preparation CI 35595441100](https://github.com/cmetech/workflow-studio/actions/runs/35595441100)
passed all seven jobs, including 404 cross-browser tests with four skips.
[PR #2](https://github.com/cmetech/workflow-studio/pull/2) merged on September 21
at 12:06:46 UTC, preserving commit history. Merge/release commit:
`af61f1e7c54e23d086b6e0a8b7adc8a6b3d575b4`. Its file tree is identical to the
preparation commit (`git diff --exit-code` returned 0).

[Merged-base CI 35597655880](https://github.com/cmetech/workflow-studio/actions/runs/35597655880)
also passed all seven jobs. Windows shard 2 reported **98 passed and one flaky**:
`workbench-layout.spec.ts:113`, docked panel visibility persistence, timed out
at its readiness step on the first attempt and passed its configured retry.
The successful job is not represented as an all-first-attempt pass. Raw log:
retained stabilization scratch `release-302-base-shard2.log`.

Annotated tag `v3.0.2` was created only after the merged-base run passed and the
remote tag was confirmed absent; it peels to `af61f1e7c54e23d086b6e0a8b7adc8a6b3d575b4`.
[Official release run 35600221685](https://github.com/cmetech/workflow-studio/actions/runs/35600221685)
was dispatched from `base`. Validation created draft release **392944606**, with
that exact target commit, `draft: true`, `prerelease: false` and initially no assets.
No tag was retargeted, no signing key was exposed, and no installed app was replaced.

## Release-workflow recovery (application tag unchanged)

The first release run `35600221685` failed on macOS Apple Silicon before any
artifact upload: 2,450 unit tests passed and one failed because the real bundle
regression test could not find `dist/.vite/manifest.json`. Normal CI built the
renderer before that test; the release workflow omitted that prerequisite.
The remaining doomed jobs were cancelled, and empty draft `392944606` was retained.

The narrow correction in `cb544ecdb0dcbd7c904fe29793759bb26b333d2f` adds an explicit
renderer build step and a workflow-ordering regression. The new test failed with
the original workflow; 14 metadata/toolchain tests and seven real bundle tests
passed after the correction and renderer build. Formatting and diff checks passed.
No application code, dependency, signature rule or assertion was relaxed.

[PR #3](https://github.com/cmetech/workflow-studio/pull/3) merged to tooling commit
`962f62f2aa3156eec082f5ae63eaad99b713f2f8` after the full quality suite and Windows
native/functional jobs passed. Remaining compatibility CI was allowed to overlap
the draft rebuild, not publication. Tooling branch CI: `35601626088`; merged
tooling CI: `35602565509`. Both passed all seven jobs.

[Corrected release run 35602569938](https://github.com/cmetech/workflow-studio/actions/runs/35602569938)
uses tooling `962f62f` and the unchanged application tag at `af61f1e`. The
repository's separate immutable application/tooling design permits this repair
without retargeting the tag. Native job logs must show passing unit and Rust
results, not merely a successful final shell command.

Manual log inspection caught a second release-only failure in `35602569938`:
the Windows PowerShell verification block reported success despite one unit
test timing out. Its npm invocation lost the declared `--testTimeout=20000`
and `--maxWorkers=1` arguments, and the shell continued to later successful
commands. Actual Windows unit results were 2,450 passed and one failed at the
default five-second timeout. Both macOS jobs passed all 2,451 unit tests.
The run was cancelled before final verification; its nine-asset draft remains
unpublished and is not accepted. The misleadingly named retained Windows log
`release-302-windows-green.log` records this failure, not a passing unit gate.

A tooling-only correction uses explicit Bash for the multi-command verification
step, retaining the existing timeout and enabling fail-fast execution. A new
regression first failed against the missing shell declaration; it also exercises
the real command block with a failing npm stand-in and checks option forwarding
and that Rust/contracts/examples cannot run after unit failure. Real Git Bash
execution of all 27 packaging tests passed with the declared release options.
Fresh full CI and a complete release rerun remain required before publication.

Shell correction: `a683359ad191e75eddcbc63164ad73d262d6f9c5`, [PR #4](https://github.com/cmetech/workflow-studio/pull/4).
All 41 release-workflow checks passed with the declared release options; the
initial local run without those options had three existing fixture timeouts at
five seconds. Formatting, lint and diff checks passed. CI: `35610262674`.

Before reusing the draft, all nine failed-run assets were backed up at
`C:/Users/ecorell/AppData/Local/Temp/ws-release-failed-35602569938` and matched
against the GitHub API's SHA-256 digests and byte sizes. Only those nine assets
were then removed from the unpublished draft; the tag, draft ID, published
releases and local backups were preserved. Metadata is retained as
`failed-release-35602569938-metadata.json` in stabilization scratch. This restores
the existing empty-draft precondition without weakening the resolver.

PR #4 merged to `7413cd287331ec20c34839b5d67a0022387ff9fa` after quality,
Windows native, both Windows functional shards and macOS native jobs passed.
Remaining Linux/cross-browser CI overlaps only the draft build. Merged-base CI:
`35611348944`; fresh native release run: `35611353267`. Both complete CI runs
and every native/final verification gate must pass before publication.

Branch CI `35610262674` completed successfully in all seven jobs: 2,453 unit
tests, 404 cross-browser tests (four skips), Windows browser shards of 102 and
99 passing tests, Windows Rust suites of 236 unit + one IPC + 12 Git integration
tests, and all three native debug bundles. Apple Silicon release job in
`35611353267` passed 2,451 tagged application unit tests, 253 Rust unit + one
IPC + 26 Git integration tests, and all 42 extracted packaged resources.

Merged tooling CI `35611348944` also passed all seven jobs. Windows shard 2
reported 98 passed and one flaky: `canvas-capacity.spec.ts:712`, overview handle
geometry through Arrange, timed out waiting for the seeded workflow tree item
in `support.ts:69` before invoking Arrange, then passed its configured retry.
This is recorded as a setup-readiness retry, not an all-first-attempt pass or
an additional layout-performance exception. Raw complete CI logs are retained.

## Immediate pre-tag worktree preflight

| Worktree | State before tag | Disposition |
| --- | --- | --- |
| Main `workflow-studio` | `base`, clean, `af61f1e` | Intended release source; updated by fast-forward. |
| `.worktrees/windows-primary-stabilization` | Feature branch, clean, `8ecd198` | Merged source; retain ignored UAT logs, backup tooling and evidence. |
| `C:/Users/ecorell/ws11base` | Detached `55b5adf`; only untracked `node_modules.partial/` | Unrelated earlier dependency-install scratch; left untouched. |

All three were inspected with `git status --short --branch` after enumerating
`git worktree list --porcelain`. No uncommitted intended release work remained.
This post-tag evidence update is documentation only and does not change the
immutable application or tooling commit used by the successful release workflow.

## Published artifact evidence

[Official release](https://github.com/cmetech/workflow-studio/releases/tag/v3.0.2):
ID `392944606`, published at `2026-09-21T15:51:15Z`, latest, not a prerelease.
[Native release run 35611353267](https://github.com/cmetech/workflow-studio/actions/runs/35611353267)
passed all five jobs using tooling `7413cd287331ec20c34839b5d67a0022387ff9fa`
and immutable application `af61f1e7c54e23d086b6e0a8b7adc8a6b3d575b4`.

Both macOS jobs passed 2,451 unit tests, 253 Rust unit + one IPC + 26 Git
integration tests and all 42 extracted DMG resources. Windows passed 2,451
unit tests across 186 files, 236 Rust unit + one IPC + 12 Git integration tests,
42 extracted NSIS resources and the GUI executable subsystem check. Its actual
log shows `vitest run --testTimeout=20000 --maxWorkers=1`; there is no masked
unit failure. The final verifier accepted all ten assets, updater metadata,
cryptographic signatures and nine checksum entries.

Independent downloads are retained at
`C:/Users/ecorell/AppData/Local/Temp/ws-official-release-c1ee993b/assets`.
The local verifier accepted the exact ten-asset inventory, checksums and updater
signatures. Pinned 7-Zip 26.03 extracted NSIS without running the installer;
all 42 resources and the PE GUI subsystem passed. Extracted application
ProductVersion/FileVersion are both `3.0.2`. The installer is 5,123,270 bytes.
Immediately before publication all ten local file sizes and digests matched
fresh exact-draft API metadata, and both tooling CI runs plus the release run
were freshly confirmed successful.

| Asset | SHA-256 |
| --- | --- |
| `LOOP24-Workflow-Studio_3.0.2_macos_aarch64.app.tar.gz` | `86034d5bd5f0edda3b5ba9c159390079e399aea932b9b7a251aca1ee1ea6292c` |
| `LOOP24-Workflow-Studio_3.0.2_macos_aarch64.app.tar.gz.sig` | `d9d6c36c94cb1371de31e4338d094af975158827f7fb057263764c31d1351f72` |
| `LOOP24-Workflow-Studio_3.0.2_macos_aarch64.dmg` | `e49df33ffc298778c2701e619833e556ef57ae75324f5e8075c74628f2c7410c` |
| `LOOP24-Workflow-Studio_3.0.2_macos_x86_64.app.tar.gz` | `5965df14f9cb9d777390dcdecc546bb77162b6c6a41393f3e656a1efa1ee6317` |
| `LOOP24-Workflow-Studio_3.0.2_macos_x86_64.app.tar.gz.sig` | `a00366a92f9f90df4510ab94d8c7a6648dafd5b4928b45e55891764a5146292d` |
| `LOOP24-Workflow-Studio_3.0.2_macos_x86_64.dmg` | `e47c3e23bd113ed73552e0fdbac9c326e7e133f88e9eaa8c29e0ac8b7d963ecb` |
| `LOOP24-Workflow-Studio_3.0.2_windows_x86_64-setup.exe` | `4989f03fdfee7e201e58dd17d914e3653d458c0d4600acb7a972e09109cdd275` |
| `LOOP24-Workflow-Studio_3.0.2_windows_x86_64-setup.exe.sig` | `90d87e50aee17df9e6d69a63dabd980cebb539772cd819bf10c8bb9433c74fa3` |
| `latest.json` | `e0842cdd612d602f0b30b6c7f286ad0bab0ec4e68265436ec53e262a2d5393a3` |
| `SHA256SUMS` | `9f1a327c63f69f633f3aa62f71877219cb56022975dd2c6ee764a65ce9eb1502` |

After publication, anonymous GitHub API access confirmed latest `v3.0.2` and
the exact release ID. Anonymous public Windows installer, `latest.json` and
`SHA256SUMS` downloads matched the independent verified bytes. The immutable
PowerShell bootstrap at `v1.0.5/scripts/install.ps1` matched reviewed Git blob
`0a8b10b6e0cf6160ea6c93082e101c013de1b367`; it selects the latest published
application, not application version 1.0.5. It was downloaded, not executed.

```powershell
iex (irm 'https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.5/scripts/install.ps1')
```

Main checkout remains on `base`. All failed-run logs, backups and unrelated
worktrees are retained. No installed app or user app data was changed during
this official-release operation.

## Platform scope and follow-up

Windows x64 and macOS Apple Silicon/Intel packages are included. Linux has CI/native debug coverage but no release installer; Windows ARM64 is unsupported. OS packages have no Apple notarization/Developer ID or Microsoft Authenticode signature. Updater artifacts use separate first-party integrity signatures.

Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication.
Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.

The private candidate UAT did not replace the installed application. Save work and close Workflow Studio before running the supplied bootstrap; it verifies the selected release's checksum before launching NSIS. All original UAT backups and raw evidence are retained.
