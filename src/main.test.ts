import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startup = vi.hoisted(() => ({
  installRuntimeBootstrap: vi.fn(async () => undefined),
  mount: vi.fn(),
}))

vi.mock('$runtime-bootstrap', () => ({
  installRuntimeBootstrap: startup.installRuntimeBootstrap,
}))
vi.mock('svelte', () => ({ mount: startup.mount }))
vi.mock('./app/App.svelte', () => ({ default: {} }))

beforeEach(() => {
  vi.resetModules()
  startup.installRuntimeBootstrap.mockClear()
  startup.mount.mockClear()
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  document.body.innerHTML = '<div id="app"></div>'
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('application startup', () => {
  it('mounts when the browser blocks local-storage acquisition', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage is unavailable.', 'SecurityError')
    })

    await import('./main')

    await vi.waitFor(() => expect(startup.mount).toHaveBeenCalledOnce())
    expect(startup.installRuntimeBootstrap).toHaveBeenCalledOnce()
    expect(startup.mount).toHaveBeenCalledWith(expect.anything(), {
      target: document.getElementById('app'),
    })
  })
})
