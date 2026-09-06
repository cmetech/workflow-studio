# Workflow Studio UI Customization Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the unfinished UI customization behavior on top of current v2 loop-group authoring without replacing newer scoped-canvas, reference, layout, or release behavior.

**Architecture:** Treat `.worktrees/ui-customization-panels` as read-only behavioral evidence and implement each approved capability from current `base`. Keep appearance and layout preferences outside YAML, use the existing document controller for safe disk transitions, and extend the current scoped canvas and auxiliary panel through their present interfaces. Each task begins with a failing current-baseline test, ends with focused verification and a commit, and receives a focused review before the next task.

**Tech Stack:** Svelte 5, TypeScript, Nanostores, CodeMirror 6, Svelte Flow, Vitest, Svelte Testing Library, Playwright, Rust, Tauri 2

**Spec:** `docs/superpowers/specs/2026-09-06-workflow-studio-ui-customization-recovery-design.md`

## Global Constraints

- Work only in `.worktrees/ui-customization-recovery` on `fix/ui-customization-recovery`.
- Never modify, clean, reset, stash, rebase, or commit `.worktrees/ui-customization-panels`.
- Preserve current loop-group authoring, reference scanning, scoped validation, Problems/References tabs, lower-panel resizing, and the 250-node/500-edge performance contract.
- Keep YAML as the sole workflow authority. Appearance, panel visibility, and other application state stay outside workflow YAML.
- Keep package and native versions at `2.0.0` throughout feature implementation. Prepare `2.0.1` only after separate user approval.
- Preserve the immutable `v2.0.0` tag and leave its GitHub draft unpublished.
- Do not add a user-template system. Preserve the current Examples gallery and recover only evidenced Example navigation behavior.
- For every production change: write the failing behavior test, run it and observe the intended failure, implement the smallest current-architecture change, rerun the focused test, then refactor.
- Reconcile every overlapping file from its current v2 contents. Never replace a current file with the old worktree copy.
- Use `superpowers:systematic-debugging` before changing code in response to any unexpected failure.
- Preserve unrelated user files in the main checkout.

---

## File and responsibility map

| Unit | Files | Responsibility |
| --- | --- | --- |
| Appearance domain | `src/lib/branding/appearance.ts`, `src/stores/branding.ts`, `src/lib/branding/theme-sync.ts`, `src/main.ts` | Validate, persist, and apply brightness, palette, and custom accent preferences |
| Appearance UI | `AppearanceSettings.svelte`, `AccentPicker.svelte`, `Loop24Mark.svelte`, `BrandSettings.svelte`, `App.svelte`, `StatusBar.svelte` | Expose accessible appearance controls, advanced brand packs, accent-aware built-in mark, and version |
| Document safety | `document-workspace-controller.ts`, `App.svelte` | Report dirty/save state and perform exact hash-gated revert |
| Workspace history | `recent-workspaces.ts`, `OpenWorkspace.svelte`, `App.svelte` | Remove one recent folder or clear unavailable entries through serialized storage |
| Layout/navigation | `layout/types.ts`, `layout-store.ts`, `App.svelte`, activity/docs/example components | Persist docked panel visibility and align visible back controls |
| Problems | `ProblemsPanel.svelte`, `AuxiliaryPanel.svelte` callers | Filter diagnostics through accessible counted layer tabs inside the current outer auxiliary panel |
| Repair authoring | analyzer, transactions, canvas actions/coordinator, `GraphCanvas.svelte`, `App.svelte` | Permit only narrow incomplete-node deletion and root blank-draft rebuilding while save remains blocked |
| Documentation/editor | app guides, docs navigation/index, editor extensions | Restore offline guidance and a theme-visible caret |
| Release guard | `docs/releasing.md`, `tests/project/release-version.test.ts` | Require local worktree status review before a release tag is created |

Spec coverage: R1 is Task 4; R2 is Tasks 2–4; R3 is Task 3; R4 is Task 4; R5 is Task 6; R6 is Tasks 5–6; R7 is Task 7; R8 is Task 8; R9 is preserved and reverified in Tasks 8, 9, and 13; R10 is Task 9; R11 is Task 8; R12 is Task 11; R13 and R14 are Task 10; R15 and R16 are Task 12; R17 is Task 13; R18 is Task 1; R19 is enforced by the global constraints and Tasks 8, 12, and 13.

---

### Task 1: Record the release worktree preflight

**Files:**
- Modify: `tests/project/release-version.test.ts`
- Modify: `docs/releasing.md`

**Interfaces:**
- Consumes: existing release documentation assertions and immutable-tag workflow.
- Produces: a required local pre-tag checklist that exposes dirty linked worktrees without changing CI behavior.

- [ ] **Step 1: Add a failing documentation assertion**

Extend the release documentation test with exact assertions:

```ts
const releasing = readFileSync('docs/releasing.md', 'utf8')
expect(releasing).toContain('git worktree list --porcelain')
expect(releasing).toContain('git -C "$WORKTREE_PATH" status --short --branch')
expect(releasing).toMatch(/Stop before tagging when a dirty worktree contains intended release work\./)
```

- [ ] **Step 2: Run the focused test and observe the missing-checklist failure**

Run: `npm run test:unit -- tests/project/release-version.test.ts`

Expected: FAIL because `docs/releasing.md` does not yet contain the worktree audit commands and stop condition.

- [ ] **Step 3: Add the concrete pre-tag checklist**

Add a “Local worktree preflight” section immediately before tag creation. It must direct the release owner to run:

```bash
git worktree list --porcelain
WORKTREE_PATH=/absolute/path/reported/by/the/previous/command
git -C "$WORKTREE_PATH" status --short --branch
```

State that every listed worktree must be reviewed, that unrelated dirty work may remain untouched, and: “Stop before tagging when a dirty worktree contains intended release work.” Record the disposition in the version acceptance document.

- [ ] **Step 4: Verify and commit the guard**

Run: `npm run test:unit -- tests/project/release-version.test.ts`

Expected: PASS with every application version still exactly `2.0.0`.

```bash
git add docs/releasing.md tests/project/release-version.test.ts
git commit -m "docs: require release worktree preflight"
```

---

### Task 2: Add the appearance preference domain and synchronization

