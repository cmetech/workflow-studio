# Task 2 report: Modernize shared controls and high-frequency application chrome

## Implementation

- Added explicit titlebar semantics: `New Workflow` is `primary`; `Open Folder` is `secondary`.
- Replaced activity-rail Unicode glyphs with the specified Lucide `Files`, `Workflow`, `GalleryVerticalEnd`, `BookOpen`, `GitBranch`, and `Settings` SVG icons. The buttons retain their command-registry labels, titles, enabled states, and execution paths, and now expose stable `data-activity` values.
- Updated high-frequency shell, Explorer, Inspector, editor document tabs, YAML surface, node palette, and status bar to consume the Task 1 spacing, radius, control-size, focus, elevated-surface, selected-state, sans, and mono primitives without changing workflow, YAML, canvas, or command behavior.
- Marked ordinary actions with explicit `ghost` or `secondary` semantics and destructive actions with `danger` semantics.
- Repository-wide destructive-control search identified these confirmation controls outside the narrow brief list and included them mechanically:
  - `src/features/canvas/DeleteImpactDialog.svelte` — `Delete nodes`
  - `src/features/branding/BrandSettings.svelte` — `Revert to LOOP24 and remove`
  - `src/features/workspace/ImportExportDialog.svelte` — `Replace YAML Pair`

## Files changed

- `src/app/App.svelte`, `src/app/App.test.ts`
- `src/app/ActivityRail.svelte`, `src/app/ActivityRail.test.ts`
- `src/app/StatusBar.svelte`, `src/app/StatusBar.test.ts`
- `src/features/workspace/Explorer.svelte`, `src/features/workspace/Explorer.test.ts`
- `src/features/workspace/ImportExportDialog.svelte`, `src/features/workspace/ImportExportDialog.test.ts`
- `src/features/inspector/Inspector.svelte`, `src/features/inspector/Inspector.test.ts`
- `src/features/editor/EditorModes.svelte`, `src/features/editor/EditorModes.test.ts`, `src/features/editor/YamlEditor.svelte`
- `src/features/canvas/NodePalette.svelte`, `src/features/canvas/DeleteImpactDialog.svelte`, `src/features/canvas/DeleteImpactDialog.test.ts`
- `src/features/branding/BrandSettings.svelte`, `src/features/branding/BrandSettings.test.ts`

## TDD evidence

### RED — shell semantics

```text
$ npm run test:unit -- src/app/App.test.ts src/app/ActivityRail.test.ts src/app/StatusBar.test.ts src/features/workspace/Explorer.test.ts src/features/inspector/Inspector.test.ts

Test Files  2 failed | 3 passed (5)
Tests  2 failed | 52 passed (54)

ActivityRail: Expected data-activity="explorer"; received null.
App: Expected data-variant="primary"; received null.
```

### RED — destructive confirmations

```text
$ npm run test:unit -- src/features/canvas/DeleteImpactDialog.test.ts src/features/branding/BrandSettings.test.ts src/features/workspace/ImportExportDialog.test.ts

Test Files  3 failed (3)
Tests  3 failed | 12 passed (15)

DeleteImpactDialog, BrandSettings, and ImportExportDialog each expected data-variant="danger"; received null.
```

### GREEN — focused semantic and destructive controls

```text
$ npm run test:unit -- src/app/App.test.ts src/app/ActivityRail.test.ts src/app/StatusBar.test.ts src/features/workspace/Explorer.test.ts src/features/inspector/Inspector.test.ts src/features/canvas/DeleteImpactDialog.test.ts src/features/branding/BrandSettings.test.ts src/features/workspace/ImportExportDialog.test.ts

Test Files  8 passed (8)
Tests  69 passed (69)
```

### Required focused verification

```text
$ npm run test:unit -- src/app/App.test.ts src/app/ActivityRail.test.ts src/app/StatusBar.test.ts src/features/workspace/Explorer.test.ts src/features/inspector/Inspector.test.ts src/features/editor src/features/canvas/NodePalette.test.ts tests/accessibility/keyboard-authoring.test.ts

Test Files  11 passed (11)
Tests  82 passed (82)

$ npm run check

svelte-check found 0 errors and 0 warnings
```

## Self-review

- Confirmed the activity rail uses the six required Lucide icons rather than platform-dependent symbol text.
- Confirmed the command registry is still the activity button execution path and all existing accessible labels remain in place.
- Confirmed no YAML parsing, DAG validation, native operation, layout, or persistence behavior changed.
- Confirmed the status bar now presents YAML/DAG states and update/Git information with mono typography.
- Confirmed every visible destructive confirmation found by focused repository search has `data-variant="danger"` and focused coverage.
- Ran `git diff --check`; no whitespace errors were reported.

## Concerns

None known. The fixed runtime brand-token schema was not changed.

## Fix round 1 — review findings

### Changes

- Assigned explicit variants to every button in the Task 2 chrome components: dialog Close/Cancel actions, brand import/preview/activate actions, Inspector and YAML tabs, node-palette node actions, Explorer tree actions, and App editor/recovery/shortcut controls.
- Replaced the remaining Explorer, Delete Impact dialog, and Brand Settings local focus outlines with `var(--focus-ring)`.
- Applied `var(--font-mono)` to import/export path metadata and delete-impact identifiers.

### Files changed

- `src/app/App.svelte`, `src/app/App.test.ts`
- `src/features/workspace/Explorer.svelte`, `src/features/workspace/Explorer.test.ts`
- `src/features/workspace/ImportExportDialog.svelte`, `src/features/workspace/ImportExportDialog.test.ts`
- `src/features/branding/BrandSettings.svelte`, `src/features/branding/BrandSettings.test.ts`
- `src/features/inspector/Inspector.svelte`, `src/features/inspector/Inspector.test.ts`
- `src/features/editor/EditorModes.svelte`, `src/features/editor/EditorModes.test.ts`
- `src/features/canvas/NodePalette.svelte`, `src/features/canvas/NodePalette.test.ts`
- `src/features/canvas/DeleteImpactDialog.svelte`, `src/features/canvas/DeleteImpactDialog.test.ts`

### RED

```text
$ npm run test:unit -- src/features/workspace/ImportExportDialog.test.ts src/features/branding/BrandSettings.test.ts src/features/inspector/Inspector.test.ts src/features/editor/EditorModes.test.ts src/features/canvas/NodePalette.test.ts src/features/canvas/DeleteImpactDialog.test.ts src/features/workspace/Explorer.test.ts

Test Files  5 failed | 2 passed (7)
Tests  5 failed | 38 passed (43)

ImportExportDialog expected Close to be secondary; BrandSettings expected Import to be primary; Inspector and EditorModes expected ghost tabs; NodePalette expected a secondary node action. Each received no data-variant.

$ npm run test:unit -- src/app/App.test.ts src/features/workspace/Explorer.test.ts

Test Files  2 failed (2)
Tests  2 failed | 40 passed (42)

App editor-mode buttons and Explorer tree-item buttons did not expose data-variant="ghost".
```

### GREEN and verification

```text
$ npm run test:unit -- src/features/workspace/ImportExportDialog.test.ts src/features/branding/BrandSettings.test.ts src/features/inspector/Inspector.test.ts src/features/editor/EditorModes.test.ts src/features/canvas/NodePalette.test.ts src/features/canvas/DeleteImpactDialog.test.ts src/features/workspace/Explorer.test.ts src/app/App.test.ts

Test Files  8 passed (8)
Tests  76 passed (76)

$ npm run check

svelte-check found 0 errors and 0 warnings
```

`git diff --check` also completed with no output. No behavior, color-token schema, or workflow boundaries changed.
