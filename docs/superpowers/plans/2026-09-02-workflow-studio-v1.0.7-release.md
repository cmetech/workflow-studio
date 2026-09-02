# Workflow Studio v1.0.7 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and verify the unpublished, updater-signed v1.0.7 native release draft from the documentation-and-shortcuts work merged into `base`.

**Architecture:** First close the reviewed Space-pan runtime blocker, then synchronize the application version and release-facing documentation without changing the immutable v1.0.5 bootstrap URLs. After local gates pass, push the exact `base` commit, create an immutable annotated `v1.0.7` tag, and let the protected GitHub Actions workflow build and verify the three supported native targets. The workflow must leave the release as a draft; publication remains a separate manual decision.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Playwright, Rust/Tauri 2, Git, GitHub Actions

**Spec:** `docs/releasing.md`

## Global Constraints

- `base` is the release source branch; `v1.0.7` must resolve to a commit contained in `origin/base`.
- Keep `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` synchronized at `1.0.7`.
- Keep the immutable v1.0.5 installer bootstrap URLs unchanged; they resolve the latest published release dynamically.
- Build only macOS aarch64, macOS x86_64, and Windows x86_64 NSIS/updater artifacts. Linux and Windows ARM64 remain unsupported.
- The release workflow creates and verifies a draft only. Never publish automatically.
- Do not tag or dispatch while a Critical or Important review finding remains.
- Do not expose or persist updater private-key material.

---

### Task 1: Correct the Space-pan runtime key

**Files:**
- Modify: `src/lib/commands/canvas-interactions.ts`
- Modify: `src/lib/commands/help.test.ts`
- Modify: `src/features/canvas/GraphCanvas.flow-boundary.test.ts`

**Interfaces:**
- Consumes: XYFlow `panActivationKey` exact `KeyboardEvent.key` matching.
- Produces: a runtime activation value of `' '` and the unchanged display binding `Space + drag`.

- [ ] **Step 1: Write a failing runtime-key test**

Add a test that routes a browser Space key (`KeyboardEvent.key === ' '`) through the installed XYFlow key-matching utility and expects activation, while separately asserting the display binding remains `Space + drag`.

- [ ] **Step 2: Verify the test fails with `activationKey === 'Space'`**

Run: `npm run test:unit -- src/lib/commands/help.test.ts src/features/canvas/GraphCanvas.flow-boundary.test.ts`

- [ ] **Step 3: Separate runtime and display values**

Keep `bindings: ['Space + drag']`; change only the value passed to `panActivationKey` to the browser-compatible runtime key.

- [ ] **Step 4: Run focused and static verification**

Run: `npm run test:unit -- src/lib/commands/help.test.ts src/features/canvas/GraphCanvas.flow-boundary.test.ts && npm run format:check && npm run lint && npm run check`

- [ ] **Step 5: Commit**

```bash
git add src/lib/commands/canvas-interactions.ts src/lib/commands/help.test.ts src/features/canvas/GraphCanvas.flow-boundary.test.ts
git commit -m "fix: activate canvas pan with browser space key"
```

### Task 2: Prepare synchronized v1.0.7 metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `tests/project/release-version.test.ts`
- Modify: `tests/installers/install-script.test.ts`
- Modify: `tests/installers/release-state.test.ts`
- Modify: `tests/fixtures/releases/valid-manifest.json`
- Modify: `docs/installing.md`
- Modify: `docs/releasing.md`
- Modify: `docs/security.md`
- Modify: `docs/verification/version-1-release-acceptance.md`

**Interfaces:**
- Consumes: the published v1.0.6 recovery state and immutable v1.0.5 bootstrap.
- Produces: one synchronized v1.0.7 application/release identity and a truthful pre-release acceptance record.

- [ ] **Step 1: Change the release identity tests to v1.0.7 and verify they fail**

Update the current-release assertions and release fixtures from `1.0.6`/`v1.0.6` to `1.0.7`/`v1.0.7`, while retaining dependency versions such as `same-file = "1.0.6"` and immutable historical evidence. Run: `npm run test:unit -- tests/project/release-version.test.ts tests/installers/release-state.test.ts tests/installers/install-script.test.ts`.

- [ ] **Step 2: Synchronize the five application manifests**

Set only the application/root-package records to `1.0.7` in the five required files. Do not replace unrelated dependency versions.

- [ ] **Step 3: Update release-facing documentation**

Record v1.0.6 as the latest published release, v1.0.7 as the documentation-and-shortcuts candidate, the current local verification evidence, and the still-open native draft/clean-machine gates. Keep the v1.0.5 bootstrap URLs unchanged.

- [ ] **Step 4: Run release metadata and installer tests**

Run: `npm run test:unit -- tests/project/release-version.test.ts tests/installers/release-state.test.ts tests/installers/install-script.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json tests/project/release-version.test.ts tests/installers/install-script.test.ts tests/installers/release-state.test.ts tests/fixtures/releases/valid-manifest.json docs/installing.md docs/releasing.md docs/security.md docs/verification/version-1-release-acceptance.md docs/superpowers/plans/2026-09-02-workflow-studio-v1.0.7-release.md
git commit -m "chore: prepare Workflow Studio v1.0.7"
```

### Task 3: Verify and build the release candidate

**Files:**
- Verify: the complete repository
- Output: `dist/`
- Output when a native toolchain/signing identity is available: `src-tauri/target/release/bundle/`

**Interfaces:**
- Consumes: the synchronized v1.0.7 commit.
- Produces: local gate evidence and a production renderer build; native artifacts are authoritative only when produced by the protected workflow.

- [ ] **Step 1: Run static and bundled-resource gates**

Run: `npm run format:check && npm run lint && npm run check && npm run contracts:check && npm run examples:check && npm run resources:verify`.

- [ ] **Step 2: Run complete TypeScript and browser suites**

Run: `npm run test:unit && npm run test:e2e`.

- [ ] **Step 3: Run Rust tests and the production renderer build**

Run: `npm run test:rust && npm run build`. If Cargo is absent locally, record that environment limitation and rely on the protected three-platform workflow before accepting any native draft.

- [ ] **Step 4: Confirm a clean, internally consistent release commit**

Run: `git status --short && git diff --check && npm run test:unit -- tests/project/release-version.test.ts`.

### Task 4: Tag and build the protected draft

**Files:**
- No source changes.
- External output: GitHub draft release `v1.0.7` with exactly ten verified assets.

**Interfaces:**
- Consumes: a green v1.0.7 commit on `origin/base` and repository updater-signing secrets.
- Produces: immutable `v1.0.7`, a protected Actions run, and an unpublished verified draft.

- [ ] **Step 1: Push the exact release commit to base**

```bash
git push origin base
```

- [ ] **Step 2: Create and push the immutable annotated tag**

```bash
git tag -a v1.0.7 -m "LOOP24 Workflow Studio v1.0.7"
git push origin refs/tags/v1.0.7
```

- [ ] **Step 3: Dispatch the protected workflow from base**

```bash
gh workflow run release.yml --repo cmetech/workflow-studio --ref base -f tag=v1.0.7
```

- [ ] **Step 4: Monitor the workflow to completion**

Use `gh run watch --exit-status` for the dispatched run. Do not publish the draft.

- [ ] **Step 5: Verify the draft boundary**

Confirm the draft resolves to the tagged commit, remains non-prerelease and unpublished, contains exactly ten safe unique assets, and that the workflow's package-payload, checksum, updater metadata, and signature jobs passed. Record the run and draft URLs in `docs/verification/version-1-release-acceptance.md` only in a subsequent reviewed commit; never move the tag.
