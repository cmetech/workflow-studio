<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { isWorkspaceFolder } from '$src/lib/workspace/types'
  import type { WorkspaceEntry, WorkspaceTreeEntry } from '$src/lib/workspace/types'
  import { workspace, selectWorkspaceEntry } from '$src/stores/workspace'
  import FilePlus from 'lucide-svelte/icons/file-plus'
  import FileUp from 'lucide-svelte/icons/file-up'

  type ExplorerState = 'loading' | 'ready' | 'empty' | 'error'

  interface Props {
    tree?: readonly WorkspaceTreeEntry[]
    activeId?: string | null
    onOpen?: (entry: WorkspaceEntry) => void
    onContext?: (entry: WorkspaceEntry) => void
    onNew?: (opener: HTMLElement) => void
    onImport?: (opener: HTMLElement) => void
    contractAvailable?: boolean
    state?: ExplorerState
    error?: string | undefined
  }

  interface VisibleTreeRow {
    readonly entry: WorkspaceTreeEntry
    readonly level: number
    readonly parentId: string | null
    readonly positionInSet: number
    readonly setSize: number
  }

  let {
    tree,
    activeId,
    onOpen,
    onContext,
    onNew,
    onImport,
    contractAvailable = false,
    state: catalogState = 'ready',
    error,
  }: Props = $props()
  const displayedTree = $derived(tree ?? $workspace.tree)
  const selectedId = $derived(activeId === undefined ? $workspace.activeEntryId : activeId)
  let expandedIds = $state<Set<string>>(new Set())
  let knownFolderIds = $state<Set<string>>(new Set())
  let focusedId = $state<string | null>(null)
  const visibleRows = $derived(flattenVisibleTree(displayedTree, expandedIds))

  $effect(() => {
    const currentFolderIds = collectFolderIds(displayedTree)
    const knownIds = untrack(() => knownFolderIds)
    const currentExpandedIds = untrack(() => expandedIds)
    const newFolderIds = currentFolderIds.filter((id) => !knownIds.has(id))
    knownFolderIds = new Set(currentFolderIds)
    if (newFolderIds.length > 0) expandedIds = new Set([...currentExpandedIds, ...newFolderIds])
  })

  $effect(() => {
    if (!visibleRows.some((row) => row.entry.id === focusedId)) {
      focusedId = visibleRows[0]?.entry.id ?? null
    }
  })

  function flattenVisibleTree(
    entries: readonly WorkspaceTreeEntry[],
    expanded: ReadonlySet<string>,
    level = 1,
    parentId: string | null = null,
  ): readonly VisibleTreeRow[] {
    const rows: VisibleTreeRow[] = []
    for (const [index, entry] of entries.entries()) {
      rows.push({ entry, level, parentId, positionInSet: index + 1, setSize: entries.length })
      if (isWorkspaceFolder(entry) && expanded.has(entry.id)) {
        rows.push(...flattenVisibleTree(entry.children, expanded, level + 1, entry.id))
      }
    }
    return rows
  }

  function collectFolderIds(entries: readonly WorkspaceTreeEntry[]): string[] {
    const ids: string[] = []
    for (const entry of entries) {
      if (!isWorkspaceFolder(entry)) continue
      ids.push(entry.id, ...collectFolderIds(entry.children))
    }
    return ids
  }

  function treeItemLabel(entry: WorkspaceTreeEntry): string {
    if (isWorkspaceFolder(entry)) return `${entry.name} folder`
    const state =
      entry.state === 'paired' ? 'paired workflow' : entry.state === 'legacy' ? 'legacy workflow' : 'orphan companion'
    return `${entry.name}, ${state}${entry.readOnly ? ', read only' : ''}`
  }

  function toggleFolder(id: string): void {
    expandedIds = expandedIds.has(id)
      ? new Set([...expandedIds].filter((expandedId) => expandedId !== id))
      : new Set([...expandedIds, id])
  }

  async function focusRow(id: string): Promise<void> {
    focusedId = id
    await tick()
    document.getElementById(domId(id))?.focus()
  }

  function domId(id: string): string {
    return `workspace-treeitem-${id}`
  }

  function openEntry(entry: WorkspaceEntry): void {
    selectWorkspaceEntry(entry.id)
    onOpen?.(entry)
  }

  function activateRow(entry: WorkspaceTreeEntry): void {
    if (isWorkspaceFolder(entry)) toggleFolder(entry.id)
    else openEntry(entry)
  }

  async function handleKeydown(event: KeyboardEvent, row: VisibleTreeRow): Promise<void> {
    if (event.key === 'F10' && event.shiftKey && !isWorkspaceFolder(row.entry)) {
      event.preventDefault()
      event.stopPropagation()
      ;(event.currentTarget as HTMLElement).focus()
      onContext?.(row.entry)
      return
    }
    const currentIndex = visibleRows.findIndex(({ entry }) => entry.id === row.entry.id)
    let nextId: string | null = null

    switch (event.key) {
      case 'ArrowDown':
        nextId = visibleRows[Math.min(currentIndex + 1, visibleRows.length - 1)]?.entry.id ?? null
        break
      case 'ArrowUp':
        nextId = visibleRows[Math.max(currentIndex - 1, 0)]?.entry.id ?? null
        break
      case 'ArrowRight':
        if (isWorkspaceFolder(row.entry)) {
          if (!expandedIds.has(row.entry.id)) toggleFolder(row.entry.id)
          else nextId = row.entry.children[0]?.id ?? null
        }
        break
      case 'ArrowLeft':
        if (isWorkspaceFolder(row.entry) && expandedIds.has(row.entry.id)) toggleFolder(row.entry.id)
        else nextId = row.parentId
        break
      case 'Home':
        nextId = visibleRows[0]?.entry.id ?? null
        break
      case 'End':
        nextId = visibleRows.at(-1)?.entry.id ?? null
        break
      case 'Enter':
        activateRow(row.entry)
        break
      default:
        return
    }

    event.preventDefault()
    event.stopPropagation()
    if (nextId) await focusRow(nextId)
  }
