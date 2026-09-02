import type { AuthoringContract, CompatibilityDescriptor, NodeKindDescriptor } from '$src/lib/contract/types'
import { collectContractFields } from '$src/lib/forms/widget-registry'
import type { FormField } from '$src/lib/forms/types'
import { GUIDE_GROUPS, GUIDE_PRESENTATION } from './navigation'
import type { DocumentationGuide, DocumentationIndex, DocumentationSearchOptions, DocumentationTopic, GuideGroupId, ReferenceGroupId } from './types'

type ContractCompatibility = CompatibilityDescriptor & { readonly fields?: readonly string[] }

const referenceGroupIds: readonly ReferenceGroupId[] = [
  'node-types', 'common-node-settings', 'node-specific-fields', 'workflow-fields', 'companion-policy', 'language-contract',
]

export function buildDocumentationIndex(contract: AuthoringContract, guides: readonly DocumentationGuide[] = []): DocumentationIndex {
  const fields = collectContractFields(contract)
  const topics: DocumentationTopic[] = [
    ...contract.node_kinds.map((node) => nodeTopic(contract, node)),
    ...fields.map((field) => fieldTopic(contract, field)),
    ...contract.documentation.topics.map((topic) => contractTopic(contract, topic)),
    ...contract.semantic_rules.map((rule) => ({
      id: rule.id, kind: 'contract' as const, title: rule.label, description: rule.description, body: rule.description,
      qualifier: 'Language contract', useWhen: 'Use this when you need to understand a workflow-language rule.',
      breadcrumb: ['Reference', 'Language contract'], renderer: 'markdown' as const, examples: rule.examples,
      status: rule.status, profile: contract.profile, fieldPaths: rule.field_paths, referenceGroup: 'language-contract' as const,
    })),
    ...guides.map((guide) => guideTopic(contract, guide)),
  ]
  const enrichedTopics = [...assignRepeatedFieldGroups(topics)].sort(compareTopics)
  const searchText = new Map(enrichedTopics.map((topic) => [topic.id, normalize(topicSearchText(topic))]))
  const tokenIndex = new Map<string, Set<string>>()
  for (const [id, text] of searchText) {
    for (const token of tokenize(text)) {
      const ids = tokenIndex.get(token) ?? new Set<string>()
      ids.add(id)
      tokenIndex.set(token, ids)
    }
  }
  return {
    topics: enrichedTopics,
    byId: new Map(enrichedTopics.map((topic) => [topic.id, topic])),
    searchText,
    tokenIndex,
    guideGroups: groupTopics(enrichedTopics, GUIDE_GROUPS.map(({ id }) => id), 'guideGroup'),
    referenceGroups: groupTopics(enrichedTopics, referenceGroupIds, 'referenceGroup'),
    duplicateTitleGroups: duplicateGroups(enrichedTopics),
  }
}

