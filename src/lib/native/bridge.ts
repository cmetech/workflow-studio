import { browserBridge } from './browser-bridge'
import { tauriBridge } from './tauri-bridge'
import type { NativeBridge } from './types'

let bridgeForTest: NativeBridge | undefined

export function getNativeBridge(): NativeBridge {
  if (bridgeForTest !== undefined) {
    return bridgeForTest
  }

  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? tauriBridge : browserBridge
}

export function setNativeBridgeForTest(bridge: NativeBridge | undefined): void {
  bridgeForTest = bridge
}
