/** Development-only deterministic oracle runner. Requires explicit read-only
 * Hermes checkout and Python executable; it never renders or executes workflows. */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { observeScannerCase, type ObservationInput } from '../src/lib/references/test-observations'
import { outputPathImpossible } from '../src/lib/references/structured-path'
import { SCANNER_UNICODE_PROFILE } from '../src/lib/references/unicode'
const python = process.env.HERMES_SCANNER_PYTHON,
  hermes = process.env.HERMES_SCANNER_ROOT
if (!python || !hermes)
  throw new Error('Set HERMES_SCANNER_PYTHON and HERMES_SCANNER_ROOT to the pinned read-only oracle.')
const seed = 0x6a202609
let state = seed
const random = (max: number) => {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return (state >>> 0) % max
}
const pick = <T>(values: readonly T[]): T => values[random(values.length)]!
interface DifferentialCase extends ObservationInput {
  readonly id: string
}
const cases: DifferentialCase[] = []
const producers = ['a', 'A', 'USER_MESSAGE', '_ok', 'a-b', 'a.b', '1bad', 'é', '𑼀', '😀', '']
const suffixes = [
  '',
  '.x',
  '.0',
  '.01',
  '.x-y',
  '.x.2',
  'x',
  '_',
  '/x',
  '[0]',
  '\\x',
  'é',
  '😀',
  '́',
  ']',
  '$a.output',
  '$USER_MESSAGE',
  '.',
  ':',
  ',',
  ';',
]
const prefixes = ['', '😀 ', 'é ', '$UNKNOWN', '\\', '# ', '$$', '${other:-', "$'", 'x']
const modes = [
  'iter_output_references',
  'iter_loop_previous_output_references',
  'iter_output_reference_candidate_spans',
  'contains_output_reference',
]
for (let i = 0; i < 1600; i++) {
  const text =
    pick(prefixes) +
    '$' +
    (random(3) === 0 ? 'LOOP_PREV.' : '') +
    pick(producers) +
    '.output' +
    pick(suffixes) +
    pick(['', ' $b.output', ' $bad.outputx', "'", '}'])
  cases.push({
    id: `grammar-${i}`,
    api: pick(modes),
    normalizer_version: pick([3, 4, 5, 6]),
    input: { text, consume: pick(['first', 'all']) },
  })
}
const references = [
  '$a.output',
  '$a.output.x',
  '$a.outputx',
  '$LOOP_PREV.b.output',
  '$USER_MESSAGE',
  '$1',
  '$UNKNOWN',
  '$USER_MESSAGE.output',
  '$a.output$USER_MESSAGE',
]
const wrappers = [
  ['echo ', ''],
  ["echo '", "'"],
  ['echo "', '"'],
  ['echo \\', ''],
  ['# ', '\necho ok'],
  ['echo $$', ''],
  ['echo $(', ')'],
  ['echo `', '`'],
  ['echo ${X:-', '}'],
  ['echo $((', '))'],
  ['echo $[', ']'],
  ['(( ', ' ))'],
  ['[[ ', ' == x ]]'],
  ["echo $'", "'"],
  ['echo @(', '|x)'],
  ['echo x{', ',y}'],
  ['cat <(', ' )'],
  ['cat >(', ' )'],
  ['x[', ']=v'],
  ['declare -i x=', ''],
  ['let x=', ''],
  ['a=([', ']=x)'],
  ['a=(', ')'],
  ['function ', ' { :; }'],
  ['coproc ', ' { :; }'],
  ['cat <<EOF\n', '\nEOF\n'],
  ["cat <<'EOF'\n", '\nEOF\n'],
  ['cat <<-EOF\n\t', '\n\tEOF\n'],
  ['cat <<<', ''],
  ['echo ', ' 2>/dev/null'],
  ['echo "$(', ')"'],
  ['echo "$(case x in x) echo ', ';; esac)"'],
  ['command -p declare -i x=', ''],
  ['builtin -- let ', ''],
  ['echo ', '\\\n'],
  ['echo ', '"'],
  ['cat <<EOF\n', ''],
  ['echo $(function f { case x in x) echo ', ';; esac; })'],
]
for (let i = 0; i < 3200; i++) {
  let text = pick(references)
  const depth = 1 + random(4)
  for (let n = 0; n < depth; n++) {
    const [before, after] = pick(wrappers)
    text = before + text + after
  }
  text =
    pick(['', '😀 ', 'x=1 ', '2>/dev/null ', 'echo safe; ']) +
    text +
    pick(['', '\necho $a.output', '; echo \\$bad.outputx'])
  cases.push({
    id: `bash-${i}`,
    api: random(5) === 0 ? 'bash_loop_previous_output_references' : 'bash_output_references',
    normalizer_version: pick([3, 6]),
    input: { text },
  })
}
for (let i = 0; i < 600; i++) {
  const ref = () => '$' + (random(4) === 0 ? 'LOOP_PREV.' : '') + pick(producers) + '.output' + pick(suffixes),
    rhs = () => pick([ref(), "'literal $bad.outputx'", '1', '.2', '-1.', '"x"', 'true', ''])
  let text = ref() + pick([' == ', ' != ', ' < ', ' <= ', ' > ', ' >= ', ' ? ']) + rhs()
  if (random(2)) text += pick([' && ', ' || ', ';', '\u0085']) + ref() + ' == ' + rhs()
  text = pick(['', '😀', '\t', '\u001c']) + text
  cases.push({
    id: `condition-${i}`,
    api: pick(['iter_when_output_references', 'validate_v3_condition_syntax', 'validate_v6_condition_syntax']),
    normalizer_version: 6,
    input: { text, consume: pick(['first', 'all']) },
  })
}
for (let i = 0; i < 600; i++) {
  const text = pick(['😀 ', '']) + pick(references) + pick(['', ' ' + pick(references), ' ' + pick(references) + 'x']),
    length = Array.from(text).length,
    start = random(length + 2) - 1,
    end = random(length + 3),
    spans =
      random(3) === 0
        ? [
            [0, length],
            [start, end],
          ]
        : [[start, end]]
  cases.push({
    id: `span-${i}`,
    api: pick(['classify_bash_reference_spans', 'iter_output_references_in_spans']),
    normalizer_version: 6,
    input: { text, spans, consume: pick(['first', 'all']) },
  })
}
const types = ['object', 'array', 'string', ['object', 'array'], undefined]
function schema(depth: number): unknown {
  if (depth === 0) return pick([true, false, {}, { type: pick(types) }])
  const child = () => schema(depth - 1)
  return pick([
    {
      type: pick(types),
      properties: { x: child(), '0': child(), 'x.y': child() },
      additionalProperties: pick([false, true, child()]),
    },
    {
      type: pick(types),
      maxItems: random(4),
      prefixItems: [child()],
      items: pick([child(), [child(), child()]]),
      additionalItems: child(),
    },
    { type: pick(types), anyOf: [child(), child()] },
    { allOf: [child(), child()] },
    { oneOf: [child(), child()] },
    { $defs: { value: child() }, $ref: '#/$defs/value', type: pick(types) },
    { $ref: '#/$defs/self', $defs: { self: { $ref: '#/$defs/self' } } },
  ])
}
for (let i = 0; i < 1000; i++)
  cases.push({
    id: `path-${i}`,
    api: '_v3_output_path_impossible',
    normalizer_version: 6,
    input: {
      schema: schema(2),
      path: pick([[], ['x'], ['0'], ['01'], ['x', '0'], ['0', 'x'], ['x', 'y'], ['9999999999999999999999'], ['²']]),
    },
  })
