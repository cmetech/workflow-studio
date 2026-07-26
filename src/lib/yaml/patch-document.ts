import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  stringify,
  type Document,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml'
import type { AuthoringContract, SemanticRuleDescriptor } from '$src/lib/contract/types'
import type { DocumentKind } from '$src/lib/documents/types'
import { parseWorkflowYaml } from './parse-document'
import type { WorkflowMutation } from './mutations'

export interface MutationReference {
  nodeId: string
  fieldPath: readonly (string | number)[]
  value: string
}

export type PatchWorkflowDocumentResult =
  | { ok: true; text: string }
  | {
      ok: false
      code: 'mutation_requires_resolution'
      message: string
      references: readonly MutationReference[]
    }
  | {
      ok: false
      code:
        | 'mutation_invalid_yaml'
        | 'mutation_path_missing'
        | 'mutation_node_missing'
        | 'mutation_duplicate_node_id'
        | 'mutation_ambiguous_alias'
        | 'mutation_contract_invalid'
      message: string
    }

interface GraphFields {
  nodesPath: readonly string[]
  idPath: readonly string[]
  dependenciesPath: readonly string[]
}

/**
 * Patch strategy: retained `yaml` Document nodes identify exact CST source ranges.
 * Replacement syntax is derived from a mutated clone, then only those ranges are
 * spliced into the original source from highest offset to lowest. Sequence and map
 * insertion/removal likewise use retained ranges. Whole-document serialization is
 * deliberately never returned because `yaml` normalizes untouched flow spacing.
 * Graph-shaping aliases are refused before a mutation because resolving and
 * serializing them could change multiple consumers.
 */
