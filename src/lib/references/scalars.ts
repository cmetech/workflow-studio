import { CodePoints } from './unicode'
import type { ReferenceSpan } from './grammar'
export const SCALAR_NAMES = [
  'ARGUMENTS',
  'USER_MESSAGE',
  'ARTIFACTS_DIR',
  'WORKFLOW_ID',
  'BASE_BRANCH',
  'DOCS_DIR',
  'CONTEXT',
  'LOOP_USER_INPUT',
  'LOOP_PREV_OUTPUT',
  'REJECTION_REASON',
] as const
export interface ScalarReference {
  readonly name: string
  readonly positional: boolean
  readonly start: number
  readonly end: number
}
export function scalarReferences(text: string, outputs: readonly ReferenceSpan[] = []): readonly ScalarReference[] {
  const scalars: ScalarReference[] = []
  let cursor = 0
  const source = new CodePoints(text)
  for (let start = 0; start < source.length; start++) {
    if (source.at(start) !== '$') continue
    let end = start + 1
    const positional = /^[1-9]$/.test(source.at(end))
    if (positional) {
      end++
      while (/^[0-9]$/.test(source.at(end))) end++
    } else if (/^[A-Z]$/.test(source.at(end))) {
      end++
      while (/^[A-Z0-9_]$/.test(source.at(end))) end++
    } else continue
    const name = source.slice(start + 1, end)
    if (!positional && !SCALAR_NAMES.includes(name as (typeof SCALAR_NAMES)[number])) {
      start = end - 1
      continue
    }
    while (cursor < outputs.length && outputs[cursor]![1] <= start) cursor++
    if (!(cursor < outputs.length && start < outputs[cursor]![1] && end > outputs[cursor]![0]))
      scalars.push({ name, positional, start, end })
    start = end - 1
  }
  return scalars
}
