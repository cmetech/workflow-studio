# Package versions, digests, and trust

The manifest version is a semantic version chosen for the package release. The package digest identifies its actual included bytes. These serve different purposes: editing `scripts/analyze.py`, changing line endings, or replacing `assets/diagram.png` changes the digest even when workflow YAML and the version string are unchanged.

The generated root `digests.json` records file paths, sizes, SHA-256 values, and the composed package digest. Files are ordered by Unicode code point with the contract's exact byte framing. No timestamp or commit SHA enters the package digest. Git-ignored and unreferenced supporting files remain included. Only the root digest file excludes itself.

Use Prepare Package to regenerate metadata and review the exact local changes. Do not hand-edit digest claims to hide a mismatch. If generation reports a stale source snapshot, save or refresh and run validation again.

Trust decisions belong to the installed destination. A new digest can invalidate earlier review or trust, even for a version with a familiar name. Local preparation grants no execution permission.

See [Updating packages](#guide:updating-packages), [Preparing packages](#guide:preparing-packages), and [Co-worker installation](#guide:coworker-package-installation).
