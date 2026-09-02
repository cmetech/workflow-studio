# Workflow Studio Documentation and Keyboard Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat offline reference list with task-led Overview, Guides, and grouped Reference experiences, add Quick Start and validation guidance, and expose complete registry-driven keyboard help in both Documentation and a direct-access modal.

**Architecture:** Keep the active Hermes contract and command registry authoritative. Pure TypeScript modules enrich contract topics with presentation-only qualifiers/groups and derive shortcut rows from registered commands plus tested interaction descriptors; focused Svelte components render the landing page, grouped navigation, articles, and shared shortcut table while a feature-owned session store preserves non-workflow UI state.

**Tech Stack:** Svelte 5, TypeScript 6, Nanostores, Vitest and Svelte Testing Library, Playwright Chromium/WebKit, bundled Markdown through Vite `import.meta.glob`.

**Spec:** `docs/superpowers/specs/2026-09-01-workflow-studio-documentation-shortcuts-design.md`

## Global Constraints

- YAML remains the sole workflow source of truth; documentation UI state never enters definition or companion YAML.
- The bundled Hermes contract remains the sole node/field/semantic-rule authority; never add a manually maintained workflow field inventory.
- The command registry remains the sole command-binding authority; never copy registered shortcut bindings into Markdown or a second table.
- Canvas gestures and node-picker chords come from typed, implementation-owned descriptors with behavior tests; do not register fake executable commands.
- The app remains fully offline and performs no documentation fetch or native filesystem operation after bundled resources load.
- Exact topic IDs remain stable so Inspector, Problems, examples, history, and internal links continue to open the most specific contract topic.
- Canvas single-key commands never intercept CodeMirror, form, or other editable typing.
- The experience must remain usable at 1024x700, effective 200% zoom, in Chromium and WebKit, with visible focus, reduced motion, and forced colors.
- Use test-driven development for every behavior: add the failing behavior test, observe the expected failure, implement the minimum behavior, and rerun the focused and regression tests.
- Create the implementation branch from `base`; return the ordinary checkout to `base` after integration work.

---

## File structure and responsibilities

- `src/lib/docs/types.ts` — presentation types for documentation modes, guide/reference groups, qualifiers, renderers, and persisted session state.
- `src/lib/docs/navigation.ts` — curated guide journey metadata, Start here entries, task cards, and reference entry points; contains no workflow field inventory.
- `src/lib/docs/build-index.ts` — derives exact contract topics, qualifiers, reference grouping, duplicate-title groups, breadcrumbs, related guides, and search tokens.
- `src/stores/documentation.ts` — session-only documentation mode/query/selection/history/disclosure/scroll state.
- `src/features/documentation/DocumentationOverview.svelte` — task-led landing page.
- `src/features/documentation/DocumentationTopicList.svelte` — guide journeys, grouped reference disclosures, and qualified search results.
- `src/features/documentation/DocumentationArticle.svelte` — breadcrumbs, “Use this when,” examples, Markdown, related links, or the interactive shortcut reference.
- `src/features/documentation/DocumentationView.svelte` — master-detail orchestration, mode tabs, responsive focus, contextual requests, and session-state publication.
- `src/lib/commands/help.ts` — pure platform-aware shortcut presentation derived from `CommandSurface` and interaction descriptors.
- `src/lib/commands/node-chords.ts` — one exported chord-choice authority used by dispatch, palette hints, and help.
- `src/features/commands/KeyboardShortcuts.svelte` — grouped, searchable compact/full shortcut presentation.
- `docs/app-guides/*.md` — curated offline guides; shortcut Markdown provides concepts only, never a copied binding table.
- `src/app/App.svelte` — loads typed guide metadata, supplies the active index/command surface, and composes the existing modal/page without owning help business logic.
- `tests/e2e/documentation-help.spec.ts` — cross-engine user journeys, direct shortcut access, narrow layout, and offline proof.

---

### Task 1: Create the isolated implementation worktree

**Files:**
- Verify: `docs/superpowers/specs/2026-09-01-workflow-studio-documentation-shortcuts-design.md`
- Verify: `docs/superpowers/plans/2026-09-01-workflow-studio-documentation-shortcuts.md`

**Interfaces:**
- Consumes: clean local `base` containing the approved spec and this plan.
- Produces: isolated branch `feat/documentation-shortcuts` for Tasks 2–8.

- [ ] **Step 1: Use the worktree skill and verify repository state**

Run:

```bash
git branch --show-current
git status --short
git rev-parse --verify base
```

Expected: branch `base`, no uncommitted files, and a valid `base` ref.

- [ ] **Step 2: Create the isolated branch and worktree**

Run through `superpowers:using-git-worktrees`:

```bash
git worktree add \
  /Users/coreyellis/Developer/personal/github.com/cmetech/workflow-studio/.worktrees/documentation-shortcuts \
  -b feat/documentation-shortcuts base
```

Expected: a new clean checkout on `feat/documentation-shortcuts`.

- [ ] **Step 3: Establish the unchanged baseline**

Run in the new worktree:

```bash
npm run test:unit -- \
  src/lib/docs/build-index.test.ts \
  src/features/documentation/DocumentationView.test.ts \
  src/lib/commands/registry.test.ts \
  src/lib/commands/keybindings.test.ts \
  src/features/commands/KeyboardShortcuts.test.ts
npm run check
```

Expected: all focused tests and static checks pass before feature edits.

---

### Task 2: Derive task-led documentation metadata from the active contract

