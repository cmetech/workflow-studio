import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
import { recordEditorMetric } from '$src/lib/metrics/editor-metrics'
import type { DocumentAnalysis, ValidationIssue } from '$src/lib/documents/types'
import { projectWorkflow } from '$src/lib/projection/project-workflow'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import type { AnalyzeDocumentRequest } from '$src/workers/document-worker-protocol'
import { validateDag } from './dag-validator'
import { resolveContractSchema, validateContractDocument } from './schema-validator'

export async function analyzeWorkflowPair(
  request: AnalyzeDocumentRequest,
  contract: AuthoringContract,
): Promise<DocumentAnalysis> {
  recordEditorMetric('validationPasses')
  const identity = {
    workflowId: request.workflowId,
    pairGeneration: request.pairGeneration,
    definitionPath: request.definition.path,
    companionPath: request.companion?.path ?? null,
    definitionRevision: request.definition.revision,
    companionRevision: request.companion?.revision ?? null,
    contractDigest: request.contractDigest,
  }
  const definitionResult = parseWorkflowYaml(request.definition.text, {
    document: 'definition',
    maxBytes: contract.limits.max_document_bytes,
  })
  const companionResult = request.companion
    ? parseWorkflowYaml(request.companion.text, {
        document: 'companion',
        maxBytes: contract.limits.max_document_bytes,
      })
    : null
  const issues: ValidationIssue[] = [...definitionResult.issues, ...(companionResult?.issues ?? [])]

  if (!definitionResult.parsed || (companionResult && !companionResult.parsed)) {
    return { ...identity, issues, structurallyValid: false }
  }

  try {
    issues.push(...validateContractDocument(definitionResult.parsed, 'definition', contract))
    if (companionResult?.parsed) {
      issues.push(...validateContractDocument(companionResult.parsed, 'companion', contract))
    }
  } catch {
    issues.push({
      code: 'contract_schema_invalid',
      layer: 'contract',
      severity: 'error',
      blocking: true,
      message: 'The registered authoring contract contains a schema the editor cannot compile.',
      document: 'definition',
    })
    return { ...identity, issues, structurallyValid: false }
  }

  const profileSelection = selectWorkflowProfile(companionResult?.parsed?.document.toJS({ maxAliasCount: 1_000 }))
  if (!profileSelection.recognized || profileSelection.profile !== contract.profile) {
    const selectedProfile = profileSelection.recognized
      ? profileSelection.profile
      : String(profileSelection.explicitValue)
    issues.push({
      code: 'contract_profile_mismatch',
      layer: 'contract',
      severity: 'error',
      blocking: true,
      message: `Workflow profile "${selectedProfile}" does not match registered contract profile "${contract.profile}".`,
      document: request.companion ? 'companion' : 'definition',
      path: request.companion ? '/language_compatibility' : '/',
      ...(request.companion ? { field: 'language_compatibility' } : {}),
    })
  }

  if (hasBlockingIssue(issues)) {
    if (!profileSelection.recognized || profileSelection.profile !== contract.profile) {
      return { ...identity, issues, structurallyValid: false }
    }
    const definition = definitionResult.parsed.document.toJS({ maxAliasCount: 1_000 })
    if (!draftIssuesAreVisuallyAuthorable(issues, definition, contract)) {
      return { ...identity, issues, structurallyValid: false }
    }

    const draftProjection = projectWorkflow(
      definitionResult.parsed,
      companionResult?.parsed ?? null,
      profileSelection.profile,
      contract,
    )
    const draftIssues = [...draftProjection.issues]
    if (!hasBlockingIssue(draftIssues)) {
      draftIssues.push(...validateDag(draftProjection.projection, contract.semantic_rules).issues)
    }
    if (hasBlockingIssue(draftIssues)) return { ...identity, issues, structurallyValid: false }
    return {
      ...identity,
      issues: [...issues, ...draftIssues.filter((issue) => !issues.some((existing) => sameIssue(existing, issue)))],
      structurallyValid: false,
      visuallyAuthorable: true,
      projection: draftProjection.projection,
    }
  }

  const projected = projectWorkflow(
    definitionResult.parsed,
    companionResult?.parsed ?? null,
    profileSelection.profile,
    contract,
  )
  issues.push(...projected.issues)
  if (!hasBlockingIssue(issues)) {
    issues.push(...validateDag(projected.projection, contract.semantic_rules).issues)
  }

  const structurallyValid = !hasBlockingIssue(issues)
  return {
    ...identity,
    issues,
    structurallyValid,
    ...(structurallyValid ? { projection: projected.projection } : {}),
  }
}

interface WorkflowProfileSelection {
  profile: WorkflowProfile
  recognized: boolean
  explicitValue?: unknown
}

function selectWorkflowProfile(companionValue: unknown): WorkflowProfileSelection {
  if (!isRecord(companionValue) || !Object.hasOwn(companionValue, 'language_compatibility')) {
    return { profile: 'hermes-legacy', recognized: true }
  }

  const explicitValue = companionValue.language_compatibility
  if (explicitValue === 'hermes-legacy' || explicitValue === 'archon-2026-07') {
    return { profile: explicitValue, recognized: true, explicitValue }
  }
  return { profile: 'hermes-legacy', recognized: false, explicitValue }
}

