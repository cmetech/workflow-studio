# Releasing Workflow Studio

Releases are native, updater-signed, and manually published. The GitHub Actions workflow creates and verifies a **draft** only. Never publish a release from this workflow automatically.

## Preconditions and tag invariant

1. Begin with a clean checkout on `base` and pull the intended public repository state.
2. Set the same semantic version in `src-tauri/tauri.conf.json` and `package.json`.
3. Complete the version-one verification and clean-machine acceptance record.
4. Create an annotated `v<version>` tag on a commit contained in `origin/base`, then push that exact tag.

Manual workflow dispatch accepts only an existing version tag. The workflow resolves the tag to a commit, confirms it is an ancestor of `origin/base`, and confirms the tag matches the Tauri configuration. Branch names, arbitrary SHAs, invalid tags, and previously published releases are rejected.

## Native build matrix

| Runner | Target | Bundle |
|---|---|---|
| `macos-latest` | `aarch64-apple-darwin` | DMG plus updater archive/signature |
| `macos-15-intel` | `x86_64-apple-darwin` | DMG plus updater archive/signature |
| `windows-latest` | `x86_64-pc-windows-msvc` | NSIS plus updater archive/signature |
| `ubuntu-24.04` | `x86_64-unknown-linux-gnu` | AppImage plus updater archive/signature |

Every native job uses `npm ci`, `npm run verify`, `npm run contracts:check`, and `npm run examples:check` before Tauri builds. Do not add Windows/Linux ARM64 claims until native runners produce accepted installers. The operating-system artifacts are deliberately unsigned: there is no Apple notarization/Developer ID or Microsoft Authenticode identity in the workflow.

## Updater-key custody

Tauri updater signing is an integrity control and is distinct from third-party operating-system publisher signing. GitHub Actions reads only these repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Keep the private key and its password in the repository secrets and a maintainer-controlled offline recovery system. Never write them into the repository, workflow artifacts, logs, release notes, issues, or chat. Only the public key belongs in `src-tauri/tauri.conf.json`.

For rotation, generate a new key outside the repository, update the two secrets, commit the new public key in a normal reviewed change, ship an intermediate app capable of trusting the intended rotation path, and test a staged update before retiring the old key. Losing the private key means existing installations cannot verify releases under an uncoordinated replacement.

## Draft verification and publication

The release workflow resolves the tag once and uses that immutable commit SHA for every checkout and release target. It re-resolves the remote tag before release operations and stops if the tag moved. Tauri Action uploads product/version/platform/architecture-anchored assets and `latest.json` to a draft. Its final job:

1. authenticates to GitHub and resolves the exact draft by tag and commit SHA;
2. downloads every asset by its authenticated release-asset ID;
3. normalizes updater URLs to the exact public tag and uploads `latest.json`;
4. re-downloads the published `latest.json` bytes before hashing;
5. rejects empty, unknown, duplicate, ambiguous, unsafe, or cross-release assets and verifies all updater targets/signatures;
6. generates `SHA256SUMS` over only the re-downloaded public bytes and uploads it; and
7. re-downloads and validates the completed draft while leaving publication manual.

Review the workflow logs, `latest.json`, artifact names and byte sizes, `SHA256SUMS`, contract/example results, and the platform acceptance record. Download a clean copy of every artifact and independently compare its digest. Exercise a staged signed update. Only then use GitHub’s release UI to publish the draft manually.

If any native job, updater target, checksum, signature, or clean-machine platform evidence is absent, keep the draft unpublished. Never remove a target from verification simply to make a release green.

## After release work

Confirm the published `latest.json` and installer links resolve, then return the development checkout to `base`. Delete temporary keys/downloads using exact paths, retain the acceptance evidence, and start subsequent implementation branches from the updated `base`. Do not leave release work on the feature checkout.
