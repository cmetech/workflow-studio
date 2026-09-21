# Workflow Studio v3.0.2 release acceptance

Version/tag: `3.0.2` / `v3.0.2`

Recorded: September 21, 2026. Status: release preparation; not yet published.

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
- [ ] Release metadata RED/GREEN and static checks passed.
- [ ] Exact release-preparation and merged `base` CI passed.
- [ ] Every local worktree inspected immediately before tagging.
- [ ] Annotated tag resolves to the tested commit on `origin/base`.
- [ ] All three protected native builds and final draft verifier passed.
- [ ] Downloaded ten-asset draft independently verified with nine checksum entries and updater signatures.
- [ ] Windows extracted installer payload verified; protected macOS extracted DMG payloads verified.
- [ ] Verified draft published as latest, with public installer/updater/checksum URLs confirmed.
- [ ] Main development checkout returned to `base`.

## Platform scope and follow-up

Windows x64 and macOS Apple Silicon/Intel packages are included. Linux has CI/native debug coverage but no release installer; Windows ARM64 is unsupported. OS packages have no Apple notarization/Developer ID or Microsoft Authenticode signature. Updater artifacts use separate first-party integrity signatures.

Extracted DMG/NSIS payload verification, the exact draft inventory, checksums, and updater signatures block publication.
Clean-machine functional installs and staged-update exercises are required follow-up evidence after publication.

The private candidate UAT did not replace the installed application. Save work and close Workflow Studio before running the supplied bootstrap; it verifies the selected release's checksum before launching NSIS. All original UAT backups and raw evidence are retained.
