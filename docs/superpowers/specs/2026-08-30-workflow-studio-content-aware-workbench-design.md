# Workflow Studio content-aware workbench design

**Status:** Approved design, pending written-spec review

**Date:** 2026-08-30

**Audience:** Engineers implementing, reviewing, testing, packaging, or maintaining Workflow Studio

## 1. Authority and scope

This specification amends the application-layout, activity-navigation, responsive-behavior, dialog, canvas-chrome, accessibility, and verification sections of:

- `docs/superpowers/specs/2026-07-25-workflow-studio-design.md`; and
- `docs/superpowers/specs/2026-08-29-workflow-studio-modern-workbench-redesign.md`.

The amendment replaces the assumption that every activity-rail destination belongs in the same narrow left panel. It establishes distinct presentation contracts for contextual panels, authoring surfaces, and content-rich application pages.

The following existing invariants remain unchanged:

- YAML is the sole workflow source of truth.
- Definition YAML and optional companion YAML are the only workflow outputs.
- Visual authoring permits directed acyclic graphs only.
- Structurally invalid YAML cannot be saved or exported.
- Runtime availability and trust findings remain non-blocking advisories.
- Workflow-language behavior comes from the bundled versioned Hermes authoring contract.
- The application remains fully functional offline.
- Rust owns privileged native operations only.
- Git remains local-only in version one.
- Targeted visual edits preserve comments, ordering, scalar style, and unrelated or unsupported YAML whenever the syntax tree permits it.
- Pointer-move frames never parse YAML, validate the graph, run layout, query Git, or perform native or file I/O.

## 2. Review evidence

The installed-app report that Settings content bled into its panel was reproducible in the deterministic browser/native harness. A broader Chromium and WebKit audit found that the defect was not isolated to Settings.

Measured examples include:

| Surface | Test geometry | Observed failure |
|---|---|---|
| Settings | 1440 x 900 | 279px panel contained 349px content; the application grew to about 2,134px high. |
| Settings | 1280 x 800 | About 233px panel contained 349px content; horizontal overflow exceeded 116px. |
| Examples | 1280 x 800 | Activity content grew beyond 5,000px; the first selected preview appeared about 5,030px below the viewport. |
| Documentation | 1280 x 800 | Search results plus the selected article grew beyond 12,000px and overflowed horizontally. |
| Inspector Advanced | 1280 x 800 | Long field content grew the workbench to about 10,054px instead of scrolling in the Inspector. |
| Problems | 1280 x 800 | A large issue list grew the application to about 4,044px because Problems occupied an implicit grid row. |
| Compact Explorer | 1024 x 700 | The drawer was about 192px wide and clipped the Import action. |
| Create Version | Effective 512 x 350 at 200% zoom | The primary action was outside the viewport in both tested engines. |

The existing end-to-end suite passed because it checked document-level overflow, drawer inert state, and focus restoration. It did not assert child scroll containment, last-control reachability, actionable-element geometry, true dialog modality, or long-content behavior.

## 3. Product outcome

Workflow Studio uses the right amount of space for each task:

- Explorer and Nodes remain contextual side panels beside the workflow.
- Visual, Split, and YAML remain the authoring workspace.
- Inspector and Problems remain authoring companions with bounded internal scrolling.
- Examples, Documentation, Git, and Settings become dedicated full-workbench pages.
- The no-workspace experience becomes a dedicated welcome page.
- Confirmations and focused data-entry tasks use one accessible responsive modal system.

The activity rail and titlebar remain stable across these surfaces. Switching away from authoring never discards an unsaved YAML draft, graph selection, viewport, editor mode, Inspector state, Problems state, or relevant scroll position.

## 4. Surface model

### 4.1 Stable shell regions

The installed desktop window has four stable regions:

1. Titlebar and primary application actions.
2. Activity rail.
3. One active workbench surface.
4. Status bar.

The application shell is constrained to the available WebView viewport. It does not grow to the intrinsic height of any descendant. The document itself does not become the scrolling container during ordinary application use.

The workbench owns the remaining height after titlebar and status bar. Every descendant that participates in a grid or flex scrolling chain declares `min-height: 0` and `min-width: 0` where required. Each surface has one intentional vertical scroll owner; nested accidental page scrolling is prohibited.

