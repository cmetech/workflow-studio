import { isAlias, isMap, isScalar, isSeq, Scalar, stringify, Document, type YAMLMap, type YAMLSeq } from 'yaml'
import type { AuthoringContract, SemanticRuleDescriptor } from '$src/lib/contract/types'
import type { DocumentKind } from '$src/lib/documents/types'
import { projectWorkflow } from '$src/lib/projection/project-workflow'
import { buildReferenceIndex, prepareReferenceContract, type ReferenceIndex } from '$src/lib/references/reference-index'
import { readScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'
import { expandFieldPath } from '$src/lib/validation/scoped-dag-validator'
import { codePointToEditorOffset } from '$src/lib/references/unicode'
import { graphFields, resolveGraphScope, type GraphFields } from './graph-scope'
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
        | 'mutation_stale_scope'
      message: string
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
  referenceIndex?: ReferenceIndex,
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
    if (
      documentKind === 'definition' &&
      graphMutationPath(mutation.path, contract) &&
      pathCrossesSharedNode(document, mutation.path)
    )
      return ambiguousAlias()
    const aliasCrossing = aliasCrossingPath(document, mutation.path)
    if (aliasCrossing) {
      if (
        aliasCrossing.relativePath.length === 0 ||
        (documentKind === 'definition' && graphMutationPath(mutation.path, contract))
      ) {
        return ambiguousAlias()
      }
      return patchMaterializedAliasMapping(source, document, aliasCrossing, mutation, contract, documentKind)
    }
    if (!document.hasIn(mutation.path)) {
      if (mutation.type === 'set-field') {
        const parentPath = mutation.path.slice(0, -1)
        const key = mutation.path.at(-1)
        const parent = document.getIn(parentPath, true)
        if (isMap(parent) && typeof key === 'string') {
          if (parent.flow) {
            return verifiedPatch(
              applySourceEdits(source, [flowMappingInsertion(parent, key, mutation.value)]),
              contract,
              documentKind,
            )
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
      const scalarPatch = patchExistingScalarSourceRange(
        source,
        document,
        mutation.path,
        mutation.value,
        contract,
        documentKind,
      )
      if (scalarPatch) return scalarPatch
      const working = document.clone() as Document.Parsed
      setPreservingScalarStyle(working, mutation.path, mutation.value)
      return patchClonedPaths(source, document, working, [mutation.path], contract, documentKind)
    }
    const parentPath = mutation.path.slice(0, -1)
    const parent = document.getIn(parentPath, true)
    if (isMap(parent) && parent.flow) {
      const edits = flowMappingDeletion(parent, mutation.path.at(-1))
      return edits ? verifiedPatch(applySourceEdits(source, edits), contract, documentKind) : ambiguousAlias()
    }
    if (isSeq(parent)) {
      const working = document.clone() as Document.Parsed
      working.deleteIn(mutation.path)
      return patchClonedPaths(source, document, working, [parentPath], contract, documentKind)
    }
    const deletion = mappingEntryDeletion(source, document, mutation.path)
    return deletion
      ? verifiedPatch(applySourceEdits(source, [deletion]), contract, documentKind)
      : { ok: false, code: 'mutation_path_missing', message: 'The requested mapping field cannot be deleted.' }
  }

  const scope = resolveGraphScope(document, mutation.scopeKey, contract)
  if (!scope.ok) return scope
  const { fields, nodes } = scope
  if (
    contract.contract_reader_version === 3 &&
    (mutation.type === 'rename-node' || mutation.type === 'delete-node') &&
    !referenceIndex
  ) {
    let prepared
    try {
      prepared = prepareReferenceContract(contract)
    } catch {
      return { ok: false, code: 'mutation_contract_invalid', message: 'Reference capabilities are unavailable.' }
    }
    if (!prepared)
      return { ok: false, code: 'mutation_contract_invalid', message: 'Reference capabilities are unavailable.' }
    try {
      const projection = projectWorkflow(parsed.parsed, null, contract.profile, contract).projection
      referenceIndex = buildReferenceIndex(projection.definition, projection, prepared)
    } catch {
      return ambiguousAlias()
    }
  }

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
      return verifiedPatch(
        applySourceEdits(source, [flowItemInsertion(nodes, afterIndex, mutation.node)]),
        contract,
        'definition',
      )
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
    if (referenceIndex) {
      for (const occurrence of referenceIndex.occurrences) {
        const tokens = occurrence.references.filter(
          (token) =>
            token.resolvedProducer?.scopeKey === mutation.scopeKey && token.resolvedProducer.nodeId === mutation.from,
        )
        if (!tokens.length) continue
        if (pathCrossesSharedNode(document, occurrence.valuePath)) return ambiguousAlias()
        const scalar = document.getIn(occurrence.valuePath, true)
        if (!isScalar(scalar) || scalar.anchor || scalar.value !== occurrence.authoredText) return ambiguousAlias()
        const edits = tokens.map((token) => {
          const prefix = token.kind === 'previous' ? '$LOOP_PREV.' : '$'
          const start = codePointToEditorOffset(occurrence.authoredText, token.start + Array.from(prefix).length)
          return { start, end: start + token.producerId.length, text: mutation.to }
        })
        setPreservingScalarStyle(working, occurrence.valuePath, applySourceEdits(occurrence.authoredText, edits))
        paths.push(occurrence.valuePath)
      }
    } else {
      for (const reference of referenceScalarNodes(document, nodes, fields, contract)) {
        const rewritten = rewriteReferences(reference.scalar.value, reference.rule, mutation.from, mutation.to)
        if (rewritten === null) {
          return {
            ok: false,
            code: 'mutation_contract_invalid',
            message: `Reference rule "${reference.rule.id}" does not expose a safe node-ID capture span.`,
          }
        }
        if (rewritten === reference.scalar.value) continue
        const workingReference = working.getIn(reference.documentPath, true)
        if (isScalar(workingReference)) workingReference.value = rewritten
        paths.push(reference.documentPath)
      }
    }
    return patchClonedPaths(source, document, working, paths, contract, 'definition')
  }

  if (mutation.type === 'delete-node') {
    const index = nodeIndex(nodes, fields.idPath, mutation.nodeId)
    if (index === -1) return missingNode(mutation.nodeId)
    if (hasGraphAlias(document, nodes, fields, contract)) return ambiguousAlias()
    const references = referenceIndex
      ? referenceIndex.occurrences
          .filter(
            (occurrence) =>
              !(occurrence.scopeKey === mutation.scopeKey && occurrence.consumerId === mutation.nodeId) &&
              occurrence.references.some(
                (token) =>
                  token.resolvedProducer?.scopeKey === mutation.scopeKey &&
                  token.resolvedProducer.nodeId === mutation.nodeId,
              ),
          )
          .map((occurrence) => ({
            nodeId: occurrence.consumerId,
            fieldPath: occurrence.valuePath,
            value: occurrence.authoredText,
          }))
      : referenceScalarNodes(document, nodes, fields, contract)
          .filter(
            ({ nodeId, scalar, rule }) =>
              nodeId !== mutation.nodeId && findReferences(scalar.value, rule).includes(mutation.nodeId),
          )
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
    if (nodes.items.length === 1 && !nodes.flow) {
      const workingNodes = working.getIn(fields.nodesPath, true)
      if (!isSeq(workingNodes)) return ambiguousAlias()
      workingNodes.items = []
      return patchClonedPaths(source, document, working, [fields.nodesPath], contract, 'definition')
    }
    const dependencyEdits = clonedPathEdits(source, document, working, dependencyPaths, contract, 'definition')
    if (!dependencyEdits) return ambiguousAlias()
    const nodeEdits = nodes.flow ? flowItemDeletion(nodes, index) : [sequenceItemDeletion(source, nodes, index)]
    if (!nodeEdits) return ambiguousAlias()
    return verifiedPatch(applySourceEdits(source, [...dependencyEdits, ...nodeEdits]), contract, 'definition')
  }

  const index = nodeIndex(nodes, fields.idPath, mutation.nodeId)
  if (index === -1) return missingNode(mutation.nodeId)
  const path = [...fields.nodesPath, index, ...fields.dependenciesPath]
  if (pathCrossesSharedNode(document, path.slice(0, -1))) return ambiguousAlias()
  const existing = document.getIn(path, true)
  if (isAlias(existing)) return ambiguousAlias()
  const working = document.clone() as Document.Parsed
  const workingExisting = working.getIn(path, true)
  if (isSeq(existing)) {
    if (!isSeq(workingExisting)) return ambiguousAlias()
    const authored = new Map(workingExisting.items.filter(isScalar).map((scalar) => [scalar.value, scalar]))
    workingExisting.items = mutation.dependsOn.map(
      (dependency) => authored.get(dependency) ?? working.createNode(dependency),
    )
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
      node.flow
        ? flowMappingInsertion(node, fields.dependenciesPath[0] ?? '', mutation.dependsOn)
        : mappingEntryInsertion(source, node, fields.dependenciesPath[0] ?? '', mutation.dependsOn),
    ]),
    contract,
    'definition',
  )
}

