# Workflow Studio Content-Aware Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-size-fits-all activity drawer with a viewport-bounded, content-aware desktop workbench whose rich activities, authoring surfaces, and dialogs remain readable and operable on macOS and Windows at 1024 x 700 and 200% zoom.

**Architecture:** Keep the existing YAML/document/canvas/Git authorities unchanged. Extend the small shell store to distinguish contextual activities from page activities, keep authoring mounted but inert beneath full-workbench pages, establish explicit viewport and scroll ownership, and use one shared native-dialog top-layer primitive for ordinary modals. Page components continue to consume their existing feature stores and callbacks rather than moving domain logic into `App.svelte`.

**Tech Stack:** Tauri 2, Svelte 5 runes and snippets, TypeScript 6, Nanostores, Svelte Flow, CodeMirror 6, Vitest/Svelte Testing Library, Playwright Chromium/WebKit, Geist variable fonts.

**Spec:** `docs/superpowers/specs/2026-08-30-workflow-studio-content-aware-workbench-design.md`

## Global Constraints

- YAML remains the sole workflow source of truth; shell navigation stores presentation state only.
- Definition YAML and optional companion YAML remain the only workflow outputs.
- No visual operation may create a cycle, self-edge, duplicate dependency, or unresolved dependency.
- Missing runtime tools, providers, credentials, scripts, services, and trust remain non-blocking advisories.
- The application remains fully functional offline with bundled contracts, examples, documentation, fonts, and LOOP24 resources.
- Rust remains limited to privileged native operations; YAML, DAG, forms, layout rules, and page presentation stay in testable TypeScript/Svelte.
- Git remains local-only; do not add remotes, authentication, push, pull, merge, rebase, reset, or background commits.
- Targeted edits preserve comments, key order, scalar style, and unrelated or unsupported YAML whenever the syntax tree permits it.
- Do not parse YAML, validate the graph, run layout, query Git, or perform native/file I/O during pointer-move frames or workbench-surface switches.
- The shell and status bar remain inside the WebView viewport; the document is not the ordinary application scroller.
- Explorer and Nodes are contextual panels. Welcome, Settings, Examples, Documentation, and Git are full-workbench surfaces.
- Overlay drawers are sized independently from docked-panel clamping and never clip their actions.
- Inspector and Problems have bounded internal scrollers.
- Side-by-side Split is allowed only when Canvas and YAML each retain at least 360px of usable width.
- Ordinary modals use the HTML dialog top layer through `showModal()`, isolate background focus, retain visible actions, and restore focus.
- Keyboard operation, visible focus, forced colors, reduced motion, 200% zoom, Chromium, WebKit, macOS, and Windows are release requirements.
- The 250-node/500-edge performance contract remains mandatory.
- Use strict red-green-refactor cycles and commit each independently passing task.

---

## File structure and responsibilities

New shared files introduced by this plan:

- `src/app/ActivityPage.svelte` — common full-workbench page header, Back to Workflow control, focus target, and bounded page body.
- `src/app/ModalShell.svelte` — real top-layer modal, focus containment/restoration, scrollable body, and persistent actions.
- `src/app/ApplicationNotice.svelte` — bounded dismissible application error/advisory presentation.
- `src/features/settings/SettingsPage.svelte` — Settings category navigation and responsive page composition.
- `src/features/settings/UpdateSettings.svelte` — update preference/state/actions split from application identity.
- `src/features/documents/issue-view-key.ts` — deterministic unique view identity for repeated diagnostics.
- `tests/e2e/workbench-containment.spec.ts` — long-content geometry and status-bar containment.
- `tests/e2e/activity-pages.spec.ts` — rich-page navigation, state preservation, and master-detail behavior.
- `tests/e2e/modal-layout.spec.ts` — true modality, focus, action reachability, long content, and 200%-zoom geometry.

Existing ownership remains feature-local:

- `src/stores/shell.ts` owns only active activity, contextual return target, drawer visibility, editor mode, and transient shell controls.
- `src/lib/layout/workbench-layout.ts` owns pure responsive classification and panel/problem-size clamping.
- `src/app/App.svelte` composes the shell and passes existing feature callbacks; it does not absorb page business logic.
- Settings, examples, documentation, version-control, canvas, document, setup, update, and branding components retain their existing domain behavior.

---

### Task 1: Bound the desktop shell to the WebView viewport

**Files:**
- Create: `tests/e2e/workbench-containment.spec.ts`
- Modify: `src/app.css`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `tests/e2e/workbench-layout.spec.ts`

**Interfaces:**
- Consumes: existing `.application-shell`, `.workbench`, titlebar, and `StatusBar` structure.
- Produces: a fixed viewport scroll contract in which the root/document does not grow and the status bar remains visible.

- [ ] **Step 1: Add a failing shell-containment component assertion**

In `src/app/App.test.ts`, add a source/DOM contract requiring the root shell to expose a stable viewport hook:

```ts
expect(container.querySelector('.application-shell')).toHaveAttribute('data-viewport-shell')
expect(container.querySelector('.workbench')).toHaveAttribute('data-scroll-owner', 'workbench')
```

- [ ] **Step 2: Add the failing long-surface browser test**

Create `tests/e2e/workbench-containment.spec.ts` with the current reproducible Settings case:

```ts
test('keeps the desktop shell and status bar inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const geometry = await page.evaluate(() => ({
    viewport: innerHeight,
    rootHeight: document.documentElement.getBoundingClientRect().height,
    rootScrollHeight: document.documentElement.scrollHeight,
    statusBottom: document.querySelector('[aria-label="Application status"]')!.getBoundingClientRect().bottom,
  }))

  expect(geometry.rootHeight).toBe(geometry.viewport)
  expect(geometry.rootScrollHeight).toBe(geometry.viewport)
  expect(geometry.statusBottom).toBeLessThanOrEqual(geometry.viewport)
})
```

- [ ] **Step 3: Run the tests and prove the current intrinsic-height shell fails**

Run:

```bash
npm run test:unit -- src/app/App.test.ts
npx playwright test tests/e2e/workbench-containment.spec.ts --project=chromium
```

Expected: FAIL because the shell lacks the hooks and Settings expands the document beyond 2,000px.

- [ ] **Step 4: Implement the viewport and root overflow contract**

Set the global roots to a definite height in `src/app.css`:

```css
html,
body,
#app {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
```

Update the shell in `App.svelte`:

```svelte
<main class="application-shell" data-viewport-shell>
  <!-- existing titlebar, workbench, status, and transient surfaces -->
</main>
```

```css
.application-shell {
  width: 100%;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}
```

Add `data-scroll-owner="workbench"` to `.workbench`. Keep its `min-height: 0` and `overflow: hidden`; do not make the workbench itself a catch-all scroller.

- [ ] **Step 5: Pass focused layout verification in both browser engines**

Run:

```bash
npm run test:unit -- src/app/App.test.ts
npx playwright test tests/e2e/workbench-containment.spec.ts tests/e2e/workbench-layout.spec.ts --project=chromium
npx playwright test tests/e2e/workbench-containment.spec.ts tests/e2e/workbench-layout.spec.ts --project=webkit
npm run check
```

Expected: PASS; long descendants may still need their own scrollers in later tasks, but they cannot expand the document or displace the status bar.

- [ ] **Step 6: Commit the shell foundation**

```bash
git add src/app.css src/app/App.svelte src/app/App.test.ts tests/e2e/workbench-containment.spec.ts tests/e2e/workbench-layout.spec.ts
git commit -m "fix: bound workbench to desktop viewport"
```