Use `100dvh` where supported with a `100vh` fallback appropriate to the Tauri WebView. The shell must continue to work when the operating system or WebView changes effective viewport dimensions.

### 4.2 Contextual panel mode

Explorer and Nodes are contextual authoring panels. Selecting either activity shows the authoring workspace and opens the corresponding left panel.

At 1280 CSS pixels and wider, the left panel may be docked. Its stored width is clamped without reducing the central editor below its supported minimum.

Below 1280 CSS pixels, the left panel becomes a nonmodal overlay drawer. Drawer sizing is independent of docked-panel clamping:

- preferred width: 320px;
- maximum width: available workbench width minus the 48px activity rail;
- minimum width when available: 280px; and
- on narrower reflow viewports, it consumes the available width rather than forcing horizontal overflow.

The drawer is internally scrollable, hidden drawers are inert, Escape closes the drawer when no higher-priority transient surface owns the event, and focus returns to its rail control.

Explorer header actions adapt to the available panel width. The New Workflow and Import commands remain directly reachable through compact icon controls or a named overflow menu; no action may be clipped. Explorer renders explicit loading, empty, ready, and error states.

The Nodes palette owns a bounded internal scroller. Every supported and deferred node-kind control remains reachable by pointer and keyboard at 1024 x 700 and at 200% zoom.

### 4.3 Authoring mode

Authoring mode contains:

- the Visual, Split, and YAML mode bar;
- the active Canvas surface, YAML surface, or both;
- the bounded Inspector; and
- the bounded Problems region.

The Inspector uses three rows: header, tabs, and `minmax(0, 1fr)` body. Only the body scrolls. Long schemas and all Advanced fields remain reachable without moving the application status bar.

Problems occupies an explicit grid row rather than an implicit content-sized row. The stored `panels.problems` layout value controls its preferred height and is clamped to the current workbench. The editor retains useful space, and the issue groups scroll within Problems. Repeated equivalent diagnostics have unique stable view identities; rendering them must not trigger duplicate-key errors.

Split mode uses side-by-side panes only when both Canvas and YAML retain at least 360px of usable content width after accounting for the divider. Otherwise, the existing Canvas/YAML subtab presentation is used. Both surfaces remain mounted so drafts, selection, viewport, and scroll positions survive the presentation change.

All canvas controls, including Svelte Flow zoom/fit controls, live in normal-flow canvas chrome outside the pointer viewport. No control, minimap, status banner, or overflow menu may overlap a placeable node or connection-handle region. If the minimap remains overlaid by the graph library, the layout engine and drop calculations must reserve its entire hit area as non-placeable; moving it outside the pointer viewport is preferred.

Focusable connection ports either invoke the supported keyboard edge-creation flow with Enter and Space or cease claiming button semantics and keyboard focus. The dedicated Create Edge command remains available.

### 4.4 Full-workbench activity mode

Examples, Documentation, Git, and Settings are page activities. Selecting one replaces the ordinary left panel, editor, Inspector, and Problems presentation with a page spanning every workbench column after the activity rail.

The authoring components remain mounted but hidden and inert so their in-memory state survives. Hidden authoring surfaces perform no background parsing, layout, Git query, or native work beyond behavior already required for the active document session.

Each page has:

- a page title and short description;
- an explicit Back to Workflow action;
- a responsive content container;
- one intentional vertical scroll owner;
- no horizontal page scrolling;
- loading, empty, ready, and error states where asynchronous data is involved; and
- focus placement on its heading or first meaningful control after navigation.

Back to Workflow restores the previously active authoring context and focus when the opener still exists. Selecting Explorer or Nodes also returns to authoring and opens that contextual panel. If no workflow is open, Back returns to the welcome page.

Page activities use page-navigation semantics such as `aria-current="page"`. Contextual panel activities use expansion semantics such as `aria-expanded`. A page activity must not claim that a left drawer is expanded.

## 5. Dedicated page designs

### 5.1 Welcome

When no workspace is open, the workbench shows a dedicated welcome page rather than an empty Explorer, active editor tabs, and a non-actionable Inspector.

The page contains:

- Open Folder as the primary action;
- folder drag and drop;
- recent folders when available;
- unavailable-recent-folder state; and
- concise offline/YAML-authority guidance.

