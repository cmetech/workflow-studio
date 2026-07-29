import type { LayoutRecordV1 } from '$src/lib/layout/types'
import type { WorkflowProjection } from '$src/lib/projection/types'

export const LARGE_WORKFLOW_NODE_COUNT = 250
export const LARGE_WORKFLOW_EDGE_COUNT = 500
export const LARGE_WORKFLOW_SEED = 0x24c0ffee

export interface LargeWorkflowFixture {
  readonly projection: WorkflowProjection
  readonly layout: LayoutRecordV1
  readonly yaml: string
}

export function createLargeWorkflowFixture(seed = LARGE_WORKFLOW_SEED): LargeWorkflowFixture {
  const ids = Array.from({ length: LARGE_WORKFLOW_NODE_COUNT }, (_, index) => `node-${String(index).padStart(3, '0')}`)
  const edgePairs = new Set<string>()

  for (let index = 0; index < ids.length - 1; index += 1) {
    edgePairs.add(`${ids[index]}\0${ids[index + 1]}`)
  }

  let state = seed >>> 0
  const random = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
  while (edgePairs.size < LARGE_WORKFLOW_EDGE_COUNT) {
    const sourceIndex = random() % (ids.length - 1)
    const targetIndex = sourceIndex + 1 + (random() % (ids.length - sourceIndex - 1))
    edgePairs.add(`${ids[sourceIndex]}\0${ids[targetIndex]}`)
  }

  const edges = [...edgePairs]
    .map((pair) => {
      const [source, target] = pair.split('\0') as [string, string]
      return Object.freeze({ id: `dependency:${source}->${target}`, source, target })
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    const dependencies = incoming.get(edge.target) ?? []
    dependencies.push(edge.source)
    incoming.set(edge.target, dependencies)
  }

  const rawNodes = ids.map((id, index) => ({
    id,
    command: `Run deterministic performance step ${index}: ${'bounded-render-data '.repeat(12)}`,
    ...(incoming.has(id) ? { depends_on: incoming.get(id) } : {}),
  }))
  const nodes = rawNodes.map((node, index) =>
    Object.freeze({
      id: node.id,
      kind: 'command',
      value: node.command,
      dependsOn: Object.freeze([...(node.depends_on ?? [])]),
      options: Object.freeze({}),
      source: Object.freeze({ path: `/nodes/${index}`, start: index * 10, end: index * 10 + 9 }),
    }),
  )
  const definition = Object.freeze({
    name: 'Fixed 250-node performance workflow',
    description: 'Deterministic Task 9 canvas reference fixture.',
    nodes: Object.freeze(rawNodes.map((node) => Object.freeze({ ...node }))),
  })
  const projection: WorkflowProjection = Object.freeze({
    name: definition.name,
    description: definition.description,
    profile: 'hermes-legacy',
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    definition,
    companion: null,
  })
  const layout: LayoutRecordV1 = {
    schemaVersion: 1,
    workspaceId: 'task-9-performance',
    workflowPath: 'fixed-250-node-workflow.yaml',
    nodePositions: Object.fromEntries(
      ids.map((id, index) => [id, { x: (index % 25) * 280, y: Math.floor(index / 25) * 150 }]),
    ),
    viewport: { x: 0, y: 0, zoom: 0.2 },
    panels: { left: 280, right: 320, problems: 180 },
    editorMode: 'visual',
    updatedAt: '2026-07-25T00:00:00.000Z',
  }
  const yaml = [
    `name: ${definition.name}`,
    `description: ${definition.description}`,
    'nodes:',
    ...rawNodes.flatMap((node) => [
      `  - id: ${node.id}`,
      `    command: ${JSON.stringify(node.command)}`,
      ...(node.depends_on ? ['    depends_on:', ...node.depends_on.map((dependency) => `      - ${dependency}`)] : []),
    ]),
    '',
  ].join('\n')

  return { projection, layout, yaml }
}
