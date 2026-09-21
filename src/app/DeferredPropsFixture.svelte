<script lang="ts">
  let {
    model,
    revision,
    onObserve,
    onActivate,
    optional = 'absent',
    detail,
    onAdvanceParent,
    onReadRevision,
  }: {
    model: object
    revision: number
    onObserve: (model: object) => void
    onActivate?: () => void
    optional?: string
    detail?: string
    onAdvanceParent?: () => void
    onReadRevision?: (value: number) => void
  } = $props()
  let showDetail = $state(false)
  const doubledRevision = $derived(revision * 2)

  $effect(() => onObserve(model))
</script>

<p>Revision {revision}</p>
<p>Derived revision {doubledRevision}</p>
<p>Optional {optional}</p>
<button onclick={onActivate}>Activate</button>
<button
  onclick={() => {
    onAdvanceParent?.()
    onReadRevision?.(doubledRevision)
  }}>Advance parent then read revision</button
>
<button onclick={() => (showDetail = !showDetail)}>Toggle detail</button>
{#if showDetail}<p>Detail {detail}</p>{/if}