The activity rail remains available. Settings, Documentation, Examples, and Git may still be opened where their prerequisites permit. Returning from those pages restores Welcome.

### 5.2 Settings

Settings uses a centered content area with a maximum reading width of 960px and responsive padding. It contains category navigation for:

1. Appearance;
2. Workflow Contracts;
3. Updates; and
4. About.

At wider sizes the category navigation may be a left-side list beside the active category. At narrow widths it becomes a top tab/list control and the content becomes one column.

Settings cards use restrained grouping rather than one unbounded stack. Action rows wrap or stack. Definition lists become one column when two columns would reduce readability. Digests, paths, versions, logs, and other technical values use Geist Mono inside wrapping or horizontally bounded code regions. No custom brand name, contract digest, path, update message, or translated label may force page overflow.

Appearance contains brand import, preview, activation, and removal. Workflow Contracts contains bundled/cached contract status, CLI profile, import/refresh, activation, and removal. Updates contains startup-check preference, update state, install/relaunch actions, and logs. About contains application, platform, bundled-contract, and release identity.

### 5.3 Examples

Examples uses the full page for browsing instead of stacking cards in the side panel.

The default page presents a responsive card grid with filtering metadata and clear Preview, Documentation, and Create Editable Copy actions. Selecting Preview opens an in-page detail state with a Back to Examples action, example explanation, definition YAML, optional companion YAML, concepts, and creation action. The preview does not render after the complete card list.

At least one card is visible per row at narrow widths. Wider layouts may show two or three cards while preserving readable summaries and actions. The catalog explicitly distinguishes loading, empty, ready, and error states and provides retry for recoverable load failures.

### 5.4 Documentation

Documentation uses a searchable master-detail page.

At wider sizes, a bounded navigation column contains search, topic filter, results, and history while the article occupies the primary reading column. Both regions have intentional scrolling. Selecting a result updates the visible article immediately; the article is never placed after the complete result list.

At narrow sizes, results and article become two internal states. Selecting a result shows the article with a Back to Results action. Search results, history labels, code, and long field identifiers wrap without horizontal page overflow. A zero-result query renders a clear status message.

Problem and Inspector documentation links open the requested article directly. Back to Workflow restores the originating authoring surface and focus when possible.

### 5.5 Git

Git uses the full page because status, diffs, history, identity, and version creation are not legible in a narrow drawer.

The page provides:

- repository and branch identity;
- pair/workspace status;
- Configure Identity and Create Version actions;
- unified and side-by-side diff modes;
- pair history and commit selection; and
- current-versus-historical preview with Restore as Draft.

Side-by-side diff is available only when each side retains a readable minimum width. Otherwise, the UI selects or recommends unified diff. Long Windows paths, commit subjects, author identities, and ref names wrap or remain within bounded code scrollers.

No remote Git action or branch mutation is added.

## 6. Responsive modal system

Workflow Studio uses one shared modal primitive for ordinary confirmations and focused data-entry tasks. It is based on the native HTML `dialog` top layer and calls `showModal()`; `aria-modal` alone is insufficient.

The modal contract includes:

- real background isolation and a visible backdrop;
- initial focus on the safest meaningful control;
- Tab and Shift+Tab containment;
- Escape behavior owned by the topmost dismissible modal;
- focus restoration to the opener;
- a width bounded by the viewport;
- a maximum block size bounded by the viewport;
- a scrollable content body;
- a persistent action footer that remains reachable; and
- wrapping paths, messages, and technical identifiers.

This primitive applies to:

- New Workflow;
- Import/Export;
- Create Version;
- Initialize Repository;
- Repository Identity;
- external-change decisions;
- delete-impact and destructive confirmations;
- recovery decisions;
- keyboard-shortcut help; and
- brand removal.

Setup and update overlays may retain specialized progress behavior, but they must meet the same viewport, focus, Escape, backdrop, long-content, and 200%-zoom requirements.

Native operating-system file and folder dialogs remain asynchronous and outside the HTML modal stack.

## 7. Messages, states, and visual details

Persistent workspace and operation errors use a bounded notification or message center rather than an indefinite fixed alert covering the editor. Messages provide dismissal when safe, wrap long paths, and expose appropriate alert/status semantics without repeatedly announcing unchanged text.

