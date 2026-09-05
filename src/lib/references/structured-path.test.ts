import { expect, it } from 'vitest'
import corpus from '../../../contracts/archon-2026-07-v6.corpus.json'
import { outputPathImpossible } from './structured-path'
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
