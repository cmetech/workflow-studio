import { invoke } from '@tauri-apps/api/core'
import type { HostInfo, NativeBridge } from './types'

export const tauriBridge: NativeBridge = {
  hostHealth: () => invoke<HostInfo>('host_health'),
}
