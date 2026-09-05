import { expect, it } from 'vitest'
import corpus from '../../../contracts/archon-2026-07-v6.corpus.json'
import { scanReferences } from './scan-references'
import { SCANNER_UNICODE_PROFILE } from './unicode'
import { iterOutputReferences } from './grammar'
// These are AUTHORING observations of inputs used by Hermes runtime fixtures.
// They do not assert runtime rendered text, resource authentication, output
// resolution, shell materialization or package digest parity.
const names = [
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
]
const expectedSubstitutions: Record<string, unknown> = {
  'previous.render-masking': { outputs: ['previous:a:', 'ordinary:a:'], scalars: [], errors: [] },
  'previous.first-whole': { outputs: ['previous:a:'], scalars: [], errors: [] },
  'previous.first-field': { outputs: ['previous:a:x'], scalars: [], errors: [] },
  'previous.unknown-producer': { outputs: ['previous:a:'], scalars: [], errors: [] },
  'previous.shadowing': { outputs: ['ordinary:a:'], scalars: [], errors: [] },
  'scalar.names-prompt': { outputs: [], scalars: names, errors: [] },
  'scalar.names-bash': { outputs: [], scalars: names, errors: [] },
  'scalar.unknown-maximal': { outputs: [], scalars: ['USER_MESSAGE'], errors: [] },
  'scalar.positional': { outputs: [], scalars: ['1', '10', '11', '1'], errors: [] },
  'scalar.fallback-arguments': { outputs: [], scalars: ['1', '2'], errors: [] },
  'scalar.comment-prompt': { outputs: [], scalars: ['USER_MESSAGE'], errors: [] },
  'scalar.comment-bash': { outputs: [], scalars: [], errors: [] },
  'scalar.escape-prompt': { outputs: [], scalars: ['USER_MESSAGE'], errors: [] },
  'scalar.escape-bash': { outputs: [], scalars: [], errors: [] },
  'scalar.single': { outputs: [], scalars: ['USER_MESSAGE'], errors: [] },
  'scalar.double': { outputs: [], scalars: ['USER_MESSAGE'], errors: [] },
  'scalar.bare': { outputs: [], scalars: ['USER_MESSAGE'], errors: [] },
  'scalar.overlap-prompt': { outputs: ['ordinary:USER_MESSAGE:x'], scalars: ['USER_MESSAGE'], errors: [] },
  'scalar.overlap-bash': { outputs: ['ordinary:USER_MESSAGE:x'], scalars: ['USER_MESSAGE'], errors: [] },
  'scalar.nonrecursive': { outputs: ['ordinary:a:'], scalars: ['USER_MESSAGE'], errors: [] },
  'scalar.outputs-only': { outputs: ['ordinary:a:'], scalars: [], errors: [] },
  'scalar.unsafe': { outputs: [], scalars: [], errors: ['bash_reference_context_unsupported'] },
  'scalar.malformed-cause': { outputs: [], scalars: [], errors: ['output_reference_path_unsupported'] },
}
for (const fixture of corpus.substitution_cases) {
  it(`authoring scan mapped from Hermes rendering characterization: ${fixture.id}`, () => {
    const result = scanReferences(fixture.input.text, fixture.api.endsWith('render_bash') ? 'bash' : 'text', {
      normalizerVersion: fixture.normalizer_version,
      unicodeProfile: SCANNER_UNICODE_PROFILE,
      includeScalars: !fixture.api.endsWith('render_outputs'),
    })
    const actual = {
      outputs: result.references.map((r) => `${r.kind}:${r.producerId}:${r.path.join('.')}`),
      scalars: result.scalars.map((r) => r.name),
      errors: result.errors.map((e) => e.code),
    }
    expect(actual).toEqual(expectedSubstitutions[fixture.id])
  })
}
const resourceExpected: Record<string, unknown> = {
  'resource.command-v2': ['unsupported-normalizer'],
  'resource.command-v3-missing': [['ordinary:producer:']],
  'resource.command-v3-valid': [['ordinary:producer:']],
  'resource.script-v3': [['ordinary:producer:']],
  'resource.script-v4': [['ordinary:producer:']],
  'resource.script-v6': [['ordinary:producer:']],
  'resource.digest-invalid-before': ['non-UTF8-resource-characterization'],
  'resource.digest-invalid-after': ['non-UTF8-resource-characterization'],
  'resource.digest-valid-before-malformed': [['output_reference_path_unsupported']],
  'resource.digest-valid-after-malformed': [['output_reference_path_unsupported']],
  'resource.digest-reference-free': ['non-UTF8-resource-characterization'],
  'resource.digest-command-v2': ['unsupported-normalizer'],
  'resource.digest-command-v3': ['non-UTF8-resource-characterization'],
  'resource.ordered-script-errors': [['ordinary:producer:'], ['ordinary:producer:']],
  'resource.body-command-current-missing': [['ordinary:a:']],
  'resource.body-command-previous-unknown': [['previous:missing:']],
}
interface ResourceInput {
  readonly command_bodies?: Record<string, string>
  readonly named_script_bodies?: Record<string, string>
  readonly resource_hex?: Record<string, string>
}
function resourceAuthoringObservation(input: ResourceInput, version: number): unknown {
  if (version < 3) return ['unsupported-normalizer']
  let texts: string[]
  try {
    texts = input.resource_hex
      ? Object.values(input.resource_hex).map((hex) =>
          new TextDecoder('utf8', { fatal: true }).decode(
            Uint8Array.from(hex.match(/../g)!.map((byte) => parseInt(byte, 16))),
          ),
        )
      : [...Object.values(input.command_bodies ?? {}), ...Object.values(input.named_script_bodies ?? {})]
  } catch {
    return ['non-UTF8-resource-characterization']
  }
  return texts.map((text) => {
    const scan = scanReferences(text, 'text', { normalizerVersion: version, unicodeProfile: SCANNER_UNICODE_PROFILE })
    return scan.errors.length
      ? scan.errors.map((e) => e.code)
      : scan.references.map((r) => `${r.kind}:${r.producerId}:${r.path.join('.')}`)
  })
}
for (const fixture of corpus.scanner_cases.filter((f) =>
  ['validate_authenticated_resource_references', 'compute_package_digest'].includes(f.api),
)) {
  it(`authoring text mapped from Hermes authenticated-resource characterization: ${fixture.id}`, () => {
    expect(resourceAuthoringObservation(fixture.input as ResourceInput, fixture.normalizer_version as number)).toEqual(
      resourceExpected[fixture.id],
    )
  })
}
const outputPathExpected: Record<string, unknown> = {
  'path.resolve-whole': [],
  'path.resolve-mapping': ['x'],
  'path.resolve-array': ['items', '0'],
  'path.resolve-leading-zero-key': 'unsupported-authoring-path',
  'path.resolve-leading-zero-index': 'unsupported-authoring-path',
  'path.resolve-missing': ['missing'],
  'path.resolve-schemaless': ['x'],
  'path.resolve-missing-output': ['x'],
}
for (const fixture of corpus.structured_path_cases.filter((f) => f.api === 'resolve_output_reference')) {
  it(`authoring grammar mapped from Hermes runtime output characterization: ${fixture.id}`, () => {
    const text = `$${fixture.input.node_id}.output${fixture.input.path.map((p) => '.' + p).join('')}`
    let actual: unknown
    try {
      actual = Array.from(iterOutputReferences(text, 6))[0]!.path
    } catch {
      actual = 'unsupported-authoring-path'
    }
    expect(actual).toEqual(outputPathExpected[fixture.id])
  })
}
it('requires explicit authoring coverage for every runtime rendering characterization', () => {
  expect(Object.keys(expectedSubstitutions).sort()).toEqual(corpus.substitution_cases.map((f) => f.id).sort())
  expect(Object.keys(resourceExpected).sort()).toEqual(
    corpus.scanner_cases
      .filter((f) => ['validate_authenticated_resource_references', 'compute_package_digest'].includes(f.api))
      .map((f) => f.id)
      .sort(),
  )
  expect(Object.keys(outputPathExpected).sort()).toEqual(
    corpus.structured_path_cases
      .filter((f) => f.api === 'resolve_output_reference')
      .map((f) => f.id)
      .sort(),
  )
})
