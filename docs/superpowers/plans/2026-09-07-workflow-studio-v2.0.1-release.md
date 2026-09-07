# Workflow Studio v2.0.1 Local Release Preparation Plan

> **Status:** Approved for local preparation on 2026-09-07. Push, tag, workflow dispatch, draft creation, and publication require a later concrete approval.

**Goal:** Prepare and verify local Workflow Studio v2.0.1 metadata and release documentation for the completed UI customization recovery.

**Architecture:** Keep `base` as the local release source and synchronize the six npm, Cargo, and Tauri version records at `2.0.1`. Preserve v2.0.0 as an immutable historical tag and verified unpublished draft. Update the version-2 acceptance record with a distinct v2.0.1 candidate section and retain the exact v2.0.0 evidence. The existing release workflow remains version-generic.

## Scope and boundaries

- Work in `/Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio` on `base`.
- Preserve the three untracked `docs/mockups/*.png` files and every unrelated worktree.
- Prepare and verify local metadata only in this task.
- Do not push, create or move tags, dispatch workflows, create or alter GitHub releases, or publish artifacts.
- Do not rebuild full native artifacts in this task. A fresh unsigned v2.0.1 package remains a later release-preparation step.
- Keep the v2.0.0 release plan, recovery design/plan, recovery reviews, and version-1 acceptance record as historical evidence.

## Task 1: Establish the test-first v2.0.1 contract

1. Update the current-release expectations in:
   - `tests/project/release-version.test.ts`
   - `tests/installers/release-state.test.ts`
   - `tests/installers/install-script.test.ts`
   - `tests/fixtures/releases/valid-manifest.json`
   - `tests/e2e/workbench-containment.spec.ts`
2. Add assertions that active release documentation records the real v2.0.0 boundary: annotated tag `v2.0.0` peels to `aa91baac4081f0ca585b10fb3fb65b966a7ec24c`, protected release run `34042847222` succeeded, and the exact ten-asset draft remains unpublished.
3. Run the focused release tests and confirm they fail because application metadata and active documents still identify 2.0.0.

## Task 2: Synchronize the six version records

Set these records to `2.0.1`:

1. `package.json` version.
2. `package-lock.json` top-level version.
3. `package-lock.json` root-package version.
4. `src-tauri/Cargo.toml` package version.
5. `src-tauri/Cargo.lock` `workflow-studio` package version.
6. `src-tauri/tauri.conf.json` version.

Use npm's no-tag version command for npm metadata and Cargo's metadata resolution for its lockfile. Inspect the resulting diffs so dependency records do not drift.

## Task 3: Update active release documentation

Update:

- `docs/installing.md`
- `docs/releasing.md`
- `docs/security.md`
- `docs/verification/version-2-release-acceptance.md`

The documents must state that v1.0.6 remains the latest published release, v2.0.0 is tagged and has a verified unpublished ten-asset draft, and v2.0.1 is the local UI recovery candidate. Preserve the exact v2.0.0 local package size, hashes, source commits, test counts, and protected run identity in a historical section.

Record every linked worktree in the v2.0.1 preflight:

- The root `base` checkout retains three unrelated untracked mockup PNGs. They remain preserved and block tagging until explicitly disposed.
- `workflow-studio-modern-workbench` is clean.
- `.worktrees/ui-customization-recovery` is clean at the merged recovery commit.
- `.worktrees/ui-customization-panels` retains the known superseded customization source and remains untouched.

Do not edit `README.md`, `.github/workflows/release.yml`, installer scripts, generic release verifier scripts, historical plans/reviews, or the release acceptance template.

## Task 4: Focused verification and commit

Run:

```bash
npx vitest run tests/project/release-version.test.ts tests/installers/release-state.test.ts tests/installers/install-script.test.ts --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1 --exclude '.worktrees/**'
npx playwright test tests/e2e/workbench-containment.spec.ts --project=chromium --project=webkit --grep "keeps Git, version"
npm run format:check
npm run lint
npm run check
git diff --check
```

Verify that only the planned tracked files changed and that the three mockups remain untracked. Commit the local preparation as `chore: prepare Workflow Studio v2.0.1`.

## Deferred release steps

After separate approval, establish a clean tagging checkout, complete a fresh v2.0.1 unsigned native build and acceptance evidence, push the exact `base` commit, create and push one immutable annotated `v2.0.1` tag, and dispatch the protected draft-only workflow from `base`. Publication remains a separate manual decision after draft integrity verification.