### Task 2: Separate contextual activities from full-workbench pages

**Files:**
- Create: `src/app/ActivityPage.svelte`
- Create: `src/app/ActivityPage.test.ts`
- Modify: `src/stores/shell.ts`
- Modify: `src/stores/shell.test.ts`
- Modify: `src/lib/commands/registry.ts`
- Modify: `src/lib/commands/registry.test.ts`
- Modify: `src/app/ActivityRail.svelte`
- Modify: `src/app/ActivityRail.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Create: `tests/e2e/activity-pages.spec.ts`

**Interfaces:**
- Consumes: `ActivityId`, `$activeActivity`, `$workspacePanelOpen`, `$inspectorPanelOpen`, and existing activity commands.
- Produces: `ContextualActivityId`, `PageActivityId`, `isPageActivity()`, `resolveWorkbenchSurface()`, `returnToWorkflow()`, and `ActivityPage`.

- [ ] **Step 1: Write failing pure shell-navigation tests**

Add the following contract to `src/stores/shell.test.ts`:

```ts
showActivity('nodes')
$workspacePanelOpen.set(false)
showActivity('settings')

expect($activeActivity.get()).toBe('settings')
expect($workspacePanelOpen.get()).toBe(false)
expect($inspectorPanelOpen.get()).toBe(false)
expect(resolveWorkbenchSurface('settings', true)).toBe('settings')

returnToWorkflow()
expect($activeActivity.get()).toBe('nodes')
expect($workspacePanelOpen.get()).toBe(false)
expect(resolveWorkbenchSurface('nodes', true)).toBe('authoring')
expect(resolveWorkbenchSurface('explorer', false)).toBe('welcome')
```

Reset all touched atoms in `beforeEach` so tests remain order-independent.

- [ ] **Step 2: Write failing ActivityPage and rail-semantics tests**

In `ActivityPage.test.ts`, require a named page, Back control, heading focus target, and bounded body:

```ts
const onBack = vi.fn()
const { container } = render(ActivityPage, {
  activity: 'settings',
  title: 'Settings',
  description: 'Manage the application.',
  showBack: true,
  onBack,
})

expect(screen.getByRole('region', { name: 'Settings' })).toHaveAttribute('data-workbench-page', 'settings')
expect(screen.getByRole('heading', { name: 'Settings' })).toHaveAttribute('tabindex', '-1')
await fireEvent.click(screen.getByRole('button', { name: 'Back to Workflow' }))
expect(onBack).toHaveBeenCalledOnce()
expect(container.querySelector('[data-page-scroll]')).not.toBeNull()
```

Update `ActivityRail.test.ts` so Settings uses `aria-current="page"` while Explorer uses `aria-expanded` only when it controls a contextual panel.

- [ ] **Step 3: Run the focused tests and verify the missing surface model fails**

Run:

```bash
npm run test:unit -- src/stores/shell.test.ts src/lib/commands/registry.test.ts src/app/ActivityPage.test.ts src/app/ActivityRail.test.ts src/app/App.test.ts
```

Expected: FAIL because page/context activity types, return state, page component, and rail semantics do not exist.

- [ ] **Step 4: Implement the shell surface types and return target**

Add these exact types and pure classifier to `src/stores/shell.ts`:

```ts
export type ContextualActivityId = Extract<ActivityId, 'explorer' | 'nodes'>
export type PageActivityId = Exclude<ActivityId, ContextualActivityId>
export type WorkbenchSurface = 'welcome' | 'authoring' | PageActivityId

export const CONTEXTUAL_ACTIVITIES: readonly ContextualActivityId[] = ['explorer', 'nodes']
export const PAGE_ACTIVITIES: readonly PageActivityId[] = ['examples', 'documentation', 'git', 'settings']

export function isPageActivity(activity: ActivityId): activity is PageActivityId {
  return PAGE_ACTIVITIES.includes(activity as PageActivityId)
}

export function resolveWorkbenchSurface(activity: ActivityId, hasWorkspace: boolean): WorkbenchSurface {
  if (isPageActivity(activity)) return activity
  return hasWorkspace ? 'authoring' : 'welcome'
}
```

Store a private authoring return target containing contextual activity and panel-open state. `showActivity(page)` captures the current contextual target, closes both transient panels, and sets the page activity. `showActivity(contextual)` updates the return activity and opens that contextual panel. `returnToWorkflow()` restores the target without changing editor/document stores.

Use this state transition shape:

```ts
interface AuthoringReturnTarget {
  readonly activity: ContextualActivityId
  readonly panelOpen: boolean
}

let authoringReturnTarget: AuthoringReturnTarget = { activity: 'explorer', panelOpen: false }

export function showActivity(activity: ActivityId): void {
  const current = $activeActivity.get()
  if (isPageActivity(activity)) {
    if (!isPageActivity(current)) {
      authoringReturnTarget = { activity: current, panelOpen: $workspacePanelOpen.get() }
    }
    $activeActivity.set(activity)
    closeTransientPanels()
    return
  }

  $activeActivity.set(activity)
  $workspacePanelOpen.set(true)
  authoringReturnTarget = { activity, panelOpen: true }
}

export function returnToWorkflow(): void {
  $activeActivity.set(authoringReturnTarget.activity)
  $workspacePanelOpen.set(authoringReturnTarget.panelOpen)
  $inspectorPanelOpen.set(false)
}
```

Change the registry activity handler from unconditional panel toggling to:

```ts
run: () => (isPageActivity(activity) ? showActivity(activity) : toggleActivityPanel(activity))
```

- [ ] **Step 5: Implement the common ActivityPage frame**

Create `ActivityPage.svelte` with this public interface:

```ts
import type { Snippet } from 'svelte'