export function patchWorkflowDocument(
  source: string,
  mutation: Exclude<WorkflowMutation, { type: 'replace-document' }>,
  contract: AuthoringContract,
): PatchWorkflowDocumentResult {
  const documentKind: DocumentKind = 'document' in mutation ? mutation.document : 'definition'
  const parsed = parseWorkflowYaml(source, {
    document: documentKind,
    maxBytes: contract.limits.max_document_bytes,
  })
  if (!parsed.parsed) {
    return { ok: false, code: 'mutation_invalid_yaml', message: 'The YAML document cannot be patched safely.' }
  }

  const document = parsed.parsed.document
  if (mutation.type === 'set-field' || mutation.type === 'delete-field') {
    if (pathCrossesAlias(document, mutation.path)) return ambiguousAlias()
    if (!document.hasIn(mutation.path)) {
      if (mutation.type === 'set-field') {
        const parentPath = mutation.path.slice(0, -1)
        const key = mutation.path.at(-1)
        const parent = document.getIn(parentPath, true)
        if (isMap(parent) && typeof key === 'string') {
          if (parent.flow) {
            const working = document.clone() as Document.Parsed
            working.setIn(mutation.path, mutation.value)
            return patchClonedPaths(source, document, working, [parentPath], contract, documentKind)
          }
          return verifiedPatch(
            applySourceEdits(source, [mappingEntryInsertion(source, parent, key, mutation.value)]),
            contract,
            documentKind,
          )
        }
      }
      return { ok: false, code: 'mutation_path_missing', message: 'The requested YAML path does not exist.' }
    }
    if (mutation.type === 'set-field') {
      const working = document.clone() as Document.Parsed
      setPreservingScalarStyle(working, mutation.path, mutation.value)
      return patchClonedPaths(source, document, working, [mutation.path], contract, documentKind)
    }
    const parentPath = mutation.path.slice(0, -1)
    const parent = document.getIn(parentPath, true)
    if ((isMap(parent) && parent.flow) || isSeq(parent)) {
      const working = document.clone() as Document.Parsed
      working.deleteIn(mutation.path)
      return patchClonedPaths(source, document, working, [parentPath], contract, documentKind)
    }
    const deletion = mappingEntryDeletion(source, document, mutation.path)
    return deletion
      ? verifiedPatch(applySourceEdits(source, [deletion]), contract, documentKind)
      : { ok: false, code: 'mutation_path_missing', message: 'The requested mapping field cannot be deleted.' }
  }

  const fields = graphFields(contract)
  if (!fields) {
    return {
      ok: false,
      code: 'mutation_contract_invalid',
      message: 'The active contract does not publish usable graph field paths.',
    }
  }
  const nodes = document.getIn(fields.nodesPath, true)
  if (isAlias(nodes)) return ambiguousAlias()
  if (!isSeq(nodes)) {
    return { ok: false, code: 'mutation_path_missing', message: 'The contract node sequence does not exist.' }
  }
  if (nodes.items.some(isAlias)) return ambiguousAlias()

  if (mutation.type === 'add-node') {
    if (nodeIndex(nodes, fields.idPath, String(valueAtObjectPath(mutation.node, fields.idPath) ?? '')) !== -1) {
      return { ok: false, code: 'mutation_duplicate_node_id', message: 'The proposed node identifier already exists.' }
    }
    const afterIndex =
      mutation.afterNodeId === undefined
        ? nodes.items.length - 1
        : nodeIndex(nodes, fields.idPath, mutation.afterNodeId)
    if (mutation.afterNodeId !== undefined && afterIndex === -1) {
      return { ok: false, code: 'mutation_node_missing', message: 'The requested insertion node does not exist.' }
    }
    if (nodes.flow) {
      const working = document.clone() as Document.Parsed
      const workingNodes = working.getIn(fields.nodesPath, true)
      if (!isSeq(workingNodes)) return ambiguousAlias()
      workingNodes.items.splice(afterIndex + 1, 0, working.createNode(mutation.node))
      return patchClonedPaths(source, document, working, [fields.nodesPath], contract, 'definition')
    }
    const insertion = sequenceItemInsertion(source, nodes, afterIndex, mutation.node)
    return verifiedPatch(applySourceEdits(source, [insertion]), contract, 'definition')
  }

  if (mutation.type === 'rename-node') {
    const index = nodeIndex(nodes, fields.idPath, mutation.from)
    if (index === -1) return missingNode(mutation.from)
    if (nodeIndex(nodes, fields.idPath, mutation.to) !== -1) {
      return { ok: false, code: 'mutation_duplicate_node_id', message: 'The proposed node identifier already exists.' }
    }
    if (hasGraphAlias(document, nodes, fields, contract)) return ambiguousAlias()

    const idPath = [...fields.nodesPath, index, ...fields.idPath]
    const idNode = document.getIn(idPath, true)
    if (!isScalar(idNode)) return ambiguousAlias()
    const working = document.clone() as Document.Parsed
    const paths: (readonly (string | number)[])[] = [idPath]
    const workingId = working.getIn(idPath, true)
    if (!isScalar(workingId)) return ambiguousAlias()
    workingId.value = mutation.to
    for (const dependency of dependencyScalarPaths(document, nodes, fields, mutation.from)) {
      const workingDependency = working.getIn(dependency, true)
      if (isScalar(workingDependency)) workingDependency.value = mutation.to
      paths.push(dependency)
    }
    for (const reference of referenceScalarNodes(document, nodes, fields, contract)) {
      const rewritten = rewriteReferences(reference.scalar.value, reference.rule, mutation.from, mutation.to)
      if (rewritten === reference.scalar.value) continue
      const workingReference = working.getIn(reference.documentPath, true)
      if (isScalar(workingReference)) workingReference.value = rewritten
      paths.push(reference.documentPath)
    }
    return patchClonedPaths(source, document, working, paths, contract, 'definition')
  }

  if (mutation.type === 'delete-node') {
    const index = nodeIndex(nodes, fields.idPath, mutation.nodeId)
    if (index === -1) return missingNode(mutation.nodeId)
    if (hasGraphAlias(document, nodes, fields, contract)) return ambiguousAlias()
    const references = referenceScalarNodes(document, nodes, fields, contract)
      .filter(({ scalar, rule }) => findReferences(scalar.value, rule).includes(mutation.nodeId))
      .map(({ nodeId, fieldPath, scalar }) => ({ nodeId, fieldPath, value: scalar.value }))
    if (references.length > 0) {
      return {
        ok: false,
        code: 'mutation_requires_resolution',
        message: 'Recognized textual references must be resolved before deleting this node.',
        references,
      }
    }
    const dependencyPaths = dependencySequencePaths(document, nodes, fields, mutation.nodeId, index)
    const working = document.clone() as Document.Parsed
    for (const path of dependencyPaths) {
      const dependencies = working.getIn(path, true)
      if (isSeq(dependencies)) {
        dependencies.items = dependencies.items.filter(
          (dependency) => !(isScalar(dependency) && dependency.value === mutation.nodeId),
        )
      }
    }
    const dependencyEdits = clonedPathEdits(source, document, working, dependencyPaths, contract, 'definition')
    if (!dependencyEdits) return ambiguousAlias()
    const nodeEdit = sequenceItemDeletion(source, nodes, index)
    return verifiedPatch(applySourceEdits(source, [...dependencyEdits, nodeEdit]), contract, 'definition')
  }

  const index = nodeIndex(nodes, fields.idPath, mutation.nodeId)
  if (index === -1) return missingNode(mutation.nodeId)
  const path = [...fields.nodesPath, index, ...fields.dependenciesPath]
  if (pathCrossesAlias(document, path.slice(0, -1))) return ambiguousAlias()
  const existing = document.getIn(path, true)
  if (isAlias(existing)) return ambiguousAlias()
  const working = document.clone() as Document.Parsed
  const workingExisting = working.getIn(path, true)
  if (isSeq(existing)) {
    if (!isSeq(workingExisting)) return ambiguousAlias()
    workingExisting.items = mutation.dependsOn.map((dependency) => working.createNode(dependency))
    return patchClonedPaths(source, document, working, [path], contract, 'definition')
  }
  if (fields.dependenciesPath.length !== 1) {
    return {
      ok: false,
      code: 'mutation_path_missing',
      message: 'A nested dependency field must already exist before it can be patched safely.',
    }
  }
  const node = nodes.items[index]
  if (!isMap(node)) return ambiguousAlias()
  return verifiedPatch(
    applySourceEdits(source, [
      mappingEntryInsertion(source, node, fields.dependenciesPath[0] ?? '', mutation.dependsOn),
    ]),
    contract,
    'definition',
  )
}

