import { atom, computed } from 'nanostores'
import type { GraphScopeKey } from '$src/lib/projection/types'
import type { LayoutRecordV2, ScopeLayoutV1 } from '$src/lib/layout/types'

export const $activeLayout = atom<LayoutRecordV2 | null>(null)
export const $activeScopeLayout = computed($activeLayout, (record) => (record ? activeScopeLayout(record) : null))

export function activeScopeLayout(record: LayoutRecordV2): ScopeLayoutV1 {
  return record.scopeLayouts[record.activeScopeKey] ?? record.scopeLayouts.root
}

export type LayoutPublicationOrigin = 'edit' | 'navigation'
// Transient publication metadata, never another layout authority or persisted field.
const navigationPublications = new WeakSet<LayoutRecordV2>()
export function isNavigationLayoutPublication(layout: LayoutRecordV2): boolean {
  return navigationPublications.has(layout)
}
export function setActiveLayout(layout: LayoutRecordV2, origin: LayoutPublicationOrigin = 'edit'): void {
  if ($activeLayout.get() === layout) return
  if (origin === 'navigation') navigationPublications.add(layout)
  else navigationPublications.delete(layout)
  $activeLayout.set(layout)
}

export function updateScopeLayout(
  scopeKey: GraphScopeKey,
  update: (scope: ScopeLayoutV1) => ScopeLayoutV1,
  origin: LayoutPublicationOrigin = 'edit',
): LayoutRecordV2 | null {
  const record = $activeLayout.get()
  const scope = record?.scopeLayouts[scopeKey]
  if (!record || !scope) return record
  const next = update(scope)
  if (next === scope) return record
  const updated = { ...record, scopeLayouts: { ...record.scopeLayouts, [scopeKey]: next } }
  setActiveLayout(updated, origin)
  return updated
}

export function clearActiveLayout(): void {
  $activeLayout.set(null)
}
