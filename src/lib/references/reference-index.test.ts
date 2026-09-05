import { beforeAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import type { AuthoringContract } from '$src/lib/contract/types'
import { projectWorkflow } from '$src/lib/projection/project-workflow'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import {
  buildReferenceIndex,
  prepareReferenceContract,
  preparedReferenceContractBuildCountForTest,
  referenceSurfaceForField,
} from './reference-index'

let contract: AuthoringContract

const SCAN_SURFACE_PATHS = [
  'nodes[].when',
  'nodes[].loop_group.nodes[].when',
  'nodes[].prompt',
  'nodes[].loop_group.nodes[].prompt',
  'nodes[].bash',
  'nodes[].loop_group.nodes[].bash',
  'nodes[].script',
  'nodes[].loop_group.nodes[].script',
  'nodes[].loop.prompt',
  'nodes[].loop_group.nodes[].loop.prompt',
  'nodes[].loop.until_bash',
  'nodes[].loop_group.nodes[].loop.until_bash',
  'nodes[].loop.gate_message',
  'nodes[].loop_group.nodes[].loop.gate_message',
  'nodes[].approval.message',
  'nodes[].loop_group.nodes[].approval.message',
  'nodes[].approval.on_reject.prompt',
  'nodes[].loop_group.nodes[].approval.on_reject.prompt',
  'nodes[].loop_group.until_bash',
  'nodes[].loop_group.gate_message',
  'nodes[].systemPrompt',
  'nodes[].loop_group.nodes[].systemPrompt',
  'nodes[].agents.*.description',
  'nodes[].agents.*.prompt',
  'nodes[].loop_group.nodes[].agents.*.description',
  'nodes[].loop_group.nodes[].agents.*.prompt',
  'nodes[].hooks.*[].response.systemMessage',
  'nodes[].hooks.*[].response.stopReason',
  'nodes[].hooks.*[].response.hookSpecificOutput.permissionDecisionReason',
  'nodes[].hooks.*[].response.hookSpecificOutput.additionalContext',
  'nodes[].loop_group.nodes[].hooks.*[].response.systemMessage',
  'nodes[].loop_group.nodes[].hooks.*[].response.stopReason',
  'nodes[].loop_group.nodes[].hooks.*[].response.hookSpecificOutput.permissionDecisionReason',
  'nodes[].loop_group.nodes[].hooks.*[].response.hookSpecificOutput.additionalContext',
] as const

beforeAll(async () => {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
    kind: 'bundled',
    identifier: 'archon-2026-07-v6.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  contract = loaded.contract
})

function indexed(definition: Record<string, unknown>) {
  const text = stringify(definition)
  const parsed = parseWorkflowYaml(text, { document: 'definition', maxBytes: 2 * 1024 * 1024 }).parsed
  if (!parsed) throw new Error('Expected a parsed definition.')
  const projection = projectWorkflow(parsed, null, 'archon-2026-07', contract).projection
  const prepared = prepareReferenceContract(contract)
  if (!prepared) throw new Error('Expected reader-3 reference capabilities.')
  return buildReferenceIndex(definition, projection, prepared)
}

describe('indexed reference discovery', () => {
  it('prepares one immutable contract capability for repeated consumers', () => {
    const before = preparedReferenceContractBuildCountForTest()
    const first = prepareReferenceContract(contract)
    const second = prepareReferenceContract(contract)

    expect(first).toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(preparedReferenceContractBuildCountForTest() - before).toBe(1)
  })

  it('queries absent compatible fields from the prepared public surface without scanning a document', () => {
    const prepared = prepareReferenceContract(contract)
    if (!prepared) throw new Error('Expected reader-3 reference capabilities.')

    expect(referenceSurfaceForField(prepared, 'body', 'nodes[].prompt', '', 'outer')).toEqual({
      canonicalFieldPath: 'nodes[].prompt',
      scope: 'body',
      mode: 'text',
      previousOutputs: true,
      callerPolicy: 'body-text-references',
      authoredValue: 'reference-template',
    })
    expect(referenceSurfaceForField(prepared, 'body', 'nodes[].command', '', 'outer')).toBeNull()
  })

  it('applies exact namespace, group-control, and inline-script eligibility', () => {
    const prepared = prepareReferenceContract(contract)
    if (!prepared) throw new Error('Expected reader-3 reference capabilities.')

    expect(referenceSurfaceForField(prepared, 'body', 'nodes[].script', 'jobs/report.py', 'outer')).toBeNull()
    expect(referenceSurfaceForField(prepared, 'body', 'nodes[].script', 'echo $outer.output', 'outer')).not.toBeNull()
    expect(
      referenceSurfaceForField(prepared, 'group-control', 'nodes[].loop_group.until_bash', 'test done', 'previous'),
    ).not.toBeNull()
    expect(
      referenceSurfaceForField(prepared, 'group-control', 'nodes[].loop_group.gate_message', 'ready', 'previous'),
    ).toBeNull()
    expect(
      referenceSurfaceForField(prepared, 'group-control', 'nodes[].loop_group.gate_message', 'ready', 'current'),
    ).toBeNull()
    expect(
      referenceSurfaceForField(prepared, 'group-control', 'nodes[].loop_group.gate_message', 'ready', 'outer'),
    ).not.toBeNull()
  })

  it('traverses the published root, body, and group-control inventory once in native order', () => {
    const reference = 'Use $producer.output'
    const phase4 = {
      systemPrompt: reference,
      agents: {
        first: { description: reference, prompt: reference },
        second: { description: reference, prompt: reference },
      },
      hooks: {
        PreToolUse: [
          {
            response: {
              systemMessage: reference,
              stopReason: reference,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                permissionDecisionReason: reference,
                additionalContext: reference,
              },
            },
          },
        ],
      },
    }
    const body = [
      { id: 'body-prompt', prompt: reference, when: '$producer.output == ready', ...phase4 },
      { id: 'body-bash', bash: reference, ...phase4 },
      { id: 'body-script', script: `print('${reference}')`, runtime: 'uv', ...phase4 },
      {
        id: 'body-loop',
        loop: { prompt: reference, until_bash: reference, gate_message: reference, command: 'named-command' },
        ...phase4,
      },
      { id: 'body-approval', approval: { message: reference, on_reject: { prompt: reference } }, ...phase4 },
      { id: 'body-command', command: 'named-command', ...phase4 },
      { id: 'body-cancel', cancel: 'stop', ...phase4 },
    ]
    const root = [
      { id: 'producer', prompt: 'Produce.' },
      { id: 'root-prompt', prompt: reference, when: '$producer.output == ready', ...phase4 },
      { id: 'root-bash', bash: reference, ...phase4 },
      { id: 'root-script', script: `print('${reference}')`, runtime: 'uv', ...phase4 },
      {
        id: 'root-loop',
        loop: { prompt: reference, until_bash: reference, gate_message: reference, command: 'named-command' },
        ...phase4,
      },
      { id: 'root-approval', approval: { message: reference, on_reject: { prompt: reference } }, ...phase4 },
      { id: 'root-command', command: 'named-command', ...phase4 },
      { id: 'root-cancel', cancel: 'stop', ...phase4 },
      {
        id: 'group',
        loop_group: {
          until: 'done',
          max_iterations: 1,
          until_bash: reference,
          gate_message: reference,
          nodes: body,
        },
        ...phase4,
      },
    ]

    const index = indexed({ name: 'Inventory', description: 'All authored scanner surfaces.', nodes: root })
    const surfacePaths = new Set(index.occurrences.map(({ surfacePath }) => surfacePath))

    expect(surfacePaths).toEqual(new Set(SCAN_SURFACE_PATHS))
    expect(index.occurrences.some(({ surfacePath }) => surfacePath.endsWith('.command'))).toBe(false)
    expect(index.metrics).toMatchObject({ indexBuilds: 1, definitionTraversals: 1 })
    expect(index.metrics.occurrenceScans).toBe(index.occurrences.length)
  })

  it('covers every scan-eligible published surface through production workflow analysis', async () => {
    const reference = 'Use $producer.output'
    const condition = '$producer.output == 1'
    const phase4 = {
      systemPrompt: reference,
      agents: { reviewer: { description: reference, prompt: reference } },
      hooks: {
        PreToolUse: [
          {
            response: {
              systemMessage: reference,
              stopReason: reference,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                permissionDecisionReason: reference,
                additionalContext: reference,
              },
            },
          },
        ],
      },
    }
    const loopPrompt = {
      prompt: reference,
      until: 'done',
      max_iterations: 1,
      until_bash: reference,
      gate_message: reference,
    }
    const loopCommand = { command: 'named-command', until: 'done', max_iterations: 1 }
    const body = [
      { id: 'body-prompt', prompt: reference, when: condition, ...structuredClone(phase4) },
      { id: 'body-bash', bash: reference },
      { id: 'body-script', script: `print('${reference}')`, runtime: 'uv' },
      { id: 'body-loop-prompt', loop: structuredClone(loopPrompt) },
      { id: 'body-loop-command', loop: loopCommand },
      { id: 'body-approval', approval: { message: reference, on_reject: { prompt: reference } } },
      { id: 'body-command', command: 'named-command' },
    ]
    const nodes = [
      { id: 'producer', command: 'named-producer' },
      {
        id: 'root-prompt',
        depends_on: ['producer'],
        prompt: reference,
        when: condition,
        ...structuredClone(phase4),
      },
      { id: 'root-bash', depends_on: ['producer'], bash: reference },
      { id: 'root-script', depends_on: ['producer'], script: `print('${reference}')`, runtime: 'uv' },
      { id: 'root-loop-prompt', depends_on: ['producer'], loop: structuredClone(loopPrompt) },
      { id: 'root-loop-command', loop: loopCommand },
      {
        id: 'root-approval',
        depends_on: ['producer'],
        approval: { message: reference, on_reject: { prompt: reference } },
      },
      { id: 'root-command', command: 'named-command' },
      {
        id: 'group',
        depends_on: ['producer'],
        loop_group: {
          until: 'done',
          max_iterations: 1,
          until_bash: reference,
          gate_message: reference,
          nodes: body,
        },
      },
    ]
    const definition = { name: 'Production inventory', description: 'Exercise every scanner surface.', nodes }
    const analyze = (value: unknown, requestId: string) =>
      analyzeWorkflowPair(
        {
          type: 'analyze',
          requestId,
          workflowId: requestId,
          pairGeneration: 0,
          definition: { path: 'workflow.yaml', text: stringify(value), revision: 0 },
          companion: {
            path: 'workflow.hermes.yaml',
            text: 'language_compatibility: archon-2026-07\n',
            revision: 0,
          },
          profile: contract.profile,
          contractDigest: contract.contract_digest,
          reason: 'explicit-validate',
        },
        contract,
      )
    const analysis = await analyze(definition, 'production-inventory')

    expect(analysis.issues.filter(({ blocking }) => blocking)).toEqual([])
    expect(analysis.structurallyValid).toBe(true)
    const occurrences = analysis.referenceIndex?.occurrences ?? []
    expect(occurrences).toHaveLength(SCAN_SURFACE_PATHS.length)
    expect(new Set(occurrences.map(({ surfacePath }) => surfacePath))).toEqual(new Set(SCAN_SURFACE_PATHS))

    for (const occurrence of occurrences) {
      const invalid = structuredClone(definition)
      setValueAtPath(
        invalid,
        occurrence.valuePath,
        occurrence.authoredText.replaceAll('$producer.output', '$missing.output'),
      )
      const result = await analyze(invalid, `invalid:${occurrence.surfacePath}`)
      const path = `/${occurrence.valuePath.join('/')}`
      const code =
        occurrence.scope === 'root' ? 'output_reference_not_declared_dependency' : 'scoped-reference-missing-dependency'
      expect(
        result.issues.filter(({ blocking }) => blocking).map((issue) => ({ code: issue.code, path: issue.path })),
        occurrence.surfacePath,
      ).toEqual([{ code, path }])
    }
  })

  it('retains distinct tokens, code-point spans, source paths, and resolved producer namespaces', () => {
    const index = indexed({
      name: 'Spans',
      description: 'Unicode and duplicate occurrence fixture.',
      nodes: [
        { id: 'outer', prompt: 'Produce.' },
        {
          id: 'group',
          depends_on: ['outer'],
          loop_group: {
            until: 'done',
            max_iterations: 1,
            nodes: [
              { id: 'producer', prompt: 'Produce.' },
              {
                id: 'consumer',
                depends_on: ['producer'],
                prompt: '🚀 $producer.output + $producer.output + $outer.output + $LOOP_PREV.producer.output',
              },
            ],
          },
        },
      ],
    })
    const occurrence = index.occurrences.find(
      ({ consumerId, field }) => consumerId === 'consumer' && field === 'prompt',
    )

    expect(occurrence).toMatchObject({
      scopeKey: 'loop-group:group',
      groupId: 'group',
      valuePath: ['nodes', 1, 'loop_group', 'nodes', 1, 'prompt'],
      authoredText: '🚀 $producer.output + $producer.output + $outer.output + $LOOP_PREV.producer.output',
      mode: 'text',
    })
    expect(
      occurrence?.references.map(({ kind, producerId, start, resolvedProducer }) => ({
        kind,
        producerId,
        start,
        namespace: resolvedProducer?.namespace,
        scopeKey: resolvedProducer?.scopeKey,
      })),
    ).toEqual([
      { kind: 'ordinary', producerId: 'producer', start: 2, namespace: 'body', scopeKey: 'loop-group:group' },
      { kind: 'ordinary', producerId: 'producer', start: 21, namespace: 'body', scopeKey: 'loop-group:group' },
      { kind: 'ordinary', producerId: 'outer', start: 40, namespace: 'root', scopeKey: 'root' },
      { kind: 'previous', producerId: 'producer', start: 56, namespace: 'previous', scopeKey: 'loop-group:group' },
    ])
  })

  it('keeps named command and named-script resource values literal while scanning inline scripts', () => {
    const index = indexed({
      name: 'Discriminator',
      description: 'Only authored inline scripts are reference templates.',
      nodes: [
        { id: 'named', script: 'jobs/report.py' },
        { id: 'inline', script: "print('$missing.output')", runtime: 'uv' },
        { id: 'command', command: '$missing.output' },
      ],
    })

    expect(index.occurrences.map(({ consumerId }) => consumerId).filter((id) => id !== 'inline')).toEqual([])
    expect(index.occurrences[0]?.references).toEqual([
      expect.objectContaining({ kind: 'ordinary', producerId: 'missing' }),
    ])
  })

  it('visits shared mapping and sequence containers once per node traversal', () => {
    const definition = {
      name: 'Observed traversal',
      description: 'Container getters reveal repeated full-path expansion.',
      nodes: [{ id: 'consumer', prompt: 'Consume.' }],
    }
    const text = stringify(definition)
    const parsed = parseWorkflowYaml(text, { document: 'definition', maxBytes: 2 * 1024 * 1024 }).parsed
    if (!parsed) throw new Error('Expected a parsed definition.')
    const projection = projectWorkflow(parsed, null, 'archon-2026-07', contract).projection
    let agentReads = 0
    let hookReads = 0
    const observedNode = {
      id: 'consumer',
      prompt: 'Consume.',
      get agents() {
        agentReads += 1
        return { reviewer: { description: 'Use $missing.output', prompt: 'Use $missing.output' } }
      },
      get hooks() {
        hookReads += 1
        return { PreToolUse: [{ response: { systemMessage: 'Use $missing.output' } }] }
      },
    }
    const prepared = prepareReferenceContract(contract)
    if (!prepared) throw new Error('Expected reader-3 reference capabilities.')

    const index = buildReferenceIndex({ ...definition, nodes: [observedNode] }, projection, prepared)

    expect(agentReads).toBe(1)
    expect(hookReads).toBe(1)
    expect(index.occurrences.map(({ field }) => field)).toContain('agents.reviewer.description')
    expect(index.occurrences.map(({ field }) => field)).toContain('hooks.PreToolUse.response.systemMessage')
  })
})

function setValueAtPath(value: unknown, path: readonly (string | number)[], replacement: string): void {
  let current = value
  for (const segment of path.slice(0, -1)) {
    if (current === null || typeof current !== 'object') throw new Error(`Missing inventory path ${path.join('.')}`)
    current = (current as Record<string | number, unknown>)[segment]
  }
  if (current === null || typeof current !== 'object') throw new Error(`Missing inventory path ${path.join('.')}`)
  const container = current as Record<string | number, unknown>
  container[path.at(-1)!] = replacement
}
