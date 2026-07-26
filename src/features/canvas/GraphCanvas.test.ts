import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LayoutRecordV1 } from '$src/lib/layout/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { $canvasPositions, clearCanvasState } from '$src/stores/canvas'
import GraphCanvas from './GraphCanvas.svelte'

const projection: WorkflowProjection = Object.freeze({
  name: 'Release',
  description: 'Release workflow',
  profile: 'hermes-legacy',
  nodes: Object.freeze([
    Object.freeze({
      id: 'collect',
      kind: 'command',
      value: 'Gather release context',
      dependsOn: Object.freeze([]),
      options: Object.freeze({}),
      source: Object.freeze({ path: '/nodes/0', start: 0, end: 20 }),
    }),
    Object.freeze({
      id: 'review',
      kind: 'prompt',
      value: 'Review release findings',
      dependsOn: Object.freeze(['collect']),
      options: Object.freeze({}),
      source: Object.freeze({ path: '/nodes/1', start: 21, end: 50 }),
    }),
  ]),
  edges: Object.freeze([Object.freeze({ id: 'dependency:collect->review', source: 'collect', target: 'review' })]),
  definition: Object.freeze({ name: 'Release' }),
  companion: null,
})

const layout: LayoutRecordV1 = {
  schemaVersion: 1,
  workspaceId: 'workspace',
  workflowPath: 'release.yaml',
  nodePositions: { collect: { x: 0, y: 0 }, review: { x: 320, y: 0 } },
  viewport: { x: 0, y: 0, zoom: 1 },
  panels: { left: 280, right: 320, problems: 180 },
  editorMode: 'visual',
  updatedAt: '2026-07-25T00:00:00.000Z',
}

describe('GraphCanvas', () => {
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
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 600,
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

  afterEach(() => {
    vi.useRealTimers()
    clearCanvasState()
  })

  it('isolates 100 drag moves to position state and persists one layout only after drag-stop debounce', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    const before = structuredClone(projection)
    const { container } = render(GraphCanvas, { projection, layout, onPersistLayout: persistLayout })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!

    for (let move = 1; move <= 100; move += 1) {
      await fireEvent(
        canvas,
        new CustomEvent('workflowdragmove', {
          bubbles: true,
          detail: { id: 'collect', position: { x: move, y: move * 2 } },
        }),
      )
    }

    expect($canvasPositions.get().collect).toEqual({ x: 100, y: 200 })
    expect(persistLayout).not.toHaveBeenCalled()
    expect(projection).toEqual(before)

    await fireEvent(
      canvas,
      new CustomEvent('workflowdragstop', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 100, y: 200 } },
      }),
    )
    await vi.advanceTimersByTimeAsync(299)
    expect(persistLayout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(persistLayout).toHaveBeenCalledTimes(1)
    expect(persistLayout).toHaveBeenCalledWith(
      expect.objectContaining({ nodePositions: { collect: { x: 100, y: 200 }, review: { x: 320, y: 0 } } }),
    )
  })

  it('renders read-only stale affordances, canvas controls, minimap toggle, and explicit Arrange', async () => {
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    render(GraphCanvas, { projection, layout, stale: true, readOnly: true, onPersistLayout: persistLayout })

    expect(screen.getByRole('status')).toHaveTextContent(/last valid graph.*read-only/i)
    expect(screen.getByRole('button', { name: 'Arrange graph' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show minimap' })).toBeEnabled()

    await fireEvent.click(screen.getByRole('button', { name: 'Show minimap' }))
    await tick()
    expect(screen.getByRole('button', { name: 'Hide minimap' })).toBeVisible()
  })

  it('flushes a pending drag-stop persistence before the canvas closes', async () => {
    vi.useFakeTimers()
    const persistLayout = vi.fn<(next: LayoutRecordV1) => Promise<void>>().mockResolvedValue(undefined)
    const { component, container } = render(GraphCanvas, { projection, layout, onPersistLayout: persistLayout })
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    await fireEvent(
      canvas,
      new CustomEvent('workflowdragstop', {
        bubbles: true,
        detail: { id: 'collect', position: { x: 88, y: 99 } },
      }),
    )

    await component.flushPersistence()

    expect(persistLayout).toHaveBeenCalledTimes(1)
    expect(persistLayout).toHaveBeenCalledWith(
      expect.objectContaining({ nodePositions: expect.objectContaining({ collect: { x: 88, y: 99 } }) }),
    )
    await vi.advanceTimersByTimeAsync(300)
    expect(persistLayout).toHaveBeenCalledTimes(1)
  })

  it('exposes focusable 32px dependency ports for keyboard and touch users', async () => {
    render(GraphCanvas, { projection, layout })
    await tick()

    const incoming = screen.getByRole('button', { name: 'Dependencies entering collect' })
    expect(incoming).toHaveAttribute('tabindex', '0')
    expect(getComputedStyle(incoming).width).toBe('32px')
    expect(getComputedStyle(incoming).height).toBe('32px')
  })
})