export function searchDocumentation(index: DocumentationIndex, query: string, options: DocumentationSearchOptions): readonly DocumentationTopic[] {
  const queryTokens = tokenize(query)
  const candidates = candidateIds(index, queryTokens)
  return index.topics
    .filter((topic) => candidates.has(topic.id) && matchesMode(topic, options))
    .map((topic) => ({ topic, score: scoreTopic(topic, queryTokens, index.searchText.get(topic.id) ?? '') }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score || compareTopics(left.topic, right.topic))
    .map(({ topic }) => topic)
}

function nodeTopic(contract: AuthoringContract, node: NodeKindDescriptor): DocumentationTopic {
  const field = collectContractFields(contract).find((candidate) => candidate.fieldPath === node.field_path && candidate.nodeKinds?.includes(node.id))
  const compatibility = field?.compatibilityCode ? contract.compatibility_codes[field.compatibilityCode] : compatibilityFor(contract, node.field_path)
  const migration = compatibility?.migration ? `\n\nMigration: ${compatibility.migration}` : ''
  return {
    id: `node:${node.id}`, kind: 'node', title: node.label, description: node.description,
    body: [
      `Purpose: ${node.description}`, `Type: \`${typeof field?.schema.type === 'string' ? field.schema.type : 'contract-defined'}\``,
      `Required: ${field ? (field.required ? 'yes' : 'no') : 'not supplied'}`,
      `Default: ${field?.hasDefault ? `\`${formatValue(field.defaultValue)}\`` : 'none'}`, `Profile: \`${contract.profile}\``, `Status: ${node.status}`,
      node.applicability.node_kinds?.length ? `Applicable node kinds: ${node.applicability.node_kinds.map((id) => `\`${id}\``).join(', ')}` : '',
      field?.unit ? `Unit: \`${field.unit}\`` : '', field?.compatibilityCode ? `Compatibility code: \`${field.compatibilityCode}\`` : '',
      field && Object.keys(field.constraints).length > 0 ? `Constraints: \`${JSON.stringify(field.constraints)}\`` : '', compatibility ? `Compatibility: ${compatibility.description}` : '',
    ].filter(Boolean).join('\n\n') + migration,
    qualifier: 'Node type', useWhen: `Use this when you need to add or configure a ${node.label} node.`, breadcrumb: ['Reference', 'Node types'], renderer: 'markdown',
    examples: node.examples, status: node.status, profile: contract.profile, fieldPaths: [node.field_path], referenceGroup: 'node-types',
    ...(field?.unit ? { unit: field.unit } : {}), ...(field?.compatibilityCode ? { compatibilityCode: field.compatibilityCode } : {}),
    ...(field ? { constraints: { ...field.constraints }, required: field.required } : {}), ...(field?.hasDefault ? { defaultValue: field.defaultValue } : {}),
    relatedTopicIds: contract.documentation.topics.filter((topic) => topic.field_paths.includes(node.field_path)).map((topic) => `contract:${topic.id}`),
  }
}

function fieldTopic(contract: AuthoringContract, field: FormField): DocumentationTopic {
  const compatibility = field.compatibilityCode ? contract.compatibility_codes[field.compatibilityCode] : compatibilityFor(contract, field.fieldPath)
  const defaultValue = field.hasDefault ? field.defaultValue : undefined
  const migration = compatibility?.migration ? `\n\nMigration: ${compatibility.migration}` : ''
  const referenceGroup = referenceGroupForField(field)
  return {
    id: `field:${field.id}`, kind: 'field', title: field.label, description: field.description,
    body: [
      `Purpose: ${field.description}`, `Type: \`${typeof field.schema.type === 'string' ? field.schema.type : 'contract-defined'}\``, `Required: ${field.required ? 'yes' : 'no'}`,
      `Default: ${field.hasDefault ? `\`${formatValue(defaultValue)}\`` : 'none'}`, `Profile: \`${contract.profile}\``, `Status: ${field.status}`,
      field.nodeKinds?.length ? `Applicable node kinds: ${field.nodeKinds.map((id) => `\`${id}\``).join(', ')}` : '', field.unit ? `Unit: \`${field.unit}\`` : '',
      field.compatibilityCode ? `Compatibility code: \`${field.compatibilityCode}\`` : '', Object.keys(field.constraints).length > 0 ? `Constraints: \`${JSON.stringify(field.constraints)}\`` : '',
      compatibility ? `Compatibility: ${compatibility.description}` : '', relatedTopics(contract, field).length > 0 ? `Related topics: ${relatedTopics(contract, field).join(', ')}` : '',
    ].filter(Boolean).join('\n\n') + migration,
    qualifier: qualifierForField(contract, field), useWhen: `Use this when you need to configure ${field.label}.`,
    breadcrumb: ['Reference', referenceGroupLabel(referenceGroup)], renderer: 'markdown', examples: field.examples, status: field.status,
    profile: contract.profile, fieldPaths: [field.fieldPath], referenceGroup, ...(field.nodeKinds ? { nodeKinds: field.nodeKinds } : {}),
    ...(field.unit ? { unit: field.unit } : {}), ...(field.compatibilityCode ? { compatibilityCode: field.compatibilityCode } : {}), constraints: { ...field.constraints },
    relatedTopicIds: relatedTopics(contract, field), required: field.required, ...(field.hasDefault ? { defaultValue } : {}),
  }
}