**Files:**
- Create: `src/lib/branding/appearance.ts`
- Create: `src/lib/branding/appearance.test.ts`
- Create: `src/stores/appearance.test.ts`
- Modify: `src/lib/branding/theme-sync.ts`
- Modify: `src/lib/branding/theme-sync.test.ts`
- Modify: `src/stores/branding.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `BrandManifest`, `ThemeMode`, `ThemePreference`, `applyBrandTheme`, and Nanostore atoms.
- Produces: `ColorThemeId`, `AppearancePreferences`, `COLOR_THEMES`, `normalizeAccent`, `applyAppearanceTheme`, `loadAppearancePreferences`, `saveAppearancePreferences`, `colorTheme`, `customAccent`, `initializeAppearancePreferences`, `setThemePreference`, `setColorTheme`, `setCustomAccent`, and `resetAccent`.

- [ ] **Step 1: Write failing pure-domain tests**

Create tests that require these exact outcomes:

```ts
expect(normalizeAccent('#32c48d')).toBe('#32C48D')
expect(normalizeAccent('32c48d')).toBe('#32C48D')
expect(normalizeAccent('#123')).toBeNull()

applyAppearanceTheme(loadBundledBrand(), 'light', 'ocean-blue', null, root)
expect(root.dataset.brand).toBe('loop24')
expect(root.dataset.theme).toBe('light')
expect(root.style.getPropertyValue('--color-accent')).toBe('#0B6BCB')

saveAppearancePreferences(storage, { mode: 'dark', colorTheme: 'emerald', customAccent: '#123456' })
expect(loadAppearancePreferences(storage)).toEqual({
  mode: 'dark',
  colorTheme: 'emerald',
  customAccent: '#123456',
})
```

Also require malformed JSON, unsupported modes/palettes, and invalid accents to return the immutable default `{ mode: 'system', colorTheme: 'loop24-indigo', customAccent: null }`.

- [ ] **Step 2: Run the new domain tests and observe import failures**

Run: `npm run test:unit -- src/lib/branding/appearance.test.ts`

Expected: FAIL because `appearance.ts` does not exist.

- [ ] **Step 3: Implement the compact appearance model**

Define:

```ts
export type ColorThemeId = 'loop24-indigo' | 'ocean-blue' | 'emerald'

export interface AppearancePreferences {
  readonly mode: ThemePreference
  readonly colorTheme: ColorThemeId
  readonly customAccent: string | null
}

export const APPEARANCE_STORAGE_KEY = 'workflow-studio.appearance.v1'
export const COLOR_THEMES = [
  { id: 'loop24-indigo', label: 'LOOP24 Indigo', description: 'The original violet-indigo workflow palette.', accents: { light: '#5145CD', dark: '#5B50E6' } },
  { id: 'ocean-blue', label: 'Ocean Blue', description: 'A clear blue palette with cool canvas accents.', accents: { light: '#0B6BCB', dark: '#5BA8FF' } },
  { id: 'emerald', label: 'Emerald', description: 'A calm green palette for nodes and focus states.', accents: { light: '#087A55', dark: '#32C48D' } },
] as const
```

Apply the brand first, then override only accent-related semantic tokens for a non-default palette or explicit custom accent. For default LOOP24 Indigo without a custom accent, leave the active brand's token values intact. Compute `--color-accent-contrast` from WCAG relative luminance and derive selected-node/strong-accent tokens by bounded RGB mixing.

- [ ] **Step 4: Write failing store and synchronization tests**

Require initialization and every setter to persist one normalized record:

```ts
initializeAppearancePreferences(storage)
setThemePreference('light')
setColorTheme('emerald')
setCustomAccent('#32c48d')
expect(JSON.parse(storage.getItem(APPEARANCE_STORAGE_KEY)!)).toEqual({
  mode: 'light',
  colorTheme: 'emerald',
  customAccent: '#32C48D',
})
```

Require `synchronizeBrandTheme` to reapply on either atom change and unsubscribe all four stores plus the media query listener on cleanup. Extend its signature without changing existing defaults:

```ts
interface AppearanceThemeStores {
  readonly colorTheme: ReadableAtom<ColorThemeId>
  readonly customAccent: ReadableAtom<string | null>
}

export function synchronizeBrandTheme(
  brandStore: ReadableAtom<BrandManifest>,
  preferenceStore: ReadableAtom<ThemePreference>,
  root: HTMLElement = document.documentElement,
  environment: Pick<Window, 'matchMedia'> = window,
  appearance?: AppearanceThemeStores,
): () => void
```

- [ ] **Step 5: Run the focused state tests and observe missing exports/behavior**

Run: `npm run test:unit -- src/stores/appearance.test.ts src/lib/branding/theme-sync.test.ts`

Expected: FAIL because the appearance stores and synchronization inputs do not exist.

- [ ] **Step 6: Integrate state without weakening brand validation**

Add these public signatures to `src/stores/branding.ts`:

```ts
export const colorTheme = atom<ColorThemeId>('loop24-indigo')
export const customAccent = atom<string | null>(null)
export function initializeAppearancePreferences(storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): void
export function setThemePreference(preference: ThemePreference): void
export function setColorTheme(theme: ColorThemeId): void
export function setCustomAccent(value: string): void
export function resetAccent(): void
```

Keep `createBrandController` validation and activation flows unchanged; replace only theme application with `applyAppearanceTheme`. `setColorTheme` clears an explicit accent before persisting, invalid custom accent input leaves the current value unchanged, and storage read/write errors never prevent in-memory appearance changes. Initialize preferences in `main.ts` before starting synchronization, then call:

```ts
synchronizeBrandTheme(activeBrandManifest, themePreference, document.documentElement, window, {
  colorTheme,
  customAccent,
})
```

- [ ] **Step 7: Verify and commit appearance state**

Run:

```bash
npm run test:unit -- src/lib/branding/appearance.test.ts src/stores/appearance.test.ts src/lib/branding/theme-sync.test.ts src/stores/branding.test.ts
npm run check
```

Expected: all focused tests pass and Svelte/TypeScript checking reports zero errors and warnings.

```bash
git add src/lib/branding/appearance.ts src/lib/branding/appearance.test.ts src/stores/appearance.test.ts src/lib/branding/theme-sync.ts src/lib/branding/theme-sync.test.ts src/stores/branding.ts src/main.ts
git commit -m "feat: restore appearance preferences"
```

---

### Task 3: Restore Settings appearance controls and advanced brand packs

**Files:**
- Create: `src/features/branding/AppearanceSettings.svelte`
- Create: `src/features/branding/AppearanceSettings.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `tests/e2e/modal-layout.spec.ts`

