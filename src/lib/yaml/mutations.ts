import type { GraphScopeKey } from '$src/lib/projection/types'
import type { DocumentKind } from '$src/lib/documents/types'

export type WorkflowMutation =
  | {
      readonly type: 'set-field'
      readonly document: DocumentKind
      readonly path: readonly (string | number)[]
      readonly value: unknown
    }
  | { readonly type: 'delete-field'; readonly document: DocumentKind; readonly path: readonly (string | number)[] }
  | {
      readonly type: 'add-node'
      readonly scopeKey: GraphScopeKey
      readonly node: Readonly<Record<string, unknown>>
      readonly afterNodeId?: string
    }
  | { readonly type: 'delete-node'; readonly scopeKey: GraphScopeKey; readonly nodeId: string }
  | { readonly type: 'rename-node'; readonly scopeKey: GraphScopeKey; readonly from: string; readonly to: string }
  | {
      readonly type: 'set-dependencies'
      readonly scopeKey: GraphScopeKey
      readonly nodeId: string
      readonly dependsOn: readonly string[]
    }
  | { readonly type: 'replace-document'; readonly document: DocumentKind; readonly text: string }
