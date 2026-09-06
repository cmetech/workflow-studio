<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AuxiliaryTab } from '$src/lib/layout/types'

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
  }: Props = $props()
  const id = $props.id()
  const selected = $derived(references ? activeTab : 'problems')
  const tabs = $derived<AuxiliaryTab[]>(references ? ['problems', 'references'] : ['problems'])
  let tablist = $state<HTMLDivElement>()
  let scrollOwner = $state<HTMLDivElement>()

  $effect(() => {
    const scrollTop = selected === 'problems' ? problemsScroll : referencesScroll
    if (scrollOwner && scrollOwner.scrollTop !== scrollTop) scrollOwner.scrollTop = scrollTop
  })

  function navigate(event: KeyboardEvent, tab: AuxiliaryTab): void {
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
  {#key selected}
    <div
      class="tab-content"
      role="tabpanel"
      id={`${id}-${selected}-panel`}
      aria-labelledby={`${id}-${selected}-tab`}
      tabindex="0"
      data-scroll-owner={selected}
      bind:this={scrollOwner}
      onscroll={(event) =>
        (selected === 'problems' ? onProblemsScroll : onReferencesScroll)?.(event.currentTarget.scrollTop)}
    >
      {#if selected === 'references' && references}
        {@render references()}
      {:else}
        {@render problems()}
      {/if}
    </div>
  {/key}
</div>

<style>
  .auxiliary-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
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
