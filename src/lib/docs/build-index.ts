import type { AuthoringContract, CompatibilityDescriptor, NodeKindDescriptor } from '$src/lib/contract/types'
import { collectContractFields } from '$src/lib/forms/widget-registry'
import type { FormField } from '$src/lib/forms/types'
import type { DocumentationGuide, DocumentationIndex, DocumentationTopic, DocumentationTopicKind } from './types'

type ContractCompatibility = CompatibilityDescriptor & { readonly fields?: readonly string[] }

export function buildDocumentationIndex(
  contract: AuthoringContract,
  guides: readonly DocumentationGuide[] = [],
): DocumentationIndex {
  const topics = [
    ...contract.node_kinds.map((node) => nodeTopic(contract, node)),
    ...collectContractFields(contract).map((field) => fieldTopic(contract, field)),
    ...contract.documentation.topics.map((topic) => ({
      id: `contract:${topic.id}`,
      kind: 'contract' as const,
      title: topic.title,
      description: topic.description,
      body: topic.body,
      examples: topic.examples,
      status: 'supported' as const,
      profile: contract.profile,
      fieldPaths: topic.field_paths,
    })),
    ...contract.semantic_rules.map((rule) => ({
      id: rule.id,
      kind: 'contract' as const,
      title: rule.label,
      description: rule.description,
      body: rule.description,
      examples: rule.examples,
      status: rule.status,
      profile: contract.profile,
      fieldPaths: rule.field_paths,
    })),
    ...guides.map((guide) => ({
      id: `guide:${guide.id}`,
      kind: 'guide' as const,
      title: guide.title,
      description: guide.description ?? firstSentence(guide.body),
      body: guide.body,
      examples: [],
      status: 'supported' as const,
      profile: contract.profile,
      fieldPaths: [],
    })),
  ].sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))

  const searchText = new Map(topics.map((topic) => [topic.id, normalize(topicSearchText(topic))]))
  const tokenIndex = new Map<string, Set<string>>()
  for (const [id, text] of searchText) {
    for (const token of tokenize(text)) {
      const ids = tokenIndex.get(token) ?? new Set<string>()
      ids.add(id)
      tokenIndex.set(token, ids)
    }
  }
  return { topics, byId: new Map(topics.map((topic) => [topic.id, topic])), searchText, tokenIndex }
}

