export interface LayoutRecordV1 {
  schemaVersion: 1
  workspaceId: string
  workflowPath: string
  nodePositions: Record<string, { x: number; y: number }>
  viewport: { x: number; y: number; zoom: number }
  panels: { left: number; right: number; problems: number }
  editorMode: 'visual' | 'split' | 'yaml'
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
