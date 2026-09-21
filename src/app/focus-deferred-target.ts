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
  try {
    await load()
  } catch {
    return false
  }
  if (!current()) return false
  await settle()
  if (!current()) return false
  const target = resolveTarget()
  if (!current() || !target) return false
  target.focus()
  return current() && document.activeElement === target
}