**Files:**
- Create: `src/lib/docs/navigation.ts`
- Create: `src/lib/docs/navigation.test.ts`
- Modify: `src/lib/docs/types.ts`
- Modify: `src/lib/docs/build-index.ts`
- Modify: `src/lib/docs/build-index.test.ts`

**Interfaces:**
- Consumes: `AuthoringContract`, `FormField`, and curated guide sources.
- Produces: `buildDocumentationIndex(contract, guides): DocumentationIndex`, `searchDocumentation(index, query, options)`, `GUIDE_PRESENTATION`, `START_HERE`, `DOCUMENTATION_TASKS`, and `REFERENCE_ENTRY_POINTS`.

- [ ] **Step 1: Read the good-test rules before changing tests**

Read completely:

```bash
sed -n '1,320p' /Users/coreyellis/.codex/plugins/cache/openai-curated-remote/superpowers/6.3.0/skills/test-driven-development/writing-good-tests.md
```

For each test below, record in the test name the production behavior whose removal would make it fail.

- [ ] **Step 2: Add failing type and navigation-model tests**

Add `src/lib/docs/navigation.test.ts` with behavior equivalent to:

```ts
import { describe, expect, it } from 'vitest'
import {
  DOCUMENTATION_TASKS,
  GUIDE_GROUPS,
  GUIDE_PRESENTATION,
  REFERENCE_ENTRY_POINTS,
  START_HERE,
} from './navigation'

describe('documentation navigation metadata', () => {
  it('starts with a short ordered reading path and task destinations', () => {
    expect(START_HERE.map(({ topicId }) => topicId)).toEqual([
      'guide:quick-start',
      'guide:workflow-pairs',
      'guide:dag-dependencies',
      'guide:problems-and-validation',
      'guide:keyboard-shortcuts',
    ])
    expect(DOCUMENTATION_TASKS.map(({ id }) => ({ id, topicId }))).toEqual(
      expect.arrayContaining([
        { id: 'create-workflow', topicId: 'guide:quick-start' },
        { id: 'fix-problem', topicId: 'guide:problems-and-validation' },
        { id: 'keyboard-shortcuts', topicId: 'guide:keyboard-shortcuts' },
      ]),
    )
  })

  it('assigns every curated guide to one user-journey group with scenario copy', () => {
    expect(GUIDE_GROUPS.map(({ id }) => id)).toEqual([
      'getting-started',
      'build-graph',
      'configure-behavior',
      'review-recover',
      'use-application',
    ])
    expect(GUIDE_PRESENTATION['conditions-and-outputs']).toEqual(
      expect.objectContaining({ group: 'build-graph', useWhen: expect.stringMatching(/output|condition/i) }),
    )
    expect(Object.values(GUIDE_PRESENTATION).every(({ useWhen }) => useWhen.trim().length > 0)).toBe(true)
  })

  it('offers concept-level reference entry points without listing contract fields', () => {
    expect(REFERENCE_ENTRY_POINTS.map(({ group }) => group)).toEqual([
      'node-types',
      'common-node-settings',
      'workflow-fields',
      'companion-policy',
      'language-contract',
    ])
  })
})
```

Extend `src/lib/docs/build-index.test.ts` with a contract fixture containing Prompt and Bash fields both labeled `Context`, then assert:

```ts
const contextTopics = index.duplicateTitleGroups.get('context')!
expect(contextTopics.map(({ id, qualifier }) => ({ id, qualifier }))).toEqual([
  { id: 'field:bash.node.context', qualifier: 'Bash node' },
  { id: 'field:prompt.node.context', qualifier: 'Prompt node' },
])
expect(index.referenceGroups.get('common-node-settings')).toEqual(
  expect.arrayContaining([expect.objectContaining({ title: 'Context' })]),
)
expect(searchDocumentation(index, 'context prompt', { mode: 'reference' })[0]).toMatchObject({
  id: 'field:prompt.node.context',
  qualifier: 'Prompt node',
})
```

Also loop over both bundled production contracts and prove every `collectContractFields(contract)` result appears exactly once by ID in `index.byId` and in one reference group.

- [ ] **Step 3: Run the focused tests and confirm red**

Run:

```bash
npm run test:unit -- src/lib/docs/navigation.test.ts src/lib/docs/build-index.test.ts
```

Expected: failure because navigation metadata, qualifiers, duplicate-title groups, reference groups, and mode-aware search do not exist.

- [ ] **Step 4: Add the presentation types and curated journey metadata**

Extend `src/lib/docs/types.ts` with exact public shapes:

```ts
export type DocumentationMode = 'overview' | 'guides' | 'reference' | 'all'
export type GuideGroupId =
  | 'getting-started'
  | 'build-graph'
  | 'configure-behavior'
  | 'review-recover'
  | 'use-application'
export type ReferenceGroupId =
  | 'node-types'
  | 'common-node-settings'
  | 'node-specific-fields'
  | 'workflow-fields'
  | 'companion-policy'
  | 'language-contract'
export type DocumentationRenderer = 'markdown' | 'keyboard-shortcuts'

export interface DocumentationGuide {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly description?: string
  readonly group: GuideGroupId
  readonly useWhen: string
  readonly renderer?: DocumentationRenderer
}

export interface DocumentationSearchOptions {
  readonly mode: Exclude<DocumentationMode, 'overview'>
  readonly referenceGroup?: ReferenceGroupId
}
```

Add to `DocumentationTopic`: `qualifier`, `useWhen`, `breadcrumb`, `renderer`, optional `guideGroup`, and optional `referenceGroup`. Add to `DocumentationIndex`:

```ts
guideGroups: ReadonlyMap<GuideGroupId, readonly DocumentationTopic[]>
referenceGroups: ReadonlyMap<ReferenceGroupId, readonly DocumentationTopic[]>
duplicateTitleGroups: ReadonlyMap<string, readonly DocumentationTopic[]>
```

Create `src/lib/docs/navigation.ts` with the exact group ordering and topic IDs asserted above. Include metadata for all existing guide IDs plus `quick-start`, `problems-and-validation`, and `keyboard-shortcuts`; assign `keyboard-shortcuts` renderer `keyboard-shortcuts`.

- [ ] **Step 5: Enrich generated topics without merging contract authority**

Update `buildDocumentationIndex` so each exact topic receives presentation metadata:

```ts
function qualifierForField(contract: AuthoringContract, field: FormField): string {
  if (field.nodeKinds?.length === 1) {
    return `${contract.node_kinds.find(({ id }) => id === field.nodeKinds![0])?.label ?? field.nodeKinds[0]} node`
  }
  if (field.document === 'companion') return 'Companion policy'
  return field.fieldPath.startsWith('nodes[]') ? 'Common node setting' : 'Workflow'
}

function referenceGroupForField(field: FormField): ReferenceGroupId {
  if (field.document === 'companion') return 'companion-policy'
  if (!field.fieldPath.startsWith('nodes[]')) return 'workflow-fields'
  if ((field.nodeKinds?.length ?? 0) > 1) return 'common-node-settings'
  return 'node-specific-fields'
}
```

Node topics go to `node-types`; contract documentation and semantic rules go to `language-contract`. Guide topics use `GUIDE_PRESENTATION`. Build duplicate groups by normalized title only when at least two exact topics share it; keep every original topic in `byId`.

Change search to:

```ts
export function searchDocumentation(
  index: DocumentationIndex,
  query: string,
  options: DocumentationSearchOptions,
): readonly DocumentationTopic[]
```

Index and score qualifier, use-when copy, breadcrumb, node kinds, field paths, guide group, and reference group. Filter Guides to `kind === 'guide'`, Reference to non-guide topics, and All to every topic. Preserve stable title/qualifier/ID ordering.

- [ ] **Step 6: Verify derived coverage and regressions**

Run:

```bash
npm run test:unit -- src/lib/docs/navigation.test.ts src/lib/docs/build-index.test.ts src/lib/docs/render-markdown.test.ts
npm run check
```

