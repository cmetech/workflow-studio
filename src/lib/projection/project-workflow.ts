import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
import type { ValidationIssue } from '$src/lib/documents/types'
import type { ParsedYamlDocument } from '$src/lib/yaml/types'
import { discoverGraphScopes } from './graph-scopes'
import type { WorkflowProjection } from './types'

export interface WorkflowProjectionResult {
  readonly projection: WorkflowProjection
  readonly issues: readonly ValidationIssue[]
}

export interface ResolvedWorkflowValues {
  readonly definition: unknown
  readonly companion?: unknown
}

export function projectWorkflow(
  definitionDocument: ParsedYamlDocument,
  companionDocument: ParsedYamlDocument | null,
  profile: WorkflowProfile,
  contract: AuthoringContract,
  resolved?: ResolvedWorkflowValues,
): WorkflowProjectionResult {
  const definitionValue =
    resolved === undefined
      ? (definitionDocument.document.toJS({ maxAliasCount: 1_000 }) as unknown)
      : resolved.definition
  const companionValue =
    resolved && Object.hasOwn(resolved, 'companion')
      ? resolved.companion
      : (companionDocument?.document.toJS({ maxAliasCount: 1_000 }) as unknown)
  const definition = isRecord(definitionValue) ? definitionValue : {}
  const graphs = discoverGraphScopes(definitionDocument, contract, profile, definitionValue)
  return deepFreeze({
    projection: {
      name: typeof definition.name === 'string' ? definition.name : '',
      ...(typeof definition.description === 'string' ? { description: definition.description } : {}),
      profile,
      graphs,
      definition: deepFreeze(definitionValue),
      ...(companionDocument ? { companion: deepFreeze(companionValue) } : {}),
    },
    issues: graphs.flatMap((graph) => graph.issues),
  })
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
