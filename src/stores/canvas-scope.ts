import type { CanvasIdentityChanges } from '$src/features/canvas/canvas-actions'
import type { TransactionTexts, YamlTransaction } from '$src/lib/documents/transactions'
import { migrateVisualNodeRename } from '$src/lib/layout/place-new-nodes'
import { atom, computed } from 'nanostores'
import type { GraphScopeKey, WorkflowProjection } from '$src/lib/projection/types'
import type { LayoutRecordV2, ScopeLayoutV1 } from '$src/lib/layout/types'
import { reconcileWorkflowLayout } from '$src/lib/layout/place-new-nodes'
import { $activeLayout, activeScopeLayout, setActiveLayout, updateScopeLayout } from './layout'
import {
  $canvasPositions,
  $canvasSelection,
  $canvasWorkflowIdentity,
  activateCanvasWorkflowIdentity,
  canvasInstanceIdentity,
  replaceCanvasPositions,
  setCanvasSelection,
} from './canvas'

export const $activeScopeKey = computed($activeLayout, (record): GraphScopeKey => record?.activeScopeKey ?? 'root')
export interface ScopeNavigationEvent {
  readonly scopeKey: GraphScopeKey
  readonly message: string
}
export const $scopeNavigationEvent = atom<ScopeNavigationEvent | null>(null)
let available:
  { workflowId: string; workspaceId: string; workflowPath: string; projection: WorkflowProjection } | undefined

export function resetCanvasScopeProjection(): void {
  available = undefined
  pendingHistory = undefined
  layoutHistory.length = 0
}
$activeLayout.listen((record) => {
  if (!record) {
    resetCanvasScopeProjection()
    pendingHistory = undefined
    layoutHistory.length = 0
  }
})
$canvasSelection.listen((selectedNodeIds) => {
  const record = $activeLayout.get()
  if (
    !record ||
    !available ||
    available.workspaceId !== record.workspaceId ||
    available.workflowPath !== record.workflowPath ||
    $canvasWorkflowIdentity.get() !== canvasInstanceIdentity(available.workflowId, record.activeScopeKey)
  )
    return
  updateScopeLayout(record.activeScopeKey, (scope) =>
    scope.selectedNodeIds === selectedNodeIds ||
    (scope.selectedNodeIds.length === selectedNodeIds.length &&
      selectedNodeIds.every((id, i) => id === scope.selectedNodeIds[i]))
      ? scope
      : { ...scope, selectedNodeIds },
  )
})

/** Capture only ephemeral canvas state. Other interaction fields are narrow scope patches. */
export function captureActiveScope(patch: Partial<ScopeLayoutV1> = {}): void {
  const record = $activeLayout.get()
  if (
    !record ||
    !available ||
    available.workspaceId !== record.workspaceId ||
    available.workflowPath !== record.workflowPath ||
    $canvasWorkflowIdentity.get() !== canvasInstanceIdentity(available.workflowId, record.activeScopeKey)
  )
    return
  updateScopeLayout(record.activeScopeKey, (scope) => {
    const positions = $canvasPositions.get()
    const selectedNodeIds = $canvasSelection.get()
    const samePositions = positions === scope.nodePositions || equalPositions(positions, scope.nodePositions)
    const sameSelection =
      selectedNodeIds === scope.selectedNodeIds ||
      (selectedNodeIds.length === scope.selectedNodeIds.length &&
        selectedNodeIds.every((id, i) => id === scope.selectedNodeIds[i]))
    if (
      samePositions &&
      sameSelection &&
      Object.entries(patch).every(([key, value]) => scope[key as keyof ScopeLayoutV1] === value)
    )
      return scope
    return {
      ...scope,
      nodePositions: samePositions ? scope.nodePositions : positions,
      selectedNodeIds: sameSelection ? scope.selectedNodeIds : selectedNodeIds,
      ...patch,
    }
  })
}

export function enterLoopGroup(groupId: string): boolean {
  return switchScope(`loop-group:${groupId}`)
}
export function returnToRoot(): boolean {
  return switchScope('root')
}

