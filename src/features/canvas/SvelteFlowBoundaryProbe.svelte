<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import type { Viewport } from '@xyflow/svelte'

  interface Props {
    nodes?: Array<{ readonly id?: string }>
    edges?: Array<{ readonly id?: string }>
    viewport?: Viewport
    onmoveend?: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void
    panActivationKey?: string | readonly string[]
    panOnDrag?: boolean | readonly number[]
    onlyRenderVisibleElements?: boolean
    defaultEdgeOptions?: { readonly selectable?: boolean }
    onselectionstart?: () => void
    onselectionend?: () => void
    children?: Snippet
  }

  let {
    nodes = $bindable(),
    edges = $bindable(),
    viewport = $bindable(),
    onmoveend,
    panActivationKey,
    panOnDrag,
    onlyRenderVisibleElements,
    defaultEdgeOptions,
    onselectionstart,
    onselectionend,
    children,
  }: Props = $props()

  let root: HTMLDivElement
  onMount(() => {
    // Svelte Flow auto-pan updates its bound viewport and emits onmoveend per frame.
    const pan = (event: Event) => {
      const next = (event as CustomEvent<Viewport>).detail
      viewport = { ...next }
      onmoveend?.(null, next)
    }
    root.addEventListener('flowboundarypan', pan)
    const selectionStart = () => onselectionstart?.()
    const selectionEnd = () => onselectionend?.()
    root.addEventListener('flowboundaryselectionstart', selectionStart)
    root.addEventListener('flowboundaryselectionend', selectionEnd)
    return () => {
      root.removeEventListener('flowboundarypan', pan)
      root.removeEventListener('flowboundaryselectionstart', selectionStart)
      root.removeEventListener('flowboundaryselectionend', selectionEnd)
    }
  })
</script>

<div
  bind:this={root}
  class="svelte-flow"
  data-testid="svelte-flow-boundary-probe"
  data-received-pan-activation-key={String(panActivationKey ?? 'missing')}
  data-received-pan-on-drag={String(panOnDrag ?? 'missing')}
  data-received-visible-only={String(onlyRenderVisibleElements ?? 'missing')}
  data-received-edge-selectable={String(defaultEdgeOptions?.selectable ?? 'missing')}
  data-received-viewport={viewport ? `${viewport.x},${viewport.y},${viewport.zoom}` : 'missing'}
>
  <div class="svelte-flow__pane"></div>
  {@render children?.()}
</div>
