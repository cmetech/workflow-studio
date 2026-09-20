<script lang="ts">
  import { onDestroy, onMount, tick, untrack, type Component } from 'svelte'
  import ModalShell from './ModalShell.svelte'

  type LoadedModule = { default: Component }

  interface ModalFallback {
    titleId: string
    title: string
    opener?: HTMLElement | null | undefined
    dismissible?: boolean
    onCancel: () => void | Promise<void>
  }

  interface Props {
    load: () => Promise<LoadedModule>
    label: string
    componentProps?: Record<string, unknown>
    onInstance?: (instance: unknown | null) => void
    modal?: ModalFallback
  }

  let { load, label, componentProps = {}, onInstance, modal }: Props = $props()
  // A replaced props record must not invalidate consumers of unchanged values.
  // Own derived readers at this boundary, never inside a disposable child effect.
  // Unlike effect-synchronized copies, these also stay current within callbacks.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Fixed reader registry, not rendered collection state.
  const propReaders = new Map<PropertyKey, { readonly value: unknown; readonly present: boolean }>()
  for (const key of Reflect.ownKeys(untrack(() => componentProps))) {
    const value = $derived(Reflect.get(componentProps, key))
    const present = $derived(key in componentProps)
    propReaders.set(key, {
      get value() {
        return value
      },
      get present() {
        return present
      },
    })
  }
  // Later-added keys forward directly: creating a derived on their first child
  // read would tie its lifetime to that child's conditional render effect.
  const forwardedProps = new Proxy<Record<string, unknown>>(
    {},
    {
      get(_target, key) {
        const read = propReaders.get(key)
        return read ? read.value : Reflect.get(componentProps, key)
      },
      has(_target, key) {
        const read = propReaders.get(key)
        return read ? read.present : key in componentProps
      },
      ownKeys: () => Reflect.ownKeys(componentProps),
      getOwnPropertyDescriptor: (_target, key) =>
        Object.hasOwn(componentProps, key) ? { enumerable: true, configurable: true } : undefined,
    },
  )
  let Surface = $state<Component | null>(null)
  let instance = $state<unknown | null>(null)
  let phase = $state<'loading' | 'ready' | 'error'>('loading')
  let request = 0
  let disposed = false
  let fallbackHost = $state<HTMLElement>()

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
  $effect(() => {
    if (!modal || phase !== 'error') return
    void tick().then(() => fallbackHost?.querySelector<HTMLElement>('[data-deferred-retry]')?.focus())
  })
  onDestroy(() => {
    propReaders.clear()
    disposed = true
    request += 1
    onInstance?.(null)
  })
</script>

{#if phase === 'ready' && Surface}
  <Surface bind:this={instance} {...forwardedProps} />
{:else if modal}
  <ModalShell
    titleId={modal.titleId}
    opener={modal.opener ?? null}
    dismissible={modal.dismissible ?? true}
    onCancel={modal.onCancel}
  >
    <div bind:this={fallbackHost}>
      {#if phase === 'error'}
        <h2 id={modal.titleId}>{modal.title} unavailable</h2>
        <div class="deferred-surface-state" role="alert">
          <p>{label} could not be loaded.</p>
          <button type="button" data-deferred-retry data-variant="secondary" onclick={beginLoad}
            >Retry loading {label}</button
          >
        </div>
      {:else}
        <h2 id={modal.titleId}>Loading {modal.title}</h2>
        <p class="deferred-surface-state" role="status" aria-live="polite">Loading {label}â€¦</p>
      {/if}
    </div>
  </ModalShell>
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
