<script lang="ts">
  import { onDestroy, onMount, type Component } from 'svelte'

  type LoadedModule = { default: Component }

  interface Props {
    load: () => Promise<LoadedModule>
    label: string
    componentProps?: Record<string, unknown>
    onInstance?: (instance: unknown | null) => void
  }

  let { load, label, componentProps = {}, onInstance }: Props = $props()
  let Surface = $state<Component | null>(null)
  let instance = $state<unknown | null>(null)
  let phase = $state<'loading' | 'ready' | 'error'>('loading')
  let request = 0
  let disposed = false

  function beginLoad(): void {
    phase = 'loading'
    const current = ++request
    void load().then(
      (loaded) => {
        if (disposed || current !== request) return
        Surface = loaded.default
        phase = 'ready'
      },
      () => {
        if (disposed || current !== request) return
        phase = 'error'
      },
    )
  }

  onMount(beginLoad)
  $effect(() => {
    onInstance?.(instance)
  })
  onDestroy(() => {
    disposed = true
    request += 1
    onInstance?.(null)
  })
</script>

{#if phase === 'ready' && Surface}
  <Surface bind:this={instance} {...componentProps} />
{:else if phase === 'error'}
  <div class="deferred-surface-state" role="alert">
    <p>{label} could not be loaded.</p>
    <button type="button" data-variant="secondary" onclick={beginLoad}>Retry loading {label}</button>
  </div>
{:else}
  <p class="deferred-surface-state" role="status" aria-live="polite">Loading {label}…</p>
{/if}

<style>
  .deferred-surface-state {
    margin: 0;
    padding: 1rem;
  }
</style>
