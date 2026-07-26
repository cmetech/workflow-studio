import { atom } from 'nanostores'
import type { CanvasPosition } from '$src/features/canvas/types'

export const $canvasPositions = atom<Readonly<Record<string, CanvasPosition>>>({})
export const $canvasSelection = atom<readonly string[]>([])

export function replaceCanvasPositions(positions: Readonly<Record<string, CanvasPosition>>): void {
  $canvasPositions.set(clonePositions(positions))
}

export function moveCanvasPosition(id: string, position: CanvasPosition): void {
  if (!id || !validPosition(position)) return
  $canvasPositions.set({ ...$canvasPositions.get(), [id]: { x: position.x, y: position.y } })
}

export function setCanvasSelection(ids: readonly string[]): void {
  $canvasSelection.set([...new Set(ids.filter(Boolean))])
}

export function clearCanvasState(): void {
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
