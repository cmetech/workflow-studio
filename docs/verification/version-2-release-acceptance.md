# Workflow Studio version 2 release acceptance

Status: **PRE-RELEASE — v2.0.1 is merged to local `base`, fully verified, and packaged as an unsigned macOS Apple Silicon build. The immutable tag, protected updater-signed draft, publication, and installed-platform follow-up remain open.**

Recorded: 2026-09-07. v1.0.6 remains the latest published release. v1.0.7 and v2.0.0 remain verified unpublished drafts. The untagged v1.0.8 candidate was superseded. v2.0.1 is the UI customization recovery candidate.

## v2.0.1 candidate identity

- Version/tag: `2.0.1` / `v2.0.1`
- Merged feature baseline: `7a385e41bb58cf693b83f9b6cbfae4b0539cbe32`
- Final recovery production source: `fca7f01ff1e6838a9bca4c0ae70e14c96e053874`
- Verified and packaged source: `aed0cb7be765d66211635b7d49332d2271bfc15f`.
- Release evidence commit: the local commit containing the final evidence below; it is not yet tagged or pushed.
- The v2.0.1 tag does not exist locally or remotely.
- The v2.0.1 GitHub release does not exist.
- Published baseline: v1.0.6 remains the latest published release.

## Evidence available for the v2.0.1 candidate

| Area | Current evidence | Status |
| --- | --- | --- |
| Candidate source and review | The UI customization recovery satisfies R1–R19. Its independent Claude and Codex reviews and focused rereviews leave no unresolved Critical or Important finding. | Passed locally |
| Recovery-wide verification | At `fca7f01ff1e6838a9bca4c0ae70e14c96e053874`, format, lint, static checks, contracts, examples, all 40 resources, renderer build, 2,010 unit tests across 166 files, 270 Rust tests, and 364 Chromium/WebKit tests passed. Those runs used 2.0.0 metadata and establish the production recovery source, not the final v2.0.1 package. | Passed for production source |
| Focused release metadata | The 2.0.1 release-version, release-state, and installer suites pass after a test-first failure against the prior metadata. The local command explicitly excludes `.worktrees/**` so linked checkouts cannot contaminate discovery. The focused footer check passes in Chromium and WebKit, and format, lint, Svelte/TypeScript checks, and `git diff --check` pass. | Passed locally |
| Complete v2.0.1 verification | At `aed0cb7be765d66211635b7d49332d2271bfc15f`, format, lint, Svelte/TypeScript checks, contracts, examples, all 40 resources, renderer build, 2,010 unit tests across 166 files, 270 Rust tests, and 364 Chromium/WebKit tests passed. | Passed locally |
| Local native package | The fresh unsigned Apple Silicon `.app`, DMG, and updater archive report 2.0.1. The standalone app, mounted DMG payload, and extracted archive have identical 43-file trees, and both inspected app copies pass the exact 40-resource integrity manifest. | Passed locally |
| Protected native draft | No v2.0.1 tag, GitHub draft, or workflow run exists. Updater-signed macOS Apple Silicon, macOS Intel, and Windows x64 jobs require separate approval after local verification. | Required before publication |
| Installed-app follow-up | macOS Apple Silicon/Intel and Windows installed-app validation, native-WebView interaction, staged update, and release-artifact performance evidence remain open. | Required follow-up |

## Local worktree preflight disposition

The 2026-09-07 inspection covered every linked worktree:

| Worktree | State | Disposition |
| --- | --- | --- |
| `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio` (`base`) | Three untracked files: `docs/mockups/ui-collapsed-panels-problems.png`, `docs/mockups/ui-expanded-panels-problems.png`, and `docs/mockups/ui-theme-customization.png` | Preserved as unrelated user files. Their unresolved status blocks release tagging because the runbook requires a clean tagging checkout. |
| `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio-modern-workbench` | Clean | Unrelated feature worktree; untouched. |
| `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-recovery` | Clean at the merged recovery commit | Retained as recovery evidence; untouched. |
| `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/ui-customization-panels` | Known 63 modified and 11 untracked paths from the superseded customization source | Explicitly superseded by the reviewed recovery branch. Preserved and untouched; it contains no remaining intended v2.0.1 release work. |

Local `base` is also ahead of `origin/base`. The exact final candidate must be separately approved and pushed before an annotated v2.0.1 tag could satisfy the release runbook. No push or tag is authorized by this local preparation.

## v2.0.1 definitive local verification

The final ordered release run used source `aed0cb7be765d66211635b7d49332d2271bfc15f` and passed:

| Gate | Result |
| --- | --- |
| Format, lint, static checking | Passed; Svelte check reported 0 errors and 0 warnings |
| Contract, examples, resources | Passed; 40 packaged resources verified |
| Unit | 166 files, 2,010 tests passed |
| Rust | 246 library plus 24 Git integration tests passed; 270 total |
| Renderer build | Passed |
| E2E | 364 tests passed: 182 Chromium and 182 WebKit |
| Embedded documentation | 14 offline guide titles and import keys were verified by the packaged-renderer tests |