function contractTopic(contract: AuthoringContract, topic: AuthoringContract['documentation']['topics'][number]): DocumentationTopic {
  return {
    id: `contract:${topic.id}`, kind: 'contract', title: topic.title, description: topic.description, body: topic.body,
    qualifier: 'Language contract', useWhen: 'Use this when you need language-level workflow guidance.', breadcrumb: ['Reference', 'Language contract'], renderer: 'markdown',
    examples: topic.examples, status: 'supported', profile: contract.profile, fieldPaths: topic.field_paths, referenceGroup: 'language-contract',
  }
}

function guideTopic(contract: AuthoringContract, guide: DocumentationGuide): DocumentationTopic {
  const presentation = GUIDE_PRESENTATION[guide.id]
  const group = presentation?.group ?? guide.group
  const useWhen = presentation?.useWhen ?? guide.useWhen
  const renderer = presentation?.renderer ?? guide.renderer ?? 'markdown'
  return {
    id: `guide:${guide.id}`, kind: 'guide', title: guide.title, description: guide.description ?? firstSentence(guide.body), body: guide.body,
    qualifier: 'Guide', useWhen, breadcrumb: ['Guides', guideGroupLabel(group)], renderer, examples: [], status: 'supported', profile: contract.profile,
    fieldPaths: [], guideGroup: group,
  }
}

function qualifierForField(contract: AuthoringContract, field: FormField): string {
  if (field.nodeKinds?.length === 1) return `${contract.node_kinds.find(({ id }) => id === field.nodeKinds![0])?.label ?? field.nodeKinds[0]} node`
  if (field.document === 'companion') return 'Companion policy'
  return field.fieldPath.startsWith('nodes[]') ? 'Common node setting' : 'Workflow'
}

function referenceGroupForField(field: FormField): ReferenceGroupId {
  if (field.document === 'companion') return 'companion-policy'
  if (!field.fieldPath.startsWith('nodes[]')) return 'workflow-fields'
  if ((field.nodeKinds?.length ?? 0) > 1) return 'common-node-settings'
  return 'node-specific-fields'
}

function assignRepeatedFieldGroups(topics: readonly DocumentationTopic[]): readonly DocumentationTopic[] {
  const grouped = new Map<string, DocumentationTopic[]>()
  for (const topic of topics) {
    if (topic.kind !== 'field' || !topic.fieldPaths[0]?.startsWith('nodes[]')) continue
    const key = `${normalize(topic.title)}\0${normalize(topic.fieldPaths[0])}`
    const values = grouped.get(key) ?? []
    values.push(topic)
    grouped.set(key, values)
  }
  const common = new Set([...grouped].filter(([, values]) => new Set(values.flatMap(({ nodeKinds }) => nodeKinds ?? [])).size > 1).map(([key]) => key))
  return topics.map((topic) => {
    if (topic.kind !== 'field') return topic
    const key = `${normalize(topic.title)}\0${normalize(topic.fieldPaths[0] ?? '')}`
    return common.has(key) ? { ...topic, referenceGroup: 'common-node-settings' as const, breadcrumb: ['Reference', 'Common node settings'] } : topic
  })
}

function groupTopics<Key extends GuideGroupId | ReferenceGroupId>(topics: readonly DocumentationTopic[], keys: readonly Key[], property: 'guideGroup' | 'referenceGroup'): ReadonlyMap<Key, readonly DocumentationTopic[]> {
  return new Map(keys.map((key) => [key, topics.filter((topic) => topic[property] === key).sort(compareTopics)]))
}