interface Props {
  activity: PageActivityId | 'welcome'
  title: string
  description: string
  showBack?: boolean
  onBack?: () => void | Promise<void>
  children?: Snippet
}
```

The root is a named region with `data-workbench-page={activity}`. Its fixed header contains the Back button when requested, `h2 tabindex="-1"`, and description. Its `minmax(0, 1fr)` body has `data-page-scroll`, `min-height: 0`, and `overflow: auto`. Focus the heading after a page-activity navigation request, but do not steal focus on ordinary rerenders.

- [ ] **Step 6: Compose page versus authoring layers without unmounting authoring**

In `App.svelte`, derive the surface from the active activity and workspace identity. Keep the left panel, editor column, and Inspector mounted, but apply `hidden`, `inert`, and `aria-hidden` while a page or Welcome is active. Render `ActivityPage` in `grid-column: 2 / -1` and `grid-row: 1`.

Do not render rich activity contents inside `.left-panel`. For this task, page bodies may contain their existing components without final page styling; Tasks 3-5 finish each design.

- [ ] **Step 7: Prove navigation preserves authoring state**

In `tests/e2e/activity-pages.spec.ts`, open the seeded pair, make an unsaved YAML edit, select `prepare`, record the layout snapshot, open Settings, return, and assert exact text, selected node, editor mode, and layout survived:

```ts
await page.getByRole('button', { name: 'Settings', exact: true }).click()
await expect(page.getByRole('region', { name: 'Settings' })).toBeVisible()
await expect(page.getByRole('region', { name: 'Workflow workspace' })).toHaveAttribute('inert', '')
await page.getByRole('button', { name: 'Back to Workflow' }).click()
await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(UNSAVED_YAML)
await expect(page.locator('.svelte-flow__node.selected').filter({ hasText: 'prepare' })).toBeVisible()
expect((await e2eSnapshot(page)).layout).toEqual(layoutBefore)
```

- [ ] **Step 8: Run the full navigation slice and commit**

Run:

```bash
npm run test:unit -- src/stores/shell.test.ts src/lib/commands/registry.test.ts src/app/ActivityPage.test.ts src/app/ActivityRail.test.ts src/app/App.test.ts
npx playwright test tests/e2e/activity-pages.spec.ts tests/e2e/workbench-layout.spec.ts --project=chromium
npx playwright test tests/e2e/activity-pages.spec.ts tests/e2e/workbench-layout.spec.ts --project=webkit
npm run check
```

Expected: PASS with page activities never claiming drawer expansion and authoring remaining mounted/inert.

```bash
git add src/stores/shell.ts src/stores/shell.test.ts src/lib/commands/registry.ts src/lib/commands/registry.test.ts src/app/ActivityPage.svelte src/app/ActivityPage.test.ts src/app/ActivityRail.svelte src/app/ActivityRail.test.ts src/app/App.svelte src/app/App.test.ts tests/e2e/activity-pages.spec.ts
git commit -m "feat: add content-aware workbench navigation"
```

### Task 3: Build the Welcome and Settings workbench pages

**Files:**
- Create: `src/features/settings/SettingsPage.svelte`
- Create: `src/features/settings/SettingsPage.test.ts`
- Create: `src/features/settings/UpdateSettings.svelte`
- Create: `src/features/settings/UpdateSettings.test.ts`
- Modify: `src/features/settings/AboutView.svelte`
- Modify: `src/features/settings/AboutView.test.ts`
- Modify: `src/features/branding/BrandSettings.svelte`
- Modify: `src/features/settings/ContractSettings.svelte`
- Modify: `src/features/workspace/OpenWorkspace.svelte`
- Modify: `src/features/workspace/OpenWorkspace.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `tests/e2e/activity-pages.spec.ts`
- Modify: `tests/e2e/workbench-containment.spec.ts`

**Interfaces:**
- Consumes: `ActivityPage`, existing brand/controller callbacks, `ContractSettingsHost`, `AboutView`, update callbacks, `OpenWorkspace`, and workspace state.
- Produces: `SettingsCategory`, `SettingsPage`, `UpdateSettings`, and a dedicated Welcome surface.

- [ ] **Step 1: Write failing Settings category tests**

`SettingsPage.test.ts` must require four keyboard-operable categories and only one visible category panel. Build concrete snippets with Svelte's test helper:

```ts
import { createRawSnippet } from 'svelte'

const content = (label: string) =>
  createRawSnippet(() => ({
    render: () => `<p>${label}</p>`,
  }))

render(SettingsPage, {
  appearance: content('Appearance content'),
  contracts: content('Contract content'),
  updates: content('Update content'),
  about: content('About content'),
})

const appearanceTab = screen.getByRole('tab', { name: 'Appearance' })
expect(appearanceTab).toHaveAttribute('aria-selected', 'true')
await fireEvent.click(screen.getByRole('tab', { name: 'Workflow Contracts' }))
expect(screen.getByRole('tabpanel', { name: 'Workflow Contracts' })).toBeVisible()
expect(screen.queryByRole('tabpanel', { name: 'Appearance' })).not.toBeInTheDocument()
```

Use lightweight Svelte test snippets that render category names. Add ArrowLeft/ArrowRight/Home/End assertions and focus movement.

- [ ] **Step 2: Write failing Update/About separation and Welcome tests**

Move update-specific expectations from `AboutView.test.ts` into `UpdateSettings.test.ts`. Require `AboutView` to expose application/platform/contract identity only. Update `OpenWorkspace.test.ts` to require its primary action, recent folders, drop-zone label, unavailable state, and no dependency on editor/Inspector chrome.

- [ ] **Step 3: Add failing page geometry assertions**

Extend `activity-pages.spec.ts` and `workbench-containment.spec.ts`:

```ts
await page.getByRole('button', { name: 'Settings', exact: true }).click()
await expect(page.getByRole('tab', { name: 'Appearance' })).toBeVisible()
await page.getByRole('tab', { name: 'Workflow Contracts' }).click()
await expect(page.getByRole('heading', { name: 'Workflow contracts' })).toBeVisible()

const overflow = await page.evaluate(() => {
  const pageRoot = document.querySelector('[data-workbench-page="settings"]')!
  return pageRoot.scrollWidth - pageRoot.clientWidth
})
expect(overflow).toBe(0)
```

Run the same assertion at 1024 x 700, 1280 x 800, 1440 x 900, and effective 512px reflow width.

- [ ] **Step 4: Run focused tests and prove the page components are absent**

Run:

```bash
npm run test:unit -- src/features/settings src/features/workspace/OpenWorkspace.test.ts src/app/App.test.ts
npx playwright test tests/e2e/activity-pages.spec.ts tests/e2e/workbench-containment.spec.ts --project=chromium --grep "Settings|Welcome"
```

Expected: FAIL on missing SettingsPage/UpdateSettings, incorrect category structure, and old left-panel geometry.

- [ ] **Step 5: Implement SettingsPage and split UpdateSettings from About**

Use this public Settings composition contract:

```ts
export type SettingsCategory = 'appearance' | 'contracts' | 'updates' | 'about'

interface Props {
  appearance: Snippet
  contracts: Snippet
  updates: Snippet
  about: Snippet
}
```

Render one tabpanel at a time inside a centered `max-width: 60rem` content grid. Use a vertical tablist beside content when space permits and a wrapping horizontal tablist at narrow widths. Category state remains local to SettingsPage.

Move startup preference, check/download/install/relaunch, update detail, and log actions into `UpdateSettings.svelte`. Keep application/platform and bundled-contract identity in `AboutView.svelte`. Preserve all existing callbacks and pending/error behavior.

Add `min-width: 0`, `max-width: 100%`, and `overflow-wrap: anywhere` at every card/value boundary. Contract and About definition lists become one column under the component breakpoint. Required action groups wrap and stack at narrow widths.

- [ ] **Step 6: Compose Settings and Welcome through ActivityPage**

Use Svelte snippets in `App.svelte` so existing controllers stay in the shell while SettingsPage owns category navigation:

```svelte
{#snippet appearance()}<BrandSettings ... />{/snippet}
{#snippet contracts()}<ContractSettingsHost ... />{/snippet}
{#snippet updates()}<UpdateSettings ... />{/snippet}
{#snippet about()}<AboutView ... />{/snippet}

<SettingsPage {appearance} {contracts} {updates} {about} />
```

When `resolveWorkbenchSurface()` returns `welcome`, render `OpenWorkspace` inside an `ActivityPage` without Back to Workflow. Hide editor mode tabs and Inspector through the inert authoring layer rather than conditional unmounting.

- [ ] **Step 7: Run Settings/Welcome verification and commit**

Run:

```bash
npm run test:unit -- src/features/settings src/features/branding/BrandSettings.test.ts src/features/workspace/OpenWorkspace.test.ts src/app/App.test.ts
npx playwright test tests/e2e/activity-pages.spec.ts tests/e2e/workbench-containment.spec.ts --project=chromium --grep "Settings|Welcome"
npx playwright test tests/e2e/activity-pages.spec.ts tests/e2e/workbench-containment.spec.ts --project=webkit --grep "Settings|Welcome"
npm run check
```

Expected: PASS with no horizontal Settings overflow and no status-bar displacement.

