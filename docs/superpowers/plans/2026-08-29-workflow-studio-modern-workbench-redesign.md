# Workflow Studio Modern Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a consistent Geist-based slate/indigo desktop interface that remains usable at 1024×700 and whose canvas supports verified real-pointer node and port dragging in Chromium and WebKit.

**Architecture:** Keep YAML, projections, canvas state, and DAG authoring unchanged. Replace the stale global scaffold with semantic design primitives, add a small pure responsive-layout module plus shell visibility state, and separate canvas command chrome from the Svelte Flow pointer viewport. Tests assert semantic tokens, responsive behavior, persisted state, real pointer outcomes, accessibility, and prohibited-work metrics.

**Tech Stack:** Tauri 2, Svelte 5, TypeScript 6, Nanostores, Svelte Flow, Vitest/Testing Library, Playwright Chromium/WebKit, Geist variable fonts from Fontsource.

**Spec:** `docs/superpowers/specs/2026-08-29-workflow-studio-modern-workbench-redesign.md`

## Global Constraints

- YAML remains the sole workflow source of truth; no persisted graph authority may be added.
- The fixed runtime brand token schema remains unchanged, and custom packs remain compatible.
- LOOP24 logo and mark artwork remain unchanged; only the bundled operational theme changes.
- Geist Sans and Geist Mono must be bundled locally; the installed application must make no font network request.
- The native 1024×700 window minimum is a supported authoring layout.
- Split panes require at least 360 pixels each; otherwise Split uses explicit Canvas/YAML subtabs without destroying either surface.
- Canvas chrome must not overlap nodes, handles, selection rectangles, or the palette drop target.
- Pointer-move frames must not parse YAML, validate the graph, run layout, query Git, or perform native/file I/O.
- Real-pointer node movement and port connection must pass in Chromium and WebKit and assert authoritative state changes.
- Self-edges, duplicate edges, cycles, and unresolved dependencies remain rejected before commit.
- Keyboard authoring, visible focus, reduced motion, 200-percent zoom, and focus restoration remain release requirements.
- The 250-node/500-edge performance contract must pass before canvas completion is claimed.
- Use strict red-green-refactor cycles and commit each independently passing task.

---

### Task 1: Establish the offline typography and semantic color contract

**Files:**
- Create: `tests/project/style-contract.test.ts`
- Create: `docs/licenses/Geist-OFL-1.1.txt`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.ts`
- Modify: `src/app.css`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/loop24.css`
- Modify: `brands/loop24/brand.yaml`
- Modify: `src-tauri/resources/setup-integrity-v1.json`
- Modify: `src/lib/branding/load-brand.test.ts`
- Modify: `src/lib/branding/validate-theme.test.ts`

**Interfaces:**
- Consumes: existing `THEME_TOKEN_NAMES`, `loadBundledBrand()`, and fixed `BrandManifest` schema.
- Produces: `--font-sans`, `--font-mono`, spacing/radius/control tokens, and the exact default theme values from the approved spec. All later component work consumes these CSS properties.

- [ ] **Step 1: Write the failing palette and style-contract tests**

Update the bundled-brand expectations to the approved operational colors:

```ts
it('uses the approved LOOP24 identity with the modern operational palette', () => {
  const brand = loadBundledBrand()

  expect(brand.id).toBe('loop24')
  expect(brand.displayName).toBe('LOOP24 Workflow Studio')
  expect(brand.themes.dark).toMatchObject({
    background: '#0B0D12',
    accent: '#5B50E6',
    'accent-contrast': '#FFFFFF',
    'node-selected': '#252143',
    'edge-selected': '#8A80FF',
  })
  expect(brand.themes.light).toMatchObject({
    background: '#F5F7FB',
    accent: '#5145CD',
    'accent-contrast': '#FFFFFF',
    'node-selected': '#EFEDFF',
    'edge-selected': '#5145CD',
  })
})
```

Create a source-level invariant test that walks `src/**/*.svelte` and `src/**/*.css`, extracts every `var(--color-*)` reference, and requires its name to exist in `THEME_TOKEN_NAMES`. Also require exact Geist dependencies and forbid the removed yellow scaffold rule:

