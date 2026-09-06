# Workflow Studio v2.0.0 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and verify the updater-signed Workflow Studio v2.0.0 native release draft containing the completed loop-group authoring and workspace-control work.

**Architecture:** Keep `base` as the release source and synchronize the npm, Cargo, and Tauri application identities at `2.0.0`. Preserve the version-1 acceptance record as history, add a version-2 acceptance record, verify a local unsigned Apple Silicon package, then push one immutable `v2.0.0` tag and let the protected GitHub Actions workflow create and verify an unpublished three-platform draft.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Playwright, Rust, Tauri 2, Git, GitHub Actions

**Spec:** `docs/releasing.md`

## Global Constraints

- `base` is the release source branch; `v2.0.0` must resolve to a commit contained in `origin/base`.
- Keep `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` synchronized at `2.0.0`.
- Preserve the immutable v1.0.5 installer bootstrap URLs because they resolve the latest published release dynamically.
- Build macOS aarch64, macOS x86_64, and Windows x86_64 NSIS/updater artifacts; keep Linux and Windows ARM64 deferred.
- Preserve v1.0.8 as an untagged historical candidate and create `docs/verification/version-2-release-acceptance.md` for v2.0.0 evidence.
- The protected workflow creates and verifies a draft only. Publication remains a separate manual decision after the draft gates pass.
- Never expose or persist updater private-key material.

---

### Task 1: Synchronize the v2.0.0 release identity

**Files:**
- Modify: `tests/project/release-version.test.ts`
- Modify: `tests/installers/release-state.test.ts`
- Modify: `tests/installers/install-script.test.ts`
- Modify: `tests/fixtures/releases/valid-manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: the existing release-version and exact-asset invariants.
- Produces: one application identity, `2.0.0`, and one release tag identity, `v2.0.0`.

- [ ] **Step 1: Change release-facing tests and fixtures to v2.0.0**

Update the current release constants, exact artifact names, updater URLs, draft lifecycle fixtures, manifest version, and test descriptions from `1.0.8`/`v1.0.8` to `2.0.0`/`v2.0.0`. Retain historical commit provenance and unrelated dependency versions.

- [ ] **Step 2: Run the focused tests and verify the synchronized-manifest test fails**

Run: `npm run test:unit -- tests/project/release-version.test.ts tests/installers/release-state.test.ts tests/installers/install-script.test.ts`

Expected: release-version assertions fail because the five application manifests still report `1.0.8`.

- [ ] **Step 3: Update only the five application version records**

Set the root npm package and lockfile records, the `workflow-studio` Cargo package and lockfile record, and the Tauri configuration to `2.0.0`. Do not replace dependency versions that happen to equal a historical application version.

- [ ] **Step 4: Run focused release tests**

Run: `npm run test:unit -- tests/project/release-version.test.ts tests/installers/release-state.test.ts tests/installers/install-script.test.ts`

Expected: the metadata and exact-release tests pass once Task 2 documentation is present.

### Task 2: Record the version-2 release boundary

**Files:**
- Modify: `README.md`
- Modify: `docs/installing.md`
- Modify: `docs/releasing.md`
- Modify: `docs/security.md`
- Modify: `docs/verification/version-1-release-acceptance.md`
- Create: `docs/verification/version-2-release-acceptance.md`
- Modify: `tests/project/release-version.test.ts`

**Interfaces:**
- Consumes: the v2.0.0 identity from Task 1 and verified v1 release history.
- Produces: truthful pre-release instructions and a new version-2 acceptance checklist.

- [ ] **Step 1: Make the documentation assertions require the version-2 record**

Require the README to link `docs/verification/version-2-release-acceptance.md`; require release docs to identify v1.0.8 as superseded without a tag or release; and require the v2 record to show the tag, draft, protected artifacts, and publication decision as open before dispatch.

- [ ] **Step 2: Run the project release test and verify it fails on the old documentation**

Run: `npm run test:unit -- tests/project/release-version.test.ts`

Expected: failure because the version-2 acceptance record and v2.0.0 candidate statements do not exist yet.

- [ ] **Step 3: Update release-facing documentation**

Add the version-2 acceptance record; update README, installation, release, and security guidance; mark the version-1 v1.0.8 candidate as superseded; retain the v1.0.5 bootstrap URLs and v1.0.6 published baseline until v2.0.0 is actually published.

- [ ] **Step 4: Run focused release tests and commit the candidate metadata**

Run: `npm run test:unit -- tests/project/release-version.test.ts tests/installers/release-state.test.ts tests/installers/install-script.test.ts`

Then commit the listed Task 1 and Task 2 files plus this plan with message `chore: prepare Workflow Studio v2.0.0`.

### Task 3: Verify and build the local release candidate

**Files:**
- Verify: complete repository
- Modify after successful build: `docs/verification/version-2-release-acceptance.md`
- Output: `dist/`
- Output: `src-tauri/target/release/bundle/macos/LOOP24 Workflow Studio.app`
- Output: `src-tauri/target/release/bundle/dmg/LOOP24 Workflow Studio_2.0.0_aarch64.dmg`

**Interfaces:**
- Consumes: the committed v2.0.0 metadata candidate.
- Produces: complete local gate evidence and an unsigned Apple Silicon package for review.

- [ ] **Step 1: Run static, contract, example, and resource gates**

Run: `npm run format:check && npm run lint && npm run check && npm run contracts:check && npm run examples:check && npm run resources:verify`

- [ ] **Step 2: Run the complete TypeScript, browser, and Rust suites**

Run: `npm run test:unit && npm run test:e2e && npm run test:rust`

- [ ] **Step 3: Build the production renderer and unsigned native package**

Run: `npm run build` and then `npx tauri build --no-sign --bundles app,dmg`.

Verify the application bundle version and identifier, executable architecture, mounted DMG payload, all bundled offline resources, and SHA-256 digests without claiming Apple Developer ID or updater signing.

- [ ] **Step 4: Record exact local evidence and commit it**

Update `docs/verification/version-2-release-acceptance.md` with the source commit, test counts, artifact byte size, package identity, resource result, and SHA-256 values. Commit with message `docs: record v2.0.0 local build evidence`.

### Task 4: Create and verify the protected draft

**Files:**
- No source changes before workflow completion.
- External output: GitHub draft release `v2.0.0` with exactly ten verified assets.

**Interfaces:**
- Consumes: a green v2.0.0 commit on `origin/base` and repository updater-signing secrets.
- Produces: immutable tag `v2.0.0` and an unpublished verified native draft.

- [ ] **Step 1: Merge the release branch into local base and rerun the release-version test**

Fast-forward `release/v2.0.0` into `base`, then run: `npm run test:unit -- tests/project/release-version.test.ts`.

- [ ] **Step 2: Push the exact base commit and immutable tag**

Run: `git push origin base`, `git tag -a v2.0.0 -m "LOOP24 Workflow Studio v2.0.0"`, and `git push origin refs/tags/v2.0.0`.

- [ ] **Step 3: Dispatch and monitor the protected draft workflow**

Run: `gh workflow run release.yml --repo cmetech/workflow-studio --ref base -f tag=v2.0.0`, identify the new run by its creation time and tag input, then monitor it with `gh run watch --exit-status`.

- [ ] **Step 4: Verify the draft boundary and stop before publication**

Confirm the draft resolves to the tagged commit, remains non-prerelease and unpublished, contains exactly ten safe unique assets, and has passing package-payload, checksum, updater metadata, and signature jobs. Present this concrete draft to the user for the separate manual publication decision required by `docs/releasing.md`.