**Interfaces:**
- Consumes: Task 2 appearance stores/setters and the existing `BrandSettings` callbacks.
- Produces: accessible palette and brightness radio groups plus an Advanced brand packs disclosure.

- [ ] **Step 1: Write failing component behavior tests**

Require three palette radios, three brightness radios, roving focus, and immediate callbacks:

```ts
expect(screen.getAllByRole('radio', { name: /LOOP24 Indigo|Ocean Blue|Emerald/ })).toHaveLength(3)
await fireEvent.keyDown(screen.getByRole('radio', { name: 'LOOP24 Indigo' }), { key: 'ArrowRight' })
expect(screen.getByRole('radio', { name: 'Ocean Blue' })).toHaveFocus()
expect(onColorTheme).toHaveBeenCalledWith('ocean-blue')
await fireEvent.keyDown(screen.getByRole('radio', { name: 'System' }), { key: 'End' })
expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus()
```

In `App.test.ts`, require Appearance to render first, the Advanced disclosure to start closed, and Import brand pack to become visible after opening it.

- [ ] **Step 2: Run the focused tests and observe missing UI failures**

Run: `npm run test:unit -- src/features/branding/AppearanceSettings.test.ts src/app/App.test.ts`

Expected: FAIL because the component and disclosure do not exist.

- [ ] **Step 3: Implement the appearance page**

Implement `AppearanceSettings` with these props:

```ts
interface Props {
  mode: ThemePreference
  colorTheme: ColorThemeId
  onMode: (mode: ThemePreference) => void
  onColorTheme: (theme: ColorThemeId) => void
}
```

Use button-backed `role="radio"` controls with `aria-checked`, one `tabindex="0"` item per group, and Arrow/Home/End navigation. Theme cards show a bounded static preview and descriptive copy.

Wrap the current `BrandSettings` instance in:

```svelte
<details class="advanced-brand-packs">
  <summary>Advanced brand packs</summary>
  <p>Brand packs replace product identity assets and the full semantic token set. Most users only need the color themes above.</p>
  <BrandSettings ... />
</details>
```

Do not alter import, preview, activate, remove, modal, or native brand-pack behavior.

- [ ] **Step 4: Update modal E2E setup and verify**

Open the Advanced disclosure before locating Import/Remove in both existing brand modal geometry flows.

Run:

```bash
npm run test:unit -- src/features/branding/AppearanceSettings.test.ts src/app/App.test.ts
npx playwright test tests/e2e/modal-layout.spec.ts --project=chromium
```

Expected: focused component and Chromium modal tests pass.

- [ ] **Step 5: Commit the Settings slice**

```bash
git add src/features/branding/AppearanceSettings.svelte src/features/branding/AppearanceSettings.test.ts src/app/App.svelte src/app/App.test.ts tests/e2e/modal-layout.spec.ts
git commit -m "feat: restore appearance settings"
```

---

### Task 4: Restore the footer version, accent picker, and LOOP24 mark

**Files:**
- Create: `src/features/branding/AccentPicker.svelte`
- Create: `src/features/branding/AccentPicker.test.ts`
- Create: `src/features/branding/Loop24Mark.svelte`
- Modify: `src/app/StatusBar.svelte`
- Modify: `src/app/StatusBar.test.ts`
- Modify: `src/features/branding/BrandSettings.svelte`
- Modify: `src/features/branding/BrandSettings.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `tests/e2e/branding.spec.ts`
- Modify: `tests/e2e/workbench-containment.spec.ts`

**Interfaces:**
- Consumes: Task 2 appearance stores and `package.json` metadata.
- Produces: `AccentPicker` callbacks and an inline accent-aware built-in mark.

- [ ] **Step 1: Write failing footer and picker tests**

Require neutral updater states to show the actual package version and active phases to retain their existing labels:

```ts
expect(screen.getByText(`Version: ${packageMetadata.version}`)).toBeVisible()
setUpdateStateForTest({ phase: 'available', version: '2.0.1' })
expect(screen.getByText('Update Available: 2.0.1')).toBeVisible()
```

Require the accent popover to normalize a typed value, disable invalid Apply, reset, close on Escape with focus restoration, and close on outside pointer press.

- [ ] **Step 2: Run focused tests and observe missing version/picker failures**

Run: `npm run test:unit -- src/app/StatusBar.test.ts src/features/branding/AccentPicker.test.ts`

Expected: FAIL because StatusBar still says `Updates: Current` and AccentPicker is absent.

- [ ] **Step 3: Implement the footer control and version label**

Use this neutral-state branch:

```ts
if (!update || update.phase === 'idle' || update.phase === 'current' || update.phase === 'offline') {
  return `Version: ${packageMetadata.version}`
}
```

Render `AccentPicker` after the update label. Its props are:

```ts
interface Props {
  accent: string | null
  fallbackAccent: string
  onAccent: (accent: string) => void
  onReset: () => void
}
```

Keep the popover inside the footer, above the trigger, keyboard reachable, and contained at narrow widths.

- [ ] **Step 4: Add the accent-aware built-in mark**

Create `Loop24Mark.svelte` as inert inline SVG with `data-loop24-mark`, `data-loop24-tile`, and `data-loop24-glyph`. Its tile uses `var(--color-accent-contrast)` and its glyph uses `var(--color-accent)`. Render it only for `pack.builtIn` and the built-in shell lockup; continue rendering validated `<img>` assets for imported packs.

- [ ] **Step 5: Add browser behavior coverage**

Extend branding E2E to select Light and Ocean Blue, set `#FAD22D`, verify the root accent and mark colors, reload, and assert:

```ts
expect(JSON.parse(localStorage.getItem('workflow-studio.appearance.v1') ?? '{}')).toEqual({
  mode: 'light',
  colorTheme: 'ocean-blue',
  customAccent: '#FAD22D',
})
```

Update containment coverage to expect `Version: 2.0.0` and verify the accent popover remains reachable.

- [ ] **Step 6: Verify and commit the footer/mark slice**

Run:

```bash
npm run test:unit -- src/app/StatusBar.test.ts src/features/branding/AccentPicker.test.ts src/features/branding/BrandSettings.test.ts src/app/App.test.ts src/lib/branding/theme-sync.test.ts
npx playwright test tests/e2e/branding.spec.ts tests/e2e/workbench-containment.spec.ts --project=chromium
```

Expected: all focused tests pass with the package version still `2.0.0`.

