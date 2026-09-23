# Final-gate normalized-index correction

## Observed failure

The exact-archive Linux gate for `f424805ec2ab7f78428b9b4f4668a90c321c11ba`
passed 352 library tests and one IPC dispatch test. One of 26 Git integration
tests failed: `tracked_symlink_retarget_commits_link_bytes_and_target_content_only_is_not_pair_change`.
Its normalized-index entries differed from the accepted candidate. The existing
guard rejected the commit rather than publishing inconsistent entries.

An isolated 30-run probe reproduced two failures, in iterations 6 and 17.
The earlier source snapshot containing identical production code passed the
whole Linux suite. Neither an isolated pass nor that earlier run replaces the
failed exact-archive gate.

## Baseline and mechanism

Independent source review found this sequence in baseline `955499d` as well:
build the accepted candidate from HEAD, copy the real index into a new file,
then run `git add` against that copy. The symlink integration test is unchanged.
This pair path does not use the new package-isolation branch.

Git uses the index file's modification time when deciding whether cached entry
metadata might be racy. Copying index bytes into a newly created file can remove
that protection without refreshing the cached entry metadata. The isolated
Git 2.55.0 build does not enable `USE_NSEC`; same-second timestamps, same-length
link targets, and inode reuse can make a retargeted symlink appear unchanged to
the copied index. The HEAD-built candidate hashes fresh link bytes, and the
final comparison detects the mismatch.

A deterministic regression uses supported Git stat-cache configuration and
explicit no-follow link/index timestamps, without sleeps or reliance on inode
reuse. It failed at the same normalized-entry guard before the production
change (one failure in 0.11s), confirming the mechanism. After the correction,
it passed in 0.18s and preserved unrelated staged content.

The correction installs the already verified selected modes and object IDs,
or deletions, into the normalized index rather than asking its copied stat
cache to decide what changed. Normalized-index initialization, entry writes,
and tree serialization use the verified private empty directory. Pair candidate
staging and explicit hooks remain unchanged. Unrelated index entries and final
binding/tree checks remain intact.

## Status

Full Linux native verification passed: 352 library tests (48.94s), one IPC
dispatch test (0.01s), and 27 Git integration tests (2.64s), 380 total with zero
failed or ignored and exit code 0. Both the original intermittent symlink test
and the deterministic regression passed. Independent preliminary source review
found no issues; immutable follow-up and Windows verification remain pending.

No timeout, assertion, or safety guard has been relaxed to accept the failing
run. The initial green test's PowerShell wrapper reported an error for
compiler-warning stderr despite the passing Cargo result; subsequent wrappers
record Cargo's exit code explicitly. That wrapper error is not a full-gate pass.
