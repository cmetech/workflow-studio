# Workflow Studio modern workbench redesign

**Status:** Approved design, pending written-spec review  
**Date:** 2026-08-29

## Context

The installed macOS and Windows application does not currently meet the intended desktop-editor quality bar. The global scaffold stylesheet still gives every button a large yellow treatment, the default font is not bundled and therefore differs by operating system, and the fixed three-column workbench can reduce the canvas to an unusable width at the supported 1024-pixel window minimum.

The canvas also places a wide action toolbar over the graph viewport. At the default graph position, that toolbar intercepts real pointer input intended for nodes and connection handles. Existing end-to-end coverage dispatches synthetic drag events or confirms only that a stored layout exists; it does not prove that a node actually moved or that a real port gesture created a dependency.

This specification amends the visual-system, workbench-layout, canvas-interaction, accessibility, and verification portions of the authoritative 2026-07-25 Workflow Studio design. Workflow-language behavior, YAML ownership, DAG invariants, native capability boundaries, offline operation, and local-only Git scope remain unchanged.

## Product outcome

Workflow Studio will present as a compact, modern technical editor on both Windows and macOS. Its hierarchy will come from typography, spacing, and surface elevation rather than bright fills around every control. The canvas will retain a useful editing area at every supported window size, and real mouse or trackpad gestures will reliably move nodes and connect ports without being intercepted by application chrome.

The visual direction is a neutral slate foundation with electric indigo interaction color. LOOP24 gold remains in the approved logo and compact mark as a restrained brand signature; it is no longer the default fill for general application controls.

## Typography

The application bundles variable WOFF2 assets for Geist Sans and Geist Mono, together with their upstream license, and loads them locally with `@font-face`. No font request may require a network connection.

- Geist Sans is the interface face for navigation, forms, buttons, labels, and documentation.
- Geist Mono is used for YAML, code, identifiers, shortcuts, coordinates, and compact technical metadata.
- The fallback stack remains explicit so the application is usable if a font asset fails, but Windows and macOS acceptance runs must demonstrate that the bundled faces load.
- Interface copy uses a compact 14-pixel base size, a readable 1.45 line height, and a limited type scale. Hierarchy uses weight and spacing instead of pervasive uppercase text or excessive letter spacing.
- YAML retains editor-controlled sizing and line height, with Geist Mono as its first family.

## Color and semantic tokens

The fixed theme-token schema remains unchanged so existing runtime brand packs remain compatible. The bundled LOOP24 pack adopts the following operational palette while the logo and mark retain their approved gold artwork.

| Token | Dark | Light |
|---|---:|---:|
| `background` | `#0B0D12` | `#F5F7FB` |
| `surface` | `#11141C` | `#FFFFFF` |
| `surface-elevated` | `#181C27` | `#F8F9FD` |
| `text` | `#F4F6FA` | `#171A23` |
| `text-muted` | `#98A2B3` | `#667085` |
| `accent` | `#5B50E6` | `#5145CD` |
| `accent-strong` | `#766DF0` | `#4037A8` |
| `accent-contrast` | `#FFFFFF` | `#FFFFFF` |
| `border` | `#293042` | `#D8DEEA` |
| `focus` | `#8A80FF` | `#5145CD` |
| `success` | `#32C48D` | `#087A55` |
| `warning` | `#F5A524` | `#9A5B08` |
| `error` | `#FF6678` | `#B4233A` |
| `canvas` | `#0C0F15` | `#F7F8FC` |
| `grid` | `#252C3A` | `#E1E5EE` |
| `node` | `#151A24` | `#FFFFFF` |
| `node-selected` | `#252143` | `#EFEDFF` |
| `edge` | `#7C879D` | `#788397` |
| `edge-selected` | `#8A80FF` | `#5145CD` |
| `yaml-gutter` | `#0E1118` | `#F0F2F7` |
| `shadow` | `#00000080` | `#17203324` |

