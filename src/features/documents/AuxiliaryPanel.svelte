<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AuxiliaryTab } from '$src/lib/layout/types'
  import PanelResizeHandle from './PanelResizeHandle.svelte'

  interface Props {
    problems: Snippet
    references?: Snippet | undefined
    issueCount: number
    blockingCount: number
    activeTab: AuxiliaryTab
    onTabChange: (tab: AuxiliaryTab) => void
    problemsScroll?: number
    referencesScroll?: number
    onProblemsScroll?: (scrollTop: number) => void
    onReferencesScroll?: (scrollTop: number) => void
    height?: number
    minimumHeight?: number
    maximumHeight?: number
    onHeightPreview?: (height: number | null) => void
    onHeightCommit?: (height: number) => void
  }

  let {
    problems,
    references,
    issueCount,
    blockingCount,
    activeTab,
    onTabChange,
    problemsScroll = 0,
    referencesScroll = 0,
    onProblemsScroll,
    onReferencesScroll,
    height = 180,
    minimumHeight = 96,
    maximumHeight = 360,
    onHeightPreview,
    onHeightCommit,
  }: Props = $props()
  const id = $props.id()
  const selected = $derived(references ? activeTab : 'problems')
  const tabs = $derived<AuxiliaryTab[]>(references ? ['problems', 'references'] : ['problems'])
  let tablist = $state<HTMLDivElement>()
  let problemsScrollOwner = $state<HTMLDivElement>()
  let referencesScrollOwner = $state<HTMLDivElement>()

  $effect(() => {
    if (selected === 'problems' && problemsScrollOwner && problemsScrollOwner.scrollTop !== problemsScroll)
      problemsScrollOwner.scrollTop = problemsScroll
  })

  $effect(() => {
    if (selected === 'references' && referencesScrollOwner && referencesScrollOwner.scrollTop !== referencesScroll)
      referencesScrollOwner.scrollTop = referencesScroll
  })

  function navigate(event: KeyboardEvent, tab: AuxiliaryTab): void {
    if (event.key === 'Enter' || event.key === ' ') {
      // Keep native button activation without invoking a global canvas shortcut.
      event.stopPropagation()
      return
    }
    const index = tabs.indexOf(tab)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft'
              ? (index + tabs.length - 1) % tabs.length
              : null
    if (next === null) return
    event.preventDefault()
    onTabChange(tabs[next]!)
    tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
</script>

<div class="auxiliary-panel" data-scroll-frame="auxiliary">
  <PanelResizeHandle
    value={height}
    minimum={minimumHeight}
    maximum={maximumHeight}
    onPreview={onHeightPreview}
    onCommit={onHeightCommit}
  />
  <header>
    <div role="tablist" aria-label="Workflow details" bind:this={tablist}>
      {#each tabs as tab (tab)}
        <button
          type="button"
          role="tab"
          id={`${id}-${tab}-tab`}
          aria-controls={`${id}-${tab}-panel`}
          aria-selected={selected === tab}
          tabindex={selected === tab ? 0 : -1}
          onclick={() => onTabChange(tab)}
          onkeydown={(event) => navigate(event, tab)}>{tab === 'problems' ? 'Problems' : 'References'}</button
        >
      {/each}
    </div>
    <p aria-live="polite">{issueCount} {issueCount === 1 ? 'problem' : 'problems'}, {blockingCount} blocking</p>
  </header>
  <div
    class="tab-content"
    role="tabpanel"
    id={`${id}-problems-panel`}
    aria-labelledby={`${id}-problems-tab`}
    tabindex={selected === 'problems' ? 0 : -1}
    data-scroll-owner="problems"
    hidden={selected !== 'problems'}
    bind:this={problemsScrollOwner}
    onscroll={(event) => onProblemsScroll?.(event.currentTarget.scrollTop)}
  >
    {@render problems()}
  </div>
  {#if references}
    <div
      class="tab-content"
      role="tabpanel"
      id={`${id}-references-panel`}
      aria-labelledby={`${id}-references-tab`}
      tabindex={selected === 'references' ? 0 : -1}
      data-scroll-owner="references"
      hidden={selected !== 'references'}
      bind:this={referencesScrollOwner}
      onscroll={(event) => onReferencesScroll?.(event.currentTarget.scrollTop)}
    >
      {@render references()}
    </div>
  {/if}
</div>

<style>
  .auxiliary-panel {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--color-text);
    background: var(--color-surface);
  }
  header,
  [role='tablist'] {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
  }
  header {
    justify-content: space-between;
    gap: 0.25rem 0.75rem;
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }
  button {
    min-height: 2.625rem;
    padding: 0.5rem;
    border: 0;
    border-bottom: 2px solid transparent;
    color: var(--color-text-muted);
    background: transparent;
    font-size: 0.75rem;
  }
  button[aria-selected='true'] {
    border-bottom-color: var(--color-focus);
    color: var(--color-text);
  }
  p {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  .tab-content {
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  button:focus-visible,
  .tab-content:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: -3px;
  }
  .tab-content :global(.scope-bar) {
    max-height: none;
    overflow: visible;
  }
</style>