export interface WorkflowPairSources {
  readonly definition: string
  readonly companion: string | null
}

/** Prepare both texts before the transaction performs its single proposed-pair analysis. */
export function patchWorkflowPair(
  sources: WorkflowPairSources,
  mutation: Exclude<WorkflowMutation, { type: 'replace-document' }>,
  contract: AuthoringContract,
  referenceIndex?: ReferenceIndex,
): { ok: true; texts: WorkflowPairSources } | Exclude<PatchWorkflowDocumentResult, { ok: true }> {
  const kind = 'document' in mutation ? mutation.document : 'definition'
  const source = sources[kind]
  if (source === null) return { ok: false, code: 'mutation_path_missing', message: 'The requested document is absent.' }
  const result = patchWorkflowDocument(source, mutation, contract, referenceIndex)
  if (!result.ok) return result
  let companion = kind === 'companion' ? result.text : sources.companion
  if (
    companion !== null &&
    (mutation.type === 'rename-node' || mutation.type === 'delete-node') &&
    contract.contract_reader_version === 3
  ) {
    const parsed = parseWorkflowYaml(companion, { document: 'companion', maxBytes: contract.limits.max_document_bytes })
    if (!parsed.parsed)
      return { ok: false, code: 'mutation_invalid_yaml', message: 'The companion YAML cannot be patched safely.' }
    const capabilities = readScopedDagCapabilities(contract)
    const descriptor = capabilities.referenceSemantics.companionNodePaths
    if (descriptor.format !== 'group/child')
      return { ok: false, code: 'mutation_contract_invalid', message: 'Unsupported companion node path format.' }
    const from = mutation.type === 'rename-node' ? mutation.from : mutation.nodeId
    const group = mutation.scopeKey === 'root' ? null : mutation.scopeKey.slice('loop-group:'.length)
    let value: unknown
    try {
      value = parsed.parsed.document.toJS({ maxAliasCount: 1_000 }) as unknown
    } catch {
      return ambiguousAlias()
    }
    for (const declared of descriptor.fieldPaths) {
      for (const occurrence of expandFieldPath(value, declared.startsWith('sidecar.') ? declared.slice(8) : declared)) {
        if (typeof occurrence.value !== 'string') continue
        const matches =
          group === null
            ? occurrence.value === from || occurrence.value.startsWith(`${from}/`)
            : occurrence.value === `${group}/${from}`
        if (!matches) continue
        if (mutation.type === 'delete-node')
          return {
            ok: false,
            code: 'mutation_requires_resolution',
            message: 'Companion node references must be resolved before deleting this node.',
            references: [{ nodeId: from, fieldPath: occurrence.path, value: occurrence.value }],
          }
        if (pathCrossesSharedNode(parsed.parsed.document, occurrence.path)) return ambiguousAlias()
        const scalar = parsed.parsed.document.getIn(occurrence.path, true)
        if (!isScalar(scalar) || scalar.anchor) return ambiguousAlias()
        const replacement =
          group === null ? mutation.to + occurrence.value.slice(from.length) : `${group}/${mutation.to}`
        const patch = patchWorkflowDocument(
          companion,
          { type: 'set-field', document: 'companion', path: occurrence.path, value: replacement },
          contract,
        )
        if (!patch.ok) return patch
        companion = patch.text
      }
    }
  }
  return { ok: true, texts: { definition: kind === 'definition' ? result.text : sources.definition, companion } }
}