Required form fields use a separated required indicator or badge. Labels such as `Name required` and `Description required` must not concatenate visually. Color supplements rather than replaces the text indication.

All activities define loading, empty, ready, and error presentation where applicable. Empty states explain the next meaningful action. Errors do not masquerade as infinite loading.

The approved Geist Sans/Geist Mono typography, slate/indigo operational palette, LOOP24 artwork, semantic theme-token schema, control variants, and focus treatment remain unchanged. This amendment corrects layout hierarchy and component behavior rather than introducing another visual direction.

## 8. State and data flow

No new persisted workflow authority is introduced.

Shell navigation may add a small feature-owned state model that distinguishes:

- welcome;
- authoring with Explorer or Nodes context;
- Settings page;
- Examples page and optional selected example;
- Documentation page and selected topic;
- Git page; and
- the previous authoring return target.

This state contains presentation and navigation only. It never stores workflow semantics. Existing document, canvas, layout, Git, branding, contract, example, documentation, and update stores remain the domain authorities.

Route and shell components compose these surfaces but do not absorb their business logic. Page-specific state stays in the owning feature. Ephemeral focus openers and compact master-detail selection may remain component state.

Switching workbench surfaces does not trigger save, export, YAML serialization, graph layout, Git mutation, or file I/O. Existing background document validation may complete for the current revision, and stale results continue to be discarded by revision.

## 9. Accessibility and keyboard behavior

The complete workbench remains operable at the native 1024 x 700 minimum and at 200% text/page zoom without losing content or requiring two-dimensional page scrolling.

Required behavior includes:

- visible focus for every interactive control;
- no focusable element hidden outside a clipped panel;
- deterministic focus placement after page navigation;
- focus restoration after drawers, pages, menus, and modals;
- correct rail semantics for pages versus expandable panels;
- keyboard access to the last item in every scrollable list;
- meaningful empty and error announcements;
- no pseudo-modal `aria-modal` surfaces with an interactive background;
- reduced-motion behavior for drawer, page, dialog, and canvas transitions; and
- forced-colors focus and selected-state visibility.

The status bar remains visible during ordinary workbench use. If its content cannot fit at a reflow width, lower-priority details collapse behind an accessible status-summary control instead of overlapping or forcing horizontal overflow.

## 10. Error handling and resilience

Every asynchronous page loader records an explicit phase and catches rejection locally. A failure presents a bounded explanation and retry when retry is meaningful. A valid empty result is not treated as loading.

Repeated diagnostics render independently even when code, path, and message are equal. The UI key derives from a stable issue identity or a deterministic occurrence identity that includes source position and occurrence order.

Long or malformed external content is contained at the view boundary. It may scroll inside a code/diff/log region, but it cannot expand the application shell, hide all actions, or place focus outside the visible viewport.

Dialogs remain open with an actionable error when their operation fails. Pending actions disable only conflicting controls and expose `aria-busy` or a named progress state. Cancellation remains possible whenever the native operation is safely cancellable.

## 11. Test strategy

Implementation follows red-green-refactor. Tests assert user-visible behavior and geometry rather than snapshots or style enumeration counts.

### 11.1 Pure and component tests

Add behavior tests for:

- surface classification and Back to Workflow state restoration;
- independent docked-panel and overlay-drawer width resolution;
- bounded Inspector and Problems layout contracts;
- unique rendering identity for equivalent diagnostics;
- loading, empty, ready, and error states;
- responsive Explorer actions;
- Documentation master-detail navigation;
- Examples list/detail navigation;
- Settings category navigation;
- Git responsive diff presentation;
- real modal top-layer behavior and focus restoration; and
- port keyboard semantics.

### 11.2 Cross-engine end-to-end tests

Chromium and WebKit exercise 1024 x 700, 1280 x 800, and 1440 x 900, plus effective 200%-zoom/reflow geometry. Tests must:

