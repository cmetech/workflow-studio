import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { AuthoringContract, SemanticRuleDescriptor } from '$src/lib/contract/types'
import { projectWorkflow } from '$src/lib/projection/project-workflow'
import type { ProjectedNode, WorkflowProjection } from '$src/lib/projection/types'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import { validateDag } from './dag-validator'

function node(id: string, dependsOn: readonly string[] = [], value: unknown = `run ${id}`): ProjectedNode {
  return {
    id,
    kind: 'prompt',
    value,
    dependsOn,
    options: {},
    source: { path: `/nodes/${id}`, start: 0, end: 1 },
  }
}

function projection(nodes: readonly ProjectedNode[]): WorkflowProjection {
  return {
    name: 'Fixture',
    description: 'DAG validator fixture',
    profile: 'archon-2026-07',
    nodes,
    edges: nodes.flatMap((target) =>
      target.dependsOn.map((source) => ({ id: `dependency:${source}->${target.id}`, source, target: target.id })),
    ),
    definition: {},
    companion: null,
  }
}

const outputReferenceRule: SemanticRuleDescriptor = {
  id: 'hermes-output-reference-v1',
  label: 'Upstream output references',
  description: 'Output references must name upstream nodes.',
  field_paths: ['nodes[].prompt'],
  applicability: { profiles: ['archon-2026-07'], documents: ['definition'], node_kinds: ['prompt'] },
  status: 'supported',
  parameters: { syntax: '$ID.output(.path)*', require_upstream: true },
  examples: ['$prepare.output.summary'],
}

const topologyRule: SemanticRuleDescriptor = {
  id: 'workflow-dag-v1',
  label: 'Workflow DAG',
  description: 'Contract-owned graph fields.',
  field_paths: ['nodes'],
  applicability: { profiles: ['archon-2026-07'], documents: ['definition'] },
  status: 'supported',
  parameters: { nodes_path: 'nodes', id_field: 'id', dependencies_field: 'depends_on' },
  examples: [],
}

const projectionContract: AuthoringContract = {
  schema_version: 1,
  contract_reader_version: 1,
  profile: 'archon-2026-07',
  normalizer_version: 1,
  contract_digest: `sha256:${'d'.repeat(64)}`,
  definition_schema: { type: 'object' },
  sidecar_schema: { type: 'object' },
  node_kinds: [
    {
      id: 'prompt',
      label: 'Prompt',
      description: 'Property-test prompt node.',
      field_path: 'nodes[].prompt',
      applicability: {
        profiles: ['archon-2026-07'],
        documents: ['definition'],
        node_kinds: ['prompt'],
      },
      widget: 'multiline',
      section: 'general',
      order: 1,
      status: 'supported',
      examples: [],
      fields: [],
    },
  ],
  semantic_rules: [topologyRule],
  compatibility_codes: {},
  documentation: { topics: [], examples: [] },
  limits: { max_document_bytes: 2 * 1024 * 1024 },
  extensions: {},
}

