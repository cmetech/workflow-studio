import type { GraphScopeKey } from '$src/lib/projection/types'

export interface LayoutRecordV1 {
  schemaVersion: 1
  workspaceId: string
  workflowPath: string
  nodePositions: Record<string, { x: number; y: number }>
  viewport: { x: number; y: number; zoom: number }
  panels: PanelLayout
  editorMode: EditorMode
  updatedAt: string
}

export interface LayoutNodeProjection {
  readonly id: string
  readonly kind: string
  readonly value: unknown
  readonly dependsOn: readonly string[]
  readonly options: Readonly<Record<string, unknown>>
}

export interface LayoutProjection {
  readonly nodes: readonly LayoutNodeProjection[]
}

export interface LayoutContentHashes {
  readonly definition: string
  readonly companion: string | null
}

export interface LayoutLoadRequest {
  readonly workspaceId: string
  readonly workflowPath: string
  readonly savedHashes?: LayoutContentHashes
  readonly missingWorkflowPaths?: readonly string[]
}

export interface PanelLayout {
  left: number
  right: number
  problems: number
}
export type EditorMode = 'visual' | 'split' | 'yaml'
export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}
export interface CanvasFocusTarget {
  kind: 'canvas' | 'node' | 'scope-heading'
  nodeId?: string
}
export interface InspectorLayout {
  tab: string
  scrollTop: number
}
export type AuxiliaryTab = 'problems' | 'references'
export interface ScopeLayoutV1 {
  nodePositions: Record<string, { x: number; y: number }>
  viewport: CanvasViewport
  selectedNodeIds: readonly string[]
  focusTarget?: CanvasFocusTarget
  inspector: InspectorLayout
  canvasScroll: { left: number; top: number }
  /** Added compatibly to v2 records; readers default an omitted value to zero. */
  problemsScroll?: number
  /** Omitted until the first visit chooses a tab from current blocking issues. */
  auxiliaryTab?: AuxiliaryTab
  referencesScroll?: number
}
export interface LayoutRecordV2 {
  schemaVersion: 2
  workspaceId: string
  workflowPath: string
  activeScopeKey: GraphScopeKey
  scopeLayouts: Record<GraphScopeKey, ScopeLayoutV1>
  panels: PanelLayout
  editorMode: EditorMode
  updatedAt: string
}

export function emptyScopeLayout(): ScopeLayoutV1 {
  return {
    nodePositions: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedNodeIds: [],
    inspector: { tab: 'General', scrollTop: 0 },
    canvasScroll: { left: 0, top: 0 },
    problemsScroll: 0,
    referencesScroll: 0,
  }
}
