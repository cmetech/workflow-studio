import { render } from '@testing-library/svelte'
import { SvelteFlow } from '@xyflow/svelte'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import WorkflowNode from './WorkflowNode.svelte'
import workflowNodeSource from './WorkflowNode.svelte?raw'
import { CANVAS_RENDER_DENSITY_RELATIONSHIP, type CanvasNodeData } from './types'

const baseData: CanvasNodeData = {
  id: 'collect',
  kind: 'command',
  summary: 'Collect inputs',
  errorCount: 0,
  requiredIssueCount: 0,
  stale: false,
  readOnly: false,
  accessibleLabel: 'command node collect',
}

describe('WorkflowNode edge emphasis', () => {
  it('retains measurable noninteractive handle anchors when overview hides authoring ports', () => {
    const { container } = render(WorkflowNode, {
      props: { data: baseData },
      context: new Map([[CANVAS_RENDER_DENSITY_RELATIONSHIP, { overview: () => true, portsVisible: () => false }]]),
    })
    for (const [type, id, position] of [
      ['source', 'dependency-out', 'right'],
      ['target', 'dependency-in', 'left'],
    ]) {
      const anchor = container.querySelector(`.${type}`)
      expect(anchor).not.toBeNull()
      expect(anchor).toHaveAttribute('data-handleid', id)
      expect(anchor).toHaveAttribute('data-handlepos', position)
      expect(anchor).toHaveAttribute('aria-hidden', 'true')
      expect(anchor).not.toHaveClass('connectable')
    }
  })

  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((media: string) => ({
        matches: false,
        media,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  function renderNode(data: CanvasNodeData, selected = false) {
    return render(SvelteFlow, {
      nodes: [
        {
          id: data.id,
          type: 'workflow',
          position: { x: 0, y: 0 },
          initialWidth: 216,
          initialHeight: 104,
          selected,
          data,
        },
      ],
      edges: [],
      nodeTypes: { workflow: WorkflowNode },
      width: 400,
      height: 240,
    } as never)
  }

  it('marks an active edge endpoint without replacing its accessible node label', () => {
    const { container } = renderNode({ ...baseData, edgeEmphasized: true })
    const node = container.querySelector('article')!

    expect(node).toHaveClass('edge-emphasized')
    expect(node).toHaveAttribute('aria-label', 'command node collect')
    expect(workflowNodeSource).not.toMatch(/\.workflow-node\.edge-emphasized\s*\{[^}]*border-width/)
  })

  it('keeps non-endpoint cards visible and exposes separate stale, read-only, and subdued hooks', () => {
    const { container } = renderNode({ ...baseData, stale: true, readOnly: true, edgesDeemphasized: true })
    const node = container.querySelector('article')!

    expect(node).toHaveClass('stale', 'read-only', 'edges-deemphasized')
    expect(node).not.toHaveAttribute('hidden')
    expect(workflowNodeSource).not.toMatch(/\.workflow-node\.edges-deemphasized[^}]*opacity/)
    expect(workflowNodeSource).toContain('.workflow-node:hover')
    expect(workflowNodeSource).toContain('.svelte-flow__node:focus-visible')
    expect(workflowNodeSource).toContain('@media (forced-colors: active)')
  })
})