```ts
expect(packageJson.dependencies['@fontsource-variable/geist']).toBe('5.3.0')
expect(packageJson.dependencies['@fontsource-variable/geist-mono']).toBe('5.3.0')
expect(referencedColors).toContain('accent')
expect(referencedColors).toContain('error')
expect(unknownColors).toEqual([])
expect(appCss).not.toMatch(/background\s*:\s*#fad22d/i)
expect(appCss).toContain('font-family: var(--font-sans)')
```

- [ ] **Step 2: Run the focused tests and prove they fail against the old palette**

Run:

```bash
npm run test:unit -- src/lib/branding/load-brand.test.ts src/lib/branding/validate-theme.test.ts tests/project/style-contract.test.ts
```

Expected: FAIL because the bundled palette is gold/beige, the font packages are absent, and `--color-danger` plus `--color-surface-raised` are not defined theme tokens.

- [ ] **Step 3: Install the pinned offline fonts and define the visual foundation**

Run:

```bash
npm install --save-exact @fontsource-variable/geist@5.3.0 @fontsource-variable/geist-mono@5.3.0
```

Import the variable-font CSS before application styles in `src/main.ts`:

```ts
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './app.css'
import './styles/tokens.css'
import './styles/loop24.css'
```

Define local, non-brand design primitives in `tokens.css`:

```css
:root {
  color-scheme: dark;
  --font-sans: 'Geist Variable', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Geist Mono Variable', 'SFMono-Regular', Consolas, monospace;
  --radius-sm: 0.375rem;
  --radius-md: 0.625rem;
  --radius-lg: 0.875rem;
  --control-sm: 2rem;
  --control-md: 2.25rem;
  --focus-ring: 0 0 0 3px color-mix(in srgb, var(--color-focus) 34%, transparent);
}
```

Replace the fallback color values in `tokens.css` and both themes in `brands/loop24/brand.yaml` with the exact table in the approved spec. Rewrite `app.css` as a reset and shared control foundation: border-box sizing, full-height root, 14-pixel Geist body type, inherited form fonts, neutral default buttons, primary/destructive data variants, consistent inputs, and reduced motion. Remove the scaffold `main`, heading/paragraph, yellow button, and fixed-width rules. Remove `body { min-width: 64rem; }` from `loop24.css`.

Add the upstream OFL-1.1 license text from the installed Geist package to `docs/licenses/Geist-OFL-1.1.txt`. Replace every `--color-danger` reference with `--color-error` and replace `--color-surface-raised` with `--color-surface-elevated`.

- [ ] **Step 4: Refresh the protected resource digest and prove offline resource integrity**

After changing `brands/loop24/brand.yaml`, calculate its exact byte size and SHA-256 digest and update only that file's entry in `src-tauri/resources/setup-integrity-v1.json`.

Run:

```bash
npm run resources:verify
```

Expected: PASS with the new brand manifest bytes and no missing, extra, or mismatched bundled resources.

- [ ] **Step 5: Run the complete branding/style slice**

Run:

```bash
npm run test:unit -- src/lib/branding tests/project/style-contract.test.ts
npm run test:rust -- branding
npm run check
```

Expected: all commands PASS; both built-in themes pass the existing TypeScript and Rust contrast gates.

- [ ] **Step 6: Commit the typography and theme foundation**

```bash
git add package.json package-lock.json src/main.ts src/app.css src/styles/tokens.css src/styles/loop24.css brands/loop24/brand.yaml src-tauri/resources/setup-integrity-v1.json src/lib/branding tests/project/style-contract.test.ts docs/licenses/Geist-OFL-1.1.txt
git commit -m "feat: modernize typography and theme foundation"
```

### Task 2: Modernize shared controls and high-frequency application chrome

**Files:**
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `src/app/ActivityRail.svelte`
- Modify: `src/app/ActivityRail.test.ts`
- Modify: `src/app/StatusBar.svelte`
- Modify: `src/app/StatusBar.test.ts`
- Modify: `src/features/workspace/Explorer.svelte`
- Modify: `src/features/workspace/Explorer.test.ts`
- Modify: `src/features/inspector/Inspector.svelte`
- Modify: `src/features/inspector/Inspector.test.ts`
- Modify: `src/features/editor/EditorModes.svelte`
- Modify: `src/features/editor/YamlEditor.svelte`
- Modify: `src/features/canvas/NodePalette.svelte`

