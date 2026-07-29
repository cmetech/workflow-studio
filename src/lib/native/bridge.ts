import { browserBridge } from './browser-bridge'
import { tauriBridge } from './tauri-bridge'
import { recordEditorMetric } from '$src/lib/metrics/editor-metrics'
import type { WorkspaceNativeBridge } from './types'

let bridgeForTest: WorkspaceNativeBridge | undefined
const instrumentedBridges = new WeakSet<object>()
const instrumentedMethod = Symbol('instrumented native method')

type InstrumentedMethod = ((...args: unknown[]) => unknown) & { [instrumentedMethod]?: true }

export function getNativeBridge(): WorkspaceNativeBridge {
  const bridge =
    bridgeForTest ?? (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? tauriBridge : browserBridge)
  return instrumentNativeCalls(bridge)
}

function instrumentNativeCalls(bridge: WorkspaceNativeBridge): WorkspaceNativeBridge {
  if (instrumentedBridges.has(bridge)) return bridge
  const mutableBridge = bridge as unknown as Record<string, unknown>
  for (const [property, value] of Object.entries(mutableBridge)) {
    if (typeof value !== 'function' || (value as InstrumentedMethod)[instrumentedMethod]) continue
    const original = value as InstrumentedMethod
    const wrapped: InstrumentedMethod = (...args: unknown[]) => {
      recordEditorMetric('nativeCalls')
      if (property.toLowerCase().startsWith('git')) recordEditorMetric('gitCalls')
      return Reflect.apply(original, bridge, args)
    }
    wrapped[instrumentedMethod] = true
    mutableBridge[property] = wrapped
  }
  instrumentedBridges.add(bridge)
  return bridge
}

export function setNativeBridgeForTest(bridge: Partial<WorkspaceNativeBridge> | undefined): void {
  bridgeForTest = bridge === undefined ? undefined : { ...browserBridge, ...bridge }
}
