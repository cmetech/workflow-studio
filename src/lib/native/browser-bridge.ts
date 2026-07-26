import type { NativeBridge } from './types'

export const browserBridge: NativeBridge = {
  hostHealth: async () => ({
    appVersion: 'browser',
    os: 'browser',
    arch: 'browser',
  }),
}
