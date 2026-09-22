# Package folder structure

Choose one folder per package. A repository can contain several package roots, but roots must not nest. For example:

```text
packages/laptop-support/
  workflow-package.json
  workflows/diagnose.yaml
  workflows/diagnose.hermes.yaml
  scripts/analyze.py
  commands/interpret.md
  fixtures/snapshot.json
  README.md
  digests.json
.well-known/hermes-workflows/index.json
```

The shared marketplace index belongs outside every package root. `digests.json` is generated metadata. All other regular files beneath the root contribute exact bytes to the package digest, including unreferenced and Git-ignored files. A nested file named `fixtures/digests.json` is included; only the root `digests.json` is excluded.

Use canonical relative paths with `/`. Symlinks, Git metadata, casefold collisions, and ambiguous file/directory paths block preparation. Moving a script can change resolution; use resource actions or update references deliberately, then validate again.

If a manifest is invalid, repair its source before structured editing. Keep recovery copies outside the package if they are not intended payload.

See [Multiple workflows](#guide:multiple-workflows-per-package) and [Digest and trust changes](#guide:package-versions-digests-trust).