Expected: all pass; no bundled contract field is absent or duplicated by the new presentation model.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/lib/docs
git commit -m "feat: derive task-led documentation navigation"
```

---

### Task 3: Add Quick Start, validation, and shortcut guide resources

**Files:**
- Create: `docs/app-guides/quick-start.md`
- Create: `docs/app-guides/problems-and-validation.md`
- Create: `docs/app-guides/keyboard-shortcuts.md`
- Modify: `src/lib/docs/build-index.test.ts`
- Modify: `src/lib/docs/navigation.test.ts`

**Interfaces:**
- Consumes: `GUIDE_PRESENTATION` from Task 2 and the existing Vite raw-Markdown loader.
- Produces: three offline guide topics with IDs `guide:quick-start`, `guide:problems-and-validation`, and `guide:keyboard-shortcuts`.

- [ ] **Step 1: Add failing bundled-guide coverage tests**

In `src/lib/docs/navigation.test.ts`, import all guide files and assert exact metadata coverage:

```ts
const guideSources = import.meta.glob('../../../docs/app-guides/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Readonly<Record<string, string>>

it('has explicit journey metadata for every bundled guide and no missing guide resource', () => {
  const ids = Object.keys(guideSources).map((path) => path.split('/').at(-1)!.replace(/\.md$/, '')).sort()
  expect(Object.keys(GUIDE_PRESENTATION).sort()).toEqual(ids)
  expect(ids).toContain('quick-start')
  expect(ids).toContain('problems-and-validation')
  expect(ids).toContain('keyboard-shortcuts')
})
```

Extend the existing YAML-fence validation loop in `build-index.test.ts` to require the Quick Start definition fence to produce `structurallyValid: true` with the active Archon contract.

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
npm run test:unit -- src/lib/docs/navigation.test.ts src/lib/docs/build-index.test.ts
```

Expected: failure because the three approved guide files are absent.

- [ ] **Step 3: Write the three focused guides**

Create `quick-start.md` with this contract-valid example and the nine steps from the spec:

```yaml
name: first-review
description: Prepare a change and ask for a review.
nodes:
  - id: prepare
    bash: "printf 'ready\\n'"
  - id: review
    prompt: Review the prepared change.
    depends_on: [prepare]
```

Its prose must explicitly distinguish definition/companion files, Visual/YAML editing, Problems, structural blockers, operational advisories, save, and optional local Git versions. Link to exact internal topics such as `[Workflow pairs](#guide:workflow-pairs)`.

Create `problems-and-validation.md` with four validation layers, save/export blocking behavior, stale read-only projection behavior, Problem navigation, and an explicit list of non-blocking runtime advisories.

Create `keyboard-shortcuts.md` with usage concepts only: platform meaning of Mod, canvas-vs-editor scope, fixed bindings in version one, and the statement that the live table below comes from the application registry. Do not write any command/binding table in Markdown.

- [ ] **Step 4: Verify guide resources and build inclusion**

Run:

```bash
npm run test:unit -- src/lib/docs/navigation.test.ts src/lib/docs/build-index.test.ts
npm run build
```

Expected: all guide files load through `import.meta.glob`, the Quick Start fence validates, and Vite bundles the resources without network access.

- [ ] **Step 5: Commit Task 3**

```bash
git add docs/app-guides src/lib/docs/build-index.test.ts src/lib/docs/navigation.test.ts
git commit -m "docs: add first-use and keyboard guides"
```

---

### Task 4: Build the Overview, grouped navigation, and contextual article components

**Files:**
- Create: `src/features/documentation/DocumentationOverview.svelte`
- Create: `src/features/documentation/DocumentationOverview.test.ts`
- Create: `src/features/documentation/DocumentationTopicList.svelte`
- Create: `src/features/documentation/DocumentationTopicList.test.ts`
- Create: `src/features/documentation/DocumentationArticle.svelte`
- Create: `src/features/documentation/DocumentationArticle.test.ts`
- Modify: `src/features/documentation/DocumentationView.svelte`
- Modify: `src/features/documentation/DocumentationView.test.ts`
- Create: `src/stores/documentation.ts`
- Create: `src/stores/documentation.test.ts`

**Interfaces:**
- Consumes: Task 2's `DocumentationIndex`, navigation constants, exact topic IDs, and Task 3 guides.
- Produces: Overview/Guides/Reference UI and `DocumentationSessionState` preserved outside component mount cycles.

- [ ] **Step 1: Add failing store and component behavior tests**

Define `DocumentationSessionState` in `types.ts` and test the store with:

```ts
export interface DocumentationSessionState {
  readonly mode: DocumentationMode
  readonly query: string
  readonly selectedTopicId?: string
  readonly history: readonly string[]
  readonly highlightedTopicId?: string
  readonly expandedGroupIds: readonly string[]
  readonly navigationScrollTop: number
  readonly articleScrollTop: number
}
```

In `src/stores/documentation.test.ts`, prove `updateDocumentationSession`, `reconcileDocumentationSession(index)`, and `resetDocumentationSession()` retain stable IDs and remove absent profile topics without touching documents.

In component tests, require:

```ts
expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
expect(screen.getByRole('heading', { name: 'Start here' })).toBeVisible()
expect(screen.getByRole('button', { name: /Fix a validation problem/i })).toBeVisible()
expect(screen.queryByText('Context', { selector: 'strong' })).not.toBeInTheDocument()
```

After selecting Reference, require one `Context` disclosure announcing seven applicable node types and distinct child buttons named `Context, Prompt node` and `Context, Bash node`. Require Guide journey headings, exact contextual topic requests bypassing Overview, article breadcrumbs, Use this when copy, and focus restoration to the exact originating task card or duplicate child.

- [ ] **Step 2: Run focused tests and confirm red**

Run:

```bash
npm run test:unit -- \
  src/stores/documentation.test.ts \
  src/features/documentation/DocumentationOverview.test.ts \
  src/features/documentation/DocumentationTopicList.test.ts \
  src/features/documentation/DocumentationArticle.test.ts \
  src/features/documentation/DocumentationView.test.ts
```

Expected: failure because the feature components, modes, disclosure groups, article context, and session store do not exist.

- [ ] **Step 3: Implement the session-only store**

Create `src/stores/documentation.ts` around one Nanostore atom:

```ts
export const INITIAL_DOCUMENTATION_SESSION: DocumentationSessionState = {
  mode: 'overview',
  query: '',
  history: [],
  expandedGroupIds: [],
  navigationScrollTop: 0,
  articleScrollTop: 0,
}

export const $documentationSession = atom(INITIAL_DOCUMENTATION_SESSION)

export function updateDocumentationSession(patch: Partial<DocumentationSessionState>): void {
  $documentationSession.set({ ...$documentationSession.get(), ...patch })
}
```

`reconcileDocumentationSession` filters selection/history/highlight IDs against `index.byId`; `resetDocumentationSession` restores the constant. No document store import is permitted.

- [ ] **Step 4: Implement focused presentational components**

`DocumentationOverview.svelte` accepts `onSelectTopic(topicId)` and `onBrowseReference(group)` and renders the intro, ordered Start here list, task cards, and Browse reference entry points from `navigation.ts`.

`DocumentationTopicList.svelte` accepts:

```ts
interface Props {
  index: DocumentationIndex
  mode: 'guides' | 'reference' | 'all'
  query: string
  highlightedTopicId?: string
  expandedGroupIds: readonly string[]
  onSelect: (topic: DocumentationTopic, opener: HTMLElement) => void
  onHighlight: (topicId: string) => void
  onToggleGroup: (groupId: string) => void
}
```

With a query, render qualified result rows with title, qualifier, kind, description, and applicable nodes. Without a query, Guides renders journey groups; Reference renders reference groups and duplicate-title disclosures. Use buttons/disclosure semantics with unique accessible names; never flatten duplicate topics into one article.

`DocumentationArticle.svelte` accepts the exact selected topic and renders Back to Results, breadcrumbs, heading, Use this when, applicability/default/constraints where supplied, examples, sanitized Markdown, and related topic buttons.

- [ ] **Step 5: Refactor DocumentationView into mode-aware orchestration**

Replace the Topic type select with a tablist for Overview, Guides, and Reference plus an `All documentation` search-scope control. Preserve existing contextual request consumption and responsive focus logic.

Use session store values for mode/query/selection/history/disclosures/scroll. When a contextual `topicId` resolves, set selected ID and change mode only for presentation; Back restores the previous session navigation target. Set `aria-activedescendant` only when the highlighted topic exists in the rendered result list.

The page must start on Overview and must not instantiate the entire reference list until Reference is selected or a search requests it.

- [ ] **Step 6: Verify component, responsive focus, and profile reconciliation**

Run:

```bash
npm run test:unit -- \
  src/stores/documentation.test.ts \
  src/features/documentation/DocumentationOverview.test.ts \
  src/features/documentation/DocumentationTopicList.test.ts \
  src/features/documentation/DocumentationArticle.test.ts \
  src/features/documentation/DocumentationView.test.ts \
  src/features/inspector/Inspector.test.ts \
  src/features/documents/ProblemsPanel.test.ts
npm run check
```

Expected: all pass; existing exact-topic navigation remains intact.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/features/documentation src/stores/documentation.ts src/stores/documentation.test.ts src/lib/docs/types.ts
git commit -m "feat: add task-led documentation browser"
```

---

### Task 5: Derive complete shortcut help from commands and interaction owners

**Files:**
- Create: `src/lib/commands/help.ts`
- Create: `src/lib/commands/help.test.ts`
- Modify: `src/lib/commands/node-chords.ts`
- Modify: `src/lib/commands/node-chords.test.ts`
- Modify: `src/lib/commands/registry.ts`
- Modify: `src/lib/commands/registry.test.ts`
- Modify: `src/lib/commands/keybindings.test.ts`
- Modify: `src/features/canvas/GraphCanvas.test.ts`

**Interfaces:**
- Consumes: `CommandSurface`, `AppCommand`, keybinding formatters, real node-chord choices, and Svelte Flow's configured pan behavior.
- Produces: `NODE_CHORD_CHOICES`, `INTERACTION_HELP`, `createShortcutHelp(surface, platform)`, and `searchShortcutHelp(rows, query)`.

- [ ] **Step 1: Add failing shortcut-authority tests**

In `help.test.ts`, assert behavior equivalent to:

```ts
const rows = createShortcutHelp(commandRegistry, 'mac')
expect(rows.find(({ id }) => id === 'document.save')).toMatchObject({
  kind: 'command',
  label: 'Save Workflow Pair',
  category: 'File',
  bindings: ['⌘S'],
  contexts: ['Global', 'Canvas', 'YAML editor', 'Form'],
})
expect(rows.find(({ id }) => id === 'canvas.pan')).toMatchObject({
  kind: 'gesture', bindings: ['Space + drag'], contexts: ['Canvas'],
})
expect(rows.filter(({ kind }) => kind === 'chord').map(({ bindings }) => bindings)).toEqual([
  ['N C'], ['N P'], ['N B'], ['N S'], ['N L'], ['N A'], ['N X'],
])
expect(searchShortcutHelp(rows, 'canvas space')).toEqual(
  expect.arrayContaining([expect.objectContaining({ id: 'canvas.pan' })]),
)
```

In registry tests, require `workbench.keyboard-shortcuts.defaultBindings` to equal `['Mod+/']` and `listBindingConflicts()` to remain empty. In GraphCanvas tests, assert the rendered Svelte Flow receives `panActivationKey="Space"` and `panOnDrag={true}` through observable canvas behavior or the component's stable configured props.

- [ ] **Step 2: Run focused tests and confirm red**

Run:

```bash
npm run test:unit -- \
  src/lib/commands/help.test.ts \
  src/lib/commands/node-chords.test.ts \
  src/lib/commands/registry.test.ts \
  src/lib/commands/keybindings.test.ts \
  src/features/canvas/GraphCanvas.test.ts
```

Expected: failure because there is no shared help model, chord choices are private, and keyboard help has no direct binding.

- [ ] **Step 3: Export one typed node-chord choice authority**

Replace the private record with:

```ts
export interface NodeChordChoice {
  readonly key: 'C' | 'P' | 'B' | 'S' | 'L' | 'A' | 'X'
  readonly nodeKind: NodeChordKind
  readonly label: string
}

export const NODE_CHORD_CHOICES: readonly NodeChordChoice[] = [
  { key: 'C', nodeKind: 'command', label: 'Command node' },
  { key: 'P', nodeKind: 'prompt', label: 'Prompt node' },
  { key: 'B', nodeKind: 'bash', label: 'Bash node' },
  { key: 'S', nodeKind: 'script', label: 'Script node' },
  { key: 'L', nodeKind: 'loop', label: 'Loop node' },
  { key: 'A', nodeKind: 'approval', label: 'Approval node' },
  { key: 'X', nodeKind: 'cancel', label: 'Cancel node' },
]
```

Derive the controller lookup, pending choices, and `nodeChordForKind` from this array so dispatch, palette hints, and help cannot drift.

- [ ] **Step 4: Implement the pure shortcut presentation model**

Create exact public types:

```ts
export type ShortcutHelpContext = 'Global' | 'Canvas' | 'YAML editor' | 'Form'
export interface ShortcutHelpRow {
  readonly id: string
  readonly kind: 'command' | 'gesture' | 'chord'
  readonly label: string
  readonly description: string
  readonly category: string
  readonly bindings: readonly string[]
  readonly contexts: readonly ShortcutHelpContext[]
}
```

`createShortcutHelp` lists registry commands with at least one binding, formats them for the platform, and derives supported surfaces by evaluating `enabled` against a bounded matrix of surface, mutability, selection, target entry, companion, contract, validation, and setup states. It appends:

```ts
export const INTERACTION_HELP = [
  {
    id: 'canvas.pan', kind: 'gesture', label: 'Pan canvas',
    description: 'Temporarily pan the graph without changing workflow YAML.',
    category: 'Canvas', bindings: ['Space + drag'], contexts: ['Canvas'],
  },
] as const
```

Append chord rows derived from `NODE_CHORD_CHOICES`. `searchShortcutHelp` matches label, description, category, contexts, and displayed binding text with all query tokens required.

- [ ] **Step 5: Add `Mod+/` through the registry and verify dispatch**

Change only the existing command:

```ts
{
  id: 'workbench.keyboard-shortcuts',
  label: 'Keyboard Shortcuts',
  category: 'Help',
  defaultBindings: ['Mod+/'],
  enabled: () => true,
  run: openKeyboardShortcuts,
}
```

Extend `keybindings.test.ts` to dispatch Meta+/ on macOS and Control+/ on Windows/Linux, asserting execution of `workbench.keyboard-shortcuts` and `preventDefault`.

- [ ] **Step 6: Verify shortcut authority and conflicts**

Run:

```bash
npm run test:unit -- \
  src/lib/commands/help.test.ts \
  src/lib/commands/node-chords.test.ts \
  src/lib/commands/registry.test.ts \
  src/lib/commands/keybindings.test.ts \
  src/features/canvas/GraphCanvas.test.ts \
  src/features/canvas/NodePalette.test.ts
npm run check
```

Expected: all pass, no binding collision, and every advertised gesture/chord has an implementation-owner test.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/lib/commands src/features/canvas/GraphCanvas.test.ts src/features/canvas/NodePalette.test.ts
git commit -m "feat: derive complete keyboard help"
```

---

### Task 6: Share grouped shortcut help between the modal and Documentation

**Files:**
- Modify: `src/features/commands/KeyboardShortcuts.svelte`
- Modify: `src/features/commands/KeyboardShortcuts.test.ts`
- Modify: `src/features/documentation/DocumentationArticle.svelte`
- Modify: `src/features/documentation/DocumentationArticle.test.ts`
- Modify: `src/features/documentation/DocumentationView.svelte`
- Modify: `src/features/documentation/DocumentationView.test.ts`

**Interfaces:**
- Consumes: Task 5's `createShortcutHelp`, `searchShortcutHelp`, and Task 2's `renderer: 'keyboard-shortcuts'` topic metadata.
- Produces: one shared `KeyboardShortcuts` component with `variant: 'compact' | 'documentation'`.

- [ ] **Step 1: Add failing shared-presentation tests**

Expand `KeyboardShortcuts.test.ts` to register commands across categories and render both variants:

```ts
render(KeyboardShortcuts, { props: { registry, platform: 'mac', variant: 'documentation' } })
expect(screen.getByRole('heading', { name: 'File' })).toBeVisible()
expect(screen.getByText('⌘S')).toBeVisible()
expect(screen.getByText('Global')).toBeVisible()
expect(screen.getByText('Space + drag')).toBeVisible()
expect(screen.getByText('N C')).toBeVisible()
```

Search for `canvas space`, `yaml find`, and a platform-formatted key. Assert the status `No keyboard shortcuts match “missing”.` when empty.

In `DocumentationArticle.test.ts`, select a topic with `renderer: 'keyboard-shortcuts'` and assert the Markdown introduction plus the live shortcut search/table appear; select an ordinary topic and assert no shortcut table appears.

- [ ] **Step 2: Run focused tests and confirm red**

Run:

```bash
npm run test:unit -- \
  src/features/commands/KeyboardShortcuts.test.ts \
  src/features/documentation/DocumentationArticle.test.ts \
  src/features/documentation/DocumentationView.test.ts
```

Expected: failure because the current component is flat, label-only searchable, and unavailable inside Documentation.

- [ ] **Step 3: Implement grouped compact/full shortcut rendering**

Change props to:

```ts
interface Props {
  registry: CommandSurface
  platform?: KeybindingPlatform
  variant?: 'compact' | 'documentation'
}
```

Build rows with `createShortcutHelp`, filter with `searchShortcutHelp`, group by category in stable order, and render each binding with semantic `kbd`. Render context labels and descriptions in documentation variant; keep descriptions visually compact but screen-reader available in modal variant. Both variants show gestures and chords.

Add component CSS with bounded vertical scrolling, wrapping long keys, `:focus-visible`, `@media (forced-colors: active)`, and `@media (prefers-reduced-motion: reduce)` containing no transitions or animation.

- [ ] **Step 4: Render live help inside the exact guide topic**

Add `commandSurface: CommandSurface` to `DocumentationArticle` and `DocumentationView` props. In the article, render sanitized guide Markdown first, then:

```svelte
{#if topic.renderer === 'keyboard-shortcuts'}
  <KeyboardShortcuts registry={commandSurface} variant="documentation" />
{/if}
```

Other topics remain Markdown/reference content only. Do not generate a binding table into the topic body or search index.

- [ ] **Step 5: Verify shared content and accessibility**

Run:

```bash
npm run test:unit -- \
  src/features/commands/KeyboardShortcuts.test.ts \
  src/features/documentation/DocumentationArticle.test.ts \
  src/features/documentation/DocumentationView.test.ts \
  src/app/ModalShell.test.ts
npm run check
```

Expected: modal and Documentation use the same registry rows, semantic keys, gestures, and chord choices.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/features/commands src/features/documentation
git commit -m "feat: share keyboard help across documentation"
```

---

### Task 7: Integrate the redesigned help experience into the application shell

**Files:**
- Modify: `src/app/App.svelte`
- Modify: `src/app/App.test.ts`
- Modify: `src/app/ActivityPage.test.ts`
- Modify: `src/features/examples/ExampleGallery.test.ts`
- Modify: `src/features/inspector/Inspector.test.ts`
- Modify: `src/features/documents/ProblemsPanel.test.ts`

**Interfaces:**
- Consumes: guide metadata/index from Tasks 2–3, DocumentationView/session behavior from Task 4, and command help from Tasks 5–6.
- Produces: visible Documentation Overview, exact contextual navigation, direct `Mod+/` modal access, and help-state survival across workbench pages.

- [ ] **Step 1: Add failing shell integration tests**

Extend `App.test.ts` with behaviors:

```ts
await fireEvent.click(screen.getByRole('button', { name: 'Documentation' }))
expect(screen.getByRole('heading', { name: 'Start here' })).toBeVisible()
expect(screen.queryByRole('article')).not.toBeInTheDocument()

await fireEvent.keyDown(window, { key: '/', metaKey: true })
expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
```

Select Guides, type a query, open a topic, leave for Examples, return to Documentation, and require restoration of mode/query/topic/history/scroll. Extend Inspector, Problems, and ExampleGallery tests to prove their exact topic requests still bypass Overview and focus the correct article.

- [ ] **Step 2: Run focused tests and confirm red**

Run:

```bash
npm run test:unit -- \
  src/app/App.test.ts \
  src/app/ActivityPage.test.ts \
  src/features/examples/ExampleGallery.test.ts \
  src/features/inspector/Inspector.test.ts \
  src/features/documents/ProblemsPanel.test.ts
```

Expected: failure because App does not provide typed guide metadata/command surface to the redesigned page and current Documentation state disappears on activity changes.

- [ ] **Step 3: Load guides with explicit presentation metadata**

Replace the current title-only guide mapping with:

```ts
const bundledGuides: readonly DocumentationGuide[] = Object.entries(bundledGuideSources)
  .map(([path, body]) => {
    const id = path.split('/').at(-1)?.replace(/\.md$/, '') ?? path
    const presentation = GUIDE_PRESENTATION[id]
    if (!presentation) throw new Error(`Missing documentation guide metadata: ${id}`)
    return {
      id,
      title: body.match(/^#\s+(.+)$/m)?.[1] ?? id,
      body,
      ...presentation,
    }
  })
  .sort((left, right) => left.id.localeCompare(right.id))
```

Pass `commandSurface` to `DocumentationView`. Update the ActivityPage description to `Start with a task guide or search the complete offline workflow reference.` Keep the existing unavailable-contract status.

- [ ] **Step 4: Preserve existing modal and contextual behavior**

Render the modal's `KeyboardShortcuts` with `variant="compact"`. Keep `ModalShell`, initial close-button focus, Escape priority, and opener restoration unchanged. Ensure `Mod+/` uses the focused non-dialog element as the opener.

When Documentation unmounts for another workbench page, its session atom retains mode/query/selection/history/disclosures/scroll. On return, the component reconciles those IDs with the active profile index before rendering.

- [ ] **Step 5: Verify shell and contextual regressions**

Run:

```bash
npm run test:unit -- \
  src/app/App.test.ts \
  src/app/ActivityPage.test.ts \
  src/features/examples/ExampleGallery.test.ts \
  src/features/inspector/Inspector.test.ts \
  src/features/documents/ProblemsPanel.test.ts \
  src/features/commands/KeyboardShortcuts.test.ts
npm run check
```

Expected: all pass; no contextual navigation regression and no shortcut collision notice.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/app src/features/examples src/features/inspector src/features/documents
git commit -m "feat: integrate task-led offline help"
```

---

### Task 8: Prove cross-engine, responsive, offline, and accessibility behavior

**Files:**
- Create: `tests/e2e/documentation-help.spec.ts`
- Modify: `tests/e2e/examples-and-docs.spec.ts`
- Modify: `tests/e2e/modal-layout.spec.ts`
- Modify: `tests/accessibility/keyboard-authoring.test.ts`
- Modify: `tests/accessibility/reduced-motion.test.ts`
- Modify: focused production files only for failures reproduced by these tests.

**Interfaces:**
- Consumes: the fully integrated help experience from Tasks 2–7.
- Produces: release evidence across Chromium/WebKit and prescribed viewport/accessibility conditions.

- [ ] **Step 1: Add failing end-to-end user journeys**

Create `tests/e2e/documentation-help.spec.ts` with semantic-role journeys that:

1. open a seeded workspace and Documentation;
2. prove Overview appears without the exhaustive Context list;
3. follow Quick Start and return focus to its Start here control;
4. switch to Reference and open the Prompt-specific Context child from a grouped Context disclosure;
5. search `context bash`, select `Context · Bash node`, and verify breadcrumb/applicability;
6. open Keyboard shortcuts from the task card and verify Save, Space + drag, and N C;
7. press Meta+/ on macOS or Control+/ elsewhere and verify the compact modal;
8. close the modal with Escape and verify opener restoration;
9. leave for Examples, return, and verify Documentation session restoration; and
10. block network requests after load and prove guide/reference/shortcut navigation still succeeds.

Use:

```ts
await page.route('**/*', (route) => {
  const url = new URL(route.request().url())
  if (url.origin === new URL(page.url()).origin) void route.continue()
  else void route.abort('blockedbyclient')
})
```

Do not use screenshots or pixel comparisons.

- [ ] **Step 2: Add responsive and accessibility assertions**

For 1024x700 and 512x350 CSS viewports, assert no document-level horizontal overflow, all mode tabs and Back to Results controls are reachable, and the page uses bounded internal scroll. Add forced-colors checks for selected tabs/disclosures/focus and reduced-motion source/behavior checks proving no documentation or shortcut transition remains.

Extend keyboard-authoring coverage to traverse Overview cards, mode tabs, reference disclosures, repeated qualified children, article Back, shortcut search, and modal Close using only keyboard events.

- [ ] **Step 3: Run new tests and confirm red**

Run:

```bash
npm run test:unit -- tests/accessibility/keyboard-authoring.test.ts tests/accessibility/reduced-motion.test.ts
npm run test:e2e -- tests/e2e/documentation-help.spec.ts --project=chromium
npm run test:e2e -- tests/e2e/documentation-help.spec.ts --project=webkit
```

Expected: at least one assertion fails until cross-engine focus, responsive scrolling, network isolation, and accessibility details are complete.

- [ ] **Step 4: Correct only proven implementation gaps**

Use `superpowers:systematic-debugging` for unexpected failures. Make the smallest production correction supported by the failing test. Do not add arbitrary sleeps, broaden semantic selectors, increase timeouts, remove WebKit coverage, or weaken geometry/accessibility assertions.

- [ ] **Step 5: Run the complete documentation/help regression set**

Run:

```bash
npm run test:unit -- \
  src/lib/docs/navigation.test.ts \
  src/lib/docs/build-index.test.ts \
  src/stores/documentation.test.ts \
  src/features/documentation/DocumentationOverview.test.ts \
  src/features/documentation/DocumentationTopicList.test.ts \
  src/features/documentation/DocumentationArticle.test.ts \
  src/features/documentation/DocumentationView.test.ts \
  src/lib/commands/help.test.ts \
  src/lib/commands/node-chords.test.ts \
  src/lib/commands/registry.test.ts \
  src/lib/commands/keybindings.test.ts \
  src/features/commands/KeyboardShortcuts.test.ts \
  src/app/App.test.ts \
  tests/accessibility/keyboard-authoring.test.ts \
  tests/accessibility/reduced-motion.test.ts
npm run test:e2e -- tests/e2e/documentation-help.spec.ts tests/e2e/examples-and-docs.spec.ts tests/e2e/modal-layout.spec.ts
```

Expected: all focused unit/component/accessibility tests and both configured Playwright projects pass.

- [ ] **Step 6: Commit Task 8**

```bash
git add tests src
git commit -m "test: prove documentation and keyboard help"
```

---

### Task 9: Run final gates and finish the development branch

**Files:**
- Verify only unless a gate exposes a reproducible defect corrected with a new failing test.

**Interfaces:**
- Consumes: completed Tasks 2–8.
- Produces: reviewed, verified branch ready for the user's selected integration workflow.

- [ ] **Step 1: Run static and resource gates**

```bash
npm run format:check
npm run lint
npm run check
npm run contracts:check
npm run examples:check
npm run resources:verify
```

Expected: all commands exit zero with no warnings introduced by this branch.

- [ ] **Step 2: Run all automated suites**

```bash
npm run test:unit
npm run test:rust
npm run build
npm run test:e2e
```

Confirm the full Playwright run includes Chromium and WebKit. Do not claim another platform or installed-app result unless it was actually run.

- [ ] **Step 3: Review the complete diff and authority boundaries**

Run:

```bash
git diff --check base...HEAD
git diff --stat base...HEAD
git log --oneline --decorate base..HEAD
rg -n "fetch\(|invoke\(|writeFile|readFile" src/features/documentation src/lib/docs src/features/commands src/lib/commands/help.ts
rg -n "Mod\+S|Mod\+P|Space \+ drag|N C" docs/app-guides
```

Expected: no whitespace errors; focused commit history; no documentation/native network operation; no registered binding copied into Markdown. `Space + drag` and `N C` may exist only in typed interaction descriptors/tests/rendered assertions, not a hand-maintained guide table.

- [ ] **Step 4: Request two-stage code review**

Use `superpowers:requesting-code-review`. Specification review must check all 15 acceptance criteria in the design. Quality review must challenge contract authority, shortcut drift, search semantics, focus restoration, profile reconciliation, offline behavior, responsive containment, forced colors, reduced motion, and test independence.

Address every finding through a focused failing test and rerun the affected task gates plus Steps 1–3.

- [ ] **Step 5: Verify completion evidence immediately before the success claim**

Use `superpowers:verification-before-completion`, rerun the complete commands from Steps 1–2, and record their current exit status. Do not rely on output from before a correction or review finding.

- [ ] **Step 6: Finish the implementation branch**

Use `superpowers:finishing-a-development-branch` to present integration options. If the user selects local merge, merge `feat/documentation-shortcuts` into `base`, rerun Steps 1–2 on integrated `base`, remove the worktree only after success, and leave the ordinary checkout on `base`.

---

## Acceptance checklist

- [ ] Documentation opens on a task-led Overview, not the exhaustive field list.
- [ ] Quick Start leads from opening a folder through saving a structurally valid pair.
- [ ] Guides are grouped by user journey with explicit “Use this when” descriptions.
- [ ] Reference is separate and grouped into node types, common settings, node-specific fields, workflow fields, companion policy, and language contract.
- [ ] Repeated labels are grouped for navigation while every exact contract topic remains addressable.
- [ ] Search results qualify repeated fields by node kind and use unique accessible names.
- [ ] Breadcrumbs, applicability, YAML location, related guides, examples, constraints, and defaults remain contract/profile-aware.
- [ ] Inspector, Problems, examples, history, and internal links still open exact requested topic IDs.
- [ ] Keyboard help is available as an interactive Documentation topic and compact modal.
- [ ] Registered shortcut rows derive from the live command registry.
- [ ] Canvas pan and node chords derive from tested interaction-owner descriptors.
- [ ] `Mod+/` opens keyboard help without a binding conflict.
- [ ] Documentation session state survives page round trips but never enters workflow YAML.
- [ ] All help works offline with no documentation fetch or native file operation.
- [ ] Unit, component, accessibility, Chromium, WebKit, static, resource, Rust, build, and full E2E gates pass before integration.
