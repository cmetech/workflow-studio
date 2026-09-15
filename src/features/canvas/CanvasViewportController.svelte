<script module lang="ts">
  interface TransientPositionItem {
    readonly internals: { readonly positionAbsolute: { readonly x: number; readonly y: number } }
  }

  interface TransientNodePositionStore {
    readonly domNode: ParentNode | null
    updateNodePositions: (items: Map<string, TransientPositionItem>, dragging?: boolean) => void
  }

  interface TouchedElementState {
    readonly element: HTMLElement
    readonly transform: string
    readonly hadDraggingClass: boolean
  }

  interface TransientUpdateGesture {
    canceled: boolean
    readonly touched: Map<HTMLElement, TouchedElementState>
  }

  export interface TransientNodePositionUpdates {
    begin(): void
    cancel(): void
    destroy(): void
  }

  type CssEscape = ((value: string) => string) | undefined

  function cssEscape(): CssEscape {
    return (globalThis as typeof globalThis & { CSS?: { escape?: CssEscape } }).CSS?.escape
  }

  function renderedNode(root: ParentNode, id: string, escape: CssEscape): HTMLElement | null {
    const escaped = escape?.(id)
    return escaped ? root.querySelector<HTMLElement>(`.svelte-flow__node[data-id="${escaped}"]`) : null
  }

  export function deferTransientNodePositionUpdates(store: TransientNodePositionStore): TransientNodePositionUpdates {
    const original = store.updateNodePositions
    let gesture: TransientUpdateGesture | undefined

    function restoreTouched(active: TransientUpdateGesture): void {
      for (const { element, transform, hadDraggingClass } of active.touched.values()) {
        element.style.transform = transform
        element.classList.toggle('dragging', hadDraggingClass)
      }
      active.touched.clear()
    }

    const deferred: TransientNodePositionStore['updateNodePositions'] = (items, dragging = false) => {
      if (!dragging) {
        const canceled = gesture?.canceled ?? false
        gesture = undefined
        if (!canceled) original(items, false)
        return
      }
      if (!gesture || gesture.canceled) return
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
        if (!gesture.touched.has(element)) {
          gesture.touched.set(element, {
            element,
            transform: element.style.transform,
            hadDraggingClass: element.classList.contains('dragging'),
          })
        }
        const { x, y } = item.internals.positionAbsolute
        element.style.transform = `translate(${x}px, ${y}px)`
        element.classList.add('dragging')
      }
    }
    store.updateNodePositions = deferred

    return {
      begin() {
        if (gesture) restoreTouched(gesture)
        gesture = { canceled: false, touched: new Map() }
      },
      cancel() {
        if (!gesture) return
        gesture.canceled = true
        restoreTouched(gesture)
      },
      destroy() {
        if (gesture) restoreTouched(gesture)
        gesture = undefined
        if (store.updateNodePositions === deferred) store.updateNodePositions = original
      },
    }
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte'
  import { useStore, useSvelteFlow } from '@xyflow/svelte'
  import type { LayoutWorkerBounds } from '$src/workers/layout-worker-protocol'

  const flow = useSvelteFlow()
  const store = useStore()
  const transientNodePositionUpdates = deferTransientNodePositionUpdates(
    store as unknown as Parameters<typeof deferTransientNodePositionUpdates>[0],
  )
  onDestroy(transientNodePositionUpdates.destroy)

  export function beginNodeDrag(): void {
    transientNodePositionUpdates.begin()
  }

  export function cancelNodeDrag(): void {
    transientNodePositionUpdates.cancel()
  }

  export function viewport() {
    return flow.getViewport()
  }

  export function fitGraph(bounds: LayoutWorkerBounds): Promise<boolean> {
    // Measured nodes are already published. fitBounds applies the viewport before
    // yielding; fitView queues a later mutation that cannot be cancelled if stale.
    return flow.fitBounds(bounds, { padding: 0.18, duration: 0 })
  }
</script>
