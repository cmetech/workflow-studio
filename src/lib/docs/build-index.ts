import type {
  AuthoringContract,
  CompatibilityDescriptor,
  FieldDescriptor,
  NodeKindDescriptor,
} from '$src/lib/contract/types'
import type { DocumentationGuide, DocumentationIndex, DocumentationTopic, DocumentationTopicKind } from './types'

type JsonSchema = Readonly<Record<string, unknown>>
type ContractCompatibility = CompatibilityDescriptor & { readonly fields?: readonly string[] }

export function buildDocumentationIndex(
  contract: AuthoringContract,
  guides: readonly DocumentationGuide[] = [],
): DocumentationIndex {
  const topics = [
    ...contract.node_kinds.map((node) => nodeTopic(contract, node)),
    ...contract.node_kinds.flatMap((node) => node.fields.map((field) => fieldTopic(contract, node, field))),
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

  return { topics, byId: new Map(topics.map((topic) => [topic.id, topic])) }
}

export function searchDocumentation(
  index: DocumentationIndex,
  query: string,
  kind?: DocumentationTopicKind | 'all',
): readonly DocumentationTopic[] {
  const queryTokens = tokenize(query)
  return index.topics
    .filter((topic) => !kind || kind === 'all' || topic.kind === kind)
    .map((topic) => ({ topic, score: scoreTopic(topic, queryTokens) }))
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

function fieldTopic(contract: AuthoringContract, node: NodeKindDescriptor, field: FieldDescriptor): DocumentationTopic {
  const schema = schemaForField(contract, node, field)
  const required = isRequired(contract, node, field)
  const compatibility = compatibilityFor(contract, field.field_path)
  const defaultValue = Object.hasOwn(schema, 'default') ? schema.default : undefined
  const migration = compatibility?.migration ? `\n\nMigration: ${compatibility.migration}` : ''
  return {
    id: `field:${field.id}`,
    kind: 'field',
    title: field.label,
    description: field.description,
    body: [
      `Purpose: ${field.description}`,
      `Type: \`${typeof schema.type === 'string' ? schema.type : 'contract-defined'}\``,
      `Required: ${required ? 'yes' : 'no'}`,
      `Default: ${Object.hasOwn(schema, 'default') ? `\`${formatValue(defaultValue)}\`` : 'none'}`,
      `Profile: \`${contract.profile}\``,
      `Status: ${field.status}`,
      compatibility ? `Compatibility: ${compatibility.description}` : '',
    ]
      .filter(Boolean)
      .join('\n\n') + migration,
    examples: field.examples,
    status: field.status,
    profile: contract.profile,
    fieldPaths: [field.field_path],
    required,
    ...(Object.hasOwn(schema, 'default') ? { defaultValue } : {}),
  }
}

function schemaForField(contract: AuthoringContract, node: NodeKindDescriptor, field: FieldDescriptor): JsonSchema {
  const path = field.field_path.replace(/^sidecar\./, '').split('.')
  let schema: JsonSchema = field.applicability.documents.includes('sidecar') ? contract.sidecar_schema : contract.definition_schema
  for (const segment of path) {
    if (segment === 'nodes[]') schema = asSchema(asSchema(asSchema(schema.properties).nodes).items)
    else if (segment === '*') schema = asSchema(schema.additionalProperties)
    else schema = propertySchema(schema, segment, node.id)
  }
  return schema
}

function propertySchema(schema: JsonSchema, key: string, nodeId: string): JsonSchema {
  const direct = asSchema(schema.properties)?.[key]
  if (direct) return asSchema(direct)
  const variant = asArray(schema.oneOf).find((candidate) => {
    const properties = asSchema(asSchema(candidate).properties)
    return Boolean(properties?.[key]) && asArray(asSchema(candidate).required).includes(nodeId)
  })
  return asSchema(asSchema(variant).properties)?.[key] ? asSchema(asSchema(asSchema(variant).properties)[key]) : {}
}

function isRequired(contract: AuthoringContract, node: NodeKindDescriptor, field: FieldDescriptor): boolean {
  const path = field.field_path.replace(/^sidecar\./, '').split('.')
  let schema: JsonSchema = field.applicability.documents.includes('sidecar') ? contract.sidecar_schema : contract.definition_schema
  for (const [index, segment] of path.entries()) {
    if (segment === 'nodes[]') {
      schema = asSchema(asSchema(asSchema(schema.properties).nodes).items)
      continue
    }
    if (segment === '*') {
      schema = asSchema(schema.additionalProperties)
      continue
    }
    const parent = schema
    const required = asArray(parent.required).includes(segment) ||
      (index === 1 && asArray(parent.oneOf).some((candidate) => {
        const item = asSchema(candidate)
        return asArray(item.required).includes(node.id) && asArray(item.required).includes(segment)
      }))
    schema = propertySchema(parent, segment, node.id)
    if (index === path.length - 1) return required
  }
  return false
}

function compatibilityFor(contract: AuthoringContract, fieldPath: string): ContractCompatibility | undefined {
  return Object.values(contract.compatibility_codes as Readonly<Record<string, ContractCompatibility>>).find((item) =>
    item.fields?.includes(fieldPath),
  )
}

function scoreTopic(topic: DocumentationTopic, queryTokens: readonly string[]): number {
  if (queryTokens.length === 0) return 0
  const title = normalize(topic.title)
  const identifier = normalize(topic.id)
  const body = normalize(`${topic.description} ${topic.body} ${topic.fieldPaths.join(' ')}`)
  let score = 0
  for (const token of queryTokens) {
    if (!title.includes(token) && !identifier.includes(token) && !body.includes(token)) return -1
    if (title === token || identifier.endsWith(`:${token}`)) score += 100
    else if (title.includes(token) || identifier.includes(token)) score += 40
    else score += 5
  }
  return score
}

function tokenize(value: string): readonly string[] {
  const normalized = normalize(value)
  return normalized.split(/[^a-z0-9]+/).filter(Boolean)
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('en-US')
}

function asSchema(value: unknown): JsonSchema {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonSchema) : {}
}

function asArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function firstSentence(markdown: string): string {
  return markdown.replace(/^#+\s*/gm, '').split(/[.!?]\s/)[0]?.trim() || 'Offline authoring guide.'
}
