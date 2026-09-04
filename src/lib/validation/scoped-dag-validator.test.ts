import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import type { AuthoringContract } from '$src/lib/contract/types'
import { projectWorkflow } from '$src/lib/projection/project-workflow'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import type { ParsedYamlDocument } from '$src/lib/yaml/types'
import { validateScopedDag } from './scoped-dag-validator'

let contract: AuthoringContract

beforeAll(async () => {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
    kind: 'bundled',
    identifier: 'archon-2026-07-v6.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  contract = loaded.contract
})

function validate(
  nodes: readonly Record<string, unknown>[],
  companion: Record<string, unknown> | null = { language_compatibility: 'archon-2026-07' },
) {
  const definitionText = stringify({ name: 'Scoped', description: 'Scoped validation fixture.', nodes })
  const definition = parsed(definitionText, 'definition')
  const companionDocument = companion ? parsed(stringify(companion), 'companion') : null
  const projection = projectWorkflow(definition, companionDocument, 'archon-2026-07', contract).projection
  return validateScopedDag(projection, definition, companionDocument, contract)
}

function parsed(text: string, document: 'definition' | 'companion'): ParsedYamlDocument {
  const result = parseWorkflowYaml(text, { document, maxBytes: 2 * 1024 * 1024 })
  if (!result.parsed) throw new Error(`Expected valid ${document} YAML.`)
  return result.parsed
}

function loopGroup(
  body: readonly Record<string, unknown>[],
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'group',
    loop_group: { until: 'done', max_iterations: 1, nodes: body, ...options },
  }
}

function codes(result: ReturnType<typeof validate>): string[] {
  return result.issues.filter(({ blocking }) => blocking).map(({ code }) => code)
}

