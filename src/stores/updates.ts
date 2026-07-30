import { atom } from 'nanostores'
import type { UpdateState } from '$src/lib/updates/types'

export type UpdateStatusSummary =
  | null
  | { readonly phase: 'idle' | 'current' | 'checking' | 'verifying' | 'installing' | 'deferred' | 'offline' }
  | { readonly phase: 'available'; readonly version: string }
  | { readonly phase: 'downloading'; readonly downloadedBytes: number; readonly totalBytes: number | null }
  | { readonly phase: 'restart-required' | 'cancelling' | 'recheck-required' | 'dismissed' | 'failed' }

export const $updateState = atom<UpdateStatusSummary>(null)
export const updateState = $updateState

export function publishUpdateState(state: UpdateState): void {
  if (state.phase === 'available') {
    $updateState.set({ phase: 'available', version: state.release?.version ?? 'unknown' })
  } else if (state.phase === 'downloading') {
    $updateState.set({ phase: 'downloading', downloadedBytes: state.downloadedBytes, totalBytes: state.totalBytes })
  } else $updateState.set({ phase: state.phase })
}

export function setUpdateStateForTest(state: UpdateStatusSummary): void {
  $updateState.set(state)
}
