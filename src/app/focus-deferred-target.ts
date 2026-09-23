export interface DeferredFocusOptions {
  readonly load: () => Promise<unknown>
  readonly settle: () => Promise<void>
  readonly current: () => boolean
  readonly resolveTarget: () => HTMLElement | null | undefined
}

export async function focusDeferredTarget({
  load,
  settle,
  current,
  resolveTarget,
}: DeferredFocusOptions): Promise<boolean> {
  if (!current()) return false
  const owner = document.activeElement
  let superseded = false
  const trackFocus = (event: FocusEvent): void => {
    if (event.target !== owner && event.target !== document.body) superseded = true
  }
  const ownsFocus = (): boolean => !superseded && current()
  document.addEventListener('focusin', trackFocus)
  try {
    try {
      await load()
    } catch {
      return false
    }
    if (!ownsFocus()) return false
    await settle()
    if (!ownsFocus()) return false
    const target = resolveTarget()
    if (!ownsFocus() || !target) return false
    document.removeEventListener('focusin', trackFocus)
    target.focus()
    return current() && document.activeElement === target
  } finally {
    document.removeEventListener('focusin', trackFocus)
  }
}
