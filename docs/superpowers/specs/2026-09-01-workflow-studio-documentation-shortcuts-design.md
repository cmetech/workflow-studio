# Workflow Studio Documentation and Keyboard Help Design

**Status:** Approved in conversation
**Date:** 2026-09-01
**Audience:** Engineers implementing, reviewing, testing, or maintaining Workflow Studio's offline help experience
**Post-read action:** Implement a task-led documentation experience and a complete, discoverable keyboard reference without introducing hand-maintained copies of contract fields or registered shortcuts.

## 1. Problem

Workflow Studio already bundles offline guides, generated contract reference topics, a command registry, keyboard bindings, and a searchable shortcuts dialog. The underlying material is substantial, but its presentation makes it difficult to use:

- Documentation opens as a long, alphabetized reference list with an empty detail area rather than explaining where a user should begin.
- Generated fields with the same label appear once per applicable node kind. Labels such as Context, Depends on, When, Trigger rule, and Output type can each appear seven times without enough visible context to distinguish them.
- Guides and low-level field reference entries compete in one result list even though they serve different user intentions.
- A user must already know a term before search helps them. The page does not answer task-oriented questions such as how to create a first workflow, connect two nodes, resolve a blocking problem, or choose between Visual and YAML editing.
- Keyboard support exists but is buried in the command palette. The shortcuts dialog lists registered command bindings but does not explain canvas gestures or node-picker chords.
- A separately written shortcut table would drift from the command registry, menus, tooltips, and actual dispatch behavior.

The redesign must make the first useful reading choice obvious while retaining complete, offline, contract-derived reference coverage.

## 2. Goals

This change must:

- open Documentation on a useful overview rather than an undifferentiated reference list;
- provide a short, accurate Quick Start for the first successful authoring path;
- organize help around user tasks and scenarios before exposing exhaustive reference material;
- distinguish identically named contract fields by their applicable node kind and location;
- let users browse guides and reference material independently;
- provide a full Keyboard Shortcuts documentation topic generated from the live command registry;
- document non-command canvas gestures and node-picker chords from typed application-owned descriptors;
- make keyboard help directly discoverable through the UI and a default `Mod+/` binding;
- remain completely available offline and profile-aware;
- preserve exact contract topic identities so Inspector and Problems links continue to resolve to the most specific field; and
- meet the existing keyboard, focus, narrow-layout, 200% zoom, reduced-motion, and forced-colors requirements.

## 3. Non-goals

This change does not:

- add a second workflow-language field inventory;
- merge contract topics that have different schemas, applicability, status, or compatibility behavior;
- add shortcut rebinding;
- add network documentation, telemetry, tutorials that execute workflows, or embedded video;
- change Hermes workflow semantics or imply that Workflow Studio executes workflows;
- replace contextual Inspector documentation or Problems-to-topic navigation; or
- redesign the activity rail or the rest of the workbench.

## 4. Information architecture

### 4.1 Documentation modes

The Documentation page has three explicit modes:

1. **Overview** — the default task-led landing page.
2. **Guides** — curated conceptual and procedural documentation.
3. **Reference** — generated node, field, contract, and semantic-rule reference.

The mode control is a keyboard-operable tablist. Selecting a mode updates the visible navigation without discarding the active profile or leaving the Documentation activity. Search applies within the selected mode by default; an explicit All documentation option searches every topic.

Opening a specific topic from the Inspector, Problems panel, an example, history, or an internal documentation link bypasses the landing page and selects the exact topic. Returning to results restores the prior mode, query, highlighted result, scroll position, and focus target.

### 4.2 Overview landing page

The overview begins with a concise explanation:

> Build and edit Hermes workflows locally. Start with a guide for the task you are doing, or search the complete reference when you need a particular node or field.

It then presents a small, ordered **Start here** path:

1. Quick Start
2. Workflow pairs
3. DAG dependencies
4. Problems and validation
5. Keyboard shortcuts

Below the reading path, task cards answer common intentions:

- Create or open a workflow
- Add and connect steps
- Add conditions and use outputs
- Configure retries and trigger rules
- Use loops and approvals
- Configure companion policy and profiles
- Review local Git versions
- Fix a validation problem
- Work faster with keyboard shortcuts

Each card has a one-sentence scenario description and opens one canonical guide or interactive topic. The landing page does not show the full generated reference inventory.

A separate **Browse reference** section offers Node types, Common node settings, Workflow fields, Companion policy, and Language contract. These are entry points into filtered reference groups rather than copies of topic content.

### 4.3 Guides mode

Guides are grouped by user journey rather than sorted only by title:

