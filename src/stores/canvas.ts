import { atom } from 'nanostores'
import type { CanvasPosition } from '$src/features/canvas/types'

export const $canvasPositions = atom<Readonly<Record<string, CanvasPosition>>>({})
export const $canvasSelection = atom<readonly string[]>([])
export const $canvasWorkflowIdentity = atom<string | null>(null)

export function activateCanvasWorkflowIdentity(workflowId: string | null): void {
  if ($canvasWorkflowIdentity.get() === workflowId) return
  $canvasSelection.set([])
  $canvasWorkflowIdentity.set(workflowId)
}

export function replaceCanvasPositions(positions: Readonly<Record<string, CanvasPosition>>): void {
  $canvasPositions.set(clonePositions(positions))
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
  $canvasPositions.set(next)
}

export function setCanvasSelection(ids: readonly string[]): void {
  $canvasSelection.set([...new Set(ids.filter(Boolean))])
}

export function clearCanvasState(): void {
  $canvasPositions.set({})
  $canvasSelection.set([])
  $canvasWorkflowIdentity.set(null)
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
