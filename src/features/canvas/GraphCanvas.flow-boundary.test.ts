import { render, screen } from '@testing-library/svelte'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { commandRegistry } from '$src/lib/commands/registry'
import { CANVAS_PAN_INTERACTION } from '$src/lib/commands/canvas-interactions'
import type { LayoutRecordV1 } from '$src/lib/layout/types'
import type { ProjectedGraph } from '$src/lib/projection/types'

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

const layout: LayoutRecordV1 = {
  schemaVersion: 1,
  workspaceId: 'workspace',
  workflowPath: 'boundary.yaml',
  nodePositions: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  panels: { left: 280, right: 320, problems: 180 },
  editorMode: 'visual',
  updatedAt: '2026-09-02T00:00:00.000Z',
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
})
