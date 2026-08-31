import type { CanvasNode } from './types'
import { sameCanvasNode } from './project-canvas'

export interface CanvasSelectionReconciliation {
  readonly nodes: CanvasNode[]
  readonly selection: readonly string[]
}

export function reconcileCanvasNodeSelection(
  nodes: CanvasNode[],
  authoritativeSelection: readonly string[],
): CanvasNode[] {
  const selectedIds = new Set(authoritativeSelection)
  let changed = false
  const reconciled = nodes.map((node) => {
    const selected = selectedIds.has(node.id)
    if (Boolean(node.selected) === selected) return node
    changed = true
    return { ...node, selected }
  })
  return changed ? reconciled : nodes
}

export function createCanvasSelectionReconciler() {
  let previousProjectedNodes: readonly CanvasNode[] = []
  let previousResult: CanvasSelectionReconciliation | undefined

  return (
    projectedNodes: CanvasNode[],
    authoritativeSelection: readonly string[],
    currentNodes?: CanvasNode[],
  ): CanvasSelectionReconciliation => {
    const availableIds = new Set(projectedNodes.map(({ id }) => id))
    const selection = authoritativeSelection.filter((id) => availableIds.has(id))
    const previousOutputNodes =
      previousResult && currentNodes && sameNodeIds(currentNodes, previousProjectedNodes)
        ? currentNodes
        : previousResult?.nodes

    if (
      previousResult &&
      sameIdentities(projectedNodes, previousProjectedNodes) &&
      sameValues(selection, previousResult.selection)
    ) {
      const result = {
        nodes: reconcileCanvasNodeSelection(previousOutputNodes ?? previousResult.nodes, selection),
        selection,
      }
      previousResult = result
      return result
    }

    const selectedIds = new Set(selection)
    const previousById = new Map(
      previousProjectedNodes.map((projectedNode, index) => [
        projectedNode.id,
        { projectedNode, outputNode: previousOutputNodes?.[index] },
      ]),
    )
    const nodes = projectedNodes.map((projectedNode) => {
      const selected = selectedIds.has(projectedNode.id)
      const previous = previousById.get(projectedNode.id)
      if (
        previous &&
        sameCanvasNode(previous.projectedNode, projectedNode) &&
        previous.outputNode &&
        Boolean(previous.outputNode.selected) === selected
      ) {
        return previous.outputNode
      }
      return Boolean(projectedNode.selected) === selected ? projectedNode : { ...projectedNode, selected }
    })
    const reconciledNodes =
      previousOutputNodes && sameIdentities(nodes, previousOutputNodes)
        ? previousOutputNodes
        : sameIdentities(nodes, projectedNodes)
          ? projectedNodes
          : nodes
    const result = { nodes: reconciledNodes, selection }
    previousProjectedNodes = projectedNodes
    previousResult = result
    return result
  }
}

function sameIdentities(left: readonly CanvasNode[], right: readonly CanvasNode[]): boolean {
  return left.length === right.length && left.every((node, index) => node === right[index])
}

function sameNodeIds(left: readonly CanvasNode[], right: readonly CanvasNode[]): boolean {
  return left.length === right.length && left.every((node, index) => node.id === right[index]?.id)
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
