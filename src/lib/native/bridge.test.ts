import { afterEach, describe, expect, it } from 'vitest'
import { getNativeBridge, setNativeBridgeForTest } from './bridge'
import type { NativeBridge } from './types'

const expectedBrowserHost = {
  appVersion: 'browser',
  os: 'browser',
  arch: 'browser',
} as const

afterEach(() => {
  setNativeBridgeForTest(undefined)
})

describe('native bridge', () => {
  it('uses the browser implementation when Tauri internals are unavailable', async () => {
    expect(await getNativeBridge().hostHealth()).toEqual(expectedBrowserHost)
  })

  it('uses and clears the test bridge override', async () => {
    const fake: NativeBridge = {
      hostHealth: async () => ({
        appVersion: 'test-version',
        os: 'linux',
        arch: 'test-arch',
      }),
    }

    setNativeBridgeForTest(fake)
    expect(await getNativeBridge().hostHealth()).toEqual({
      appVersion: 'test-version',
      os: 'linux',
      arch: 'test-arch',
    })

    setNativeBridgeForTest(undefined)
    expect(await getNativeBridge().hostHealth()).toEqual(expectedBrowserHost)
  })
})
