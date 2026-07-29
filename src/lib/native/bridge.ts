import { browserBridge } from './browser-bridge'
import { tauriBridge } from './tauri-bridge'
import type { WorkspaceNativeBridge } from './types'

let bridgeForTest: WorkspaceNativeBridge | undefined

export function getNativeBridge(): WorkspaceNativeBridge {
  if (bridgeForTest !== undefined) {
    return bridgeForTest
  }

  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? tauriBridge : browserBridge
}

export function setNativeBridgeForTest(bridge: Partial<WorkspaceNativeBridge> | undefined): void {
  bridgeForTest = bridge === undefined ? undefined : { ...browserBridge, ...bridge }
}