- assert the root application and status bar remain within the viewport;
- assert the active surface has no unintended horizontal overflow;
- scroll to and focus the final Nodes, Examples, Documentation, Settings, Inspector, and Problems controls;
- assert every actionable bounding rectangle remains within its intended visible container;
- prove authoring draft, selection, viewport, modes, and scroll positions survive page navigation;
- prove selected Documentation and Example detail appears without scrolling past the entire result set;
- prove dialogs match `:modal`, isolate background focus, keep actions visible, and restore focus;
- prove long paths, digests, Git data, logs, and diagnostics remain contained;
- prove repeated equivalent diagnostics produce no page error or duplicate-key exception;
- prove Flow controls cannot intercept a node or port placed at any permitted coordinate;
- prove side-by-side Split is used only when both panes satisfy the 360px minimum; and
- retain the existing real pointer and DAG-invariant assertions.

Existing accessibility, reduced-motion, style-contract, resource-integrity, unit, Rust, and performance suites remain required.

### 11.3 Installed-app verification

macOS and Windows installed-app smoke checks cover:

- welcome and recent folders;
- contextual drawer sizing and all Explorer/Nodes actions;
- Settings, Examples, Documentation, and Git pages;
- long Inspector and Problems scrolling;
- Split threshold behavior;
- modal focus isolation and 200%-zoom action reachability;
- canvas controls and real node/port dragging;
- native folder/file-dialog cancellation;
- light and dark themes with bundled Geist fonts; and
- status-bar visibility.

## 12. Delivery sequence

Implementation proceeds in independently verified slices:

1. Constrain the application shell and establish explicit scroll ownership.
2. Separate contextual panels from full-workbench activity pages and preserve authoring state.
3. Implement Welcome and the Settings, Examples, Documentation, and Git page layouts.
4. Correct drawer sizing, Explorer actions, palette scrolling, and activity states.
5. Bound Inspector and Problems, fix diagnostic identity, correct Split thresholds, and remove remaining canvas-control overlap.
6. Introduce the shared responsive modal primitive and migrate affected dialogs.
7. Complete error/empty states, long-content containment, required-field styling, status reflow, and keyboard semantics.
8. Run complete cross-engine, accessibility, performance, Rust, build, and installed-app verification.

Each slice begins with a failing behavior test, implements the smallest correct change, passes focused verification, and is committed independently. No release is built until the complete verification sequence passes.

## 13. Acceptance criteria

This amendment is complete only when:

1. The application shell and status bar stay within the viewport for every supported surface and tested long-content fixture.
2. Explorer and Nodes are the only activity destinations rendered as contextual left panels.
3. Welcome, Settings, Examples, Documentation, and Git use dedicated workbench pages.
4. Full-page navigation preserves exact unsaved authoring state and restores the appropriate focus target.
5. Overlay drawers retain a practical width, never clip their header actions, and keep their last control reachable.
6. Settings has usable category navigation and zero horizontal overflow for long realistic content.
7. Example preview and selected Documentation articles appear immediately rather than after their complete lists.
8. Git status, diffs, history, and historical preview are readable at supported widths.
9. Inspector and Problems own bounded internal scrollers and cannot expand the application document.
10. Equivalent repeated diagnostics render without duplicate-key errors.
11. Every ordinary confirmation and data-entry modal uses the real top layer, isolates background focus, keeps its actions visible, and restores focus.
12. Canvas controls cannot overlap or intercept any permitted node, port, palette drop, or selection gesture.
13. Split panes remain side by side only when both retain at least 360px of usable width.
14. Loading, empty, ready, and error states are distinguishable and actionable where applicable.
15. The workbench remains keyboard operable, reduced-motion safe, forced-colors legible, and usable at 1024 x 700 and 200% zoom.
16. Chromium, WebKit, macOS installed-app, and Windows installed-app verification records contain no unperformed check represented as passing.
17. YAML authority, CST preservation, DAG rejection, offline resources, local-only Git, native capability scoping, and the 250-node/500-edge performance contract remain intact.

## 14. Non-goals

This work does not:

- change the Hermes workflow language or authoring contract;
- create a second graph or form authority;
- alter workflow YAML with editor-layout state;
- add workflow execution or simulation;
- add remote Git, authentication, or branch mutation;
- redesign the LOOP24 logo or replace the approved modern palette and typography;
- add cloud services, telemetry, collaboration, or online dependencies;
- redesign native packaging except where installed-app verification requires a presentation correction; or
- add a general-purpose routing framework when a small shell navigation state is sufficient.