- **Getting started:** Quick Start, Workflow pairs
- **Build the graph:** DAG dependencies, Conditions and outputs, Loops and approvals
- **Configure behavior:** Retry and triggers, Companion policies, Profiles and compatibility
- **Review and recover:** Problems and validation, Git versions, Troubleshooting
- **Use the application:** Keyboard shortcuts

Guide ordering is explicit application metadata because it is presentation structure, not workflow-language authority. A guide remains a Markdown resource under `docs/app-guides/` and is included in the existing offline resource pipeline.

Every guide entry includes a title, a short “Use this when…” description, and its group. The description comes from explicit guide front matter or typed guide metadata rather than a fragile first-sentence guess.

### 4.4 Reference mode

Reference browsing is grouped into:

- **Node types:** Command, Prompt, Bash, Script, Loop, Approval, Cancel, and future kinds supplied by the active contract.
- **Common node settings:** fields that occur for several node kinds, such as Id, Depends on, Context, When, Trigger rule, retry settings, timeout settings, and output settings.
- **Node-specific fields:** reference entries grouped beneath their applicable node kind.
- **Workflow fields:** definition-level fields outside individual nodes.
- **Companion policy:** companion fields and contract topics.
- **Language contract:** semantic rules, profiles, compatibility, and contract provenance topics.

Groups and applicability are derived from contract field paths, sections, node descriptors, and topic metadata. The UI may group identical labels for navigation, but it must retain the original topic objects and IDs underneath. It must never infer that fields are semantically identical merely because their labels match.

Expensive or deeply nested fields remain collapsed until their group is opened. Reference mode uses bounded internal scrolling and does not render every field article at once.

## 5. Duplicate-label treatment

### 5.1 Navigation groups

When several topics share a normalized title, the navigation presents one expandable label with an applicability summary, for example:

```text
Context
Used by 7 node types
  Command node
  Prompt node
  Bash node
  Script node
  Loop node
  Approval node
  Cancel node
```

Selecting a child opens its exact contract-derived topic. If all underlying topics resolve to the same canonical field path and identical display-relevant contract metadata, the group may offer an All applicable nodes summary, but this summary links to the individual authoritative topics and does not replace them.

### 5.2 Search results

Search results always show:

- the topic title;
- a disambiguating qualifier such as `Prompt node`, `Companion policy`, `Workflow`, `Guide`, or `Language contract`;
- the topic kind;
- a short description; and
- applicable-node badges when useful.

Examples include `Context · Prompt node` and `Context · Bash node`. Accessible names contain the qualifier, so repeated visible labels are also distinguishable to screen-reader and voice-control users.

### 5.3 Article context

Every selected article shows a breadcrumb and a **Use this when** summary before detailed content. Field articles show applicable node kinds, YAML location, required status, default, profile status, constraints, and related guides. Existing contract-derived body content remains authoritative.

Related links prioritize curated guides and the owning node topic before other contract topics. Internal links continue to use exact topic IDs.

## 6. Quick Start guide

`docs/app-guides/quick-start.md` provides the shortest honest path from launch to a saved workflow:

1. Open a local folder.
2. Create a workflow or create an editable copy of a bundled example.
3. Explain the definition YAML and optional companion YAML pair.
4. Add a node in Visual mode or edit the YAML directly.
5. Connect nodes with dependencies while keeping the graph acyclic.
6. Use the Inspector for known fields and its Docs tab for contextual help.
7. Read the Problems panel and distinguish blocking structural issues from non-blocking runtime advisories.
8. Save the structurally valid workflow pair.
9. Optionally review or create a local Git version.

The guide includes one small, contract-valid YAML example. It states that Workflow Studio does not execute the workflow and cannot prove external tools, providers, services, credentials, or scripts are available.

The guide links to Workflow pairs, DAG dependencies, Problems and validation, Examples, and Keyboard shortcuts. Application actions that are not documentation topics use UI language rather than inert internal anchors.

## 7. Problems and validation guide

`docs/app-guides/problems-and-validation.md` explains what to do when a workflow cannot be saved or exported:

- syntax, schema, and DAG issues block save/export;
- operational advisories do not block save/export;
- selecting a Problem navigates to the most specific available surface;
- invalid YAML preserves text and the last valid visual projection while visual edits are read-only; and
- missing tools, credentials, providers, scripts, and services are not execution checks.

This guide becomes the task-card destination for Fix a validation problem and supplements the existing Troubleshooting guide rather than duplicating individual diagnostic codes.

## 8. Keyboard shortcuts help

### 8.1 Authority