Every component consumes semantic tokens. The stale scaffold rules in `src/app.css` are removed, all uses of the nonexistent `--color-danger` token become `--color-error`, and component CSS must not introduce one-off gold, indigo, or platform-specific colors where a semantic token applies.

Buttons have explicit primary, secondary, ghost, and destructive treatments. Primary fill is reserved for the most important action in a region. Secondary and toolbar actions use subtle surfaces or transparent backgrounds. Disabled controls remain legible without appearing active. Hover, pressed, selected, focus, warning, and error are visually distinct in both themes.

## Workbench structure

The activity rail, title/header, explorer, editor, inspector, status information, dialogs, and overlays share one spacing and control system. Default controls are 32 to 36 pixels high; primary touch-sensitive targets and icon-only controls retain at least a 44-by-44-pixel effective hit area where pointer precision is not assumed.

The shell uses flexible tracks with `minmax(0, 1fr)` and permits descendants to shrink without overflowing. It does not impose a 64-rem body minimum. The native 1024-by-700 minimum is a supported, tested layout rather than an installation-only constraint.

Responsive behavior is based on available workbench width:

- At 1280 pixels and wider, Explorer and Inspector may remain docked. Pane dimensions stay bounded and the editor receives the remaining space.
- Below 1280 pixels, Explorer and Inspector become independently toggled overlay drawers. Opening one must not permanently reduce the canvas or YAML editor below its usable minimum.
- Split Canvas/YAML mode remains side by side only while both panes can retain at least 360 pixels. Below that threshold, Split becomes a tabbed Canvas/YAML presentation with an explicit subview switch while preserving the user's requested Split mode.
- Drawers, tab conversion, and viewport resizing preserve selection, unsaved YAML, scroll position where supported, graph layout, and focus ownership.
- Toolbars may wrap only in regions designed for two rows; otherwise lower-priority actions move into an overflow menu. No toolbar may cover an authoring surface.

Stored panel dimensions continue to describe user layout preferences, but restore logic clamps them to the current window and breakpoint. Stale dimensions from a larger display can never recreate an unusable editor.

## Canvas design and interaction

Canvas commands live in a dedicated workbench toolbar outside the Svelte Flow viewport. Zoom, fit, layout, add, and delete commands remain keyboard accessible and expose their shortcuts, but their DOM hit areas cannot overlap nodes, handles, selection rectangles, or the pane drop target.

Nodes use a restrained elevated surface, compact kind indicator, clear title/identifier hierarchy, and indigo selected state. Connection handles have a visible small form and a larger transparent hit target. Edges use neutral contrast by default and indigo for selected or actively connected states. Validation errors use the error token and never rely on color alone.

Pointer behavior must satisfy these invariants:

- Dragging a palette item onto visible canvas space creates a node at the corresponding flow coordinate.
- Dragging a node from its body changes its position by the real pointer displacement and commits layout only when the gesture ends.
- Dragging from an output handle to a valid input handle creates exactly one dependency and corresponding YAML edit.
- A self-edge, duplicate edge, cycle, or unresolved dependency is rejected before commit and announced accessibly.
- Buttons, form controls, drawers, and menus intentionally opt out of graph dragging; authoring surfaces do not accidentally opt out through an overlapping ancestor.
- Pointer-move frames update only transient visual state. They do not parse YAML, validate the full graph, run automatic layout, query Git, or perform file I/O.
- Keyboard node movement, keyboard edge creation, selection, deletion, undo, and redo remain equivalent paths to the pointer operations.

Targeted visual edits continue to operate on the YAML syntax tree and preserve comments, key order, scalar style, and unrelated or unknown fields. No separate persisted graph authority is introduced.

## Accessibility and motion

Both built-in themes must pass the existing activation contrast gates. Text, icons, focus rings, canvas selection, handles, and status states receive additional automated or manual contrast checks appropriate to their role. Focus is never removed, and overlay drawers trap focus only while modal. Escape closes the topmost transient surface and restores focus to its invoker.

