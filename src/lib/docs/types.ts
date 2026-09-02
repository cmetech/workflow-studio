import type { ContractItemStatus, WorkflowProfile } from '$src/lib/contract/types'

export type DocumentationTopicKind = 'node' | 'field' | 'guide' | 'contract'
export type DocumentationMode = 'overview' | 'guides' | 'reference' | 'all'
export type GuideGroupId =
  | 'getting-started'
  | 'build-graph'
  | 'configure-behavior'
  | 'review-recover'
  | 'use-application'
export type ReferenceGroupId =
  | 'node-types'
  | 'common-node-settings'
  | 'node-specific-fields'
  | 'workflow-fields'
  | 'companion-policy'
  | 'language-contract'
export type DocumentationRenderer = 'markdown' | 'keyboard-shortcuts'

export interface DocumentationTopic {
  readonly id: string
  readonly kind: DocumentationTopicKind
  readonly title: string
  readonly description: string
  readonly body: string
  readonly qualifier: string
  readonly useWhen: string
  readonly breadcrumb: readonly string[]
  readonly renderer: DocumentationRenderer
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
  readonly guideGroup?: GuideGroupId
  readonly referenceGroup?: ReferenceGroupId
}

export interface DocumentationGuide {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly description?: string
  readonly group: GuideGroupId
  readonly useWhen: string
  readonly renderer?: DocumentationRenderer
}

export interface DocumentationSearchOptions {
  readonly mode: Exclude<DocumentationMode, 'overview'>
  readonly referenceGroup?: ReferenceGroupId
}

export interface DocumentationIndex {
  readonly topics: readonly DocumentationTopic[]
  byId: Map<string, DocumentationTopic>
  searchText: ReadonlyMap<string, string>
  tokenIndex: ReadonlyMap<string, ReadonlySet<string>>
  guideGroups: ReadonlyMap<GuideGroupId, readonly DocumentationTopic[]>
  referenceGroups: ReadonlyMap<ReferenceGroupId, readonly DocumentationTopic[]>
  duplicateTitleGroups: ReadonlyMap<string, readonly DocumentationTopic[]>
}