export function searchDocumentation(
  index: DocumentationIndex,
  query: string,
  kind?: DocumentationTopicKind | 'all',
): readonly DocumentationTopic[] {
  const queryTokens = tokenize(query)
  const candidates = candidateIds(index, queryTokens)
  return index.topics
    .filter((topic) => candidates.has(topic.id))
    .filter((topic) => !kind || kind === 'all' || topic.kind === kind)
    .map((topic) => ({ topic, score: scoreTopic(topic, queryTokens, index.searchText.get(topic.id) ?? '') }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score || left.topic.title.localeCompare(right.topic.title))
    .map(({ topic }) => topic)
}

function nodeTopic(contract: AuthoringContract, node: NodeKindDescriptor): DocumentationTopic {
  return {
    id: `node:${node.id}`,
    kind: 'node',
    title: node.label,
    description: node.description,
    body: [`Purpose: ${node.description}`, `Profile: \`${contract.profile}\``, `Status: ${node.status}`].join('\n\n'),
    examples: node.examples,
    status: node.status,
    profile: contract.profile,
    fieldPaths: [node.field_path],
  }
}

function fieldTopic(contract: AuthoringContract, field: FormField): DocumentationTopic {
  const compatibility = field.compatibilityCode
    ? contract.compatibility_codes[field.compatibilityCode]
    : compatibilityFor(contract, field.fieldPath)
  const defaultValue = field.hasDefault ? field.defaultValue : undefined
  const migration = compatibility?.migration ? `\n\nMigration: ${compatibility.migration}` : ''
  return {
    id: `field:${field.id}`,
    kind: 'field',
    title: field.label,
    description: field.description,
    body: [
      `Purpose: ${field.description}`,
      `Type: \`${typeof field.schema.type === 'string' ? field.schema.type : 'contract-defined'}\``,
      `Required: ${field.required ? 'yes' : 'no'}`,
      `Default: ${field.hasDefault ? `\`${formatValue(defaultValue)}\`` : 'none'}`,
      `Profile: \`${contract.profile}\``,
      `Status: ${field.status}`,
      field.nodeKinds?.length ? `Applicable node kinds: ${field.nodeKinds.map((id) => `\`${id}\``).join(', ')}` : '',
      field.unit ? `Unit: \`${field.unit}\`` : '',
      field.compatibilityCode ? `Compatibility code: \`${field.compatibilityCode}\`` : '',
      Object.keys(field.constraints).length > 0 ? `Constraints: \`${JSON.stringify(field.constraints)}\`` : '',
      compatibility ? `Compatibility: ${compatibility.description}` : '',
      relatedTopics(contract, field).length > 0 ? `Related topics: ${relatedTopics(contract, field).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n') + migration,
    examples: field.examples,
    status: field.status,
    profile: contract.profile,
    fieldPaths: [field.fieldPath],
    ...(field.nodeKinds ? { nodeKinds: field.nodeKinds } : {}),
    ...(field.unit ? { unit: field.unit } : {}),
    ...(field.compatibilityCode ? { compatibilityCode: field.compatibilityCode } : {}),
    constraints: { ...field.constraints },
    relatedTopicIds: relatedTopics(contract, field),
    required: field.required,
    ...(field.hasDefault ? { defaultValue } : {}),
  }
}

function relatedTopics(contract: AuthoringContract, field: FormField): readonly string[] {
  return [
    ...(field.nodeKinds?.map((nodeKind) => `node:${nodeKind}`) ?? []),
    ...contract.documentation.topics
      .filter((topic) => topic.field_paths.includes(field.fieldPath))
      .map((topic) => `contract:${topic.id}`),
  ]
}


function compatibilityFor(contract: AuthoringContract, fieldPath: string): ContractCompatibility | undefined {
  return Object.values(contract.compatibility_codes as Readonly<Record<string, ContractCompatibility>>).find((item) =>
    item.fields?.includes(fieldPath),
  )
}

function scoreTopic(topic: DocumentationTopic, queryTokens: readonly string[], body: string): number {
  if (queryTokens.length === 0) return 0
  const title = normalize(topic.title)
  const identifier = normalize(topic.id)
  let score = 0
  for (const token of queryTokens) {
    if (!title.includes(token) && !identifier.includes(token) && !body.includes(token)) return -1
    if (title === token || identifier.endsWith(`:${token}`)) score += 100
    else if (title.includes(token) || identifier.includes(token)) score += 40
    else score += 5
  }
  return score
}

function candidateIds(index: DocumentationIndex, queryTokens: readonly string[]): ReadonlySet<string> {
  if (queryTokens.length === 0) return new Set(index.topics.map(({ id }) => id))
  let candidates: Set<string> | undefined
  for (const queryToken of queryTokens) {
    const matching = new Set<string>()
    for (const [token, ids] of index.tokenIndex) {
      if (!token.includes(queryToken)) continue
      for (const id of ids) matching.add(id)
    }
    candidates = candidates ? new Set([...candidates].filter((id) => matching.has(id))) : matching
  }
  return candidates ?? new Set()
}

function topicSearchText(topic: DocumentationTopic): string {
  return `${topic.title} ${topic.id} ${topic.description} ${topic.body} ${topic.fieldPaths.join(' ')}`
}

function tokenize(value: string): readonly string[] {
  const normalized = normalize(value)
  return normalized.split(/[^a-z0-9]+/).filter(Boolean)
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('en-US')
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function firstSentence(markdown: string): string {
  return markdown.replace(/^#+\s*/gm, '').split(/[.!?]\s/)[0]?.trim() || 'Offline authoring guide.'
}
