import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import SvelteFlowPanActivationHarness from '$src/features/canvas/SvelteFlowPanActivationHarness.svelte'

describe('canvas interactions', () => {
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
  })

  it('activates the installed Svelte Flow key handler for the browser Space key value', async () => {
    render(SvelteFlowPanActivationHarness)
    const state = screen.getByTestId('svelte-flow-pan-state')

    await fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(state).toHaveAttribute('data-pan-activation-key-pressed', 'true')

    await fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    expect(state).toHaveAttribute('data-pan-activation-key-pressed', 'false')
  })
})