```bash
git add src/features/settings src/features/branding/BrandSettings.svelte src/features/workspace/OpenWorkspace.svelte src/features/workspace/OpenWorkspace.test.ts src/app/App.svelte src/app/App.test.ts tests/e2e/activity-pages.spec.ts tests/e2e/workbench-containment.spec.ts
git commit -m "feat: add welcome and settings pages"
```

### Task 4: Convert Examples and Documentation to responsive master-detail pages

**Files:**
- Modify: `src/features/examples/ExampleGallery.svelte`
- Modify: `src/features/examples/ExampleGallery.test.ts`
- Modify: `src/features/documentation/DocumentationView.svelte`
- Modify: `src/features/documentation/DocumentationView.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `tests/e2e/examples-and-docs.spec.ts`
- Modify: `tests/e2e/activity-pages.spec.ts`
- Modify: `tests/e2e/workbench-containment.spec.ts`

**Interfaces:**
- Consumes: `ActivityPage`, existing example descriptors, documentation index/search, navigation request IDs, and existing callbacks.
- Produces: in-page Example list/detail state and responsive Documentation results/article state.

- [ ] **Step 1: Write failing Example list/detail and state tests**

Require Preview to replace the gallery body with a detail region near the top and expose Back to Examples:

```ts
await fireEvent.click(screen.getByRole('button', { name: 'Preview Minimal prompt' }))
expect(screen.getByRole('region', { name: 'Minimal prompt preview' })).toBeVisible()
expect(screen.getByRole('button', { name: 'Back to Examples' })).toBeVisible()
expect(screen.queryByRole('article', { name: 'Sequential chain' })).not.toBeInTheDocument()
```

Add explicit component inputs or a small `catalogState` prop for `loading | ready | empty | error`; require a named retry callback only in recoverable error state. Do not infer loading from `examples.length === 0`.

- [ ] **Step 2: Write failing Documentation master-detail tests**

Require navigation and article to be siblings in wide presentation and internal states at narrow presentation. Keep selection behavior DOM-based rather than relying on a snapshot:

```ts
await fireEvent.click(screen.getByRole('option', { name: /Action/ }))
expect(screen.getByRole('article', { name: 'Action' })).toBeVisible()
expect(screen.getByTestId('documentation-navigation')).not.toContainElement(
  screen.getByRole('article', { name: 'Action' }),
)
```

Set a query with zero results and require `role="status"` text `No documentation matches`.

- [ ] **Step 3: Add browser assertions that fail against appended detail content**

In `activity-pages.spec.ts`, select the first Example preview and a Documentation result, then require each detail top to remain within one viewport height of the page body top:

```ts
const [bodyBox, detailBox] = await Promise.all([
  page.locator('[data-page-scroll]').boundingBox(),
  page.getByRole('region', { name: /preview$/ }).boundingBox(),
])
expect(detailBox!.y - bodyBox!.y).toBeLessThan(100)
```

Also assert the page root has no horizontal overflow and the last result can be scrolled into view and focused at 1024 x 700 and reflow width.

- [ ] **Step 4: Run focused tests and verify the old stacked layouts fail**

Run:

```bash
npm run test:unit -- src/features/examples/ExampleGallery.test.ts src/features/documentation/DocumentationView.test.ts src/app/App.test.ts
npx playwright test tests/e2e/examples-and-docs.spec.ts tests/e2e/activity-pages.spec.ts --project=chromium
```

Expected: FAIL because Example preview follows the entire gallery and Documentation article follows the complete result list.

- [ ] **Step 5: Implement Example and Documentation page structures**

In `ExampleGallery.svelte`, retain `selectedExample` locally. Render either the responsive card grid or one detail region, never both in a vertical sequence. Detail contains definition and optional companion code scrollers, concepts, documentation actions, and Create Editable Copy.

In `DocumentationView.svelte`, use this structural contract:

```svelte
<div class="documentation-layout" class:detail-active={selected !== null}>
  <section data-testid="documentation-navigation">...</section>
  <article aria-label={selected.title}>...</article>
</div>
```

At wide widths use bounded navigation plus article columns. At narrow widths show navigation or article, with Back to Results in the article state. Give titles and type badges `min-width: 0` and `overflow-wrap: anywhere`. Navigation and article own separate scrollers only in the wide grid; the outer ActivityPage remains the sole page scroller at narrow widths.

- [ ] **Step 6: Model example loading failure explicitly in App**

Replace the implicit `examples.length === 0` loading check with:

```ts
type ExampleCatalogState =
  | { phase: 'loading' }
  | { phase: 'ready'; examples: readonly ExampleDescriptor[] }
  | { phase: 'empty' }
  | { phase: 'error'; message: string }
```

Catch catalog rejection locally, render retry for error, and treat a resolved empty list as empty. Do not alter bundled example validation.

- [ ] **Step 7: Pass cross-engine page verification and commit**

Run:

```bash
npm run test:unit -- src/features/examples src/features/documentation src/app/App.test.ts
npx playwright test tests/e2e/examples-and-docs.spec.ts tests/e2e/activity-pages.spec.ts tests/e2e/workbench-containment.spec.ts --project=chromium
npx playwright test tests/e2e/examples-and-docs.spec.ts tests/e2e/activity-pages.spec.ts tests/e2e/workbench-containment.spec.ts --project=webkit
npm run check
```

Expected: PASS with immediately visible detail content and bounded navigation.

```bash
git add src/features/examples src/features/documentation src/app/App.svelte src/app/App.test.ts tests/e2e/examples-and-docs.spec.ts tests/e2e/activity-pages.spec.ts tests/e2e/workbench-containment.spec.ts
git commit -m "feat: add examples and documentation pages"
```

### Task 5: Promote Git to a page and correct contextual drawer sizing

**Files:**
- Modify: `src/lib/layout/workbench-layout.ts`
- Modify: `src/lib/layout/workbench-layout.test.ts`
- Modify: `src/features/version-control/GitView.svelte`
- Modify: `src/features/version-control/GitView.test.ts`
- Modify: `src/features/version-control/DiffView.svelte`
- Modify: `src/features/version-control/DiffView.test.ts`
- Modify: `src/features/version-control/HistoryView.svelte`
- Modify: `src/features/workspace/Explorer.svelte`
- Modify: `src/features/workspace/Explorer.test.ts`
- Modify: `src/features/canvas/NodePalette.svelte`
- Modify: `src/features/canvas/NodePalette.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `tests/e2e/git-version.spec.ts`
- Modify: `tests/e2e/workbench-layout.spec.ts`
- Modify: `tests/e2e/activity-pages.spec.ts`

**Interfaces:**
- Consumes: stored panel preferences, workbench width, ActivityPage, existing local Git store/actions, Explorer commands, and node descriptors.
- Produces: `resolveOverlayPanelWidths()` and readable full-page Git/diff/history presentation.

- [ ] **Step 1: Write failing independent overlay-width tests**

Add this pure interface to the test before implementation:

```ts
expect(resolveOverlayPanelWidths({ left: 192, right: 240 }, 1024)).toEqual({ left: 320, right: 320 })
expect(resolveOverlayPanelWidths({ left: 500, right: 500 }, 300)).toEqual({ left: 252, right: 252 })
expect(resolveOverlayPanelWidths({ left: Number.NaN, right: Number.NaN }, 1280)).toEqual({ left: 320, right: 320 })
```

The 48px rail is the only width reserved from overlay drawers. Docked clamping remains unchanged.

- [ ] **Step 2: Write failing Explorer/Nodes reachability tests**

