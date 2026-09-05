import { CodePoints } from './unicode'
export type ReferenceSpan = readonly [start: number, end: number]
export interface OutputReferenceToken {
  readonly node_id: string
  readonly path: readonly string[]
  readonly start: number
  readonly end: number
}
export class WorkflowReferenceSyntaxError extends Error {
  readonly code = 'output_reference_path_unsupported'
  constructor(
    readonly start: number,
    cause?: unknown,
  ) {
    super('Output reference uses an unsupported path', cause ? { cause } : undefined)
    this.name = 'WorkflowReferenceSyntaxError'
  }
}
export class ScannerValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValueError'
  }
}
export function requireStrictVersion(version: unknown): void {
  if (typeof version !== 'number' || ![3, 4, 5, 6].includes(version))
    throw new ScannerValueError('Strict output references require inherited Phase 3 semantics')
}
const pattern = /^\$([A-Za-z_][A-Za-z0-9_-]*)\.output((?:\.(?:[A-Za-z_][A-Za-z0-9_-]*|0|[1-9][0-9]*))*)/
const delimiters = ' \t\r\n\'"(){}<>=!&|,;:'
function candidateEnd(source: CodePoints, start: number, bash = false): number {
  let end = start + 1
  while (end < source.length && !delimiters.includes(source.at(end)) && !(bash && source.at(end) === '$')) end++
  return end
}
const referenceLike = (candidate: string) =>
  candidate.includes('.output') || /[./\\]output(?:[.\[\]/\\]|$)/.test(candidate)
export function outputReferenceAt(source: CodePoints, start: number): OutputReferenceToken | null {
  const match = pattern.exec(source.slice(start))
  if (match) {
    const end = start + match[0].length,
      following = source.at(end)
    if (
      following &&
      ('.[\\/-_'.includes(following) || /[A-Za-z0-9]/.test(following) || following.codePointAt(0)! > 127)
    )
      throw new WorkflowReferenceSyntaxError(start)
    return { node_id: match[1]!, path: match[2] ? match[2].slice(1).split('.') : [], start, end }
  }
  if (referenceLike(source.slice(start, candidateEnd(source, start)))) throw new WorkflowReferenceSyntaxError(start)
  return null
}
export function* iterOutputReferences(text: string, version: unknown = 6): Generator<OutputReferenceToken> {
  requireStrictVersion(version)
  const source = new CodePoints(text)
  let position = 0
  while (true) {
    const start = source.indexOf('$', position)
    if (start < 0) return
    const token = outputReferenceAt(source, start)
    if (token) {
      yield token
      position = token.end
    } else position = Math.max(start + 1, candidateEnd(source, start))
  }
}
export function* iterLoopPreviousOutputReferences(text: string, version: unknown = 6): Generator<OutputReferenceToken> {
  requireStrictVersion(version)
  const source = new CodePoints(text),
    prefix = '$LOOP_PREV.'
  let position = 0
  while (true) {
    const start = source.indexOf(prefix, position)
    if (start < 0) return
    let token: OutputReferenceToken | null
    try {
      token = outputReferenceAt(new CodePoints('$' + source.slice(start + prefix.length)), 0)
    } catch (error) {
      throw new WorkflowReferenceSyntaxError(start, error)
    }
    if (!token) throw new WorkflowReferenceSyntaxError(start)
    const end = start + prefix.length - 1 + token.end
    yield { ...token, start, end }
    position = end
  }
}
export function* iterOutputReferenceCandidateSpans(text: string, version: unknown = 6): Generator<ReferenceSpan> {
  requireStrictVersion(version)
  const source = new CodePoints(text)
  let position = 0
  while (true) {
    const start = source.indexOf('$', position)
    if (start < 0) return
    const end = candidateEnd(source, start, true),
      first = source.at(start + 1)
    if (
      start + 1 < end &&
      (/[A-Za-z0-9_]/.test(first) || first.codePointAt(0)! > 127) &&
      referenceLike(source.slice(start, end))
    )
      yield [start, end]
    position = start + 1
  }
}
export function* iterOutputReferencesInSpans(
  text: string,
  spans: Iterable<ReferenceSpan>,
  version: unknown = 6,
): Generator<OutputReferenceToken> {
  requireStrictVersion(version)
  const source = new CodePoints(text)
  let previousEnd = 0
  for (const span of spans) {
    if (span.length !== 2) throw new ScannerValueError('Output reference spans require a pair')
    const [rawStart, rawEnd] = span
    if (![rawStart, rawEnd].every((value) => typeof value === 'number' || typeof value === 'boolean'))
      throw new TypeError('Output reference offsets must support numeric comparison')
    const start = Number(rawStart),
      end = Number(rawEnd)
    if (start < previousEnd || start < 0 || end <= start || end > source.length)
      throw new ScannerValueError('Output reference candidate spans are invalid')
    previousEnd = end
    if (!Number.isInteger(start) || !Number.isInteger(end))
      throw new TypeError('Output reference slice offsets must be integers')
    let token: OutputReferenceToken | null
    try {
      token = outputReferenceAt(new CodePoints(source.slice(start, end)), 0)
    } catch (error) {
      if (error instanceof WorkflowReferenceSyntaxError)
        throw new WorkflowReferenceSyntaxError(start + error.start, error)
      throw error
    }
    if (token) yield { ...token, start: start + token.start, end: start + token.end }
  }
}
export function containsOutputReference(text: string, version: unknown = 6): boolean {
  requireStrictVersion(version)
  const source = new CodePoints(text)
  for (let start = source.indexOf('$'); start >= 0; start = source.indexOf('$', start + 1)) {
    try {
      if (outputReferenceAt(source, start)) return true
    } catch {
      /* Presence deliberately ignores malformed candidates. */
    }
  }
  return false
}
export function maskReferences(text: string, references: readonly OutputReferenceToken[]): string {
  const chars = Array.from(text)
  for (const { start, end } of references) for (let i = start; i < end; i++) chars[i] = ' '
  return chars.join('')
}
