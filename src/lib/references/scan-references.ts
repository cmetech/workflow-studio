import { bashLoopPreviousOutputReferences, bashOutputReferences } from './bash'
import { BashRenderingError, classifyBashReferenceSpans } from './bash-classifier'
import { iterWhenOutputReferences, validateConditionSyntax, WorkflowConditionError } from './conditions'
import {
  iterLoopPreviousOutputReferences,
  iterOutputReferences,
  maskReferences,
  requireStrictVersion,
  WorkflowReferenceSyntaxError,
  type OutputReferenceToken,
} from './grammar'
import { scalarReferences } from './scalars'
import { requireUnicodeProfile } from './unicode'
import type { ScalarReference } from './scalars'
export interface ScannedReference {
  readonly kind: 'ordinary' | 'previous'
  readonly producerId: string
  readonly path: readonly string[]
  readonly start: number
  readonly end: number
}
export interface ReferenceScanError {
  readonly code: string
  readonly name: string
  readonly start?: number
  readonly cause?: { readonly name: string; readonly code?: string }
}
export interface ReferenceScan {
  readonly references: readonly ScannedReference[]
  readonly scalars: readonly ScalarReference[]
  readonly errors: readonly ReferenceScanError[]
}
export interface ScanOptions {
  readonly normalizerVersion: number
  readonly unicodeProfile: string
  readonly includePrevious?: boolean
  readonly includeScalars?: boolean
}
export type ReferenceScanMode =
  | 'text'
  | 'text-previous'
  | 'bash'
  | 'bash-previous'
  | 'condition-v3'
  | 'condition-v6'
  | 'body-when'
  | 'historical-condition'

/** Eager authoring observation. Native failures return no partial references;
 * consumers needing Python's lazy prefix semantics use the exported generators. */
export function scanReferences(text: string, mode: ReferenceScanMode, options: ScanOptions): ReferenceScan {
  requireUnicodeProfile(options.unicodeProfile)
  requireStrictVersion(options.normalizerVersion)
  if (
    ![
      'text',
      'text-previous',
      'bash',
      'bash-previous',
      'condition-v3',
      'condition-v6',
      'body-when',
      'historical-condition',
    ].includes(mode)
  )
    throw new Error(`Unsupported reference scan mode: ${mode}`)
  if (['condition-v6', 'body-when', 'bash-previous'].includes(mode) && options.normalizerVersion !== 6)
    throw new Error(`Reference scan mode ${mode} requires normalizer 6`)
  if (/[\uD800-\uDFFF]/u.test(text))
    return {
      references: [],
      scalars: [],
      errors: [{ code: 'reference_scanner_unicode_invalid', name: 'UnsupportedUnicodeInput' }],
    }
  const convert = (token: OutputReferenceToken, kind: 'ordinary' | 'previous'): ScannedReference => ({
    kind,
    producerId: token.node_id,
    path: token.path,
    start: token.start,
    end: token.end,
  })
  try {
    if (mode === 'condition-v3' || mode === 'condition-v6')
      return {
        references: validateConditionSyntax(text, mode === 'condition-v6').map((token) =>
          convert(token, token.kind === 'previous' ? 'previous' : 'ordinary'),
        ),
        scalars: [],
        errors: [],
      }
    if (mode === 'historical-condition')
      return {
        references: Array.from(iterWhenOutputReferences(text, options.normalizerVersion), (token) =>
          convert(token, 'ordinary'),
        ),
        scalars: [],
        errors: [],
      }
    if (mode === 'body-when') validateConditionSyntax(text, true)
    const bash = mode === 'bash' || mode === 'bash-previous',
      previousOnly = mode === 'text-previous' || mode === 'bash-previous'
    const previous =
      previousOnly || (options.includePrevious ?? options.normalizerVersion === 6)
        ? Array.from(
            bash
              ? bashLoopPreviousOutputReferences(text)
              : iterLoopPreviousOutputReferences(text, options.normalizerVersion),
          )
        : []
    const ordinaryText = maskReferences(text, previous)
    const ordinary = previousOnly
      ? []
      : Array.from(
          bash
            ? bashOutputReferences(ordinaryText, options.normalizerVersion)
            : iterOutputReferences(ordinaryText, options.normalizerVersion),
        )
    const references = [
      ...previous.map((token) => convert(token, 'previous')),
      ...ordinary.map((token) => convert(token, 'ordinary')),
    ].sort((a, b) => a.start - b.start)
    let scalars =
      options.includeScalars === false || previousOnly || mode === 'body-when'
        ? []
        : scalarReferences(
            text,
            references.map(({ start, end }) => [start, end]),
          )
    if (bash && scalars.length) {
      const admitted = new Set(
        classifyBashReferenceSpans(
          text,
          scalars.map(({ start, end }) => [start, end]),
        ).map(([start]) => start),
      )
      scalars = scalars.filter((token) => admitted.has(token.start))
    }
    return { references, scalars, errors: [] }
  } catch (error) {
    if (!(
      error instanceof WorkflowReferenceSyntaxError ||
      error instanceof WorkflowConditionError ||
      error instanceof BashRenderingError
    ))
      throw error
    const cause = error.cause
    return {
      references: [],
      scalars: [],
      errors: [
        {
          name: error.name,
          code: error.code,
          ...(error instanceof WorkflowReferenceSyntaxError ? { start: error.start } : {}),
          ...(cause instanceof WorkflowReferenceSyntaxError ? { cause: { name: cause.name, code: cause.code } } : {}),
        },
      ],
    }
  }
}