Change Explorer header actions to icon controls with stable accessible names and titles. In component tests require both New Workflow and Import buttons. In E2E, assert each button rectangle is fully inside the workspace panel rectangle at 1024 and 1280.

Add a NodePalette test with all descriptors and a browser assertion that scrolls the last node kind into view and focuses it without leaving the drawer bounds.

- [ ] **Step 3: Write failing Git page/readability tests**

Require Git to live under `[data-workbench-page="git"]`, not `.left-panel`, and assert long Windows paths and subjects do not widen the page. At narrow widths, request Side by side and require the presentation to remain unified or expose a clear insufficient-width explanation.

- [ ] **Step 4: Run focused tests and prove drawer/Git failures**

Run:

```bash
npm run test:unit -- src/lib/layout/workbench-layout.test.ts src/features/workspace/Explorer.test.ts src/features/canvas/NodePalette.test.ts src/features/version-control src/app/App.test.ts
npx playwright test tests/e2e/workbench-layout.spec.ts tests/e2e/activity-pages.spec.ts tests/e2e/git-version.spec.ts --project=chromium
```

Expected: FAIL because compact drawers use docked widths, Explorer Import is clipped, and Git remains in the left panel.

- [ ] **Step 5: Implement independent overlay sizing and contextual scroll ownership**

Add the exact pure function:

```ts
export interface OverlayPanelPreferences {
  readonly left: number
  readonly right: number
}

export function resolveOverlayPanelWidths(
  stored: OverlayPanelPreferences,
  workbenchWidth: number,
): OverlayPanelPreferences {
  const available = Math.max(0, workbenchWidth - 48)
  const left = Number.isFinite(stored.left) ? Math.max(320, stored.left) : 320
  const right = Number.isFinite(stored.right) ? Math.max(320, stored.right) : 320
  return { left: Math.min(left, available), right: Math.min(right, available) }
}
```

Apply separate docked and overlay CSS variables in App. Give the left panel a pinned drawer-close row plus `minmax(0, 1fr)` content body. Explorer and NodePalette each use `height: 100%; min-height: 0`; their intended body/list owns `overflow: auto`.

Use Lucide icon buttons for Explorer New Workflow and Import with the existing full accessible labels and tooltips. Add an explicit empty state with both actions and a separate loading/error status path.

- [ ] **Step 6: Compose Git as a full page and make its content responsive**

Move GitView into ActivityPage. Use a responsive grid for repository/status controls, diff, and history. Give paths, commit subjects, authors, and refs `min-width: 0; overflow-wrap: anywhere`. Keep diff text in bounded code scrollers. Side-by-side mode is enabled only when both sides satisfy the component's readable minimum; unified remains available everywhere.

- [ ] **Step 7: Pass contextual/Git tests and commit**

Run:

```bash
npm run test:unit -- src/lib/layout/workbench-layout.test.ts src/features/workspace/Explorer.test.ts src/features/canvas/NodePalette.test.ts src/features/version-control src/app/App.test.ts
npx playwright test tests/e2e/workbench-layout.spec.ts tests/e2e/activity-pages.spec.ts tests/e2e/git-version.spec.ts --project=chromium
npx playwright test tests/e2e/workbench-layout.spec.ts tests/e2e/activity-pages.spec.ts tests/e2e/git-version.spec.ts --project=webkit
npm run check
```

Expected: PASS with 320px practical drawers at 1024 and readable Git presentation.

```bash
git add src/lib/layout/workbench-layout.ts src/lib/layout/workbench-layout.test.ts src/features/workspace/Explorer.svelte src/features/workspace/Explorer.test.ts src/features/canvas/NodePalette.svelte src/features/canvas/NodePalette.test.ts src/features/version-control src/app/App.svelte src/app/App.test.ts tests/e2e/git-version.spec.ts tests/e2e/workbench-layout.spec.ts tests/e2e/activity-pages.spec.ts
git commit -m "feat: improve contextual panels and git page"
```

### Task 6: Bound Inspector and Problems and correct Split sizing

**Files:**
- Create: `src/features/documents/issue-view-key.ts`
- Create: `src/features/documents/issue-view-key.test.ts`
- Modify: `src/features/documents/ProblemsPanel.svelte`
- Modify: `src/features/documents/ProblemsPanel.test.ts`
- Modify: `src/features/inspector/Inspector.svelte`
- Modify: `src/features/inspector/Inspector.test.ts`
- Modify: `src/lib/layout/workbench-layout.ts`
- Modify: `src/lib/layout/workbench-layout.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `tests/e2e/workbench-layout.spec.ts`
- Modify: `tests/e2e/workbench-containment.spec.ts`

**Interfaces:**
- Consumes: `LayoutRecordV1.panels.problems`, Inspector fields, ValidationIssue, existing Split subtabs, and workbench/editor dimensions.
- Produces: `issueViewKey(issue, occurrence)`, `clampProblemsHeight()`, bounded Inspector/Problems regions, and a 721px side-by-side threshold including the divider.

- [ ] **Step 1: Write failing duplicate-diagnostic identity tests**

Define the exact helper contract:

```ts
const duplicate = issue({ code: 'duplicate_id', path: '/nodes/1/id', line: 8, column: 5 })
expect(issueViewKey(duplicate, 0)).not.toBe(issueViewKey(duplicate, 1))
expect(issueViewKey(duplicate, 0)).toBe(issueViewKey({ ...duplicate }, 0))
```

Render two byte-for-byte equal issues in ProblemsPanel and require two problem buttons with no thrown Svelte duplicate-key error.

- [ ] **Step 2: Write failing Problems height and Split boundary tests**

Add:

```ts
expect(clampProblemsHeight(5000, 700)).toBeLessThanOrEqual(280)
expect(clampProblemsHeight(10, 700)).toBeGreaterThanOrEqual(96)
expect(resolveWorkbenchPresentation(1440, 720).split).toBe('tabs')
expect(resolveWorkbenchPresentation(1440, 721).split).toBe('side-by-side')
```

Use a maximum Problems share of 40% of available workbench height and an absolute minimum of 96px.

Implement the pure clamp with an absolute 360px ceiling and the existing 180px default:

```ts
export function clampProblemsHeight(preferred: number, workbenchHeight: number): number {
  const maximum = Math.max(96, Math.min(360, workbenchHeight * 0.4))
  const requested = Number.isFinite(preferred) ? preferred : 180
  return Math.min(maximum, Math.max(96, requested))
}
```

- [ ] **Step 3: Add failing long Inspector and Problems E2E cases**

At 1280 x 800 open Inspector Advanced and scroll/focus its last field. Then load YAML that produces repeated diagnostics and scroll/focus the final issue. Assert the status bar remains visible, root height equals viewport height, and no page error includes `each_key_duplicate`.

- [ ] **Step 4: Run tests and capture current failures**

Run:

```bash
npm run test:unit -- src/features/documents src/features/inspector src/lib/layout/workbench-layout.test.ts src/app/App.test.ts
npx playwright test tests/e2e/workbench-containment.spec.ts tests/e2e/workbench-layout.spec.ts --project=chromium --grep "Inspector|Problems|Split|diagnostic"
```

Expected: FAIL because Inspector has no bounded body grid, Problems is an implicit row, duplicate keys throw, and Split allows a sub-360px pane.

- [ ] **Step 5: Implement stable issue keys and bounded Problems**

Implement:

```ts
export function issueViewKey(issue: ValidationIssue, occurrence: number): string {
  return JSON.stringify([
    issue.document,
    issue.layer,
    issue.code,
    issue.path ?? '',
    issue.line ?? null,
    issue.column ?? null,
    issue.nodeId ?? '',
    issue.field ?? '',
    occurrence,
  ])
}
```

Use each issue's occurrence within its deterministic group ordering. Make `.editor-column` explicitly allocate mode bar, `minmax(0, 1fr)` editor, and bounded Problems rows when a pair exists. Apply `--problems-height` from `clampProblemsHeight()` using the active layout preference and workbench height. ProblemsPanel fills that row and scrolls only `.groups`.

- [ ] **Step 6: Bound Inspector and enforce true Split minima**

Make Inspector a height-100% grid:

```css
.inspector {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}