interface SourceEdit {
  start: number
  end: number
  text: string
}

function patchExistingScalarSourceRange(
  source: string,
  document: Document.Parsed,
  path: readonly (string | number)[],
  value: unknown,
  contract: AuthoringContract,
  documentKind: DocumentKind,
): PatchWorkflowDocumentResult | null {
  const current = document.getIn(path, true)
  if (!isScalar(current) || !isScalarCompatible(value) || current.anchor || current.tag) return null
  const range = nodeRange(current)
  if (!range) return null
  const replacement = new Scalar(value)
  if (current.type !== undefined) replacement.type = current.type
  if (current.format !== undefined) replacement.format = current.format
  if (current.minFractionDigits !== undefined) replacement.minFractionDigits = current.minFractionDigits
  let rendered: string
  try {
    rendered = stringify(replacement, { lineWidth: 0 })
  } catch {
    return null
  }
  if (!rendered.endsWith('\n') || !sameScalarStyle(current.type, rendered)) return null
  const block = current.type === Scalar.BLOCK_LITERAL || current.type === Scalar.BLOCK_FOLDED
  const replacementText = block
    ? indentBlockScalar(rendered, blockContentIndentation(source, range))
    : rendered.slice(0, -1)
  const text = applySourceEdits(source, [{ start: range[0], end: range[1], text: replacementText }])
  const verified = parseWorkflowYaml(text, { document: documentKind, maxBytes: contract.limits.max_document_bytes })
  if (!verified.parsed) return null
  const patched = verified.parsed.document.getIn(path, true)
  return isScalar(patched) && Object.is(patched.value, value) ? { ok: true, text } : null
}

