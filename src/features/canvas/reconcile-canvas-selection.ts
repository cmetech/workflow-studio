import type { CanvasNode } from './types'

export interface CanvasSelectionReconciliation {
  readonly nodes: CanvasNode[]
  readonly selection: readonly string[]
}

export function createCanvasSelectionReconciler() {
  let previousProjectedNodes: readonly CanvasNode[] = []
  let previousResult: CanvasSelectionReconciliation | undefined

  return (
    projectedNodes: readonly CanvasNode[],
    authoritativeSelection: readonly string[],
  ): CanvasSelectionReconciliation => {
    const availableIds = new Set(projectedNodes.map(({ id }) => id))
    const selection = authoritativeSelection.filter((id) => availableIds.has(id))

    if (
      previousResult &&
      sameIdentities(projectedNodes, previousProjectedNodes) &&
      sameValues(selection, previousResult.selection)
    ) {
      return previousResult
    }

    const selectedIds = new Set(selection)
    const previousById = new Map(
      previousProjectedNodes.map((projectedNode, index) => [
        projectedNode.id,
        { projectedNode, outputNode: previousResult?.nodes[index] },
      ]),
    )
    const nodes = projectedNodes.map((projectedNode) => {
      const selected = selectedIds.has(projectedNode.id)
      const previous = previousById.get(projectedNode.id)
      if (previous?.projectedNode === projectedNode && previous.outputNode?.selected === selected) {
        return previous.outputNode
      }
      return projectedNode.selected === selected ? projectedNode : { ...projectedNode, selected }
    })
    const result = { nodes, selection }
    previousProjectedNodes = projectedNodes
    previousResult = result
    return result
  }
}

function sameIdentities(left: readonly CanvasNode[], right: readonly CanvasNode[]): boolean {
  return left.length === right.length && left.every((node, index) => node === right[index])
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
