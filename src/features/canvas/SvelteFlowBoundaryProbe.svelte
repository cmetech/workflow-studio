<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    nodes?: Array<{ readonly id?: string }>
    edges?: Array<{ readonly id?: string }>
    viewport?: unknown
    panActivationKey?: string | readonly string[]
    panOnDrag?: boolean | readonly number[]
    onlyRenderVisibleElements?: boolean
    children?: Snippet
  }

  let {
    nodes = $bindable(),
    edges = $bindable(),
    viewport = $bindable(),
    panActivationKey,
    panOnDrag,
    onlyRenderVisibleElements,
    children,
  }: Props = $props()
</script>

<div
  class="svelte-flow"
  data-testid="svelte-flow-boundary-probe"
  data-received-pan-activation-key={String(panActivationKey ?? 'missing')}
  data-received-pan-on-drag={String(panOnDrag ?? 'missing')}
  data-received-visible-only={String(onlyRenderVisibleElements ?? 'missing')}
>
  <div class="svelte-flow__pane"></div>
  {@render children?.()}
</div>