function sameScalarStyle(type: Scalar.Type | undefined, rendered: string): boolean {
  if (type === Scalar.QUOTE_SINGLE) return rendered.startsWith("'")
  if (type === Scalar.QUOTE_DOUBLE) return rendered.startsWith('"')
  if (type === Scalar.BLOCK_LITERAL) return rendered.startsWith('|')
  if (type === Scalar.BLOCK_FOLDED) return rendered.startsWith('>')
  return (
    !rendered.startsWith("'") && !rendered.startsWith('"') && !rendered.startsWith('|') && !rendered.startsWith('>')
  )
}

function blockContentIndentation(source: string, range: readonly [number, number, number]): string {
  const contentStart = source.indexOf('\n', range[0])
  if (contentStart !== -1 && contentStart < range[1]) {
    const content = source.slice(contentStart + 1, range[1])
    const match = content.match(/^([ \t]+)\S/m)
    if (match?.[1]) return match[1]
  }
  const linePrefix = source.slice(lineStart(source, range[0]), range[0])
  return `${linePrefix.match(/^[ \t]*/)?.[0] ?? ''}  `
}

function indentBlockScalar(rendered: string, indentation: string): string {
  return rendered
    .split('\n')
    .map((line, index, lines) =>
      index === 0 || (index === lines.length - 1 && line === '') ? line : `${indentation}${line}`,
    )
    .join('\n')
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
    let replacement = serialized.slice(after[0], after[1])
    if (source.slice(before[0], before[1]).endsWith('\n') && !replacement.endsWith('\n')) replacement += '\n'
    edits.push({ start: before[0], end: before[1], text: replacement })
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

function flowMappingInsertion(map: YAMLMap, key: string, value: unknown): SourceEdit {
  const document = new Document({ [key]: value })
  if (isMap(document.contents)) document.contents.flow = true
  const text = document.toString({ lineWidth: 0 }).trim().slice(1, -1).trim()
  const previous = nodeRange(map.items.at(-1)?.value) ?? nodeRange(map.items.at(-1)?.key)
  const start = previous?.[1] ?? nodeRange(map)![0] + 1
  return { start, end: start, text: previous ? `, ${text}` : text }
}

function flowMappingDeletion(map: YAMLMap, key: unknown): SourceEdit[] | null {
  const index = map.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === key)
  const pair = map.items[index]
  const start = nodeRange(pair?.key)
  const end = nodeRange(pair?.value) ?? start
  return start && end ? flowEntryDeletion(map, index, start[0], end[1]) : null
}

