import { render } from '@testing-library/svelte'
import { Position, getSmoothStepPath } from '@xyflow/svelte'
import { describe, expect, it } from 'vitest'
import WorkflowEdge from './WorkflowEdge.svelte'
import workflowEdgeSource from './WorkflowEdge.svelte?raw'

function renderEdge(
  options: {
    routed?: boolean
    selected?: boolean
    stale?: boolean
    readOnly?: boolean
    emphasized?: boolean
    deemphasized?: boolean
  } = {},
) {
  return render(WorkflowEdge, {
    id: 'dependency:collect->review',
    sourceX: 0,
    sourceY: 0,
    targetX: 320,
    targetY: 80,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    markerEnd: 'url(#arrow)',
    selected: options.selected,
    data: {
      stale: options.stale ?? false,
      readOnly: options.readOnly ?? false,
      emphasized: options.emphasized,
      deemphasized: options.deemphasized,
      ...(options.routed
        ? {
            route: {
              edgeId: 'dependency:collect->review',
              points: [
                { x: 20, y: 20 },
                { x: 120, y: 20 },
                { x: 120, y: 100 },
                { x: 300, y: 100 },
              ],
            },
          }
        : {}),
    },
  } as never)
}

describe('WorkflowEdge routed rendering', () => {
  it('[RG4] renders the routed path with casing below the semantic stroke and no casing marker', () => {
    const { container } = renderEdge({ routed: true })
    const casing = container.querySelector<SVGPathElement>('.workflow-edge-casing')!
    const semantic = container.querySelector<SVGPathElement>('.workflow-edge')!
    const paths = [...container.querySelectorAll('path')]

    expect(semantic).toHaveAttribute('d', 'M 20 20 L 112 20 Q 120 20 120 28 L 120 92 Q 120 100 128 100 L 300 100')
    expect(casing).toHaveAttribute('d', semantic.getAttribute('d'))
    expect(paths.indexOf(casing)).toBeLessThan(paths.indexOf(semantic))
    expect(casing).not.toHaveAttribute('marker-end')
    expect(semantic).toHaveAttribute('marker-end', 'url(#arrow)')
  })

  it('retains smooth-step fallback when no complete route is attached', () => {
    const { container } = renderEdge()
    const expected = getSmoothStepPath({
      sourceX: 0,
      sourceY: 0,
      targetX: 320,
      targetY: 80,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      borderRadius: 10,
    })[0]

    expect(container.querySelector('.workflow-edge')).toHaveAttribute('d', expected)
  })

  it('keeps the 32px interaction path and exposes selected, focused, stale, and read-only hooks', () => {
    const { container } = renderEdge({ routed: true, selected: true, stale: true, readOnly: true })

    expect(container.querySelector('.workflow-edge')).toHaveClass('selected', 'stale', 'read-only')
    expect(container.querySelector('.workflow-edge-focus-halo')).toBeInTheDocument()
    expect(container.querySelector('.svelte-flow__edge-interaction')).toHaveAttribute('stroke-width', '32')
  })

  it('keeps casing, semantic, and focus layers while distinguishing emphasized and subdued routes', () => {
    const active = renderEdge({ routed: true, selected: true, emphasized: true })
    const activePaths = [...active.container.querySelectorAll('path')]
    const casing = active.container.querySelector<SVGPathElement>('.workflow-edge-casing')!
    const halo = active.container.querySelector<SVGPathElement>('.workflow-edge-focus-halo')!
    const semantic = active.container.querySelector<SVGPathElement>('.workflow-edge')!

    expect(semantic).toHaveClass('selected', 'emphasized')
    expect(activePaths.indexOf(casing)).toBeLessThan(activePaths.indexOf(halo))
    expect(activePaths.indexOf(halo)).toBeLessThan(activePaths.indexOf(semantic))

    const subdued = renderEdge({ routed: true, deemphasized: true })
    expect(subdued.container.querySelector('.workflow-edge')).toHaveClass('deemphasized')
    expect(subdued.container.querySelector('.workflow-edge')).not.toHaveAttribute('hidden')
    expect(subdued.container.querySelector('.workflow-edge')).not.toHaveAttribute('aria-hidden', 'true')
    expect(workflowEdgeSource).not.toMatch(/\.workflow-edge\.deemphasized\)\s*\{[^}]*opacity/)
  })

  it('keeps forced-colors treatment and does not animate routed paths', () => {
    const { container } = renderEdge({ routed: true })

    expect(workflowEdgeSource).toContain('@media (forced-colors: active)')
    expect(workflowEdgeSource).toContain('CanvasText')
    expect(workflowEdgeSource).toContain('Highlight')
    expect(workflowEdgeSource).toContain('GrayText')
    expect(workflowEdgeSource).toContain('--workflow-edge-subdued-width')
    expect(workflowEdgeSource).toContain('@media (prefers-reduced-motion: reduce)')
    expect(container.querySelector('.workflow-edge')).not.toHaveClass('animated')
  })
})