function duplicateGroups(topics: readonly DocumentationTopic[]): ReadonlyMap<string, readonly DocumentationTopic[]> {
  const groups = new Map<string, DocumentationTopic[]>()
  for (const topic of topics) {
    const key = normalize(topic.title)
    const values = groups.get(key) ?? []
    values.push(topic)
    groups.set(key, values)
  }
  return new Map([...groups].filter(([, values]) => values.length > 1).map(([key, values]) => [key, values.sort(compareTopics)]))
}

function matchesMode(topic: DocumentationTopic, options: DocumentationSearchOptions): boolean {
  if (options.mode === 'all') return true
  if (options.mode === 'guides') return topic.kind === 'guide'
  if (options.mode === 'reference' && topic.kind === 'guide') return false
  return !options.referenceGroup || topic.referenceGroup === options.referenceGroup
}

function relatedTopics(contract: AuthoringContract, field: FormField): readonly string[] {
  return [...(field.nodeKinds?.map((nodeKind) => `node:${nodeKind}`) ?? []), ...contract.documentation.topics.filter((topic) => topic.field_paths.includes(field.fieldPath)).map((topic) => `contract:${topic.id}`)]
}

function compatibilityFor(contract: AuthoringContract, fieldPath: string): ContractCompatibility | undefined {
  return Object.values(contract.compatibility_codes as Readonly<Record<string, ContractCompatibility>>).find((item) => item.fields?.includes(fieldPath))
}

function scoreTopic(topic: DocumentationTopic, queryTokens: readonly string[], text: string): number {
  if (queryTokens.length === 0) return 0
  const title = normalize(topic.title), qualifier = normalize(topic.qualifier), identifier = normalize(topic.id), query = queryTokens.join(' ')
  let score = `${title} ${qualifier}` === query || identifier === query ? 1_000 : 0
  for (const token of queryTokens) {
    if (!text.includes(token)) return -1
    if (title === token) score += 500
    else if (identifier === token || identifier.endsWith(`:${token}`)) score += 450
    else if (title.startsWith(token) || qualifier.startsWith(token)) score += 200
    else if (title.includes(token) || qualifier.includes(token) || identifier.includes(token)) score += 100
    else score += 10
  }
  return score
}

function candidateIds(index: DocumentationIndex, queryTokens: readonly string[]): ReadonlySet<string> {
  if (queryTokens.length === 0) return new Set(index.topics.map(({ id }) => id))
  let candidates: Set<string> | undefined
  for (const queryToken of queryTokens) {
    const matching = new Set<string>()
    for (const [token, ids] of index.tokenIndex) if (token.includes(queryToken)) for (const id of ids) matching.add(id)
    candidates = candidates ? new Set([...candidates].filter((id) => matching.has(id))) : matching
  }
  return candidates ?? new Set()
}

function topicSearchText(topic: DocumentationTopic): string {
  return [topic.title, topic.id, topic.qualifier, topic.useWhen, topic.breadcrumb.join(' '), topic.description, topic.body, topic.fieldPaths.join(' '), topic.nodeKinds?.join(' ') ?? '', topic.guideGroup ?? '', topic.referenceGroup ?? ''].join(' ')
}

function compareTopics(left: DocumentationTopic, right: DocumentationTopic): number {
  return left.title.localeCompare(right.title) || left.qualifier.localeCompare(right.qualifier) || left.id.localeCompare(right.id)
}
function referenceGroupLabel(group: ReferenceGroupId): string { return group.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function guideGroupLabel(group: GuideGroupId): string { return GUIDE_GROUPS.find(({ id }) => id === group)?.title ?? group }
function tokenize(value: string): readonly string[] { return normalize(value).split(/[^a-z0-9]+/).filter(Boolean) }
function normalize(value: string): string { return value.toLocaleLowerCase('en-US') }
function formatValue(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value) }
function firstSentence(markdown: string): string { return markdown.replace(/^#+\s*/gm, '').split(/[.!?]\s/)[0]?.trim() || 'Offline authoring guide.' }