describe('DAG semantic validation', () => {
  it('reports missing and duplicate node identifiers', () => {
    const result = validateDag(projection([node(''), node('same'), node('same')]), [])

    expect(result.issues.map(({ code }) => code)).toEqual(['missing_node_id', 'duplicate_node_id'])
  })

  it('reports missing, self, and duplicate dependencies independently', () => {
    const result = validateDag(projection([node('a'), node('b', ['missing', 'b', 'a', 'a'])]), [])

    expect(result.issues.map(({ code }) => code)).toEqual([
      'missing_dependency',
      'self_dependency',
      'duplicate_dependency',
    ])
  })

  it('rejects dependency cycles and withholds a complete topological order', () => {
    const result = validateDag(projection([node('a', ['c']), node('b', ['a']), node('c', ['b'])]), [])

    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'dependency_cycle', layer: 'semantic', blocking: true }),
    ])
    expect(result.topologicalOrder).toEqual([])
  })

  it('maps cycle diagnostics through the contract-published node collection path', () => {
    const alternateTopologyRule = {
      ...topologyRule,
      field_paths: ['steps'],
      parameters: { nodes_path: 'steps', id_field: 'name', dependencies_field: 'after' },
    }

    const result = validateDag(projection([node('a', ['b']), node('b', ['a'])]), [alternateTopologyRule])

    expect(result.issues).toEqual([expect.objectContaining({ code: 'dependency_cycle', path: '/steps' })])
  })

  it('reports references to missing and non-upstream nodes from contract-selected fields', () => {
    const result = validateDag(
      projection([
        node('prepare'),
        node('consume', ['prepare'], 'Use $prepare.output.summary and $missing.output'),
        node('unrelated', [], 'Cannot use $consume.output'),
      ]),
      [outputReferenceRule],
    )

    expect(result.issues.map(({ code, nodeId, field }) => ({ code, nodeId, field }))).toEqual([
      { code: 'missing_reference', nodeId: 'consume', field: 'prompt' },
      { code: 'non_upstream_reference', nodeId: 'unrelated', field: 'prompt' },
    ])
  })

  it('derives the node-relative reference field from the contract path rather than a node field inventory', () => {
    const alternatePathRule = { ...outputReferenceRule, field_paths: ['steps[].prompt'] }

    const result = validateDag(projection([node('only', [], 'Read $missing.output')]), [alternatePathRule])

    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'missing_reference', nodeId: 'only', field: 'prompt' }),
    ])
  })

  it('blocks a supported reference rule with a malformed declared pattern', () => {
    const malformedRule = {
      ...outputReferenceRule,
      parameters: { pattern: '[', node_id_capture_group: 1, require_upstream: true },
    }

    const result = validateDag(projection([node('only')]), [malformedRule])

    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'reference_rule_invalid', layer: 'semantic', blocking: true }),
    ])
  })

  it('blocks a supported reference rule with an unsupported declared syntax', () => {
    const unsupportedRule = {
      ...outputReferenceRule,
      parameters: { syntax: '$ID.result(.path)*', require_upstream: true },
    }

    const result = validateDag(projection([node('only')]), [unsupportedRule])

    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'reference_rule_invalid', layer: 'semantic', blocking: true }),
    ])
  })

  it('continues to ignore applicable semantic rules that do not declare reference parsing', () => {
    expect(validateDag(projection([node('only')]), [topologyRule]).issues).toEqual([])
  })

  it('returns a deterministic Kahn topological order using source node order as the tie breaker', () => {
    const graph = projection([
      node('root-b'),
      node('root-a'),
      node('middle', ['root-b']),
      node('finish', ['root-a', 'middle']),
    ])

    const first = validateDag(graph, [])
    const second = validateDag(graph, [])

    expect(first).toEqual(second)
    expect(first.issues).toEqual([])
    expect(first.topologicalOrder).toEqual(['root-b', 'root-a', 'middle', 'finish'])
  })

  it('projects stable existing-endpoint edges for arbitrary acyclic dependency lists', () => {
    const dependencies = fc.array(fc.array(fc.nat(), { maxLength: 12 }), { minLength: 1, maxLength: 12 })

    fc.assert(
      fc.property(dependencies, (rows) => {
        const nodes = rows.map((candidates, index) => ({
          id: `node-${index}`,
          dependsOn: [
            ...new Set(candidates.filter((candidate) => candidate < index).map((candidate) => `node-${candidate}`)),
          ],
        }))
        const source = [
          'name: Property workflow',
          'description: Exercises production projection.',
          'nodes:',
          ...nodes.flatMap(({ id, dependsOn }) => [
            `  - id: ${id}`,
            ...(dependsOn.length === 0
              ? []
              : ['    depends_on:', ...dependsOn.map((dependency) => `      - ${dependency}`)]),
            `    prompt: Run ${id}`,
          ]),
          '',
        ].join('\n')
        const parseResult = parseWorkflowYaml(source, {
          document: 'definition',
          maxBytes: projectionContract.limits.max_document_bytes,
        })
        expect(parseResult.issues).toEqual([])
        expect(parseResult.parsed).not.toBeNull()
        if (!parseResult.parsed) return

        const projected = projectWorkflow(parseResult.parsed, null, 'archon-2026-07', projectionContract)
        const graph = projected.projection
        const result = validateDag(graph, projectionContract.semantic_rules)
        const ids = new Set(graph.nodes.map(({ id }) => id))

        expect(projected.issues).toEqual([])
        expect(result.issues).toEqual([])
        expect(result.topologicalOrder).toHaveLength(nodes.length)
        for (const edge of graph.edges) {
          expect(ids.has(edge.source)).toBe(true)
          expect(ids.has(edge.target)).toBe(true)
          expect(edge.id).toBe(`dependency:${edge.source}->${edge.target}`)
        }
      }),
    )
  })

  it('rejects adding an ancestor-to-descendant back edge for arbitrary chain lengths', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 40 }), (nodeCount) => {
        const nodes = Array.from({ length: nodeCount }, (_, index) =>
          node(`node-${index}`, index === 0 ? [`node-${nodeCount - 1}`] : [`node-${index - 1}`]),
        )

        expect(validateDag(projection(nodes), []).issues.map(({ code }) => code)).toContain('dependency_cycle')
      }),
    )
  })
})
