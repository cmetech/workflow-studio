import { stringify } from 'yaml'
import currentOutputDefinition from '../../examples/loop-group-current-output/workflow.yaml?raw'
import currentOutputCompanion from '../../examples/loop-group-current-output/workflow.hermes.yaml?raw'
import iterationContextDefinition from '../../examples/loop-group-iteration-context/workflow.yaml?raw'
import iterationContextCompanion from '../../examples/loop-group-iteration-context/workflow.hermes.yaml?raw'
import primarySinkDefinition from '../../examples/loop-group-primary-sink/workflow.yaml?raw'
import primarySinkCompanion from '../../examples/loop-group-primary-sink/workflow.hermes.yaml?raw'
import type { LayoutRecordV2, ScopeLayoutV1 } from '$src/lib/layout/types'
import type { GraphScopeKey } from '$src/lib/projection/types'

export const SCOPED_NODE_COUNT = 250
export const SCOPED_EDGE_COUNT = 500
export const SCOPED_BODY_COUNT = 3

export interface FixtureScope {
  readonly scopeKey: GraphScopeKey
  readonly nodeIds: readonly string[]
  readonly edges: readonly { readonly source: string; readonly target: string }[]
}

export interface LoopGroupFixture {
  readonly definitionPath: string
  readonly companionPath: string
  readonly definition: string
  readonly companion: string
  readonly layout: LayoutRecordV2
  readonly scopes: readonly FixtureScope[]
}

export const bundledLoopGroupExamples = Object.freeze({
  currentOutput: Object.freeze({ definition: currentOutputDefinition, companion: currentOutputCompanion }),
  iterationContext: Object.freeze({ definition: iterationContextDefinition, companion: iterationContextCompanion }),
  primarySink: Object.freeze({ definition: primarySinkDefinition, companion: primarySinkCompanion }),
})

function boundedEdges(ids: readonly string[]): readonly { source: string; target: string }[] {
  const pairs = new Set<string>()
  for (let target = 1; target < ids.length; target += 1) pairs.add(`${target - 1}:${target}`)
  for (let distance = 2; pairs.size < SCOPED_EDGE_COUNT; distance += 1) {
    for (let target = distance; target < ids.length && pairs.size < SCOPED_EDGE_COUNT; target += 1) {
      pairs.add(`${target - distance}:${target}`)
    }
  }
  return [...pairs].map((pair) => {
    const [source, target] = pair.split(':').map(Number) as [number, number]
    return { source: ids[source]!, target: ids[target]! }
  })
}

function dependencyMap(edges: readonly { source: string; target: string }[]): ReadonlyMap<string, readonly string[]> {
  const incoming = new Map<string, string[]>()
  for (const { source, target } of edges) incoming.set(target, [...(incoming.get(target) ?? []), source])
  return incoming
}

function scope(idPrefix: string, scopeKey: GraphScopeKey): FixtureScope {
  const nodeIds = Array.from(
    { length: SCOPED_NODE_COUNT },
    (_, index) => `${idPrefix}-${String(index).padStart(3, '0')}`,
  )
  const result = Object.freeze({
    scopeKey,
    nodeIds: Object.freeze(nodeIds),
    edges: Object.freeze(boundedEdges(nodeIds)),
  })
  const order = new Map(result.nodeIds.map((id, index) => [id, index]))
  if (
    result.nodeIds.length !== SCOPED_NODE_COUNT ||
    new Set(result.nodeIds).size !== SCOPED_NODE_COUNT ||
    result.edges.length !== SCOPED_EDGE_COUNT ||
    new Set(result.edges.map(({ source, target }) => `${source}\0${target}`)).size !== SCOPED_EDGE_COUNT ||
    result.edges.some(({ source, target }) => order.get(source)! >= order.get(target)!)
  ) {
    throw new Error(`Generated scope ${scopeKey} violated its deterministic 250-node/500-edge DAG contract.`)
  }
  return result
}