The command registry remains the sole authority for command IDs, labels, categories, contexts, default bindings, enablement, and handlers. Both the modal and documentation page consume the same presentation model produced from the registry.

Non-command interactions are represented by one typed help descriptor collection owned by the relevant interaction module:

- canvas pan: hold Space and drag;
- node-picker chords: `N` followed by the advertised node-kind key;
- any future gesture shown in help must have an implementation test and an owner.

The shortcut presentation model combines registered commands and interaction descriptors without registering gestures as fake executable commands.

### 8.2 Documentation topic

Keyboard shortcuts is an interactive guide topic within Documentation. It includes:

- platform-correct key labels;
- a search field covering command label, category, context, and key text;
- sections grouped by File, Edit, View, Navigation, Workflow, Canvas, and Help as applicable;
- context labels such as Global, Canvas only, YAML editor, or Form;
- the node-picker chord table;
- the canvas pan gesture;
- a note that canvas single-key shortcuts do not intercept form or YAML typing; and
- a note that bindings are fixed in version one.

Commands without bindings do not appear in the shortcut table unless they are necessary to explain discoverability. Disabled commands may appear because help documents available bindings, not current document state.

### 8.3 Shortcuts dialog

The existing modal remains a fast overlay. It uses the same grouped, searchable presentation component as the documentation topic in a compact variant. It gains:

- category headings;
- context labels;
- canvas gesture and node-chord coverage;
- search across labels, categories, contexts, and displayed bindings; and
- explanatory empty results.

The modal continues to trap focus and restore focus to its opener. Escape follows the existing modal priority rules.

### 8.4 Discoverability and binding

The `workbench.keyboard-shortcuts` command receives `Mod+/` as its default binding. It remains available from the command palette. The Documentation overview and Guides mode link to the interactive shortcuts topic.

Tooltips and shortcut help continue to format `Mod` as Command on macOS and Control on Windows/Linux. Registry conflict detection must prove the new binding does not collide in an enabled context.

## 9. Component and module boundaries

The implementation should preserve the existing feature ownership:

- `src/lib/docs/types.ts` defines guide presentation metadata, documentation mode/group types, and topic qualifiers.
- `src/lib/docs/build-index.ts` derives searchable topic metadata, reference groups, qualifiers, and duplicate-title groups from the active contract and curated guides.
- A focused documentation navigation model module owns task cards, guide journey ordering, and browse-reference entry points.
- `src/features/documentation/DocumentationView.svelte` coordinates Overview, Guides, Reference, search, selection, responsive focus, and history without owning contract interpretation.
- Small documentation components render the overview, grouped navigation, result row, breadcrumb, and article context when splitting keeps each unit understandable.
- A command-help presentation module derives grouped display rows from `CommandSurface` and typed interaction descriptors.
- `src/features/commands/KeyboardShortcuts.svelte` renders the shared presentation model in compact modal or full-page form.
- `src/app/App.svelte` supplies the active documentation index and command surface; it must not absorb grouping, search, or keyboard-help business logic.
- Markdown guides remain bundled through the existing `import.meta.glob` resource path and release-integrity checks.

The exact file split may follow existing repository conventions, but no new module may persist documentation state as a competing authority. Page-local mode, filters, selection, and history remain UI state.

## 10. Search behavior

Search remains local, deterministic, and network-free. It indexes title, exact ID, qualifier, description, body, YAML field path, node kinds, guide group, reference group, and displayed shortcut metadata where applicable.

Ranking priority is:

1. exact title plus qualifier or exact topic ID;
2. exact title;
3. title or qualifier prefix;
4. title, qualifier, or identifier containment;
5. description, body, field path, applicability, or group match.

All query tokens must match somewhere in a result. Stable title and ID ordering breaks equal scores. Changing mode or group resets the highlighted index without losing the query. An empty result announces both the query and the active scope, for example: `No guides match “context”. Try All documentation or Reference.`

The search input uses an accessible combobox/listbox pattern only if the complete required semantics are implemented; otherwise it remains a labeled search field with ordinary result links. It must not expose `aria-activedescendant` without a valid active option.

## 11. Responsive and accessible behavior

