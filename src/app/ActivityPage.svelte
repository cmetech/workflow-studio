<script lang="ts">
  import { tick, type Snippet } from 'svelte'
  import type { PageActivityId } from '$src/stores/shell'

  interface Props {
    activity: PageActivityId | 'welcome'
    title: string
    description: string
    showBack?: boolean
    focusRequest?: number
    onBack?: () => void | Promise<void>
    children?: Snippet
  }

  let { activity, title, description, showBack = false, focusRequest = 0, onBack, children }: Props = $props()
  let heading = $state<HTMLHeadingElement>()
  let lastFocusRequest: string | undefined
  const headingId = $derived(`activity-page-${activity}-title`)

  $effect(() => {
    const requestedActivity = activity
    const requestKey = `${requestedActivity}:${focusRequest}`
    if (requestedActivity === 'welcome' || requestKey === lastFocusRequest) return
    lastFocusRequest = requestKey
    void tick().then(() => {
      if (activity === requestedActivity) heading?.focus()
    })
  })
</script>

<section class="activity-page" aria-labelledby={headingId} data-workbench-page={activity}>
  <header>
    {#if showBack}
      <button type="button" data-variant="ghost" onclick={() => void onBack?.()}>Back to Workflow</button>
    {/if}
    <div>
      <h2 id={headingId} bind:this={heading} tabindex="-1">{title}</h2>
      <p>{description}</p>
    </div>
  </header>
  <div class="page-body" data-page-scroll>
    {#if children}{@render children()}{/if}
  </div>
</section>

<style>
  .activity-page {
    display: grid;
    grid-column: 2 / -1;
    grid-row: 1;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--color-background);
  }

  header {
    display: flex;
    gap: var(--space-3);
    align-items: start;
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }

  header > div {
    min-width: 0;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 1.125rem;
  }

  p {
    margin-top: var(--space-1);
    color: var(--color-text-muted);
  }

  .page-body {
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }

  @media (forced-colors: active) {
    h2:focus-visible {
      outline: 2px solid CanvasText;
      outline-offset: 2px;
    }
  }
</style>
