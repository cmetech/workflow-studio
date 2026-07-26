import type { Diagnostic } from '@codemirror/lint'
import { isAnalysisCurrent } from '$src/lib/documents/revisions'
import type { DocumentAnalysis, DocumentKind, DocumentRevision, ValidationIssue } from '$src/lib/documents/types'

export interface DiagnosticsInput {
  readonly text: string
  readonly document: DocumentKind
  readonly revision: DocumentRevision
  readonly analysis: DocumentAnalysis | null
  readonly onFocus?: (issue: ValidationIssue) => void
}

export function issuesToCodeMirrorDiagnostics(input: DiagnosticsInput): readonly Diagnostic[] {
  if (!input.analysis || !isAnalysisCurrent(input.revision, input.analysis)) return []

  return input.analysis.issues
    .filter((issue) => issue.document === input.document)
    .map((issue) => issueToDiagnostic(input.text, issue, input.onFocus))
}

function issueToDiagnostic(
  text: string,
  issue: ValidationIssue,
  onFocus: ((issue: ValidationIssue) => void) | undefined,
): Diagnostic {
  const from = positionFor(text, issue.line, issue.column)
  const to = Math.min(text.length, from + (from < text.length ? 1 : 0))
  return {
    from,
    to,
    severity: issue.severity,
    message: issue.message,
    source: issue.layer,
    ...(onFocus
      ? {
          actions: [
            {
              name: 'Focus problem',
              apply: () => onFocus(issue),
            },
          ],
        }
      : {}),
  }
}

function positionFor(text: string, line: number | undefined, column: number | undefined): number {
  if (line === undefined || column === undefined) return 0
  const lines = lineStarts(text)
  const lineIndex = clamp(Math.trunc(line) - 1, 0, lines.length - 1)
  const start = lines[lineIndex] ?? 0
  const end = lineIndex + 1 < lines.length ? Math.max(start, (lines[lineIndex + 1] ?? text.length) - 1) : text.length
  return clamp(start + Math.max(0, Math.trunc(column) - 1), start, end)
}

function lineStarts(text: string): readonly number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
