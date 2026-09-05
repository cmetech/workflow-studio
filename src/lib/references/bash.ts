import { classifyBashReferenceSpans } from './bash-classifier'
import {
  iterLoopPreviousOutputReferences,
  iterOutputReferenceCandidateSpans,
  iterOutputReferencesInSpans,
  maskReferences,
  WorkflowReferenceSyntaxError,
  type OutputReferenceToken,
  type ReferenceSpan,
} from './grammar'
import { scalarReferences } from './scalars'
import { CodePoints } from './unicode'
export function bashLoopPreviousOutputReferences(text: string): readonly OutputReferenceToken[] {
  const source = new CodePoints(text),
    candidates = Array.from(iterOutputReferenceCandidateSpans(text, 6)).filter(([start]) =>
      source.startsWith('$LOOP_PREV.', start),
    ),
    references: OutputReferenceToken[] = []
  for (const [start, end] of classifyBashReferenceSpans(text, candidates)) {
    let parsed: OutputReferenceToken[]
    try {
      parsed = Array.from(iterLoopPreviousOutputReferences(source.slice(start, end), 6))
    } catch (error) {
      if (error instanceof WorkflowReferenceSyntaxError)
        throw new WorkflowReferenceSyntaxError(start + error.start, error)
      throw error
    }
    if (parsed.length !== 1) throw new WorkflowReferenceSyntaxError(start)
    const reference = parsed[0]!
    references.push({ ...reference, start: start + reference.start, end: start + reference.end })
  }
  return references
}
export function bashLoopPreviousReferenceSpans(text: string): readonly ReferenceSpan[] {
  return bashLoopPreviousOutputReferences(text).map(({ start, end }) => [start, end])
}
export function bashOutputReferences(text: string, version: unknown = 3): readonly OutputReferenceToken[] {
  const previous = typeof version === 'number' && version >= 6 ? bashLoopPreviousOutputReferences(text) : []
  const ordinary = maskReferences(text, previous),
    outputs = Array.from(iterOutputReferenceCandidateSpans(ordinary, version)),
    scalars = scalarReferences(text, outputs),
    candidates: ReferenceSpan[] = [...outputs, ...scalars.map(({ start, end }) => [start, end] as const)].sort(
      (a, b) => a[0] - b[0] || a[1] - b[1],
    )
  const outputStarts = new Set(outputs.map(([start]) => start)),
    admitted = classifyBashReferenceSpans(text, candidates)
      .filter(([start]) => outputStarts.has(start))
      .map(([start, end]) => [start, end] as const)
  return Array.from(iterOutputReferencesInSpans(ordinary, admitted, version))
}