.panel {
  min-height: 0;
  overflow: auto;
}
```

Set `SIDE_BY_SIDE_MIN_EDITOR_WIDTH = 721`. Use equal `minmax(360px, 1fr)` panes separated by a 1px grid gap/surface divider; below the boundary keep both mounted and use the existing subtabs.

Render required field state as a separated indicator/badge rather than concatenated text such as `Namerequired`.

- [ ] **Step 7: Pass authoring-containment verification and commit**

Run:

```bash
npm run test:unit -- src/features/documents src/features/inspector src/lib/layout/workbench-layout.test.ts src/app/App.test.ts
npx playwright test tests/e2e/workbench-containment.spec.ts tests/e2e/workbench-layout.spec.ts --project=chromium
npx playwright test tests/e2e/workbench-containment.spec.ts tests/e2e/workbench-layout.spec.ts --project=webkit
npm run check
```

Expected: PASS with all fields/issues reachable and both Split panes satisfying the minimum.

```bash
git add src/features/documents src/features/inspector src/lib/layout/workbench-layout.ts src/lib/layout/workbench-layout.test.ts src/app/App.svelte src/app/App.test.ts tests/e2e/workbench-layout.spec.ts tests/e2e/workbench-containment.spec.ts
git commit -m "fix: contain inspector and problems surfaces"
```

### Task 7: Remove remaining canvas chrome from the pointer viewport

**Files:**
- Modify: `src/features/canvas/CanvasToolbar.svelte`
- Modify: `src/features/canvas/CanvasToolbar.test.ts`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `src/features/canvas/WorkflowNode.svelte`
- Modify: `tests/e2e/workspace-authoring.spec.ts`
- Modify: `tests/e2e/canvas-capacity.spec.ts`
- Modify: `tests/accessibility/keyboard-authoring.test.ts`

**Interfaces:**
- Consumes: existing canvas command registry handlers, `CanvasToolbar`, Svelte Flow viewport, and Create Edge keyboard command.
- Produces: toolbar-owned zoom/fit commands, a chrome-free pointer viewport, and truthful port semantics.

- [ ] **Step 1: Strengthen the failing structural canvas test**

Require no graph-library controls or minimap inside the pointer viewport:

```ts
const viewport = container.querySelector('[data-testid="workflow-canvas-viewport"]')!
expect(viewport.querySelector('.svelte-flow__controls')).toBeNull()
expect(viewport.querySelector('.svelte-flow__minimap')).toBeNull()
await fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))
expect(screen.getByRole('button', { name: 'Zoom In' })).toBeVisible()
expect(screen.getByRole('button', { name: 'Fit Graph' })).toBeVisible()
```

Add toolbar tests that execute `canvas.zoom-in`, `canvas.zoom-out`, `canvas.actual-size`, and `canvas.fit-graph` from the named More menu.

- [ ] **Step 2: Add the failing real hit-test regression**

In `workspace-authoring.spec.ts`, move a node into the former bottom-left Flow-controls rectangle, then hit-test its visible body and drag it again. Require `document.elementFromPoint()` to resolve inside `[data-node-id]`, not an SVG/control, and require persisted coordinates to change.

- [ ] **Step 3: Add failing truthful port-semantics assertions**

Because the dedicated Create Edge command is the keyboard path, require dependency handles not to claim button semantics or tab stops:

```ts
for (const port of container.querySelectorAll('[data-port]')) {
  expect(port).not.toHaveAttribute('role', 'button')
  expect(port).not.toHaveAttribute('tabindex', '0')
}
```

Retain accessible labels for pointer/screen-reader description and preserve Create Edge keyboard tests.

- [ ] **Step 4: Run the focused tests and verify Controls still intercept**

Run:

```bash
npm run test:unit -- src/features/canvas/CanvasToolbar.test.ts src/features/canvas/GraphCanvas.test.ts tests/accessibility/keyboard-authoring.test.ts
npx playwright test tests/e2e/workspace-authoring.spec.ts --project=chromium --grep "control|drag|port"
```

Expected: FAIL because Svelte Flow Controls remain in the viewport and ports expose inactive button semantics.

- [ ] **Step 5: Move zoom/fit commands into CanvasToolbar**

Resolve the four existing command IDs in GraphCanvas and pass them with the existing toolbar commands. Add them to the More menu with Lucide ZoomIn, ZoomOut, Scan, and Maximize icons. Keep Add Node and Create Edge directly visible.

Remove `<Controls>` and its import. Remove the current overlaid minimap and Map toggle rather than retaining a control that violates the approved non-overlap requirement. Do not add a custom overview implementation in this remediation.

Remove `role="button"` and the zero tab stop from Svelte Flow Handles. Keep their labels, title, connection behavior, hit size, and read-only state. The node itself and Create Edge command remain keyboard reachable.

- [ ] **Step 6: Pass real-pointer, keyboard, capacity, and performance tests**

Run:

```bash
npm run test:unit -- src/features/canvas tests/accessibility/keyboard-authoring.test.ts tests/performance/canvas-performance.test.ts
npx playwright test tests/e2e/workspace-authoring.spec.ts tests/e2e/canvas-capacity.spec.ts --project=chromium
npx playwright test tests/e2e/workspace-authoring.spec.ts tests/e2e/canvas-capacity.spec.ts --project=webkit
```

Expected: PASS; pointer movement metrics remain free of YAML/layout/native work.

- [ ] **Step 7: Commit the canvas containment correction**

```bash
git add src/features/canvas tests/e2e/workspace-authoring.spec.ts tests/e2e/canvas-capacity.spec.ts tests/accessibility/keyboard-authoring.test.ts
git commit -m "fix: remove canvas controls from pointer viewport"
```

### Task 8: Introduce the shared real-modal primitive and migrate authoring dialogs

**Files:**
- Create: `src/app/ModalShell.svelte`
- Create: `src/app/ModalShell.test.ts`
- Create: `tests/e2e/modal-layout.spec.ts`
- Modify: `src/features/workspace/NewWorkflowDialog.svelte`
- Modify: `src/features/workspace/NewWorkflowDialog.test.ts`
- Modify: `src/features/workspace/ImportExportDialog.svelte`
- Modify: `src/features/workspace/ImportExportDialog.test.ts`
- Modify: `src/features/workspace/QuickOpen.svelte`
- Modify: `src/features/workspace/QuickOpen.test.ts`
- Modify: `src/features/documents/ExternalChangeDialog.svelte`
- Modify: `src/features/documents/ExternalChangeDialog.test.ts`
- Modify: `src/features/canvas/AddNodePicker.svelte`
- Modify: `src/features/canvas/AddNodePicker.test.ts`
- Modify: `src/features/canvas/DeleteImpactDialog.svelte`
- Modify: `src/features/canvas/DeleteImpactDialog.test.ts`
- Modify: `src/features/commands/CommandPalette.svelte`
- Modify: `src/features/commands/CommandPalette.test.ts`

**Interfaces:**
- Consumes: current dialog labels, callbacks, pending state, opener/focus restoration, and Escape priority.
- Produces: `ModalShell` with real top-layer modality, bounded body, persistent actions, focus containment, and restoration.

- [ ] **Step 1: Write the failing ModalShell contract tests**

Create tests for this public interface:

```ts
interface ModalShellProps {
  titleId: string
  describedBy?: string
  busy?: boolean
  dismissible?: boolean
  initialFocusSelector?: string
  opener?: HTMLElement | null
  onCancel: () => void | Promise<void>
  children?: Snippet
  actions?: Snippet
}
```

Mock `HTMLDialogElement.prototype.showModal` and `close` in jsdom. Require showModal on mount, `aria-busy`, initial focus, Tab/Shift+Tab wrapping, Escape cancellation only when dismissible, and opener focus after destruction/close. Require `[data-modal-body]` and `[data-modal-actions]` regions.

- [ ] **Step 2: Add failing true-modality and zoom geometry E2E tests**

For New Workflow, Import, Quick Open, External Change, Add Node, Delete Impact, and Command Palette, require:

```ts
const dialog = page.getByRole('dialog', { name: /New workflow/i })
await expect(dialog).toBeVisible()
expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true)