function switchScope(scopeKey: GraphScopeKey): boolean {
  const record = $activeLayout.get()
  if (
    !record ||
    !available ||
    available.workspaceId !== record.workspaceId ||
    available.workflowPath !== record.workflowPath ||
    !available.projection.graphs.some((graph) => graph.scope.key === scopeKey) ||
    !record.scopeLayouts[scopeKey]
  )
    return false
  if (record.activeScopeKey === scopeKey) return true
  captureActiveScope()
  setActiveLayout({ ...$activeLayout.get()!, activeScopeKey: scopeKey })
  restoreScope()
  return true
}

/** Called only for accepted, current and structurally usable document analysis. */
export function publishCanvasProjection(
  workflowId: string,
  projection: WorkflowProjection,
  previous?: WorkflowProjection,
  currentTexts?: TransactionTexts,
): void {
  const record = $activeLayout.get()
  if (!record) return
  if (
    available?.workflowId === workflowId &&
    available.workspaceId === record.workspaceId &&
    available.workflowPath === record.workflowPath &&
    available.projection === projection &&
    !pendingHistory
  ) {
    if ($canvasWorkflowIdentity.get() !== canvasInstanceIdentity(workflowId, record.activeScopeKey)) restoreScope()
    return
  }
  if (
    available?.workflowId === workflowId &&
    available.workspaceId === record.workspaceId &&
    available.workflowPath === record.workflowPath
  )
    captureActiveScope()
  let captured = $activeLayout.get()!
  if (pendingHistory) {
    if (
      pendingHistory.workflowId === workflowId &&
      pendingHistory.layout.workspaceId === record.workspaceId &&
      pendingHistory.layout.workflowPath === record.workflowPath &&
      currentTexts?.definition === pendingHistory.texts.definition &&
      currentTexts.companion === pendingHistory.texts.companion
    ) {
      captured = {
        ...captured,
        scopeLayouts: pendingHistory.layout.scopeLayouts,
        activeScopeKey: pendingHistory.layout.activeScopeKey,
      }
    }
    pendingHistory = undefined
  }
  available = { workflowId, workspaceId: record.workspaceId, workflowPath: record.workflowPath, projection }
  const reconciled = reconcileWorkflowLayout(projection, captured, previous)
  setActiveLayout(reconciled)
  if (captured.activeScopeKey !== 'root' && reconciled.activeScopeKey === 'root') {
    $scopeNavigationEvent.set({
      scopeKey: 'root',
      message: 'The open loop group no longer exists. Returned to the root graph.',
    })
  }
  restoreScope()
}

function restoreScope(): void {
  const record = $activeLayout.get()
  if (!record || !available || !available.projection.graphs.some((graph) => graph.scope.key === record.activeScopeKey))
    return
  const scope = activeScopeLayout(record)
  activateCanvasWorkflowIdentity(available.workflowId, record.activeScopeKey)
  replaceCanvasPositions(scope.nodePositions)
  setCanvasSelection(scope.selectedNodeIds)
}

export function consumeScopeNavigationEvent(): ScopeNavigationEvent | null {
  const event = $scopeNavigationEvent.get()
  $scopeNavigationEvent.set(null)
  return event
}

function equalPositions(left: ScopeLayoutV1['nodePositions'], right: ScopeLayoutV1['nodePositions']): boolean {
  const ids = Object.keys(left)
  return (
    ids.length === Object.keys(right).length &&
    ids.every((id) => Object.hasOwn(right, id) && left[id]!.x === right[id]!.x && left[id]!.y === right[id]!.y)
  )
}

interface CanvasLayoutHistory {
  readonly transaction: YamlTransaction
  readonly before: LayoutRecordV2
  readonly after: LayoutRecordV2
}
const layoutHistory: CanvasLayoutHistory[] = []
let pendingHistory: { workflowId: string; layout: LayoutRecordV2; texts: TransactionTexts } | undefined

