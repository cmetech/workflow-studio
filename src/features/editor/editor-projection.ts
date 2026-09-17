import { editDocumentText, isAnalysisCurrent } from '$src/lib/documents/revisions'
import type { DocumentAnalysis, DocumentKind, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { isWorkflowProjection } from '$src/features/canvas/projection-guard'

export interface EditorProjectionSession {
  readonly pair: WorkflowPairText | null
  readonly revision: DocumentRevision | null
  readonly analysis: DocumentAnalysis | null
}

export interface EditorProjectionState {
  readonly workflowId: string | null
  readonly projection: WorkflowProjection | null
  readonly stale: boolean
  readonly readOnly: boolean
  readonly staleSource: 'current' | 'retained' | null
}

export function applyAuthoritativeEditorText(
  pair: WorkflowPairText,
  document: DocumentKind,
  text: string,
  commit: (pair: WorkflowPairText) => void,
): WorkflowPairText {
  const next = editDocumentText(pair, document, text)
  if (next !== pair) commit(next)
  return next
}

export function synchronizeEditorProjection(
  previous: EditorProjectionState | null,
  session: EditorProjectionSession,
): EditorProjectionState {
  const workflowId = session.pair?.workflowId ?? null
  let projection = previous?.workflowId === workflowId ? previous.projection : null
  const currentUsableProjection =
    session.revision &&
    (session.analysis?.structurallyValid === true || session.analysis?.visuallyAuthorable === true) &&
    isAnalysisCurrent(session.revision, session.analysis) &&
    isWorkflowProjection(session.analysis.projection)
      ? session.analysis.projection
      : null
  if (currentUsableProjection) projection = currentUsableProjection
  const stale = Boolean(session.pair && (!currentUsableProjection || session.analysis?.structurallyValid !== true))
  const staleSource = stale ? (currentUsableProjection ? 'current' : projection ? 'retained' : null) : null
  return { workflowId, projection, stale, readOnly: stale, staleSource }
}