```bash
git add src/features/branding/AccentPicker.svelte src/features/branding/AccentPicker.test.ts src/features/branding/Loop24Mark.svelte src/app/StatusBar.svelte src/app/StatusBar.test.ts src/features/branding/BrandSettings.svelte src/features/branding/BrandSettings.test.ts src/app/App.svelte src/app/App.test.ts tests/e2e/branding.spec.ts tests/e2e/workbench-containment.spec.ts
git commit -m "feat: restore version and accent controls"
```

---

### Task 5: Add exact, conflict-safe revert to the document controller

**Files:**
- Modify: `src/features/documents/document-workspace-controller.ts`
- Modify: `src/features/documents/document-workspace-controller.test.ts`

**Interfaces:**
- Consumes: controller `read`, recovery, recovery-drafts, history, `handleExternalChange`, and current pair revision helpers.
- Produces: `revertToSaved(): Promise<'reverted' | 'conflict' | 'unavailable'>`.

- [ ] **Step 1: Write failing controller tests**

Create one test where both disk hashes still match and require exact disk text, clean revisions, empty history, discarded recovery, and a normal `open` analysis schedule. Create a second test where the disk hash changed and require:

```ts
await expect(controller.revertToSaved()).resolves.toBe('conflict')
expect($documentSession.get().pair?.definition.text).toBe('name: mine\n')
expect($documentWorkspace.get().conflict?.disk.text).toBe('name: changed elsewhere\n')
expect(deps.recovery.discard).not.toHaveBeenCalled()
```

Also cover activation changing during the asynchronous read and a pair without a saved disk hash; both return `unavailable` without publishing stale state.

- [ ] **Step 2: Run the controller tests and observe the missing-method failure**

Run: `npm run test:unit -- src/features/documents/document-workspace-controller.test.ts`

Expected: FAIL because `revertToSaved` is undefined.

- [ ] **Step 3: Implement the hash-gated controller transition**

Add:

```ts
async revertToSaved(): Promise<'reverted' | 'conflict' | 'unavailable'>
```

Snapshot activation generation and exact pair revision; read definition and existing companion concurrently; recheck publication, generation, and pair revision; compare returned hashes with saved hashes. Route a mismatch through `handleExternalChange`. On a match, install exact disk text with incremented current/saved revisions, set `savedGeneration`, clear history, update recovery-draft tracking, discard persisted recovery, clear prior save/conflict outcomes, and schedule analysis with reason `open`.

- [ ] **Step 4: Verify and commit the controller transition**

Run: `npm run test:unit -- src/features/documents/document-workspace-controller.test.ts src/lib/recovery/recovery-store.test.ts src/lib/documents/revisions.test.ts`

Expected: all focused lifecycle tests pass.

```bash
git add src/features/documents/document-workspace-controller.ts src/features/documents/document-workspace-controller.test.ts
git commit -m "feat: add safe workflow revert"
```

---

### Task 6: Restore visible Save, dirty status, and Revert controls

**Files:**
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `tests/e2e/workspace-authoring.spec.ts`
- Modify: `tests/e2e/invalid-yaml-recovery.spec.ts`
- Modify: `src/e2e/bootstrap.ts`

**Interfaces:**
- Consumes: Task 5 `revertToSaved`, existing `documentWorkspace.save`, pair dirty calculation, ModalShell, and command save handler.
- Produces: one visible document status region and explicit Save/Revert actions.

- [ ] **Step 1: Write failing shell tests**

Open a dirty writable pair and require:

```ts
expect(screen.getByRole('status', { name: 'Document save status' })).toHaveTextContent('Unsaved changes')
expect(screen.getByRole('button', { name: 'Save workflow' })).toBeEnabled()
await fireEvent.click(screen.getByRole('button', { name: 'Revert to saved YAML' }))
expect(screen.getByRole('dialog', { name: 'Revert to saved YAML?' })).toBeVisible()
```

Add clean, saving, read-only, missing-file, successful-save, successful-revert, and revert-conflict assertions. Verify the existing Mod+S handler and the button call the same save function and cannot overlap.

- [ ] **Step 2: Run the focused shell test and observe missing controls**

Run: `npm run test:unit -- src/app/App.test.ts`

Expected: FAIL because document status, Save, and Revert controls are absent.

- [ ] **Step 3: Implement one shared save path and the confirmation flow**

Track `documentSavePending` locally. Derive dirty/read-only state from the active pair and workspace entry. Make both `setDocumentSaveHandler` and the visible button call:

```ts
async function saveCurrentDocument(): Promise<void> {
  if (documentSavePending) return
  documentSavePending = true
  try {
    await documentWorkspace.save()
  } finally {
    documentSavePending = false
  }
}
```

Render status and controls in the current editor toolbar without removing docked panel toggles or compact Split tabs. Revert opens ModalShell, explains exact disk restoration, calls `revertToSaved`, and leaves the existing conflict UI responsible for a `conflict` result.

- [ ] **Step 4: Add complete browser journeys**

Seed exact saved and recovery text in `src/e2e/bootstrap.ts`. Cover dirty status, successful Save, exact Revert, and external conflict in Chromium. Confirm a structurally invalid draft stays blocked from Save even though Revert is available.

- [ ] **Step 5: Verify and commit visible document state**

Run:

```bash
npm run test:unit -- src/app/App.test.ts src/features/documents/document-workspace-controller.test.ts
npx playwright test tests/e2e/workspace-authoring.spec.ts tests/e2e/invalid-yaml-recovery.spec.ts --project=chromium
```

Expected: all focused tests pass; existing save-blocked and conflict messages remain intact.

```bash
git add src/app/App.svelte src/app/App.test.ts tests/e2e/workspace-authoring.spec.ts tests/e2e/invalid-yaml-recovery.spec.ts src/e2e/bootstrap.ts
git commit -m "feat: restore visible workflow save state"
```

---

### Task 7: Restore recent-folder cleanup

**Files:**
- Modify: `src/lib/workspace/recent-workspaces.ts`
- Modify: `src/lib/workspace/recent-workspaces.test.ts`
- Modify: `src/features/workspace/OpenWorkspace.svelte`
- Modify: `src/features/workspace/OpenWorkspace.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`

**Interfaces:**
- Consumes: existing serialized recent-workspace store and App workspace operation wrapper.
- Produces: `RecentWorkspaceStore.remove(rootPath)` and `RecentWorkspaceStore.clearUnavailable()` plus component callbacks.

- [ ] **Step 1: Write failing store tests**