**Interfaces:**
- Consumes: Task 1 CSS font, radius, control, focus, and semantic color properties.
- Produces: explicit `data-variant="primary|secondary|ghost|danger"` control semantics and stable `data-activity` hooks used by responsive focus restoration in Task 3.

- [ ] **Step 1: Write failing semantic-control and activity-rail tests**

Require a single primary titlebar action, a secondary Open Folder action, named SVG activity icons instead of platform-dependent glyphs, and activity hooks:

```ts
expect(screen.getByRole('button', { name: 'New Workflow' })).toHaveAttribute('data-variant', 'primary')
expect(screen.getByRole('button', { name: 'Open Folder' })).toHaveAttribute('data-variant', 'secondary')
expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('data-activity', 'explorer')
expect(screen.getByRole('button', { name: 'Settings' }).querySelector('svg')).not.toBeNull()
```

Add component assertions that Explorer, Inspector, editor document tabs, and status content expose their existing labels/states without relying on visual glyph text.

- [ ] **Step 2: Run the focused shell tests and verify the new semantics fail**

Run:

```bash
npm run test:unit -- src/app/App.test.ts src/app/ActivityRail.test.ts src/app/StatusBar.test.ts src/features/workspace/Explorer.test.ts src/features/inspector/Inspector.test.ts
```

Expected: FAIL because variant/activity attributes and Lucide activity icons do not exist.

- [ ] **Step 3: Apply the compact modern chrome**

Use Lucide `Files`, `Workflow`, `GalleryVerticalEnd`, `BookOpen`, `GitBranch`, and `Settings` icons in the activity rail. Keep the accessible command labels and tooltips, add `data-activity={activity.id}`, and preserve command-registry execution.

In `App.svelte`, mark New Workflow primary and Open Folder secondary. Reduce titlebar visual weight, retain the LOOP24 mark, replace the gold eyebrow treatment with muted text, and use the shared control sizes. Update the activity rail, status bar, Explorer, Inspector, editor tabs, YAML surface, and node palette to use the Task 1 spacing, radii, border, elevated surface, sans/mono, selected, and focus primitives. Do not change their data flow or command behavior.

Destructive confirmations use `data-variant="danger"`; ordinary toolbar actions default to ghost or secondary. Required/error messages use `--color-error`, and YAML/code/IDs/shortcuts use `--font-mono`.

- [ ] **Step 4: Run the focused tests, keyboard regression, and Svelte checks**

Run:

```bash
npm run test:unit -- src/app/App.test.ts src/app/ActivityRail.test.ts src/app/StatusBar.test.ts src/features/workspace/Explorer.test.ts src/features/inspector/Inspector.test.ts src/features/editor src/features/canvas/NodePalette.test.ts tests/accessibility/keyboard-authoring.test.ts
npm run check
```

Expected: PASS with unchanged commands, labels, keyboard flow, and YAML behavior.

- [ ] **Step 5: Commit the shared chrome**

```bash
git add src/app src/features/workspace/Explorer.svelte src/features/workspace/Explorer.test.ts src/features/inspector src/features/editor src/features/canvas/NodePalette.svelte src/features/canvas/NodePalette.test.ts
git commit -m "feat: modernize workbench chrome and controls"
```

### Task 3: Make the workbench responsive and restore panel preferences safely

