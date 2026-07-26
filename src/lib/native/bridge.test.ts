import { afterEach, describe, expect, it } from 'vitest'
import { browserBridge } from './browser-bridge'
import { getNativeBridge, setNativeBridgeForTest } from './bridge'
import { tauriBridge } from './tauri-bridge'
import type { NativeBridge } from './types'

const expectedBrowserHost = {
  appVersion: 'browser',
  os: 'browser',
  arch: 'browser',
} as const

afterEach(() => {
  setNativeBridgeForTest(undefined)
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('native bridge', () => {
  it('uses the browser implementation when Tauri internals are unavailable', async () => {
    expect(await getNativeBridge().hostHealth()).toEqual(expectedBrowserHost)
  })

  it('selects the Tauri or browser implementation from the environment on every call', () => {
    expect(getNativeBridge()).toBe(browserBridge)

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    expect(getNativeBridge()).toBe(tauriBridge)

    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    expect(getNativeBridge()).toBe(browserBridge)
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
