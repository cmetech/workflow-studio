import {
  iterOutputReferences,
  outputReferenceAt,
  requireStrictVersion,
  WorkflowReferenceSyntaxError,
  type OutputReferenceToken,
} from './grammar'
import { CodePoints, unicodePredicate } from './unicode'
export interface ConditionReference extends OutputReferenceToken {
  readonly kind: 'current' | 'previous'
}
export class WorkflowConditionError extends Error {
  readonly code = 'condition_runtime_syntax_invalid'
  constructor(cause?: unknown) {
    super('Condition does not match the sealed v3 grammar', cause ? { cause } : undefined)
    this.name = 'WorkflowConditionError'
  }
}
const decimal = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/
const operators = ['==', '!=', '<=', '>=', '<', '>']
export function* iterWhenOutputReferences(text: string, version: unknown = 6): Generator<OutputReferenceToken> {
  requireStrictVersion(version)
  const source = new CodePoints(text)
  let position = 0
  const skip = () => {
    while (position < source.length && unicodePredicate(source.at(position), 'whitespace')) position++
  }
  skip()
  while (position < source.length) {
    const token = outputReferenceAt(source, position)
    if (!token) return
    position = token.end
    skip()
    const operator = operators.find((x) => source.startsWith(x, position))
    if (!operator) return
    position += operator.length
    skip()
    if (position >= source.length) return
    const quote = source.at(position)
    if ('\'"'.includes(quote)) {
      const closing = source.indexOf(quote, position + 1)
      if (closing < 0) return
      position = closing + 1
    } else {
      const match = decimal.exec(source.slice(position))
      if (!match) return
      position += match[0].length
    }
    yield token
    skip()
    if (source.startsWith('&&', position) || source.startsWith('||', position)) {
      position += 2
      skip()
    } else break
  }
}
export function validateConditionSyntax(text: string, allowPrevious = false): readonly ConditionReference[] {
  if (!text || new TextEncoder().encode(text).length > 16384 || /[\uD800-\uDFFF]/u.test(text))
    throw new WorkflowConditionError()
  const source = new CodePoints(text)
  let position = 0,
    count = 0
  const references: ConditionReference[] = []
  const error = (): never => {
    throw new WorkflowConditionError()
  }
  const token = () => {
    if (++count > 256) error()
  }
  const skip = () => {
    while (position < source.length && ' \t\r\n'.includes(source.at(position))) position++
  }
  function reference() {
    const previous = allowPrevious && source.startsWith('$LOOP_PREV.', position)
    const suffix = previous ? '$' + source.slice(position + 11) : source.slice(position)
    let value: OutputReferenceToken | undefined
    try {
      value = iterOutputReferences(suffix, previous ? 6 : 3).next().value
    } catch (cause) {
      if (cause instanceof WorkflowReferenceSyntaxError) throw new WorkflowConditionError(cause)
      throw cause
    }
    if (!value || value.start !== 0) return error()
    const absolute: ConditionReference = {
      ...value,
      start: position,
      end: position + (previous ? 10 : 0) + value.end,
      kind: previous ? 'previous' : 'current',
    }
    position = absolute.end
    token()
    references.push(absolute)
  }
  function clause() {
    skip()
    reference()
    skip()
    const operator = operators.find((x) => source.startsWith(x, position))
    if (!operator) return error()
    position += operator.length
    token()
    skip()
    if (source.at(position) === '$') {
      if (operator !== '==' && operator !== '!=') error()
      reference()
    } else {
      if (position >= source.length) error()
      const quote = source.at(position)
      if ('\'"'.includes(quote)) {
        const end = source.indexOf(quote, position + 1)
        if (end < 0) error()
        position = end + 1
        token()
      } else {
        const match = decimal.exec(source.slice(position))
        if (!match) return error()
        position += match[0].length
        token()
      }
    }
    skip()
  }
  skip()
  clause()
  while (source.startsWith('&&', position) || source.startsWith('||', position)) {
    position += 2
    token()
    clause()
  }
  skip()
  if (position !== source.length) error()
  return references
}