Require `remove('/remove')` to retain only other records and `clearUnavailable()` to call `isAvailable` for each current record and retain available records in current order. Require an empty/whitespace remove path to reject with `TypeError`.

- [ ] **Step 2: Run store tests and observe missing methods**

Run: `npm run test:unit -- src/lib/workspace/recent-workspaces.test.ts`

Expected: FAIL because `remove` and `clearUnavailable` are not part of the store.

- [ ] **Step 3: Implement both mutations through the existing queue**

Extend the interface exactly:

```ts
remove(rootPath: string): Promise<void>
clearUnavailable(): Promise<void>
```

Both operations must chain onto `queue`, reuse normalized `records()`, and write one JSON array. `clearUnavailable` may check availability concurrently but must preserve the record order.

- [ ] **Step 4: Write failing component/App tests**

Require `Remove /available from recent folders` to call `onRemoveRecent('/available')`. Render `Clear unavailable folders` only when at least one item is unavailable and require it to call `onClearUnavailable()`.

- [ ] **Step 5: Integrate accessible controls and refresh the list**

Add component props:

```ts
onRemoveRecent?: (rootPath: string) => void | Promise<void>
onClearUnavailable?: () => void | Promise<void>
```

Keep the folder row open action separate from its X icon remove action. In App, call the store method through `runWorkspaceOperation`, then reload recent entries.

- [ ] **Step 6: Verify and commit recent-folder cleanup**

Run: `npm run test:unit -- src/lib/workspace/recent-workspaces.test.ts src/features/workspace/OpenWorkspace.test.ts src/app/App.test.ts`

Expected: all focused tests pass.

```bash
git add src/lib/workspace/recent-workspaces.ts src/lib/workspace/recent-workspaces.test.ts src/features/workspace/OpenWorkspace.svelte src/features/workspace/OpenWorkspace.test.ts src/app/App.svelte src/app/App.test.ts
git commit -m "feat: restore recent folder cleanup"
```

---

### Task 8: Persist docked panel visibility and align back controls

**Files:**
- Modify: `src/lib/layout/types.ts`
- Modify: `src/lib/layout/layout-store.ts`
- Modify: `src/lib/layout/layout-store.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `src/app/ActivityPage.svelte`
- Modify: `src/app/ActivityPage.test.ts`
- Modify: `src/features/documentation/DocumentationArticle.svelte`
- Modify: `src/features/documentation/DocumentationArticle.test.ts`
- Modify: `src/features/examples/ExampleGallery.svelte`
- Modify: `src/features/examples/ExampleGallery.test.ts`
- Modify: `tests/e2e/workbench-layout.spec.ts`

**Interfaces:**
- Consumes: current `LayoutRecordV2`, layout sanitization/cloning, panel toggles, and current loop `GraphScopeHeader` presentation.
- Produces: optional record-level `collapsedPanels: { left: boolean; right: boolean }` defaulted to both false.

- [ ] **Step 1: Write failing layout migration tests**

Require valid state to round-trip and old/malformed values to default safely:

```ts
expect(loaded?.collapsedPanels).toEqual({ left: true, right: true })
expect(oldRecordLoaded?.collapsedPanels).toEqual({ left: false, right: false })
expect(malformedLoaded?.collapsedPanels).toEqual({ left: false, right: false })
```

Also prove the returned object is cloned and does not alias stored input.

- [ ] **Step 2: Run layout tests and observe the missing field failure**

Run: `npm run test:unit -- src/lib/layout/layout-store.test.ts`

Expected: FAIL because `LayoutRecordV2` and sanitization do not expose collapsed panel state.

- [ ] **Step 3: Add the compatible optional field**

Extend `LayoutRecordV2`:

```ts
readonly collapsedPanels?: { readonly left: boolean; readonly right: boolean }
```

Sanitize with a strict two-boolean predicate. Persist and clone valid values; emit `{ left: false, right: false }` for absent or malformed input. Keep schema version 2 and every `scopeLayouts` field unchanged.

- [ ] **Step 4: Write failing App persistence tests**

Require current docked toggles to initialize from the active layout, save changes through the current layout persistence path, survive workflow reopen, and remain unchanged while compact drawers open or close.

- [ ] **Step 5: Connect current toggles to current layout state**

On active workflow identity change, initialize `dockedWorkspacePanelOpen` and `dockedInspectorPanelOpen` from `collapsedPanels`. On a docked toggle, update local atoms immediately and persist a new active layout with only `collapsedPanels` changed. Do not write during responsive transition to drawer mode.

- [ ] **Step 6: Write failing back-control presentation tests**

For ActivityPage, DocumentationArticle, and ExampleGallery, require `data-variant="secondary"`, a left-arrow SVG, and the existing accessible name. Do not change navigation callbacks or focus restoration.

- [ ] **Step 7: Apply the established loop-scope button treatment**

Use `ArrowLeft`, inline-flex alignment, and the current secondary button tokens. Add a small `var(--color-shadow)` shadow matching `GraphScopeHeader`; remove it under forced colors. Keep reduced-motion behavior.

- [ ] **Step 8: Verify layout/navigation and commit**

Run:

```bash
npm run test:unit -- src/lib/layout/layout-store.test.ts src/app/App.test.ts src/app/ActivityPage.test.ts src/features/documentation/DocumentationArticle.test.ts src/features/examples/ExampleGallery.test.ts src/features/documents/AuxiliaryPanel.test.ts
npx playwright test tests/e2e/workbench-layout.spec.ts tests/e2e/activity-pages.spec.ts tests/e2e/examples-and-docs.spec.ts --project=chromium
```

Expected: panel persistence, current lower-panel resize, outer Problems/References tabs, and every back-navigation flow pass.

```bash
git add src/lib/layout/types.ts src/lib/layout/layout-store.ts src/lib/layout/layout-store.test.ts src/app/App.svelte src/app/App.test.ts src/app/ActivityPage.svelte src/app/ActivityPage.test.ts src/features/documentation/DocumentationArticle.svelte src/features/documentation/DocumentationArticle.test.ts src/features/examples/ExampleGallery.svelte src/features/examples/ExampleGallery.test.ts tests/e2e/workbench-layout.spec.ts
git commit -m "feat: persist panels and clarify back navigation"
```

---

### Task 9: Add counted validation-layer tabs inside Problems

**Files:**
- Modify: `src/features/documents/ProblemsPanel.svelte`
- Modify: `src/features/documents/ProblemsPanel.test.ts`
- Modify: `src/features/documents/AuxiliaryPanel.test.ts`
- Modify: `src/app/App.test.ts`
- Modify: `tests/e2e/workbench-layout.spec.ts`

**Interfaces:**
- Consumes: `IssueLayer`, current issue identity/grouping, `hosted` mode, and outer AuxiliaryPanel scroll ownership.
- Produces: internal Syntax/Contract/Semantic/Compatibility/Operational tab selection with counted labels.

- [ ] **Step 1: Write failing layer-tab tests**

Require all five tabs and filtered content:

```ts
expect(screen.getByRole('tab', { name: 'Syntax 0' })).toBeVisible()
expect(screen.getByRole('tab', { name: 'Contract 1' })).toHaveAttribute('aria-selected', 'true')
expect(screen.queryByText('Provider is not configured.')).not.toBeInTheDocument()
await fireEvent.click(screen.getByRole('tab', { name: 'Operational 1' }))
expect(screen.getByText('Provider is not configured.')).toBeVisible()
```

Require ArrowLeft/ArrowRight, ArrowUp/ArrowDown, Home, and End to move selection/focus; require zero-count layers to show `No syntax problems.` style empty copy. Add an asynchronous rerender test that selects the first populated layer only before the user makes an explicit selection.

- [ ] **Step 2: Run Problems tests and observe missing tabs**

Run: `npm run test:unit -- src/features/documents/ProblemsPanel.test.ts`

Expected: FAIL because the current panel renders layer headings instead of tabs.

- [ ] **Step 3: Implement filtered groups without duplicating outer chrome**

Keep the fixed layer order:

```ts
const layers: readonly IssueLayer[] = ['syntax', 'contract', 'semantic', 'compatibility', 'operational']
```

Filter current file groups by active layer. Preserve the current total/blocking summary only when `hosted === false`; the outer AuxiliaryPanel continues to own the summary and scrolling when hosted. Keep `issueViewKey`, scoped workflow/group/node context, docs actions, duplicate ordinals, and focus commands unchanged.

- [ ] **Step 4: Verify nested tabs and commit**

Run:

```bash
npm run test:unit -- src/features/documents/ProblemsPanel.test.ts src/features/documents/AuxiliaryPanel.test.ts src/app/App.test.ts
npx playwright test tests/e2e/workbench-layout.spec.ts --project=chromium
```

Expected: layer tabs work inside both root Problems and loop-group Problems without changing the outer Problems/References selection or scroll state.

```bash
git add src/features/documents/ProblemsPanel.svelte src/features/documents/ProblemsPanel.test.ts src/features/documents/AuxiliaryPanel.test.ts src/app/App.test.ts tests/e2e/workbench-layout.spec.ts
git commit -m "feat: organize problems by validation layer"
```

---

### Task 10: Restore root blank-draft and incomplete-node repair semantics

**Files:**
- Modify: `src/lib/validation/analyze-workflow.ts`
- Modify: `src/lib/validation/analyze-workflow.test.ts`
- Modify: `src/lib/documents/transactions.ts`
- Modify: `src/lib/documents/transactions.test.ts`
- Modify: `src/features/canvas/canvas-actions.ts`
- Modify: `src/features/canvas/canvas-actions.test.ts`
- Modify: `src/features/canvas/canvas-authoring-coordinator.ts`
- Modify: `src/features/canvas/canvas-authoring-coordinator.test.ts`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.canvas-authoring.test.ts`
- Modify: `src/e2e/bootstrap.ts`
- Modify: `tests/e2e/invalid-yaml-recovery.spec.ts`
- Modify: `tests/e2e/workspace-authoring.spec.ts`

