# Updating packages

Open the package you intend to update and edit its members or artifacts. For example, a change to `packages/laptop-support/scripts/analyze.py` may affect several workflows. Inspect References before replacing a shared resource and review binary metadata when assets change.

Save drafts, choose the next semantic version according to your release policy, and validate the whole package. The exact-byte digest changes when included content changes; a version label alone does not establish equivalence. Regenerate `digests.json` and the shared repository index through Prepare Package, then inspect the complete local Git preview.

Unrelated packages may have dirty working files, but their uncommitted metadata must not enter this package's index update. Resolve a shared-index conflict explicitly instead of copying a dirty catalog wholesale. If a file or HEAD changes during preparation, refresh the preview and retry.

After the local commit, push outside Studio when ready. The destination's installed marketplace version controls update discovery, installation, review, and trust invalidation. Updating locally does not authorize execution there.

See [Preparing packages](#guide:preparing-packages), [Digests and trust](#guide:package-versions-digests-trust), and [Co-worker installation](#guide:coworker-package-installation).
