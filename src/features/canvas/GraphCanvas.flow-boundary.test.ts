import { render, screen } from '@testing-library/svelte'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { commandRegistry } from '$src/lib/commands/registry'
import { CANVAS_PAN_INTERACTION } from '$src/lib/commands/canvas-interactions'
import type { ScopeLayoutV1 } from '$src/lib/layout/types'
import type { ProjectedGraph } from '$src/lib/projection/types'
import { VISUAL_NODE_CAPACITY } from '$src/lib/projection/types'

vi.mock('@xyflow/svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/svelte')>()
  const [{ default: SvelteFlow }, { default: Background }] = await Promise.all([
    import('./SvelteFlowBoundaryProbe.svelte'),
    import('./SvelteFlowBoundaryNoop.svelte'),
  ])
  return { ...actual, SvelteFlow, Background }
})

import GraphCanvas from './GraphCanvas.svelte'

const projection: ProjectedGraph = Object.freeze({
  scope: Object.freeze({
    key: 'root',
    kind: 'root',
    workflow: Object.freeze({ name: 'Boundary', profile: 'hermes-legacy' }),
  }),
  editorNodePrefix: '',
  sourcePath: Object.freeze(['nodes']),
  sourceRange: Object.freeze({ start: 0, end: 0 }),
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  definitionOrder: Object.freeze([]),
  outerInputs: Object.freeze([]),
  issues: Object.freeze([]),
  capacity: Object.freeze({ status: 'visual', nodeCount: 0, edgeCount: 0 }),
})

const layout: ScopeLayoutV1 = {
  selectedNodeIds: [],
  inspector: { tab: 'General', scrollTop: 0 },
  canvasScroll: { left: 0, top: 0 },

  nodePositions: {},
  viewport: { x: 0, y: 0, zoom: 1 },
}

describe('GraphCanvas Svelte Flow boundary', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
  })

  it('passes the browser Space key and drag setting to the Svelte Flow component boundary', () => {
    render(GraphCanvas, { commandSurface: commandRegistry, projection, layout } as never)

    expect(screen.getByTestId('svelte-flow-boundary-probe')).toHaveAttribute('data-received-pan-activation-key', ' ')
    expect(screen.getByTestId('svelte-flow-boundary-probe')).toHaveAttribute(
      'data-received-pan-on-drag',
      String(CANVAS_PAN_INTERACTION.panOnDrag),
    )
  })

  it('mounts a newly admitted small draft while retaining visible-only rendering at the capacity boundary', () => {
    const projectionWithCount = (nodeCount: number): ProjectedGraph => {
      const nodes = Array.from({ length: nodeCount }, (_, index) => ({
        id: `node-${index}`,
        kind: 'prompt',
        value: `Node ${index}`,
        dependsOn: [],
        options: {},
        source: { path: `/nodes/${index}`, start: index, end: index + 1 },
      }))
      return {
        ...projection,
        nodes,
        definitionOrder: nodes.map(({ id }) => id),
        capacity: { status: 'visual', nodeCount, edgeCount: 0 },
      }
    }

    const small = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: projectionWithCount(1),
      layout,
    } as never)
    expect(screen.getByTestId('svelte-flow-boundary-probe')).toHaveAttribute('data-received-visible-only', 'false')
    small.unmount()

    for (const nodeCount of [2, VISUAL_NODE_CAPACITY - 1, VISUAL_NODE_CAPACITY]) {
      const virtualized = render(GraphCanvas, {
        commandSurface: commandRegistry,
        projection: projectionWithCount(nodeCount),
        layout,
      } as never)
      expect(screen.getByTestId('svelte-flow-boundary-probe')).toHaveAttribute('data-received-visible-only', 'true')
      virtualized.unmount()
    }
  })
})