const action = dialog.getByRole('button', { name: /Create workflow/i })
const actionBox = await action.boundingBox()
expect(actionBox!.bottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
```

Resize to effective 512 x 350 after opening, scroll long content, and assert background Explorer/editor controls cannot receive focus.

- [ ] **Step 3: Run the focused modal tests and capture pseudo-modal failures**

Run:

```bash
npm run test:unit -- src/app/ModalShell.test.ts src/features/workspace src/features/documents/ExternalChangeDialog.test.ts src/features/canvas/AddNodePicker.test.ts src/features/canvas/DeleteImpactDialog.test.ts src/features/commands/CommandPalette.test.ts
npx playwright test tests/e2e/modal-layout.spec.ts --project=chromium --grep "New Workflow|Import|Quick|External|Add Node|Delete|Command"
```

Expected: FAIL because several surfaces are fixed divs with `aria-modal` rather than top-layer dialogs and their actions are not height-bounded.

- [ ] **Step 4: Implement ModalShell**

Render a native `<dialog>` and open it with `showModal()` after mount. Use a root grid with `grid-template-rows: auto minmax(0, 1fr) auto`, width `min(42rem, calc(100vw - 2rem))`, max block size `calc(100dvh - 2rem)`, scroll only `[data-modal-body]`, and keep `[data-modal-actions]` visible.

Use the existing focusable selector pattern from SetupOverlay/UpdateOverlay, but centralize it here. Stop Escape propagation after the modal handles cancel so shell drawers do not also close. Close the dialog before restoring focus with `tick()`.

- [ ] **Step 5: Migrate authoring/workspace dialogs without changing behavior**

Replace each pseudo-modal wrapper with ModalShell and named snippets:

```svelte
<ModalShell {titleId} {opener} {onCancel} initialFocusSelector="[data-modal-initial-focus]">
  <!-- existing dialog body -->
  {#snippet actions()}
    <!-- existing cancel/confirm controls -->
  {/snippet}
</ModalShell>
```

Preserve exact accessible labels, validation, pending states, command-palette search behavior, import replacement checks, conflict choices, DAG impact text, and focus return targets.

- [ ] **Step 6: Pass modal behavior in both engines and commit**

Run:

```bash
npm run test:unit -- src/app/ModalShell.test.ts src/features/workspace src/features/documents/ExternalChangeDialog.test.ts src/features/canvas/AddNodePicker.test.ts src/features/canvas/DeleteImpactDialog.test.ts src/features/commands/CommandPalette.test.ts
npx playwright test tests/e2e/modal-layout.spec.ts --project=chromium --grep "New Workflow|Import|Quick|External|Add Node|Delete|Command"
npx playwright test tests/e2e/modal-layout.spec.ts --project=webkit --grep "New Workflow|Import|Quick|External|Add Node|Delete|Command"
npm run check
```

Expected: PASS with every migrated surface matching `:modal` and retaining visible actions at reflow geometry.

```bash
git add src/app/ModalShell.svelte src/app/ModalShell.test.ts src/features/workspace src/features/documents/ExternalChangeDialog.svelte src/features/documents/ExternalChangeDialog.test.ts src/features/canvas/AddNodePicker.svelte src/features/canvas/AddNodePicker.test.ts src/features/canvas/DeleteImpactDialog.svelte src/features/canvas/DeleteImpactDialog.test.ts src/features/commands/CommandPalette.svelte src/features/commands/CommandPalette.test.ts tests/e2e/modal-layout.spec.ts
git commit -m "feat: add responsive modal foundation"
```

### Task 9: Complete modal migration, notices, status reflow, and long-content resilience

**Files:**
- Create: `src/app/ApplicationNotice.svelte`
- Create: `src/app/ApplicationNotice.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `src/app/StatusBar.svelte`
- Modify: `src/app/StatusBar.test.ts`
- Modify: `src/features/version-control/CreateVersionDialog.svelte`
- Modify: `src/features/version-control/CreateVersionDialog.test.ts`
- Modify: `src/features/version-control/InitializeRepositoryDialog.svelte`
- Modify: `src/features/version-control/RepositoryIdentityDialog.svelte`
- Modify: `src/features/version-control/RepositoryDialogs.test.ts`
- Modify: `src/features/branding/BrandPreview.svelte`
- Modify: `src/features/branding/BrandPreview.test.ts`
- Modify: `src/features/branding/BrandSettings.svelte`
- Modify: `src/features/branding/BrandSettings.test.ts`
- Modify: `src/features/setup/SetupOverlay.svelte`
- Modify: `src/features/setup/SetupOverlay.test.ts`
- Modify: `src/features/setup/ProgressStageList.svelte`
- Modify: `src/features/updates/UpdateOverlay.svelte`
- Modify: `src/features/updates/UpdateOverlay.test.ts`
- Modify: `tests/e2e/modal-layout.spec.ts`
- Modify: `tests/e2e/update-progress.spec.ts`
- Modify: `tests/e2e/workbench-containment.spec.ts`
- Modify: `tests/accessibility/keyboard-authoring.test.ts`
- Modify: `tests/accessibility/reduced-motion.test.ts`

**Interfaces:**
- Consumes: `ModalShell`, existing version/branding/setup/update operations, workspace error strings, contract advisories, and StatusBar stores.
- Produces: fully migrated modal stack, `ApplicationNotice`, narrow status summary, and bounded long-content presentation.

- [ ] **Step 1: Add failing remaining-modal tests**

Require Create Version, Initialize Repository, Repository Identity, recovery, keyboard shortcuts, brand preview/removal, Setup, and Update to be true modal top-layer surfaces with visible actions at 512 x 350 effective geometry. Verify Create Version background controls cannot receive focus and the primary action remains reachable after a long diff/findings list.

- [ ] **Step 2: Add failing ApplicationNotice and status-reflow tests**

Define ApplicationNotice props:

```ts
interface Props {
  kind: 'error' | 'warning' | 'info'
  message: string
  dismissible?: boolean
  onDismiss?: () => void
}
```

Require bounded content, wrapping, the correct alert/status role, and a named Dismiss button when permitted.

At narrow width, require Git and Updates summary to remain visible while YAML/DAG details move into a named `More application status` disclosure. No status text may overlap another item or widen the root.

- [ ] **Step 3: Run focused tests and prove current modality/reflow failures**

Run:

```bash
npm run test:unit -- src/app/App.test.ts src/app/ApplicationNotice.test.ts src/app/StatusBar.test.ts src/features/version-control src/features/branding src/features/setup src/features/updates tests/accessibility
npx playwright test tests/e2e/modal-layout.spec.ts tests/e2e/update-progress.spec.ts tests/e2e/workbench-containment.spec.ts --project=chromium
```

Expected: FAIL on nonmodal Git dialogs, pseudo-modal recovery/shortcuts, zoomed action geometry, fixed workspace alerts, and missing status reflow.

- [ ] **Step 4: Migrate ordinary remaining dialogs to ModalShell**

Use ModalShell for Git, recovery, shortcuts, brand preview, and brand removal. Preserve pending/authorization behavior and existing safe default focus. Recovery focuses Recover; destructive confirmations focus Cancel unless the existing approved behavior specifies another safe action.

Keep Setup and Update specialized, but apply the same grid rows, `max-block-size: calc(100dvh - 2rem)`, internal body/log scrolling, persistent actions, top-layer opening, and focus rules. At narrow widths change ProgressStageList from four columns to a stacked two-row layout so messages and timings remain visible.

- [ ] **Step 5: Replace unbounded fixed alerts and implement status disclosure**

Render workspace and operation errors through ApplicationNotice in a bounded notice region with `max-block-size`, internal scrolling, long-path wrapping, and safe dismissal. Contract availability advisories remain non-destructive status messages and do not repeatedly announce unchanged content.

In StatusBar, render wide secondary items normally and a narrow `<details>` disclosure with the same YAML/DAG text. Ensure only one accessible copy is exposed for the active presentation and add reduced-motion/forced-colors styles.

- [ ] **Step 6: Pass cross-engine, accessibility, and update checks**

Run:

```bash
npm run test:unit -- src/app src/features/version-control src/features/branding src/features/setup src/features/updates tests/accessibility
npx playwright test tests/e2e/modal-layout.spec.ts tests/e2e/update-progress.spec.ts tests/e2e/workbench-containment.spec.ts --project=chromium
npx playwright test tests/e2e/modal-layout.spec.ts tests/e2e/update-progress.spec.ts tests/e2e/workbench-containment.spec.ts --project=webkit
npm run check
```

Expected: PASS with no interactive background behind any claimed modal and no offscreen action footer.

- [ ] **Step 7: Commit the resilience completion**

```bash
git add src/app src/features/version-control src/features/branding src/features/setup src/features/updates tests/e2e/modal-layout.spec.ts tests/e2e/update-progress.spec.ts tests/e2e/workbench-containment.spec.ts tests/accessibility
git commit -m "fix: complete responsive modal and status behavior"
```

### Task 10: Close cross-engine, performance, and installed-release verification

**Files:**
- Modify: `src/e2e/bootstrap.ts`
- Modify: `tests/e2e/workbench-containment.spec.ts`
- Modify: `tests/e2e/activity-pages.spec.ts`
- Modify: `tests/e2e/modal-layout.spec.ts`
- Modify: `tests/e2e/workbench-layout.spec.ts`
- Modify: `tests/e2e/canvas-capacity.spec.ts`
- Modify: `tests/performance/canvas-performance.test.ts`
- Modify: `.github/workflows/ci.yml` only if new test files are not already covered by `npm run test:e2e`
- Create: `docs/verification/2026-08-30-content-aware-workbench.md`

**Interfaces:**
- Consumes: every prior task, deterministic E2E bridge/scenarios, existing large-workflow fixture, release scripts, and native artifacts.
- Produces: final long-content fixtures, automated release gates, and honest macOS/Windows installed-app evidence.

- [ ] **Step 1: Add deterministic adversarial E2E scenarios**

Extend the E2E-only bootstrap with fixed scenarios for:

- repeated equivalent diagnostics;
- a long Windows workspace/path/ref/commit identity;
- long update/setup messages and logs;
- many contract/brand entries;
- a long Create Version diff and findings list; and
- an Advanced Inspector field set.

Do not import test fixtures into the production bootstrap. Bound every generated string and keep the scenarios deterministic.

- [ ] **Step 2: Complete the geometry and state matrix**

For Chromium and WebKit, cover 1024 x 700, 1280 x 800, 1440 x 900, and effective 200%-zoom/reflow geometry. For every active surface assert:

```ts
expect(document.documentElement.scrollHeight).toBe(document.documentElement.clientHeight)
expect(document.documentElement.scrollWidth).toBe(document.documentElement.clientWidth)
expect(statusBar.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight)
```

Also assert last-control reachability, authoring state preservation, real top-layer modality, focus restoration, no duplicate-key/page errors, contained technical strings, correct Split classification, and zero canvas-control hit interception.

- [ ] **Step 3: Re-run the large-canvas performance contract**

At 250 nodes/500 edges, perform real node drag, port connect/rejection, surface navigation away/back, Inspector open/close, and Problems scrolling. Require no authoring-triggered Chromium long task above the existing 50ms threshold and zero parse/validate/layout/Git/native/file operations during pointer moves.

- [ ] **Step 4: Run complete automated verification from a clean worktree**

Run:

```bash
npm run format:check
npm run lint
npm run check
npm run contracts:check
npm run examples:check
npm run resources:verify
npm run test:unit -- tests/performance tests/accessibility
npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1
npm run test:rust
npm run build
npm run test:e2e
git diff --check
git status --short
```

Expected: every command PASS. Retain only already documented non-blocking build-size advisories. Do not weaken a geometry, modality, DAG, preservation, or performance assertion to obtain a pass.

- [ ] **Step 5: Build release artifacts and perform installed-app smoke checks**

Build native artifacts through the existing release commands for the available host. Install and test the macOS artifact locally; use the native Windows release runner for Windows verification.

Record for each platform:

- artifact name, architecture, version, and checksum;
- OS and WebView version;
- offline startup and bundled Geist loading;
- Welcome and folder open/cancel;
- Explorer/Nodes drawer sizing and last action;
- Settings categories and long values;
- Example and Documentation detail navigation;
- Git status/diff/history/version dialogs;
- long Inspector and Problems scrolling;
- Split threshold behavior;
- canvas toolbar, node drag, valid port connection, and rejected cycle;
- modal focus isolation and action reachability at 200% zoom;
- setup/update long logs;
- dark/light theme, reduced motion, forced colors where the platform supports it; and
- status-bar visibility.

Never record an unperformed Windows or macOS check as passing.

- [ ] **Step 6: Write the verification record**

Create `docs/verification/2026-08-30-content-aware-workbench.md` containing exact commands, commit identity, artifact checksums, automated totals, platform results, and any remaining non-blocking advisories. Link the approved spec and this plan.

- [ ] **Step 7: Commit verification evidence**

```bash
git add src/e2e/bootstrap.ts tests/e2e tests/performance/canvas-performance.test.ts .github/workflows/ci.yml docs/verification/2026-08-30-content-aware-workbench.md
git commit -m "test: verify content-aware workbench release"
```

- [ ] **Step 8: Review the complete branch before integration**

Run:

```bash
git log --oneline base..HEAD
git diff --stat base...HEAD
git diff --check base...HEAD
git status --short --branch
```

Expected: the prior native-dialog/rail fixes, approved design/plan, ten independently reviewable remediation commits, verification evidence, and no unrelated or uncommitted files.