**Files:**
- Create: `src/lib/layout/workbench-layout.ts`
- Create: `src/lib/layout/workbench-layout.test.ts`
- Create: `src/stores/shell.test.ts`
- Create: `tests/e2e/workbench-layout.spec.ts`
- Modify: `src/stores/shell.ts`
- Modify: `src/lib/commands/registry.ts`
- Modify: `src/lib/commands/registry.test.ts`
- Modify: `src/app/ActivityRail.svelte`
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`

**Interfaces:**
- Consumes: `LayoutRecordV1.panels`, `$activeLayout`, `$activeActivity`, `$activeEditorMode`.
- Produces: `resolveWorkbenchPresentation(workbenchWidth, editorWidth)`, `clampDockedPanels(panels, workbenchWidth)`, `$workspacePanelOpen`, `$inspectorPanelOpen`, `toggleActivityPanel()`, `openInspectorPanel()`, and `closeTransientPanels()`.

- [ ] **Step 1: Write failing pure layout tests**

Define the exact interface and boundary behavior:

```ts
expect(resolveWorkbenchPresentation(1279, 900)).toEqual({ panels: 'drawers', split: 'side-by-side' })
expect(resolveWorkbenchPresentation(1280, 719)).toEqual({ panels: 'docked', split: 'tabs' })
expect(resolveWorkbenchPresentation(1440, 840)).toEqual({ panels: 'docked', split: 'side-by-side' })

