<script lang="ts">
  import type { Component } from 'svelte'
  import DeferredSurface from './DeferredSurface.svelte'
  let { onReadRevision }: { onReadRevision: (value: number) => void } = $props()
  let revision = $state(1)
  const model = Object.freeze({})
  const onObserve = () => {}
  const onAdvanceParent = () => {
    revision += 1
  }
  const load = async () => (await import('./DeferredPropsFixture.svelte')) as unknown as { default: Component }
</script>

<DeferredSurface
  {load}
  label="Props"
  componentProps={{ revision, model, onObserve, onAdvanceParent, onReadRevision }}
/>
