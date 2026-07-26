import { atom } from 'nanostores'
import type { LayoutRecordV1 } from '$src/lib/layout/types'

export const $activeLayout = atom<LayoutRecordV1 | null>(null)

export function setActiveLayout(layout: LayoutRecordV1): void {
  $activeLayout.set(structuredClone(layout))
}

export function clearActiveLayout(): void {
  $activeLayout.set(null)
}
