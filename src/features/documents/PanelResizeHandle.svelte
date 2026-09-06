<script lang="ts">
  interface Props {
    value: number
    minimum: number
    maximum: number
    onPreview?: ((height: number | null) => void) | undefined
    onCommit?: ((height: number) => void) | undefined
  }

  let { value, minimum, maximum, onPreview, onCommit }: Props = $props()
  let dragging = $state(false)
  let activePointerId = $state<number | null>(null)
  let startY = 0
  let startValue = 0
  let previewValue = $state<number | null>(null)
  const displayedValue = $derived(previewValue ?? value)

  function clamp(height: number): number {
    return Math.min(maximum, Math.max(minimum, height))
  }

  function beginResize(event: PointerEvent): void {
    if (event.button !== 0 || event.isPrimary === false) return
    event.preventDefault()
    dragging = true
    activePointerId = event.pointerId
    startY = event.clientY
    startValue = value
    previewValue = value
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture?.(event.pointerId)
  }

  function previewResize(event: PointerEvent): void {
    if (!dragging || event.pointerId !== activePointerId) return
    const next = clamp(startValue + startY - event.clientY)
    previewValue = next
    onPreview?.(next)
  }

  function finishResize(event: PointerEvent): void {
    if (!dragging || event.pointerId !== activePointerId) return
    const next = previewValue ?? value
    dragging = false
    activePointerId = null
    previewValue = null
    onCommit?.(next)
  }

  function cancelResize(event?: PointerEvent): void {
    if (!dragging || (event && event.pointerId !== activePointerId)) return
    dragging = false
    activePointerId = null
    previewValue = null
    onPreview?.(null)
  }

  function resizeFromKeyboard(event: KeyboardEvent): void {
    const step = event.shiftKey ? 48 : 16
    const next =
      event.key === 'ArrowUp'
        ? clamp(value + step)
        : event.key === 'ArrowDown'
          ? clamp(value - step)
          : event.key === 'Home'
            ? minimum
            : event.key === 'End'
              ? maximum
              : null
    if (next === null) {
      if (event.key === 'Escape') cancelResize()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onCommit?.(next)
  }
</script>

<svelte:window onpointermove={previewResize} onpointerup={finishResize} onpointercancel={cancelResize} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (The focusable ARIA separator follows the window-splitter interaction pattern.) -->
<div
  class:dragging
  class="resize-handle"
  role="separator"
  tabindex="0"
  aria-label="Resize workflow details panel"
  aria-orientation="horizontal"
  aria-valuemin={minimum}
  aria-valuemax={maximum}
  aria-valuenow={displayedValue}
  title="Drag or use arrow keys to resize"
  onpointerdown={beginResize}
  onkeydown={resizeFromKeyboard}
>
  <span aria-hidden="true"></span>
</div>

<style>
  .resize-handle {
    display: grid;
    height: 0.5rem;
    place-items: center;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
    cursor: row-resize;
    touch-action: none;
    user-select: none;
  }
  span {
    width: 2.5rem;
    height: 3px;
    border-radius: 999px;
    background: var(--color-edge);
  }
  .resize-handle:hover span,
  .resize-handle:focus-visible span,
  .resize-handle.dragging span {
    background: var(--color-focus);
  }
  .resize-handle:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: -3px;
  }
  @media (forced-colors: active) {
    .resize-handle {
      border-color: CanvasText;
    }
    span,
    .resize-handle:hover span,
    .resize-handle:focus-visible span,
    .resize-handle.dragging span {
      background: CanvasText;
    }
  }
</style>