function flowItemInsertion(sequence: YAMLSeq, afterIndex: number, value: unknown): SourceEdit {
  const item = new Document(value)
  if (isMap(item.contents) || isSeq(item.contents)) item.contents.flow = true
  const text = item.toString({ lineWidth: 0 }).trimEnd()
  const previous = nodeRange(sequence.items[afterIndex])
  const start = previous?.[1] ?? nodeRange(sequence)![0] + 1
  return { start, end: start, text: previous ? `, ${text}` : text }
}

function flowItemDeletion(sequence: YAMLSeq, index: number): SourceEdit[] | null {
  const range = nodeRange(sequence.items[index])
  return range ? flowEntryDeletion(sequence, index, range[0], range[1]) : null
}

/** Commas are CST tokens, not characters that may occur inside surviving comments. */
function flowEntryDeletion(
  collection: YAMLMap | YAMLSeq,
  index: number,
  start: number,
  end: number,
): SourceEdit[] | null {
  const token = collection.srcToken
  if (token?.type !== 'flow-collection' || !token.items[index]) return null
  const separator = token.items[index > 0 ? index : 1]
  const comma = separator?.start.find((item) => item.type === 'comma')
  if (!comma) return collection.items.length === 1 ? [{ start, end, text: '' }] : null
  const previous = token.items[index > 0 ? index - 1 : index]
  const previousValue = previous?.value ?? previous?.key
  const trailing = previousValue && 'end' in previousValue ? (previousValue.end ?? []) : []
  const preserveTrivia = [...trailing, ...(separator?.start ?? [])].some(
    (item) => item.type === 'comment' || item.type === 'newline',
  )
  if (preserveTrivia) {
    return [
      { start, end, text: '' },
      { start: comma.offset, end: comma.offset + comma.source.length, text: '' },
    ]
  }
  const nextStart = separator?.key?.offset ?? separator?.value?.offset
  return [
    {
      start: index > 0 ? comma.offset : start,
      end: index > 0 ? end : (nextStart ?? comma.offset + comma.source.length),
      text: '',
    },
  ]
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
  if (!isAlias(node) && !isScalar(node) && !isMap(node) && !isSeq(node)) return null
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
  if (isSeq(current) && Array.isArray(value)) {
    const replacement = document.createNode(value)
    if (isSeq(replacement)) {
      current.items = replacement.items
      return
    }
  }
  if (isMap(current) && isRecord(value)) {
    const replacement = document.createNode(value)
    if (isMap(replacement)) {
      current.items = replacement.items
      return
    }
  }
  document.setIn(path, value)
}

function isScalarCompatible(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pathCrossesSharedNode(document: Document.Parsed, path: readonly (string | number)[]): boolean {
  for (let length = 1; length <= path.length; length++) {
    const node = document.getIn(path.slice(0, length), true)
    if (isAlias(node) || ((isMap(node) || isSeq(node) || isScalar(node)) && node.anchor)) return true
  }
  return false
}

interface AliasCrossing {
  readonly aliasPath: readonly (string | number)[]
  readonly relativePath: readonly (string | number)[]
}

function aliasCrossingPath(document: Document.Parsed, path: readonly (string | number)[]): AliasCrossing | null {
  for (let length = 1; length <= path.length; length += 1) {
    if (isAlias(document.getIn(path.slice(0, length), true))) {
      return { aliasPath: path.slice(0, length), relativePath: path.slice(length) }
    }
  }
  return null
}

function patchMaterializedAliasMapping(
  source: string,
  document: Document.Parsed,
  crossing: AliasCrossing,
  mutation: Extract<WorkflowMutation, { type: 'set-field' | 'delete-field' }>,
  contract: AuthoringContract,
  documentKind: DocumentKind,
): PatchWorkflowDocumentResult {
  const working = document.clone() as Document.Parsed
  const alias = working.getIn(crossing.aliasPath, true)
  if (!isAlias(alias) || !isMap(alias.resolve(working))) return ambiguousAlias()
  // Production YAML 1.2 does not enable merge keys. Resolve through the same
  // Document API used by normal parsing, then write an independent local map.
  let resolvedValue: unknown
  try {
    resolvedValue = valueAtPath(working.toJS({ maxAliasCount: 1_000 }), crossing.aliasPath)
  } catch {
    return ambiguousAlias()
  }
  if (!isRecord(resolvedValue)) return ambiguousAlias()
  const localMapping = working.createNode(resolvedValue)
  if (!isMap(localMapping)) return ambiguousAlias()
  if (mutation.type === 'set-field') {
    localMapping.setIn(crossing.relativePath, mutation.value)
  } else {
    if (!localMapping.hasIn(crossing.relativePath)) {
      return { ok: false, code: 'mutation_path_missing', message: 'The requested YAML path does not exist.' }
    }
    localMapping.deleteIn(crossing.relativePath)
  }
  working.setIn(crossing.aliasPath, localMapping)
  const edits = clonedPathEdits(source, document, working, [crossing.aliasPath], contract, documentKind)
  const edit = edits?.[0]
  if (!edit) return ambiguousAlias()
  const indentation = `${source.slice(lineStart(source, edit.start), edit.start).match(/^\s*/)?.[0] ?? ''}  `
  const replacement = reindentCollection(edit.text, indentation)
  return verifiedPatch(applySourceEdits(source, [{ ...edit, text: `\n${replacement}` }]), contract, documentKind)
}

function graphMutationPath(path: readonly (string | number)[], contract: AuthoringContract): boolean {
  const fields = graphFields(contract)
  return fields !== null && fields.nodesPath.every((segment, index) => path[index] === segment)
}

function valueAtPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') current = current[segment]
    else if (isRecord(current) && typeof segment === 'string') current = current[segment]
    else return undefined
  }
  return current
}

