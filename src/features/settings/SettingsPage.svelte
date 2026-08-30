<script lang="ts">
  import type { Snippet } from 'svelte'

  export type SettingsCategory = 'appearance' | 'contracts' | 'updates' | 'about'

  interface Props {
    appearance: Snippet
    contracts: Snippet
    updates: Snippet
    about: Snippet
  }

  const categories: readonly { readonly id: SettingsCategory; readonly label: string }[] = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'contracts', label: 'Workflow Contracts' },
    { id: 'updates', label: 'Updates' },
    { id: 'about', label: 'About' },
  ]

  let { appearance, contracts, updates, about }: Props = $props()
  let active = $state<SettingsCategory>('appearance')

  function select(category: SettingsCategory): void {
    active = category
  }

  function navigate(event: KeyboardEvent, category: SettingsCategory): void {
    const currentIndex = categories.findIndex(({ id }) => id === category)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % categories.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + categories.length) % categories.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = categories.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const next = categories[nextIndex]
    if (!next) return
    select(next.id)
    const tabs = event.currentTarget
      ? Array.from(
          (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [],
        )
      : []
    tabs[nextIndex]?.focus()
  }
</script>

<div class="settings-page">
  <div class="settings-grid">
    <div class="category-tabs" role="tablist" aria-label="Settings categories">
      {#each categories as category (category.id)}
        <button
          type="button"
          role="tab"
          id={`settings-tab-${category.id}`}
          aria-controls={`settings-panel-${category.id}`}
          aria-selected={active === category.id}
          tabindex={active === category.id ? 0 : -1}
          onclick={() => select(category.id)}
          onkeydown={(event) => navigate(event, category.id)}>{category.label}</button
        >
      {/each}
    </div>

    <div
      class="category-panel"
      role="tabpanel"
      id={`settings-panel-${active}`}
      aria-labelledby={`settings-tab-${active}`}
      tabindex="0"
    >
      {#if active === 'appearance'}
        {@render appearance()}
      {:else if active === 'contracts'}
        {@render contracts()}
      {:else if active === 'updates'}
        {@render updates()}
      {:else}
        {@render about()}
      {/if}
    </div>
  </div>
</div>

<style>
  .settings-page,
  .settings-grid,
  .category-panel {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  .settings-page {
    padding: clamp(0.75rem, 2vw, 1.5rem);
  }

  .settings-grid {
    display: grid;
    grid-template-columns: minmax(10rem, 13rem) minmax(0, 1fr);
    gap: clamp(0.75rem, 2vw, 1.5rem);
    max-width: 60rem;
    margin-inline: auto;
  }

  .category-tabs {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    align-self: start;
  }

  .category-tabs button {
    width: 100%;
    min-width: 0;
    min-height: 2.5rem;
    justify-content: flex-start;
    padding-inline: 0.75rem;
    border: 1px solid transparent;
    color: var(--color-text-muted);
    background: transparent;
    overflow-wrap: anywhere;
    text-align: left;
  }

  .category-tabs button[aria-selected='true'] {
    border-color: var(--color-accent);
    color: var(--color-accent-strong);
    background: var(--color-node-selected);
  }

  .category-tabs button:focus-visible,
  .category-panel:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }

  .category-panel {
    align-self: start;
    overflow-wrap: anywhere;
  }

  @media (max-width: 44rem) {
    .settings-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .category-tabs {
      flex-flow: row wrap;
    }

    .category-tabs button {
      width: auto;
      flex: 1 1 9rem;
      justify-content: center;
      text-align: center;
    }
  }

  @media (forced-colors: active) {
    .category-tabs button[aria-selected='true'] {
      border-color: Highlight;
      color: HighlightText;
      background: Highlight;
    }
  }
</style>