</script>

<section class="explorer" aria-labelledby="workspace-explorer-heading">
  <header>
    <h2 id="workspace-explorer-heading">Explorer</h2>
    <div class="header-actions">
      <button
        type="button"
        data-variant="secondary"
        aria-label="New Workflow"
        title="New Workflow"
        disabled={!contractAvailable}
        onclick={(event) => onNew?.(event.currentTarget)}><FilePlus size={16} aria-hidden="true" /></button
      >
      <button
        type="button"
        data-variant="ghost"
        aria-label="Import"
        title="Import"
        disabled={!contractAvailable}
        onclick={(event) => onImport?.(event.currentTarget)}><FileUp size={16} aria-hidden="true" /></button
      >
    </div>
  </header>

  {#if catalogState === 'loading'}
    <p class="catalog-state" role="status">Loading workspace workflows…</p>
  {:else if catalogState === 'error'}
    <p class="catalog-state" role="alert">{error ?? 'Workspace workflows could not be loaded.'}</p>
  {:else if catalogState === 'empty'}
    <p class="catalog-state" role="status">No workflows found. Use New Workflow or Import to begin.</p>
  {:else}
    <div class="tree" role="tree" aria-label="Workspace workflows">
      {#each visibleRows as row (row.entry.id)}
        <button
          id={domId(row.entry.id)}
          type="button"
          data-variant="ghost"
          role="treeitem"
          aria-label={treeItemLabel(row.entry)}
          aria-level={row.level}
          aria-posinset={row.positionInSet}
          aria-setsize={row.setSize}
          aria-selected={row.entry.id === selectedId}
          aria-expanded={isWorkspaceFolder(row.entry) ? expandedIds.has(row.entry.id) : undefined}
          aria-current={row.entry.id === selectedId ? 'page' : undefined}
          tabindex={row.entry.id === focusedId ? 0 : -1}
          class:folder={isWorkspaceFolder(row.entry)}
          class:active={row.entry.id === selectedId}
          class:read-only={!isWorkspaceFolder(row.entry) && row.entry.readOnly}
          style:padding-left={`${0.5 + (row.level - 1) * 1.125}rem`}
          onclick={() => activateRow(row.entry)}
          onfocus={() => (focusedId = row.entry.id)}
          onkeydown={(event) => handleKeydown(event, row)}
          oncontextmenu={(event) => {
            if (isWorkspaceFolder(row.entry)) return
            event.preventDefault()
            event.currentTarget.focus()
            onContext?.(row.entry)
          }}
        >
          <span class="disclosure" aria-hidden="true">
            {#if isWorkspaceFolder(row.entry)}{expandedIds.has(row.entry.id) ? '▾' : '▸'}{:else}◇{/if}
          </span>
          <span class="entry-name">{row.entry.name}</span>
          {#if !isWorkspaceFolder(row.entry)}
            <span class="badges" aria-hidden="true">
              <span class:warning={row.entry.state === 'orphan'}>
                {row.entry.state === 'paired' ? '+ policy' : row.entry.state}
              </span>
              {#if row.entry.readOnly}<span>read only</span>{/if}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .explorer {
    display: grid;
    grid-template-rows: var(--control-md) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    color: var(--color-text);
    background: var(--color-surface);
  }

  header {
    display: flex;
    align-items: center;
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--color-border);
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .header-actions {
    display: flex;
    gap: var(--space-1);
  }

  .header-actions button {
    display: grid;
    width: var(--control-sm);
    min-width: var(--control-sm);
    height: var(--control-sm);
    min-height: var(--control-sm);
    padding: 0;
    place-items: center;
  }

  .tree,
  .catalog-state {
    min-height: 0;
    overflow: auto;
  }

  .tree {
    padding: var(--space-2);
  }

  .catalog-state {
    margin: 0;
    padding: var(--space-4) var(--space-3);
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
  }

  button {
    display: flex;
    gap: 0.4375rem;
    align-items: center;
    width: 100%;
    min-height: 1.75rem;
    padding-top: 0.1875rem;
    padding-right: 0.4375rem;
    padding-bottom: 0.1875rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--color-text);
    background: transparent;
    cursor: default;
    text-align: left;
    white-space: nowrap;
  }

  button:hover {
    background: var(--color-surface-elevated);
  }

  button.active {
    border-color: var(--color-accent);
    color: var(--color-accent-strong);
    background: var(--color-node-selected);
  }

  button:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .disclosure {
    width: 0.75rem;
    flex: 0 0 0.75rem;
    color: var(--color-text-muted);
    text-align: center;
  }

  button:not(.folder) .disclosure {
    color: var(--color-focus);
  }

  button.active:not(.folder) .disclosure {
    color: var(--color-accent);
  }

  .entry-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badges {
    display: flex;
    gap: 0.3125rem;
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: 0.625rem;
  }

  .badges span {
    padding: 0.0625rem 0.25rem;
    border: 1px solid var(--color-border);
    border-radius: 0.25rem;
  }

  .badges .warning {
    border-color: var(--color-warning);
    color: var(--color-warning);
  }

  .read-only {
    color: var(--color-text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .tree {
      scroll-behavior: auto;
    }
  }
</style>