interface SourceEdit {
  start: number
  end: number
  text: string
}

function patchClonedPaths(
  source: string,
  original: Document.Parsed,
  working: Document.Parsed,
  paths: readonly (readonly (string | number)[])[],
  contract: AuthoringContract,
  documentKind: DocumentKind,
): PatchWorkflowDocumentResult {
  const edits = clonedPathEdits(source, original, working, paths, contract, documentKind)
  return edits
    ? verifiedPatch(applySourceEdits(source, edits), contract, documentKind)
    : { ok: false, code: 'mutation_ambiguous_alias', message: 'The requested YAML node has no stable source range.' }
}

function verifiedPatch(
  text: string,
  contract: AuthoringContract,
  documentKind: DocumentKind,
): PatchWorkflowDocumentResult {
  const result = parseWorkflowYaml(text, { document: documentKind, maxBytes: contract.limits.max_document_bytes })
  return result.parsed
    ? { ok: true, text }
    : { ok: false, code: 'mutation_invalid_yaml', message: 'The proposed source patch did not produce valid YAML.' }
}

function clonedPathEdits(
  source: string,
  original: Document.Parsed,
  working: Document.Parsed,
  paths: readonly (readonly (string | number)[])[],
  contract: AuthoringContract,
  documentKind: DocumentKind,
): SourceEdit[] | null {
  const serialized = working.toString()
  const reparsed = parseWorkflowYaml(serialized, {
    document: documentKind,
    maxBytes: contract.limits.max_document_bytes,
  })
  if (!reparsed.parsed) return null
  const edits: SourceEdit[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    const key = JSON.stringify(path)
    if (seen.has(key)) continue
    seen.add(key)
    const before = nodeRange(original.getIn(path, true))
    const after = nodeRange(reparsed.parsed.document.getIn(path, true))
    if (!before || !after) return null
    edits.push({ start: before[0], end: before[1], text: serialized.slice(after[0], after[1]) })
  }
  return edits
}

function mappingEntryDeletion(
  source: string,
  document: Document.Parsed,
  path: readonly (string | number)[],
): SourceEdit | null {
  if (path.length === 0) return null
  const key = path.at(-1)
  const parent = document.getIn(path.slice(0, -1), true)
  if (!isMap(parent)) return null
  const pair = parent.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === key)
  if (!pair) return null
  const keyRange = nodeRange(pair.key)
  const valueRange = nodeRange(pair.value)
  if (!keyRange) return null
  return {
    start: lineStart(source, keyRange[0]),
    end: endOfLine(source, valueRange?.[2] ?? keyRange[2]),
    text: '',
  }
}