Three earlier unit invocations run through a `/usr/bin/time | tee` receipt wrapper reported a pre-execution `spawnSync` failure for the test's nested Cargo helper. No Cargo process was created in the clean failure, while the identical direct Cargo probe and two direct full unit-suite runs passed. The final release run therefore executed the suite directly with output redirected to a receipt file; it passed all 2,010 tests with no source or dependency change. No speculative retry or production change was introduced.

## v2.0.1 unsigned local artifacts

All artifacts were produced from `aed0cb7be765d66211635b7d49332d2271bfc15f` with `npx tauri build --no-sign --bundles app,dmg`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `src-tauri/target/release/bundle/dmg/LOOP24 Workflow Studio_2.0.1_aarch64.dmg` | 6,314,788 | `0bfb6e3e26ae4eb8fad2b2c8e642bc0c3e4c964ad0c0a61dedbb80a6d534cf77` |
| `src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app/Contents/MacOS/workflow-studio` | 17,724,816 | `7fb77a7022f0ed71e3b946630b08cf62a31d84e96e696b9a14ff02587b80d7b6` |
| `src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app.tar.gz` | 6,420,430 | `f0d92599f7c06e90b012a485dc2fdd1fe46feabce9a2477f18d65d572a0bb7af` |

The standalone app and read-only mounted DMG payload both report version/build 2.0.1, name `LOOP24 Workflow Studio`, and identifier `com.cmetech.workflowstudio`. The standalone app, mounted DMG payload, and extracted updater archive have identical 43-file trees by per-file SHA-256. The standalone and mounted copies each pass the committed 40-resource integrity manifest. `file` reports an ARM64-only Mach-O executable. The build has only the linker-created ad-hoc signature metadata, has no TeamIdentifier or sealed resources, and fails strict bundle-signature verification as expected for `--no-sign`. No `.sig` updater signature was created. Developer ID signing, notarization, installation, Intel packaging, and non-macOS packaging are not claimed.

## Historical v2.0.0 evidence

The v2.0.0 annotated tag peels to `aa91baac4081f0ca585b10fb3fb65b966a7ec24c`. Protected release workflow run `34042847222` succeeded and produced the verified unpublished ten-asset draft. The draft remains unpublished; it was not moved, deleted, or repurposed for v2.0.1.

The original v2.0.0 metadata candidate was built from `8a9214a309542315e6e8f233dcecd9b68d78572f`. It passed format, lint, Svelte/TypeScript, bundled-contract, example, all 40 packaged-resource, and production renderer checks; 1,837 tests across 160 files; 246 Rust unit tests and 24 Rust integration tests; and 328/328 Chromium/WebKit checks. Its local Apple Silicon DMG was 6,301,686 bytes with SHA-256 `8f07bdb4bdf30b56a582ef46de00a3485f818c3fe29b11dc40bdd983078337d6`; its executable SHA-256 was `62258a58aec8b96874fd1f761d1ae5bb1684d91a0080aba4e74e5c39f5645141`.

The later recovery branch was also packaged locally while its metadata still read 2.0.0. At the final verified production source `fca7f01ff1e6838a9bca4c0ae70e14c96e053874`, the unsigned Apple Silicon DMG was 6,315,021 bytes with SHA-256 `090c8ba1db7ffb61817eb2a88fc8442c75a8311c5159188534db239b1884b446`; its executable SHA-256 was `46e163dc03a16a50af83d1a1f00af8c8d4f4b5123b987087bf62450b58ee5a42`; and its app archive was 6,420,502 bytes with SHA-256 `02462912cec1130077ee2943a5471ccbbdb618e92c2931803a6e0cd4f92c7abf`. These historical 2.0.0 artifacts do not substitute for a v2.0.1 build.

## v2.0.1 pre-publication decision

- [x] Complete verification and a fresh unsigned local v2.0.1 package recorded against one exact commit.
- [ ] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v2.0.1 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [ ] Release approved for manual publication.

Decision owner/date: Open. No v2.0.1 push, tag, draft workflow, release mutation, or publication has been performed.

## Required next steps

1. Resolve the clean-checkout preflight without deleting or absorbing unrelated user work.
2. After separate approval, push the exact `base` commit, create and push one immutable annotated `v2.0.1` tag, and dispatch the protected draft-only workflow from `base`.
3. Keep the draft unpublished unless all three native jobs, extracted package payloads, exact inventory, updater targets, checksums, and signatures pass.
4. After a separate publication decision, complete clean-machine installation, staged update, relaunch, version confirmation, and 250-node/500-edge acceptance on each supported platform.

Linux packaging and Windows ARM64 remain deferred. Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication. Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.