All icon-only controls have accessible names and tooltips. Selected, expanded, invalid, and disabled states are programmatically exposed. Status changes and rejected graph operations use bounded live-region announcements. At 200 percent zoom and at the 1024-by-700 minimum, core authoring remains operable without content loss or two-dimensional page scrolling.

Reduced-motion preference disables decorative transitions and animated graph movement. Essential feedback may change immediately without animation. Cross-platform typography must not depend on subpixel rendering or fixed glyph measurements.

## Test-driven implementation

Implementation proceeds through behavior-first slices:

1. Add failing theme and typography tests that expose stale global button styling, undefined tokens, remote/font fallback behavior, and the old LOOP24 operational palette. Add the bundled fonts, updated pack, and consolidated global style foundation until they pass.
2. Add failing layout tests at 1024, 1180, 1280, and 1440 pixels for usable editor width, drawer behavior, split-to-tabs conversion, and persisted-dimension clamping. Implement the smallest responsive shell changes that satisfy them.
3. Add failing real-pointer end-to-end tests that assert a default node's coordinates change by a meaningful threshold and that an output-to-input gesture creates a dependency. Move canvas chrome outside the viewport and correct hit testing until Chromium and WebKit pass.
4. Add failing component behavior tests for button variants, focus restoration, drawer keyboard behavior, overflow actions, node selection, and invalid-edge announcements before updating the affected components.
5. Refactor repeated component CSS to shared primitives only after behavior is green. Route and shell components remain thin, and feature-owned state stays in the existing stores.
6. Run focused tests after each slice, then the full TypeScript suite, Svelte checks, lint/format checks, production build, Chromium/WebKit end-to-end coverage at wide and minimum windows, accessibility checks, and relevant Rust tests.
7. Re-run the 250-node/500-edge performance scenario. Canvas pointer interaction must meet the existing contract without ResizeObserver-loop errors, long pointer-frame work, or YAML/native work during pointer movement.
8. Perform installed-app smoke checks on macOS and Windows for font loading, minimum-window layout, palette-to-canvas drag, node drag, port connection, keyboard equivalents, theme switching, and offline startup before claiming release readiness.

Synthetic events may remain useful for focused unit tests, but they cannot be the sole evidence for drag-and-drop behavior. An end-to-end test passes only when it asserts the user-visible state change caused by real pointer input.

## Acceptance criteria

- The original base checkout remains unchanged; work occurs on a branch created from `base`.
- At 1024 by 700, the canvas or YAML editor retains a usable central work area and no toolbar overlays an authoring surface.
- Real pointer node dragging and valid port connection pass in both Chromium and WebKit, with state-change assertions that fail against the pre-redesign build.
- Default and custom brand packs still use the fixed semantic schema, validate in TypeScript and Rust, and work fully offline.
- LOOP24 artwork remains unchanged while general controls use the approved indigo/slate operational palette.
- Geist Sans and Geist Mono load from bundled assets on macOS and Windows, with no runtime font network request.
- Every component references defined semantic tokens; no `--color-danger` reference or scaffold-wide yellow button rule remains.
- Keyboard authoring, focus restoration, contrast, reduced motion, and 200-percent zoom meet the release accessibility requirements.
- The 250-node/500-edge performance verification passes without canvas chrome intercepting input or pointer frames performing prohibited work.
- YAML remains the sole workflow source of truth, and targeted graph edits preserve supported syntax-tree fidelity.

## Non-goals

- Changing the Hermes workflow language or authoring contract
- Replacing YAML with a separately persisted graph document
- Redesigning the approved LOOP24 logo or compact mark
- Adding cloud collaboration, telemetry, remote Git, authentication, or online font delivery
- Adding free-form cyclic graph support
- Moving YAML, graph validation, layout, forms, or DAG semantics into Rust
- Reworking native packaging except where installed-app visual verification discovers a platform-specific presentation defect