function mappingEntryInsertion(source: string, map: YAMLMap, key: string, value: unknown): SourceEdit {
  const mapRange = nodeRange(map)
  const continuationKeyRange = nodeRange(map.items[1]?.key)
  const firstKeyRange = nodeRange(map.items[0]?.key)
  if (!mapRange || !firstKeyRange) throw new TypeError('A mapping insertion requires a retained source range.')
  const keyRange = continuationKeyRange ?? firstKeyRange
  const prefix = source.slice(lineStart(source, keyRange[0]), keyRange[0])
  const indentation = prefix.includes('-') ? ' '.repeat(prefix.length) : prefix
  const rendered = indentLines(stringify({ [key]: value }), indentation)
  return { start: mapRange[2], end: mapRange[2], text: rendered }
}

function sequenceItemInsertion(source: string, sequence: YAMLSeq, afterIndex: number, value: unknown): SourceEdit {
  const firstRange = nodeRange(sequence.items[0])
  if (!firstRange) throw new TypeError('A sequence insertion requires a retained source range.')
  const firstLineStart = lineStart(source, firstRange[0])
  const prefix = source.slice(firstLineStart, firstRange[0])
  const marker = prefix.lastIndexOf('-')
  const indentation = marker === -1 ? prefix : prefix.slice(0, marker)
  const rendered = indentLines(stringify([value]), indentation)
  const insertion = afterIndex < 0 ? firstLineStart : (nodeRange(sequence.items[afterIndex])?.[2] ?? firstLineStart)
  return { start: insertion, end: insertion, text: rendered }
}

function sequenceItemDeletion(source: string, sequence: YAMLSeq, index: number): SourceEdit {
  const range = nodeRange(sequence.items[index])
  if (!range) throw new TypeError('A sequence deletion requires a retained source range.')
  return { start: lineStart(source, range[0]), end: endOfLine(source, range[2]), text: '' }
}