describe('scoped DAG validation', () => {
  it('rejects duplicate IDs within a body for arbitrary valid identifiers', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_-]{0,20}$/), (id) => {
        const result = validate([
          loopGroup([
            { id, prompt: 'First.' },
            { id, bash: 'true' },
          ]),
        ])
        expect(codes(result)).toContain('loop_group_topology_invalid')
      }),
    )
  })

  it('accepts arbitrary source-order permutations of an acyclic body', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 8 }), (order) => {
        const position = new Map(order.map((value, index) => [value, index]))
        const body = order.map((value) => {
          const dependencies = order.filter((candidate) => (position.get(candidate) ?? 0) < (position.get(value) ?? 0))
          return {
            id: `node-${value}`,
            prompt: 'Work.',
            ...(dependencies.length > 0 ? { depends_on: [dependencies.at(-1)].map((id) => `node-${id}`) } : {}),
          }
        })
        expect(codes(validate([loopGroup(body)]))).toEqual([])
      }),
    )
  })

  it('rejects insertion of a cycle for arbitrary chain lengths', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 30 }), (count) => {
        const body = Array.from({ length: count }, (_, index) => ({
          id: `node-${index}`,
          prompt: 'Work.',
          depends_on: [index === 0 ? `node-${count - 1}` : `node-${index - 1}`],
        }))
        expect(codes(validate([loopGroup(body)]))).toContain('loop_group_topology_invalid')
      }),
    )
  })

  it('locates a body cycle at the scoped graph source rather than the root nodes path', () => {
    const result = validate([
      loopGroup([
        { id: 'first', prompt: 'First.', depends_on: ['second'] },
        { id: 'second', prompt: 'Second.', depends_on: ['first'] },
      ]),
    ])

    const issue = result.issues.find(({ code }) => code === 'loop_group_topology_invalid')
    expect(issue).toMatchObject({
      path: '/nodes/0/loop_group/nodes',
      scopeKey: 'loop-group:group',
      groupId: 'group',
      nodeId: 'group',
      field: 'depends_on',
    })
    expect(issue?.line).toBeGreaterThan(0)
    expect(issue?.column).toBeGreaterThan(0)
  })

  it('requires current-body output producers to be direct dependencies', () => {
    fc.assert(
      fc.property(fc.boolean(), (direct) => {
        const result = validate([
          loopGroup([
            { id: 'producer', prompt: 'Produce.' },
            { id: 'middle', prompt: 'Middle.', depends_on: ['producer'] },
            {
              id: 'consumer',
              prompt: 'Use $producer.output',
              depends_on: direct ? ['producer'] : ['middle'],
            },
          ]),
        ])
        expect(codes(result).includes('scoped-reference-missing-dependency')).toBe(!direct)
      }),
    )
  })

  it('requires outer output producers to be direct dependencies of the owning group', () => {
    fc.assert(
      fc.property(fc.boolean(), (direct) => {
        const result = validate(
          [{ id: 'outer', prompt: 'Produce.' }, loopGroup([{ id: 'consumer', prompt: 'Use $outer.output' }])].map(
            (node) => (node.id === 'group' && direct ? { ...node, depends_on: ['outer'] } : node),
          ),
        )
        expect(codes(result).includes('scoped-reference-missing-dependency')).toBe(!direct)
      }),
    )
  })

  it('accepts previous-iteration references exactly when the producer belongs to the body', () => {
    fc.assert(
      fc.property(fc.boolean(), (known) => {
        const producer = known ? 'producer' : 'missing'
        const result = validate([
          loopGroup([
            { id: 'producer', prompt: 'Produce.' },
            { id: 'consumer', prompt: `Use $LOOP_PREV.${producer}.output` },
          ]),
        ])
        expect(codes(result).includes('scoped-reference-unknown-producer')).toBe(!known)
      }),
    )
  })

  it('rejects previous-iteration references on contract surfaces that do not allow them', () => {
    const result = validate([
      loopGroup([{ id: 'producer', prompt: 'Produce.' }], {
        gate_message: 'Review $LOOP_PREV.producer.output',
      }),
    ])

    expect(codes(result)).toEqual(['scoped-reference-unknown-producer'])
    expect(result.issues[0]).toMatchObject({
      path: '/nodes/0/loop_group/gate_message',
      field: 'loop_group.gate_message',
      groupId: 'group',
    })
  })

  it('validates structured body and promoted group output paths conservatively', () => {
    fc.assert(
      fc.property(fc.constantFrom('status', 'missing'), (field) => {
        const output_format = {
          type: 'object',
          properties: { status: { type: 'string' } },
          additionalProperties: false,
        }
        const result = validate([
          {
            id: 'producer-group',
            loop_group: {
              until: 'done',
              max_iterations: 1,
              nodes: [{ id: 'producer', prompt: 'Produce.', output_format }],
            },
          },
          {
            id: 'group',
            depends_on: ['producer-group'],
            loop_group: {
              until: 'done',
              max_iterations: 1,
              nodes: [{ id: 'consumer', prompt: `Use $producer-group.output.${field}` }],
            },
          },
          { id: 'downstream', depends_on: ['producer-group'], prompt: `Use $producer-group.output.${field}` },
        ])
        expect(codes(result).includes('scoped-reference-structured-path-impossible')).toBe(field === 'missing')
      }),
    )
  })

  it('validates contract-declared companion group/child paths', () => {
    const result = validate([loopGroup([{ id: 'child', prompt: 'Act.' }])], {
      language_compatibility: 'archon-2026-07',
      outward_action_nodes: ['group/child', 'group/missing'],
      outward_action_policy: 'approval_required',
    })

    expect(codes(result)).toEqual(['scoped-companion-reference-unknown-node'])
    expect(result.issues[0]).toMatchObject({ document: 'companion', scopeKey: 'loop-group:group', groupId: 'group' })
  })

  it.each(['group/child/extra', 'missing-root'])(
    'rejects scoped companion reference %s when it is not an exact group/child path',
    (reference) => {
      const result = validate([{ id: 'root', prompt: 'Root.' }, loopGroup([{ id: 'child', prompt: 'Act.' }])], {
        language_compatibility: 'archon-2026-07',
        outward_action_nodes: [reference],
        outward_action_policy: 'approval_required',
      })

      expect(codes(result)).toEqual(['scoped-companion-reference-unknown-node'])
      expect(result.issues[0]).toMatchObject({
        document: 'companion',
        path: '/outward_action_nodes/0',
        field: 'outward_action_nodes',
      })
    },
  )

  it('preserves an exact ordinary root companion reference beside scoped group/child entries', () => {
    const result = validate([{ id: 'root', prompt: 'Root.' }, loopGroup([{ id: 'child', prompt: 'Act.' }])], {
      language_compatibility: 'archon-2026-07',
      outward_action_nodes: ['root', 'group/child'],
      outward_action_policy: 'approval_required',
    })

    expect(codes(result)).toEqual([])
  })

  it('attaches complete navigation metadata to scoped diagnostics', () => {
    const result = validate([
      loopGroup([
        { id: 'producer', prompt: 'Produce.' },
        { id: 'consumer', prompt: 'Use $producer.output' },
      ]),
    ])

    expect(result.issues[0]).toMatchObject({
      document: 'definition',
      code: 'scoped-reference-missing-dependency',
      severity: 'error',
      blocking: true,
      path: '/nodes/0/loop_group/nodes/1/prompt',
      scopeKey: 'loop-group:group',
      groupId: 'group',
      nodeId: 'consumer',
      field: 'prompt',
      documentationId: 'durable-loop-groups',
    })
    expect(result.issues[0]?.line).toBeGreaterThan(0)
    expect(result.issues[0]?.column).toBeGreaterThan(0)
  })

  it('keeps complete metadata on group-level, node-level, and companion scoped issues', () => {
    const result = validate(
      [
        {
          ...loopGroup([{ id: 'consumer', prompt: 'Use $LOOP_PREV.missing.output' }]),
          retry: { max_attempts: 1 },
        },
      ],
      {
        language_compatibility: 'archon-2026-07',
        outward_action_nodes: ['group/missing'],
        outward_action_policy: 'approval_required',
      },
    )

    expect(result.issues.length).toBeGreaterThanOrEqual(3)
    for (const issue of result.issues) {
      expect(issue.document).toMatch(/^(definition|companion)$/)
      expect(issue.code).not.toBe('')
      expect(issue.severity).toMatch(/^(error|warning|info)$/)
      expect(typeof issue.blocking).toBe('boolean')
      expect(issue.path).toMatch(/^\//)
      expect(issue.line).toBeGreaterThan(0)
      expect(issue.column).toBeGreaterThan(0)
      expect(issue.scopeKey).toBe('loop-group:group')
      expect(issue.groupId).toBe('group')
      expect(issue.nodeId).toBeTruthy()
      expect(issue.field).toBeTruthy()
      expect(issue.documentationId).toBe('durable-loop-groups')
    }
  })

  it('reports visual capacity as an advisory without changing Hermes validity', () => {
    const body = Array.from({ length: 251 }, (_, index) => ({ id: `node-${index}`, bash: 'true' }))
    const result = validate([loopGroup(body)])

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'visual_capacity_exceeded',
        severity: 'warning',
        blocking: false,
        scopeKey: 'loop-group:group',
      }),
    )
    expect(codes(result)).toEqual([])
  })

  it.each([
    [512, false],
    [513, true],
  ] as const)('applies the contract body-node bound at %i nodes', (count, exceeded) => {
    const body = Array.from({ length: count }, (_, index) => ({ id: `node-${index}`, bash: 'true' }))

    expect(codes(validate([loopGroup(body)])).includes('loop_group_product_limit')).toBe(exceeded)
  })

  it.each([
    [4096, 1, false],
    [4097, 2, true],
  ] as const)('applies the contract body-edge bound at %i edges', (_edgeCount, lastDependencyCount, exceeded) => {
    const body = Array.from({ length: 92 }, (_, index) => ({
      id: `node-${index}`,
      bash: 'true',
      ...(index === 0
        ? {}
        : {
            depends_on:
              index < 91
                ? Array.from({ length: index }, (_, dependency) => `node-${dependency}`)
                : Array.from({ length: lastDependencyCount }, (_, dependency) => `node-${dependency}`),
          }),
    }))

    expect(codes(validate([loopGroup(body)])).includes('loop_group_product_limit')).toBe(exceeded)
  })

  it.each([
    [500, 4, false],
    [501, 5, true],
  ] as const)(
    'switches a %i-edge body to advisory-only YAML capacity at the declared visual boundary',
    (_edgeCount, lastDependencyCount, yamlOnly) => {
      const body = Array.from({ length: 33 }, (_, index) => ({
        id: `node-${index}`,
        bash: 'true',
        ...(index === 0
          ? {}
          : {
              depends_on:
                index < 32
                  ? Array.from({ length: index }, (_, dependency) => `node-${dependency}`)
                  : Array.from({ length: lastDependencyCount }, (_, dependency) => `node-${dependency}`),
            }),
      }))
      const result = validate([loopGroup(body)])

      expect(result.issues.some(({ code }) => code === 'visual_capacity_exceeded')).toBe(yamlOnly)
      expect(codes(result)).toEqual([])
    },
  )

  it('reports root visual capacity independently from loop-group language bounds', () => {
    const nodes = Array.from({ length: 251 }, (_, index) => ({ id: `root-${index}`, bash: 'true' }))
    const result = validate(nodes)

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'visual_capacity_exceeded',
        severity: 'warning',
        blocking: false,
        scopeKey: 'root',
      }),
    )
    expect(codes(result)).toEqual([])
  })
})