- The page remains a master-detail layout on wide screens and a results/detail flow on narrow screens.
- Overview cards, tabs, disclosure groups, search results, breadcrumbs, and internal links are reachable and operable by keyboard.
- Repeated field labels have unique accessible names.
- Opening a topic on narrow screens moves focus to Back to Results or the article heading; returning restores the exact originating control.
- Opening a grouped duplicate child and returning restores focus to that child, not merely the group heading.
- Presentation changes across the 48rem breakpoint retain the existing focus-transfer guarantees.
- At 1024x700 and 200% zoom, controls remain reachable through bounded internal scrolling without horizontal page overflow.
- Forced colors preserve boundaries, disclosure state, selected state, and visible focus.
- Reduced motion removes non-essential transitions; immediate documentation navigation remains the default.
- Shortcut keys use semantic `kbd` elements and are not conveyed by color alone.
- Search result counts and empty states use polite status announcements without announcing the entire list after every keystroke.

## 12. Profile changes and contextual navigation

When the active workflow profile changes, the documentation index is rebuilt from the new contract. The page remaps the selected topic, history, group expansion, and highlighted result by stable ID where possible. Missing topics are cleared with the existing safe fallback rather than replayed against a future index.

Guide and keyboard topics remain available for every supported profile. Contract-derived reference groups update to the active profile. Contextual navigation always selects the exact requested topic even if the page was previously on Overview or Guides.

Documentation state survives round trips to other full-workbench activities for the current application session. It is not written into workflow YAML.

## 13. Testing strategy

Development follows red-green-refactor.

### 13.1 Pure module tests

Tests cover:

- journey ordering and task-card targets;
- reference group derivation from both bundled contracts;
- duplicate-title grouping without loss of exact topic IDs;
- qualifiers for node fields, workflow fields, companion fields, guides, and contract topics;
- search ranking with repeated labels and qualifiers;
- guide metadata parsing and complete bundled-guide coverage;
- shared shortcut presentation from registry commands;
- platform display labels and `Mod+/` normalization;
- interaction descriptor coverage for node chords and canvas pan; and
- registry conflict detection.

Behavior tests must prove that adding or removing a bundled contract field changes the generated reference without editing a second field list.

### 13.2 Component tests

Tests cover:

- Overview as the default page;
- task cards and Start here navigation;
- Guides and Reference mode switching;
- collapsed reference groups;
- repeated Context results with distinct accessible names;
- breadcrumbs, Use this when summaries, applicability, and related links;
- contextual topic requests bypassing the landing page;
- exact focus and scroll restoration across selection, grouped navigation, Back to Results, and responsive changes;
- shared shortcut content in modal and documentation variants;
- search by category, context, and keybinding;
- node chords and pan gesture visibility; and
- modal focus trap, Escape priority, and opener restoration.

### 13.3 Resource and end-to-end tests

- Every YAML fence that contains a workflow definition validates through the bundled contract and DAG analyzer.
- Release resource checks include the new guides and any guide metadata.
- Chromium and WebKit tests open Documentation, follow the Quick Start path, find a repeated field through a qualified result, open Keyboard shortcuts, use `Mod+/`, and verify narrow-layout navigation.
- Accessibility coverage includes keyboard-only operation, unique names, focus visibility, forced colors, reduced motion, 1024x700, and 200% zoom.
- Tests prove that documentation and shortcut help perform no fetch or native filesystem operation after bundled resources load.

## 14. Acceptance criteria

The feature is complete when:

1. Opening Documentation shows a useful overview and no exhaustive field list.
2. A new user can follow Quick Start from opening a folder through saving a structurally valid workflow.
3. Guides are grouped by user journey and include clear scenario descriptions.
4. Reference material is separated from guides and grouped by workflow concept.
5. Repeated labels such as Context are visibly and accessibly qualified by node kind.
6. Grouping never removes, merges, or rewrites an authoritative contract topic.
7. Inspector, Problems, examples, history, and internal links still open exact topic IDs.
8. Search can find a field by title, node kind, YAML path, scenario text, or reference group.
9. Keyboard shortcuts are available as both a Documentation topic and a fast modal.
10. The registered shortcut table is generated from the command registry and includes platform-correct labels.
11. Canvas pan and node-picker chords appear from typed interaction descriptors with implementation coverage.
12. `Mod+/` opens keyboard help without a registry conflict.
13. All documentation and help remain functional offline.
14. Wide, narrow, 1024x700, 200% zoom, keyboard, reduced-motion, forced-colors, Chromium, and WebKit behavior pass their prescribed checks.
15. No workflow YAML, contract field inventory, or shortcut binding inventory is duplicated as an independently maintained authority.

## 15. Relationship to current work

This feature is additive to the approved Workflow Studio design and does not change the current loop-group visual-authoring plan's sequencing or Hermes amendment boundary. If loop-group contract synchronization lands first, its node kinds, scoped fields, examples, and loop-group guide enter the same generated Reference and curated Guides structures automatically. If this feature lands first, those future resources must require no information-architecture redesign.
