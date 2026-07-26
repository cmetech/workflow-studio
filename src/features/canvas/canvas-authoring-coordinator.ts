import type { NodeKindDescriptor } from '$src/lib/contract/types'
import {
  addNode,
  connectNodes,
  deleteNodes,
  disconnectNodes,
  previewDeleteNodes,
  type CanvasActionContext,
  type CanvasActionResult,
  type DeleteImpact,
} from './canvas-actions'
import { copySelection, duplicateSelection, pasteSelection, type CanvasClipboard } from './duplicate-selection'
import type { CanvasPosition } from './types'

export interface CanvasAuthoringUnavailable {
  readonly unavailable: string
}

export type CanvasCoordinatorResult =
  | CanvasActionResult
  | { readonly status: 'rejected'; readonly code: 'canvas_action_unavailable'; readonly message: string }

type CanvasUnavailableResult = Extract<CanvasCoordinatorResult, { readonly code: 'canvas_action_unavailable' }>
type CanvasCopyResult =
  { readonly status: 'copied'; readonly count: number } | Extract<CanvasCoordinatorResult, { status: 'rejected' }>

export type CanvasDeletePreview =
  { readonly status: 'ready'; readonly impact: DeleteImpact } | Extract<CanvasCoordinatorResult, { status: 'rejected' }>

export interface CanvasAuthoringCoordinator {
  connect(sourceId: string, targetId: string): Promise<CanvasCoordinatorResult>
  disconnect(sourceId: string, targetId: string): Promise<CanvasCoordinatorResult>
  add(
    descriptor: NodeKindDescriptor,
    request: { readonly afterNodeId?: string; readonly viewportCenter: CanvasPosition },
  ): Promise<CanvasCoordinatorResult>
  duplicate(nodeIds: readonly string[]): Promise<CanvasCoordinatorResult>
  copy(nodeIds: readonly string[]): CanvasCopyResult
  paste(): Promise<CanvasCoordinatorResult>
  previewDelete(nodeIds: readonly string[]): CanvasDeletePreview
  delete(nodeIds: readonly string[]): Promise<CanvasCoordinatorResult>
}

export function createCanvasAuthoringCoordinator(dependencies: {
  readonly getContext: () => CanvasActionContext | CanvasAuthoringUnavailable
}): CanvasAuthoringCoordinator {
  let clipboard: CanvasClipboard | null = null

  const context = (): CanvasActionContext | CanvasUnavailableResult => {
    const current = dependencies.getContext()
    return 'unavailable' in current
      ? { status: 'rejected', code: 'canvas_action_unavailable', message: current.unavailable }
      : current
  }

  return {
    async connect(sourceId, targetId) {
      const current = context()
      return isUnavailable(current) ? current : connectNodes(current, sourceId, targetId)
    },
    async disconnect(sourceId, targetId) {
      const current = context()
      return isUnavailable(current) ? current : disconnectNodes(current, sourceId, targetId)
    },
    async add(descriptor, request) {
      const current = context()
      return isUnavailable(current) ? current : addNode(current, descriptor, request)
    },
    async duplicate(nodeIds) {
      const current = context()
      return isUnavailable(current) ? current : duplicateSelection(current, nodeIds)
    },
    copy(nodeIds) {
      const current = context()
      if (isUnavailable(current)) return current
      const copied = copySelection(current, nodeIds)
      if (copied.nodes.length === 0) {
        const message = 'Copy at least one node before copying.'
        current.announce(message)
        return { status: 'rejected', code: 'selection_empty', message }
      }
      clipboard = copied
      return { status: 'copied', count: copied.nodes.length }
    },
    async paste() {
      const current = context()
      if (isUnavailable(current)) return current
      if (!clipboard) {
        const message = 'Copy at least one node before pasting.'
        current.announce(message)
        return { status: 'rejected', code: 'selection_empty', message }
      }
      return pasteSelection(current, clipboard)
    },
    previewDelete(nodeIds) {
      const current = context()
      return isUnavailable(current)
        ? current
        : { status: 'ready', impact: previewDeleteNodes(current.projection, nodeIds, current.contract) }
    },
    async delete(nodeIds) {
      const current = context()
      return isUnavailable(current) ? current : deleteNodes(current, nodeIds)
    },
  }
}

function isUnavailable(value: CanvasActionContext | CanvasUnavailableResult): value is CanvasUnavailableResult {
  return 'status' in value
}
