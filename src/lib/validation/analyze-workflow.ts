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

  if (hasBlockingIssue(issues)) return { ...identity, issues, structurallyValid: false }

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
