import { basicSetup } from 'codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { lintGutter } from '@codemirror/lint'
import { Annotation, type Extension } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { isAnalysisCurrent } from '$src/lib/documents/revisions'
import type { DocumentAnalysis, DocumentRevision } from '$src/lib/documents/types'
import { isWorkflowProjection } from '$src/features/canvas/project-canvas'
import type { DocumentSyncOrigin } from '$src/stores/documents'

export const externalEditorUpdate = Annotation.define<boolean>()
export const editorSelectionSync = Annotation.define<'canvas' | 'problem'>()

export interface SourceRangedNode {
  readonly id: string
  readonly source: { readonly start: number; readonly end: number }
}

export {
  applyAuthoritativeEditorText,
  synchronizeEditorProjection,
  type EditorProjectionSession,
  type EditorProjectionState,
} from './editor-projection'

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
      '.cm-content': { caretColor: 'var(--color-focus)' },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--color-focus)',
        borderLeftWidth: '2px',
        boxShadow: '1px 0 0 var(--color-focus-contrast)',
      },
      '.cm-fat-cursor': {
        backgroundColor: 'var(--color-focus)',
        outline: '1px solid var(--color-focus-contrast)',
        outlineOffset: '-1px',
      },
      '.cm-scroller': { fontFamily: 'var(--font-mono)' },
      '.cm-gutters': {
        color: 'var(--color-text-muted)',
        backgroundColor: 'var(--color-yaml-gutter)',
        borderRight: '1px solid var(--color-border)',
      },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--color-node-selected)' },
      '&.cm-focused': { outline: '2px solid var(--color-focus)', outlineOffset: '-2px' },
      '@media (forced-colors: active)': {
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'CanvasText',
          boxShadow: 'none',
        },
        '.cm-fat-cursor': {
          backgroundColor: 'CanvasText',
          outline: 'none',
        },
      },
    }),
  ]
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
