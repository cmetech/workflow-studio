import { describe, expect, it } from 'vitest'
import { scanReferences } from './scan-references'
import { SCANNER_UNICODE_PROFILE, codePointToEditorOffset, editorToCodePointOffset } from './unicode'
import { schemaHasUnaddressableDottedKey } from './structured-path'
const options = { normalizerVersion: 6, unicodeProfile: SCANNER_UNICODE_PROFILE } as const
it('returns current and previous references with authored code-point spans', () => {
  expect(scanReferences('😀 $LOOP_PREV.a.output.x $b.output', 'text', options)).toMatchObject({
    errors: [],
    references: [
      { kind: 'previous', producerId: 'a', path: ['x'], start: 2, end: 23 },
      { kind: 'ordinary', producerId: 'b', path: [], start: 24, end: 33 },
    ],
  })
})
it('preserves native syntax errors at astral authored offsets', () => {
  expect(scanReferences('😀 $a.outputx', 'text', options)).toMatchObject({
    errors: [{ code: 'output_reference_path_unsupported', start: 2 }],
  })
})
it('body when validates syntax before scanning references inside quoted RHS text', () => {
  expect(
    scanReferences('$a.output == "$LOOP_PREV.b.output"', 'body-when', options).references.map((x) => [
      x.kind,
      x.producerId,
    ]),
  ).toEqual([
    ['ordinary', 'a'],
    ['previous', 'b'],
  ])
  expect(scanReferences('$a.output == "$b.outputx"', 'body-when', options).errors).toMatchObject([
    { code: 'output_reference_path_unsupported', start: 14 },
  ])
})
it('scalar discovery is maximal, respects output overlap, and follows Bash admission', () => {
  expect(
    scanReferences('echo $USER_MESSAGE.output.x $USER_MESSAGE_X $USER_MESSAGE $10 $01', 'bash', options),
  ).toMatchObject({
    errors: [],
    scalars: [
      { name: 'USER_MESSAGE', positional: false },
      { name: '10', positional: true },
    ],
  })
  expect(scanReferences('echo \\$USER_MESSAGE # $1', 'bash', options).scalars).toEqual([])
  expect(scanReferences('echo $($USER_MESSAGE)', 'bash', options).errors).toMatchObject([
    { code: 'bash_reference_context_unsupported' },
  ])
})
it('rejects unsupported profile, version and mode rather than silently scanning', () => {
  expect(() => scanReferences('', 'text', { ...options, unicodeProfile: 'future' })).toThrow(/profile/)
  expect(() => scanReferences('', 'text', { ...options, normalizerVersion: 2 })).toThrow()
  expect(() => scanReferences('', 'future' as never, options)).toThrow(/mode/)
})
describe('editor boundary conversions', () => {
  it('converts astral prefixes and combining marks without splitting code points', () => {
    const text = '😀é$x.output'
    expect(codePointToEditorOffset(text, 3)).toBe(4)
    expect(editorToCodePointOffset(text, 4)).toBe(3)
    expect(() => editorToCodePointOffset(text, 1)).toThrow()
    expect(() => codePointToEditorOffset(text, 999)).toThrow()
  })
})
it('dotted-property detection follows local refs and containing branches', () => {
  expect(
    schemaHasUnaddressableDottedKey({ $defs: { object: { properties: { 'x.y': {} } } }, $ref: '#/$defs/object' }, [
      'x',
      'y',
    ]),
  ).toBe(true)
  expect(
    schemaHasUnaddressableDottedKey({ $defs: { self: { $ref: '#/$defs/self' } }, $ref: '#/$defs/self' }, ['x', 'y']),
  ).toBe(false)
})