**Interfaces:**
- Consumes: current contract-driven `visuallyAuthorable`, scoped repair draft, prevalidated analysis, current scope lease, and delete-impact flow.
- Produces: root empty-list authorability plus a delete-only repair context.

- [ ] **Step 1: Write failing analyzer tests for exact root emptiness**

Require only this narrow case to project:

```ts
const analysis = await analyzeWorkflowPair(
  request(activeContract, 'name: Blank\ndescription: Start over\nnodes: []\n'),
  activeContract,
)
expect(analysis).toMatchObject({
  structurallyValid: false,
  visuallyAuthorable: true,
  issues: [expect.objectContaining({ code: 'schema_min_items', path: '/nodes', blocking: true })],
})
expect(analysis.projection).toMatchObject({ graphs: [expect.objectContaining({ nodes: [], edges: [] })] })
```

Require extra blocking issues, absent/non-array `nodes`, unknown fields, topology errors, reference errors, contract mismatch, and unsupported contracts to remain non-authorable.

- [ ] **Step 2: Run analyzer tests and observe the empty-root failure**

Run: `npm run test:unit -- src/lib/validation/analyze-workflow.test.ts`

Expected: FAIL because no draft node currently means `visuallyAuthorable` is false.

- [ ] **Step 3: Extend only the contract-driven authorability predicate**

In `draftIssuesAreVisuallyAuthorable`, after resolving the contract-published nodes path, accept an empty array only when every blocking issue is the definition contract's `schema_min_items` at that exact nodes path. Keep all current reference, integer, compatibility, scoped, and contract activation phases unchanged.

- [ ] **Step 4: Write failing mutation tests for delete-to-blank and progressive repair**

Require deleting every root node to produce one undoable replacement with metadata preserved and an attached prevalidated analysis:

```ts
expect(result).toMatchObject({ status: 'committed' })
expect(current.definition.text).toBe('name: Canvas actions\ndescription: Action fixture\nnodes:\n  []\n')
expect(commit).toHaveBeenCalledOnce()
expect(commit.mock.calls[0]?.[2]).toMatchObject({
  structurallyValid: false,
  visuallyAuthorable: true,
})
```

Require deleting one incomplete node while another remains, deleting the last child in an existing loop body, and adding the first root node back. Require comment, unrelated YAML, and final-newline preservation.

- [ ] **Step 5: Implement repair-only deletion through current scoped actions**

Allow `delete-node` as a progressive draft mutation only when the resulting analysis is narrowly `visuallyAuthorable`. Pass prevalidated analysis through the current commit path instead of scheduling duplicate analysis. Add an optional coordinator dependency:

```ts
readonly getDeleteContext?: () => CanvasActionContext | CanvasAuthoringUnavailable
```

Use it only for preview/delete. Other actions continue using the normal context and remain paused in repair mode.

- [ ] **Step 6: Expose repair/blank state to GraphCanvas and App**

