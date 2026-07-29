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
  readonly nodeKinds?: readonly string[]
  readonly unit?: string
  readonly compatibilityCode?: string
  readonly constraints?: Readonly<Record<string, unknown>>
  readonly relatedTopicIds?: readonly string[]
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
  searchText: ReadonlyMap<string, string>
  tokenIndex: ReadonlyMap<string, ReadonlySet<string>>
}
