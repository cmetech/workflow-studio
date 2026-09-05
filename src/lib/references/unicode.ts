import { unicodeRanges } from './unicode-tables'
export const SCANNER_UNICODE_PROFILE = 'python-3.11-unicode-14.0.0' as const
export type UnicodeProfile = typeof SCANNER_UNICODE_PROFILE
export function requireUnicodeProfile(profile: string): asserts profile is UnicodeProfile {
  if (profile !== SCANNER_UNICODE_PROFILE) throw new Error(`Unsupported reference scanner Unicode profile: ${profile}`)
}
export function unicodePredicate(text: string, predicate: keyof typeof unicodeRanges): boolean {
  if (!text) return false
  return Array.from(text).every((character) => {
    const code = character.codePointAt(0)!
    const ranges = unicodeRanges[predicate]
    let low = 0
    let high: number = ranges.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (ranges[mid]![1] < code) low = mid + 1
      else high = mid
    }
    return low < ranges.length && ranges[low]![0] <= code
  })
}
export const asciiAlpha = (text: string) => /^[A-Za-z]+$/.test(text)
export const asciiAlnum = (text: string) => /^[A-Za-z0-9]+$/.test(text)
export function codePointToEditorOffset(text: string, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError('Invalid code-point offset')
  let index = 0,
    point = 0
  for (const character of text) {
    if (point++ === offset) return index
    index += character.length
  }
  if (point === offset) return index
  throw new RangeError('Code-point offset is outside the text')
}
export function editorToCodePointOffset(text: string, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new RangeError('Invalid editor offset')
  let index = 0,
    point = 0
  for (const character of text) {
    if (index === offset) return point
    index += character.length
    point++
    if (index > offset) throw new RangeError('Editor offset splits a Unicode code point')
  }
  return point
}
/** Indexable authored code points, without converting scanner spans to editor units. */
export class CodePoints {
  readonly chars: readonly string[]
  constructor(readonly text: string) {
    this.chars = Array.from(text)
  }
  get length() {
    return this.chars.length
  }
  at(index: number): string {
    return this.chars[index] ?? ''
  }
  slice(start: number, end?: number): string {
    return this.chars.slice(start, end).join('')
  }
  startsWith(token: string, start: number): boolean {
    return Array.from(token).every((c, i) => this.at(start + i) === c)
  }
  indexOf(token: string, start = 0): number {
    for (let i = start; i < this.length; i++) if (this.startsWith(token, i)) return i
    return -1
  }
}