/** Apply only the identity mapping returned by a successful canvas action. */
export function commitCanvasIdentityChanges(
  before: LayoutRecordV2,
  transaction: YamlTransaction,
  changes: CanvasIdentityChanges,
): void {
  const current = $activeLayout.get()
  if (
    !current ||
    current.workspaceId !== before.workspaceId ||
    current.workflowPath !== before.workflowPath ||
    !available ||
    available.workflowId !== transaction.workflowId
  )
    return
  let next = current
  let scopeLayouts = current.scopeLayouts
  const setScope = (key: GraphScopeKey, scope: ScopeLayoutV1) => {
    if (scopeLayouts[key] !== scope) scopeLayouts = { ...scopeLayouts, [key]: scope }
  }
  for (const { from, to } of changes.scopeRenames) {
    const source = before.scopeLayouts[from]
    if (source) setScope(to, source)
    if (from !== 'root' && Object.hasOwn(scopeLayouts, from)) {
      scopeLayouts = { ...scopeLayouts }
      delete scopeLayouts[from]
    }
    if (next.activeScopeKey === from || (before.activeScopeKey === from && next.activeScopeKey === 'root')) {
      next = { ...next, activeScopeKey: to }
      $scopeNavigationEvent.set(null)
    }
  }
  for (const { from, to } of changes.scopeCopies) {
    const source = before.scopeLayouts[from]
    if (source) setScope(to, source)
  }
  for (const { scopeKey, from, to } of changes.nodeRenames) {
    const source = before.scopeLayouts[scopeKey]
    const scope = scopeLayouts[scopeKey]
    if (!source || !scope) continue
    const renamed = migrateVisualNodeRename(source, from, to)
    const nodePositions = { ...scope.nodePositions }
    delete nodePositions[from]
    if (renamed.nodePositions[to]) nodePositions[to] = renamed.nodePositions[to]!
    setScope(scopeKey, {
      ...scope,
      nodePositions,
      selectedNodeIds: renamed.selectedNodeIds,
      ...(renamed.focusTarget ? { focusTarget: renamed.focusTarget } : {}),
    })
  }
  for (const { from, to } of changes.nodeCopies) {
    const source = before.scopeLayouts[from.scopeKey]?.nodePositions[from.nodeId]
    const scope = scopeLayouts[to.scopeKey]
    // Placement supplied by the action wins over a source coordinate.
    if (scope && source && !Object.hasOwn(scope.nodePositions, to.nodeId))
      setScope(to.scopeKey, { ...scope, nodePositions: { ...scope.nodePositions, [to.nodeId]: source } })
  }
  for (const { scopeKey, nodeId } of changes.removedNodes) {
    const scope = scopeLayouts[scopeKey]
    if (!scope || !Object.hasOwn(scope.nodePositions, nodeId)) continue
    const nodePositions = { ...scope.nodePositions }
    delete nodePositions[nodeId]
    const updated = { ...scope, nodePositions, selectedNodeIds: scope.selectedNodeIds.filter((id) => id !== nodeId) }
    if (updated.focusTarget?.nodeId === nodeId) delete updated.focusTarget
    setScope(scopeKey, updated)
  }
  for (const key of changes.removedScopes) {
    if (key !== 'root' && Object.hasOwn(scopeLayouts, key)) {
      scopeLayouts = { ...scopeLayouts }
      delete scopeLayouts[key]
    }
  }
  if (scopeLayouts !== next.scopeLayouts) next = { ...next, scopeLayouts }
  if (!scopeLayouts[next.activeScopeKey]) next = { ...next, activeScopeKey: 'root' }
  setActiveLayout(next)
  restoreScope()
  layoutHistory.push({ transaction, before, after: next })
  if (layoutHistory.length > 200) layoutHistory.shift()
}

/** Undo/redo scope restoration waits for the matching accepted graph publication. */
export function queueCanvasLayoutHistory(transaction: YamlTransaction, direction: 'undo' | 'redo'): boolean {
  const entry = [...layoutHistory]
    .reverse()
    .find(
      (entry) =>
        entry.transaction.workflowId === transaction.workflowId &&
        entry.transaction.before.definition === transaction.before.definition &&
        entry.transaction.before.companion === transaction.before.companion &&
        entry.transaction.after.definition === transaction.after.definition &&
        entry.transaction.after.companion === transaction.after.companion,
    )
  if (!entry) return false
  pendingHistory = {
    workflowId: transaction.workflowId,
    layout: direction === 'undo' ? entry.before : entry.after,
    texts: direction === 'undo' ? transaction.before : transaction.after,
  }
  return true
}
