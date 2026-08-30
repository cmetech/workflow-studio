import { basicSetup } from 'codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { lintGutter } from '@codemirror/lint'
import { Annotation, type Extension } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { editDocumentText, isAnalysisCurrent } from '$src/lib/documents/revisions'
import type { DocumentAnalysis, DocumentKind, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { isWorkflowProjection } from '$src/features/canvas/project-canvas'
import type { DocumentSyncOrigin } from '$src/stores/documents'

export const externalEditorUpdate = Annotation.define<boolean>()
export const editorSelectionSync = Annotation.define<'canvas' | 'problem'>()

export interface SourceRangedNode {
  readonly id: string
  readonly source: { readonly start: number; readonly end: number }
}

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
}

export function createEditorExtensions(onUpdate: (update: ViewUpdate) => void, label: string): Extension[] {
  return [
    basicSetup,
    yaml(),
    lintGutter(),
    EditorView.updateListener.of(onUpdate),
    EditorView.contentAttributes.of({ 'aria-label': label }),
    EditorView.theme({
      '&': {
        height: '100%',
        color: 'var(--color-text)',
        backgroundColor: 'var(--color-surface)',
      },
      '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      '.cm-gutters': {
        color: 'var(--color-text-muted)',
        backgroundColor: 'var(--color-yaml-gutter)',
        borderRight: '1px solid var(--color-border)',
      },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--color-node-selected)' },
      '&.cm-focused': { outline: '2px solid var(--color-focus)', outlineOffset: '-2px' },
    }),
  ]
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
  return { workflowId, projection, stale, readOnly: stale }
}

export function rangeForSelectedNode(
  nodes: readonly SourceRangedNode[],
  nodeId: string,
  documentLength: number,
): { readonly from: number; readonly to: number } | null {
  const node = nodes.find(({ id }) => id === nodeId)
  if (!node) return null
  const from = clamp(node.source.start, 0, documentLength)
  return { from, to: clamp(node.source.end, from, documentLength) }
}

export function nodeAtCursor(nodes: readonly SourceRangedNode[], position: number): string | null {
  return nodes.find(({ source }) => position >= source.start && position <= source.end)?.id ?? null
}

export function rangeSynchronizationIsCurrent(revision: DocumentRevision, analysis: DocumentAnalysis | null): boolean {
  return Boolean(
    analysis?.structurallyValid && isAnalysisCurrent(revision, analysis) && isWorkflowProjection(analysis.projection),
  )
}

export interface MinimalEditorChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

export function externalEditorChange(
  current: string,
  next: string,
  origin: DocumentSyncOrigin,
): { readonly kind: 'mapped'; readonly change: MinimalEditorChange } | { readonly kind: 'reset' } {
  if (origin !== 'visual' && origin !== 'form') return { kind: 'reset' }
  let prefix = 0
  const prefixLimit = Math.min(current.length, next.length)
  while (prefix < prefixLimit && current.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1
  let currentSuffix = current.length
  let nextSuffix = next.length
  while (
    currentSuffix > prefix &&
    nextSuffix > prefix &&
    current.charCodeAt(currentSuffix - 1) === next.charCodeAt(nextSuffix - 1)
  ) {
    currentSuffix -= 1
    nextSuffix -= 1
  }
  return { kind: 'mapped', change: { from: prefix, to: currentSuffix, insert: next.slice(prefix, nextSuffix) } }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
