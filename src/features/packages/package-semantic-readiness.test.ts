import { beforeAll, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { loadPackageExampleContracts, readPackageExampleFiles } from '../../../scripts/validate-package-examples'
import { capturePackageExample } from '$src/lib/examples/package-example-analysis'

let contracts: Awaited<ReturnType<typeof loadPackageExampleContracts>>
let base: { path: string; text: string }[]
beforeAll(async () => {
  contracts = await loadPackageExampleContracts()
  base = (await readPackageExampleFiles('examples/packages/command-resources')).filter((f) => f.path !== 'digests.json')
})
async function analyze(edits: Record<string, string>) {
  const files = new Map(base.map((f) => [f.path, f.text]))
  for (const [path, text] of Object.entries(edits)) files.set(path, text)
  return (
    await capturePackageExample(
      {
        id: 'semantic-test',
        title: 'Test',
        summary: 'Test',
        readOnly: true,
        files: [...files].map(([path, text]) => ({ path, text })),
      },
      contracts,
    )
  ).analysis
}
const definitionPath = 'workflows/command-demo.yaml'
const definition = (nodes: string, name = 'command-demo') => `name: ${name}\ndescription: Test\nnodes:\n${nodes}`
const consumer = '  - id: summarize\n    command: summarize\n'
const producer = '  - id: producer\n    prompt: Produce\n'

it.each([
  ['extensionless root loop', 'review', false, false],
  ['non-Markdown suffix root loop', 'review.txt', false, false],
  ['extensionless scoped loop', 'review', true, false],
  ['shared command and loop body', 'review', false, true],
] as const)('analyzes command Markdown for %s', async (_label, resource, scoped, shared) => {
  const loop = { id: 'repeat', loop: { command: resource, max_iterations: 2, until: 'done' } }
  const nodes = scoped
    ? [{ id: 'group', loop_group: { max_iterations: 2, until: 'done', nodes: [loop] } }]
    : [...(shared ? [{ id: 'direct', command: resource }] : []), loop]
  const result = await analyze({
    [definitionPath]: stringify({ name: 'command-demo', description: 'Test', nodes }),
    [`commands/${resource}`]: '---\ndescription: Review supplied data\n---\nReview supplied data.\n',
  })
  expect(result.references.references).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'loop_command',
        nodeId: scoped ? 'group/repeat' : 'repeat',
        artifactPath: `commands/${resource}`,
      }),
    ]),
  )
  expect(result.blockers).toEqual([])
  expect(result.ready).toBe(true)
})

it('checks frontmatter in an extensionless loop command instead of reporting an unsupported script', async () => {
  const result = await analyze({
    [definitionPath]: stringify({
      name: 'command-demo',
      description: 'Test',
      nodes: [{ id: 'repeat', loop: { command: 'review', max_iterations: 2, until: 'done' } }],
    }),
    'commands/review': '---\ndescription: [unterminated\n---\nReview supplied data.\n',
  })
  expect(result.blockers).toContainEqual(
    expect.objectContaining({ path: 'commands/review', code: 'command_frontmatter_invalid' }),
  )
  expect(result.blockers.some((finding) => finding.code === 'package_analysis_required')).toBe(false)
  expect(result.ready).toBe(false)
})

it.each(['status', 'missing'])('checks authenticated structured output path %s', async (field) => {
  const result = await analyze({
    [definitionPath]: stringify({
      name: 'command-demo',
      description: 'Test',
      nodes: [
        {
          id: 'producer',
          prompt: 'Produce',
          output_format: { type: 'object', properties: { status: { type: 'string' } }, additionalProperties: false },
        },
        { id: 'summarize', command: 'summarize', depends_on: ['producer'] },
      ],
    }),
    'commands/summarize.md': `$producer.output.${field}\n`,
  })
  expect(result.ready).toBe(field === 'status')
  if (field === 'missing')
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'commands/summarize.md',
          code: 'structured_output_field_impossible',
          line: 1,
          column: 1,
        }),
      ]),
    )
})

it('reports the resource line after frontmatter and the exact consuming node', async () => {
  const result = await analyze({
    'commands/summarize.md': '---\ndescription: Body location\n---\nIntro\nUse $missing.output\n',
  })
  expect(result.blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'commands/summarize.md',
        line: 5,
        column: 5,
        message: expect.stringContaining('summarize (command)'),
      }),
    ]),
  )
})

it('converts authenticated scanner code-point positions to editor columns', async () => {
  const result = await analyze({
    'commands/summarize.md': '---\ndescription: Unicode location\n---\n😀 $missing.output\n',
  })
  expect(result.blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'commands/summarize.md',
        line: 4,
        column: 4,
      }),
    ]),
  )
})

it('scans loop command bodies according to the published authenticated surface', async () => {
  const result = await analyze({
    [definitionPath]: stringify({
      name: 'command-demo',
      description: 'Test',
      nodes: [{ id: 'repeat', loop: { command: 'summarize', max_iterations: 2, until: 'done' } }],
    }),
    'commands/summarize.md': '$missing.output\n',
  })
  expect(result.ready).toBe(false)
  expect(result.blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'commands/summarize.md',
        code: 'output_reference_not_declared_dependency',
        message: expect.stringContaining('repeat (loop.command)'),
      }),
    ]),
  )
})

