import { atom } from 'nanostores'
import type { GraphScopeKey } from '$src/lib/projection/types'
import type { CanvasPosition } from '$src/features/canvas/types'

export const $canvasPositions = atom<Readonly<Record<string, CanvasPosition>>>({})
export const $canvasSelection = atom<readonly string[]>([])
export const $canvasWorkflowIdentity = atom<string | null>(null)

export function canvasInstanceIdentity(workflowId: string, scopeKey: GraphScopeKey): string {
  return JSON.stringify([workflowId, scopeKey])
}

export function activateCanvasWorkflowIdentity(workflowId: string | null, scopeKey?: GraphScopeKey): void {
  if (workflowId !== null && scopeKey) workflowId = canvasInstanceIdentity(workflowId, scopeKey)
  if ($canvasWorkflowIdentity.get() === workflowId) return
  $canvasSelection.set([])
  $canvasWorkflowIdentity.set(workflowId)
}

export function replaceCanvasPositions(positions: Readonly<Record<string, CanvasPosition>>): void {
  const next = clonePositions(positions)
  if (samePositions($canvasPositions.get(), next)) return
  $canvasPositions.set(next)
}

export function moveCanvasPosition(id: string, position: CanvasPosition): void {
  moveCanvasPositions([{ id, position }])
}

export function moveCanvasPositions(
  updates: readonly { readonly id: string; readonly position: CanvasPosition }[],
): void {
  const valid = updates.filter(({ id, position }) => Boolean(id) && validPosition(position))
  if (valid.length === 0) return
  const next = { ...$canvasPositions.get() }
  for (const { id, position } of valid) next[id] = { x: position.x, y: position.y }
  if (!samePositions($canvasPositions.get(), next)) $canvasPositions.set(next)
}

export function setCanvasSelection(ids: readonly string[]): void {
  const next = [...new Set(ids.filter(Boolean))]
  const previous = $canvasSelection.get()
  if (previous.length === next.length && previous.every((id, index) => id === next[index])) return
  $canvasSelection.set(next)
}

export function clearCanvasState(): void {
  $canvasWorkflowIdentity.set(null)
  $canvasPositions.set({})
  $canvasSelection.set([])
}

function clonePositions(positions: Readonly<Record<string, CanvasPosition>>): Record<string, CanvasPosition> {
  return Object.fromEntries(
    Object.entries(positions)
      .filter(([, position]) => validPosition(position))
      .map(([id, position]) => [id, { x: position.x, y: position.y }]),
  )
}

function validPosition(position: CanvasPosition): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y)
}

function samePositions(
  left: Readonly<Record<string, CanvasPosition>>,
  right: Readonly<Record<string, CanvasPosition>>,
): boolean {
  const leftIds = Object.keys(left)
  const rightIds = Object.keys(right)
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((id) => left[id]?.x === right[id]?.x && left[id]?.y === right[id]?.y)
  )
}
