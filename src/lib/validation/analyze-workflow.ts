import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
import { recordEditorMetric } from '$src/lib/metrics/editor-metrics'
import type { DocumentAnalysis, ValidationIssue } from '$src/lib/documents/types'
import { projectWorkflow } from '$src/lib/projection/project-workflow'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import type { AnalyzeDocumentRequest } from '$src/workers/document-worker-protocol'
import { validateDag } from './dag-validator'
import { validateContractDocument } from './schema-validator'

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
    const relaxedContract = contractForExplicitEmptyNodeKinds(
      definitionResult.parsed.document.toJS({ maxAliasCount: 1_000 }),
      contract,
    )
    if (!relaxedContract) return { ...identity, issues, structurallyValid: false }

    const relaxedIssues: ValidationIssue[] = []
    try {
      relaxedIssues.push(...validateContractDocument(definitionResult.parsed, 'definition', relaxedContract))
      if (companionResult?.parsed) {
        relaxedIssues.push(...validateContractDocument(companionResult.parsed, 'companion', relaxedContract))
      }
    } catch {
      return { ...identity, issues, structurallyValid: false }
    }
    if (hasBlockingIssue(relaxedIssues)) return { ...identity, issues, structurallyValid: false }

    const draftProjection = projectWorkflow(
      definitionResult.parsed,
      companionResult?.parsed ?? null,
      profileSelection.profile,
      contract,
    )
    relaxedIssues.push(...draftProjection.issues)
    if (!hasBlockingIssue(relaxedIssues)) {
      relaxedIssues.push(...validateDag(draftProjection.projection, contract.semantic_rules).issues)
    }
    if (hasBlockingIssue(relaxedIssues)) return { ...identity, issues, structurallyValid: false }
    return {
      ...identity,
      issues: [...issues, ...relaxedIssues.filter((issue) => !issues.some((existing) => sameIssue(existing, issue)))],
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

function contractForExplicitEmptyNodeKinds(definition: unknown, contract: AuthoringContract): AuthoringContract | null {
  const descriptorPaths = contract.node_kinds
    .map(({ field_path }) => descriptorPath(field_path))
    .filter((path): path is DescriptorPath => path !== null)
  const explicitEmptyPaths = descriptorPaths.filter(({ nodesPath, relativePath }) => {
    const nodes = valueAtPath(definition, nodesPath)
    return Array.isArray(nodes) && nodes.some((node) => valueAtOwnPath(node, relativePath) === '')
  })
  if (explicitEmptyPaths.length === 0) return null

  const relaxed = structuredClone(contract)
  const cacheVariant = explicitEmptyPaths
    .map(({ schemaTokens }) => schemaTokens.map(({ key, sequence }) => `${key}${sequence ? '[]' : ''}`).join('.'))
    .sort()
    .join(',')
  relaxed.contract_digest = `sha256:${contract.contract_digest.slice('sha256:'.length)}-explicit-empty-node-kind:${cacheVariant}`
  let changed = false
  for (const { schemaTokens } of explicitEmptyPaths) {
    const schema = schemaAtPath(relaxed.definition_schema, schemaTokens)
    if (schema && typeof schema.minLength === 'number' && schema.minLength > 0) {
      delete schema.minLength
      changed = true
    }
  }
  return changed ? relaxed : null
}

interface DescriptorPath {
  readonly nodesPath: readonly string[]
  readonly relativePath: readonly string[]
  readonly schemaTokens: readonly { readonly key: string; readonly sequence: boolean }[]
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
  }
}

function schemaAtPath(
  root: Record<string, unknown>,
  tokens: readonly { readonly key: string; readonly sequence: boolean }[],
): Record<string, unknown> | null {
  let current: unknown = root
  for (const { key, sequence } of tokens) {
    if (!isRecord(current) || !isRecord(current.properties)) return null
    current = current.properties[key]
    if (sequence) current = isRecord(current) ? current.items : undefined
  }
  return isRecord(current) ? current : null
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const token of path) {
    if (!isRecord(current)) return undefined
    current = current[token]
  }
  return current
}

function valueAtOwnPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const token of path) {
    if (!isRecord(current) || !Object.hasOwn(current, token)) return undefined
    current = current[token]
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