function hasBlockingIssue(issues: readonly ValidationIssue[]): boolean {
  return issues.some(
    (issue) => issue.blocking && (issue.layer === 'syntax' || issue.layer === 'contract' || issue.layer === 'semantic'),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function draftIssuesAreVisuallyAuthorable(
  issues: readonly ValidationIssue[],
  definition: unknown,
  contract: AuthoringContract,
): boolean {
  // Draft authorability is not a second validation mode. The strict contract
  // remains authoritative; this only recognizes its narrow, expected errors
  // for one explicitly present node-kind descriptor before projection/DAG checks.
  const descriptorPaths = contract.node_kinds
    .map(({ field_path }) => descriptorPath(field_path))
    .filter((path): path is DescriptorPath => path !== null)
  const nodesPath = descriptorPaths[0]?.nodesPath
  if (!nodesPath || descriptorPaths.some((candidate) => !samePath(candidate.nodesPath, nodesPath))) return false
  const nodes = valueAtPath(definition, nodesPath)
  if (!Array.isArray(nodes)) return false
  const draftNodes = new Map<number, DraftNode>()
  for (const [index, node] of nodes.entries()) {
    if (!isRecord(node)) continue
    const present = descriptorPaths.filter(({ relativePath }) => valueAtOwnPath(node, relativePath) !== undefined)
    if (present.length !== 1) continue
    const descriptor = present[0]
    if (!descriptor) continue
    const itemSchema = schemaAtPath(
      contract.definition_schema,
      descriptor.schemaTokens.slice(0, descriptor.sequenceIndex + 1),
    )
    if (!itemSchema || (itemSchema.oneOf !== undefined && !Array.isArray(itemSchema.oneOf))) return false
    const branches: Record<string, unknown>[] = []
    for (const branch of Array.isArray(itemSchema.oneOf) ? itemSchema.oneOf : []) {
      const resolved = resolveContractSchema(branch, contract.definition_schema)
      if (!resolved) return false
      branches.push(resolved)
    }
    const kindField = descriptor.relativePath[0]
    const intendedBranch = branches.find(
      (branch) =>
        Array.isArray(branch.required) && typeof kindField === 'string' && branch.required.includes(kindField),
    )
    draftNodes.set(index, { node, descriptor, intendedBranch })
  }
  if (draftNodes.size === 0) return false

  return issues
    .filter((issue) => issue.blocking)
    .every((issue) => draftIssueIsPermitted(issue, draftNodes, descriptorPaths, nodesPath, contract))
}

interface DescriptorPath {
  readonly nodesPath: readonly string[]
  readonly relativePath: readonly string[]
  readonly schemaTokens: readonly { readonly key: string; readonly sequence: boolean }[]
  readonly sequenceIndex: number
}

interface DraftNode {
  readonly node: Record<string, unknown>
  readonly descriptor: DescriptorPath
  readonly intendedBranch: Record<string, unknown> | undefined
}

function descriptorPath(fieldPath: string): DescriptorPath | null {
  const schemaTokens = fieldPath
    .split('.')
    .filter(Boolean)
    .map((token) => ({ key: token.replace(/\[\]$/, ''), sequence: token.endsWith('[]') }))
  const sequenceIndex = schemaTokens.findIndex(({ sequence }) => sequence)
  if (sequenceIndex < 0 || sequenceIndex === schemaTokens.length - 1) return null
  return {
    nodesPath: schemaTokens.slice(0, sequenceIndex + 1).map(({ key }) => key),
    relativePath: schemaTokens.slice(sequenceIndex + 1).map(({ key }) => key),
    schemaTokens,
    sequenceIndex,
  }
}

function draftIssueIsPermitted(
  issue: ValidationIssue,
  draftNodes: ReadonlyMap<number, DraftNode>,
  descriptors: readonly DescriptorPath[],
  nodesPath: readonly string[],
  contract: AuthoringContract,
): boolean {
  if (issue.layer !== 'contract' || issue.document !== 'definition' || !issue.path) return false
  const path = pointerTokens(issue.path)
  if (!startsWithPath(path, nodesPath) || typeof path[nodesPath.length] !== 'number') return false
  const index = path[nodesPath.length] as number
  const draft = draftNodes.get(index)
  if (!draft) return false
  const relative = path.slice(nodesPath.length + 1)
  const kindFields = new Set(descriptors.map(({ relativePath }) => relativePath[0]).filter(isString))
  const selectedKind = draft.descriptor.relativePath[0]

  if (issue.code === 'schema_one_of') {
    return relative.length === 0 && intendedBranchAcceptsPresentKeys(draft)
  }
  if (issue.code === 'schema_additional_properties') {
    // Ajv reports the selected kind as additional in each non-selected oneOf branch.
    return Boolean(draft.intendedBranch && samePath(relative, draft.descriptor.relativePath))
  }
  if (issue.code === 'schema_min_length') {
    return (
      startsWithPath(relative, draft.descriptor.relativePath) &&
      valueAtOwnPath(draft.node, relative) === '' &&
      schemaAtValuePath(contract.definition_schema, [...nodesPath, index, ...relative]) !== null
    )
  }
  if (issue.code !== 'schema_required') return false
  if (relative.length === 0) return false
  if (
    startsWithPath(relative, draft.descriptor.relativePath) &&
    relative.length > draft.descriptor.relativePath.length
  ) {
    return schemaAtValuePath(contract.definition_schema, [...nodesPath, index, ...relative]) !== null
  }
  if (relative.length !== 1 || typeof relative[0] !== 'string' || relative[0] === graphIdField(contract)) {
    return false
  }
  // Required-kind errors from non-selected oneOf branches are branch noise;
  // required fields from the selected branch remain progressively fillable.
  if (draft.intendedBranch && kindFields.has(relative[0]) && relative[0] !== selectedKind) return true
  return Array.isArray(draft.intendedBranch?.required) && draft.intendedBranch.required.includes(relative[0])
}

function intendedBranchAcceptsPresentKeys(draft: DraftNode): boolean {
  if (!draft.intendedBranch) return false
  const properties = isRecord(draft.intendedBranch.properties) ? draft.intendedBranch.properties : null
  return Boolean(properties && Object.keys(draft.node).every((key) => Object.hasOwn(properties, key)))
}

function graphIdField(contract: AuthoringContract): string {
  for (const rule of contract.semantic_rules) {
    if (rule.id === 'workflow-dag-v1' && typeof rule.parameters.id_field === 'string') {
      return rule.parameters.id_field
    }
  }
  return 'id'
}

function pointerTokens(pointer: string): (string | number)[] {
  if (pointer === '/') return []
  return pointer
    .split('/')
    .slice(1)
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((token) => (/^(?:0|[1-9][0-9]*)$/.test(token) ? Number(token) : token))
}

function schemaAtValuePath(
  root: Record<string, unknown>,
  path: readonly (string | number)[],
): Record<string, unknown> | null {
  let current: Record<string, unknown> | null = resolveContractSchema(root, root)
  for (const token of path) {
    if (!current) return null
    current = typeof token === 'number' ? resolveContractSchema(current.items, root) : schemaChild(current, token, root)
  }
  return current
}

function startsWithPath(value: readonly (string | number)[], prefix: readonly (string | number)[]): boolean {
  return prefix.every((token, index) => value[index] === token)
}

function samePath(left: readonly (string | number)[], right: readonly (string | number)[]): boolean {
  return left.length === right.length && startsWithPath(left, right)
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string'
}

function schemaAtPath(
  root: Record<string, unknown>,
  tokens: readonly { readonly key: string; readonly sequence: boolean }[],
): Record<string, unknown> | null {
  let current: Record<string, unknown> | null = resolveContractSchema(root, root)
  for (const { key, sequence } of tokens) {
    if (!current) return null
    current = schemaChild(current, key, root)
    if (sequence && current) current = resolveContractSchema(current.items, root)
  }
  return current
}

function schemaChild(
  schemaValue: Record<string, unknown>,
  key: string,
  root: Record<string, unknown>,
): Record<string, unknown> | null {
  const directProperties = isRecord(schemaValue.properties) ? schemaValue.properties : null
  if (directProperties && Object.hasOwn(directProperties, key)) {
    const directChild = directProperties[key]
    // A structured field can expose its own declared children without flattening
    // unrelated conditional allOf branches. Scalar/composed leaves still go
    // through the conservative resolver before they authorize a draft issue.
    if (isRecord(directChild) && isRecord(directChild.properties)) return directChild
    return resolveContractSchema(directChild, root)
  }
  const schema = resolveContractSchema(schemaValue, root)
  if (!schema) return null
  if (isRecord(schema.properties) && Object.hasOwn(schema.properties, key)) {
    return resolveContractSchema(schema.properties[key], root)
  }
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    if (!Array.isArray(schema[keyword])) continue
    for (const branch of schema[keyword]) {
      const resolvedBranch = resolveContractSchema(branch, root)
      if (!resolvedBranch) return null
      const child = schemaChild(resolvedBranch, key, root)
      if (child) return child
    }
  }
  return null
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const token of path) {
    if (!isRecord(current)) return undefined
    current = current[token]
  }
  return current
}

function valueAtOwnPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value
  for (const token of path) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || !Object.hasOwn(current, token)) return undefined
      current = current[token]
    } else {
      if (!isRecord(current) || !Object.hasOwn(current, token)) return undefined
      current = current[token]
    }
  }
  return current
}

function sameIssue(left: ValidationIssue, right: ValidationIssue): boolean {
  return (
    left.code === right.code &&
    left.document === right.document &&
    left.path === right.path &&
    left.nodeId === right.nodeId &&
    left.field === right.field
  )
}