function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
  let result = source
  const descending = [...edits].sort((left, right) => right.start - left.start || right.end - left.end)
  let lowerBound = source.length
  for (const edit of descending) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > source.length || edit.end > lowerBound) {
      throw new RangeError('YAML source edits must be valid and non-overlapping.')
    }
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`
    lowerBound = edit.start
  }
  return result
}

function nodeRange(node: unknown): readonly [number, number, number] | null {
  if (!isScalar(node) && !isMap(node) && !isSeq(node)) return null
  const range = node.range
  return range && range.length === 3 ? range : null
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
}

function endOfLine(source: string, offset: number): number {
  if (offset > 0 && source[offset - 1] === '\n') return offset
  const newline = source.indexOf('\n', offset)
  return newline === -1 ? source.length : newline + 1
}

function indentLines(value: string, indentation: string): string {
  return value
    .split('\n')
    .map((line, index, lines) => (index === lines.length - 1 && line === '' ? '' : `${indentation}${line}`))
    .join('\n')
}

function valueAtObjectPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function dependencyScalarPaths(
  document: Document.Parsed,
  nodes: YAMLSeq,
  fields: GraphFields,
  dependencyId: string,
): (readonly (string | number)[])[] {
  const paths: (readonly (string | number)[])[] = []
  nodes.items.forEach((_node, nodeIndexValue) => {
    const sequencePath = [...fields.nodesPath, nodeIndexValue, ...fields.dependenciesPath]
    const dependencies = document.getIn(sequencePath, true)
    if (!isSeq(dependencies)) return
    dependencies.items.forEach((dependency, dependencyIndex) => {
      if (isScalar(dependency) && dependency.value === dependencyId) paths.push([...sequencePath, dependencyIndex])
    })
  })
  return paths
}

function dependencySequencePaths(
  document: Document.Parsed,
  nodes: YAMLSeq,
  fields: GraphFields,
  dependencyId: string,
  deletedNodeIndex: number,
): (readonly (string | number)[])[] {
  const paths: (readonly (string | number)[])[] = []
  nodes.items.forEach((_node, nodeIndexValue) => {
    if (nodeIndexValue === deletedNodeIndex) return
    const path = [...fields.nodesPath, nodeIndexValue, ...fields.dependenciesPath]
    const dependencies = document.getIn(path, true)
    if (isSeq(dependencies) && dependencies.items.some((item) => isScalar(item) && item.value === dependencyId)) {
      paths.push(path)
    }
  })
  return paths
}

function hasGraphAlias(
  document: Document.Parsed,
  nodes: YAMLSeq,
  fields: GraphFields,
  contract: AuthoringContract,
): boolean {
  for (let index = 0; index < nodes.items.length; index += 1) {
    const dependencies = document.getIn([...fields.nodesPath, index, ...fields.dependenciesPath], true)
    if (containsAlias(dependencies)) return true
    for (const rule of contract.semantic_rules) {
      if (!referenceRuleApplies(rule, contract.profile)) continue
      for (const fieldPath of rule.field_paths) {
        const relative = relativeNodePath(fieldPath, fields.nodesPath)
        if (relative && containsAlias(document.getIn([...fields.nodesPath, index, ...relative], true))) return true
      }
    }
  }
  return false
}

function containsAlias(node: unknown): boolean {
  if (isAlias(node)) return true
  if (isSeq(node)) return node.items.some(containsAlias)
  if (isMap(node)) return node.items.some((pair) => containsAlias(pair.key) || containsAlias(pair.value))
  return false
}

function graphFields(contract: AuthoringContract): GraphFields | null {
  const rule = contract.semantic_rules.find(
    (candidate) =>
      candidate.status !== 'deferred' &&
      candidate.applicability.profiles.includes(contract.profile) &&
      candidate.applicability.documents.includes('definition') &&
      typeof candidate.parameters.nodes_path === 'string' &&
      typeof candidate.parameters.id_field === 'string' &&
      typeof candidate.parameters.dependencies_field === 'string',
  )
  if (!rule) return null
  const nodesPath = parseFieldPath(rule.parameters.nodes_path)
  const idPath = parseFieldPath(rule.parameters.id_field)
  const dependenciesPath = parseFieldPath(rule.parameters.dependencies_field)
  return nodesPath && idPath && dependenciesPath ? { nodesPath, idPath, dependenciesPath } : null
}

function parseFieldPath(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.startsWith('/')) {
    return value
      .slice(1)
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  }
  return value.replaceAll('[]', '').replaceAll('[*]', '').split('.').filter(Boolean)
}

function nodeIndex(nodes: YAMLSeq, idPath: readonly string[], id: string): number {
  return nodes.items.findIndex((node) => isMap(node) && nodeValueAtPath(node, idPath) === id)
}

function nodeValueAtPath(node: YAMLMap, path: readonly string[]): unknown {
  return node.getIn(path, false)
}

function setPreservingScalarStyle(document: Document.Parsed, path: readonly (string | number)[], value: unknown): void {
  const current = document.getIn(path, true)
  if (isScalar(current) && isScalarCompatible(value)) {
    current.value = value
    return
  }
  document.setIn(path, value)
}

function isScalarCompatible(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function pathCrossesAlias(document: Document.Parsed, path: readonly (string | number)[]): boolean {
  for (let length = 1; length <= path.length; length += 1) {
    if (isAlias(document.getIn(path.slice(0, length), true))) return true
  }
  return false
}

interface ReferenceScalar {
  nodeId: string
  fieldPath: readonly (string | number)[]
  documentPath: readonly (string | number)[]
  scalar: Scalar<string>
  rule: SemanticRuleDescriptor
}

function referenceScalarNodes(
  document: Document.Parsed,
  nodes: YAMLSeq,
  fields: GraphFields,
  contract: AuthoringContract,
): ReferenceScalar[] {
  const references: ReferenceScalar[] = []
  nodes.items.forEach((node, index) => {
    if (!isMap(node)) return
    const nodeId = String(nodeValueAtPath(node, fields.idPath) ?? '')
    const nodeKind = selectedNodeKind(node, fields, contract)
    for (const rule of contract.semantic_rules) {
      if (!referenceRuleApplies(rule, contract.profile)) continue
      if (rule.applicability.node_kinds && (!nodeKind || !rule.applicability.node_kinds.includes(nodeKind))) continue
      for (const contractPath of rule.field_paths) {
        const relative = relativeNodePath(contractPath, fields.nodesPath)
        if (!relative) continue
        const rootPath = [...fields.nodesPath, index, ...relative]
        collectStringScalars(document.getIn(rootPath, true), relative, (fieldPath, scalar) => {
          const suffix = fieldPath.slice(relative.length)
          references.push({ nodeId, fieldPath, documentPath: [...rootPath, ...suffix], scalar, rule })
        })
      }
    }
  })
  return references
}

function selectedNodeKind(node: YAMLMap, fields: GraphFields, contract: AuthoringContract): string | null {
  const matches = contract.node_kinds.filter((descriptor) => {
    if (
      !descriptor.applicability.profiles.includes(contract.profile) ||
      !descriptor.applicability.documents.includes('definition')
    ) {
      return false
    }
    const path = relativeNodePath(descriptor.field_path, fields.nodesPath)
    return path !== null && node.hasIn(path)
  })
  return matches.length === 1 ? (matches[0]?.id ?? null) : null
}

function referenceRuleApplies(rule: SemanticRuleDescriptor, profile: AuthoringContract['profile']): boolean {
  return (
    rule.status !== 'deferred' &&
    rule.applicability.profiles.includes(profile) &&
    rule.applicability.documents.includes('definition') &&
    (typeof rule.parameters.pattern === 'string' || rule.parameters.syntax === '$ID.output(.path)*')
  )
}

function relativeNodePath(fieldPath: string, nodesPath: readonly string[]): string[] | null {
  const tokens = fieldPath.replaceAll('[]', '').replaceAll('[*]', '').split('.').filter(Boolean)
  if (tokens.length <= nodesPath.length || !nodesPath.every((segment, index) => tokens[index] === segment)) return null
  return tokens.slice(nodesPath.length)
}

function collectStringScalars(
  node: unknown,
  fieldPath: readonly (string | number)[],
  collect: (path: readonly (string | number)[], scalar: Scalar<string>) => void,
): void {
  if (isAlias(node)) return
  if (isScalar(node)) {
    if (typeof node.value === 'string') collect(fieldPath, node as Scalar<string>)
    return
  }
  if (isSeq(node)) {
    node.items.forEach((child, index) => collectStringScalars(child, [...fieldPath, index], collect))
    return
  }
  if (isMap(node)) {
    node.items.forEach((pair) => {
      if (isScalar(pair.key) && typeof pair.key.value === 'string') {
        collectStringScalars(pair.value, [...fieldPath, pair.key.value], collect)
      }
    })
  }
}

function findReferences(value: string, rule: SemanticRuleDescriptor): string[] {
  const parser = referenceExpression(rule)
  if (!parser) return []
  const references: string[] = []
  let match: RegExpExecArray | null
  while ((match = parser.expression.exec(value)) !== null) {
    const id = match[parser.captureGroup]
    if (id) references.push(id)
    if (match[0].length === 0) parser.expression.lastIndex += 1
  }
  return references
}

function rewriteReferences(value: string, rule: SemanticRuleDescriptor, from: string, to: string): string {
  const parser = referenceExpression(rule)
  if (!parser) return value
  return value.replace(parser.expression, (...args: unknown[]) => {
    const match = String(args[0])
    const captures = args.slice(1, -2)
    const id = captures[parser.captureGroup - 1]
    if (id !== from) return match
    const relativeOffset = match.indexOf(from)
    return relativeOffset === -1
      ? match
      : `${match.slice(0, relativeOffset)}${to}${match.slice(relativeOffset + from.length)}`
  })
}

function referenceExpression(rule: SemanticRuleDescriptor): { expression: RegExp; captureGroup: number } | null {
  const capture = rule.parameters.node_id_capture_group
  const captureGroup = typeof capture === 'number' && Number.isInteger(capture) && capture >= 1 ? capture : 1
  if (typeof rule.parameters.pattern === 'string') {
    try {
      return { expression: new RegExp(rule.parameters.pattern, 'g'), captureGroup }
    } catch {
      return null
    }
  }
  if (rule.parameters.syntax === '$ID.output(.path)*') {
    return {
      expression: /\$([A-Za-z_][A-Za-z0-9_-]*)\.output(?:\.[A-Za-z_][A-Za-z0-9_-]*)*/g,
      captureGroup: 1,
    }
  }
  return null
}

function missingNode(id: string): PatchWorkflowDocumentResult {
  return { ok: false, code: 'mutation_node_missing', message: `Node "${id}" does not exist.` }
}

function ambiguousAlias(): PatchWorkflowDocumentResult {
  return {
    ok: false,
    code: 'mutation_ambiguous_alias',
    message: 'This edit targets alias-derived YAML whose mutation would be ambiguous.',
  }
}