const panels = clampDockedPanels({ left: 5000, right: 5000, problems: 180 }, 1280)
expect(panels.left).toBeGreaterThanOrEqual(192)
expect(panels.right).toBeGreaterThanOrEqual(240)
expect(48 + panels.left + panels.right + 720).toBeLessThanOrEqual(1280)
expect(panels.problems).toBe(180)
```

Use constants `DOCKED_WORKBENCH_MIN_WIDTH = 1280`, `SIDE_BY_SIDE_MIN_EDITOR_WIDTH = 720`, `MIN_EDITOR_WIDTH = 720`, `MIN_LEFT_PANEL_WIDTH = 192`, and `MIN_RIGHT_PANEL_WIDTH = 240`.

- [ ] **Step 2: Run the pure tests and prove the module is missing**

Run:

```bash
npm run test:unit -- src/lib/layout/workbench-layout.test.ts
```

Expected: FAIL because `workbench-layout.ts` does not exist.

- [ ] **Step 3: Implement the pure classification and clamping functions**

`resolveWorkbenchPresentation()` returns drawers below 1280 and tabs below 720 editor pixels. `clampDockedPanels()` first clamps each panel to its individual minimum/maximum, then reduces widths proportionally without crossing their minima until the activity rail plus panels plus 720-pixel editor fits. It never mutates its input and preserves `problems`.

- [ ] **Step 4: Add failing shell visibility and command tests**

Require this behavior:

```ts
closeTransientPanels()
expect($workspacePanelOpen.get()).toBe(false)
toggleActivityPanel('explorer')
expect($activeActivity.get()).toBe('explorer')
expect($workspacePanelOpen.get()).toBe(true)
toggleActivityPanel('explorer')
expect($workspacePanelOpen.get()).toBe(false)
openInspectorPanel()
expect($inspectorPanelOpen.get()).toBe(true)
```

Update the Explorer command test so `Mod+B` toggles visibility rather than merely reassigning the active activity.

- [ ] **Step 5: Run the shell tests and verify they fail before store changes**

Run:

```bash
npm run test:unit -- src/stores/shell.test.ts src/lib/commands/registry.test.ts
```

Expected: FAIL because panel visibility state and toggle functions are missing.

- [ ] **Step 6: Implement responsive panel and split presentation in the App**

Add the two panel atoms and functions to `shell.ts`; change activity commands to call `toggleActivityPanel(activity)`. In `App.svelte`, observe only workbench/editor resize boundaries, derive the pure presentation, and disconnect the observer on destroy. Never observe or write layout during pointer movement.

Render close buttons in both drawers. When a compact drawer is closed, set `inert` and `aria-hidden="true"`; when docked, ignore the transient visibility atom. `focusInspector()` opens the inspector first, awaits `tick()`, and then focuses its active control. Closing a drawer restores focus to its activity-rail control or node opener.

Apply clamped panel widths through `--left-panel-width` and `--right-panel-width`. Below 1280, position panels over the workbench with a scrim instead of allocating grid tracks. In Split mode below 720 editor pixels, show a `Split pane` group with Canvas and YAML buttons; hide only with CSS so both mounted surfaces retain state.

- [ ] **Step 7: Add failing then passing real-browser layout assertions**

In `workbench-layout.spec.ts`, test 1024×700, 1180×800, 1280×800, and 1440×900. At compact widths assert the visible authoring region is at least 720 pixels wide, hidden drawers are inert, a rail click opens the correct drawer, Escape closes it and restores focus, and no horizontal page overflow exists. Select a node and make an unsaved YAML edit before closing/reopening drawers, then assert both selection and exact editor text survive. At a forced editor width below 720, assert the Split pane switch is visible and swaps Canvas/YAML without changing the selected top-level Split mode or either surface's scroll position.

Run before the App/CSS implementation to capture failure, then after implementation:

```bash
npx playwright test tests/e2e/workbench-layout.spec.ts --project=chromium
npm run test:unit -- src/lib/layout/workbench-layout.test.ts src/stores/shell.test.ts src/lib/commands/registry.test.ts src/app/App.test.ts
```

Expected after implementation: PASS at all four viewport sizes.

- [ ] **Step 8: Commit responsive layout behavior**

```bash
git add src/lib/layout/workbench-layout.ts src/lib/layout/workbench-layout.test.ts src/stores/shell.ts src/stores/shell.test.ts src/lib/commands/registry.ts src/lib/commands/registry.test.ts src/app/App.svelte src/app/App.test.ts src/app/ActivityRail.svelte tests/e2e/workbench-layout.spec.ts
git commit -m "feat: add responsive workbench drawers and split panes"
```

### Task 4: Remove canvas chrome from the pointer viewport and prove node dragging

**Files:**
- Create: `src/features/canvas/CanvasToolbar.svelte`
- Create: `src/features/canvas/CanvasToolbar.test.ts`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `tests/e2e/workspace-authoring.spec.ts`

**Interfaces:**
- Consumes: `ResolvedCommand`, the existing `CommandSurface`, canvas command context, and Svelte Flow events.
- Produces: `CanvasToolbar` with `commands`, `minimapVisible`, `onExecute(id)`, and `onToggleMinimap()` props; a dedicated `[data-testid="workflow-canvas-viewport"]` pointer/drop surface.

- [ ] **Step 1: Strengthen node dragging and add a real-pointer port test**

Replace the false-positive layout assertion with an authoritative position delta:

```ts
const before = await layoutPosition(page, 'publish')
await dragNodeBy(page, 'publish', { x: 110, y: 120 })
await expect.poll(async () => (await layoutPosition(page, 'publish')).x).toBeGreaterThan(before.x + 80)
await expect.poll(async () => (await layoutPosition(page, 'publish')).y).toBeGreaterThan(before.y + 80)
```

`layoutPosition()` parses the saved layout string returned by `e2eSnapshot(page)`. `dragNodeBy()` starts 40 pixels below the node top, uses at least five real `page.mouse.move()` steps, and releases the mouse. Keep the reopen assertion, now comparing against a proven changed position.

Add a focused test that creates a third node through the Add Node dialog, then uses real mouse movement from the `Dependencies leaving publish` handle center to the new node's input-handle center. Assert authoritative YAML gains `depends_on: [publish]`. Attempt `publish` to `prepare` as well and assert the cycle is announced while YAML remains byte-for-byte unchanged.

- [ ] **Step 2: Run the strengthened test against the old overlay and prove it fails**

Run:

```bash
npx playwright test tests/e2e/workspace-authoring.spec.ts --project=chromium --grep "adds, duplicates|real port"
```

Expected: FAIL because the absolute canvas toolbar intercepts the default publish-node drag point/handle and neither the stored position nor dependency changes.

- [ ] **Step 3: Write failing component structure tests**

Require Canvas tools and the flow pointer viewport to be siblings, require every visible canvas-chrome region to sit outside the viewport, and require drop handlers only on the viewport:

```ts
const tools = screen.getByLabelText('Canvas tools')
const viewport = container.querySelector('[data-testid="workflow-canvas-viewport"]')
expect(viewport).not.toBeNull()
expect(viewport).not.toContainElement(tools)
for (const chrome of container.querySelectorAll('[data-canvas-chrome]')) {
  expect(viewport).not.toContainElement(chrome)
}
```

Add `CanvasToolbar.test.ts` assertions for command enablement, command IDs passed to `onExecute`, minimap pressed state, and accessible names/tooltips. Require Add Node and Create Edge to remain directly visible while Duplicate, Delete, Arrange, and Map live in a named `More canvas actions` menu, keeping the toolbar bounded even when a split pane is 360 pixels wide.

- [ ] **Step 4: Extract the toolbar and restructure GraphCanvas**

Make `.graph-canvas` a grid with auto-height toolbar/status rows followed by a `minmax(0, 1fr)` viewport. Put Svelte Flow alone in the relative pointer viewport. Render the stale banner and expanded keyboard edge picker as normal-flow canvas chrome above the viewport, with the screen-reader live region outside it. Attach palette `dragover`/`drop` only to the viewport. The toolbar is position-static; its bounded More menu owns the lower-priority actions and restores focus to its trigger when closed.

Keep the outer root for command registration and keyboard listeners. Do not change `handleDrag()`, `handleDragStop()`, the 300-millisecond persistence debounce, projection logic, or YAML authoring callbacks.

- [ ] **Step 5: Run focused unit and real-pointer tests**

Run:

```bash
npm run test:unit -- src/features/canvas/CanvasToolbar.test.ts src/features/canvas/GraphCanvas.test.ts tests/performance/canvas-performance.test.ts
npx playwright test tests/e2e/workspace-authoring.spec.ts --project=chromium --grep "adds, duplicates|real port"
```

Expected: PASS; the test proves node coordinates changed and survived reopen, while pointer-move metrics remain isolated.

- [ ] **Step 6: Commit the node-drag fix**

```bash
git add src/features/canvas/CanvasToolbar.svelte src/features/canvas/CanvasToolbar.test.ts src/features/canvas/GraphCanvas.svelte src/features/canvas/GraphCanvas.test.ts tests/e2e/workspace-authoring.spec.ts
git commit -m "fix: keep canvas toolbar outside drag viewport"
```

### Task 5: Prove palette and port dragging and finish the modern canvas visuals

**Files:**
- Modify: `src/features/canvas/WorkflowNode.svelte`
- Modify: `src/features/canvas/WorkflowEdge.svelte`
- Modify: `src/features/canvas/GraphCanvas.svelte`
- Modify: `src/features/canvas/GraphCanvas.test.ts`
- Modify: `tests/e2e/workspace-authoring.spec.ts`

**Interfaces:**
- Consumes: existing `onConnect(sourceId, targetId)` authoring coordinator and DAG rejection feedback.
- Produces: stable `data-node-id`, `data-port="input|output"` hooks and 32-pixel transparent port hit areas surrounding visible 10-pixel handles.

- [ ] **Step 1: Add failing node/port structure assertions and extend the real-pointer path through the palette**

In `GraphCanvas.test.ts`, require each rendered node to expose its stable node ID and both ports to expose `data-port="input|output"`; these assertions fail before `WorkflowNode` is changed.

Then revise the focused real-port test to create its third node through the actual palette. Open the seeded pair at 1440×900, open the Nodes activity, and use Playwright `dragTo()` from `Add Command node` to a point inside `[data-testid="workflow-canvas-viewport"]`. Assert authoritative YAML gains exactly one `command` node and saved layout places it near the requested flow coordinate. Continue the already-proven handle gesture from `publish` output to the new node input:

```ts
const palette = page.getByRole('region', { name: 'Nodes' })
const viewport = page.locator('[data-testid="workflow-canvas-viewport"]')
await palette.getByRole('button', { name: /add command node/i }).dragTo(viewport, {
  targetPosition: { x: 520, y: 360 },
})
await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toContain('  - id: command\n')
await dragPort(page, 'publish', 'output', 'command', 'input')
await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toContain(
  '  - id: command\n    command: ""\n    depends_on:\n      - publish\n',
)
```

Retain the `publish` output to `prepare` input cycle rejection and exact unchanged-YAML assertion from Task 4.

- [ ] **Step 2: Run the structure test before changing WorkflowNode**

Run:

```bash
npm run test:unit -- src/features/canvas/GraphCanvas.test.ts
```

Expected: FAIL because the stable `data-node-id` and `data-port` hooks do not exist.

- [ ] **Step 3: Implement stable hit targets and restrained node/edge styling**

Add `data-node-id={data.id}` to the node article and `data-port` to the two handles. Keep the 32-pixel transparent interactive box, render a 10-pixel semantic edge-colored center, and use focus/selected rings without changing Svelte Flow connectability.

Use `--color-node`, `--color-node-selected`, `--color-edge`, `--color-edge-selected`, `--color-error`, `--font-sans`, and `--font-mono` exclusively. Remove uppercase-heavy kind styling, reduce shadow weight, keep issue text in addition to color, and retain 32-pixel edge interaction width. Selected edges use `--color-edge-selected`; stale edges remain dashed and labeled through existing status text.

- [ ] **Step 4: Run canvas, DAG, YAML-preservation, and real-pointer tests**

Run:

```bash
npm run test:unit -- src/features/canvas src/lib/validation/dag-validator.test.ts src/lib/yaml/patch-document.test.ts
npx playwright test tests/e2e/workspace-authoring.spec.ts --project=chromium --grep "real palette and port|adds, duplicates"
```

Expected: PASS; valid connection edits YAML once, invalid connection edits nothing, and comments/unknown fields remain preserved by existing mutation tests.

- [ ] **Step 5: Commit canvas connection and visual behavior**

```bash
git add src/features/canvas/WorkflowNode.svelte src/features/canvas/WorkflowEdge.svelte src/features/canvas/GraphCanvas.svelte src/features/canvas/GraphCanvas.test.ts tests/e2e/workspace-authoring.spec.ts
git commit -m "fix: support reliable canvas port connections"
```

### Task 6: Close keyboard, focus, reduced-motion, and compact-layout accessibility gaps

**Files:**
- Modify: `tests/accessibility/keyboard-authoring.test.ts`
- Modify: `tests/accessibility/reduced-motion.test.ts`
- Modify: `src/app/App.test.ts`
- Modify: `src/app/App.svelte`
- Modify: `src/features/canvas/CanvasToolbar.svelte`
- Modify: `src/features/canvas/WorkflowNode.svelte`
- Modify: `tests/e2e/workbench-layout.spec.ts`

**Interfaces:**
- Consumes: Task 3 drawer state/focus hooks and Task 4/5 canvas toolbar/port structure.
- Produces: deterministic Escape/focus restoration, inert hidden drawers, named icon controls, and reduced-motion behavior across new workbench surfaces.

- [ ] **Step 1: Add failing accessibility behavior tests**

Extend keyboard coverage to open and close the compact Explorer and Inspector without pointer input, restore focus to the invoker, switch compact Split subtabs, and connect a node through the existing keyboard edge picker. Require every icon-only toolbar/drawer control to have an accessible name.

Extend reduced-motion coverage so the new drawer, split-subtab, node selection, and toolbar classes have no nonzero transition or animation duration when the media query matches.

- [ ] **Step 2: Run the accessibility slice and record the failures**

Run:

```bash
npm run test:unit -- tests/accessibility src/app/App.test.ts src/features/canvas/CanvasToolbar.test.ts
npx playwright test tests/e2e/workbench-layout.spec.ts --project=chromium
```

Expected: FAIL on the newly asserted compact focus/restoration or motion behavior until the component wiring is complete.

- [ ] **Step 3: Implement the minimal accessibility corrections**

Handle Escape at the shell level only when a transient drawer is open and no higher modal owns the event. Restore focus with stored `HTMLElement` openers after `tick()`. Hidden compact drawers are both visually hidden and inert. Split subtab buttons expose `aria-pressed`; drawers use `aria-expanded` on their invokers and do not claim `aria-modal` because they are nonmodal workbench overlays.

Apply reduced-motion rules to the new drawer transform, node ring, toolbar hover, and subtab transitions. Preserve immediate keyboard viewport movement. Ensure focus rings are visible in forced colors and both built-in themes.

- [ ] **Step 4: Run accessibility and style-contract gates**

Run:

```bash
npm run test:unit -- tests/accessibility src/app/App.test.ts src/features/canvas tests/project/style-contract.test.ts
npx playwright test tests/e2e/workbench-layout.spec.ts --project=chromium
npm run check
```

Expected: PASS with no focus teleportation into hidden panels and no undefined semantic color references.

- [ ] **Step 5: Commit accessibility completion**

```bash
git add src/app/App.svelte src/app/App.test.ts src/features/canvas tests/accessibility tests/e2e/workbench-layout.spec.ts
git commit -m "fix: complete accessible responsive authoring"
```

### Task 7: Add cross-browser gates and record final performance/platform evidence

**Files:**
- Modify: `playwright.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `src/e2e/bootstrap.ts`
- Create: `tests/e2e/canvas-capacity.spec.ts`
- Modify: `tests/performance/canvas-performance.test.ts`
- Create: `docs/verification/2026-08-29-modern-workbench-redesign.md`

