import { atom, computed } from 'nanostores'
import type { GraphScopeKey } from '$src/lib/projection/types'
import type { LayoutRecordV2, ScopeLayoutV1 } from '$src/lib/layout/types'

export const $activeLayout = atom<LayoutRecordV2 | null>(null)
export const $activeScopeLayout = computed($activeLayout, (record) => (record ? activeScopeLayout(record) : null))

export function activeScopeLayout(record: LayoutRecordV2): ScopeLayoutV1 {
  return record.scopeLayouts[record.activeScopeKey] ?? record.scopeLayouts.root
}

export function setActiveLayout(layout: LayoutRecordV2): void {
  if ($activeLayout.get() !== layout) $activeLayout.set(layout)
}

export function updateScopeLayout(
  scopeKey: GraphScopeKey,
  update: (scope: ScopeLayoutV1) => ScopeLayoutV1,
): LayoutRecordV2 | null {
  const record = $activeLayout.get()
  const scope = record?.scopeLayouts[scopeKey]
  if (!record || !scope) return record
  const next = update(scope)
  if (next === scope) return record
  const updated = { ...record, scopeLayouts: { ...record.scopeLayouts, [scopeKey]: next } }
  setActiveLayout(updated)
  return updated
}

export function clearActiveLayout(): void {
  $activeLayout.set(null)
}
