import type { LayoutWorkerRequest } from '$src/workers/layout-worker-protocol'
import type { GraphScopeKey } from '$src/lib/projection/types'

export interface RoutedLayoutCase {
  readonly name: string
  readonly maximumCrossings: number
  readonly request: LayoutWorkerRequest
}

function fixture(
  name: string,
  dependencies: readonly (readonly [string, readonly string[]])[],
  maximumCrossings = 0,
  scopeKey: GraphScopeKey = 'root',
): RoutedLayoutCase {
  return {
    name,
    maximumCrossings,
    request: {
      type: 'layout',
      identity: {
        requestId: name,
        workflowIdentity: 'routed-layout-fixtures',
        pairGeneration: 1,
        scopeKey,
        graphFingerprint: `sha256:${'a'.repeat(64)}`,
        layoutRevision: 0,
      },
      nodes: dependencies.map(([id], order) => ({ id, order, width: 216, height: id.endsWith('-cycle') ? 184 : 104 })),
      edges: dependencies
        .flatMap(([target, sources]) => sources.map((source) => ({ source, target })))
        .map(({ source, target }, order) => ({ id: `${source}->${target}`, source, target, order })),
    },
  }
}

export const showcaseRoot = fixture('showcase-root', [
  ['load-brief', []],
  ['inspect-workspace', ['load-brief']],
  ['planning-cycle', ['load-brief', 'inspect-workspace']],
  ['implementation-cycle', ['planning-cycle', 'load-brief']],
  ['package-evidence', ['implementation-cycle']],
  ['approval-gate', ['package-evidence', 'planning-cycle']],
  ['final-report', ['approval-gate', 'implementation-cycle', 'planning-cycle']],
])
export const planningBody = fixture(
  'planning-body',
  [
    ['draft-plan', []],
    ['estimate-work', ['draft-plan']],
    ['review-plan', ['draft-plan', 'estimate-work']],
    ['publish-plan', ['draft-plan', 'review-plan']],
  ],
  0,
  'loop-group:planning-cycle',
)
export const implementationBody = fixture(
  'implementation-body',
  [
    ['select-task', []],
    ['implement-change', ['select-task']],
    ['unit-tests', ['implement-change']],
    ['accessibility-check', ['implement-change']],
    ['validate-change', ['unit-tests', 'accessibility-check']],
    ['iteration-summary', ['implement-change', 'validate-change']],
  ],
  0,
  'loop-group:implementation-cycle',
)

export const routedLayoutCases: readonly RoutedLayoutCase[] = [
  fixture('chain', [
    ['a', []],
    ['b', ['a']],
    ['c', ['b']],
  ]),
  fixture('diamond', [
    ['a', []],
    ['b', ['a']],
    ['c', ['a']],
    ['d', ['b', 'c']],
  ]),
  fixture('fan-out-fan-in', [
    ['a', []],
    ['b', ['a']],
    ['c', ['a']],
    ['d', ['a']],
    ['e', ['b', 'c', 'd']],
  ]),
  fixture('long-edge', [
    ['a', []],
    ['b', ['a']],
    ['c', ['b']],
    ['d', ['a', 'c']],
  ]),
  fixture('disconnected', [
    ['a', []],
    ['b', ['a']],
    ['c', []],
    ['d', ['c']],
    ['isolated', []],
  ]),
  // K3,3 is non-planar; any drawing must contain at least one crossing.
  fixture(
    'unavoidable-crossing',
    [
      ['a', []],
      ['d', ['a']],
      ['b', ['d']],
      ['e', ['a', 'b']],
      ['c', ['d', 'e']],
      ['f', ['a', 'b', 'c']],
    ],
    1,
  ),
  showcaseRoot,
  planningBody,
  implementationBody,
]