it('binds a shared command to each workflow rather than reusing another workflow validation', async () => {
  const manifest = JSON.parse(base.find((f) => f.path === 'workflow-package.json')!.text)
  manifest.workflows.push({ definition: 'workflows/second.yaml', companion: 'workflows/second.hermes.yaml' })
  const result = await analyze({
    'workflow-package.json': JSON.stringify(manifest),
    [definitionPath]: definition(producer + consumer + '    depends_on: [producer]\n'),
    'workflows/second.yaml': definition(consumer, 'second'),
    'workflows/second.hermes.yaml': 'language_compatibility: archon-2026-07\n',
    'commands/summarize.md': '$producer.output\n',
  })
  expect(result.ready).toBe(false)
  expect(result.blockers).toEqual([
    expect.objectContaining({
      path: 'commands/summarize.md',
      code: 'output_reference_not_declared_dependency',
      message: expect.stringContaining('workflows/second.yaml'),
    }),
  ])
})

it('rejects duplicate workflow names across distinct declared paths', async () => {
  const manifest = JSON.parse(base.find((f) => f.path === 'workflow-package.json')!.text)
  manifest.workflows.push({ definition: 'workflows/second.yaml', companion: 'workflows/second.hermes.yaml' })
  const result = await analyze({
    'workflow-package.json': JSON.stringify(manifest),
    'workflows/second.yaml': definition(consumer),
    'workflows/second.hermes.yaml': 'language_compatibility: archon-2026-07\n',
  })
  expect(result.ready).toBe(false)
  expect(
    result.blockers
      .filter((f) => f.code === 'package_workflow_invalid')
      .map((f) => f.path)
      .sort(),
  ).toEqual([definitionPath, 'workflows/second.yaml'].sort())
})
it.each(['Command-demo', '" command-demo "'])('keeps upstream exact workflow name identity: %s', async (name) => {
  const manifest = JSON.parse(base.find((f) => f.path === 'workflow-package.json')!.text)
  manifest.workflows.push({ definition: 'workflows/second.yaml', companion: 'workflows/second.hermes.yaml' })
  const result = await analyze({
    'workflow-package.json': JSON.stringify(manifest),
    'workflows/second.yaml': definition(consumer, name),
    'workflows/second.hermes.yaml': 'language_compatibility: archon-2026-07\n',
  })
  expect(result.blockers).toEqual([])
  expect(result.ready).toBe(true)
})
it.each([
  ['unknown producer', consumer, '$missing.output\n', 'output_reference_not_declared_dependency'],
  ['undeclared producer', producer + consumer, '$producer.output\n', 'output_reference_not_declared_dependency'],
  [
    'missing structured schema',
    producer + consumer + '    depends_on: [producer]\n',
    '$producer.output.field\n',
    'output_reference_path_unsupported',
  ],
  [
    'malformed path',
    producer + consumer + '    depends_on: [producer]\n',
    '$producer.output..field\n',
    'output_reference_path_unsupported',
  ],
])('rejects authenticated command body: %s', async (_label, nodes, body, code) => {
  const result = await analyze({ [definitionPath]: definition(nodes), 'commands/summarize.md': body })
  expect(result.ready).toBe(false)
  expect(result.blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code,
        path: 'commands/summarize.md',
        message: expect.stringContaining(definitionPath),
      }),
    ]),
  )
})
it('accepts valid dependency body and ignores frontmatter as a reference surface', async () => {
  const result = await analyze({
    [definitionPath]: definition(producer + consumer + '    depends_on: [producer]\n'),
    'commands/summarize.md': '---\ndescription: $missing.output\n---\n$producer.output\n',
  })
  expect(result.blockers).toEqual([])
  expect(result.ready).toBe(true)
})
it('validates a shared resource separately for every consuming node', async () => {
  const result = await analyze({
    [definitionPath]: definition(
      producer + consumer + '    depends_on: [producer]\n  - id: other\n    command: summarize\n',
    ),
    'commands/summarize.md': '$producer.output\n',
  })
  expect(result.ready).toBe(false)
  expect(result.blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'commands/summarize.md', message: expect.stringContaining('other') }),
    ]),
  )
})
it('validates named scripts as text reference surfaces without executing them', async () => {
  const result = await analyze({
    [definitionPath]: definition('  - id: script\n    script: job\n    runtime: uv\n'),
    'scripts/job.py': 'print("$missing.output")\n',
  })
  expect(result.ready).toBe(false)
  expect(result.blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'scripts/job.py', code: 'output_reference_not_declared_dependency' }),
    ]),
  )
})
it.each([
  ['$a.output', false, 'scoped-reference-missing-dependency'],
  ['$LOOP_PREV.missing.output', false, 'scoped-reference-unknown-producer'],
  ['$LOOP_PREV.a.output', true, ''],
])('validates loop body authenticated reference %s', async (body, valid, code) => {
  const nodes =
    '  - id: g\n    loop_group:\n      until: done\n      max_iterations: 2\n      nodes:\n        - id: a\n          prompt: Produce\n        - id: b\n          command: summarize\n'
  const result = await analyze({ [definitionPath]: definition(nodes), 'commands/summarize.md': body + '\n' })
  expect(result.ready).toBe(valid)
  if (!valid)
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'commands/summarize.md', code, message: expect.stringContaining('b') }),
      ]),
    )
})
