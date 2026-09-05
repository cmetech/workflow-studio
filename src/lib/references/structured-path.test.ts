import { expect, it } from 'vitest'
import corpus from '../../../contracts/archon-2026-07-v6.corpus.json'
import { outputPathImpossible, schemaHasUnaddressableDottedKey } from './structured-path'
for (const fixture of corpus.structured_path_cases.filter((item) => item.api === '_v3_output_path_impossible'))
  it(fixture.id, () =>
    expect({ value: outputPathImpossible(fixture.input.schema, fixture.input.path), error: null }).toEqual(
      fixture.expected,
    ),
  )
it('requires explicit accounting for every published structured-path observation API', () => {
  for (const fixture of corpus.structured_path_cases)
    expect(['_v3_output_path_impossible', 'resolve_output_reference'], fixture.id).toContain(fixture.api)
})

it('compares numeric path segments exactly beyond the safe-integer boundary', () => {
  const schema = { type: 'array', maxItems: 9007199254740996 }
  expect(outputPathImpossible(schema, ['9007199254740995'])).toBe(false)
  expect(outputPathImpossible(schema, ['9007199254740996'])).toBe(true)
  expect(outputPathImpossible(schema, ['9007199254740997'])).toBe(true)
})

it('does not resolve array entries through the dotted-key helper local-reference path', () => {
  const schema = {
    $defs: {
      choice: {
        anyOf: [{ type: 'object', properties: { 'x.y': {} }, additionalProperties: false }],
      },
    },
    $ref: '#/$defs/choice/anyOf/0',
  }
  expect(outputPathImpossible(schema, ['x', 'y'])).toBe(true)
  expect(schemaHasUnaddressableDottedKey(schema, ['x', 'y'])).toBe(false)
  const mappingReference = { ...schema, $ref: '#/$defs/choice' }
  expect(schemaHasUnaddressableDottedKey(mappingReference, ['x', 'y'])).toBe(true)
})