**Interfaces:**
- Consumes: all prior behavior, the deterministic 250-node/500-edge fixture contract, and E2E snapshot controls.
- Produces: named `chromium` and `webkit` Playwright projects, a `large-canvas` E2E scenario, ResizeObserver/long-task evidence, and a native macOS/Windows smoke checklist with actual results.

- [ ] **Step 1: Add failing WebKit and large-canvas acceptance coverage**

Add a WebKit project using `devices['Desktop Safari']`. Import `createLargeWorkflowFixture` from `tests/performance/large-workflow.ts` into the E2E-only bootstrap, and when `scenario=large-canvas` serve its fixed-seed 250-node/500-edge YAML under the existing release-demo path. The normal production bootstrap does not import test fixtures.

In `canvas-capacity.spec.ts`, collect page errors and console messages, open the large scenario, prove node and edge counts remain at the supported boundary, perform a real node drag, and fail on `ResizeObserver loop` messages. In Chromium, install a `PerformanceObserver` for `longtask`, clear collected startup entries after the graph becomes stable, and require no authoring-triggered entry above 50 milliseconds. In both browsers, assert that drag changes layout and that the snapshot YAML is unchanged. Also require `document.fonts.load()` to resolve Geist Sans and Geist Mono and reject any font request whose URL is not under the local Playwright origin.

