# Round 05 reconciliation

Reviewed candidate: `a43abc5f067a519820b71a04b6218fdbd7a01dd7`, tree `e9a28df3d533c90437f37d09c67f970f0e7fba68`.

The independent report was frozen before reconciliation, SHA-256 `157cf1c7917a91245d8f6d7ec553242dda8d88523bfe8bd57cbf047da8e23f27`. Verdict: **BLOCK**, two Important findings. Preserve the report unchanged.

| ID | Disposition | Severity | Assessment | Status |
| --- | --- | --- | --- | --- |
| R05-01 | Accepted | Important | A schema-valid manifest with a missing declared workflow or companion loses its package projection and repair action. Preserve explicit access to the existing manifest while membership is invalid; restore navigation after correcting it. Preparation must remain blocked. | Test-first correction pending. |
| R05-02 | Accepted | Important | Binding recovery to app-data storage makes existing artifact saves fail for normal writable workspaces on another volume. Select safe same-filesystem retention without sacrificing live-inode protection, persistent provenance, containment, budgets, or fail-closed handling. | Test-first correction pending. |

The report passed 656 unit tests across 68 files, 62 native tests, 14 Chromium checks, and static/contracts/examples/resources/build/bundle gates. The missing-member repair defect was independently reproduced in production modules and Chromium. Cross-volume failure follows the production storage/save path and an injected cross-device error; physical two-volume UI acceptance was not performed. Green tests do not invalidate these counterexamples.

Both findings agree with the existing product behavior requirements. Documentation of a same-volume limitation did not authorize a general inability to save artifacts in another local drive. Any correction must retain the safety properties established by prior remediation, including recovery of later writes through already-open handles; copying and deleting the original is insufficient.

After corrections: commit exact paths, obtain targeted independent review of the immutable corrected candidate, and run the final complete gate. Required installed-app/manual acceptance remains separate and unverified. No merge, push, publication, or release is implied.