function scopeLayout(scope: FixtureScope, scopeIndex: number): ScopeLayoutV1 {
  const bodyGesturePositions: Readonly<Record<number, { readonly x: number; readonly y: number }>> = {
    3: { x: 80, y: 0 },
    4: { x: 360, y: 0 },
    5: { x: 640, y: 0 },
  }
  return {
    nodePositions: Object.fromEntries(
      scope.nodeIds.map((id, index) => [
        id,
        scopeIndex === 0
          ? { x: (index % 25) * 280, y: Math.floor(index / 25) * 150 }
          : (bodyGesturePositions[index] ?? {
              x: 2_000 + (index % 25) * 280,
              y: Math.floor(index / 25) * 150 + scopeIndex * 8,
            }),
      ]),
    ),
    viewport: scopeIndex === 0 ? { x: 0, y: 0, zoom: 0.2 } : { x: 0, y: 48, zoom: 1 },
    selectedNodeIds: [],
    focusTarget: { kind: 'canvas' },
    inspector: { tab: 'General', scrollTop: scopeIndex * 10 },
    canvasScroll: { left: scopeIndex * 5, top: scopeIndex * 7 },
  }
}

function ordinaryNodes(scope: FixtureScope): Record<string, unknown>[] {
  const incoming = dependencyMap(scope.edges)
  return scope.nodeIds.map((id) => ({
    id,
    prompt: 'x',
    ...(incoming.has(id) ? { depends_on: incoming.get(id) } : {}),
  }))
}

export function createScopedCapacityFixture(): LoopGroupFixture {
  const root = scope('root', 'root')
  const bodies = Array.from({ length: SCOPED_BODY_COUNT }, (_, index) =>
    scope(`body-${index}`, `loop-group:root-${String(index).padStart(3, '0')}`),
  )
  const rootIncoming = dependencyMap(root.edges)
  const groupById = new Map<string, FixtureScope>(
    bodies.map((body, index) => [`root-${String(index).padStart(3, '0')}`, body] as const),
  )
  const nodes = root.nodeIds.map((id) => {
    const dependsOn = rootIncoming.get(id)
    const body = groupById.get(id)
    if (!body)
      return {
        id,
        prompt: 'x',
        ...(dependsOn ? { depends_on: dependsOn } : {}),
      }
    return {
      id,
      ...(dependsOn ? { depends_on: dependsOn } : {}),
      loop_group: {
        until: 'complete',
        max_iterations: 1,
        nodes: ordinaryNodes(body),
      },
    }
  })
  const definition = stringify({
    name: 'Scoped capacity',
    description: 'Root and loop bodies at capacity.',
    nodes,
  })
  const definitionPath = 'workflows/release-demo.yaml'
  const companionPath = 'workflows/release-demo.hermes.yaml'
  const scopes = Object.freeze([root, ...bodies])
  const layout: LayoutRecordV2 = {
    schemaVersion: 2,
    workspaceId: 'browser-workspace',
    workflowPath: definitionPath,
    activeScopeKey: 'root',
    scopeLayouts: Object.fromEntries(
      scopes.map((entry, index) => [entry.scopeKey, scopeLayout(entry, index)]),
    ) as LayoutRecordV2['scopeLayouts'],
    panels: { left: 280, right: 320, problems: 180 },
    editorMode: 'visual',
    updatedAt: '2026-09-05T00:00:00.000Z',
  }
  return Object.freeze({
    definitionPath,
    companionPath,
    definition,
    companion: 'language_compatibility: archon-2026-07\ntags: [e2e, loop-group, performance]\n',
    layout,
    scopes,
  })
}

export function createOversizedBodyFixture(): Pick<
  LoopGroupFixture,
  'definitionPath' | 'companionPath' | 'definition' | 'companion'
> {
  const oversizedIds = Array.from({ length: 251 }, (_, index) => `large-${String(index).padStart(3, '0')}`)
  const oversizedEdges = boundedEdges(oversizedIds)
  const incoming = dependencyMap(oversizedEdges)
  const definition = stringify({
    name: 'Loop group scoped capacity isolation',
    description: 'Only the oversized loop body uses YAML-only mode.',
    nodes: [
      {
        id: 'large-group',
        loop_group: {
          until: 'complete',
          max_iterations: 1,
          nodes: oversizedIds.map((id) => ({
            id,
            prompt: `Produce deterministic output for ${id}.`,
            ...(incoming.has(id) ? { depends_on: incoming.get(id) } : {}),
          })),
        },
      },
      {
        id: 'small-group',
        loop_group: {
          until: 'complete',
          max_iterations: 1,
          nodes: [{ id: 'small', prompt: 'Remain visually authorable.' }],
        },
      },
    ],
  })
  return {
    definitionPath: 'workflows/release-demo.yaml',
    companionPath: 'workflows/release-demo.hermes.yaml',
    definition,
    companion: 'language_compatibility: archon-2026-07\ntags: [e2e, loop-group]\n',
  }
}
