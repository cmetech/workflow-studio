import { render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import { closeDocumentSession } from '$src/stores/documents'
import { clearWorkspace } from '$src/stores/workspace'

describe('App damaged contract cache recovery', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
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

  afterEach(() => {
    setNativeBridgeForTest(undefined)
    clearWorkspace()
    closeDocumentSession()
  })

  it('settles startup on a rejected cache load, keeps New usable, and surfaces a bounded advisory', async () => {
    setNativeBridgeForTest({
      ...createBrowserBridge(),
      contractCacheLoad: async () => Promise.reject(new Error('malformed index with private cache content')),
    })
    const App = (await import('./App.svelte')).default

    render(App)

    await waitFor(() => expect(screen.getByRole('button', { name: 'New Workflow' })).toBeEnabled())
    const advisory = screen.getByRole('status', { name: 'Contract cache advisory' })
    expect(advisory).toHaveTextContent(/local contract cache could not be read.*bundled contracts remain available/i)
    expect(advisory).not.toHaveTextContent(/private cache content/i)
  }, 30_000)
})
