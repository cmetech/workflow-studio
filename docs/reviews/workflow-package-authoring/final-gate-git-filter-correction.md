# Final-gate Git filter correction

The final verification of candidate `a956ff4fced378cbb9053a40dc1b50f2c28bd844`
(tree `b4e76f1e73168580b4ef21e35bcc922f72fecb86`) exposed an Important
no-execution violation. This addendum does not replace or amend the five frozen
adversarial reports.

## Finding

With Git 2.55.0 on Linux, the package no-execution test invoked its synthetic
clean filter while serializing a copied repository index. Git's
`ce_smudge_racily_clean_entry` can stat and filter an unrelated entry when
`update-index --cacheinfo` writes the index. Hashing selected files with
`hash-object --no-filters` does not prevent this separate path.

The original Windows full native run passed 337 tests, but a new deterministic
regression reproduced the failure on Windows too. It stages an unrelated file
with a future modification time, then configures an executable filter and
prepares/commits a package. Both ordinary and linked-worktree cases failed
before the correction. Only synthetic test fixture marker commands were used.

## Correction

Package `read-tree`, `update-index`, and `write-tree` operations use an empty,
owner-private working directory for both the process cwd and Git's `-C` and
`GIT_WORK_TREE`. Explicit absolute `GIT_DIR` and `GIT_INDEX_FILE` retain the
authenticated repository and candidate index, including linked worktrees.
Raw source hashing remains bound to the workspace with `--no-filters`.
Existing hook, signing, fsmonitor, replacement-object, and transport guards
remain in effect.

Directory creation reuses the existing atomic owner-private primitive:
Unix mode 0700/current owner and Windows protected owner-only DACL. Unix
temporary-path ancestors must have trusted owners and must not permit
unprotected writes by other users. Windows retains handles without delete
sharing for every ancestor and the child during command execution. Identity,
permissions, and emptiness are checked before and after Git. Cleanup is
nonrecursive and preserves unexpected contents or replacement entries.

Independent source review identified the temporary-parent substitution gap in
the first draft. The ancestor protections address that finding. Windows tests
also exposed cleanup blocked by our own cap-std directory handles; those child
handles are now closed before removal while ancestor locks remain held.

## Verification status

- Before correction: two deterministic Windows racy-index regressions failed.
- Initial isolation correction: both regressions passed, including clean and
  process filters, raw CRLF bytes, unrelated staged-entry preservation, and
  linked-worktree main-index preservation. This run predates ancestor hardening.
- Hardened directory lifecycle tests: four Windows tests passed, covering
  owner-private empty creation, cleanup, unexpected-content preservation, and
  blocked child replacement and ancestor replacement until locks are released.
- Full Linux native verification passed: 352 library, one IPC dispatch, and
  26 Git integration tests (379 total), zero failed or ignored. Git 2.55.0,
  Rust/Cargo 1.88, offline/locked, one test thread; library 40.79s and Git
  integration 2.56s. This source snapshot includes the final production fix;
  the subsequently added Windows-only ancestor-lock test was not in it.
- Correction commit: `f424805ec2ab7f78428b9b4f4668a90c321c11ba`, tree
  `867525af529e709a491101b76a96fbb9baef8f2d`. Independent targeted source review
  verified all eight changed files against the original candidate and returned
  PASS with zero findings. The reviewer did not run tests.
- Full Windows native verification of that clean commit passed: 330 library,
  one IPC dispatch, and 12 Git integration tests (343 total), zero failed or
  ignored; library 1135.16s and integration 164.54s.
- A subsequent exact-archive Linux run passed 352 library and one dispatch test,
  but passed only 25 of 26 integration tests. The existing symlink-retarget
  test failed its normalized-index consistency check. An isolated 30-run probe
  reproduced two failures. This is investigated separately in
  [the normalized-index correction](final-gate-normalized-index-correction.md);
  the Linux full gate and feature completion gate remain open.

Earlier final-gate results remain valid only for their recorded candidate:
Linux Git 2.34.1 had 334 passing and 12 failing library tests because its Git
lacks the hook subcommand used by existing integration paths; Git 2.55.0 had
345 passing and this one failing library test. Neither was a passing full gate.
Windows Chromium had 212 passing and three failing functional tests; isolated
repeats passed nine of nine without changing assertions or timeouts. Their
full-run failure cause is still under investigation. Installed-app manual
acceptance remains unverified.

## Unix type-width follow-up

A subsequent portability review found that locked libc 0.2.189 declares
`S_ISVTX` as `mode_t`, which is `u16` on Apple targets. Rust filesystem metadata
returns its mode as `u32`. The direct bitwise operation therefore fails to
typecheck on macOS. The check now explicitly converts the constant with
`u32::from`, preserving its value on both supported Unix type widths; Windows
does not compile this Unix-only branch.

A small compiler probe failed with the original `u32 & u16` expression and
passed with the conversion for both constant widths. Independent source
review confirmed the locked-library definitions and correction. This is
type-check evidence, not a macOS application build or runtime acceptance result.
