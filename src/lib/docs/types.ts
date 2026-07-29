import type { ContractItemStatus, WorkflowProfile } from '$src/lib/contract/types'

export type DocumentationTopicKind = 'node' | 'field' | 'guide' | 'contract'

export interface DocumentationTopic {
  readonly id: string
  readonly kind: DocumentationTopicKind
  readonly title: string
  readonly description: string
  readonly body: string
  readonly examples: readonly unknown[]
  readonly status: ContractItemStatus
  readonly profile: WorkflowProfile
  readonly fieldPaths: readonly string[]
  readonly required?: boolean
  readonly defaultValue?: unknown
}

export interface DocumentationGuide {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly description?: string
}

export interface DocumentationIndex {
  readonly topics: readonly DocumentationTopic[]
  byId: Map<string, DocumentationTopic>
}