Add explicit `repairMode` and `blankDraft` props. Allow Add/Drop only for an exact blank draft. Allow node deletion in repair mode. Keep connect, drag, duplicate, paste, rename, and edge deletion unavailable while the document is otherwise stale. Show distinct status copy for blank drafts and incomplete-node repair.

- [ ] **Step 7: Add browser repair journeys**

Cover recovery of an incomplete Script node by deletion, delete-all to a save-blocked root blank draft, undo, add the first node, complete its required field, Save, and reopen. Confirm loop body repair and loop reference behavior still pass.

- [ ] **Step 8: Verify and commit repair semantics**

Run:

```bash
npm run test:unit -- src/lib/validation/analyze-workflow.test.ts src/lib/documents/transactions.test.ts src/features/canvas/canvas-actions.test.ts src/features/canvas/canvas-authoring-coordinator.test.ts src/features/canvas/GraphCanvas.test.ts src/app/App.canvas-authoring.test.ts
npx playwright test tests/e2e/invalid-yaml-recovery.spec.ts tests/e2e/workspace-authoring.spec.ts tests/e2e/loop-group-authoring.spec.ts --project=chromium
```

Expected: root and scoped repair journeys pass while save/export remain contract-blocked until structural validity returns.

```bash
git add src/lib/validation/analyze-workflow.ts src/lib/validation/analyze-workflow.test.ts src/lib/documents/transactions.ts src/lib/documents/transactions.test.ts src/features/canvas/canvas-actions.ts src/features/canvas/canvas-actions.test.ts src/features/canvas/canvas-authoring-coordinator.ts src/features/canvas/canvas-authoring-coordinator.test.ts src/features/canvas/GraphCanvas.svelte src/features/canvas/GraphCanvas.test.ts src/app/App.svelte src/app/App.canvas-authoring.test.ts src/e2e/bootstrap.ts tests/e2e/invalid-yaml-recovery.spec.ts tests/e2e/workspace-authoring.spec.ts
git commit -m "feat: restore safe canvas repair drafts"
```

---

### Task 11: Restore accessible node context actions

**Files:**
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `src/lib/commands/registry.ts`
- Modify: `src/lib/commands/registry.test.ts`
- Modify: `src/lib/commands/types.ts`
- Modify: `src/app/App.canvas-authoring.test.ts`
- Modify: `tests/e2e/workspace-authoring.spec.ts`

**Interfaces:**
- Consumes: current command registry, Task 10 repair capability, canvas selection store, and `onRequestDelete`.
- Produces: mouse/keyboard node menu and `CommandContext.canRepair?: boolean` for delete-only enablement.

- [ ] **Step 1: Write failing canvas interaction tests**

Require right-click on a selected node to preserve multi-selection, right-click on an unselected node to select only it, Shift+F10/ContextMenu to open at the focused node, Escape/outside pointer to close, and Arrow/Home/End navigation. Require actions named Open Inspector, Duplicate Selection, Select All Nodes, Delete Selection, and Delete All Nodes.

Verify the existing `multiSelectionKey={['Meta', 'Control']}` behavior with both modifiers instead of adding a second selection implementation.

- [ ] **Step 2: Run GraphCanvas tests and observe the missing-menu failure**

Run: `npm run test:unit -- src/features/canvas/GraphCanvas.test.ts`

Expected: FAIL because no node actions menu is rendered.

- [ ] **Step 3: Add narrow repair command enablement**

Extend `CommandContext` with `canRepair?: boolean`. In the registry, permit only `deleteSelection` when `canMutate` is false and `canRepair` is true:

```ts
!options.mutating || context.canMutate || (action === 'deleteSelection' && context.canRepair === true)
```

Add a test proving duplicate/paste/rename stay disabled in the same context.

- [ ] **Step 4: Implement the menu from resolved commands**

Resolve command labels and enablement from the current command surface for Inspector, Duplicate, and Delete. The Select All and Delete All rows call the same selection/delete primitives as keyboard and toolbar flows. Position inside the canvas bounds, focus the first enabled item, restore focus on Escape, and close on outside pointer press. Do not parse YAML, validate, persist layout, query Git, or perform file I/O when opening or navigating the menu.

- [ ] **Step 5: Verify browser behavior and commit**

Run:

```bash
npm run test:unit -- src/lib/commands/registry.test.ts src/features/canvas/GraphCanvas.test.ts src/app/App.canvas-authoring.test.ts
npx playwright test tests/e2e/workspace-authoring.spec.ts --project=chromium
```

Expected: accessible menu, current multi-selection, confirmation, undo, and repair-only delete behavior pass.

```bash
git add src/features/canvas/GraphCanvas.svelte src/features/canvas/GraphCanvas.test.ts src/lib/commands/registry.ts src/lib/commands/registry.test.ts src/lib/commands/types.ts src/app/App.canvas-authoring.test.ts tests/e2e/workspace-authoring.spec.ts
git commit -m "feat: restore canvas node actions"
```

---

### Task 12: Restore offline guidance and theme-visible YAML caret

**Files:**
- Create: `docs/app-guides/node-types.md`
- Modify: `docs/app-guides/conditions-and-outputs.md`
- Modify: `docs/app-guides/dag-dependencies.md`
- Modify: `docs/app-guides/loops-and-approvals.md`
- Modify: `docs/app-guides/quick-start.md`
- Modify: `docs/app-guides/retry-and-triggers.md`
- Modify: `src/lib/docs/navigation.ts`
- Modify: `src/lib/docs/navigation.test.ts`
- Modify: `src/lib/docs/build-index.test.ts`
- Modify: `src/features/documentation/DocumentationOverview.test.ts`
- Modify: `src/features/editor/editor-extensions.ts`
- Modify: `src/features/editor/editor-extensions.test.ts`
- Modify: `tests/e2e/workspace-authoring.spec.ts`
- Modify when the guide digest changes: `src-tauri/resources/setup-integrity-v1.json`

**Interfaces:**
- Consumes: current guide index, contract-derived `node_kinds`, scoped reference documentation, and CodeMirror theme extension.
- Produces: searchable `guide:node-types`, clearer runtime boundaries, and caret tokens derived from `--color-focus`.

- [ ] **Step 1: Write failing guide-index tests**

Require `guide:node-types` in Getting Started and Start Here, a `choose-node-type` task, and every supported contract node topic's first related topic to be `guide:node-types`. Derive node coverage by iterating `activeContract.node_kinds`; do not list node IDs in production code.

