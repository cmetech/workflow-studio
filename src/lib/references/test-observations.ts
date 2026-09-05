// Test-only observation adapter. Dispatch uses API/input only; expected is never read.
import * as grammar from './grammar'
import * as bash from './bash'
import { classifyBashReferenceSpans } from './bash-classifier'
import { iterWhenOutputReferences, validateConditionSyntax } from './conditions'
export interface ObservationInput {
  readonly api: string
  readonly input: Readonly<Record<string, unknown>>
  readonly normalizer_version: unknown
}
export function observeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) throw error
  const result: Record<string, unknown> = { class: error.name }
  for (const name of ['code', 'start', 'node_id', 'path']) {
    const value = (error as unknown as Record<string, unknown>)[name]
    if (value !== null && value !== undefined) result[name] = value
  }
  if (error.cause instanceof Error) {
    const cause: Record<string, unknown> = { class: error.cause.name }
    if ('code' in error.cause) cause.code = error.cause.code
    result.cause = cause
  }
  return result
}
export function observeScannerCase(fixture: ObservationInput): unknown {
  const { api, input, normalizer_version: version } = fixture,
    text = input.text as string,
    spans = input.spans as readonly grammar.ReferenceSpan[]
  const key =
    api === 'contains_output_reference'
      ? 'value'
      : api.startsWith('validate_')
        ? 'references'
        : api === 'classify_bash_reference_spans' ||
            api.includes('candidate_spans') ||
            api === 'bash_loop_previous_reference_spans'
          ? 'spans'
          : 'tokens'
  const result: Record<string, unknown> = { [key]: key === 'value' ? null : [], error: null }
  try {
    let iterator: Iterator<unknown> | undefined
    switch (api) {
      case 'iter_output_references':
        iterator = grammar.iterOutputReferences(text, version)
        break
      case 'iter_loop_previous_output_references':
        iterator = grammar.iterLoopPreviousOutputReferences(text, version)
        break
      case 'iter_output_reference_candidate_spans':
        iterator = grammar.iterOutputReferenceCandidateSpans(text, version)
        break
      case 'iter_output_references_in_spans':
        iterator = grammar.iterOutputReferencesInSpans(text, spans, version)
        break
      case 'iter_when_output_references':
        iterator = iterWhenOutputReferences(text, version)
        break
      case 'contains_output_reference':
        result[key] = grammar.containsOutputReference(text, version)
        break
      case 'classify_bash_reference_spans':
        result[key] = classifyBashReferenceSpans(text, spans)
        break
      case 'bash_output_references':
        result[key] = bash.bashOutputReferences(text, version)
        break
      case 'bash_loop_previous_output_references':
        result[key] = bash.bashLoopPreviousOutputReferences(text)
        break
      case 'bash_loop_previous_reference_spans':
        result[key] = bash.bashLoopPreviousReferenceSpans(text)
        break
      case 'validate_v3_condition_syntax':
        result[key] = validateConditionSyntax(text)
        break
      case 'validate_v6_condition_syntax':
        result[key] = validateConditionSyntax(text, true)
        break
      default:
        throw new Error(`Unknown scanner observation API: ${api}`)
    }
    if (iterator) {
      if (input.consume !== 'first' && input.consume !== 'all') throw new Error('Unknown consumption policy')
      while (true) {
        const step = iterator.next()
        if (step.done) break
        ;(result[key] as unknown[]).push(step.value)
        if (input.consume === 'first') break
      }
    }
  } catch (error) {
    result.error = observeError(error)
  }
  return result
}