const program = `import sys,json,runpy\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\napi=runpy.run_path(str(Path(sys.argv[1])/'tests/plugins/workflow/reference_scanner_observations.py'))\nassert api['profile_id']()==sys.argv[2]\nfor case in json.load(sys.stdin):\n result=api['observe_structured_path_case'](case) if case['api']=='_v3_output_path_impossible' else api['observe_scanner_case'](case,Path('/unused-authoring-only'))\n print(json.dumps(result,ensure_ascii=True))\n`
const oracle = spawnSync(python, ['-B', '-c', program, resolve(hermes), SCANNER_UNICODE_PROFILE], {
  input: JSON.stringify(cases),
  encoding: 'utf8',
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  maxBuffer: 16 * 1024 * 1024,
})
if (oracle.status !== 0) throw new Error(oracle.stderr)
const expected = oracle.stdout
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
if (expected.length !== cases.length) throw new Error('Oracle observation count mismatch')
const mismatches = []
for (const [i, fixture] of cases.entries()) {
  const actual =
    fixture.api === '_v3_output_path_impossible'
      ? { value: outputPathImpossible(fixture.input.schema, fixture.input.path as string[]), error: null }
      : observeScannerCase(fixture)
  if (!isDeepStrictEqual(actual, expected[i])) mismatches.push({ fixture, actual, expected: expected[i] })
}
const report = {
  seed,
  profile: SCANNER_UNICODE_PROFILE,
  cases: cases.length,
  families: { grammar: 1600, bash: 3200, condition: 600, span: 600, path: 1000 },
  mismatches,
}
if (process.env.SCANNER_DIFFERENTIAL_REPORT)
  writeFileSync(process.env.SCANNER_DIFFERENTIAL_REPORT, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, mismatches: mismatches.length }))
if (mismatches.length) {
  console.log(JSON.stringify(mismatches.slice(0, 8), null, 2))
  process.exitCode = 1
}