- [ ] **Step 2: Run the new browser gate before final tuning**

Run:

```bash
npx playwright install chromium webkit
npx playwright test tests/e2e/canvas-capacity.spec.ts
```

Expected: the test exposes any remaining ResizeObserver loop, pointer failure, or over-50-millisecond Chromium authoring task; do not weaken the assertions.

- [ ] **Step 3: Remove remaining resize/per-frame work and update CI**

Keep responsive observation on stable outer workbench/editor boxes, coalesce resize publication to one animation frame, and avoid observing elements whose own display mode changes their measured width. Preserve the existing metrics assertions that pointer moves perform zero parse, validation, layout, YAML, native, and Git work.

Update CI to install both engines:

```yaml
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium webkit
- run: npm run test:e2e
```

- [ ] **Step 4: Run complete automated verification from a clean state**

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

Expected: every command PASS; the build may retain only the already documented non-blocking bundle-size warning. The worktree contains no uncommitted files except the verification record being written in the next step.

- [ ] **Step 5: Perform installed-app macOS and Windows smoke checks**

On each platform install the produced native bundle and record: offline startup, Geist Sans/Mono loaded from app assets, dark/light theme switching, 1024×700 layout, drawer keyboard behavior, Canvas/YAML compact Split switch, palette drop, node drag with persisted reopen position, valid port connection, rejected cycle, keyboard equivalents, 200-percent zoom, reduced motion, and absence of ResizeObserver-loop messages.

Write exact commands, OS/WebView versions, artifact identity, observed results, and any remaining advisories to `docs/verification/2026-08-29-modern-workbench-redesign.md`. Do not mark an unperformed Windows or macOS check as passing.

- [ ] **Step 6: Commit cross-browser gates and verified evidence**

```bash
git add playwright.config.ts .github/workflows/ci.yml src/e2e/bootstrap.ts tests/e2e/canvas-capacity.spec.ts tests/performance/canvas-performance.test.ts docs/verification/2026-08-29-modern-workbench-redesign.md
git commit -m "test: verify modern workbench across renderers"
```

- [ ] **Step 7: Review branch history and final diff**

Run:

```bash
git log --oneline base..HEAD
git diff --stat base...HEAD
git diff --check base...HEAD
```

Expected: one documentation commit plus seven focused implementation commits, no unrelated files, and no whitespace errors.
