import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import GraphCanvas from '$src/features/canvas/GraphCanvas.svelte'
import { commandRegistry } from '$src/lib/commands/registry'
import { clearCanvasState } from '$src/stores/canvas'
import { createLargeWorkflowFixture } from '../performance/large-workflow'
import statusBarSource from '$src/app/StatusBar.svelte?raw'
import documentationViewSource from '$src/features/documentation/DocumentationView.svelte?raw'
import documentationOverviewSource from '$src/features/documentation/DocumentationOverview.svelte?raw'
import documentationTopicListSource from '$src/features/documentation/DocumentationTopicList.svelte?raw'
import documentationArticleSource from '$src/features/documentation/DocumentationArticle.svelte?raw'
import keyboardShortcutsSource from '$src/features/commands/KeyboardShortcuts.svelte?raw'

function createMotionPreference(initialMatches = false) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    get matches() {
      return matches
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.delete(listener)
    }),
  }

  return {
    query: query as unknown as MediaQueryList,
    listenerCount: () => listeners.size,
    setMatches(next: boolean): void {
      matches = next
      const event = { matches, media: query.media } as MediaQueryListEvent
      for (const listener of [...listeners]) listener(event)
    },
  }
}

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

  it('keeps the narrow status disclosure motion-free and legible in forced colors', () => {
    expect(statusBarSource).toContain('@media (prefers-reduced-motion: reduce)')
    expect(statusBarSource).toContain('@media (forced-colors: active)')
    expect(statusBarSource).not.toMatch(/transition\s*:/)
    expect(statusBarSource).not.toMatch(/animation\s*:/)
  })

  it('keeps documentation and shortcut navigation immediate with forced-color affordances', () => {
    const sources = [
      documentationViewSource,
      documentationOverviewSource,
      documentationTopicListSource,
      documentationArticleSource,
      keyboardShortcutsSource,
    ]
    for (const source of sources) {
      expect(source).toContain('@media (forced-colors: active)')
      const motionDeclarations = [...source.matchAll(/(?:transition|animation)\s*:\s*([^;}\n]+)/g)]
      for (const declaration of motionDeclarations) expect(declaration[1]?.trim()).toMatch(/^none(?:\s+!important)?$/)
    }
    expect(keyboardShortcutsSource).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('reacts to runtime preference changes, keeps keyboard viewport movement instant, and cleans up', async () => {
    const motion = createMotionPreference()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => motion.query),
    })
    const fixture = createLargeWorkflowFixture()
    const { container, component, unmount } = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: fixture.projection,
      layout: fixture.layout,
    })
    await tick()
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    const viewport = canvas.querySelector<HTMLElement>('.svelte-flow__viewport')!
    const toolbar = canvas.querySelector<HTMLElement>('.canvas-toolbar')!
    const node = canvas.querySelector<HTMLElement>('.workflow-node')!

    expect(canvas).toHaveAttribute('data-motion', 'full')
    expect(canvas).toHaveClass('canvas-transitions')
    expect(canvas).toHaveAttribute('data-keyboard-viewport-focus', 'instant')

    motion.setMatches(true)
    await tick()

    expect(canvas).toHaveAttribute('data-motion', 'reduced')
    expect(canvas).not.toHaveClass('canvas-transitions')
    expect(canvas.querySelector('.animated')).not.toBeInTheDocument()
    expect(canvas).toHaveAttribute('data-keyboard-viewport-focus', 'instant')
    expect(toolbar.closest('[data-motion="reduced"]')).toBe(canvas)
    expect(node.closest('[data-motion="reduced"]')).toBe(canvas)
    expect(node).not.toHaveClass('animated')

    canvas.focus()
    component.fitGraph()
    await tick()

    expect(canvas).toHaveAttribute('data-keyboard-viewport-focus', 'instant')
    expect(viewport.style.transform).toContain('scale(')
    component.actualSize()
    await tick()
    expect(viewport.style.transform).toContain('scale(1)')

    motion.setMatches(false)
    await tick()

    expect(canvas).toHaveAttribute('data-motion', 'full')
    expect(canvas).toHaveClass('canvas-transitions')
    expect(canvas).toHaveAttribute('data-keyboard-viewport-focus', 'instant')

    const registeredListener = vi.mocked(motion.query.addEventListener).mock.calls[0]?.[1]
    expect(motion.listenerCount()).toBe(1)
    unmount()
    expect(motion.query.removeEventListener).toHaveBeenCalledWith('change', registeredListener)
    expect(motion.listenerCount()).toBe(0)

    motion.setMatches(true)
    await tick()
    expect(canvas).toHaveAttribute('data-motion', 'full')
  })
})