function reindentCollection(value: string, indentation: string): string {
  const lines = value.trimEnd().split('\n')
  const continuationIndents = lines
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.length - line.trimStart().length)
  const commonIndent = continuationIndents.length > 0 ? Math.min(...continuationIndents) : 0
  return lines.map((line, index) => `${indentation}${index === 0 ? line : line.slice(commonIndent)}`).join('\n')
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

function relativeNodePath(fieldPath: string, nodesPath: readonly (string | number)[]): string[] | null {
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

function rewriteReferences(value: string, rule: SemanticRuleDescriptor, from: string, to: string): string | null {
  const parser = referenceExpression(rule)
  if (!parser) return null
  const edits: SourceEdit[] = []
  parser.expression.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = parser.expression.exec(value)) !== null) {
    const capturedId = match[parser.captureGroup]
    const span = match.indices?.[parser.captureGroup]
    if (typeof capturedId !== 'string' || !span) return null
    if (capturedId === from) {
      edits.push({ start: span[0], end: span[1], text: to })
    }
    if (match[0].length === 0) parser.expression.lastIndex += 1
  }
  return applySourceEdits(value, edits)
}

function referenceExpression(rule: SemanticRuleDescriptor): { expression: RegExp; captureGroup: number } | null {
  const capture = rule.parameters.node_id_capture_group
  const captureGroup = typeof capture === 'number' && Number.isInteger(capture) && capture >= 1 ? capture : 1
  if (typeof rule.parameters.pattern === 'string') {
    try {
      const flags = referenceFlags(rule.parameters.pattern_flags)
      if (flags === null) return null
      return { expression: new RegExp(rule.parameters.pattern, flags), captureGroup }
    } catch {
      return null
    }
  }
  if (rule.parameters.syntax === '$ID.output(.path)*') {
    return {
      expression: new RegExp('\\$([A-Za-z_][A-Za-z0-9_-]*)\\.output(?:\\.[A-Za-z_][A-Za-z0-9_-]*)*', 'gd'),
      captureGroup: 1,
    }
  }
  return null
}

function referenceFlags(value: unknown): string | null {
  if (value !== undefined && typeof value !== 'string') return null
  const declared = value ?? ''
  if ([...declared].some((flag) => !'imsu'.includes(flag))) return null
  const combined = new Set(`gd${declared}`)
  return [...'dgimsu'].filter((flag) => combined.has(flag)).join('')
}

function missingNode(id: string): PatchWorkflowDocumentResult {
  return { ok: false, code: 'mutation_node_missing', message: `Node "${id}" does not exist.` }
}

function ambiguousAlias(): Exclude<PatchWorkflowDocumentResult, { ok: true }> {
  return {
    ok: false,
    code: 'mutation_ambiguous_alias',
    message: 'This edit targets alias-derived YAML whose mutation would be ambiguous.',
  }
}
