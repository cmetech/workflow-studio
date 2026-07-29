import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import GraphCanvas from '$src/features/canvas/GraphCanvas.svelte'
import { commandRegistry } from '$src/lib/commands/registry'
import { clearCanvasState } from '$src/stores/canvas'
import { createLargeWorkflowFixture } from '../performance/large-workflow'

describe('canvas reduced-motion contract', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
  })

  afterEach(() => clearCanvasState())

  it('removes canvas transition and animation classes and focuses the keyboard viewport instantly', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    const fixture = createLargeWorkflowFixture()
    const { container, component } = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: fixture.projection,
      layout: fixture.layout,
    })
    await tick()
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    const viewport = canvas.querySelector<HTMLElement>('.svelte-flow__viewport')!

    expect(canvas).toHaveAttribute('data-motion', 'reduced')
    expect(canvas).not.toHaveClass('canvas-transitions')
    expect(canvas.querySelector('.animated')).not.toBeInTheDocument()

    canvas.focus()
    component.fitGraph()
    await tick()

    expect(canvas).toHaveAttribute('data-keyboard-viewport-focus', 'instant')
    expect(viewport.style.transform).toContain('scale(')
    component.actualSize()
    await tick()
    expect(viewport.style.transform).toContain('scale(1)')
  })
})
