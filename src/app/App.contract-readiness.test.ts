import { render } from '@testing-library/svelte'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const readiness = vi.hoisted(() => {
  let release: ((contracts: readonly never[]) => void) | undefined
  const promise = new Promise<readonly never[]>((resolve) => (release = resolve))
  return { promise, release: () => release?.([]) }
})

vi.mock('$src/lib/contract/bundled-contracts', () => ({
  loadBundledAuthoringContracts: vi.fn(() => readiness.promise),
}))

import { getNativeBridge } from '$src/lib/native/bridge'
import App from './App.svelte'

describe('App contract readiness', () => {
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

  beforeEach(() => vi.restoreAllMocks())

  it('awaits the single contract readiness promise before processing startup paths', async () => {
    const startupPaths = vi.spyOn(getNativeBridge(), 'startupPaths').mockResolvedValue([])
    render(App)

    await Promise.resolve()
    expect(startupPaths).not.toHaveBeenCalled()
    readiness.release()
    await vi.waitFor(() => expect(startupPaths).toHaveBeenCalledTimes(1))
  })
})
