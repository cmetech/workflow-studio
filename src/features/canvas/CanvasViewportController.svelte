<script module lang="ts">
  interface TransientPositionItem {
    readonly internals: { readonly positionAbsolute: { readonly x: number; readonly y: number } }
  }

  interface TransientNodePositionStore {
    readonly domNode: ParentNode | null
    updateNodePositions: (items: Map<string, TransientPositionItem>, dragging?: boolean) => void
  }

  type CssEscape = ((value: string) => string) | undefined

  function cssEscape(): CssEscape {
    return (globalThis as typeof globalThis & { CSS?: { escape?: CssEscape } }).CSS?.escape
  }

  function renderedNode(root: ParentNode, id: string, escape: CssEscape): HTMLElement | null {
    const escaped = escape?.(id)
    return escaped ? root.querySelector<HTMLElement>(`.svelte-flow__node[data-id="${escaped}"]`) : null
  }

  export function deferTransientNodePositionUpdates(store: TransientNodePositionStore): () => void {
    const original = store.updateNodePositions
    const deferred: TransientNodePositionStore['updateNodePositions'] = (items, dragging = false) => {
      if (!dragging) {
        original(items, false)
        return
      }
      const root = store.domNode
      if (!root) return
      const escape = cssEscape()
      const fallbackNodes = escape
        ? null
        : new Map(
            Array.from(root.querySelectorAll<HTMLElement>('.svelte-flow__node[data-id]')).flatMap((element) =>
              element.dataset.id ? [[element.dataset.id, element]] : [],
            ),
          )
      for (const [id, item] of items) {
        const element = fallbackNodes?.get(id) ?? renderedNode(root, id, escape)
        if (!element) continue
        const { x, y } = item.internals.positionAbsolute
        element.style.transform = `translate(${x}px, ${y}px)`
        element.classList.add('dragging')
      }
    }
    store.updateNodePositions = deferred
    return () => {
      if (store.updateNodePositions === deferred) store.updateNodePositions = original
    }
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte'
  import { useStore, useSvelteFlow } from '@xyflow/svelte'
  import type { LayoutWorkerBounds } from '$src/workers/layout-worker-protocol'

  const flow = useSvelteFlow()
  const store = useStore()
  const restoreNodePositionUpdates = deferTransientNodePositionUpdates(
    store as unknown as Parameters<typeof deferTransientNodePositionUpdates>[0],
  )
  onDestroy(restoreNodePositionUpdates)

  export function viewport() {
    return flow.getViewport()
  }

  export function fitGraph(bounds: LayoutWorkerBounds): Promise<boolean> {
    // Measured nodes are already published. fitBounds applies the viewport before
    // yielding; fitView queues a later mutation that cannot be cancelled if stale.
    return flow.fitBounds(bounds, { padding: 0.18, duration: 0 })
  }
</script>
