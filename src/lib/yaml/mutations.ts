import type { DocumentKind } from '$src/lib/documents/types'

export type WorkflowMutation =
  | { type: 'set-field'; document: DocumentKind; path: readonly (string | number)[]; value: unknown }
  | { type: 'delete-field'; document: DocumentKind; path: readonly (string | number)[] }
  | { type: 'add-node'; node: Record<string, unknown>; afterNodeId?: string }
  | { type: 'delete-node'; nodeId: string }
  | { type: 'rename-node'; from: string; to: string }
  | { type: 'set-dependencies'; nodeId: string; dependsOn: readonly string[] }
  | { type: 'replace-document'; document: DocumentKind; text: string }
