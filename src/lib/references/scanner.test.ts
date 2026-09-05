import { expect, it } from 'vitest'
import corpus from '../../../contracts/archon-2026-07-v6.corpus.json'
import { observeScannerCase } from './test-observations'
import { SCANNER_UNICODE_PROFILE, requireUnicodeProfile } from './unicode'
// API and inputs alone select observations. Only these assertions access expected.
for (const fixture of corpus.scanner_cases) {
  if (['validate_authenticated_resource_references', 'compute_package_digest'].includes(fixture.api)) continue
  if (!fixture.unicode_profiles.includes('all') && !fixture.unicode_profiles.includes(SCANNER_UNICODE_PROFILE)) {
    it(`explicit unsupported-profile characterization: ${fixture.id}`, () => {
      for (const profile of fixture.unicode_profiles) expect(() => requireUnicodeProfile(profile)).toThrow(/profile/)
    })
    continue
  }
  it(fixture.id, () => expect(observeScannerCase(fixture)).toEqual(fixture.expected))
}

it('admitted-span observation keeps Python type errors lazy after an emitted token', () => {
  expect(
    observeScannerCase({
      api: 'iter_output_references_in_spans',
      normalizer_version: 6,
      input: {
        text: '$a.output $b.output',
        spans: [
          [0, 9],
          [10.5, 20],
        ],
        consume: 'all',
      },
    }),
  ).toEqual({ tokens: [{ node_id: 'a', path: [], start: 0, end: 9 }], error: { class: 'ValueError' } })
  expect(
    observeScannerCase({
      api: 'iter_output_references_in_spans',
      normalizer_version: 6,
      input: {
        text: '$a.output $b.output',
        spans: [
          [0, 9],
          [10.5, 18],
        ],
        consume: 'all',
      },
    }),
  ).toEqual({ tokens: [{ node_id: 'a', path: [], start: 0, end: 9 }], error: { class: 'TypeError' } })
})
