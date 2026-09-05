import type { ValidationIssue } from '$src/lib/documents/types'
import type { DocumentRevision } from '$src/lib/documents/types'
import { isAnalysisCurrent } from '$src/lib/documents/revisions'
import type { GraphScopeKey, WorkflowProjection } from '$src/lib/projection/types'

export type ProblemFocusRoute =
  | { readonly kind: 'yaml' }
  | { readonly kind: 'node-field'; readonly scopeKey: GraphScopeKey; readonly nodeId: string; readonly path?: string }
  | { readonly kind: 'group-field'; readonly scopeKey: GraphScopeKey; readonly groupId: string; readonly path?: string }

export function problemFocusRoute(projection: WorkflowProjection | null, issue: ValidationIssue): ProblemFocusRoute {
  if (!projection || issue.document !== 'definition' || issue.layer === 'syntax') return { kind: 'yaml' }
  const scopeKey = issue.scopeKey ?? (issue.groupId ? (`loop-group:${issue.groupId}` as const) : 'root')
  const graph = projection.graphs.find(({ scope }) => scope.key === scopeKey)
  if (!graph) return { kind: 'yaml' }
  if (issue.groupId && issue.nodeId === issue.groupId && issue.path?.includes('/loop_group/')) {
    return { kind: 'group-field', scopeKey, groupId: issue.groupId, ...(issue.path ? { path: issue.path } : {}) }
  }
  if (!issue.nodeId || !graph.nodes.some(({ id }) => id === issue.nodeId)) return { kind: 'yaml' }
  return { kind: 'node-field', scopeKey, nodeId: issue.nodeId, ...(issue.path ? { path: issue.path } : {}) }
}

interface ProblemFocusRequest {
  readonly issue: ValidationIssue | null
  readonly targetRevision: DocumentRevision | null
  readonly requested: boolean
  readonly requestRevision: number
}

export interface ProblemFocusCoordinatorDependencies {
  readonly getRequest: () => ProblemFocusRequest
  readonly getRevision: () => DocumentRevision | null
  readonly getProjection: () => WorkflowProjection | null
  readonly enterScope: (scopeKey: GraphScopeKey) => Promise<boolean>
  readonly focusNode: (
    route: Extract<ProblemFocusRoute, { kind: 'node-field' }>,
    issue: ValidationIssue,
  ) => Promise<boolean>
  readonly focusGroup: (
    route: Extract<ProblemFocusRoute, { kind: 'group-field' }>,
    issue: ValidationIssue,
  ) => Promise<boolean>
  readonly focusYaml: (issue: ValidationIssue) => Promise<boolean>
  readonly acknowledge: (requestRevision: number) => void
}

export async function runProblemFocusCoordinator(
  requestRevision: number,
  dependencies: ProblemFocusCoordinatorDependencies,
): Promise<void> {
  const current = (): boolean => {
    const request = dependencies.getRequest()
    const revision = dependencies.getRevision()
    return Boolean(
      request.requested &&
      request.requestRevision === requestRevision &&
      request.targetRevision &&
      revision &&
      isAnalysisCurrent(revision, request.targetRevision),
    )
  }
  try {
    const request = dependencies.getRequest()
    if (!request.issue || !current()) return
    const route = problemFocusRoute(dependencies.getProjection(), request.issue)
    if (route.kind !== 'yaml' && route.scopeKey !== 'root') {
      if (!(await dependencies.enterScope(route.scopeKey)) || !current()) return
    }
    const focused =
      route.kind === 'yaml'
        ? await dependencies.focusYaml(request.issue)
        : route.kind === 'node-field'
          ? await dependencies.focusNode(route, request.issue)
          : await dependencies.focusGroup(route, request.issue)
    if (!focused && current()) await dependencies.focusYaml(request.issue)
  } finally {
    dependencies.acknowledge(requestRevision)
  }
}
