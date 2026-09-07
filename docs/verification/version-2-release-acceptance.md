# Workflow Studio version 2 release acceptance

Status: **PRE-RELEASE — v2.0.1 metadata and focused local checks are prepared. Complete release-wide verification, a fresh unsigned macOS Apple Silicon package, immutable tag, protected updater-signed draft, publication, and installed-platform follow-up remain open.**

Recorded: 2026-09-07. v1.0.6 remains the latest published release. v1.0.7 and v2.0.0 remain verified unpublished drafts. The untagged v1.0.8 candidate was superseded. v2.0.1 is the UI customization recovery candidate.

## v2.0.1 candidate identity

- Version/tag: `2.0.1` / `v2.0.1`
- Merged feature baseline: `7a385e41bb58cf693b83f9b6cbfae4b0539cbe32`
- Final recovery production source: `fca7f01ff1e6838a9bca4c0ae70e14c96e053874`
- Release metadata commit: the local commit containing this acceptance record; it is not yet tagged or pushed.
- The v2.0.1 tag does not exist locally or remotely.
- The v2.0.1 GitHub release does not exist.
- Published baseline: v1.0.6 remains the latest published release.

## Evidence available for the v2.0.1 candidate

| Area | Current evidence | Status |
| --- | --- | --- |
| Candidate source and review | The UI customization recovery satisfies R1–R19. Its independent Claude and Codex reviews and focused rereviews leave no unresolved Critical or Important finding. | Passed locally |
| Recovery-wide verification | At `fca7f01ff1e6838a9bca4c0ae70e14c96e053874`, format, lint, static checks, contracts, examples, all 40 resources, renderer build, 2,010 unit tests across 166 files, 270 Rust tests, and 364 Chromium/WebKit tests passed. Those runs used 2.0.0 metadata and establish the production recovery source, not the final v2.0.1 package. | Passed for production source |
| Focused release metadata | The 2.0.1 release-version, release-state, and installer suites pass after a test-first failure against the prior metadata. The focused footer check passes in Chromium and WebKit, and format, lint, Svelte/TypeScript checks, and `git diff --check` pass. | Passed locally |
| Complete v2.0.1 verification | Fresh complete unit, Rust, Chromium/WebKit, contract, example, resource, and renderer-build gates against the exact versioned commit have not run. | Required before tagging |
| Local native package | No v2.0.1 native package has been built. The earlier 2.0.0 packages below do not establish v2.0.1 package identity. | Required before tagging |
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

## Historical v2.0.0 evidence

The v2.0.0 annotated tag peels to `aa91baac4081f0ca585b10fb3fb65b966a7ec24c`. Protected release workflow run `34042847222` succeeded and produced the verified unpublished ten-asset draft. The draft remains unpublished; it was not moved, deleted, or repurposed for v2.0.1.

The original v2.0.0 metadata candidate was built from `8a9214a309542315e6e8f233dcecd9b68d78572f`. It passed format, lint, Svelte/TypeScript, bundled-contract, example, all 40 packaged-resource, and production renderer checks; 1,837 tests across 160 files; 246 Rust unit tests and 24 Rust integration tests; and 328/328 Chromium/WebKit checks. Its local Apple Silicon DMG was 6,301,686 bytes with SHA-256 `8f07bdb4bdf30b56a582ef46de00a3485f818c3fe29b11dc40bdd983078337d6`; its executable SHA-256 was `62258a58aec8b96874fd1f761d1ae5bb1684d91a0080aba4e74e5c39f5645141`.

The later recovery branch was also packaged locally while its metadata still read 2.0.0. At the final verified production source `fca7f01ff1e6838a9bca4c0ae70e14c96e053874`, the unsigned Apple Silicon DMG was 6,315,021 bytes with SHA-256 `090c8ba1db7ffb61817eb2a88fc8442c75a8311c5159188534db239b1884b446`; its executable SHA-256 was `46e163dc03a16a50af83d1a1f00af8c8d4f4b5123b987087bf62450b58ee5a42`; and its app archive was 6,420,502 bytes with SHA-256 `02462912cec1130077ee2943a5471ccbbdb618e92c2931803a6e0cd4f92c7abf`. These historical 2.0.0 artifacts do not substitute for a v2.0.1 build.

## v2.0.1 pre-publication decision

- [ ] Complete verification and a fresh unsigned local v2.0.1 package recorded against one exact commit.
- [ ] Extracted DMG/NSIS payloads, exact draft inventory, checksums, and updater signatures verified from downloaded v2.0.1 draft bytes.
- [x] No unresolved Critical/Important review finding remains.
- [ ] Release approved for manual publication.

Decision owner/date: Open. No v2.0.1 push, tag, draft workflow, release mutation, or publication has been performed.

## Required next steps

1. Resolve the clean-checkout preflight without deleting or absorbing unrelated user work.
2. Run all release gates and build and inspect a fresh unsigned Apple Silicon v2.0.1 package from one exact commit.
3. After separate approval, push the exact `base` commit, create and push one immutable annotated `v2.0.1` tag, and dispatch the protected draft-only workflow from `base`.
4. Keep the draft unpublished unless all three native jobs, extracted package payloads, exact inventory, updater targets, checksums, and signatures pass.
5. After a separate publication decision, complete clean-machine installation, staged update, relaunch, version confirmation, and 250-node/500-edge acceptance on each supported platform.

Linux packaging and Windows ARM64 remain deferred. Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication. Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.