- [ ] **Step 2: Run docs tests and observe the missing-guide failure**

Run: `npm run test:unit -- src/lib/docs/navigation.test.ts src/lib/docs/build-index.test.ts src/features/documentation/DocumentationOverview.test.ts`

Expected: FAIL because the guide file and navigation entry are absent.

- [ ] **Step 3: Add and merge the guides**

Create sections for Command, Prompt, Bash, Script, Loop, Approval, Cancel, and shared fields. Merge dependency, output-path, loop, approval, cancellation, retry, and trigger explanations with current loop-group/reference text. State where Workflow Studio validates structure and where runtime execution remains outside the app. Use valid literal YAML examples and current contract anchors.

- [ ] **Step 4: Write a failing caret-theme test**

Inspect the generated CodeMirror theme extension and require:

```ts
'.cm-content': { caretColor: 'var(--color-focus)' }
'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-focus)', borderLeftWidth: '2px' }
'.cm-fat-cursor': { backgroundColor: 'var(--color-focus)' }
```

- [ ] **Step 5: Apply caret tokens and verify all offline resources**

Run:

```bash
npm run test:unit -- src/lib/docs/navigation.test.ts src/lib/docs/build-index.test.ts src/features/documentation/DocumentationOverview.test.ts src/features/editor/editor-extensions.test.ts
npm run contracts:check
npm run examples:check
npm run resources:sync-integrity
npm run resources:verify
npx playwright test tests/e2e/examples-and-docs.spec.ts tests/e2e/workspace-authoring.spec.ts --project=chromium
```

Expected: guide indexing, examples, resource integrity, and caret browser evidence pass. `resources:sync-integrity` may modify only the committed setup integrity manifest if the new bundled guide changes its digest.

- [ ] **Step 6: Commit documentation/editor polish**

```bash
git add docs/app-guides/node-types.md docs/app-guides/conditions-and-outputs.md docs/app-guides/dag-dependencies.md docs/app-guides/loops-and-approvals.md docs/app-guides/quick-start.md docs/app-guides/retry-and-triggers.md src/lib/docs/navigation.ts src/lib/docs/navigation.test.ts src/lib/docs/build-index.test.ts src/features/documentation/DocumentationOverview.test.ts src/features/editor/editor-extensions.ts src/features/editor/editor-extensions.test.ts tests/e2e/workspace-authoring.spec.ts src-tauri/resources/setup-integrity-v1.json
git commit -m "docs: restore workflow authoring guidance"
```

---

### Task 13: Run whole-branch review, verification, and delivery preparation

**Files:**
- Create: `docs/reviews/2026-09-06-ui-customization-recovery-external-review-prompt.md`
- Create: `docs/reviews/2026-09-06-ui-customization-recovery-completion-review.md`
- Modify only for confirmed findings: files named by the finding

**Interfaces:**
- Consumes: Tasks 1–12, the approved recovery spec, current v2 baseline, and existing loop-group adversarial review format.
- Produces: one reconciled R1–R19 report, exact verification receipts, and a clean reviewable feature branch.

- [ ] **Step 1: Create and commit one common external adversarial review prompt**

Adapt the existing loop-group external review prompt to this recovery. Require independent Claude and Codex lanes to verify R1–R19, inspect every changed path, preserve current loop-group/scanner behavior, validate that user templates were not invented, and report stable reviewer-prefixed findings with triggers, expected/actual behavior, impact, and smallest correction.

```bash
git add docs/reviews/2026-09-06-ui-customization-recovery-external-review-prompt.md
git commit -m "docs: prepare UI recovery review"
```

- [ ] **Step 2: Run the complete deterministic verification gates**

Run in this order and retain exact counts/output:

```bash
npm run format:check
npm run lint
npm run check
npm run contracts:check
npm run examples:check
npm run resources:verify
npm run test:unit
npm run test:rust
npm run build
npm run test:e2e
```

Expected: every command exits zero, all current loop/scanner suites remain green, and the complete unit suite includes passing `app-capacity`, `canvas-performance`, `scoped-canvas-performance`, and `indexed-reference-validation` fixtures at exactly 250 nodes/500 edges per tested scope.

- [ ] **Step 3: Build the unsigned local macOS candidate**

Run: `npx tauri build --no-sign --bundles app,dmg`

Verify package identity, architecture, bundled contract/corpus/examples/docs/LOOP24 resources, and SHA-256 without changing the application version from `2.0.0` or claiming updater/Apple signing.

- [ ] **Step 4: Freeze candidate identity and changed-path inventory**

Record:

```bash
git merge-base base HEAD
git rev-parse HEAD
git status --short --branch
git diff --name-status base...HEAD
git diff --check base...HEAD
```

Expected: the merge base is `aa91baac4081f0ca585b10fb3fb65b966a7ec24c`, the feature worktree is clean, and no v1.0.8 release metadata or old `ProblemsResizeHandle` exists.

- [ ] **Step 5: Dispatch independent Claude and Codex review lanes**

Give each lane the same frozen prompt, candidate commit, diff, requirements matrix, and verification receipts. Reviewers must not read each other's report and must not modify the worktree. Persist their verbatim reports outside the candidate diff before reconciliation.

- [ ] **Step 6: Validate and resolve every finding**

For each finding, reproduce the trigger or inspect the cited path, mark it valid/invalid/duplicate/out-of-scope with evidence, and use `superpowers:receiving-code-review`. For every valid defect, return to a failing focused test, make the smallest fix, rerun the focused and affected broader suites, request focused review, and commit the fix. Do not adopt any suggestion that changes workflow syntax, Hermes authority, or adds a new runtime/interpreter.

- [ ] **Step 7: Re-run affected full gates and write completion review**

The completion review must map R1–R19 to exact tests and source, list review findings and dispositions, record final commit/test/build identities, and call out the only unresolved product ambiguity: no user-template behavior was recoverable or implemented.

- [ ] **Step 8: Commit review records and stop before integration/release**

```bash
git add docs/reviews/2026-09-06-ui-customization-recovery-external-review-prompt.md docs/reviews/2026-09-06-ui-customization-recovery-completion-review.md
git commit -m "docs: record UI recovery verification"
git status --short --branch
```

Expected: the feature worktree is clean. Present the exact feature commit and layman's delivery summary to the user. Do not merge to `base`, change versions, tag, dispatch a release workflow, publish a release, or alter the old dirty worktree without separate user approval.
